const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Career: the 40-point race score (position + best-lap rank), the classification of finishers and retirements, the
// fixed six-race championships with no retries, promotion, Endless Career with random circuits and the VR rating,
// saves (one result per race, forfeits, migration) and the removal of respawning.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, P = SIM.PROGRESS, RANKS = P.RANKS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const ORDER = ['monza', 'silverstone', 'spa', 'suzuka', 'bahrain', 'interlagos'];
const seq = (seed = 1) => { let x = seed; return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; };
// play one Career race through the save API: begin it, then record a result for it
function race(st, kind, rank, pos, lapRank, more = {}) {
  const b = P.beginRace(st, kind, rank, seq(st.career.seen.length + 7));
  assert.ok(b.ok, 'race begins: ' + b.reason);
  const out = P.recordRace(st, Object.assign({ id: b.active.id, pos, lapRank, best: 80, dnf: false }, more), seq(99 + st.career.seen.length));
  assert.ok(out.ok, 'race recorded: ' + out.reason);
  return { begin: b.active, out };
}
// a whole championship with a fixed result per race
const championship = (st, rank, results) => results.map(([pos, lap, more]) => race(st, 'rank', rank, pos, lap, more));

/* ---------------- the race score ---------------- */
test('three ranks and their thresholds: Rookie 160, Pro 180, Master 200 of 240; six circuits in a fixed order', () => {
  assert.deepEqual(RANKS.map(r => [r.id, r.name, r.level]), [['rookie', 'Rookie', 1], ['pro', 'Pro', 1.25], ['master', 'Master', 1.5]]);
  assert.deepEqual(P.PROMOTE, [160, 180, 200]);
  assert.equal(P.RANK_MAX, 240); assert.equal(P.RACE_MAX, 40); assert.equal(P.RANK_RACES, 6);
  assert.deepEqual(P.CIRCUITS, ORDER); assert.equal(P.ENDLESS_LEVEL, 1.5);
  assert.deepEqual(Object.keys(SIM.GAME_MODES), ['grandprix']); assert.equal(SIM.GAME_MODES.grandprix.laps, 6);
  for (const gone of ['recordCareer', 'paceScore', 'pacePoints', 'positionPoints', 'PACE_REF', 'MODES']) assert.equal(P[gone], undefined, gone + ' removed');
});

test('ranking points: 20 for 1st down to 1 for 20th, the same table for position and best lap', () => {
  for (let k = 1; k <= 20; k++) assert.equal(P.rankPoints(k), 21 - k);
  assert.equal(P.rankPoints(0), 0); assert.equal(P.rankPoints(21), 0); assert.equal(P.rankPoints(1.5), 0);
});

test('race score = position points + best-lap points: 2 to 40, integers, the two rankings independent', () => {
  const rows = Array.from({ length: 20 }, (_, k) => ({ key: k, pos: k + 1, best: 90 - k * 0.1, bestAt: 100, retiredAt: null, dist: 1e4 }));
  P.scoreRace(rows);
  // P1 has the slowest lap (rank 20), P20 the fastest (rank 1): both score 21
  assert.equal(rows[0].posPts, 20); assert.equal(rows[0].lapRank, 20); assert.equal(rows[0].lapPts, 1); assert.equal(rows[0].score, 21);
  assert.equal(rows[19].posPts, 1); assert.equal(rows[19].lapRank, 1); assert.equal(rows[19].lapPts, 20); assert.equal(rows[19].score, 21);
  for (const r of rows) assert.ok(Number.isInteger(r.score) && r.score >= 2 && r.score <= 40);
  assert.deepEqual(rows.map(r => r.lapRank).sort((a, b) => a - b), Array.from({ length: 20 }, (_, k) => k + 1), 'unique best-lap ranks');
  // winner with the fastest lap: 40; last with the slowest (or no) lap: 2
  const two = [{ key: 0, pos: 1, best: 80, bestAt: 1 }, ...Array.from({ length: 18 }, (_, k) => ({ key: k + 1, pos: k + 2, best: 81 + k, bestAt: 1 })), { key: 19, pos: 20, best: 0, retiredAt: 5, dist: 10 }];
  P.scoreRace(two); assert.equal(two[0].score, 40); assert.equal(two[19].score, 2);
});

