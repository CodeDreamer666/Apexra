// AI difficulty benchmark (slow; not part of the quick test run). It measures, with the real Session, AIDriver,
// RaceStrategy and physics running headless, how the AI drives at each rank level (Rookie 100%, Pro 125%, Master
// 150%: the Career ranks) compared with the difficulty-100 baseline. Nothing here changes the
// game; the numbers come from simulated laps and races.
//
//   node tests/career-ai.cjs pace   solo laps: lap time, lap-to-lap spread, mistakes, time off the track, braking
//   node tests/career-ai.cjs duel   two identical cars, a baseline one ahead and a level one behind (and the reverse)
//   node tests/career-ai.cjs race   4-lap dry races: four baseline "reference" cars against sixteen level cars
//   node tests/career-ai.cjs wet    4-lap races with a rain front arriving early: tyre calls and reference cars
//   node tests/career-ai.cjs career  Career ranks: 6-lap races on all six circuits with the field at each rank, three
//                                    stand-in "players" (AI at Rookie, Pro and Master skill, random grid slots) scored
//                                    by the Career rules (position + best-lap rank points), against the thresholds
//   node tests/career-ai.cjs all
// Options: LEVELS=1,1.25,1.5 CIRCUITS=monza,... SEEDS=901,902 JOBS=4 (environment variables)
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');

const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
// (a plain function, not vm.runInNewContext: a separate context runs the simulation about five times slower)
function loadSim() { const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m); return m.exports; }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) : 0; };
const REF = ['C1', 'D1', 'H1', 'J2']; // four baseline drivers spread over the grid (one shared driver profile)

function weather(S, seed, wet) {
  const w = Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0,
    cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
  // a front arrives about a minute in and stays for the race
  if (wet) Object.assign(w, { cloud: 0.55, targetCloud: 0.6, patternEnds: 60, regimeEnds: 1e9 });
  return w;
}

