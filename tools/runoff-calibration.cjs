#!/usr/bin/env node
// Green painted run-off: what it costs, measured with the real physics and handling (player and AI are the same car).
// On a straight with paint on one side, a car at 200 km/h runs for 2 s with 0–4 tyres on the green (and, for the
// surface hierarchy, with all four on grass), coasting and flat out; plus braking from 200 km/h and the steady
// cornering speed on a constant steering input.   node tools/runoff-calibration.cjs [summit,rivermere,redridge]
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const circuits = (process.argv[2] || 'summit,rivermere,redridge').split(',');
// a straight, level stretch of at least 400 m with green paint on side `sg` (away from the pit lane)
function straight(t) {
  const sg = -t.pit.side;
  for (let s0 = 300; s0 < t.length; s0 += 20) {
    let ok = true;
    for (let s = s0; s < s0 + 400 && ok; s += 4) { const i = t.wrapI(Math.round(s / S.DS)); if (Math.abs(t.kappa[i]) > 1 / 3000 || Math.abs(t.grade[i]) > 0.01 || !t.hasPaintedRunoff(i, sg) || t.pitProg(s) >= 0) ok = false; }
    if (ok) return { s0, sg };
  }
  throw new Error('no straight');
}
function rig(t) {
  const s = new S.Session(t, { type: 'calib', seed: 1, weather: 'dry', damage: 'realistic', tyreWear: 'off', entries: [{ driver: S.DRIVERS[0] }] });
  const c = s.cars[0]; s.fitTyres(c, 'S', 95); c.fuel = 10; return { s, c };
}
// lateral offset that puts `n` tyres (the outer side first) on the paint, or all four on grass
function offsetFor(t, n, grass) {
  const hw = t.halfW, tw = S.SPEC.tw, lim = hw + 0.2; // a tyre is off once wholly past the white line (+ tyre half-width)
  if (grass) return hw + S.GREEN_RUNOFF.width + tw + 1.5;
  if (n === 0) return hw - tw - 0.6;
  if (n === 2) return lim + 0.3;                       // outer pair just past the line, inner pair still in
  if (n === 4) return lim + tw + 0.4;
  return null;
}
function run(t, st, { n, grass, throttle, brake, secs = 2, v0 = 200 / 3.6 }) {
  const { s, c } = rig(t), d = st.sg * offsetFor(t, n, grass);
  c.placeAt(t, st.s0 + 40, d, v0); c.speed = c.u = v0; c.gear = 8;
  const h = new S.PlayerHandling(); let count = [0, 0, 0, 0, 0];
  for (let k = 0; k < secs / DT; k++) {
    h.step(c, DT, s, { steer: 0, throttle, brake, analog: true });
    S.stepCarPhysics(c, DT, t, { wet: 0, wearScale: 0, fuelRate: 0, trackTemp: 36, pitLimiter: false });
    t.project(c.x, c.z, c.idx, c.proj); c.idx = c.proj.i; c.s = c.proj.s; c.d = c.proj.d;
    count[c.runoffN]++;
  }
  const mode = count.indexOf(Math.max(...count));
  return { v: c.speed * 3.6, runoffN: mode, terrainN: c.terrainN, grip: c.runoffGrip, drag: c.runoffDrag };
}
for (const id of circuits) {
  const t = new S.Track(S.circuitById(id)), st = straight(t);
  console.log('\n' + id + ' (straight from ' + st.s0 + ' m, paint on the ' + (st.sg > 0 ? '+' : '−') + 'd side)');
  // the throttle that holds 200 km/h on the asphalt (found once), then the same pedal on each surface
  let lo = 0, hi = 1; for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (run(t, st, { n: 0, throttle: mid, brake: 0 }).v < 200) lo = mid; else hi = mid; }
  const hold = (lo + hi) / 2;
  console.log('surface            tyres  hold 200 (2 s)  coast 2 s  flat out 2 s  brake 1 s   grip   drag 1/s     (hold throttle ' + hold.toFixed(3) + ')');
  const rows = [['asphalt', { n: 0 }], ['green, 2 tyres', { n: 2 }], ['green, 4 tyres', { n: 4 }], ['grass, 4 tyres', { grass: true, n: 0 }]];
  for (const [name, cfg] of rows) {
    const a = run(t, st, { ...cfg, throttle: 0, brake: 0 }), b = run(t, st, { ...cfg, throttle: 1, brake: 0 }), c = run(t, st, { ...cfg, throttle: 0, brake: 1, secs: 1 }), hd = run(t, st, { ...cfg, throttle: hold, brake: 0 });
    console.log(name.padEnd(17) + '  ' + String(cfg.grass ? 'T' + a.terrainN : a.runoffN).padStart(5) + '  ' + hd.v.toFixed(1).padStart(14) + '  ' + a.v.toFixed(1).padStart(9) + '  ' + b.v.toFixed(1).padStart(12) + '  ' + c.v.toFixed(1).padStart(9) + '  ' + a.grip.toFixed(3) + '  ' + a.drag.toFixed(4));
  }
}
