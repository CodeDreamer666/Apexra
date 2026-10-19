const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mod = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(mod);
const S = mod.exports, dt = S.PHYS_DT;
const env = { wet: 0, wearScale: 0, fuelRate: 0, trackTemp: 30, pitLimiter: false };
function rig(kmh, player = true) {
  const c = new S.Car({ driver: S.DRIVERS[0], isPlayer: player }, { fuelEnabled: false });
  c.vx = c.u = c.speed = kmh / 3.6; c.gear = 6;
  let surfaces = [0, 0, 0, 0], wheel = 0;
  const t = { cx: [0], cz: [0], rx: [0], rz: [1], pit: { limit: 22 }, surfaceAt: () => surfaces[wheel++ % 4] };
  return { c, set: a => { surfaces = a; }, step: (seconds = dt) => S.stepCarPhysics(c, seconds, t, env) };
}

// the 15% entry loss is taken off smoothly over GREEN_RUNOFF.entryTime, not in one step; the reference car b has the
// same paint forces (it is already on the paint, entry latched) but no entry, so a/b isolates the entry loss
const T = S.GREEN_RUNOFF.entryTime;
const ratioAfter = (a, b, seconds) => { for (let k = 0; k < Math.round(seconds / dt); k++) { a.step(); b.step(); } return a.c.speed / b.c.speed; };
for (const kmh of [100, 200, 300]) for (const n of [1, 2, 4]) {
  test(`${kmh} km/h, ${n} tyres: entry removes 15% of velocity smoothly, once`, () => {
    const a = rig(kmh), b = rig(kmh), paint = Array.from({ length: 4 }, (_, i) => i < n ? 2 : 0);
    a.set(paint); b.set(paint); b.c.greenEntryActive = true;
    a.step(1e-9); b.step(1e-9);
    assert.ok(a.c.speed / b.c.speed > 0.999, 'no sudden drop at the moment of entry');
    assert.equal(a.c.greenEntries, 1);
    let prev = 1;
    for (const t of [0.1, 0.2, 0.3, 0.4, 0.5]) { const r = ratioAfter(a, b, 0.1); assert.ok(r < prev - 0.01 && r > 0.85, `falling steadily at ${t} s: ${r.toFixed(4)}`); prev = r; }
    const done = ratioAfter(a, b, T - 0.5 + 0.05);
    // (exactly 15% is taken off; the slower car then has slightly less air drag than the reference, hence the margin)
    assert.ok(Math.abs(done - .85) < 0.005, 'the loss ends at 15%: ' + done);
    assert.equal(a.c.greenDrainT, 0);
    // and stops there: from now on the car slows exactly like one already on the paint at the same speed
    const c = rig(a.c.speed * 3.6); c.set(paint); c.c.greenEntryActive = true; c.c.x = a.c.x;
    for (const k of ['runoffDrag', 'runoffLoss', 'runoffGrip', 'offLvl', 'gear']) c.c[k] = a.c[k];
    for (let k = 0; k < Math.round(1 / dt); k++) { a.step(); c.step(); }
    assert.ok(Math.abs(a.c.speed / c.c.speed - 1) < 0.005, 'no further loss after the 15%: ' + a.c.speed + ' vs ' + c.c.speed);
    for (let k = 0; k < 240; k++) a.step();
    assert.equal(a.c.greenEntries, 1, 'staying on paint cannot compound the entry penalty');
    assert.ok(a.c.speed > kmh / 3.6 * .55, 'ordinary rolling resistance, not repeated 15% reductions');
  });
}

test('wheel swaps and brief seam gaps do not rearm; a real exit does', () => {
  const r = rig(200);
  r.set([2, 0, 0, 0]); r.step();
  for (let k = 0; k < 40; k++) { r.set(k % 2 ? [0, 2, 0, 0] : [0, 0, 2, 0]); r.step(); }
  for (let k = 0; k < 20; k++) {
    r.set([0, 0, 0, 0]); r.step(); r.step();
    r.set([2, 2, 0, 0]); r.step();
  }
  assert.equal(r.c.greenEntries, 1);
  r.set([1, 1, 1, 1]);
  for (let k = 0; k < 24; k++) r.step();
  r.set([2, 2, 2, 2]); r.step(1e-9);
  assert.equal(r.c.greenEntries, 2);
  assert.ok(r.c.greenDrainT >= T - 1e-6, 'a real exit rearms a full new entry loss');
});