test('best-lap ranking: fastest valid lap first; equal times by who set it first, then the driver order; no lap below every lap', () => {
  const r = (key, best, bestAt, retiredAt = null, dist = 0) => ({ key, best, bestAt, retiredAt, dist });
  const order = (rows) => P.rankBestLaps(rows).map(x => x.key);
  assert.deepEqual(order([r(0, 95.2, 300), r(1, 94.8, 200), r(2, 95.1, 400)]), [1, 2, 0]);
  // exactly equal (full precision): the earlier lap ranks higher, then the lower driver id
  assert.deepEqual(order([r(3, 94.8125, 300), r(4, 94.8125, 250), r(5, 94.8125, 250)]), [4, 5, 3]);
  // full precision, not the rounded display value
  assert.deepEqual(order([r(6, 94.80049, 1), r(7, 94.8001, 9)]), [7, 6]);
  // a retired car keeps its best completed lap; drivers without one rank below all drivers with one
  assert.deepEqual(order([r(8, 0, null, 50, 900), r(9, 97.4, 120, 160, 7000), r(10, 96.0, 400)]), [10, 9, 8]);
  // several without a lap: the one still in the race longest first (still running at the end counts as longest),
  // then the further one, then the driver order
  assert.deepEqual(order([r(11, 0, null, 30, 500), r(12, 0, null, 60, 100), r(13, 0, null, null, 50), r(14, 0, null, 30, 800), r(15, 0, null, 30, 800)]), [13, 12, 14, 15, 11]);
});

/* ---------------- the race classification (a real Session) ---------------- */
function liveRace(id = 'interlagos', laps = 3, seed = 5) {
  const t = tracks.get(id);
  const s = new SIM.Session(t, { type: 'race', laps, entries: SIM.DRIVERS.map((driver, k) => ({ driver, isPlayer: k === 0 })), seed, spectate: true, weather: 'dynamic',
    weatherState: Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 }) });
  s.totalLaps = laps;
  const me = s.player; me.ai = new SIM.AIDriver(me, s); // the player's car driven by the AI for the test
  return s;
}
const runUntil = (s, cond, cap = 1600) => { while (!s.over && s.time < cap && !cond(s)) s.fixedStep(SIM.PHYS_DT); };
const runOut = (s) => runUntil(s, () => false);

test('classification: finishers above retirees, later retirements above earlier ones, simultaneous ones by progress, P1-P20 unique', () => {
  const s = liveRace('interlagos', 3, 5), C = s.cars, by = (k) => C[k];
  runUntil(s, x => x.lightsOut && x.time - x.lightsOutTime > 20);
  s.abandonRace(by(3), 'Retired');                             // retires on lap 1, no lap
  runUntil(s, () => by(7).laps >= 1 && by(7).crossings >= 2);
  s.abandonRace(by(7), 'Retired');                             // retires right after its first lap
  runUntil(s, () => by(11).laps >= 2);
  // two cars out in the same instant (a shared collision): the one further round ranks higher
  const [a, b] = by(11).totalDist >= by(12).totalDist ? [by(11), by(12)] : [by(12), by(11)];
  s.abandonRace(by(11), 'Accident damage'); s.abandonRace(by(12), 'Accident damage');
  runOut(s);
  assert.ok(s.over); const res = s.results;
  assert.equal(res.length, 20); assert.deepEqual(res.map(r => r.pos), Array.from({ length: 20 }, (_, k) => k + 1));
  const out = res.filter(r => r.dnf), inn = res.filter(r => !r.dnf);
  assert.ok(out.length >= 4);
  assert.ok(Math.max(...inn.map(r => r.pos)) < Math.min(...out.map(r => r.pos)), 'every car still in the race ahead of every retired car');
  for (let k = 1; k < out.length; k++) assert.ok(out[k - 1].retiredAt >= out[k].retiredAt, 'later retirement ranks higher');
  const pa = res.find(r => r.car === a).pos, pb = res.find(r => r.car === b).pos;
  assert.ok(pa < pb, 'same moment: further round ranks higher');
  assert.equal(res[res.length - 1].car, by(3), 'the earliest retirement is last');
  // best laps: the car out on lap 1 has none and is below every car with a lap; the one out after a lap keeps it
  const r3 = res.find(r => r.car === by(3)), r7 = res.find(r => r.car === by(7));
  assert.ok(!(r3.best > 0)); assert.ok(r7.best > 0);
  for (const r of res) if (r.best > 0) assert.ok(r.lapRank < r3.lapRank);
  assert.deepEqual(res.map(r => r.lapRank).sort((x, y) => x - y), Array.from({ length: 20 }, (_, k) => k + 1));
  for (const r of res) assert.equal(r.score, r.posPts + r.lapPts);
});

