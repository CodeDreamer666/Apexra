const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Rival Duel and Pursuit: the eight ranks and their independent progression, the two-car grids, equal cars,
// tyres and fuel, no pit stops / VSC / weather, the Pursuit head start and rival tyres, the victory rules,
// and real races on all three circuits, through the game's own SIM.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, R = SIM.RANKED, RANKS = R.RANKS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const two = (a = 0, b = 1) => [{ driver: SIM.DRIVERS[a], isPlayer: true }, { driver: SIM.DRIVERS[b] }];
function session(id, gameMode, extra = {}) {
  return new SIM.Session(tracks.get(id), Object.assign({ type: 'race', gameMode, seed: 11, aiLevel: 1, weather: 'dynamic', damage: 'realistic',
    entries: two(), pursuit: gameMode === 'pursuit' ? { gap: 3, rivalWear: 0.25, rival: 1 } : undefined }, extra));
}

test('eight ranks with the exact names and AI levels, an approximately exponential 100% → 300% progression', () => {
  assert.deepEqual(RANKS.map(r => [r.name, r.level]), [['Initiate', 1.00], ['Bronze', 1.17], ['Silver', 1.37], ['Gold', 1.60],
    ['Platinum', 1.87], ['Diamond', 2.19], ['Ascendant', 2.56], ['Apex', 3.00]]);
  const ratios = RANKS.slice(1).map((r, k) => r.level / RANKS[k].level);
  for (const q of ratios) assert.ok(Math.abs(q - Math.pow(3, 1 / 7)) < 0.012, 'each step about ×1.17: ' + q.toFixed(3));
  const steps = RANKS.slice(1).map((r, k) => r.level - RANKS[k].level);
  assert.ok(steps[6] > 2 * steps[0], 'not linear: the steps grow');
  assert.deepEqual(RANKS.map(r => r.gap), [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
  for (const r of RANKS) assert.ok(r.wear >= 0.2 && r.wear <= 0.3, r.name + ' rival tyre wear ' + r.wear);
  // the AI skill steps equally per rank (log scale) and reaches 1 only at 300%
  const skills = RANKS.map(r => SIM.aiSkillForLevel(r.level));
  assert.equal(skills[0], 0); assert.equal(skills[7], 1);
  for (let k = 1; k < 8; k++) assert.ok(Math.abs(skills[k] - skills[k - 1] - 1 / 7) < 0.01);
});

test('progression: Initiate first, only a win unlocks the next rank, each mode on its own, Apex completes the mode', () => {
  const st = R.create();
  for (const m of R.MODES) { assert.equal(st[m].unlocked, 0); assert.deepEqual(st[m].completed, []); assert.equal(st[m].complete, false); }
  const rec = (mode, rank, win, id, extra = {}) => R.record(st, mode, { rank, circuit: 'summit', id, win, time: 160, margin: -0.5, ...extra });
  // a loss: an immediate retry is allowed, nothing unlocks
  let out = rec('duel', 0, false, 'a');
  assert.ok(out.ok); assert.equal(st.duel.unlocked, 0); assert.deepEqual(st.duel.completed, []);
  // a locked rank cannot be played or won
  assert.equal(rec('duel', 1, true, 'b').ok, false); assert.equal(st.duel.unlocked, 0);
  // the win completes Initiate and unlocks Bronze — in Rival Duel only
  out = rec('duel', 0, true, 'c');
  assert.ok(out.unlockedNow && out.completedNow); assert.equal(st.duel.unlocked, 1); assert.deepEqual(st.duel.completed, [0]);
  assert.equal(st.pursuit.unlocked, 0, 'Pursuit progression is independent');
  // a session counts once
  assert.equal(rec('duel', 0, true, 'c').reason, 'duplicate');
  // a completed rank stays replayable; winning it again changes nothing but the best result
  out = rec('duel', 0, true, 'd', { time: 150 }); assert.ok(out.ok && !out.unlockedNow && out.bestNow); assert.equal(st.duel.best.initiate.summit.time, 150);
  // winning on another circuit also counts; best results are per circuit
  out = rec('duel', 1, true, 'e', { circuit: 'redridge' }); assert.ok(out.unlockedNow); assert.equal(st.duel.best.bronze.redridge.time, 160);
  for (let k = 2; k < 8; k++) assert.ok(rec('duel', k, true, 'w' + k).ok);
  assert.equal(st.duel.complete, true); assert.equal(st.duel.unlocked, 7); assert.deepEqual(st.duel.completed, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(st.pursuit.unlocked, 0); assert.equal(st.pursuit.complete, false);
  // Pursuit keeps the best (most negative) final margin
  rec('pursuit', 0, true, 'p1', { margin: -0.3 }); rec('pursuit', 0, true, 'p2', { margin: -1.2 }); rec('pursuit', 0, true, 'p3', { margin: -0.1 });
  assert.equal(st.pursuit.best.initiate.summit.margin, -1.2);
  // persistence: round trip, and broken data never grants progress or crosses modes
  assert.deepEqual(R.load(JSON.parse(JSON.stringify(st))), st);
  for (const bad of [null, 3, 'x', [], {}, { v: 9 }, { v: 1, duel: 'x' }, { v: 1, duel: { unlocked: 99, completed: [42, 'a'] } }]) {
    const o = R.load(bad); for (const m of R.MODES) { assert.equal(o[m].unlocked, 0); assert.deepEqual(o[m].completed, []); }
  }
  const half = R.load({ v: 1, pursuit: { unlocked: 0, completed: [0, 1, 2] }, duel: { complete: true } });
  assert.equal(half.pursuit.unlocked, 3, 'unlocks follow wins'); assert.equal(half.duel.complete, false, 'completion needs the Apex win');
});

test('Rival Duel: two cars side by side on the same line, fresh Softs, the same fuel, a fixed dry track, no pits or VSC', () => {
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
      assert.equal(s.weather, null); assert.equal(s.wet, 0); assert.equal(s.pitsEnabled, false); assert.equal(s.vscEnabled, false);
      assert.equal(s.totalLaps, 2);
    }
    // the sides swap with duelSide (the game alternates it between attempts)
    const s0 = session(id, 'duel', { duelSide: 0 }), s1 = session(id, 'duel', { duelSide: 1 });
    assert.equal(s0.cars[0].d, s1.cars[1].d); assert.equal(s0.cars[1].d, s1.cars[0].d);
  }
  assert.throws(() => session('summit', 'duel', { entries: SIM.DRIVERS.slice(0, 3).map(driver => ({ driver })) }), /exactly two/);
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
      assert.ok(ahead > prev, 'a longer head start for a larger gap'); prev = ahead;
      assert.ok(rv.totalDist > 0 && rv.crossings === 1 && rv.laps === 0, 'already on lap 1, beyond the line');
      assert.ok(Math.abs(rv.d - me.d) < 0.3, 'same line: ' + rv.d.toFixed(3) + ' ' + me.d.toFixed(3));
      // the rival stands well before the braking zone at the end of the straight
      assert.ok(t.refSpeed[t.wrapI(Math.round(rv.s / SIM.DS) + 50)] > 0.9 * Math.max(...t.refSpeed), id + ': still on the straight');
      assert.equal(me.tyre.c, 'S'); assert.ok(me.tyre.wear.every(w => w === 0));
      assert.equal(rv.tyre.c, 'S'); assert.ok(rv.tyre.wear.every(w => w === r.wear));
      assert.equal(me.fuel, rv.fuel); assert.equal(me.launch.active, true); assert.equal(rv.launch.active, true);
    }
  }
  // both are held by the same lights and both clocks start at lights out; the rival's short first lap is not a lap time
  const s = session('summit', 'pursuit');
  const [me, rv] = s.cars;
  while (!s.lightsOut) s.fixedStep(SIM.PHYS_DT);
  assert.equal(me.lapStart, rv.lapStart); assert.equal(rv.sectorStart, s.lightsOutTime);
  assert.ok(me.speed < 1 && rv.speed < 1, 'both from rest');
  while (rv.laps < 1) s.fixedStep(SIM.PHYS_DT);
  assert.equal(rv.lapTimes[0].valid, false, 'a shortened first lap is never a best lap');
});

