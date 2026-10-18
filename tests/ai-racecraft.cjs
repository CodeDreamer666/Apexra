// AI racecraft: racing lines, trajectory planning, overtaking, defending, prediction, personalities, mistakes and
// adaptation, run headless with the real Session, AIDriver and physics on all three circuits.
//   node tests/ai-racecraft.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleShim = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(moduleShim);
const SIM = moduleShim.exports;
const { DS } = SIM;
const tracks = Object.fromEntries(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const byShort = (s) => SIM.DRIVERS.find(d => d.short === s);
function session(id, entries, cfg = {}) {
  return new SIM.Session(tracks[id], Object.assign({ type: 'race', seed: 21, difficulty: 1, weather: 'dynamic', weatherState: DRY(21), tyreWear: 'off', mandatory: false, damage: 'realistic', entries }, cfg));
}
// put a car at a lap distance, already racing (as the existing duel benchmark does)
function place(s, c, dist, speed, d = 0) {
  const t = s.track, L = t.length;
  c.placeAt(t, t.wrapS(dist), d, speed); c.speed = c.u = speed; c.launch.active = false; c.launch.engagement = 1;
  c.totalDist = L + dist; c.laps = 1; c.crossings = 2; c.lastLapBase = 1; c.lastWithin = t.wrapS(dist); c.started = true; c.fuel = s.fuelForLaps(4);
}
function racing(s) { s.lightsOut = true; s.time = 50; s.lightsOutTime = 0; s.totalLaps = 5; }
const run = (s, sec, each) => { const end = s.time + sec; while (s.time < end && !s.over) { s.fixedStep(SIM.PHYS_DT); if (each) each(); } };

/* ---------------- 1. dynamic racing lines ---------------- */
test('the old geometric line hugs the inside; the AI racing line goes outside - apex - outside on every circuit', () => {
  for (const [id, t] of Object.entries(tracks)) {
    const L = t.aiLines, N = t.N;
    let oldIn = 0, newIn = 0, n = 0, oai = 0, corners = 0;
    for (const c of t.corners) {
      const len = (c.end - c.start + N) % N;
      for (let k = 0; k <= len; k++) { const i = (c.start + k) % N; n++; if (t.rlOff[i] * c.dir > t.hw[i] - 1.65) oldIn++; if (L.off[0][i] * c.dir > L.limA[i] - 0.3) newIn++; }
      if (c.R > 160) continue; // gentle bends need no full-width line
      // (judged where a corner stands alone: in a linked complex — the Esses, Maggotts–Becketts–Chapel — one bend's
      // exit is the next one's entry, and the line through it is a compromise)
      const ks = t.corners, j = ks.indexOf(c), pk = ks[(j - 1 + ks.length) % ks.length], nk = ks[(j + 1) % ks.length];
      if (!((c.start - pk.end + N) % N * DS > 120 && (nk.start - c.end + N) % N * DS > 60)) continue;
      corners++;
      const at = (j) => L.off[0][(j + N) % N] * c.dir; // + towards the inside
      // outside before turn-in, inside at the apex, and out again by the end of the exit
      const pre = Math.min(...[30, 25, 20, 15].map(q => at(c.start - q)));
      let post = 9; for (let q = 0; q <= 40; q += 5) post = Math.min(post, at(c.end + q));
      if (pre < -1 && at(c.apex) > 2.5 && post < 0) oai++;
    }
    assert.ok(oldIn / n > 0.8, id + ': the elastic-band line sits on the inside limit ' + (100 * oldIn / n).toFixed(0) + '% of the time (the cause)');
    assert.ok(newIn / n < 0.5, id + ': the racing line uses the width (' + (100 * newIn / n).toFixed(0) + '% on the inside limit)');
    // (measured: Monza 3/3, Spa 4/4, Bahrain 2/2, Silverstone 4/7, Suzuka 1/2; Interlagos has no bend that stands alone)
    assert.ok(corners === 0 || oai / corners >= 0.5, id + ': outside-apex-outside in ' + oai + '/' + corners + ' corners that stand alone');
    // every reference line stays on the legal track with a tyre to spare: no cut corners
    // (within 5 cm: smoothing a line over a road whose width changes can overshoot the planning limit by a few
    // centimetres, still 0.7 m inside the legal edge)
    for (const o of L.off) for (let i = 0; i < N; i++) assert.ok(Math.abs(o[i]) <= L.limA[i] + 0.05, id + ' line within the limit at ' + i);
    // the alternatives really are different lines through the corners
    let inside = 0, outside = 0, late = 0;
    for (const c of t.corners) {
      const i = (c.start - 15 + N) % N;
      if ((L.off[1][i] - L.off[0][i]) * c.dir > 1) inside++;
      if ((L.off[2][c.apex] - L.off[0][c.apex]) * c.dir < -1) outside++;
      if (L.off[3][c.apex] * c.dir < L.off[0][c.apex] * c.dir - 0.3 || L.off[3][i] * c.dir < -1) late++;
    }
    assert.ok(inside >= t.corners.length * 0.6 && outside >= t.corners.length * 0.6 && late >= t.corners.length * 0.4, id + ' ' + [inside, outside, late]);
  }
});

test('a lone AI driver drives its racing line: inside at the apex, outside - apex - outside where a corner stands alone', () => {
  for (const id of Object.keys(tracks)) {
    const t = tracks[id], L = t.aiLines, N = t.N, s = session(id, [{ driver: SIM.DRIVERS[4] }]); racing(s);
    const c = s.cars[0]; place(s, c, 100, 50);
    const seen = new Map(); let off = 0, dev = 0, devN = 0;
    run(s, 75, () => {
      if (c.offN >= 2) off++;
      dev += Math.abs(c.d - L.off[0][c.idx]); devN++;
      for (const k of t.corners) {
        if (k.R > 160) continue;
        for (const [tag, at] of [['pre', k.start - 15], ['apex', k.apex], ['post', k.end + 20]]) {
          const i = t.wrapI(at); if (c.idx === i) { const e = seen.get(k) || {}; e[tag] = c.d * k.dir; seen.set(k, e); }
        }
      }
    });
    const ks = t.corners, isolated = (k) => { const j = ks.indexOf(k), p = ks[(j - 1 + ks.length) % ks.length], n = ks[(j + 1) % ks.length]; return (k.start - p.end + N) % N * DS > 120 && (n.start - k.end + N) % N * DS > 60; };
    let apexIn = 0, n = 0, alone = 0, aloneOAO = 0;
    for (const [k, e] of seen) {
      if (e.pre == null || e.apex == null || e.post == null) continue;
      n++; if (e.apex > 1.5) apexIn++;
      if (isolated(k)) { alone++; if (e.pre < 0 && e.post < e.apex - 1.5) aloneOAO++; }
    }
    assert.ok(n >= 6, id + ' corners seen ' + n);
    // (measured: 9/9 to 17/17 on four circuits, 16/18 at Interlagos, 12/17 at Bahrain, where the road is up to 19 m wide)
    assert.ok(apexIn / n >= 0.7, id + ': at the inside at the apex in ' + apexIn + '/' + n);
    // (on the real circuits fewer bends are truly isolated, and some lead straight into the next one's entry)
    assert.ok(alone === 0 || aloneOAO / alone >= 0.5, id + ': outside-apex-outside in ' + aloneOAO + '/' + alone + ' corners that stand alone');
    assert.ok(dev / devN < 1.0, id + ': follows its racing line (mean deviation ' + (dev / devN).toFixed(2) + ' m)');
    // (a brushed exit kerb into the paint for a few hundredths of a second at most: Monza's chicanes, Spa's Bus Stop)
    assert.ok(off * SIM.PHYS_DT < 0.25, id + ': ' + (off * SIM.PHYS_DT).toFixed(2) + ' s with two tyres off'); assert.equal(c.ai.mode, 'race');
  }
});

test('planned paths are continuous: no lateral jumps when the plan changes', () => {
  const s = session('monza', SIM.DRIVERS.slice(0, 6).map(driver => ({ driver }))); racing(s);
  s.cars.forEach((c, k) => place(s, c, 300 + 14 * k, 55, (k % 2 ? 2 : -2)));
  let worst = 0; const last = new Map();
  run(s, 40, () => {
    for (const c of s.cars) {
      const a = c.ai; if (a.mode !== 'race' || c.pit || a.pitting) { last.delete(c); continue; }
      // the point the steering aims at (look-ahead 6 + 0.22 v metres, as in AIDriver.decide)
      const i = s.track.wrapI(c.idx + Math.round((6 + 0.22 * c.speed) / DS)), d = a.pathD(i), p = last.get(c);
      // (a car pushed more than 2 m off its path, by contact or while giving room, re-plans from where it is)
      if (p && p.i === i && p.near) worst = Math.max(worst, Math.abs(d - p.d));
      last.set(c, { i, d, near: Math.abs(c.d - a.pathD(c.idx)) < 2 });
    }
  });
  assert.ok(worst < 0.35, 'largest step of the steering target within one physics step: ' + worst.toFixed(3) + ' m');
});

/* ---------------- 2-8. a full field: overtaking, defending, room, personalities, mistakes ---------------- */
let raceStats = null;
// two 3-lap races with the full field (Monza and Spa), instrumented (three laps: mistakes are situational and rare,
// a couple per six-lap race, so two laps can pass without one). (Bahrain was the second race: between identical cars
// without DRS its long straights make trains in which a committed move almost never completes — no completions in six
// laps on either seed of the field benchmark in the README — so a short race there cannot show moves completing.)
function fieldRace() {
  if (raceStats) return raceStats;
  const R = { overlapT: 0, tightT: 0, defendTicks: 0, weave: 0, defCorners: 0, planMs: 0, plans: 0, lineSep: [],
    kinds: {}, attempts: 0, passes: 0, aborts: 0, switchbacks: 0, reasons: [], overtakes: 0, collisions: 0, mistakes: 0, dnf: 0, over: true };
  const P = SIM.AIDriver.prototype, plan = P.planTrajectory;
  P.planTrajectory = function () { const t0 = process.hrtime.bigint(); plan.call(this); R.planMs += Number(process.hrtime.bigint() - t0) / 1e6; R.plans++; };
  for (const [id, seed] of [['monza', 13], ['spa', 14]]) {
    const s = new SIM.Session(tracks[id], { type: 'race', seed, difficulty: 1, weather: 'dynamic', weatherState: DRY(seed), tyreWear: 'normal', mandatory: true, damage: 'realistic', entries: SIM.DRIVERS.map(driver => ({ driver })) });
    s.totalLaps = 3;
    const t = s.track, defMax = new Map();
    while (!s.over && s.time < 3 * 200 + 120) {
      s.fixedStep(SIM.PHYS_DT);
      if (s.step % 24) continue;
      const cars = s.cars.filter(c => !c.pit && !c.dnf && !c.inGarage && c.speed > 15);
      for (const a of cars) for (const b of cars) {
        if (a.id >= b.id) continue;
        const ds = t.dS(a.s, b.s);
        // two cars racing close through a corner: are they on different lines?
        if (t.cornerAt(a.idx) && Math.abs(ds) < 25) R.lineSep.push(Math.abs(a.d - b.d));
        if (Math.abs(ds) > 5) continue;
        R.overlapT += 0.1; if (Math.abs(a.d - b.d) < 1.9) R.tightT += 0.1;
      }
      for (const c of s.cars) if (c.ai) {
        if (c.ai.state === 'defend') { R.defendTicks++; const key = c.id + ':' + c.ai.defCorner + ':' + c.laps; defMax.set(key, Math.max(defMax.get(key) || 0, c.ai.defMoves)); }
      }
    }
    for (const v of defMax.values()) { R.defCorners++; if (v > 1) R.weave++; }
    for (const c of s.cars) if (c.ai) { const st = c.ai.stats; R.attempts += st.attempts; R.passes += st.passes; R.aborts += st.aborts; R.switchbacks += st.switchbacks; for (const k in st.kinds) R.kinds[k] = (R.kinds[k] || 0) + st.kinds[k]; }
    R.reasons.push(...s.logArr.filter(l => /^abort: /.test(l[2])).map(l => l[2]));
    R.overtakes += s.stats.overtakes; R.collisions += s.stats.collisions; R.mistakes += s.stats.mistakes; R.dnf += s.cars.filter(c => c.dnf).length; R.over = R.over && s.over;
  }
  P.planTrajectory = plan;
  return (raceStats = R);
}

test('20-car races: drivers attack with different moves, complete some, abort others for stated reasons', () => {
  const R = fieldRace();
  assert.ok(R.over, 'the races are classified');
  assert.ok(R.attempts >= 8, 'moves attempted: ' + R.attempts);
  assert.ok(Object.keys(R.kinds).length >= 2, 'kinds of move: ' + JSON.stringify(R.kinds));
  assert.ok(R.passes >= 1, 'moves completed: ' + R.passes);
  assert.ok(R.aborts >= 1 && R.reasons.length >= 1, 'moves called off with a reason: ' + R.reasons.slice(0, 4).join(' | '));
  assert.ok(R.overtakes >= 4, 'overtakes ' + R.overtakes);
});

test('20-car races: racing room, no weaving, believable mistakes, cheap planning', () => {
  const R = fieldRace();
  // side by side, cars keep a car's width apart nearly all the time; contact stays rare
  assert.ok(R.overlapT > 5, 'time side by side ' + R.overlapT.toFixed(1));
  assert.ok(R.tightT / R.overlapT < 0.2, 'touching-close share of side-by-side time ' + (R.tightT / R.overlapT).toFixed(2));
  assert.ok(R.collisions <= 24, 'contacts ' + R.collisions);
  // defending: at most one blocking move per corner approach (moving away to give room is not counted)
  assert.ok(R.defCorners > 0, 'defending happened');
  assert.ok(R.weave / R.defCorners < 0.1, 'more than one blocking move in ' + R.weave + ' of ' + R.defCorners + ' defended corners');
  // cars racing close through corners are not all on the same line
  const sep = R.lineSep.reduce((a, b) => a + b, 0) / R.lineSep.length;
  assert.ok(sep > 1.5, 'mean lateral separation of close cars in corners ' + sep.toFixed(2) + ' m');
  // mistakes happen but nobody is wrecked by them
  assert.ok(R.mistakes >= 1, 'mistakes ' + R.mistakes);
  assert.ok(R.dnf <= 3, 'retirements ' + R.dnf);
  // the planner is cheap: well under a millisecond per plan
  const per = R.planMs / R.plans;
  assert.ok(per < 1.0, 'mean plan ' + per.toFixed(3) + ' ms over ' + R.plans + ' plans');
});

/* ---------------- staged duels ---------------- */
// A duel on the approach to a real braking-zone corner: `back` 8-25 m behind `front`, about 250 m before turn-in.
function approach(id, k, frontShort, backShort, opts = {}) {
  const t = tracks[id], N = t.N, corners = t.corners.filter(c => c.brakeZone);
  const c = corners[k % corners.length], startS = c.start * DS, at = startS - (opts.before || 250);
  const f = { ...byShort(frontShort), name: 'Front', short: 'Front', num: 91 }, b = { ...byShort(backShort), name: 'Back', short: 'Back', num: 92 };
  const s = session(id, [{ driver: f }, { driver: b }], { tyreWear: 'normal', seed: opts.seed || 5 }); racing(s);
  const [front, back] = s.cars;
  place(s, front, at + (opts.gap || 12), 70, opts.frontD || 0); place(s, back, at, 72, opts.backD || 0);
  front.tyre.wear.fill(opts.wear ?? 0);
  s.fixedStep(SIM.PHYS_DT); // the drivers take over (a freshly placed driver starts from a clean state)
  back.ai.tactical(0.1);
  const W = t.aiLines.win[back.ai.ctx.k1]; // the corner the following driver is planning for
  return { s, t, front, back, c, W };
}
// make the front car hold a given lateral position (e.g. sit on the inside) whatever its own plan says
const hold = (car, t, d) => { const P = car.ai.path; P.valid = true; P.i0 = car.idx; P.n = 190; for (let r = 0; r < 190; r++) P.d[r] = d; P.born = car.race.time; };

test('a faster car identifies the opportunity and passes it; the move is judged, not scripted', () => {
  let passed = 0, moves = 0, contacts = 0;
  for (const [id, k] of [['monza', 0], ['silverstone', 1], ['bahrain', 2], ['monza', 3]]) {
    // the car ahead is on badly worn tyres (about 17 % less grip): a real, visible difference in pace
    const { s, front, back } = approach(id, k, 'Team T', 'Team C', { wear: 0.68, gap: 20, before: 400 });
    let lined = false;
    run(s, 90, () => { if (back.ai.state === 'prepare' || back.ai.state === 'attack') lined = true; });
    if (back.totalDist > front.totalDist + 5) passed++;
    if (lined) moves++;
    contacts += s.stats.collisions;
  }
  assert.ok(passed >= 3, 'passes ' + passed + '/4');
  assert.ok(moves >= 2, 'moves lined up or attempted in ' + moves + '/4');
  assert.ok(contacts <= 1, 'contacts ' + contacts);
});

test('an unsafe pass is abandoned: the defender closes the door before the corner and the attacker backs out', () => {
  let aborted = 0, contacts = 0; const reasons = [];
  for (const [id, k] of [['monza', 0], ['bahrain', 1], ['silverstone', 2], ['bahrain', 3]]) {
    const { s, t, front, back, W } = approach(id, k, 'Team I', 'Team M', { gap: 9 });
    back.ai.startAttack({ car: front, maneuver: 'inside', side: 1, corner: W.k });
    let ended = null; const orig = back.ai.endAttack.bind(back.ai);
    back.ai.endAttack = (why, ok) => { if (!ended) ended = { why, ok }; return orig(why, ok); };
    // the defender moves across and holds the inside all the way to the apex
    run(s, 8, () => hold(front, t, W.dir * (t.hw[front.idx] - 2.0)));
    // (backing out, or turning the move into a switchback behind the closed door: either way it does not force it)
    if (ended && !ended.ok) { aborted++; reasons.push(ended.why); }
    else if (back.ai.stats.switchbacks > 0) { aborted++; reasons.push('switchback'); }
    else reasons.push(ended ? 'completed: ' + ended.why : 'still attacking');
    contacts += s.stats.collisions;
  }
  assert.ok(aborted >= 3, 'backed out or switched ' + aborted + '/4: ' + reasons.join(' | '));
  assert.ok(contacts <= 1, 'contacts ' + contacts);
});

test('a covered inside makes a good racer weigh (and take) the switchback: wide entry, cut back, better exit', () => {
  let considered = 0, taken = 0;
  for (const [id, k] of [['monza', 0], ['bahrain', 1], ['silverstone', 2], ['monza', 3], ['bahrain', 4]]) {
    const { s, t, front, back, W } = approach(id, k, 'Team I', 'Team E', { gap: 9 });
    back.ai.startAttack({ car: front, maneuver: 'inside', side: 1, corner: W.k });
    let seen = false;
    run(s, 8, () => {
      hold(front, t, W.dir * (t.hw[front.idx] - 2.0));
      for (let q = 0; q < back.ai.nCand; q++) if (back.ai.cands[q].maneuver === 'switchback') seen = true;
    });
    if (seen) considered++;
    if (back.ai.stats.switchbacks > 0) taken++;
  }
  assert.ok(considered >= 3, 'switchback weighed in ' + considered + '/5');
  assert.ok(taken >= 1, 'switchbacks taken ' + taken + '/5');
});

test('no personalities: every AI driver shares one aggressive racing profile and judges a chance alike', () => {
  // one profile for all twenty: no cautious, passive, balanced or aggressive drivers
  const traits = new Set(SIM.DRIVERS.map(d => [d.pace, d.cons, d.brake, d.craft, d.aggr, d.risk, d.tyre, d.strat, d.start, d.patience, d.adapt].join()));
  assert.equal(traits.size, 1, 'one shared profile');
  const D = SIM.DRIVERS[0]; assert.ok(D.aggr >= 0.9 && D.risk >= 0.85 && D.patience <= 0.2, 'that profile attacks: ' + JSON.stringify(D));
  // identical evaluation of an identical chance, fed to the tactical layer of different drivers: the same, quick commitment
  const timeToCommit = (short, extra = {}) => {
    const s = session('monza', [{ driver: byShort('Team T') }, { driver: byShort(short) }], extra); racing(s);
    const [front, back] = s.cars; place(s, front, 600, 60); place(s, back, 588, 60); s.fixedStep(SIM.PHYS_DT);
    const a = back.ai; a.state = 'follow'; a.conviction = 0; a.followTime = 0;
    for (let k = 1; k <= 300; k++) {
      a.passEval = { car: front, feasible: true, risk: 0.05, gain: 0.02, success: 0.55, value: 0.6, maneuver: 'inside', side: 1, corner: 0 };
      a.updateState(0.1, front, null, false, false);
      if (a.state === 'attack') return k / 10;
      a.followTime += 0.1;
    }
    return 30;
  };
  const times = ['Team M', 'Team C', 'Team I', 'Team D'].map(n => timeToCommit(n));
  assert.equal(new Set(times).size, 1, 'the same chance, the same decision: ' + times);
  assert.ok(times[0] <= 1.0, 'a plausible chance is taken within a second: ' + times[0] + ' s');
  // the will to attack is the same at every level (skill changes execution, not willingness)
  assert.equal(timeToCommit('Team M', { aiLevel: 1.5 }), timeToCommit('Team M', { difficulty: 1 }));
  // the whole field: the same tolerance and the same reading of rivals at one level
  const s = session('monza', SIM.DRIVERS.map(driver => ({ driver }))); racing(s);
  for (const a of s.cars.map(c => c.ai)) a.strategic(0.1, 0);
  const minds = new Set(s.cars.map(c => JSON.stringify(c.ai.mind)));
  assert.equal(minds.size, 1, 'one racing mind for the field');
  // a visible mistake by the car ahead is pounced on at once
  const m = session('monza', [{ driver: byShort('Team T') }, { driver: byShort('Team A') }]); racing(m);
  const [front, back] = m.cars; place(m, front, 620, 45); place(m, back, 600, 50); m.fixedStep(SIM.PHYS_DT);
  front.offN = 4; front.spun = true;
  back.ai.tactical(0.1);
  assert.equal(back.ai.target, front, 'the stricken car becomes the target');
  assert.ok(back.ai.conviction >= 0.8, 'committed at once: conviction ' + back.ai.conviction.toFixed(2));
});

/* ---------------- adaptation, recovery, restrictions, tiers ---------------- */
test('grip reading lags changing conditions (bounded) and higher levels catch up faster', () => {
  const qs = session('monza', SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), { aiLevel: 1.5 }); racing(qs);
  const ss = session('monza', SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), { difficulty: 0 }); racing(ss);
  const quick = qs.cars[0].ai, slow = ss.cars[0].ai;
  for (const a of [quick, slow]) a.readGrip(0.1);
  qs.wet = ss.wet = 0.6; // rain arrives
  const over = { quick: [], slow: [] };
  for (let k = 0; k < 100; k++) { quick.readGrip(0.1); slow.readGrip(0.1); over.quick.push(quick.gripBelief); over.slow.push(slow.gripBelief); }
  assert.ok(over.slow[5] > 1.01 && over.slow[5] <= 1.05 + 1e-9, 'optimistic at first, bounded: ' + over.slow[5].toFixed(3));
  assert.ok(over.quick[20] < over.slow[20], 'the Master reads it faster ' + over.quick[20].toFixed(3) + ' < ' + over.slow[20].toFixed(3));
  assert.ok(Math.abs(over.slow[99] - 1) < 0.02 && Math.abs(over.quick[99] - 1) < 0.005, 'both converge within ten seconds');
  ss.wet = 0.9; slow.readGrip(0.1); const before = slow.gripBelief; slow.steerSat = 0.1; slow.readGrip(0.1);
  assert.ok(slow.gripBelief < before, 'a slide tells the driver');
});