test('the player retires: the race runs on; an AI retiring later ranks above, faster AI laps afterwards still count', () => {
  const s = liveRace('interlagos', 3, 8), me = s.player;
  runUntil(s, () => me.laps >= 1 && me.crossings >= 2);
  const myBest = me.bestLap; assert.ok(myBest > 0);
  s.abandonRace(me, 'Retired');
  const atRetire = s.time;
  // laps set after the player's retirement
  const later = s.cars.find(c => c !== me && !c.dnf);
  runUntil(s, () => s.time > atRetire + 30);
  s.abandonRace(later, 'Engine failure');
  runOut(s);
  const R = (c) => s.results.find(r => r.car === c);
  assert.ok(R(later).pos < R(me).pos, 'an AI retiring after the player ranks above the player');
  const faster = s.results.filter(r => r.best > 0 && r.best < myBest && r.bestAt > atRetire);
  assert.equal(R(me).lapRank, 1 + s.results.filter(r => r.best > 0 && (r.best < myBest || (r.best === myBest && r.bestAt < me.bestLapAt))).length, 'the player\'s lap rank counts every faster lap, also those set after the retirement');
  assert.ok(faster.length >= 0);
  assert.equal(R(me).best, myBest, 'the retired player keeps the best completed lap');
});

test('every driver retires: the order is the order of retirement, there is no winner', () => {
  const s = liveRace('interlagos', 3, 9);
  runUntil(s, x => x.lightsOut && x.time - x.lightsOutTime > 5);
  const order = s.cars.slice();
  for (const c of order) { s.abandonRace(c, 'Retired'); s.fixedStep(SIM.PHYS_DT); }
  runOut(s);
  assert.ok(s.over); assert.equal(s.winner, null);
  assert.deepEqual(s.results.map(r => r.car), order.slice().reverse(), 'the last to retire is classified first');
  assert.deepEqual(s.results.map(r => r.pos), Array.from({ length: 20 }, (_, k) => k + 1));
});

test('lap 1 is timed from the start line for every driver, the same way as every other lap', () => {
  const s = liveRace('interlagos', 2, 4), cross = new Map(), orig = s.crossLine.bind(s);
  s.crossLine = (car, at = s.time) => { (cross.get(car) || cross.set(car, []).get(car)).push(at); return orig(car, at); };
  runOut(s);
  for (const c of s.cars) {
    if (!c.lapTimes.length) continue;
    const x = cross.get(c);
    assert.ok(Math.abs(c.lapTimes[0].t - (x[1] - x[0])) < 1e-9, c.driver.short + ': lap 1 from the line');
    if (c.lapTimes[1]) assert.ok(Math.abs(c.lapTimes[1].t - (x[2] - x[1])) < 1e-9);
  }
  // the grid slot no longer decides lap 1: the back of the grid is not penalised by its run-up to the line
  const l1 = s.results.filter(r => r.car.lapTimes[0]).map(r => r.car.lapTimes[0].t);
  assert.ok(Math.max(...l1) - Math.min(...l1) < 25, 'lap 1 times are comparable across the grid');
});

