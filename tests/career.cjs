const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Career Mode: tiers, points, standings and tiebreakers, advancement, saves, and the AI behind each tier,
// checked through the game's own SIM (Session, AIDriver, RaceEngineer and the CAREER module).
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
// a fresh copy of the simulation (its own car ids and random generator), so two runs can be compared exactly
function loadSim() { const context = { module: { exports: {} } }; vm.runInNewContext(source, context); return context.module.exports; }
// the rules themselves run in this realm, so their arrays and objects compare structurally with the test's own
const shim = { exports: {} }; new Function('module', source)(shim);
const SIM = shim.exports, C = SIM.CAREER;

// a race classification in career form: `order` lists driver indices from P1 to P20; `dnf` the retired ones
function race(order, dnf = []) { return order.map((d, k) => ({ d, pos: k + 1, dnf: dnf.includes(d) })); }
const ids = (n) => Array.from({ length: n }, (_, k) => k);
// play a championship: each entry of `orders` is one race's finishing order
function play(st, tier, team, orders) {
  assert.ok(C.start(st, tier, team));
  let out;
  orders.forEach((order, k) => { out = C.record(st, { tier, team, race: k, id: 't' + tier + 'r' + k + 'a' + st.active.attempt }, race(order)); assert.ok(out.ok, out.reason); });
  return out;
}
// the player (driver `team`) finishing in `pos` in all three races, the others in number order
function finishing(team, pos) { const rest = ids(20).filter(d => d !== team); rest.splice(pos - 1, 0, team); return rest; }

test('eight tiers with the exact names, AI levels and championship targets', () => {
  assert.deepEqual(C.TIERS.map(t => [t.name, t.level, t.target]), [
    ['Rookie', 1.00, 12], ['Amateur', 1.10, 10], ['Challenger', 1.20, 8], ['Contender', 1.30, 6],
    ['Pro', 1.40, 5], ['Elite', 1.50, 4], ['Master', 1.60, 3], ['Legendary', 1.75, 1]]);
  assert.deepEqual(C.CIRCUITS, ['summit', 'rivermere', 'redridge']);
  assert.deepEqual(C.CIRCUITS.map(id => SIM.circuitById(id).name), ['Summit Grand Circuit', 'Rivermere Grand Prix', 'Redridge International Circuit']);
});

test('championship points: 25-20-16-13-11-10-9-8-7-6-5-4-3-2-1, nothing below P15 or for a retirement', () => {
  assert.deepEqual(ids(20).map(k => C.points(k + 1, false)), [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0]);
  for (let p = 1; p <= 20; p++) assert.equal(C.points(p, true), 0);
  // no fastest-lap or bonus points: a race is worth exactly the table's total
  const st = C.create(); C.start(st, 0, 0);
  C.record(st, { tier: 0, team: 0, race: 0, id: 'a' }, race(ids(20)));
  assert.equal(C.standings(st.active).reduce((a, r) => a + r.points, 0), 140);
});

test('a new career starts at Rookie with nothing completed', () => {
  const st = C.create();
  assert.equal(st.unlocked, 0); assert.deepEqual(st.completed, []); assert.equal(st.champion, false); assert.equal(st.active, null);
  assert.equal(C.start(st, 1, 0), false, 'locked tiers cannot be started');
  assert.ok(C.start(st, 0, 4)); assert.equal(st.active.tier, 0); assert.equal(st.active.team, 4); assert.equal(st.active.races.length, 0);
});

test('points accumulate over the three races in order, and every one of the 20 drivers keeps its team', () => {
  const st = C.create(); C.start(st, 0, 7);
  const orders = [ids(20), ids(20).reverse(), [5, 7, 1, 2, 3, 4, 0, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]];
  const want = new Array(20).fill(0);
  orders.forEach((order, k) => {
    const st0 = C.status(st);
    assert.equal(st0.raceIndex, k); assert.equal(st0.nextCircuit, C.CIRCUITS[k]);
    const out = C.record(st, { tier: 0, team: 7, race: k, id: 'r' + k }, race(order));
    assert.ok(out.ok);
    order.forEach((d, p) => { want[d] += C.points(p + 1, false); });
    for (const row of out.status.table) {
      assert.equal(row.points, want[row.d], 'driver ' + row.d + ' after race ' + (k + 1));
      assert.equal(row.team, SIM.DRIVERS[row.d].team);
      assert.equal(row.results.length, k + 1);
    }
    assert.equal(out.status.table.length, 20);
    assert.deepEqual(st.active.points, want, 'stored points follow the results');
    assert.equal(out.status.complete, k === 2);
  });
  assert.equal(C.status(st).nextCircuit, null);
});

