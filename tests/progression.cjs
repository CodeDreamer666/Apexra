const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Progression: three ranks (Rookie 100%, Pro 125%, Master 150%) in Career, Rival Duel and Pursuit, six circuits per rank,
// the Career's 50 + 50 circuit score and 600-point rank score, the five-of-six rule, replays, saves and migration from
// the old five-tier Career and eight-rank modes; plus the two-car Rival Duel and Pursuit sessions on every circuit,
// all through the game's own SIM.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, P = SIM.PROGRESS, RANKS = P.RANKS, CIRC = P.CIRCUITS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const two = (a = 0, b = 1) => [{ driver: SIM.DRIVERS[a], isPlayer: true }, { driver: SIM.DRIVERS[b] }];
function session(id, gameMode, extra = {}) {
  return new SIM.Session(tracks.get(id), Object.assign({ type: 'race', gameMode, seed: 11, aiLevel: 1, weather: 'dynamic', damage: 'realistic',
    entries: two(), pursuit: gameMode === 'pursuit' ? { gap: 2, rivalWear: 0.25, rival: 1 } : undefined }, extra));
}
let uid = 0; const id = () => 'race-' + (++uid);
const career = (st, rank, circuit, pos, pacePts, more = {}) => P.recordCareer(st, Object.assign({ rank, circuit, id: id(), pos, dnf: false, pacePts }, more));
const ranked = (st, mode, rank, circuit, win) => P.recordRanked(st, mode, { rank, circuit, id: id(), win, time: 150 });

test('exactly three ranks: Rookie 100%, Pro 125%, Master 150%; the old tiers and ranks are gone', () => {
  assert.deepEqual(RANKS.map(r => [r.id, r.name, r.level]), [['rookie', 'Rookie', 1], ['pro', 'Pro', 1.25], ['master', 'Master', 1.5]]);
  assert.equal(SIM.AI_MAX_LEVEL, 1.5);
  assert.deepEqual(RANKS.map(r => SIM.aiSkillForLevel(r.level)), [0, 0.5, 1]);
  assert.equal(SIM.CAREER, undefined); assert.equal(SIM.RANKED, undefined);
  assert.ok(!/Initiate|Bronze|Silver|Gold|Platinum|Diamond|Ascendant|Elite|Legendary/.test(JSON.stringify(RANKS)));
  assert.deepEqual(CIRC, ['monza', 'silverstone', 'spa', 'suzuka', 'bahrain', 'interlagos'], 'all six real circuits in every rank');
  for (const mode of P.MODES) for (let k = 0; k < 3; k++) assert.equal(P.status(P.create(), mode, k).rows.length, 6);
  assert.deepEqual([SIM.GAME_MODES.grandprix.laps, SIM.GAME_MODES.duel.laps, SIM.GAME_MODES.pursuit.laps], [6, 2, 2]);
});

test('finishing position points for all 20 places: 50 for P1 down to 1 for P20', () => {
  const want = [50, 44, 39, 35, 32, 29, 26, 23, 20, 18, 16, 14, 12, 10, 8, 6, 5, 4, 2, 1];
  for (let p = 1; p <= 20; p++) assert.equal(P.positionPoints(p), want[p - 1], 'P' + p);
  for (let p = 2; p <= 20; p++) assert.ok(P.positionPoints(p) < P.positionPoints(p - 1));
  assert.equal(P.positionPoints(0), 0); assert.equal(P.positionPoints(21), 0);
});