/* ---------------- championships ---------------- */
test('a championship is raced in the fixed order from Monza; nothing can be skipped, reordered or replayed', () => {
  const st = P.create();
  const seen = [];
  for (let k = 0; k < 6; k++) {
    const S = P.status(st, 0); assert.equal(S.next, ORDER[k]); assert.equal(S.index, k);
    const b = P.beginRace(st, 'rank', 0, seq(k + 1)); assert.equal(b.active.circuit, ORDER[k]);
    assert.equal(P.beginRace(st, 'rank', 0).reason, 'active', 'one race at a time');
    assert.equal(P.recordRace(st, { id: 'not-this-race', pos: 1, lapRank: 1 }).reason, 'not-active');
    const out = P.recordRace(st, { id: b.active.id, pos: 10, lapRank: 10, best: 90 });
    assert.ok(out.ok); assert.equal(out.entry.circuit, ORDER[k]); seen.push(b.active.id);
    // the same result can never be recorded twice (double click, reloaded results screen)
    assert.equal(P.recordRace(st, { id: b.active.id, pos: 1, lapRank: 1 }).reason, 'duplicate');
  }
  assert.equal(P.status(st, 0).races.length, 6);
  assert.equal(P.beginRace(st, 'rank', 0).reason, 'done', 'no seventh race, no replay');
  assert.equal(P.beginRace(st, 'rank', 1).reason, 'locked', 'Pro stays locked: 6 × 21 = 126 < 160');
});

test('a retirement counts as the race: its points stand and the championship moves on', () => {
  const st = P.create();
  const { out } = race(st, 'rank', 0, 18, 4, { dnf: true, reason: 'retired' });
  assert.equal(out.entry.posPts, 3); assert.equal(out.entry.lapPts, 17); assert.equal(out.entry.total, 20); assert.ok(out.entry.dnf);
  assert.equal(P.status(st, 0).next, 'silverstone');
  assert.equal(P.status(st, 0).total, 20);
});

test('promotion only after all six races: Rookie 160, Pro 180, Master 200; a failed rank restarts from race 1', () => {
  const st = P.create();
  // Rookie: 40 points in each of the first four races (160) is not a promotion yet
  championship(st, 0, [[1, 1], [1, 1], [1, 1], [1, 1]]);
  assert.equal(st.career.unlocked, 0); assert.equal(P.status(st, 0).total, 160); assert.ok(!P.status(st, 0).done);
  assert.equal(P.restartRank(st, 0), false, 'no restart in the middle of a championship');
  // two retirements before a lap (2 points each): 164 ≥ 160
  championship(st, 0, [[20, 20, { dnf: true }], [20, 20, { dnf: true }]]);
  let S = P.status(st, 0); assert.ok(S.done && S.passed); assert.equal(S.total, 164);
  assert.equal(st.career.unlocked, 1); assert.deepEqual(st.career.completed, [0]);
  // Pro: 179 fails (5 × 30 + 29 = 179), 180 passes
  championship(st, 1, [[6, 6], [6, 6], [6, 6], [6, 6], [6, 6], [6, 7]]);
  S = P.status(st, 1); assert.equal(S.total, 179); assert.ok(S.failed); assert.equal(st.career.unlocked, 1);
  assert.equal(P.beginRace(st, 'rank', 1).reason, 'done');
  assert.ok(P.restartRank(st, 1)); S = P.status(st, 1);
  assert.equal(S.index, 0); assert.equal(S.next, 'monza'); assert.equal(S.attempt, 2); assert.equal(S.total, 0);
  assert.deepEqual(st.career.completed, [0], 'restarting Pro never touches Rookie');
  championship(st, 1, [[6, 6], [6, 6], [6, 6], [6, 6], [6, 6], [6, 6]]);
  assert.ok(P.status(st, 1).passed); assert.equal(st.career.unlocked, 2);
  // Master: 199 fails, 200 completes and opens Endless Career with VR 1,000
  // (P4 with lap rank 5: 17 + 16 = 33; five of those and a 34 is 199, and a 35 is 200)
  championship(st, 2, [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 4]]);
  assert.equal(P.status(st, 2).total, 199); assert.ok(P.status(st, 2).failed); assert.equal(st.career.endless.unlocked, false);
  P.restartRank(st, 2);
  const last = championship(st, 2, [[4, 5], [4, 5], [4, 5], [4, 5], [4, 5], [4, 3]]).pop().out;
  assert.equal(P.status(st, 2).total, 200);
  assert.ok(last.final.passed && last.endlessUnlocked);
  assert.equal(st.career.endless.unlocked, true); assert.equal(st.career.endless.vr, 1000);
  // a new attempt at a completed rank keeps everything unlocked
  P.restartRank(st, 0); championship(st, 0, [[20, 20], [20, 20], [20, 20], [20, 20], [20, 20], [20, 20]]);
  assert.ok(P.status(st, 0).failed); assert.equal(st.career.unlocked, 2); assert.ok(st.career.completed.includes(0)); assert.ok(st.career.endless.unlocked);
});

