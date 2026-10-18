const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Chicane shortcuts: ordered route gates at every chicane apex (Track.routeGates, Session.routeCheck) on top of the
// off-track progress rule (Session.legalProgress). Kerbs and running wide stay legal; cutting across gains nothing.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT, DS = SIM.DS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });

function session(id, n = 1, seed = 3) {
  const t = tracks.get(id);
  const S = new SIM.Session(t, { type: 'race', entries: SIM.DRIVERS.slice(0, n).map((driver, i) => ({ driver, isPlayer: i === 0 })), seed, weather: 'dynamic', weatherState: DRY(seed), difficulty: 1 });
  S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  for (const c of S.cars) { S.fitTyres(c, 'H', 78); c.fuel = S.fuelForLaps(3); c.started = true; c.crossings = 1; c.playerHandling = new SIM.PlayerHandling(); }
  return S;
}
// drive a car through a gate's span in 2 m steps with a chosen lateral position and tyre count at the apex
function through(S, car, g, { d, offN, pit = false }) {
  const t = S.track; let credited = 0;
  car.gateNext = null; car.routeDebt = 0;
  for (let x = -10; x <= g.len + 30; x += 2) {
    car.s = t.wrapS(g.s0 + x); car.idx = Math.floor(car.s / DS) % t.N;
    const atApex = Math.abs(x - g.apexAt) <= 6;
    car.d = atApex ? d : 0; car.offN = atApex ? offN : 0; car.pit = pit ? { phase: 'in' } : null;
    credited += S.routeCheck(car, 2);
  }
  car.pit = null;
  return { credited, debt: car.routeDebt || 0, total: g.len + 40 + 2 };
}

test('every chicane apex has a gate, in lap order', () => {
  const want = { monza: ['Variante del Rettifilo', 'Variante della Roggia', 'Variante Ascari'], spa: ['Bus Stop', 'Les Combes'], suzuka: ['Casio Triangle', 'S Curves'],
    interlagos: ['Senna S'], bahrain: ['Turn 1', 'Turn 2'], silverstone: ['Becketts', 'Maggotts'] };
  for (const [id, names] of Object.entries(want)) {
    const G = tracks.get(id).routeGates;
    for (const n of names) assert.ok(G.some(g => g.name === n), id + ' gate at ' + n + ' (' + G.map(g => g.name).join(', ') + ')');
    for (let k = 1; k < G.length; k++) assert.ok(G[k].apex > G[k - 1].apex, id + ' gates in lap order');
    for (const g of G) assert.ok(g.apexAt > 0 && g.len > g.apexAt && g.len < 400, id + ' ' + g.name + ' span ' + g.len.toFixed(0));
  }
});

test('kerbs, inside wheels over the kerb and running wide keep the full progress', () => {
  for (const id of ['monza', 'spa', 'suzuka']) {
    const S = session(id), car = S.cars[0];
    for (const g of tracks.get(id).routeGates) {
      const hw = tracks.get(id).hw[g.apex];
      for (const [d, offN, why] of [[g.inside * (hw + 0.6), 0, 'on the kerb'], [g.inside * (hw + 1.5), 2, 'inside wheels past the kerb'], [-g.inside * (hw + 6), 4, 'running wide on the outside']]) {
        const r = through(S, car, g, { d, offN });
        assert.equal(r.debt, 0, id + ' ' + g.name + ': ' + why);
        assert.equal(r.credited, r.total, id + ' ' + g.name + ': ' + why + ' keeps its progress');
      }
    }
  }
});

test('skipping a chicane apex creates a physical slowdown without changing race progress', () => {
  for (const id of ['monza', 'spa', 'suzuka', 'interlagos']) {
    const S = session(id), car = S.cars[0];
    for (const g of tracks.get(id).routeGates) {
      const r = through(S, car, g, { d: g.inside * (tracks.get(id).hw[g.apex] + 8), offN: 4 });
      // The missed span is owed as speed loss; physical progress is never withheld.
      assert.equal(r.credited, r.total, id + ' physical progress stays aligned');
      assert.ok(r.debt >= g.len - 1, id + ' ' + g.name + ': ' + r.credited + ' of ' + r.total + ' m credited, ' + r.debt.toFixed(0) + ' m still owed');
    }
  }
});

test('the pit lane in use always counts as the route', () => {
  const S = session('monza'), car = S.cars[0];
  for (const g of tracks.get('monza').routeGates) {
    const r = through(S, car, g, { d: g.inside * 20, offN: 4, pit: true });
    assert.equal(r.debt, 0); assert.equal(r.credited, r.total);
  }
});

test("Suzuka's crossover: a lap driven along the line is credited in full, with no gate missed", () => {
  const S = session('suzuka'), car = S.cars[0], t = S.track;
  car.placeAt(t, 10, 0, 0); car.gateNext = null; car.routeDebt = 0; car.offN = 0;
  let credited = 0, prev = car.s;
  for (let s = 12; s <= t.length + 10; s += 2) {
    const [x, z] = t.pointAt(t.wrapS(s), 0), px = car.x, pz = car.z;
    car.x = x; car.z = z; t.project(x, z, car.idx, car.proj); car.idx = car.proj.i; car.s = car.proj.s; car.d = car.proj.d;
    credited += S.routeCheck(car, S.legalProgress(car, t.dS(prev, car.s), x - px, z - pz)); prev = car.s;
  }
  assert.ok(Math.abs(credited - t.length) < 4, 'credited ' + credited.toFixed(1) + ' of ' + t.length.toFixed(1));
  assert.ok(!(S.stats.routeMisses > 0), 'no gate missed');
});