test('lap-time pace: smooth and monotonic, every integer from 0 to 50 reachable, per circuit and weather', () => {
  for (const c of CIRC) for (const w of [0, 0.3, 0.45, 0.6, 0.9, 1]) {
    // per-lap points against the reference ratio: never more for a slower lap, no jumps
    let prev = Infinity; for (let r = 0.98; r < 1.3; r += 0.0002) { const p = P.pacePoints(c, w, r); assert.ok(p <= prev + 1e-9, c + ' ' + w + ' ' + r); prev = p; }
    // continuous: a thousandth of a percent of lap time never moves the score by more than a tenth of a point
    for (let r = 0.999; r < 1.3; r += 0.0005) assert.ok(Math.abs(P.pacePoints(c, w, r) - P.pacePoints(c, w, r + 1e-5)) < 0.1, 'jump ' + c + ' ' + w + ' ' + r);
    assert.equal(P.pacePoints(c, w, 1), 50); assert.equal(P.pacePoints(c, w, 0.95), 50); assert.equal(P.pacePoints(c, w, 1.3), 0);
    // the anchors are the measured laps of the game's own drivers
    const A = P.paceAnchors(c, w);
    assert.deepEqual(A.map(a => a[1]), [50, 26, 12, 0]);
    for (let k = 0; k < A.length; k++) assert.ok(Math.abs(P.pacePoints(c, w, A[k][0]) - A[k][1]) < 1e-9);
    for (let k = 1; k < A.length; k++) assert.ok(A[k][0] > A[k - 1][0]);
  }
  for (const c of CIRC) {
    const L = tracks.get(c).length, R = P.paceRef(c, 0), seen = new Set();
    for (let k = 0; k <= 3000; k++) {
      const t = R * (1 + k * 0.0001), laps = [];
      for (let q = 0; q < 6; q++) laps.push({ t: q === 0 ? t + P.paceLaunch(c, 0) : t, water: 0, laneT: 0, laneD: 0, first: q === 0 });
      seen.add(P.paceScore(c, L, laps, 6, false).points);
    }
    for (let n = 0; n <= 50; n++) assert.ok(seen.has(n), c + ': ' + n + ' points reachable');
    // each circuit has its own reference, and every wet reference is slower than the dry one
    for (const w of [0.3, 0.6, 0.9]) assert.ok(P.paceRef(c, w) > P.paceRef(c, 0), c + ' wet ' + w);
  }
  const refs = CIRC.map(c => P.paceRef(c, 0)); assert.equal(new Set(refs).size, 6, 'no shared benchmark');
});

test('pace over the race: consistency counts, one fast lap cannot hide bad ones, standing starts and pit stops are normalised', () => {
  const c = 'silverstone', L = tracks.get(c).length, R = P.paceRef(c, 0), launch = P.paceLaunch(c, 0);
  const lap = (f, extra = {}) => Object.assign({ t: R * f, water: 0, laneT: 0, laneD: 0, first: false }, extra);
  const score = (laps, retired = false) => P.paceScore(c, L, laps, 6, retired).points;
  const clean = [lap(1.02, { t: R * 1.02 + launch, first: true }), ...[1, 2, 3, 4, 5].map(() => lap(1.02))];
  const base = score(clean);
  // standing start: lap 1 with the measured launch time scores like the flying laps
  assert.equal(score([lap(1.02, { t: R * 1.02 + launch, first: true })]), score([lap(1.02)]));
  // one exceptional lap among five slow ones does not reach a consistent driver's score
  const oneFast = [lap(1.0, { t: R + launch, first: true }), ...[1, 2, 3, 4, 5].map(() => lap(1.06))];
  assert.ok(score(oneFast) < base, 'one fast lap ' + score(oneFast) + ' vs consistent ' + base);
  // a mistake (4 s lost recovering) lowers the score; it is not excluded
  const mistake = clean.slice(); mistake[3] = lap(1.02, { t: R * 1.02 + 4 }); assert.ok(score(mistake) < base);
  // a pit lap: time in the lane is replaced by reference pace over its distance (the stop itself is not a driving error)
  const laneD = 420, laneT = 24, pitLap = lap(1.02, { t: R * 1.02 - laneD * R / L + laneT, laneT, laneD });
  const pitted = clean.slice(); pitted[3] = pitLap; assert.equal(score(pitted), base, 'a legitimate stop costs no pace points');
  // a slower lap is a slower lap: the comparison is like for like
  assert.ok(score([lap(1.03)]) < score([lap(1.02)]));
  // wet laps are measured against the wet reference and the wet anchors: matching the Rookie AI's measured lap in
  // the conditions scores the same in the dry and in the wet
  const rk = (w) => P.paceAnchors(c, w)[1][0], wet = (w) => ({ t: P.paceRef(c, w) * rk(w), water: w, laneT: 0, laneD: 0, first: false });
  assert.equal(score([wet(0.6)]), 26); assert.equal(score([wet(0)]), 26);
  assert.ok(score([lap(1.0, { water: 0.6 })]) === 50, 'a dry-pace lap in the wet is excellent');
  // retired: every lap not completed scores 0
  assert.ok(score(clean.slice(0, 3), true) < score(clean.slice(0, 3)) && Math.abs(score(clean.slice(0, 3), true) - Math.round(base / 2)) <= 1);
});