test('standings tiebreakers: wins, then seconds, thirds and so on, then the latest race, then car number', () => {
  // a finishing order with some drivers placed (driver -> position) and the rest in number order
  const order = (placed) => {
    const out = new Array(20).fill(null);
    for (const [d, p] of Object.entries(placed)) out[p - 1] = +d;
    const rest = ids(20).filter(d => !(d in placed));
    return out.map(d => d == null ? rest.shift() : d);
  };
  const champ = (...orders) => ({ races: orders.map((o, k) => ({ circuit: C.CIRCUITS[k], id: 'x' + k, results: race(o) })) });
  const rank = (t, d) => t.findIndex(r => r.d === d);
  // equal points (25), one with a win: P1+P16+P17 against P2+P11(5)+... no: P2 (20) + P11 (5) + P18 (0)
  let t = C.standings(champ(order({ 10: 1, 11: 2 }), order({ 10: 16, 11: 11 }), order({ 10: 17, 11: 18 })));
  assert.equal(t[rank(t, 10)].points, 25); assert.equal(t[rank(t, 11)].points, 25);
  assert.ok(rank(t, 10) < rank(t, 11), 'more wins ranks first');
  // equal points (36) and no wins: two second places beat one second and better lower places
  // d5: P2 + P2 = 40? -> use P2 (20) + P3 (16) = 36 against P3 (16) + P2 (20) = 36 with equal counts -> latest race decides
  t = C.standings(champ(order({ 5: 2, 6: 3 }), order({ 5: 3, 6: 2 })));
  assert.equal(t[rank(t, 5)].points, t[rank(t, 6)].points); assert.deepEqual(t[rank(t, 5)].counts, t[rank(t, 6)].counts);
  assert.ok(rank(t, 6) < rank(t, 5), 'identical countback: the better result in the latest race');
  // equal points (32): P2 (20) + P12 (4) + P8 (8) against P3 (16) + P3 (16) + P16 (0): a second place beats two thirds
  t = C.standings(champ(order({ 7: 2, 8: 3 }), order({ 7: 12, 8: 3 }), order({ 7: 8, 8: 16 })));
  assert.equal(t[rank(t, 7)].points, 32); assert.equal(t[rank(t, 8)].points, 32);
  assert.ok(rank(t, 7) < rank(t, 8), 'seconds compared after wins');
  // deeper countback: equal points (20) with equal wins/seconds/thirds: P4 (13) + P9 (7) against P6 (10) + P6 (10)
  t = C.standings(champ(order({ 12: 4, 13: 6 }), order({ 12: 9, 13: 6 })));
  assert.equal(t[rank(t, 12)].points, t[rank(t, 13)].points);
  assert.ok(rank(t, 12) < rank(t, 13), 'a fourth place beats none');
  // nothing to separate (before any race): car number, deterministically
  assert.deepEqual(C.standings(null).map(r => r.d), ids(20));
  assert.deepEqual(C.standings({ races: [] }).map(r => r.rank), ids(20).map(k => k + 1));
  // a retirement scores nothing and does not count as a finishing position in the countback
  t = C.standings({ races: [{ circuit: 'summit', id: 'a', results: race(ids(20), [0]) }] });
  assert.equal(t[rank(t, 0)].points, 0); assert.equal(t[rank(t, 0)].counts[1], 0);
  assert.equal(t[0].d, 1);
  // ranks are 1..20 with no gaps
  assert.deepEqual(t.map(r => r.rank), ids(20).map(k => k + 1));
});

