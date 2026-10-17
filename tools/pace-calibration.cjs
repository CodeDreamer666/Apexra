#!/usr/bin/env node
// Career pace calibration: measures, with the real handling, physics and AI, the lap times the Career pace score
// (SIM.PROGRESS.paceScore, 0..50) is built on, for every circuit and track wetness.
//
//   node tools/pace-calibration.cjs [--circuits=monza,spa] [--water=0,0.3,0.6,0.9] [--levels=master,pro,rookie,slow] [--seeds=1,2,3,4]
//
// One car alone on the circuit, standing start from pole, four laps, fresh tyres of the quickest compound for the
// conditions (no wear), a fixed mid-race fuel load (3.5 laps' worth, held), no pit stops, the driver's own mistakes left in. Track water is
// held constant. The reference's opening lap is driven without the AI's lap-1 traffic caution (a car alone has no
// traffic, and the allowance is for the standing start alone: the time it costs to get the car moving from the grid
// against a flying lap). Reported per circuit and wetness: the median flying lap (laps 2-4) of each level, the standing
// start's extra time on lap 1 (timed from the line, against the flying laps), and the ratios to the Master lap that
// become the score's anchors: Master 50, Pro 38, Rookie 26, the Grand Prix slider at 0% 12 (and 0 below it).
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const circuits = arg('circuits', S.CIRCUITS.map(c => c.id).join()).split(',');
const waters = arg('water', '0,0.3,0.6,0.9').split(',').map(Number);
const LEVELS = { master: { aiLevel: 1.5 }, pro: { aiLevel: 1.25 }, rookie: { difficulty: 1 }, slow: { difficulty: 0 } };
const levels = arg('levels', 'master,pro,rookie,slow').split(',');
const seeds = arg('seeds', '1,2,3,4').split(',').map(Number);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
function run(t, level, water, seed) {
  const ws = Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: water > 0 ? 'wet' : 'dry', regime: water > 0 ? 'rain' : 'sunny', rain: water > 0 ? 0.5 : 0, water, lineWater: water, cloud: water > 0 ? 1 : 0.2, targetCloud: water > 0 ? 1 : 0.2, targetRain: water > 0 ? 0.5 : 0, patternEnds: 1e9, regimeEnds: 1e9 });
  // the quickest compound for the conditions (Soft in the dry, Intermediate in damp to wet, Full Wet in heavy rain)
  const comp = Object.keys(S.COMPOUNDS).reduce((a, c) => S.tyreWeatherGrip(c, water) > S.tyreWeatherGrip(a, water) ? c : a, 'S');
  const sess = new S.Session(t, Object.assign({ type: 'race', laps: 4, entries: [{ driver: S.DRIVERS[0] }], seed, spectate: true, weather: 'dynamic', weatherState: ws, startCompound: comp, damage: 'realistic', tyreWear: 'off' }, LEVELS[level]));
  sess.totalLaps = 4; sess.lap1Caution = () => false;
  const car = sess.cars[0], fuel = sess.fuelPerLap * 3.5; car.fuel = fuel; sess.pitsEnabled = false; sess.fitTyres(car, comp, 90);
  const hold = () => { car.fuel = fuel; const w = sess.weather; if (w) { w.water = water; w.lineWater = water; w.rain = water > 0 ? 0.5 : 0; } sess.wet = water; };
  while (!sess.over && sess.time < 900) { hold(); sess.fixedStep(DT); if (car.pit) throw new Error(t.def.id + ': unexpected pit stop'); }
  const L = car.paceLaps || [];
  return { first: L[0] && L[0].t, flying: L.slice(1).map(l => l.t), compound: car.tyre.c };
}
const out = {};
for (const id of circuits) {
  const t = new S.Track(S.circuitById(id)); out[id] = {};
  for (const w of waters) {
    const row = {};
    for (const lv of levels) {
      const fl = [], firsts = [];
      for (const seed of seeds) { const r = run(t, lv, w, seed); fl.push(...r.flying); if (r.first) firsts.push(r.first - median(r.flying)); }
      row[lv] = { lap: +median(fl).toFixed(3), launch: +median(firsts).toFixed(3), laps: fl.map(x => +x.toFixed(2)) };
    }
    if (row.master) for (const lv of levels) row[lv].ratio = +(row[lv].lap / row.master.lap).toFixed(4);
    out[id][w] = row;
    console.error(id, 'water', w, JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, [v.lap, v.ratio, v.launch]]))));
  }
}
console.log(JSON.stringify(out));