test('Career circuit score = position (50) + pace (50), capped at 100; the rank score is the six best, capped at 600', () => {
  const st = P.create();
  const r = career(st, 0, 'monza', 1, 50);
  assert.ok(r.ok); assert.equal(r.entry.total, 100); assert.equal(r.entry.posPts, 50);
  assert.equal(career(st, 0, 'monza', 20, 0).entry.total, 1);
  assert.equal(P.recordCareer(st, { rank: 0, circuit: 'monza', id: id(), pos: 1, dnf: false, pacePts: 51 }).ok, false, 'pace above 50 is invalid');
  for (const c of CIRC) career(st, 0, c, 1, 50);
  const s = P.status(st, 'career', 0); assert.equal(s.score, 600); assert.equal(s.max, 600);
});

test('replays: the best score per circuit counts, never the sum; a session counts once', () => {
  const st = P.create();
  const a = career(st, 0, 'spa', 5, 30); assert.equal(a.entry.total, 62);
  const lower = career(st, 0, 'spa', 10, 20); assert.ok(lower.ok && !lower.improved);
  assert.equal(P.status(st, 'career', 0).score, 62, 'a lower replay does not overwrite');
  const better = career(st, 0, 'spa', 2, 40); assert.ok(better.improved); assert.equal(better.previous.total, 62);
  assert.equal(P.status(st, 'career', 0).score, 84, 'replaced, not added');
  const rid = 'same-session'; assert.ok(P.recordCareer(st, { rank: 0, circuit: 'suzuka', id: rid, pos: 1, dnf: false, pacePts: 10 }).ok);
  assert.equal(P.recordCareer(st, { rank: 0, circuit: 'suzuka', id: rid, pos: 1, dnf: false, pacePts: 50 }).reason, 'duplicate');
  // farming one easy circuit cannot add up to a promotion
  for (let k = 0; k < 20; k++) career(st, 0, 'monza', 1, 50);
  assert.equal(P.status(st, 'career', 0).complete, false);
});

test('promotion needs all six circuits and the threshold: 360 for Pro, 420 for Master, 480 to complete', () => {
  assert.deepEqual(P.PROMOTE, [360, 420, 480]);
  const st = P.create();
  for (const c of CIRC.slice(0, 5)) career(st, 0, c, 1, 50);
  assert.equal(st.career.unlocked, 0, 'five perfect circuits are not enough (500 points, one circuit missing)');
  assert.equal(P.recordCareer(st, { rank: 1, circuit: 'monza', id: id(), pos: 1, dnf: false, pacePts: 50 }).reason, 'invalid', 'Pro is still locked');
  // all six at 59 = 354: below 360
  const st2 = P.create(); for (const c of CIRC) career(st2, 0, c, 5, 27);
  assert.equal(P.status(st2, 'career', 0).score, 354); assert.equal(st2.career.unlocked, 0);
  const up = career(st2, 0, 'monza', 4, 30); // 65 replaces 59: 360
  assert.equal(P.status(st2, 'career', 0).score, 360); assert.ok(up.unlockedNow); assert.equal(st2.career.unlocked, 1);
  for (const c of CIRC) career(st2, 1, c, 3, 31); // 70 each = 420
  assert.equal(st2.career.unlocked, 2);
  for (const c of CIRC.slice(0, 5)) career(st2, 2, c, 1, 50);
  assert.equal(st2.career.complete, false);
  career(st2, 2, 'interlagos', 20, 0); assert.equal(P.status(st2, 'career', 2).score, 501);
  assert.equal(st2.career.complete, true, 'Master complete');
  // completed ranks stay open to replay
  assert.ok(career(st2, 0, 'spa', 1, 50).ok);
});

