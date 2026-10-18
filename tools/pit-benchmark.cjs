#!/usr/bin/env node
// Pit-stop time loss per circuit, measured with the real handling, physics and pit autopilot (one AI car alone, dry,
// no mistakes, tyre wear off). Two runs per seed on the same seed: one staying out, one stopping on lap 2 for a fresh
// set of the same compound with no fuel and no repairs. Reported per circuit (means over the seeds):
//   main      s from the pit-entry point to the pit-exit point on the circuit (the run that stays out)
//   lane      s over the same stretch through the pit lane, including the stop
//   service   s stationary for the service (tyres only)
//   driving   lane - service - main: what the pit-lane route itself costs (slowing, the limit, stopping, leaving)
//   total     finish-time difference of the two runs: the whole tyre-only stop
//   node tools/pit-benchmark.cjs [--circuits=monza,spa] [--seeds=11,12] [--fuel=2] [--repair]
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const circuits = arg('circuits', S.CIRCUITS.map(c => c.id).join()).split(',');
const seeds = arg('seeds', '11,12').split(',').map(Number);
// cars whose team boxes are measured (first, middle and last box by default); the means are over cars and seeds
const drivers = arg('drivers', '0,10,19').split(',').map(Number);
const DRY = (seed) => Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function run(t, seed, stop, lapAt = 1, di = 0) {
  const s = new S.Session(t, { type: 'race', laps: 3, entries: [{ driver: S.DRIVERS[di] }], seed, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, weatherState: DRY(3) });
  s.totalLaps = 3; const car = s.cars[0]; car.fuel = s.fuelForLaps(5);
  if (!stop) s.pitsEnabled = false;
  const p = t.pit, L = t.length;
  // the stretch from the entry point to the exit point, as race distance, on the lap the stop is made
  let a = lapAt * L + t.wrapS(p.entry0), b = a + p.len, entryLap = null;
  let ta = null, tb = null, service = 0, P = null, prev = car.totalDist;
  while (!s.over && s.time < 600) {
    s.fixedStep(DT);
    if (stop && car.laps === 1 && !car.pitStops && !car.pit) { car.ai.boxThisLap = true; car.boxCompound = car.tyre.c; }
    if (stop && car.pit && entryLap == null) { entryLap = car.laps; a = entryLap * L + t.wrapS(p.entry0); b = a + p.len; }
    const d = car.totalDist;
    if (ta == null && prev < a && d >= a) ta = s.time - DT * (d - a) / Math.max(1e-6, d - prev);
    if (tb == null && prev < b && d >= b) tb = s.time - DT * (d - b) / Math.max(1e-6, d - prev);
    if (car.pit && car.pit.phase === 'stopped') { service += DT; P = car.pit; }
    prev = d;
  }
  return { finish: car.finishTime, span: tb - ta, service, P, car, entryLap };
}
const rows = [];
for (const id of circuits) {
  const t = new S.Track(S.circuitById(id)), r = [];
  for (const seed of seeds) for (const di of drivers) {
    const b = run(t, seed, true, 1, di), a = run(t, seed, false, b.entryLap, di);
    if (!b.P) throw new Error(id + ': no stop');
    r.push({ main: a.span, lane: b.span, service: b.service, driving: b.span - b.service - a.span, total: b.finish - a.finish });
  }
  const row = { circuit: id }; for (const k of ['main', 'lane', 'service', 'driving', 'total']) row[k] = +mean(r.map(x => x[k])).toFixed(2);
  row.laneLength = +t.pit.len.toFixed(0); rows.push(row);
  console.error(JSON.stringify(row));
}
console.table(rows);
