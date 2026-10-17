#!/usr/bin/env node
// Pursuit calibration (development tool, slow). Everything runs on the game's own SIM, headless.
//
//   node tools/pursuit-balance.cjs gap       the head start: two identical cars (same driver ratings, same AI level,
//                                            both on new Softs) — is the rival really `gap` seconds ahead at speed?
//   node tools/pursuit-balance.cjs ranks     each rank as configured (rival AI level, head start, rival tyre wear)
//                                            against a chaser driven by the AI at several levels, a stand-in for
//                                            players of different skill: who wins, final gaps, passes
//   node tools/pursuit-balance.cjs wear      the rival's tyre wear per circuit and rank: the chaser driven by the AI at the
//                                            rank's own level (a player as good as the rival), win rate for each wear
//                                            (WEAR_SCAN=0.3,0.38,...; GAPS as for ranks)
//   node tools/pursuit-balance.cjs all
// Options: CIRCUITS=monza,...,interlagos SEEDS=1,2 CHASERS=1,1.25,1.5 RANKS=0,1,2 GAPS=g0,g1,g2 WEARS=w0,w1,w2 JOBS=4
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const html = fs.readFileSync(process.env.SIM_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
function loadSim() { const m = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m); return m.exports; }
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

const JOBS = {
  // two identical cars: the gap between them at each timing loop once both are at speed
  gap({ circuit, gap, seed }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit)), d = S.DRIVERS[8];
    const twin = { ...d, name: 'Twin', short: 'Twin', num: 99 };
    const s = new S.Session(t, { type: 'race', gameMode: 'pursuit', seed, aiLevel: 1, damage: 'realistic',
      pursuit: { gap, rivalWear: 0, rival: 1 }, entries: [{ driver: d }, { driver: twin }] });
    const [ch, rv] = s.cars, L = t.length, loops = t.timingPoints, out = [];
    while (!s.over && (!s.lightsOut || ch.totalDist < 1.1 * L)) s.fixedStep(S.PHYS_DT);
    // timing loops from 2 km into the race to the end of lap 1 (both cars long past their launches)
    for (let k = Math.ceil(2000 / (L / loops)); k * L / loops < 1.05 * L; k++) {
      const a = ch.tp[k + 200], b = rv.tp[k + 200]; if (a != null && b != null) out.push(a - b);
    }
    return { headStart: s.pursuit.headStart, measured: mean(out), min: Math.min(...out), max: Math.max(...out), contacts: s.stats.collisions };
  },
  // one Pursuit as the game sets it up for a rank, the chaser driven by the AI at `chaser` level
  rank({ circuit, rank, chaser, seed, gap, wear }) {
    const S = loadSim(), t = new S.Track(S.circuitById(circuit)), R = Object.assign({}, S.PROGRESS.RANKS[rank], { wear: S.PROGRESS.pursuitSetup(rank, circuit).rivalWear }, gap != null ? { gap } : {}, wear != null ? { wear } : {});
    const s = new S.Session(t, { type: 'race', gameMode: 'pursuit', seed, aiLevel: R.level, damage: 'realistic',
      pursuit: { gap: R.gap, rivalWear: R.wear, rival: 1 }, entries: [{ driver: S.DRIVERS[3], aiSkill: S.aiSkillForLevel(chaser) }, { driver: S.DRIVERS[11] }] });
    const [ch, rv] = s.cars; let caughtAt = null, passedAt = null, minGap = Infinity;
    while (!s.over && s.time < 420) {
      s.fixedStep(S.PHYS_DT);
      if (s.lightsOut && s.step % 24 === 0) {
        const behind = rv.totalDist - ch.totalDist;
        if (behind < minGap) minGap = behind;
        if (caughtAt == null && behind < 15) caughtAt = s.time - s.lightsOutTime;
        if (passedAt == null && behind < 0) passedAt = s.time - s.lightsOutTime;
      }
    }
    return { win: s.winner === ch, finalGap: s.pursuit.finalGap, caughtAt, passedAt, minGap, contacts: s.stats.collisions,
      rivalDefends: rv.ai.stats.defends, chaserAttempts: ch.ai.stats.attempts, chaserPasses: ch.ai.stats.passes,
      rivalWearEnd: Math.max(...rv.tyre.wear), chaserWearEnd: Math.max(...ch.tyre.wear), dnf: s.cars.filter(c => c.dnf).map(c => c.driver.short) };
  },
};
if (process.argv[2] === '--worker') { process.on('message', ({ kind, job }) => process.send({ job, out: JOBS[kind](job) })); return; }

