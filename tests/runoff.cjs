const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Green painted run-off: the preserved grip loss, the new progressive rolling resistance, the surface hierarchy,
// identical physics for player and AI, the planner's use of the paint (and its limits), and real races.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT, GR = SIM.GREEN_RUNOFF;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const ENV = { wet: 0, wearScale: 0, fuelRate: 0, trackTemp: 36, pitLimiter: false };

function rig(t, isPlayer = false) {
  const s = new SIM.Session(t, { type: 'calib', seed: 1, weather: 'dry', damage: 'realistic', tyreWear: 'off', entries: [{ driver: SIM.DRIVERS[0], isPlayer }] });
  const c = s.cars[0]; s.fitTyres(c, 'S', 95); c.fuel = 10; return { s, c };
}
// a straight, level, painted stretch away from the pit lane
function straight(t) {
  // (a real circuit's straights are never perfectly level, straight or even in width: the flattest 260 m with paint
  // beside it, on either side, is enough for 2 s at 200 km/h, and every run of a comparison uses the same stretch)
  for (const [K, G, W] of [[3000, 0.02, 0.3], [1500, 0.04, 0.5], [1000, 0.05, 0.8], [600, 0.06, 1.2]]) for (const sg of [-t.pit.side, t.pit.side]) {
    for (let s0 = 300; s0 < t.length; s0 += 20) {
      let ok = true;
      for (let s = s0; s < s0 + 260 && ok; s += 4) { const i = t.wrapI(Math.round(s / SIM.DS)); if (Math.abs(t.kappa[i]) > 1 / K || Math.abs(t.grade[i]) > G || !t.hasPaintedRunoff(i, sg) || t.pitProg(s) >= 0 || Math.abs(t.hw[i] - t.hw[t.wrapI(Math.round(s0 / SIM.DS))]) > W) ok = false; }
      if (ok) return { s0, sg };
    }
  }
  throw new Error('no straight on ' + t.name);
}
// drive 2 s from 200 km/h with `n` tyres on the paint (0, 2, 4) or all four on the grass, on a fixed pedal
function run(t, { n = 0, grass = false, throttle = 0, brake = 0, secs = 2, isPlayer = false }) {
  // On the circuit's own straight (its grade and road), with the tyre count held exactly: the surface each wheel
  // reads is forced (n wheels on the paint, or all four on the grass), so a real straight's slight curves and
  // changes of width cannot move a tyre on or off the paint during the run.
  const { s, c } = rig(t, isPlayer), st = straight(t);
  const fake = Object.create(t); let w = 0; fake.surfaceAt = () => grass ? 3 : (w++ % 4) < n ? 2 : 0;
  c.placeAt(t, st.s0 + 40, 0, 200 / 3.6); c.speed = c.u = 200 / 3.6; c.gear = 8;
  const h = new SIM.PlayerHandling(); const seen = new Set();
  for (let k = 0; k < secs / DT; k++) {
    h.step(c, DT, s, { steer: 0, throttle, brake, analog: true });
    SIM.stepCarPhysics(c, DT, fake, ENV);
    t.project(c.x, c.z, c.idx, c.proj); c.idx = c.proj.i; c.s = c.proj.s; c.d = c.proj.d;
    if (k > 50) seen.add(grass ? 't' + c.terrainN : c.runoffN);
  }
  return { v: c.speed * 3.6, seen: [...seen], c };
}
const HOLD = new Map();
function hold(t) {
  if (HOLD.has(t)) return HOLD.get(t);
  let lo = 0, hi = 1; for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (run(t, { throttle: mid }).v < 200) lo = mid; else hi = mid; }
  HOLD.set(t, (lo + hi) / 2); return HOLD.get(t);
}

