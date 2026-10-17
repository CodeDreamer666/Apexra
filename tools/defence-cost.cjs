#!/usr/bin/env node
// What a passive follower costs the car ahead: the leader's flying laps alone against the same laps with a car held
// 15 m behind it on its own line at its own speed (it never attacks). A driver that defends only a real threat loses
// little; one that defends against any car close behind loses a lot.
//
//   node tools/defence-cost.cjs [--circuits=monza,spa] [--levels=1,1.25,1.5] [--gap=15]
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const S = m.exports, DT = S.PHYS_DT;
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const circuits = arg('circuits', S.CIRCUITS.map(c => c.id).join()).split(',');
const levels = arg('levels', '1,1.25,1.5').split(',').map(Number), GAP = +arg('gap', 15);
const DRY = (seed) => Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
function laps(t, level, follower) {
  const entries = follower ? [{ driver: S.DRIVERS[0] }, { driver: S.DRIVERS[1] }] : [{ driver: S.DRIVERS[0] }];
  const cfg = { type: 'race', laps: 4, entries, seed: 3, spectate: true, weather: 'dynamic', weatherState: DRY(3), tyreWear: 'off', mistakes: 0, mandatory: false };
  if (level > 1) cfg.aiLevel = level; else cfg.difficulty = level;
  const s = new S.Session(t, cfg); s.totalLaps = 4; s.pitsEnabled = false;
  const lead = s.cars[0], f = s.cars[1], fuel = s.fuelForLaps(3); lead.fuel = fuel; if (f) f.fuel = fuel;
  let defend = 0, n = 0;
  while (!s.over && s.time < 600) {
    lead.fuel = fuel;
    s.fixedStep(DT);
    if (f && s.lightsOut && lead.laps >= 1) {
      // the passive follower: GAP metres behind on the leader's line, at the leader's speed and heading
      const sB = t.wrapS(lead.s - GAP), [x, z] = t.pointAt(sB, lead.d);
      f.x = x; f.z = z; f.psi = lead.psi; f.vx = lead.vx; f.vz = lead.vz; f.r = 0; f.speed = lead.speed; f.u = lead.u;
      t.project(f.x, f.z, f.idx, f.proj); f.idx = f.proj.i; f.s = f.proj.s; f.d = f.proj.d; f.totalDist = lead.totalDist - GAP;
      n++; if (lead.ai.state === 'defend') defend++;
    }
  }
  const L = lead.lapTimes.map(l => l.t).slice(1);
  return { mean: L.reduce((a, b) => a + b, 0) / L.length, defendShare: n ? defend / n : 0 };
}
for (const id of circuits) {
  const t = new S.Track(S.circuitById(id));
  for (const L of levels) {
    const a = laps(t, L, false), b = laps(t, L, true);
    console.log(JSON.stringify({ circuit: id, level: L, alone: +a.mean.toFixed(3), followed: +b.mean.toFixed(3), costPerLap: +(b.mean - a.mean).toFixed(3), defendingShare: +b.defendShare.toFixed(2) }));
  }
}