test('advancement depends on the final championship position for every tier, decided only after race 3', () => {
  for (let tier = 0; tier < 8; tier++) {
    const target = C.TIERS[tier].target;
    for (const pos of [target, target + 1]) {
      const st = C.create(); st.unlocked = tier; const team = 9;
      assert.ok(C.start(st, tier, team));
      for (let k = 0; k < 3; k++) {
        const out = C.record(st, { tier, team, race: k, id: 'r' + k }, race(finishing(team, pos)));
        assert.ok(out.ok);
        if (k < 2) { assert.equal(out.status.complete, false); assert.equal(out.status.success, false, 'no verdict before race 3'); assert.equal(st.unlocked, tier); }
        else {
          assert.equal(out.status.rank, pos);
          assert.equal(out.status.success, pos <= target, C.TIERS[tier].name + ' P' + pos);
          assert.equal(st.completed.includes(tier), pos <= target);
          assert.equal(st.unlocked, pos <= target ? Math.min(7, tier + 1) : tier);
          assert.equal(st.champion, tier === 7 && pos === 1);
          assert.equal(out.unlockedNow, pos <= target && tier < 7);
        }
      }
    }
  }
});

test('failing replays the tier from race 1 with fresh points; unlocked tiers and achievements stay', () => {
  const st = C.create();
  play(st, 0, 3, [finishing(3, 1), finishing(3, 1), finishing(3, 1)]);
  play(st, 1, 3, [finishing(3, 2), finishing(3, 2), finishing(3, 2)]);
  assert.equal(st.unlocked, 2); assert.deepEqual(st.completed, [0, 1]);
  // Challenger missed (P9 of Top 8)
  const fail = play(st, 2, 3, [finishing(3, 9), finishing(3, 9), finishing(3, 9)]);
  assert.equal(fail.status.success, false); assert.equal(fail.status.rank, 9);
  assert.equal(st.unlocked, 2); assert.deepEqual(st.completed, [0, 1]); assert.equal(st.best[2], 9);
  // replay: race 1 again, no points carried over, attempt counted
  assert.ok(C.start(st, 2, 3));
  assert.equal(st.active.races.length, 0); assert.equal(st.active.attempt, 2);
  assert.ok(C.standings(st.active).every(r => r.points === 0));
  // earlier tiers can be replayed (and failed) without locking anything again
  play(st, 0, 3, [finishing(3, 20), finishing(3, 20), finishing(3, 20)]);
  assert.equal(st.unlocked, 2); assert.deepEqual(st.completed, [0, 1]); assert.equal(st.best[0], 1, 'best result kept');
});

test('Legendary needs P1 overall: P2 is not enough, the title completes the career for good', () => {
  const st = C.create(); st.unlocked = 7;
  const p2 = play(st, 7, 0, [finishing(0, 2), finishing(0, 2), finishing(0, 2)]);
  assert.equal(p2.status.success, false); assert.equal(st.champion, false);
  // P1 overall without winning every race: two wins and a second (70) beat a rival with two seconds and a win (65)
  const r1 = finishing(0, 1), r2 = finishing(0, 1), r3 = finishing(0, 2);
  const won = play(st, 7, 0, [r1, r2, r3]);
  assert.equal(won.status.rank, 1); assert.equal(won.status.success, true); assert.equal(st.champion, true);
  assert.ok(st.completed.includes(7)); assert.equal(st.unlocked, 7);
  // a later failed Legendary replay does not take the title away
  play(st, 7, 0, [finishing(0, 20), finishing(0, 20), finishing(0, 20)]);
  assert.equal(st.champion, true);
  const saved = C.load(JSON.parse(JSON.stringify(st)));
  assert.equal(saved.champion, true);
});