const env = process.env, S0 = loadSim();
const circuits = (env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
const seeds = (env.SEEDS || '1,2').split(',').map(Number);
const modes = !process.argv[2] || process.argv[2] === 'all' ? ['gap', 'ranks'] : process.argv.slice(2);
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
(async () => {
  for (const mode of modes) {
    const GAPSET = (env.GAPSET || '1,2,3.5').split(',').map(Number);
    if (mode === 'gap') {
      const jobs = []; for (const circuit of circuits) for (const gap of GAPSET) for (const seed of seeds) jobs.push({ circuit, gap, seed });
      const res = await pool('gap', jobs);
      console.log('\nHEAD START (identical cars and AI, rival on new Softs): configured gap vs the gap measured at the timing loops, 2–6 km');
      console.log('circuit     gap s  head start m  measured s (mean / min / max)');
      for (const circuit of circuits) for (const gap of GAPSET) {
        const rs = res.filter(r => r.job.circuit === circuit && r.job.gap === gap).map(r => r.out);
        console.log(circuit.padEnd(10) + '  ' + gap.toFixed(1).padStart(5) + '  ' + String(rs[0].headStart).padStart(12) + '  ' + mean(rs.map(r => r.measured)).toFixed(2) + ' / ' + Math.min(...rs.map(r => r.min)).toFixed(2) + ' / ' + Math.max(...rs.map(r => r.max)).toFixed(2));
      }
    }
    if (mode === 'wear') {
      const ranks = (env.RANKS || '0,1,2').split(',').map(Number), scan = (env.WEAR_SCAN || '0.3,0.38,0.46,0.54,0.6').split(',').map(Number), jobs = [];
      const gaps = env.GAPS ? env.GAPS.split(',').map(Number) : null;
      for (const rank of ranks) for (const wear of scan) for (const circuit of circuits) for (const seed of seeds) jobs.push({ circuit, rank, chaser: S0.PROGRESS.RANKS[rank].level, seed, gap: gaps ? gaps[rank] : null, wear });
      const res = await pool('rank', jobs);
      console.log('\nRIVAL TYRE WEAR (chaser at the rank\'s own level; wins of ' + seeds.length + ' per cell, mean final gap)');
      console.log('rank      wear   ' + circuits.map(c => c.padEnd(16)).join(''));
      for (const rank of ranks) for (const wear of scan) {
        let line = S0.PROGRESS.RANKS[rank].name.padEnd(8) + '  ' + wear.toFixed(2) + '   ';
        for (const c of circuits) { const rs = res.filter(r => r.job.rank === rank && r.job.wear === wear && r.job.circuit === c).map(r => r.out); line += (rs.filter(r => r.win).length + '/' + rs.length + ' ' + mean(rs.map(r => r.finalGap)).toFixed(2)).padEnd(16); }
        console.log(line);
      }
      console.log(JSON.stringify(res.map(r => [r.job.rank, r.job.wear, r.job.circuit, r.job.seed, r.out.win ? 1 : 0, +r.out.finalGap.toFixed(2)])));
    }
    if (mode === 'ranks') {
      const ranks = (env.RANKS || '0,1,2').split(',').map(Number), chasers = (env.CHASERS || '1,1.25,1.5').split(',').map(Number), jobs = [];
      // GAPS=g0,g1,g2 tries other head starts for the ranks (calibration); otherwise each rank's configured gap
      const gaps = env.GAPS ? env.GAPS.split(',').map(Number) : null, wears = env.WEARS ? env.WEARS.split(',').map(Number) : null;
      for (const rank of ranks) for (const chaser of chasers) for (const circuit of circuits) for (const seed of seeds) jobs.push({ circuit, rank, chaser, seed, gap: gaps ? gaps[rank] : null, wear: wears ? wears[rank] : null });
      const res = await pool('rank', jobs);
      console.log('\nRANKS (chaser = the player car driven by the AI at a given level; ' + circuits.length + ' circuits x ' + seeds.length + ' seeds)');
      console.log('rank        rival AI  gap  wear   ' + chasers.map(c => ('chaser ' + Math.round(c * 100) + '%: wins  final gap').padEnd(30)).join(''));
      for (const rank of ranks) {
        const R = Object.assign({}, S0.PROGRESS.RANKS[rank], gaps ? { gap: gaps[rank] } : {}, wears ? { wear: wears[rank] } : {});
        let line = R.name.padEnd(10) + '  ' + (Math.round(R.level * 100) + '%').padStart(8) + '  ' + R.gap.toFixed(1) + '  ' + (R.wear != null ? Math.round(R.wear * 100) + '%' : 'table') + '   ';
        for (const chaser of chasers) {
          const rs = res.filter(r => r.job.rank === rank && r.job.chaser === chaser).map(r => r.out);
          line += ((rs.filter(r => r.win).length + '/' + rs.length).padStart(14) + '  ' + mean(rs.map(r => r.finalGap).filter(Number.isFinite)).toFixed(2).padStart(9) + ' s').padEnd(30);
        }
        console.log(line);
      }
      // per circuit: wins of the chaser at each level
      for (const rank of ranks) for (const chaser of chasers) console.log('  ' + S0.PROGRESS.RANKS[rank].name + ' vs chaser ' + Math.round(chaser * 100) + '%: ' + circuits.map(c => { const rs = res.filter(r => r.job.rank === rank && r.job.chaser === chaser && r.job.circuit === c).map(r => r.out); return c + ' ' + rs.filter(r => r.win).length + '/' + rs.length + ' (' + mean(rs.map(r => r.finalGap).filter(Number.isFinite)).toFixed(2) + ' s)'; }).join(' · '));
      const all = res.map(r => r.out);
      console.log('rival defending moves: ' + all.reduce((a, r) => a + r.rivalDefends, 0) + ' · chaser attempts/passes: ' + all.reduce((a, r) => a + r.chaserAttempts, 0) + '/' + all.reduce((a, r) => a + r.chaserPasses, 0)
        + ' · contacts: ' + all.reduce((a, r) => a + r.contacts, 0) + ' · retirements: ' + all.reduce((a, r) => a + r.dnf.length, 0) + ' · rival worst wear at the flag ' + Math.round(100 * mean(all.map(r => r.rivalWearEnd))) + '%, chaser ' + Math.round(100 * mean(all.map(r => r.chaserWearEnd))) + '%');
    }
  }
})();