test('the green paint keeps its grip loss per tyre and adds no resistance for one tyre, then more with each tyre', () => {
  assert.deepEqual(GR.loss, [0, 0.025, 0.065, 0.11, 0.18]);
  assert.equal(GR.drag[0], 0); assert.equal(GR.drag[1], 0, 'one tyre: no meaningful extra resistance');
  for (let n = 2; n <= 4; n++) assert.ok(GR.drag[n] > GR.drag[n - 1], 'progressive');
  // force exactly n tyres onto the paint (the per-wheel surface lookup is replaced), coasting at 200 km/h on a straight
  const t = tracks.get('monza'), st = straight(t), out = [];
  for (let n = 0; n <= 4; n++) {
    const { c } = rig(t), fake = Object.create(t); let w = 0;
    fake.surfaceAt = () => (w++ % 4) < n ? 2 : 0;
    c.placeAt(t, st.s0 + 40, 0, 200 / 3.6); c.speed = c.u = 200 / 3.6; c.gear = 8;
    for (let k = 0; k < 480; k++) { c.input.throttle = 0; c.input.brake = 0; c.input.steer = 0; SIM.stepCarPhysics(c, DT, fake, ENV); }
    out.push({ n, v: c.speed, grip: c.runoffGrip, drag: c.runoffDrag, count: c.runoffN });
  }
  for (const o of out) { assert.equal(o.count, o.n); assert.ok(Math.abs(o.grip - (1 - GR.loss[o.n])) < 1e-3, 'grip ' + o.n); assert.ok(Math.abs(o.drag - GR.drag[o.n]) < 1e-4, 'drag ' + o.n); }
  assert.ok(Math.abs(out[1].v - out[0].v) < 0.05, 'one tyre on the paint: no slowdown on a straight (' + (out[0].v - out[1].v).toFixed(3) + ' m/s)');
  for (let n = 2; n <= 4; n++) assert.ok(out[n].v < out[n - 1].v, n + ' tyres slower than ' + (n - 1));
});

for (const [id, t] of tracks) {
  test(id + ': 2 s at 200 km/h — paint costs a little, grass a lot; braking and cornering lose grip on the paint', () => {
    const th = hold(t);
    const asphalt = run(t, { throttle: th }), two = run(t, { n: 2, throttle: th }), four = run(t, { n: 4, throttle: th }), grass = run(t, { grass: true, throttle: th });
    assert.ok(Math.abs(asphalt.v - 200) < 0.5);
    assert.deepEqual(two.seen, [2]); assert.deepEqual(four.seen, [4]);
    assert.ok(four.v >= 185 && four.v <= 195, 'four tyres, held pedal: ' + four.v.toFixed(1) + ' km/h (target 185–195)');
    assert.ok(two.v > 196 && two.v < 200, 'two tyres: mild ' + two.v.toFixed(1));
    assert.ok(grass.v < 120, 'grass far more punishing: ' + grass.v.toFixed(1));
    // flat out and coasting keep the same order
    const fa = run(t, { throttle: 1 }), f4 = run(t, { n: 4, throttle: 1 }), ca = run(t, { throttle: 0 }), c4 = run(t, { n: 4, throttle: 0 });
    assert.ok(f4.v < fa.v - 4 && f4.v > fa.v - 16, 'flat out ' + fa.v.toFixed(1) + ' vs ' + f4.v.toFixed(1));
    assert.ok(c4.v < ca.v - 4 && c4.v > ca.v - 16, 'coasting ' + ca.v.toFixed(1) + ' vs ' + c4.v.toFixed(1));
    // braking: less grip means less deceleration
    const ba = run(t, { brake: 1, secs: 1 }), b4 = run(t, { n: 4, brake: 1, secs: 1 });
    assert.ok(b4.v > ba.v + 2, 'braking from 200 for 1 s: ' + ba.v.toFixed(1) + ' (asphalt) vs ' + b4.v.toFixed(1) + ' (paint)');
    // cornering: the yaw ceiling of the handling falls with the grip
    const yaw = (n) => { const { s, c } = rig(t), st = straight(t), h = new SIM.PlayerHandling(); const fake = Object.create(t); let w = 0; fake.surfaceAt = () => (w++ % 4) < n ? 2 : 0;
      c.placeAt(t, st.s0 + 40, 0, 40); c.speed = c.u = 40; let maxR = 0;
      for (let k = 0; k < 240; k++) { h.step(c, DT, s, { steer: 1, throttle: 0.4, brake: 0, analog: true }); SIM.stepCarPhysics(c, DT, fake, ENV); maxR = Math.max(maxR, Math.abs(c.r)); }
      return maxR; };
    assert.ok(yaw(4) < yaw(0), 'lower cornering grip on the paint');
  });
}

