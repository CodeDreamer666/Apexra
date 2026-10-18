const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Collision damage is applied at the collision, not seconds later: an impact is judged within a few hundredths of a
// second of the first contact, sustained contact is judged as it happens, equal impacts give equal damage, and no
// contact step is counted twice.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT;
const circuit = new SIM.Track(SIM.TRACK_DEF);
const STRAIGHT = 1300; // Monza: the flat-out run from the Rettifilo through Curva Grande

function lab(n = 1, seed = 3) {
  const S = new SIM.Session(circuit, { type: 'race', entries: SIM.DRIVERS.slice(0, n).map(driver => ({ driver })), seed, spectate: true, damage: 'realistic' });
  S.lightsOut = true; S.time = 20; for (const c of S.cars) { c.ai = null; c.started = true; S.fitTyres(c, 'H', 78); }
  return S;
}
function place(car, s, d, v, yaw = 0) {
  car.placeAt(circuit, s, d, 0); car.psi += yaw; car.vx = Math.cos(car.psi) * v; car.vz = Math.sin(car.psi) * v; car.r = 0;
  Object.assign(car.input, { throttle: 0, brake: 0, steer: 0 }); car.gear = 6;
}
const wallR = () => circuit.walls(circuit.wrapI(Math.round(STRAIGHT / SIM.DS)), STRAIGHT, false, { l: 0, r: 0, innerPit: 0 }).r;
const total = (car) => car.damage.c.reduce((a, b) => a + b, 0) + car.damage.scuff;
// run until the first contact is recorded, then return the time of that contact
function untilContact(S, max = 2) {
  for (let k = 0; k < max / DT; k++) { S.fixedStep(DT); if (S.contacts.size) return S.time; }
  return null;
}

test('a wall impact is judged within 0.1 s of the first contact, with its handling effect at once', () => {
  const S = lab(), [A] = S.cars;
  place(A, STRAIGHT, wallR() - 3.2, 40, 0.5);
  const t0 = untilContact(S); assert.ok(t0 != null, 'the car reaches the barrier');
  const before = A.damage.perf ? JSON.stringify(A.damage.perf) : '';
  let judgedAt = null;
  for (let k = 0; k < 0.5 / DT; k++) { S.fixedStep(DT); if (judgedAt == null && total(A) > 0.05) judgedAt = S.time; }
  assert.ok(judgedAt != null, 'the impact damaged the car');
  assert.ok(judgedAt - t0 <= 0.1 + 1e-9, 'damage applied ' + (judgedAt - t0).toFixed(3) + ' s after contact');
  if (before) assert.notEqual(JSON.stringify(A.damage.perf), before, 'the car\'s performance changed with the damage');
});

test('a car kept pressed against the barrier takes its damage while the contact goes on, not when it ends', () => {
  // steer into the barrier and stay on the throttle so the contact goes on (both steering signs are tried; the
  // run with the longer contact is used)
  const grind = (steer) => {
    const S = lab(), [A] = S.cars, steps = [];
    place(A, STRAIGHT, wallR() - 1.6, 45, 0.12);
    const rec = S.recordContact.bind(S);
    S.recordContact = (...a) => { if (steps[steps.length - 1] !== S.time) steps.push(S.time); return rec(...a); };
    const hist = [];
    for (let k = 0; k < 2 / DT; k++) { Object.assign(A.input, { steer, throttle: 1, brake: 0 }); S.fixedStep(DT); hist.push([S.time, total(A)]); }
    return { steps, hist };
  };
  const runs = [grind(0.6), grind(-0.6)].sort((a, b) => b.steps.length - a.steps.length), { steps, hist } = runs[0];
  assert.ok(steps.length * DT > 0.25, 'the contact went on for ' + (steps.length * DT).toFixed(2) + ' s');
  const first = steps[0], last = steps[steps.length - 1];
  const at = (t) => { let v = 0; for (const [tt, d] of hist) if (tt <= t) v = d; return v; };
  assert.ok(at(first + 0.1) > 0, 'damage booked within 0.1 s of the first contact');
  assert.ok(at(last - 0.05) >= 0.5 * at(last + 0.2), 'most of the damage was on the car before the contact ended: ' + at(last - 0.05) + ' of ' + at(last + 0.2));
});

test('the same impact under the same conditions gives the same damage', () => {
  const run = (seed) => { const S = lab(1, seed), [A] = S.cars; place(A, STRAIGHT, wallR() - 3.2, 30, 0.45); for (let k = 0; k < 0.8 / DT; k++) S.fixedStep(DT); return Array.from(A.damage.c); };
  const a = run(3), b = run(17);
  for (let k = 0; k < a.length; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, 'part ' + k + ': ' + a[k] + ' vs ' + b[k]);
});

test('every contact step is judged exactly once', () => {
  const S = lab(2), [A, B] = S.cars;
  let recorded = 0, judged = 0;
  const rec = S.recordContact.bind(S), ev = S.evaluateImpact.bind(S);
  S.recordContact = (key, a, b, x, z, nx, nz, vn, vt, jt, mEff) => { recorded += 0.5 * mEff * vn * vn; return rec(key, a, b, x, z, nx, nz, vn, vt, jt, mEff); };
  S.evaluateImpact = (e) => { judged += e.E; return ev(e); };
  place(B, STRAIGHT + 7, 0, 40); place(A, STRAIGHT, 0, 52); // a 12 m/s rear-end
  for (let k = 0; k < 1.5 / DT; k++) S.fixedStep(DT);
  assert.ok(recorded > 0, 'the cars collided');
  assert.equal(S.contacts.size, 0, 'nothing left pending');
  assert.ok(Math.abs(recorded - judged) < 1e-6 * recorded, recorded + ' recorded vs ' + judged + ' judged');
});

test('a light touch stays light and a severe crash retires the car at the impact', () => {
  const S1 = lab(), [A] = S1.cars; place(A, STRAIGHT, wallR() - 1.3, 30, 0.04);
  for (let k = 0; k < 1 / DT; k++) S1.fixedStep(DT);
  assert.ok(!A.retiring && Math.max(...A.damage.c) < 0.3, 'a brush with the wall is survivable');
  const S2 = lab(), [B] = S2.cars; place(B, STRAIGHT, wallR() - 3.2, 65, 0.6);
  const t0 = untilContact(S2); let at = null;
  for (let k = 0; k < 0.5 / DT; k++) { S2.fixedStep(DT); if (at == null && B.retiring) at = S2.time; }
  assert.ok(at != null && at - t0 <= 0.1 + 1e-9, 'retirement decided at the impact (' + (at && (at - t0).toFixed(3)) + ' s)');
});