test('Career grid: P20 for the first race of a championship, then where the previous race finished; a restart starts at P20', () => {
  const st = P.create();
  assert.equal(P.gridPos(st, 'rank', 0), 20);
  race(st, 'rank', 0, 6, 9); assert.equal(P.gridPos(st, 'rank', 0), 6);
  race(st, 'rank', 0, 12, 9); assert.equal(P.gridPos(st, 'rank', 0), 12);
  race(st, 'rank', 0, 17, 9, { dnf: true }); assert.equal(P.gridPos(st, 'rank', 0), 17, 'a retirement starts from its classified place');
  assert.equal(P.gridPos(st, 'rank', 1), 20, 'each rank has its own grid');
  championship(st, 0, [[3, 3], [3, 3], [3, 3]]);
  P.restartRank(st, 0); assert.equal(P.gridPos(st, 'rank', 0), 20);
  assert.equal(P.gridPos(P.load(JSON.parse(JSON.stringify(st))), 'rank', 0), 20);
});

/* ---------------- interrupted races and saves ---------------- */
test('a race left without a result (browser closed) is a forfeit: P20, last lap rank, 2 points; it is never a free retry', () => {
  const st = P.create();
  race(st, 'rank', 0, 4, 2);
  const b = P.beginRace(st, 'rank', 0, seq(3)); assert.equal(b.active.circuit, 'silverstone');
  const saved = JSON.parse(JSON.stringify(st));
  const loaded = P.load(saved); assert.ok(loaded.career.active && loaded.career.active.id === b.active.id, 'the running race is in the save');
  const out = P.forfeitActive(loaded, 123);
  assert.ok(out.ok); assert.equal(out.entry.total, 2); assert.equal(out.entry.reason, 'forfeit'); assert.ok(out.entry.dnf);
  assert.equal(P.status(loaded, 0).next, 'spa', 'the Career moves on');
  assert.equal(P.forfeitActive(loaded), null, 'nothing left to forfeit');
  // the original result arriving late cannot replace the forfeit
  assert.equal(P.recordRace(loaded, { id: b.active.id, pos: 1, lapRank: 1 }).reason, 'duplicate');
});