/* ---- jobs (run in workers) ---- */
const JOBS = {
  // one car alone: its driving, nothing else (no tyre wear, fixed fuel)
  pace({ circuit, level, driver, seed, laps }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit));
    const s = new S.Session(t, { type: 'race', seed, aiLevel: level, weather: 'dynamic', weatherState: weather(S, seed),
      tyreWear: 'off', mandatory: false, damage: 'realistic', entries: [{ driver: S.DRIVERS[driver] }] });
    s.totalLaps = laps; const c = s.cars[0]; c.fuel = s.fuelForLaps(laps + 1);
    let off = 0, brakeOn = false, brakeStarts = [], maxDecel = 0, prevV = 0, maxYaw = 0;
    while (!s.over && s.time < laps * 160 + 60) {
      s.fixedStep(S.PHYS_DT); if (c.offN >= 2) off += S.PHYS_DT;
      // braking consistency: where (lap distance) each braking zone starts, from lap 2 on
      if (c.laps >= 1) { const b = c.input.brake > 0.5; if (b && !brakeOn) brakeStarts.push([c.laps, s.track.wrapS(c.totalDist)]); brakeOn = b; }
      // physical sanity: deceleration and yaw rate never exceed what the shared handling allows
      if (s.lightsOut) { maxDecel = Math.max(maxDecel, (prevV - c.speed) / S.PHYS_DT); maxYaw = Math.max(maxYaw, Math.abs(c.r)); }
      prevV = c.speed;
    }
    // spread of the braking point for each braking zone met on every lap (m)
    const zones = new Map();
    for (const [lap, x] of brakeStarts) { const k = Math.round(x / 40); if (!zones.has(k)) zones.set(k, []); zones.get(k).push(x); }
    const spreads = [...zones.values()].filter(v => v.length >= laps - 2).map(v => sd(v));
    return { laps: c.lapTimes.slice(1).map(l => l.t), mistakes: c.mistakes || 0, off, finished: c.finished, brakeSd: mean(spreads), maxDecel, maxYaw };
  },
  // two identical cars (same ratings), one baseline and one at the tier, 30 m apart at speed; who is ahead after 1.5 laps
  duel({ circuit, level, start, tierBehind }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit)), d = S.DRIVERS[8];
    const twin = { ...d, name: 'Twin', short: 'Twin', num: 99, team: 9 };
    const entries = tierBehind ? [{ driver: d, aiSkill: 0 }, { driver: twin }] : [{ driver: d }, { driver: twin, aiSkill: 0 }];
    const s = new S.Session(t, { type: 'race', seed: 5 + start, aiLevel: level, weather: 'dynamic', weatherState: weather(S, 5),
      tyreWear: 'off', mandatory: false, damage: 'realistic', entries });
    s.lightsOut = true; s.time = 50; s.lightsOutTime = 0; s.totalLaps = 3; // the duel ends before the flag; no fuel stop is due
    const [front, back] = s.cars, L = t.length, s0 = t.wrapS(start * L / 6 + 200);
    for (const [c, ds] of [[front, 30], [back, 0]]) {
      c.placeAt(t, t.wrapS(s0 + ds), 0, 50); c.speed = c.u = 50; c.launch.active = false; c.launch.engagement = 1;
      c.totalDist = L + s0 + ds; c.laps = 1; c.crossings = 2; c.lastLapBase = 1; c.lastWithin = t.wrapS(s0 + ds); c.started = true; c.fuel = s.fuelForLaps(3);
    }
    const tierCar = tierBehind ? back : front; let passedAt = null, lead = [];
    const T = 1.5 * L / 55;
    for (let k = 0; s.time < 50 + T; k++) {
      s.fixedStep(S.PHYS_DT);
      const ahead = tierCar.totalDist > (tierCar === back ? front : back).totalDist;
      if (tierBehind && ahead && passedAt == null) passedAt = s.time - 50;
      if (k % 240 === 0) lead.push(tierCar.totalDist - (tierCar === back ? front : back).totalDist);
    }
    const other = tierCar === back ? front : back;
    return { tierAhead: tierCar.totalDist > other.totalDist, margin: tierCar.totalDist - other.totalDist, passedAt, contacts: s.stats.collisions, mistakes: (tierCar.mistakes || 0),
      attempts: tierCar.ai.stats.attempts, passes: tierCar.ai.stats.passes, aborts: tierCar.ai.stats.aborts, defends: tierCar.ai.stats.defends };
  },
  // one Career race: the field at the rank, six laps, the game's dynamic weather, a random grid; three stand-in
  // players (Teams E, J and O) driven by the AI at Rookie, Pro and Master skill, scored by the Career rules
  careerRace({ rank, circuit, seed }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit)), P = S.PROGRESS, R = P.RANKS[rank];
    const stand = { 4: 0, 9: 0.5, 14: 1 }, rng = S.makeRng(seed), order = S.DRIVERS.map((d, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const s = new S.Session(t, { type: 'race', gameMode: 'grandprix', laps: 6, seed, difficulty: 1, aiLevel: R.level, weather: 'dynamic', weatherSeed: seed, tyreWear: 'normal',
      damage: 'realistic', entries: order.map(i => ({ driver: S.DRIVERS[i], aiSkill: stand[i] })) });
    while (!s.over && s.time < 6 * 200 + 300) s.fixedStep(S.PHYS_DT);
    if (!s.over) return { over: false, time: s.time };
    const out = {};
    for (const [i, skill] of Object.entries(stand)) {
      const r = s.results.find(x => x.car.driver === S.DRIVERS[i]);
      out[skill] = { pos: r.pos, dnf: !!r.dnf, posPts: r.posPts, lapPts: r.lapPts, lapRank: r.lapRank, grid: order.indexOf(+i) + 1 };
    }
    return { over: true, out, weather: s.weather.start.label + ' → ' + s.weather.label, contacts: s.stats.collisions, dnfs: s.results.filter(r => r.dnf).length };
  },
  // a full field: four baseline reference cars against sixteen tier cars
  race({ circuit, level, seed, laps, wet }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit));
    const s = new S.Session(t, { type: 'race', seed, aiLevel: level, weather: 'dynamic', weatherState: weather(S, seed, wet), weatherSeed: seed,
      tyreWear: 'normal', mandatory: true, damage: 'realistic', entries: S.DRIVERS.map(driver => ({ driver, aiSkill: REF.includes(driver.short) ? 0 : undefined })) });
    s.totalLaps = laps;
    const wetFit = new Map(); let wetAt = null;
    while (!s.over && s.time < laps * 180 + 240) {
      s.fixedStep(S.PHYS_DT);
      if (wet && wetAt == null && s.wet > 0.25) wetAt = s.time;
      if (wet) for (const c of s.cars) if (!wetFit.has(c) && (c.tyre.c === 'I' || c.tyre.c === 'W')) wetFit.set(c, s.time);
    }
    const tierCars = s.cars.filter(c => !REF.includes(c.driver.short));
    const laps2 = tierCars.map(c => c.lapTimes.slice(1).map(l => l.t)).flat().filter(x => x > 60);
    return {
      refPos: s.results.filter(r => REF.includes(r.car.driver.short)).map(r => r.pos),
      tierPos: s.results.filter(r => !REF.includes(r.car.driver.short)).map(r => r.pos),
      mistakes: tierCars.reduce((a, c) => a + (c.mistakes || 0), 0) / tierCars.length,
      overtakes: s.stats.overtakes, collisions: s.stats.collisions, pitstops: s.stats.pitstops, dnf: s.results.filter(r => r.dnf).length,
      winner: s.results[0].time, medianLap: laps2.sort((a, b) => a - b)[Math.floor(laps2.length / 2)] || null,
      wetAt, tierWetDelay: wet && wetAt != null ? mean(tierCars.map(c => (wetFit.has(c) ? wetFit.get(c) : s.time) - wetAt)) : null,
      refWetDelay: wet && wetAt != null ? mean(s.cars.filter(c => REF.includes(c.driver.short)).map(c => (wetFit.has(c) ? wetFit.get(c) : s.time) - wetAt)) : null,
    };
  },
};