// a car driven across a chicane through the player's own handling: straight at the exit, or held in the widest
// corridor that keeps a tyre on the kerb; the time it takes plus the race distance it is still short at the exit
function cutRun(id, ch, vCap, sg, kerb) {
  const S = session(id), car = S.cars[0], t = S.track, N = t.N;
  const s0 = t.wrapS(ch.a.start * DS - 120), s1 = t.wrapS(ch.b.end * DS + 60);
  car.placeAt(t, s0, 0, 0); const v0 = Math.min(vCap, t.aiLines.vRef[Math.round(s0 / DS) % N]);
  car.vx = Math.cos(car.psi) * v0; car.vz = Math.sin(car.psi) * v0; car.gear = 6; car.totalDist = 5 * t.length + s0; car.lastLapBase = undefined;
  const [x0, z0] = t.pointAt(s0, 0), [x1, z1] = t.pointAt(s1, 0), d0 = car.totalDist, goal = d0 + t.dS(s0, s1);
  car.control = (dt, sess) => {
    let px = x1, pz = z1;
    if (kerb) {
      const ux = x1 - x0, uz = z1 - z0, L2 = ux * ux + uz * uz, f = Math.min(1, ((car.x - x0) * ux + (car.z - z0) * uz) / L2 + 25 / Math.sqrt(L2));
      px = x0 + ux * f; pz = z0 + uz * f;
      const pr = { i: car.idx, s: 0, d: 0 }; t.project(px, pz, car.idx, pr);
      const side = pr.d > 0 ? 1 : -1, lim = t.hw[pr.i] + ((side > 0 ? t.kerbR : t.kerbL)[pr.i] ? 1.3 : 0) + 0.95;
      if (Math.abs(pr.d) > lim) { const q = t.pointAt(pr.s, side * lim); px = q[0]; pz = q[1]; }
    }
    let e = Math.atan2(pz - car.z, px - car.x) - car.psi; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    car.playerHandling.step(car, dt, sess, { steer: Math.max(-1, Math.min(1, e * 3 * sg)), throttle: car.speed < vCap ? 1 : 0, brake: car.speed > vCap + 2 ? 0.7 : 0, analog: true });
  };
  let time = 0;
  for (let k = 0; k < 20 / DT && car.totalDist < goal; k++) { S.fixedStep(DT); time += DT; if (Math.hypot(car.x - x1, car.z - z1) < 6 && car.totalDist < goal - 15) break; }
  // judge any gate still open, as the car carries on past the exit
  for (let k = 0; k < 2 / DT && car.totalDist < goal; k++) { S.fixedStep(DT); time += DT; }
  const vExit = Math.max(30, t.aiLines.vRef[Math.round(s1 / DS) % N]);
  return time + Math.max(0, goal - car.totalDist) / vExit;
}
function legalRun(id, ch) {
  const S = session(id), car = S.cars[0], t = S.track, N = t.N; car.isPlayer = false; S.player = null;
  const ai = new SIM.AIDriver(car, S, {}); car.ai = ai; car.control = (dt, sess) => { ai.decide(dt, sess.step); car.playerHandling.step(car, dt, sess, { ...ai.cmd }); };
  const s0 = t.wrapS(ch.a.start * DS - 120), s1 = t.wrapS(ch.b.end * DS + 60);
  car.placeAt(t, s0, 0, 0); const v0 = t.aiLines.vRef[Math.round(s0 / DS) % N] * 0.95;
  car.vx = Math.cos(car.psi) * v0; car.vz = Math.sin(car.psi) * v0; car.gear = 6; car.totalDist = 5 * t.length + s0; car.lastLapBase = undefined;
  const goal = car.totalDist + t.dS(s0, s1); let time = 0;
  for (let k = 0; k < 30 / DT && car.totalDist < goal; k++) { S.fixedStep(DT); time += DT; }
  return time;
}
test('cutting straight across a chicane is slower than driving it: Rettifilo, Ascari, Bus Stop, Casio Triangle', () => {
  const cases = [['monza', 'Variante del Rettifilo'], ['monza', 'Variante Ascari'], ['spa', 'Bus Stop'], ['suzuka', 'Casio Triangle']];
  for (const [id, name] of cases) {
    const t = tracks.get(id), cs = t.corners, k = cs.findIndex(c => c.name === name);
    const ch = { a: cs[k], b: cs[k + 1] }, legal = legalRun(id, ch);
    let best = 1e9;
    for (const v of [250, 200, 140, 90]) for (const kerb of [false, true]) for (const sg of [1, -1]) best = Math.min(best, cutRun(id, ch, v / 3.6, sg, kerb));
    assert.ok(best > legal, id + ' ' + name + ': best cut ' + best.toFixed(2) + ' s vs legal ' + legal.toFixed(2) + ' s');
  }
});

test('the AI never trips a gate in a full-field race (Monza, Suzuka)', () => {
  for (const id of ['monza', 'suzuka']) {
    const t = tracks.get(id);
    const S = new SIM.Session(t, { type: 'race', entries: SIM.DRIVERS.map(driver => ({ driver })), seed: 7, spectate: true, weather: 'dynamic', weatherState: DRY(7), difficulty: 1 });
    S.totalLaps = 1;
    while (!S.over && S.time < 260) S.fixedStep(DT);
    assert.ok(S.over, id + ' race finished');
    assert.equal(S.stats.routeMisses || 0, 0, id + ' gate misses');
  }
});