test('no artificial catch-up: the rival\'s AI, tyres and physics are the shared ones throughout the race', () => {
  const s = session('rivermere', 'pursuit', { aiLevel: 2.19, pursuit: { gap: 4.5, rivalWear: 0.25, rival: 1 } });
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
  assert.equal(s.stats.pitstops, 0); assert.equal(s.vsc.count, 0);
});

test('VSC never deploys in the ranked modes, even after a race-ending crash; Grand Prix keeps it', () => {
  for (const mode of ['duel', 'pursuit']) {
    const s = session('summit', mode);
    while (!s.lightsOut || s.time - s.lightsOutTime < 20) s.fixedStep(SIM.PHYS_DT);
    assert.equal(s.vscCanDeploy(), false);
    s.startRetirement(s.cars[1], 'Accident damage');
    for (let k = 0; k < 240 * 30; k++) s.fixedStep(SIM.PHYS_DT);
    assert.equal(s.vsc.count, 0, mode);
  }
  const gp = new SIM.Session(tracks.get('summit'), { type: 'race', seed: 3, weather: 'dynamic', entries: SIM.DRIVERS.map(driver => ({ driver })) });
  gp.lightsOut = true; gp.time = 30; gp.order = gp.cars;
  assert.equal(gp.vscCanDeploy(), true);
});

test('real races on every circuit: legitimate completion decides; Pursuit is won only by finishing ahead', () => {
  for (const id of tracks.keys()) {
    // Rival Duel between two AI drivers: the first to complete two laps wins, the classification follows
    const d = session(id, 'duel', { entries: [{ driver: SIM.DRIVERS[4] }, { driver: SIM.DRIVERS[9] }], aiLevel: 1.6, seed: 21 });
    while (!d.over && d.time < 420) d.fixedStep(SIM.PHYS_DT);
    assert.ok(d.over, id + ' duel over');
    const w = d.winner; assert.ok(w && w.finished && w.laps === 2);
    assert.equal(d.results[0].car, w);
    const loser = d.results[1].car; assert.ok(!loser.finished || loser.finishTime > w.finishTime);
    for (const c of d.cars) assert.ok(c.totalDist >= 2 * d.track.length - 1 || !c.finished, 'the full distance');
    // Pursuit: a stronger chaser against a weak rival with a short head start, and the reverse
    for (const [chaser, gap] of [[3, 2], [1, 5.5]]) {
      const s = session(id, 'pursuit', { entries: [{ driver: SIM.DRIVERS[0], aiSkill: SIM.aiSkillForLevel(chaser) }, { driver: SIM.DRIVERS[8] }], aiLevel: chaser === 3 ? 1 : 3,
        pursuit: { gap, rivalWear: 0.25, rival: 1 }, seed: 5 });
      while (!s.over && s.time < 420) s.fixedStep(SIM.PHYS_DT);
      assert.ok(s.over, id + ' pursuit over');
      const P = s.pursuit, won = s.winner === P.chaser;
      assert.equal(won, Number.isFinite(P.finalGap) && P.finalGap < 0, id + ': the chaser wins exactly when it finishes ahead (' + P.finalGap + ')');
      if (won) assert.ok(P.chaser.finishTime < (P.rival.finished ? P.rival.finishTime : Infinity));
    }
  }
});