test('a driver learns a rival\'s habits from what it sees, within bounds, and a scare makes it more careful', () => {
  const s = session('monza', SIM.DRIVERS.slice(0, 2).map(driver => ({ driver }))); racing(s);
  const [a, b] = s.cars; place(s, b, 500, 50); place(s, a, 470, 50);
  run(s, 60);
  const m = a.ai.mem.get(b.id);
  assert.ok(m && m.pace >= 0.85 && m.pace <= 1.12 && Math.abs(m.lineIn) <= 3, JSON.stringify(m));
  const budget = a.ai.riskBudget; a.ai.onContact(b); a.ai.strategic(0.1, 0);
  assert.ok(a.ai.caution > 0.25 && a.ai.riskBudget < budget, 'caution ' + a.ai.caution.toFixed(2));
});

test('an AI driver run off the track at speed recovers and rejoins without a reset', () => {
  for (const id of Object.keys(tracks)) {
    const s = session(id, [{ driver: SIM.DRIVERS[7] }]); racing(s);
    const c = s.cars[0], t = s.track; place(s, c, 800, 60, t.hw[t.wrapI(400)] + 4);
    let resets = 0; const orig = c.ai.respawn.bind(c.ai); c.ai.respawn = () => { resets++; orig(); };
    let back = null;
    run(s, 20, () => { if (back == null && Math.abs(c.d) < t.hw[c.idx] - 0.5 && c.ai.mode === 'race' && c.speed > 20) back = s.time - 50; });
    assert.ok(back != null && back < 12, id + ': back racing after ' + back);
    assert.equal(resets, 0, id + ': no reset');
    assert.ok(c.speed > 30 && Math.abs(c.d) < t.hw[c.idx], id + ': racing again');
  }
});