test('retirements keep their classified position; unclassified or abandoned races give no result', () => {
  const st = P.create();
  const r = P.recordCareer(st, { rank: 0, circuit: 'bahrain', id: id(), pos: 17, dnf: true, pacePts: 12 });
  assert.ok(r.ok); assert.equal(r.entry.posPts, 5); assert.equal(r.entry.dnf, true);
  assert.equal(P.recordCareer(st, { rank: 0, circuit: 'bahrain', id: id(), pos: null, dnf: true, pacePts: 0 }).reason, 'unclassified');
  assert.equal(P.recordCareer(st, { rank: 0, circuit: 'summit', id: id(), pos: 1, dnf: false, pacePts: 0 }).reason, 'invalid');
});

test('Rival Duel and Pursuit: all six circuits attempted and five won; wins stay won; each mode on its own', () => {
  for (const mode of ['duel', 'pursuit']) {
    const st = P.create();
    for (const c of CIRC.slice(0, 5)) assert.ok(ranked(st, mode, 0, c, true).ok);
    assert.equal(st[mode].unlocked, 0, 'five wins but one circuit never attempted');
    const lost = ranked(st, mode, 0, 'interlagos', false);
    assert.ok(lost.ok && !lost.win); assert.ok(lost.unlockedNow, 'six attempted, five won: Pro unlocked');
    assert.equal(st[mode].unlocked, 1);
    // a lost replay never removes a win; repeated wins on one circuit count once
    ranked(st, mode, 0, 'monza', false); assert.equal(P.status(st, mode, 0).wins, 5);
    const st2 = P.create(); for (let k = 0; k < 6; k++) ranked(st2, mode, 0, 'monza', true);
    assert.equal(P.status(st2, mode, 0).wins, 1); assert.equal(st2[mode].results.rookie.monza.attempts, 6);
    // four of six is not enough
    const st3 = P.create(); CIRC.forEach((c, k) => ranked(st3, mode, 0, c, k < 4)); assert.equal(st3[mode].unlocked, 0);
    ranked(st3, mode, 0, 'bahrain', true); assert.equal(st3[mode].unlocked, 1, 'a retry won the fifth');
    // independent: the other modes are untouched
    const other = mode === 'duel' ? 'pursuit' : 'duel';
    assert.equal(st[other].unlocked, 0); assert.equal(st.career.unlocked, 0);
    // completing Master completes the mode
    for (const c of CIRC) ranked(st, mode, 1, c, true);
    for (const c of CIRC) ranked(st, mode, 2, c, true);
    assert.equal(st[mode].complete, true);
  }
});

test('saves: round trip, broken data never crashes or grants progress', () => {
  const st = P.create(); st.team = 7;
  for (const c of CIRC) career(st, 0, c, 2, 40);
  ranked(st, 'duel', 0, 'spa', true);
  const back = P.load(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(st)));
  for (const bad of [null, 7, 'x', [], { v: 3, career: 'nope' }, { v: 3, career: { unlocked: 9, results: { rookie: { monza: { total: 999 } } } } }]) {
    const s = P.load(bad); assert.equal(s.career.unlocked, 0); assert.equal(P.status(s, 'career', 0).score, 0);
  }
  // a tampered entry (total not matching its parts) is dropped, and unlocks follow from the results
  const t = JSON.parse(JSON.stringify(st)); t.career.results.rookie.monza.total = 100; t.career.unlocked = 2;
  const s2 = P.load(t); assert.equal(s2.career.results.rookie.monza, undefined); assert.equal(s2.career.unlocked, 2, 'a stored unlock is kept (it may come from a migration)');
});