test('a race result counts once: repeats, stale sessions and out-of-order races change nothing', () => {
  const st = C.create(); C.start(st, 0, 0);
  const info = { tier: 0, team: 0, race: 0, id: 'session-1' };
  assert.ok(C.record(st, info, race(ids(20))).ok);
  const snapshot = JSON.stringify(st);
  assert.equal(C.record(st, info, race(ids(20))).reason, 'not-current', 'the same race reported again');
  assert.equal(C.record(st, { ...info, race: 1 }, race(ids(20))).reason, 'duplicate', 'same session id for the next race');
  assert.equal(C.record(st, { ...info, race: 2, id: 'z' }, race(ids(20))).reason, 'not-current', 'skipping race 2');
  assert.equal(C.record(st, { ...info, race: 1, id: 'y', tier: 1 }, race(ids(20))).reason, 'not-current', 'another tier');
  assert.equal(C.record(st, { ...info, race: 1, id: 'y', team: 5 }, race(ids(20))).reason, 'not-current', 'another team');
  assert.equal(C.record(st, { ...info, race: 1, id: 'y' }, race(ids(19))).reason, 'invalid', 'incomplete classification');
  assert.equal(JSON.stringify(st), snapshot);
  // after a refresh (save and load) the same race still cannot be added again
  const loaded = C.load(JSON.parse(snapshot));
  assert.equal(C.record(loaded, info, race(ids(20))).ok, false);
  assert.equal(C.status(loaded).points, 25);
  // a championship finished cannot take a fourth race
  assert.ok(C.record(loaded, { ...info, race: 1, id: 's2' }, race(ids(20))).ok);
  assert.ok(C.record(loaded, { ...info, race: 2, id: 's3' }, race(ids(20))).ok);
  assert.equal(C.record(loaded, { ...info, race: 3, id: 's4' }, race(ids(20))).ok, false);
});