test('no attacking or defending under a yellow flag; pit moves keep their own rules; no VSC or blue flags exist', () => {
  const s = session('monza', SIM.DRIVERS.slice(0, 3).map(driver => ({ driver })), { tyreWear: 'normal' }); racing(s);
  const [a, b, c] = s.cars; place(s, a, 600, 60); place(s, b, 588, 62); place(s, c, 578, 62);
  s.yellow.fill(5); // marshals' yellow flags everywhere
  for (const car of s.cars) { car.ai.conviction = 2; car.ai.tactical(0.1); }
  for (const car of s.cars) { assert.notEqual(car.ai.state, 'attack'); assert.notEqual(car.ai.state, 'defend'); assert.notEqual(car.ai.state, 'prepare'); }
  s.yellow.fill(0);
  // a car heading for the pit lane follows the pit route, not a racing plan
  b.ai.pitting = true; b.ai.pitEntryBlend = 1;
  const t = s.track; assert.equal(b.ai.dPlanAt(t.wrapI(b.idx + 5)), t.pitTargetD(t.wrapI(b.idx + 5) * DS, null));
  // nothing of the Virtual Safety Car or blue flags is left
  for (const k of ['vsc', 'vscActive', 'vscControls', 'updateBlueFlags', 'blueEligible']) assert.equal(s[k], undefined, k);
  assert.equal(SIM.VSC, undefined); assert.equal('blueFlag' in a, false); assert.equal('blueYield' in a.ai, false);
});