test('migration from the five-tier Career and eight-rank modes: access kept, no results or wins invented', () => {
  // old Career v2: Rookie (100%) and Pro (125%) completed, a championship in progress with team 5
  const oldCareer = { v: 2, unlocked: 2, completed: [0, 1], best: [3, 6, 0, 0, 0], champion: false, active: { tier: 2, team: 5, attempt: 1, races: [], pending: null } };
  // old ranks: Initiate, Bronze, Silver (137%) won in Rival Duel; nothing in Pursuit
  const oldRanked = { v: 1, duel: { unlocked: 3, completed: [0, 1, 2], best: { initiate: { summit: { time: 150 } } }, seen: [] }, pursuit: { unlocked: 0, completed: [], best: {}, seen: [] } };
  const st = P.load(null, oldCareer, oldRanked);
  assert.equal(st.career.unlocked, 2, 'beaten 125% AI: Master (150%) is open');
  assert.equal(st.duel.unlocked, 2, 'beaten 137% AI: Master open');
  assert.equal(st.pursuit.unlocked, 0);
  assert.equal(st.team, 5);
  for (const mode of P.MODES) for (let k = 0; k < 3; k++) { const s = P.status(st, mode, k); assert.equal(s.attempted, 0, 'no circuit results invented'); assert.equal(s.complete, false); }
  assert.deepEqual(st.legacy.career, oldCareer); assert.deepEqual(st.legacy.ranked, oldRanked);
  // eight-tier Career (v1): Rookie only -> Pro open; nothing -> Rookie
  assert.equal(P.load(null, { v: 1, completed: [0], best: [] }, null).career.unlocked, 1);
  assert.equal(P.load(null, { v: 1, completed: [], best: [] }, null).career.unlocked, 0);
  // garbage old saves are harmless
  assert.equal(P.load(null, 'x', [1, 2]).career.unlocked, 0);
  // the migrated state saves and loads as version 3
  assert.equal(P.load(JSON.parse(JSON.stringify(st))).career.unlocked, 2);
});

test('a Career result from a real race: classification and pace from the laps driven', () => {
  const t = tracks.get('interlagos');
  const s = new SIM.Session(t, { type: 'race', laps: 2, gameMode: 'grandprix', aiLevel: 1, entries: SIM.DRIVERS.map((driver, k) => ({ driver, isPlayer: k === 9 })), seed: 3, spectate: true, weather: 'dry' });
  s.totalLaps = 2;
  const me = s.cars.find(c => c.isPlayer); me.ai = new SIM.AIDriver(me, s); // the player's car driven by the AI for the test
  while (!s.over && s.time < 400) s.fixedStep(SIM.PHYS_DT);
  assert.ok(s.over);
  const res = s.results.find(r => r.car === me);
  assert.equal(me.paceLaps.length, 2); assert.ok(me.paceLaps[0].first && !me.paceLaps[1].first);
  assert.ok(me.paceLaps.every(l => l.t > 60 && l.t < 90 && l.water === 0));
  const pace = P.paceScore('interlagos', t.length, me.paceLaps, 2, !!res.dnf);
  assert.ok(pace.points >= 0 && pace.points <= 50);
  const st = P.create(), out = P.recordCareer(st, { rank: 0, circuit: 'interlagos', id: 's1', pos: res.pos, dnf: !!res.dnf, pacePts: pace.points });
  assert.ok(out.ok); assert.equal(out.entry.total, P.positionPoints(res.pos) + pace.points);
});