test('saves: round trip, and missing, outdated, partial or corrupted data never crashes or grants progress', () => {
  const st = C.create();
  play(st, 0, 2, [finishing(2, 3), finishing(2, 3), finishing(2, 3)]);
  C.start(st, 1, 2); C.record(st, { tier: 1, team: 2, race: 0, id: 'q' }, race(finishing(2, 5)));
  const round = C.load(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(round, st);
  for (const bad of [null, undefined, 42, 'x', [], {}, { v: 2 }, { v: 0, unlocked: 7 }]) {
    const out = C.load(bad); assert.equal(out.unlocked, 0); assert.equal(out.active, null); assert.equal(out.champion, false);
  }
  const mutate = (fn) => { const raw = JSON.parse(JSON.stringify(st)); fn(raw); return C.load(raw); };
  // a broken championship in progress is dropped, the unlocked tiers stay
  for (const fn of [
    r => { r.active.races[0].results[3].pos = 1; },          // two winners
    r => { r.active.races[0].results.pop(); },               // 19 drivers
    r => { r.active.races[0].circuit = 'redridge'; },        // wrong circuit order
    r => { r.active.races[0].results[0].d = 99; },
    r => { r.active.races[0].id = 5; },
    r => { r.active.team = 25; },
    r => { r.active.tier = 5; },                             // not unlocked
    r => { r.active.races = [r.active.races[0], r.active.races[0], r.active.races[0], r.active.races[0]]; },
    r => { r.active.races.push(JSON.parse(JSON.stringify(r.active.races[0]))); r.active.races[1].circuit = 'rivermere'; }, // same id twice
    r => { r.active = 'nonsense'; },
  ]) { const out = mutate(fn); assert.equal(out.active, null); assert.equal(out.unlocked, 1); assert.deepEqual(out.completed, [0]); }
  // stored points are never trusted: they are recomputed from the race results
  const tampered = mutate(r => { r.active.points = new Array(20).fill(999); });
  assert.equal(C.status(tampered).points, C.points(5, false));
  // inconsistent progression is repaired, not trusted: no champion without the Legendary title, unlocks follow completions
  assert.equal(mutate(r => { r.champion = true; }).champion, false);
  assert.equal(mutate(r => { r.unlocked = 0; }).unlocked, 1, 'a completed tier keeps the next one unlocked');
  assert.equal(mutate(r => { r.unlocked = 99; }).unlocked, 1);
  assert.deepEqual(mutate(r => { r.completed = [0, 0, 'x', 12]; }).completed, [0]);
  assert.deepEqual(mutate(r => { r.best = 'x'; }).best, new Array(8).fill(0));
});

/* ---------------- the AI behind the tiers ---------------- */
const dry = (S, seed) => Object.assign(new S.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0,
  cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
function session(S, cfg, player = 2) {
  const t = new S.Track(S.CIRCUITS[0]);
  return new S.Session(t, Object.assign({ type: 'race', seed: 77, weather: 'dynamic', weatherState: dry(S, 77), tyreWear: 'normal', mandatory: true,
    damage: 'realistic', entries: S.DRIVERS.map((driver, k) => ({ driver, isPlayer: k === player })) }, cfg));
}

test('Rookie is exactly the existing difficulty-100 AI: same decisions, same race, step for step', () => {
  const A = loadSim(), B = loadSim();
  const a = session(A, { difficulty: 1 }), b = session(B, { aiLevel: 1, difficulty: 0.3 });
  assert.equal(b.difficulty, 1, 'the tier sets the AI, not the slider'); assert.equal(b.aiSkill, 0);
  for (let k = 0; k < 20; k++) {
    const x = a.cars[k], y = b.cars[k];
    if (!x.ai) continue;
    for (const key of ['commit', 'brakeCommit', 'mistakeScale', 'segMax', 'learnRate']) assert.equal(y.ai[key], x.ai[key], key);
    assert.equal(y.ai.p, y.driver, 'Rookie drivers keep their own ratings');
    assert.equal(y.tyre.c, x.tyre.c); assert.equal(y.fuel, x.fuel, 'same starting tyre and fuel choices');
  }
  for (const s of [a, b]) for (const c of s.cars) if (c.isPlayer) c.input.throttle = 1;
  for (let i = 0; i < 240 * 40; i++) {
    for (const s of [a, b]) { if (s.player) { s.player.input.throttle = 1; s.player.input.brake = 0; } s.fixedStep(A.PHYS_DT); }
  }
  for (let k = 0; k < 20; k++) {
    const x = a.cars[k], y = b.cars[k];
    assert.deepEqual([y.x, y.z, y.speed, y.totalDist, y.fuel, y.tyre.wear[0]], [x.x, x.z, x.speed, x.totalDist, x.fuel, x.tyre.wear[0]], 'car ' + k);
  }
  assert.equal(b.stats.mistakes, a.stats.mistakes); assert.equal(b.stats.overtakes, a.stats.overtakes);
});

test('each tier sharpens the AI driver, never the car: judgement up, physics and rules identical', () => {
  const S = loadSim();
  const physics = JSON.stringify({ spec: S.SPEC, handling: S.HANDLING, compounds: S.COMPOUNDS, refuel: S.REFUEL, repair: S.REPAIR_TIME, teams: S.TEAMS, slip: S.SLIPSTREAM, off: S.OFF_TRACK });
  let prev = null;
  for (const tier of C.TIERS) {
    const s = session(S, { aiLevel: tier.level });
    assert.equal(s.difficulty, 1);
    const ai = s.cars.filter(c => c.ai).map(c => c.ai);
    const avg = (f) => ai.reduce((a, d) => a + f(d), 0) / ai.length;
    const now = { commit: avg(d => d.commit), brake: avg(d => d.brakeCommit), mistakes: avg(d => d.mistakeScale), cons: avg(d => d.p.cons), strat: avg(d => d.p.strat), craft: avg(d => d.p.craft) };
    for (const d of ai) {
      assert.ok(d.commit <= 1 && d.brakeCommit <= 1, 'within the car\'s own grip and braking limits');
      assert.equal(d.p.aggr, d.car.driver.aggr); assert.equal(d.p.risk, d.car.driver.risk); // personality kept
      assert.equal(d.p.name, d.car.driver.name);
    }
    if (prev) for (const k of Object.keys(now)) {
      if (k === 'mistakes') assert.ok(now[k] < prev[k], tier.name + ' fewer mistakes'); else assert.ok(now[k] > prev[k], tier.name + ' ' + k);
    }
    prev = now;
    // the car, the tyres, fuel, pits and rules are the same for every car at every tier
    assert.equal(s.fuelPerLap, session(S, { difficulty: 1 }).fuelPerLap); assert.equal(s.fuelRate, 0.04); assert.equal(s.wearScale, 1);
    assert.equal(s.pitLoss, s.track.def.pitLoss || S.estimatePitLoss(s.track)); assert.equal(s.mistakeMul, 1);
    for (const c of s.cars) assert.deepEqual(c.damage.perf, s.cars[0].damage.perf);
    // the player's car: own ratings, an autopilot with no career skill, an engineer at the baseline
    assert.equal(s.player.autopilot.skill, 0); assert.ok(!s.player.ai);
  }
  assert.equal(JSON.stringify({ spec: S.SPEC, handling: S.HANDLING, compounds: S.COMPOUNDS, refuel: S.REFUEL, repair: S.REPAIR_TIME, teams: S.TEAMS, slip: S.SLIPSTREAM, off: S.OFF_TRACK }), physics);
  // the same controls give the same motion whatever the tier: one physics model for everyone
  const r = session(S, { aiLevel: 1 }), l = session(S, { aiLevel: 1.75 });
  const cr = r.cars[5], cl = l.cars[5];
  // same state (the tiers' own fuel and tyre choices differ, so set them equal), then the same inputs
  for (const [s, c] of [[r, cr], [l, cl]]) { s.fitTyres(c, 'H', 90); c.fuel = 15; c.placeAt(r.track, 400, 0, 30); c.speed = c.u = 30; }
  for (let i = 0; i < 480; i++) for (const c of [cr, cl]) { c.input.throttle = 1; c.input.brake = 0; c.input.steer = 0.2; S.stepCarPhysics(c, S.PHYS_DT, r.track, { wet: 0, wearScale: 1, fuelRate: 0.04, pitLimiter: false }); }
  assert.deepEqual([cl.x, cl.z, cl.speed, cl.fuel], [cr.x, cr.z, cr.speed, cr.fuel]);
});

test('standalone Grand Prix keeps the 0-100 slider and the baseline AI', () => {
  const S = loadSim();
  for (const d of [0, 0.5, 0.75, 1]) {
    const s = session(S, { difficulty: d });
    assert.equal(s.aiLevel, null); assert.equal(s.aiSkill, 0); assert.equal(s.difficulty, d);
    for (const c of s.cars) if (c.ai) { assert.equal(c.ai.skill, 0); assert.equal(c.ai.p, c.driver); }
  }
  // the classic F1 points stay on the standalone results
  const s = session(S, { difficulty: 1 }); s.finishRace();
  assert.deepEqual([...s.results.map(r => r.points)], [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('a championship from real races: three circuits, the same 20 teams, points from the race classification', () => {
  const S = loadSim(), st = S.CAREER.create(), team = 4;
  S.CAREER.start(st, 0, team);
  const finals = [];
  for (let k = 0; k < 3; k++) {
    const t = new S.Track(S.circuitById(S.CAREER.CIRCUITS[k]));
    const s = new S.Session(t, { type: 'race', seed: 300 + k, aiLevel: S.CAREER.TIERS[0].level, weather: 'dynamic', weatherState: dry(S, 300 + k),
      tyreWear: 'normal', mandatory: true, damage: 'realistic', entries: S.DRIVERS.map(driver => ({ driver })) });
    s.totalLaps = 1; // a short race keeps the test quick; the classification rules are the same
    while (!s.over && s.time < 400) s.fixedStep(S.PHYS_DT);
    assert.ok(s.over, 'race ' + (k + 1) + ' classified');
    const out = S.CAREER.record(st, { tier: 0, team, race: k, id: 'real-' + k }, s.results);
    assert.ok(out.ok, out.reason);
    // the career's race record is the race classification, position for position
    s.results.forEach(r => {
      const rec = st.active.races[k].results.find(x => x.d === S.DRIVERS.indexOf(r.car.driver));
      assert.equal(rec.pos, r.pos); assert.equal(rec.dnf, r.dnf);
    });
    finals.push(s.results.map(r => r.car.driver.name));
  }
  const table = S.CAREER.standings(st.active);
  assert.equal(new Set(table.map(r => r.d)).size, 20);
  for (const row of table) {
    const sum = st.active.races.reduce((a, rc) => { const r = rc.results.find(x => x.d === row.d); return a + S.CAREER.points(r.pos, r.dnf); }, 0);
    assert.equal(row.points, sum);
  }
  for (let k = 1; k < table.length; k++) assert.ok(table[k - 1].points >= table[k].points);
  assert.equal(S.CAREER.status(st).complete, true);
  assert.equal(finals.length, 3);
});