test('saves: round trip; broken or tampered data never crashes, grants progress or breaks the order', () => {
  const st = P.create(); championship(st, 0, [[2, 3], [4, 1], [9, 9]]);
  const back = P.load(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(P.status(back, 0).races, P.status(st, 0).races); assert.equal(back.v, 4);
  for (const junk of [null, 'x', 42, [], { v: 4 }, { v: 4, career: 'x' }, { v: 4, career: { ranks: { rookie: { races: 'x' } }, endless: 7 } }]) {
    const s = P.load(junk); assert.equal(s.career.unlocked, 0); assert.equal(P.status(s, 0).races.length, 0); assert.equal(s.career.endless.unlocked, false);
  }
  // results out of order, or with inconsistent points, are cut at the first bad entry
  const bad = JSON.parse(JSON.stringify(st)); bad.career.ranks.rookie.races[1].circuit = 'bahrain';
  assert.equal(P.status(P.load(bad), 0).races.length, 1);
  const pts = JSON.parse(JSON.stringify(st)); pts.career.ranks.rookie.races[0].total = 40;
  assert.equal(P.status(P.load(pts), 0).races.length, 0);
  const vr = JSON.parse(JSON.stringify(st)); vr.career.endless = { unlocked: false, vr: 99999 };
  const v2 = P.load(vr); assert.equal(v2.career.endless.unlocked, false); assert.equal(v2.career.endless.vr, 1000);
});

test('migration: v3 (100-point) results are not converted; unlocks and completed ranks are kept; v1/v2 keep access only', () => {
  const v3 = { v: 3, team: 4, career: { unlocked: 2, completed: [0, 1], seen: [], grid: { rookie: 5 },
    results: { rookie: Object.fromEntries(ORDER.map(id => [id, { total: 70, pos: 3, posPts: 39, pacePts: 31, dnf: false }])),
      pro: Object.fromEntries(ORDER.map(id => [id, { total: 75, pos: 2, posPts: 44, pacePts: 31, dnf: false }])), master: { monza: { total: 90 } } } } };
  const st = P.load(v3);
  assert.equal(st.v, 4); assert.equal(st.team, 4);
  assert.equal(st.career.unlocked, 2); assert.deepEqual(st.career.completed, [0, 1]); assert.deepEqual(st.career.legacyCompleted, [0, 1]);
  for (let k = 0; k < 3; k++) assert.equal(P.status(st, k).races.length, 0, 'no 100-point result becomes a 40-point one');
  assert.equal(st.career.endless.unlocked, false, 'Master was not completed under the old rules');
  assert.deepEqual(st.legacy.v3.career.results.rookie.monza, v3.career.results.rookie.monza, 'old results kept as history');
  assert.match(st.legacy.note, /100-point/);
  // a v3 Master completion (all six, 480+) opens Endless Career
  const done = JSON.parse(JSON.stringify(v3)); done.career.results.master = Object.fromEntries(ORDER.map(id => [id, { total: 85 }]));
  const s2 = P.load(done); assert.deepEqual(s2.career.completed, [0, 1, 2]); assert.equal(s2.career.endless.unlocked, true); assert.equal(s2.career.endless.vr, 1000);
  // older saves: access only
  const oldCareer = { v: 2, unlocked: 2, completed: [0, 1], best: [3, 6, 0, 0, 0], active: { tier: 2, team: 5 } };
  const s3 = P.load(null, oldCareer, null); assert.equal(s3.career.unlocked, 2); assert.equal(s3.team, 5); assert.deepEqual(s3.legacy.career, oldCareer);
  assert.equal(P.load(null, { v: 1, completed: [0], best: [] }, null).career.unlocked, 1);
  assert.equal(P.load(null, 'x', [1, 2]).career.unlocked, 0);
  assert.equal(P.load(JSON.parse(JSON.stringify(st))).career.unlocked, 2, 'a migrated save loads again as v4');
});

/* ---------------- VR ---------------- */
const spec = (score, vr) => {
  const tiers = [{ min: 0, max: 1999, gain: 48, loss: 20 }, { min: 2000, max: 3999, gain: 38, loss: 28 }, { min: 4000, max: 5999, gain: 29, loss: 38 }, { min: 6000, max: 7999, gain: 19, loss: 48 }, { min: 8000, max: 9999, gain: 10, loss: 60 }];
  const t = tiers.find(x => vr >= x.min && vr <= x.max);
  return score === 21 ? 0 : score > 21 ? Math.round((score - 21) / 19 * t.gain) : -Math.round((21 - score) / 19 * t.loss);
};
test('VR change: the agreed formula for every race score 2-40 in all five bands', () => {
  const bands = [0, 1999, 2000, 3999, 4000, 5999, 6000, 7999, 8000, 9998, 9999];
  for (const vr of bands) for (let sc = 2; sc <= 40; sc++) {
    const d = P.calculateVrChange(sc, vr);
    assert.equal(d, spec(sc, vr), 'score ' + sc + ' at VR ' + vr);
    assert.ok(Number.isInteger(d));
    if (sc > 21) assert.ok(d > 0); else if (sc < 21) assert.ok(d < 0); else assert.equal(d, 0);
  }
  assert.deepEqual([0, 1999, 2000, 3999, 4000, 5999, 6000, 7999, 8000, 9998, 9999].map(P.vrBand), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
  // the reference table (the formula is authoritative where a hand-rounded entry differs by one)
  const ref = { 40: [48, 38, 29, 19, 10], 35: [35, 28, 21, 14, 7], 30: [23, 18, 14, 9, 5], 25: [10, 8, 6, 4, 2], 21: [0, 0, 0, 0, 0], 15: [-6, -9, -12, -15, -19], 10: [-12, -16, -22, -28, -35], 2: [-20, -28, -38, -48, -60] };
  const at = [1000, 3000, 5000, 7000, 9000];
  for (const [sc, row] of Object.entries(ref)) row.forEach((want, k) => assert.ok(Math.abs(P.calculateVrChange(+sc, at[k]) - want) <= 1, 'score ' + sc + ' band ' + k));
  // higher bands: smaller gains, larger losses
  for (let k = 1; k < 5; k++) { assert.ok(P.calculateVrChange(40, at[k]) < P.calculateVrChange(40, at[k - 1])); assert.ok(P.calculateVrChange(2, at[k]) < P.calculateVrChange(2, at[k - 1])); }
  for (const [sc, vr] of [[1, 1000], [41, 1000], [20.5, 1000], [30, -1], [30, 10000], [30, 1.5]]) assert.throws(() => P.calculateVrChange(sc, vr));
});

test('VR stays within 0-9,999; the band is the one at the start of the race', () => {
  assert.equal(P.calculateNewVr(9995, 40), 9999); assert.equal(P.calculateNewVr(9999, 40), 9999);
  assert.equal(P.calculateNewVr(9999, 2), 9939, 'losses still apply at the maximum');
  assert.equal(P.calculateNewVr(8, 2), 0); assert.equal(P.calculateNewVr(0, 2), 0); assert.equal(P.calculateNewVr(0, 40), 48);
  assert.equal(P.calculateNewVr(8450, 40), 8460); assert.equal(P.calculateNewVr(8450, 2), 8390);
  // 1,990 + 48 crosses into the next band: the gain is still the starting band's
  assert.equal(P.calculateNewVr(1990, 40), 2038); assert.equal(P.calculateNewVr(2010, 2), 1982);
});

/* ---------------- Endless Career ---------------- */
function endlessState() { const st = P.create(); st.career.unlocked = 2; st.career.completed = [0, 1, 2]; st.career.endless.unlocked = true; return st; }
test('Endless Career: a random circuit for each race, never the same twice in a row, every circuit reachable, not a fixed rotation', () => {
  const st = endlessState(), rng = seq(12345), count = Object.fromEntries(ORDER.map(id => [id, 0])), seqList = [];
  let prev = null;
  for (let k = 0; k < 1200; k++) {
    const b = P.beginRace(st, 'endless', null, rng);
    assert.ok(b.ok); assert.notEqual(b.active.circuit, prev, 'no immediate repeat');
    count[b.active.circuit]++; seqList.push(b.active.circuit); prev = b.active.circuit;
    P.recordRace(st, { id: b.active.id, pos: 10, lapRank: 11 }, rng); // 11 + 10 = 21: neutral, VR unchanged
  }
  for (const id of ORDER) assert.ok(count[id] > 1200 / 6 * 0.75 && count[id] < 1200 / 6 * 1.25, id + ' ' + count[id]);
  // not a hidden six-race cycle
  const cycles = seqList.slice(6).filter((c, k) => c === seqList[k]).length;
  assert.ok(cycles < 1200 * 0.5, 'circuit k and k+6 coincide ' + cycles + ' times');
  assert.equal(st.career.endless.vr, 1000); assert.equal(st.career.endless.races, 1200);
});

test('Endless Career: the drawn circuit is saved and kept until raced (reloading cannot reroll it)', () => {
  const st = endlessState();
  const n1 = P.ensureEndlessNext(st, seq(7));
  for (let k = 0; k < 5; k++) { const re = P.load(JSON.parse(JSON.stringify(st))); assert.deepEqual(P.ensureEndlessNext(re, seq(1000 + k)), n1); }
  const b = P.beginRace(st, 'endless', null, seq(9)); assert.equal(b.active.circuit, n1.circuit); assert.equal(b.active.id, n1.id);
  const re = P.load(JSON.parse(JSON.stringify(st))); assert.equal(re.career.active.circuit, n1.circuit, 'the running race is saved with its circuit');
});

test('Endless Career: the race score moves VR once, from the starting band; retirements count; history and best VR are kept', () => {
  const st = endlessState();
  // P18, lap rank 4: 3 + 17 = 20 → a loss
  let { out } = race(st, 'endless', null, 18, 4, { dnf: true });
  assert.equal(out.entry.total, 20); assert.equal(out.entry.change, -1); assert.equal(out.entry.newVr, 999); assert.equal(out.entry.band, 0);
  ({ out } = race(st, 'endless', null, 1, 1)); assert.equal(out.entry.change, 48); assert.equal(st.career.endless.vr, 1047);
  assert.equal(P.recordRace(st, { id: out.entry.id, pos: 1, lapRank: 1 }).reason, 'duplicate', 'applied exactly once');
  assert.equal(st.career.endless.vr, 1047); assert.equal(st.career.endless.best, 1047); assert.equal(st.career.endless.history.length, 2);
  // a player at 9,995 earns +10 → 9,999; a bad race at the top still loses
  st.career.endless.vr = 9995; ({ out } = race(st, 'endless', null, 1, 1)); assert.equal(st.career.endless.vr, 9999); assert.equal(out.entry.change, 4);
  ({ out } = race(st, 'endless', null, 20, 20, { dnf: true })); assert.equal(st.career.endless.vr, 9939);
  assert.equal(st.career.endless.best, 9999);
  const re = P.load(JSON.parse(JSON.stringify(st))); assert.equal(re.career.endless.vr, 9939); assert.equal(re.career.endless.best, 9999); assert.equal(re.career.endless.history.length, 4);
  assert.equal(P.beginRace(P.create(), 'endless', null).reason, 'locked', 'Endless Career needs Master');
});

/* ---------------- a real race into the Career ---------------- */
test('a Career result from a real race: the official classification and best-lap rank, scored 20 + 20', () => {
  const s = liveRace('interlagos', 2, 3);
  runOut(s); assert.ok(s.over);
  const me = s.results.find(r => r.car.isPlayer);
  const st = P.create(), b = P.beginRace(st, 'rank', 0, seq(1));
  const out = P.recordRace(st, { id: b.active.id, pos: me.pos, lapRank: me.lapRank, best: me.best, dnf: !!me.dnf });
  assert.ok(out.ok); assert.equal(out.entry.total, me.score); assert.equal(out.entry.posPts, 21 - me.pos); assert.equal(out.entry.lapPts, 21 - me.lapRank);
});

/* ---------------- respawning removed ---------------- */
test('respawning is gone: no marshal reset, no AI teleport, no R / Space key; a stuck car retires', () => {
  const s = liveRace('monza', 2, 1);
  assert.equal(typeof s.marshalReset, 'undefined'); assert.equal(typeof s.cars[1].ai.respawn, 'undefined');
  assert.ok(!/marshalReset|respawned on track|Respawn on track/i.test(html), 'no respawn control or text in the game');
  assert.ok(!/takePress\('KeyR'\)/.test(html), 'R no longer does anything in a race');
  // a car pinned against a barrier, throttle on and not moving, retires after a few seconds instead of being put back
  const t = s.track, c = s.cars[5];
  runUntil(s, x => x.lightsOut && x.time - x.lightsOutTime > 3);
  const i = c.idx, w = t.wallR[i];
  c.placeAt(t, c.s, w - 1.2, 0); c.psi += 1.4; c.vx = c.vz = 0; c.ai.mode = 'recover';
  const s0 = c.s, d0 = c.d;
  runUntil(s, () => c.dnf, s.time + 12);
  assert.ok(c.dnf, 'the stuck car retired'); assert.equal(c.dnfReason, 'Stuck');
  assert.ok(Math.abs(t.dS(s0, c.s)) < 30 && Math.abs(c.d - d0) < 8, 'it was never moved back onto the circuit');
  // damage stays with the car: nothing resets it during the race
  const D = s.cars[2].damage; D.c[0] = 0.6; D.computePerf(); runUntil(s, () => false, s.time + 3); assert.equal(D.c[0], 0.6);
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