test('Rival Duel: two cars side by side on the same line, fresh Softs, the same fuel, a fixed dry track, no pits', () => {
  for (const id of tracks.keys()) {
    for (const duelSide of [0, 1]) {
      const s = session(id, 'duel', { duelSide, startCompound: 'H', startFuelLaps: 7 });
      const [a, b] = s.cars, t = s.track;
      assert.equal(s.cars.length, 2);
      assert.equal(t.dS(a.s, b.s), 0, id + ': the same distance from the line');
      assert.ok(Math.abs(a.d + b.d) < 1e-6 && Math.abs(a.d - b.d) > 4, id + ': side by side, apart: ' + a.d.toFixed(2) + ' / ' + b.d.toFixed(2));
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 4, 'never the same coordinates');
      assert.equal(a.totalDist, b.totalDist);
      for (const c of s.cars) { assert.equal(c.tyre.c, 'S'); assert.ok(c.tyre.wear.every(w => w === 0)); assert.equal(c.fuel, s.fuelForLaps(SIM.RANKED_FUEL_LAPS)); assert.equal(c.launch.active, true); }
      assert.equal(a.mass, b.mass); assert.deepEqual(a.team.power, b.team.power); assert.equal(a.effClA(), b.effClA()); assert.equal(a.effCdA(), b.effCdA());
      assert.equal(s.weather, null); assert.equal(s.wet, 0); assert.equal(s.pitsEnabled, false);
      assert.equal(s.totalLaps, 2);
    }
    // the sides swap with duelSide (the game alternates it between attempts)
    const s0 = session(id, 'duel', { duelSide: 0 }), s1 = session(id, 'duel', { duelSide: 1 });
    assert.equal(s0.cars[0].d, s1.cars[1].d); assert.equal(s0.cars[1].d, s1.cars[0].d);
  }
  assert.throws(() => session('monza', 'duel', { entries: SIM.DRIVERS.slice(0, 3).map(driver => ({ driver })) }), /exactly two/);
});

test('Pursuit: the rival starts ahead by the calibrated head start on part-worn Softs; same lights, same timing, same fuel', () => {
  for (const id of tracks.keys()) {
    let prev = 0;
    for (const r of RANKS) {
      const s = session(id, 'pursuit', { pursuit: { gap: r.gap, rivalWear: r.wear, rival: 1 }, aiLevel: r.level });
      const [me, rv] = s.cars, t = s.track;
      assert.equal(s.pursuit.rival, rv); assert.equal(s.pursuit.chaser, me);
      const ahead = t.dS(me.s, rv.s);
      assert.ok(Math.abs(ahead - s.pursuit.headStart) < 0.01, id + ' ' + r.name + ': ' + ahead);
      assert.ok(ahead >= prev, 'a head start no shorter for a larger gap'); prev = ahead;
      assert.ok(rv.totalDist > 0 && rv.crossings === 1 && rv.laps === 0, 'already on lap 1, beyond the line');
      assert.ok(Math.abs(rv.d - me.d) < 0.3, 'same line: ' + rv.d.toFixed(3) + ' ' + me.d.toFixed(3));
      // the rival stands on the fast start of the lap, not in a corner (on Silverstone's short Hamilton Straight Abbey
      // follows soon after)
      assert.ok(t.refSpeed[t.wrapI(Math.round(rv.s / SIM.DS))] > 0.75 * Math.max(...t.refSpeed), id + ': still on the straight');
      assert.equal(me.tyre.c, 'S'); assert.ok(me.tyre.wear.every(w => w === 0));
      assert.equal(rv.tyre.c, 'S'); assert.ok(rv.tyre.wear.every(w => w === r.wear));
      assert.equal(me.fuel, rv.fuel); assert.equal(me.launch.active, true); assert.equal(rv.launch.active, true);
    }
  }
  // both are held by the same lights and both clocks start at lights out; the rival's short first lap is not a lap time
  const s = session('monza', 'pursuit');
  const [me, rv] = s.cars;
  while (!s.lightsOut) s.fixedStep(SIM.PHYS_DT);
  assert.equal(me.lapStart, rv.lapStart); assert.equal(rv.sectorStart, s.lightsOutTime);
  assert.ok(me.speed < 1 && rv.speed < 1, 'both from rest');
  while (rv.laps < 1) s.fixedStep(SIM.PHYS_DT);
  assert.equal(rv.lapTimes[0].valid, false, 'a shortened first lap is never a best lap');
});

