#!/usr/bin/env node
// How the AI uses green paint, measured in headless 20-car races (development tool, slow).
//   node tools/runoff-ai.cjs [laps]      CIRCUITS=… SEEDS=… JOBS=… SIM_HTML=path (compare another build)
// Per race: time with 1–2 and 3–4 tyres on the paint (planned by the chosen path or not), time on grass/gravel,
// what the path was doing while on paint, overtakes, contacts, mistakes, median lap and winner's time.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fork } = require('node:child_process');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
function loadSim() { const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m); return m.exports; }
function race({ circuit, seed, laps, level }) {
  const S = loadSim(), t = new S.Track(S.circuitById(circuit));
  const w = Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
  const s = new S.Session(t, { type: 'race', seed, aiLevel: level, weather: 'dynamic', weatherState: w, tyreWear: 'normal', damage: 'realistic', entries: S.DRIVERS.map(driver => ({ driver })) });
  s.totalLaps = laps;
  const out = { p12: 0, p34: 0, planned: 0, terrain: 0, why: {}, carTime: 0 };
  while (!s.over && s.time < laps * 200 + 300) {
    s.fixedStep(S.PHYS_DT);
    if (!s.lightsOut || s.step % 4) continue;
    const dt = S.PHYS_DT * 4;
    for (const c of s.cars) {
      if (c.dnf || c.finished || c.pit || !c.ai) continue;
      out.carTime += dt;
      if (c.terrainN > 0) out.terrain += dt;
      if (c.runoffN > 0 && c.terrainN === 0) {
        if (c.runoffN >= 3) out.p34 += dt; else out.p12 += dt;
        const P = c.ai.path, meant = P.valid && P.ext > 0 && Math.abs(c.ai.pathD(c.idx)) > t.hw[c.idx] - 1.6;
        if (meant) out.planned += dt;
        const k = c.ai.mistake && c.ai.mistakeT > 0 ? 'mistake:' + c.ai.mistake.type : meant ? P.label.replace(/ [A-Z].*$/, '').replace(/ (left|right)$/, '') : c.ai.mode === 'recover' ? 'recovering' : 'unplanned';
        out.why[k] = (out.why[k] || 0) + dt;
      }
    }
  }
  const laps2 = s.cars.flatMap(c => c.lapTimes.slice(1).filter(l => l.valid).map(l => l.t)).sort((a, b) => a - b);
  return { ...out, over: s.over, overtakes: s.stats.overtakes, collisions: s.stats.collisions, mistakes: s.stats.mistakes, dnf: s.cars.filter(c => c.dnf).length,
    median: laps2[laps2.length >> 1] || null, winner: s.results ? s.results[0].time : null };
}
if (process.argv[2] === '--worker') { process.on('message', (job) => process.send({ job, out: race(job) })); return; }
const env = process.env, laps = +process.argv[2] || 3;
const jobs = [];
for (const circuit of (env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',')) for (const seed of (env.SEEDS || '31,32').split(',').map(Number)) jobs.push({ circuit, seed, laps, level: +(env.LEVEL || 1) });
const n = Math.min(+env.JOBS || os.cpus().length, jobs.length), res = [];
let next = 0, done = 0;
for (let k = 0; k < n; k++) {
  const ch = fork(__filename, ['--worker']);
  const feed = () => { if (next < jobs.length) ch.send(jobs[next++]); else ch.kill(); };
  ch.on('message', (m) => { res.push(m); feed(); if (++done === jobs.length) report(); });
  feed();
}
function report() {
  const pct = (a, b) => (100 * a / b).toFixed(2) + '%';
  console.log('circuit    seed  paint 1-2 tyres  3-4 tyres  planned  grass/gravel  overtakes  contacts  mistakes  DNF  median lap  winner');
  const why = {};
  for (const { job, out } of res.sort((a, b) => (a.job.circuit + a.job.seed).localeCompare(b.job.circuit + b.job.seed))) {
    console.log(job.circuit.padEnd(10) + ' ' + String(job.seed).padStart(4) + '  ' + pct(out.p12, out.carTime).padStart(15) + '  ' + pct(out.p34, out.carTime).padStart(9) + '  ' + pct(out.planned, out.p12 + out.p34 || 1).padStart(7)
      + '  ' + pct(out.terrain, out.carTime).padStart(12) + '  ' + String(out.overtakes).padStart(9) + '  ' + String(out.collisions).padStart(8) + '  ' + String(out.mistakes).padStart(8) + '  ' + String(out.dnf).padStart(3)
      + '  ' + (out.median ? out.median.toFixed(3) : '—').padStart(10) + '  ' + (out.winner ? out.winner.toFixed(2) : '—'));
    for (const [k, v] of Object.entries(out.why)) why[k] = (why[k] || 0) + v;
  }
  const tot = Object.values(why).reduce((a, b) => a + b, 0) || 1;
  console.log('time on paint by what the car was doing: ' + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + (100 * v / tot).toFixed(0) + '%').join(', '));
}
