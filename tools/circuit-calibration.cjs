#!/usr/bin/env node
// Per-circuit constants, measured with the real handling, physics and AI (one car alone, dry, no mistakes, tyre wear
// off unless stated). Prints the values each circuit definition carries:
//   pitLoss      s a clean tyre-only stop costs against staying out: paired four-lap runs, the same seed with and
//                without a stop on lap 2, with 8 laps of fuel on board (as tests/pitstops.cjs measures it), over seeds
//   fuelPerLap   kg burnt per lap at race pace (flying laps with consumption on)
//   fuelLapCost  s per kg per lap: flying laps at 23 kg against 9 kg (held constant)
//   tyrePace     s (per 6 km) the strategy pace model scales by: least-squares fit of the lap-time change on fresh and
//                worn Soft and Hard tyres to the model's pace(grip) curve (SIM.defaultCompoundModel)
//
//   node tools/circuit-calibration.cjs [--circuits=monza,spa] [--seeds=11,12,13,14]
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const circuits = arg('circuits', S.CIRCUITS.map(c => c.id).join()).split(',');
const seeds = arg('seeds', '11,12,13,14').split(',').map(Number);
const DRY = (seed) => Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function solo(t, { seed = 11, laps = 4, stop = false, fuel = null, hold = false, compound = null, wear = 0, tyreWear = 'off', burn = true } = {}) {
  const s = new S.Session(t, { type: 'race', laps, entries: [{ driver: S.DRIVERS[0] }], seed, spectate: true, weather: 'dynamic', tyreWear, mistakes: 0, mandatory: false, weatherState: DRY(3) });
  s.totalLaps = laps; s.mandatory = false; const car = s.cars[0];
  const f = fuel != null ? fuel : s.fuelForLaps(8); car.fuel = f;
  if (compound) { s.fitTyres(car, compound, 90); car.tyre.wear.fill(wear); }
  if (!stop) s.pitsEnabled = stop;
  let P = null;
  while (!s.over && s.time < 220 * laps) {
    if (hold) car.fuel = f;
    if (compound && tyreWear === 'off') car.tyre.wear.fill(wear);
    s.fixedStep(DT);
    if (stop && car.laps === 1 && !car.pitStops && !car.pit) { car.ai.boxThisLap = true; car.boxCompound = car.tyre.c; }
    if (car.pit && car.pit.phase === 'stopped') P = car.pit;
  }
  void burn;
  return { time: car.finishTime, laps: car.lapTimes.map(l => l.t), car, s, P };
}
const out = {};
for (const id of circuits) {
  const t = new S.Track(S.circuitById(id)), r = {};
  // pit loss
  const losses = seeds.map(seed => { const a = solo(t, { seed }), b = solo(t, { seed, stop: true }); if (!b.P || !b.P.changeTyres) throw new Error(id + ': no stop'); return b.time - a.time; });
  r.pitLoss = +mean(losses).toFixed(1); r.pitLossRuns = losses.map(x => +x.toFixed(2));
  // race-pace consumption: fuel burnt over flying laps 2..4
  { const a = solo(t, { laps: 4, fuel: 20 }), L = a.car; r.fuelPerLap = +((20 - L.fuel) / 4).toFixed(2); }
  // fuel-weight lap cost
  { const fl = (kg) => mean(solo(t, { laps: 3, fuel: kg, hold: true }).laps.slice(1)); const h = fl(23), l = fl(9); r.fuelLapCost = +((h - l) / 14).toFixed(3); r.fuelLap = [+l.toFixed(2), +h.toFixed(2)]; }
  // tyre grip sensitivity: lap time on four tyre states against the model's pace curve
  {
    const model = S.defaultCompoundModel({ def: { tyrePace: 1 } }), states = [['S', 0], ['H', 0], ['S', 0.5], ['H', 0.5], ['S', 0.75]];
    const pts = states.map(([c, w]) => ({ c, w, lap: mean(solo(t, { laps: 3, fuel: 12, hold: true, compound: c, wear: w }).laps.slice(1)), x: model.pace(S.tyreWeatherGrip(c, 0) * S.tyreWearGrip(w)) }));
    const x0 = pts[0].x, y0 = pts[0].lap; let num = 0, den = 0;
    for (const p of pts.slice(1)) { const dx = (p.x - x0) * t.length / 6000, dy = p.lap - y0; num += dx * dy; den += dx * dx; }
    r.tyrePace = +(num / den).toFixed(1); r.tyreLaps = pts.map(p => p.c + Math.round(p.w * 100) + ':' + p.lap.toFixed(2));
  }
  out[id] = r; console.error(id, JSON.stringify(r));
}
console.log(JSON.stringify(out));