test('identical physics for the player and the AI on the paint', () => {
  const t = tracks.get('silverstone');
  const a = run(t, { n: 4, throttle: 0.6, isPlayer: true }), b = run(t, { n: 4, throttle: 0.6, isPlayer: false });
  assert.deepEqual([a.c.x, a.c.z, a.c.speed, a.c.runoffDrag, a.c.runoffGrip], [b.c.x, b.c.z, b.c.speed, b.c.runoffDrag, b.c.runoffGrip]);
});

test('the planner may use paint only where it is painted, never on the inside of a bend, the pit side of the pit route or the grass', () => {
  for (const [id, t] of tracks) {
    const L = t.aiLines, N = t.N; let used = 0;
    for (let i = 0; i < N; i++) for (const [k, sg] of [[0, -1], [1, 1]]) {
      if (!L.paint[k][i]) continue; used++;
      assert.ok(t.hasPaintedRunoff(i, sg), id + ' painted');
      assert.ok(t.kappa[i] * sg <= 1 / 900, id + ': not on the inside of a bend at ' + i);
      // the furthest a path may go (planning limit + the avoidance allowance, 3.6 m) keeps the outer tyres on the paint
      assert.ok(t.surfaceAt(i, sg * (L.limA[i] + 3.6 + SIM.SPEC.tw)) <= 2, id + ' outer tyre still on paint at ' + i);
    }
    assert.ok(used > 0.5 * N, id + ': paint usable along most of the lap (' + used + ' of ' + 2 * N + ' samples)');
    // a candidate path is clamped to the asphalt unless it is allowed onto the paint
    const s = new SIM.Session(t, { type: 'race', seed: 3, weather: 'dry', entries: SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })) });
    const ai = s.cars[1].ai, c = ai.addCand('line', 'test'); ai.exeNow = { v: 0, a: 0, b: 0, c: 0 };
    c.off = 50; c.offA = 0; c.offL = 1;
    const i = L.paint[1].findIndex(x => x), j = L.paint[1].findIndex(x => !x);
    assert.ok(Math.abs(ai.candD(c, 10, i) - L.limA[i]) < 1e-9, 'no allowance: asphalt only');
    c.ext = 2; assert.ok(Math.abs(ai.candD(c, 10, i) - (L.limA[i] + 2)) < 1e-9, 'allowance on painted samples');
    assert.ok(Math.abs(ai.candD(c, 10, j) - L.limA[j]) < 1e-9, 'none where there is no usable paint');
  }
});

test('20-car races: the AI uses the paint sometimes, on purpose, briefly; rarely the grass; races still classify', () => {
  // planned paint use is rare (a few tenths of a second to a few seconds in a 20-car, two-lap race, sometimes none
  // on Summit), so it is asserted over both races together
  let plannedAll = 0; const whyAll = {};
  for (const [id, seed] of [['monza', 31], ['bahrain', 32]]) {
    const t = tracks.get(id);
    const s = new SIM.Session(t, { type: 'race', seed, weather: 'dry', tyreWear: 'normal', damage: 'realistic', difficulty: 1, entries: SIM.DRIVERS.map(driver => ({ driver })) });
    s.totalLaps = 2;
    let carT = 0, paintT = 0, planned = 0, grass = 0; const why = {};
    while (!s.over && s.time < 2 * 200 + 300) {
      s.fixedStep(DT);
      if (!s.lightsOut || s.step % 4) continue;
      for (const c of s.cars) {
        if (c.dnf || c.finished || c.pit) continue;
        carT += DT * 4; if (c.terrainN) grass += DT * 4;
        if (c.runoffN && !c.terrainN) {
          paintT += DT * 4;
          const P = c.ai.path, meant = P.valid && P.ext > 0 && Math.abs(c.ai.pathD(c.idx)) > t.hw[c.idx] - 1.6;
          if (meant) { planned += DT * 4; why[P.label] = (why[P.label] || 0) + 1; }
        }
      }
    }
    assert.ok(s.over, id + ' classified');
    plannedAll += planned; whyAll[id] = why;
    assert.ok(paintT / carT < 0.12, id + ': paint is not the racing line (' + (100 * paintT / carT).toFixed(1) + '% of the time)');
    assert.ok(grass / carT < 0.01, id + ': grass and gravel stay rare (' + (100 * grass / carT).toFixed(2) + '%)');
  }
  assert.ok(plannedAll > 0, 'some paint use is planned: ' + JSON.stringify(whyAll));
});