test('higher levels judge and execute better (prediction, evaluation, execution), with the same car and physics', () => {
  let prev = null;
  for (const tier of [{ name: 'GP 0%', difficulty: 0 }, { name: 'GP 50%', difficulty: 0.5 }, ...SIM.PROGRESS.RANKS]) {
    const s = session('monza', SIM.DRIVERS.map(driver => ({ driver })), tier.level ? { aiLevel: tier.level } : { difficulty: tier.difficulty });
    const ms = s.cars.map(c => c.ai.mind), avg = f => ms.reduce((a, m) => a + f(m), 0) / ms.length;
    const now = { predict: avg(m => m.predict), judge: avg(m => m.judge), apex: avg(m => m.apexSd), brake: avg(m => m.brakeSd), rep: avg(m => m.repertoire) };
    if (prev) {
      assert.ok(now.predict > prev.predict && now.judge < prev.judge && now.apex < prev.apex && now.brake < prev.brake && now.rep >= prev.rep, tier.name + ' ' + JSON.stringify(now));
    }
    prev = now;
    for (const c of s.cars) { assert.equal(c.ai.mind.aggr, c.driver.aggr); assert.equal(c.ai.mind.patience, c.driver.patience); assert.equal(c.ai.mind.risk, c.driver.risk); }
  }
  // the three ranks step up every time (nothing saturates below Master)
  prev = null;
  for (const r of SIM.PROGRESS.RANKS) {
    const s = session('monza', SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), { aiLevel: r.level });
    const a = s.cars[1].ai, now = { skill: a.skill, commit: a.commit, brake: a.brakeCommit, mistakes: a.mistakeScale, predict: a.mind.predict, apex: a.mind.apexSd };
    if (prev) assert.ok(now.skill > prev.skill && now.commit > prev.commit && now.brake >= prev.brake && now.mistakes < prev.mistakes && now.predict > prev.predict && now.apex < prev.apex, r.name + ' ' + JSON.stringify(now));
    assert.ok(now.commit <= 1 && now.brake <= 1 && now.mistakes > 0, r.name + ': within the physical limit and never infallible');
    prev = now;
  }
  // the chosen path is driven through the normal controls and physics: the same inputs give the same motion
  const r = session('monza', [{ driver: SIM.DRIVERS[3] }], { aiLevel: 1 }), l = session('monza', [{ driver: SIM.DRIVERS[3] }], { aiLevel: 1.5 });
  const cr = r.cars[0], cl = l.cars[0];
  for (const [s, c] of [[r, cr], [l, cl]]) { s.fitTyres(c, 'H', 90); c.fuel = 15; c.placeAt(r.track, 400, 0, 30); c.speed = c.u = 30; }
  for (let i = 0; i < 480; i++) for (const c of [cr, cl]) { c.input.throttle = 1; c.input.brake = 0; c.input.steer = 0.2; SIM.stepCarPhysics(c, SIM.PHYS_DT, r.track, { wet: 0, wearScale: 1, fuelRate: 0.04, pitLimiter: false }); }
  assert.deepEqual([cl.x, cl.z, cl.speed], [cr.x, cr.z, cr.speed]);
});