test('AI and player receive the same entry pulse and sustained forces, including a grass/paint mix', () => {
  const a = rig(250, true), b = rig(250, false);
  for (const surfaces of [[0, 0, 0, 0], [2, 2, 3, 3], [2, 2, 2, 2], [0, 0, 0, 0], [2, 2, 2, 2]]) {
    a.set(surfaces); b.set(surfaces);
    for (let k = 0; k < 120; k++) { a.step(); b.step(); }
    assert.deepEqual([a.c.x, a.c.speed, a.c.greenEntries, a.c.offLvl], [b.c.x, b.c.speed, b.c.greenEntries, b.c.offLvl]);
  }
  assert.equal(a.c.greenEntries, 2);
});

test('asphalt restores acceleration with W held after a green/grass excursion', () => {
  const r = rig(200), h = new S.PlayerHandling();
  const drive = surfaces => {
    r.set(surfaces);
    for (let k = 0; k < 4 / dt; k++) {
      h.step(r.c, dt, { lightsOut: true, wet: 0 }, { steer: 0, throttle: 1, brake: 0, analog: true }); r.step();
    }
  };
  drive([3, 3, 3, 3]); const off = r.c.speed;
  drive([2, 2, 2, 2]); const green = r.c.speed;
  drive([0, 0, 0, 0]);
  assert.ok(off > 10 && green > off && r.c.speed > green + 5);
  assert.ok(r.c.runoffLoss < .001 && r.c.runoffDrag < .001);
});

const reference = require('./reference/environment-geometry.json');
for (const def of S.CIRCUITS) test(`${def.id}: preserved geometry/pits and matching surface profile on both sides`, () => {
  const t = new S.Track(def), before = reference[def.id];
  assert.equal(t.length, before.length);
  for (const [key, hash] of Object.entries(before.fields)) {
    const a = t[key];
    assert.equal(crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex'), hash, key + ' is byte-identical');
  }
  assert.deepEqual(JSON.parse(JSON.stringify(t.pit)), before.pit, 'routing and service boxes are unchanged');
  const p = {}; let painted = 0;
  for (let i = 0; i < t.N; i++) for (const side of [-1, 1]) {
    t.tracksideAt(i, side, p);
    assert.ok(p.barrier - p.road >= 3.2 - 1e-8, 'barrier clears the legal edge');
    assert.ok(p.greenEnd >= p.kerbEnd && p.greenEnd <= p.kerbEnd + 3.2 + 1e-8);
    if (p.pit || p.greenEnd <= p.kerbEnd + .2) continue;
    painted++;
    const start = Math.max(p.kerbEnd, p.road + S.OFF_TRACK.tyreHalf);
    assert.equal(t.surfaceAt(i, side * ((start + p.greenEnd) / 2), false), 2, 'paint uses the rendered strip');
    assert.ok(t.surfaceAt(i, side * (p.greenEnd + .01), false) >= 3, 'recovery starts at the end of paint');
    assert.ok(p.barrier - p.greenEnd >= 2.4 - 1e-8);
  }
  assert.ok(painted > t.N, 'paint is present around both sides of most of the circuit');
  assert.ok(t.validate().ok);
});

test('both barriers contain a car on every circuit, with damage determined by the impact', () => {
  for (const def of S.CIRCUITS) {
    const t = new S.Track(def);
    const i = t.kappa.findIndex((k, i) => i > 200 && Math.abs(k) < 1 / 2500 && t.pitProg(i * S.DS) < 0 && t.barrierAt(i, -1) && t.barrierAt(i, 1));
    assert.ok(i >= 0, def.id + ': a clear straight');
    for (const side of [-1, 1]) {
      const race = new S.Session(t, { type: 'race', seed: 41, damage: 'realistic', weather: 'dry', entries: [{ driver: S.DRIVERS[0] }] });
      race.lightsOut = true; race.time = 20;
      const c = race.cars[0]; c.ai = null; c.started = true; c.launch.active = false;
      const wall = side > 0 ? t.wallR[i] : t.wallL[i];
      c.placeAt(t, i * S.DS, side * (wall - 2.4), 55);
      c.psi += side * .5; c.vx = Math.cos(c.psi) * 55; c.vz = Math.sin(c.psi) * 55;
      let hits = 0; const onHit = race.onWallHit.bind(race);
      race.onWallHit = (...args) => { hits++; return onHit(...args); };
      for (let k = 0; k < 240; k++) {
        race.fixedStep(dt);
        const bound = side > 0 ? t.wallR[c.idx] : t.wallL[c.idx];
        assert.ok(side * c.d < bound + .25, def.id + ': contained on side ' + side);
      }
      assert.ok(hits > 0, def.id + ': physical contact on side ' + side);
      assert.ok(c.damage.c.some(x => x > .01), def.id + ': impact causes damage');
    }
  }
});
