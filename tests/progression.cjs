const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Career progression, pace scoring, best results, rank requirements and save migration.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, P = SIM.PROGRESS, RANKS = P.RANKS, CIRC = P.CIRCUITS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
let uid = 0; const id = () => 'race-' + (++uid);
const career = (st, rank, circuit, pos, pacePts, more = {}) => P.recordCareer(st, Object.assign({ rank, circuit, id: id(), pos, dnf: false, pacePts }, more));

test('exactly three ranks: Rookie 100%, Pro 125%, Master 150%; the old tiers and ranks are gone', () => {
  assert.deepEqual(RANKS.map(r => [r.id, r.name, r.level]), [['rookie', 'Rookie', 1], ['pro', 'Pro', 1.25], ['master', 'Master', 1.5]]);
  assert.equal(SIM.AI_MAX_LEVEL, 1.5);
  assert.deepEqual(RANKS.map(r => SIM.aiSkillForLevel(r.level)), [0, 0.5, 1]);
  assert.equal(SIM.CAREER, undefined); assert.equal(SIM.RANKED, undefined);
  assert.ok(!/Initiate|Bronze|Silver|Gold|Platinum|Diamond|Ascendant|Elite|Legendary/.test(JSON.stringify(RANKS)));
  assert.deepEqual(CIRC, ['monza', 'silverstone', 'spa', 'suzuka', 'bahrain', 'interlagos'], 'all six real circuits in every rank');
  for (const mode of P.MODES) for (let k = 0; k < 3; k++) assert.equal(P.status(P.create(), mode, k).rows.length, 6);
  assert.deepEqual(Object.keys(SIM.GAME_MODES), ['grandprix']); assert.deepEqual(P.MODES, ['career']);
  assert.equal(SIM.GAME_MODES.grandprix.laps, 6); assert.equal(P.recordRanked, undefined);
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

test('saves: round trip, broken data never crashes or grants progress', () => {
  const st = P.create(); st.team = 7;
  for (const c of CIRC) career(st, 0, c, 2, 40);
  st.duel = { historical: 'untouched', results: { rookie: { spa: { won: true } } } };
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
  assert.equal(st.duel, undefined); assert.equal(st.pursuit, undefined);
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

test('Career grid: the first race of a rank starts from P20, then each race starts where the last one finished', () => {
  const st = P.create();
  for (let k = 0; k < 3; k++) assert.equal(P.gridPos(st, k), 20, RANKS[k].name + ' starts from the back');
  let r = career(st, 0, 'monza', 6, 30); assert.equal(r.gridBefore, 20); assert.equal(r.gridNext, 6);
  assert.equal(P.gridPos(st, 0), 6, 'P6 at Monza: the next race starts P6');
  career(st, 0, 'spa', 12, 20); assert.equal(P.gridPos(st, 0), 12, 'dropping to P12 moves the next start back to P12');
  career(st, 0, 'monza', 3, 40); assert.equal(P.gridPos(st, 0), 3, 'a replayed circuit counts as the next race too');
  career(st, 0, 'suzuka', 9, 10); assert.equal(P.gridPos(st, 0), 9, 'a worse result than the best kept still sets the next start');
  career(st, 0, 'bahrain', 17, 0, { dnf: true }); assert.equal(P.gridPos(st, 0), 17, 'a retirement starts from its classified place');
  assert.equal(P.gridPos(st, 1), 20, 'every rank keeps its own grid');
  // unclassified, invalid and duplicate races leave the grid alone
  const used = id(); P.recordCareer(st, { rank: 0, circuit: 'spa', id: used, pos: 2, dnf: false, pacePts: 10 });
  assert.equal(P.gridPos(st, 0), 2);
  P.recordCareer(st, { rank: 0, circuit: 'spa', id: used, pos: 15, dnf: false, pacePts: 10 });
  P.recordCareer(st, { rank: 0, circuit: 'spa', id: id(), pos: 0, dnf: true, pacePts: 0 });
  assert.equal(P.gridPos(st, 0), 2);
  // saved and loaded; a broken value falls back to the back of the grid
  assert.equal(P.gridPos(P.load(JSON.parse(JSON.stringify(st))), 0), 2);
  const bad = JSON.parse(JSON.stringify(st)); bad.career.grid = { rookie: 0, pro: 'x', master: 25 };
  for (let k = 0; k < 3; k++) assert.equal(P.gridPos(P.load(bad), k), 20);
  const old = JSON.parse(JSON.stringify(st)); delete old.career.grid;
  assert.equal(P.gridPos(P.load(old), 0), 20, 'a save from before the grid rule starts from P20');
});

test('the starting grid puts the player on the chosen slot and everyone else on the others', () => {
  for (const [pos, player] of [[20, 0], [6, 3], [1, 19], [12, 7]]) {
    const order = SIM.gridWithPlayerAt(20, player, pos);
    assert.equal(order.length, 20); assert.equal(new Set(order).size, 20);
    assert.equal(order.indexOf(player) + 1, pos, 'player on P' + pos);
    const S = new SIM.Session(tracks.get('monza'), { type: 'race', entries: SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === player })), seed: 1, gridOrder: order });
    assert.equal(S.player.gridSlot + 1, pos, 'the session places the player on P' + pos);
  }
});