if (process.argv[2] === '--worker') {
  process.on('message', ({ kind, job }) => { process.send({ job, out: JOBS[kind](job) }); });
  return;
}

/* ---- driver ---- */
const env = process.env, S0 = loadSim();
const tiers = (env.LEVELS || '1,1.25,1.5').split(',').map(Number); // AI levels (1 = 100%)
const circuits = (env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
const modes = process.argv[2] === 'all' || !process.argv[2] ? ['pace', 'duel', 'race', 'wet', 'career'] : process.argv.slice(2);
function pool(kind, jobs) {
  const n = Math.min(+env.JOBS || os.cpus().length, jobs.length), results = [];
  return new Promise(resolve => {
    let next = 0, done = 0;
    for (let w = 0; w < n; w++) {
      const child = fork(__filename, ['--worker']);
      const feed = () => { if (next < jobs.length) child.send({ kind, job: jobs[next++] }); else child.kill(); };
      child.on('message', (m) => { results.push(m); if (++done === jobs.length) resolve(results); feed(); });
      feed();
    }
  });
}
const name = k => (Math.round(k * 100) + '%').padEnd(10);
(async () => {
  for (const mode of modes) {
    if (mode === 'pace') {
      const jobs = [];
      for (const level of tiers) for (const circuit of circuits) for (const driver of [4, 8, 12, 19]) for (const seed of [1, 2]) jobs.push({ circuit, level, driver, seed, laps: 6 });
      const res = await pool('pace', jobs);
      console.log('\nSOLO PACE (4 drivers x 3 circuits x 2 runs, 5 timed laps each, no tyre wear)');
      console.log('level       mean lap  vs 100%    lap spread  mistakes/100 laps  off-track s/lap  brake-point sd m  max decel m/s2  max yaw rad/s');
      let base = null;
      for (const tier of tiers) {
        const rs = res.filter(r => r.job.level === tier).map(r => r.out), deltas = [];
        // compare like for like: the same driver, circuit and run at the first level
        for (const r of res.filter(r => r.job.level === tier)) {
          const b = res.find(x => x.job.level === tiers[0] && x.job.circuit === r.job.circuit && x.job.driver === r.job.driver && x.job.seed === r.job.seed);
          if (b && r.out.laps.length && b.out.laps.length) deltas.push(mean(r.out.laps) - mean(b.out.laps));
        }
        const laps = rs.flatMap(r => r.laps), nl = laps.length;
        const spread = mean(rs.filter(r => r.laps.length > 1).map(r => sd(r.laps)));
        const m = mean(laps); if (base == null) base = m;
        console.log(name(tier) + '  ' + m.toFixed(3).padStart(8) + '  ' + (mean(deltas) >= 0 ? '+' : '') + mean(deltas).toFixed(3).padStart(7) + '  ' + spread.toFixed(3).padStart(10)
          + '  ' + (100 * rs.reduce((a, r) => a + r.mistakes, 0) / nl).toFixed(2).padStart(17) + '  ' + (rs.reduce((a, r) => a + r.off, 0) / nl).toFixed(3).padStart(15)
          + '  ' + mean(rs.map(r => r.brakeSd).filter(Number.isFinite)).toFixed(2).padStart(16) + '  ' + Math.max(...rs.map(r => r.maxDecel)).toFixed(1).padStart(14) + '  ' + Math.max(...rs.map(r => r.maxYaw)).toFixed(2).padStart(13));
        // per circuit
        console.log('            ' + circuits.map(c => c + ' ' + mean(res.filter(r => r.job.level === tier && r.job.circuit === c).flatMap(r => r.out.laps)).toFixed(3)).join('  '));
      }
    }
    if (mode === 'duel') {
      const jobs = [];
      for (const level of tiers) for (const circuit of circuits) for (let start = 0; start < 6; start++) for (const tierBehind of [true, false]) jobs.push({ circuit, level, start, tierBehind });
      const res = await pool('duel', jobs);
      console.log('\nDUELS (identical cars and ratings; 3 circuits x 6 starting points; 1.5 laps from 30 m apart)');
      console.log('level       attacking: passed  mean time to pass  margin m   defending: kept ahead  margin m  contacts  attempts/passes/aborts  defends');
      for (const tier of tiers) {
        const att = res.filter(r => r.job.level === tier && r.job.tierBehind).map(r => r.out), def = res.filter(r => r.job.level === tier && !r.job.tierBehind).map(r => r.out);
        const times = att.filter(r => r.passedAt != null).map(r => r.passedAt);
        console.log(name(tier) + '  ' + (att.filter(r => r.tierAhead).length + '/' + att.length).padStart(17) + '  ' + (times.length ? mean(times).toFixed(1) + ' s' : '—').padStart(17)
          + '  ' + mean(att.map(r => r.margin)).toFixed(0).padStart(8) + '  ' + (def.filter(r => r.tierAhead).length + '/' + def.length).padStart(21) + '  ' + mean(def.map(r => r.margin)).toFixed(0).padStart(8)
          + '  ' + [...att, ...def].reduce((a, r) => a + r.contacts, 0).toString().padStart(8)
          + '  ' + (att.reduce((a, r) => a + r.attempts, 0) + '/' + att.reduce((a, r) => a + r.passes, 0) + '/' + att.reduce((a, r) => a + r.aborts, 0)).padStart(22) + '  ' + def.reduce((a, r) => a + r.defends, 0).toString().padStart(7));
      }
    }
    if (mode === 'career') {
      const P = S0.PROGRESS, seeds = (env.SEEDS || '901,902').split(',').map(Number), jobs = [];
      for (let rank = 0; rank < P.RANKS.length; rank++) for (const circuit of circuits) for (const seed of seeds) jobs.push({ rank, circuit, seed: seed + rank * 100 });
      const res = await pool('careerRace', jobs), skills = [['Rookie', 0], ['Pro', 0.5], ['Master', 1]];
      for (let rank = 0; rank < P.RANKS.length; rank++) {
        const R = P.RANKS[rank];
        console.log('\nCAREER · ' + R.name + ' rank (' + Math.round(R.level * 100) + '% field; 6-lap races, ' + seeds.length + ' per circuit; promotion ' + P.PROMOTE[rank] + ' of ' + P.RANK_MAX + ')');
        const tot = Object.fromEntries(skills.map(([n]) => [n, { best: 0, mean: 0 }]));
        for (const circuit of circuits) {
          const rs = res.filter(r => r.job.rank === rank && r.job.circuit === circuit).map(r => r.out);
          const line = skills.map(([n, k]) => {
            const e = rs.filter(r => r.over).map(r => r.out[k]); if (!e.length) return n + ' —';
            const totals = e.map(x => x.posPts + x.lapPts); tot[n].best += Math.max(...totals); tot[n].mean += mean(totals);
            return n + ' ' + e.map(x => 'G' + x.grid + '→P' + x.pos + (x.dnf ? ' DNF' : '') + ' lap P' + x.lapRank + ' ' + x.posPts + '+' + x.lapPts).join(', ');
          });
          console.log('  ' + circuit.padEnd(11) + line.join('  |  ') + '  · ' + rs.map(r => r.over ? r.weather + ' (' + r.contacts + ' contacts, ' + r.dnfs + ' DNF)' : 'NOT CLASSIFIED').join('; '));
        }
        console.log('  rank total (best of ' + seeds.length + ' per circuit / mean): ' + skills.map(([n]) => n + ' ' + tot[n].best.toFixed(0) + ' / ' + tot[n].mean.toFixed(0)).join(' · ') + '   threshold ' + P.PROMOTE[rank]);
      }
    }
    if (mode === 'race' || mode === 'wet') {
      const wet = mode === 'wet', jobs = [];
      const rt = env.RACE_LEVELS ? env.RACE_LEVELS.split(',').map(Number) : tiers;
      for (const level of rt) for (const circuit of circuits) for (const seed of wet ? [21] : [11, 12]) jobs.push({ circuit, level, seed, laps: 4, wet });
      const res = await pool('race', jobs);
      console.log(wet ? '\nWET RACES (4 laps, a rain front arriving after about a minute; 3 circuits)' : '\nDRY RACES (4 laps; 3 circuits x 2 seeds)');
      console.log('level       reference cars avg pos  tier cars mistakes/race  overtakes  collisions  stops  DNF  winner s' + (wet ? '  wet-tyre delay s (tier / ref)' : ''));
      for (const tier of rt) {
        const rs = res.filter(r => r.job.level === tier).map(r => r.out);
        console.log(name(tier) + '  ' + mean(rs.flatMap(r => r.refPos)).toFixed(2).padStart(22) + '  ' + mean(rs.map(r => r.mistakes)).toFixed(2).padStart(23)
          + '  ' + mean(rs.map(r => r.overtakes)).toFixed(1).padStart(9) + '  ' + mean(rs.map(r => r.collisions)).toFixed(1).padStart(10) + '  ' + mean(rs.map(r => r.pitstops)).toFixed(1).padStart(5)
          + '  ' + mean(rs.map(r => r.dnf)).toFixed(1).padStart(3) + '  ' + mean(rs.map(r => r.winner).filter(Boolean)).toFixed(1).padStart(8)
          + (wet ? '  ' + mean(rs.map(r => r.tierWetDelay).filter(x => x != null)).toFixed(1).padStart(8) + ' / ' + mean(rs.map(r => r.refWetDelay).filter(x => x != null)).toFixed(1) : ''));
      }
    }
  }
})();
