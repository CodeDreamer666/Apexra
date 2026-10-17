#!/usr/bin/env node
// Full-field racing benchmark: 20-car races with matched seeds, measuring how actively the field races.
//
//   node tools/field-benchmark.cjs [--circuits=monza,spa] [--levels=1,1.25,1.5] [--seeds=1,2] [--laps=3] [--json]
//   SIM_HTML=/path/to/other/index.html node tools/field-benchmark.cjs ...   (compare another version on equal terms)
//
// Per race: genuine on-track overtakes (the session's count: no pit stops, retirements, spun or crawling cars),
// attack attempts / completed / called off, time spent following closely (within 1.0 s of the car ahead, outside the
// pit lane), side by side (overlapping, under 4 m apart), defending, contacts, spins, damage, retirements and the
// simulation cost per step. Weather is dry and fixed, so the field is compared on equal terms.
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const circuits = arg('circuits', S.CIRCUITS.map(c => c.id).join()).split(',');
const levels = arg('levels', '1,1.25,1.5').split(',').map(Number);
const seeds = arg('seeds', '1').split(',').map(Number);
const laps = +arg('laps', 3);
const dry = (seed) => Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const tracks = new Map();
function race(id, level, seed) {
  const t = tracks.get(id) || tracks.set(id, new S.Track(S.circuitById(id))).get(id);
  S.setSeed(seed);
  const cfg = { type: 'race', laps, entries: S.DRIVERS.map(driver => ({ driver })), seed, spectate: true, weather: 'dynamic', weatherState: dry(seed), damage: 'realistic' };
  if (level > 1) cfg.aiLevel = level; else cfg.difficulty = level;
  const s = new S.Session(t, cfg); s.totalLaps = laps;
  const acc = { follow: 0, side: 0, defend: 0, carT: 0, steps: 0, ms: 0, damage: 0 };
  let k = 0;
  while (!s.over && s.time < laps * 170 + 120) {
    const t0 = process.hrtime.bigint(); s.fixedStep(DT); acc.ms += Number(process.hrtime.bigint() - t0) / 1e6; acc.steps++;
    if (++k % 24 || !s.lightsOut || s.time - s.lightsOutTime < 5) continue;
    const order = s.order || s.cars, dt = 24 * DT;
    for (let q = 0; q < order.length; q++) {
      const c = order[q]; if (c.dnf || c.finished || c.pit || c.inGarage) continue;
      acc.carT += dt;
      if (q > 0 && c.intervalAhead < 1.0 && !order[q - 1].pit) acc.follow += dt;
      if (c.ai && c.ai.state === 'defend') acc.defend += dt;
      for (const o of order) if (o !== c && !o.dnf && !o.pit && Math.abs(t.dS(c.s, o.s)) < 5 && Math.abs(o.d - c.d) < 4 && !t.levelApart(c.idx, o.idx)) { acc.side += dt / 2; break; }
    }
  }
  const ai = s.cars.map(c => c.ai ? c.ai.stats : { attempts: 0, passes: 0, aborts: 0 });
  const sum = (f) => ai.reduce((a, b) => a + (b[f] || 0), 0);
  for (const c of s.cars) acc.damage += c.damage.severity ? c.damage.severity() : 0;
  const winner = s.results && s.results[0];
  return { circuit: id, level, seed, over: s.over, overtakes: s.stats.overtakes, attempts: sum('attempts'), completed: sum('passes'), aborted: sum('aborts'), switchbacks: sum('switchbacks'),
    followPct: +(100 * acc.follow / acc.carT).toFixed(1), sideBySidePct: +(100 * acc.side / acc.carT).toFixed(2), defendPct: +(100 * acc.defend / acc.carT).toFixed(1),
    contacts: s.stats.collisions, spins: s.stats.spins, mistakes: s.stats.mistakes, damage: +acc.damage.toFixed(2), retirements: s.cars.filter(c => c.dnf).length,
    dnfReasons: s.cars.filter(c => c.dnf).map(c => c.dnfReason), winnerBest: winner ? +(winner.car.bestLap || 0).toFixed(3) : null, msPerStep: +(acc.ms / acc.steps).toFixed(3) };
}
const out = [];
for (const id of circuits) for (const L of levels) for (const seed of seeds) {
  const r = race(id, L, seed); out.push(r);
  if (!process.argv.includes('--json')) console.log(JSON.stringify(r));
}
if (process.argv.includes('--json')) console.log(JSON.stringify(out));