test('no artificial catch-up: the rival\'s AI, tyres and physics are the shared ones throughout the race', () => {
  const s = session('silverstone', 'pursuit', { aiLevel: 1.4, pursuit: { gap: 2, rivalWear: 0.25, rival: 1 } });
  const rv = s.cars[1], ai = rv.ai, fixed = JSON.stringify([ai.commit, ai.brakeCommit, ai.mistakeScale, ai.skill, ai.p]);
  const wearRate = [];
  let lastW = rv.tyre.wear[0], lastD = rv.totalDist;
  while (!s.over && s.time < 300) {
    s.fixedStep(SIM.PHYS_DT);
    if (s.step % 2400 === 0 && s.lightsOut) { wearRate.push((rv.tyre.wear[0] - lastW) / Math.max(1, rv.totalDist - lastD)); lastW = rv.tyre.wear[0]; lastD = rv.totalDist; }
    // gap-independent: nothing about the rival's driver changes with the race situation
    assert.equal(JSON.stringify([ai.commit, ai.brakeCommit, ai.mistakeScale, ai.skill, ai.p]), fixed);
  }
  assert.ok(wearRate.every(w => w >= 0), 'the worn set keeps wearing normally');
  assert.equal(s.stats.pitstops, 0);
});

test('a race-ending crash does not neutralise the race: the other car races on at full speed', () => {
  for (const mode of ['duel', 'pursuit']) {
    const s = session('monza', mode, { entries: [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1] }] }); // both AI-driven: the survivor must race on
    while (!s.lightsOut || s.time - s.lightsOutTime < 20) s.fixedStep(SIM.PHYS_DT);
    s.startRetirement(s.cars[1], 'Accident damage');
    let vmax = 0; for (let k = 0; k < 240 * 20; k++) { s.fixedStep(SIM.PHYS_DT); vmax = Math.max(vmax, s.cars[0].speed); }
    assert.ok(vmax > 60, mode + ': racing speed after the incident ' + (vmax * 3.6).toFixed(0) + ' km/h');
    assert.equal(s.vsc, undefined);
  }
});

test('real races on every circuit: legitimate completion decides; Pursuit is won only by finishing ahead', () => {
  for (const id of tracks.keys()) {
    // Rival Duel between two AI drivers: the first to complete two laps wins, the classification follows
    const d = session(id, 'duel', { entries: [{ driver: SIM.DRIVERS[4] }, { driver: SIM.DRIVERS[9] }], aiLevel: 1.25, seed: 21 });
    while (!d.over && d.time < 420) d.fixedStep(SIM.PHYS_DT);
    assert.ok(d.over, id + ' duel over');
    const w = d.winner; assert.ok(w && w.finished && w.laps === 2);
    assert.equal(d.results[0].car, w);
    const loser = d.results[1].car; assert.ok(!loser.finished || loser.finishTime > w.finishTime);
    for (const c of d.cars) assert.ok(c.totalDist >= 2 * d.track.length - 1 || !c.finished, 'the full distance');
    // Pursuit: a stronger chaser against a weak rival with a short head start, and the reverse
    for (const [chaser, gap] of [[1.5, 1], [1, 4]]) {
      const s = session(id, 'pursuit', { entries: [{ driver: SIM.DRIVERS[0], aiSkill: SIM.aiSkillForLevel(chaser) }, { driver: SIM.DRIVERS[8] }], aiLevel: chaser === 1.5 ? 1 : 1.5,
        pursuit: { gap, rivalWear: 0.25, rival: 1 }, seed: 5 });
      while (!s.over && s.time < 420) s.fixedStep(SIM.PHYS_DT);
      assert.ok(s.over, id + ' pursuit over');
      const P = s.pursuit, won = s.winner === P.chaser;
      assert.equal(won, Number.isFinite(P.finalGap) && P.finalGap < 0, id + ': the chaser wins exactly when it finishes ahead (' + P.finalGap + ')');
      if (won) assert.ok(P.chaser.finishTime < (P.rival.finished ? P.rival.finishTime : Infinity));
    }
  }
});
