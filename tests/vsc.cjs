const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Virtual Safety Car: what triggers it (and what does not), the two-per-race limit, its 10–20 s length,
// automatic control of every car, the queue (no passing, no contact, no teleporting, laps-down kept), pit
// stops carrying on under it, the five-second countdown and a synchronised green-flag restart, and the race
// clock, laps, fuel, tyres, weather and damage running on throughout. Crashes are staged on the real
// circuits with the game's own collision and damage model; every car is driven by the game's own drivers.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Every scenario runs in a fresh copy of the game, so it plays out the same whatever ran before it.
const fresh = () => { const ctx = { module: { exports: {} } }; vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx); return ctx.module.exports; };
const SIM = fresh();
const { VSC, PHYS_DT: dt } = SIM;
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });

// A race with an optional human player. The "human" is a driver that presses the same raw controls a
// person would, through the player's own handling; while `mash` says so it holds W flat (keyboard input).
function race(id, { n = 20, player = -1, seed = 7, damage = 'standard', laps = 8, mash = null } = {}) {
  const SIM = fresh(), t = new SIM.Track(SIM.circuitById(id));
  const entries = SIM.DRIVERS.slice(0, n).map((driver, i) => ({ driver, isPlayer: i === player }));
  const S = new SIM.Session(t, { type: 'race', laps, entries, seed, spectate: player < 0, weather: 'dynamic', weatherState: DRY(3), damage, startFuelLaps: 8 });
  S.totalLaps = laps;
  const me = S.player;
  if (me) {
    const human = new SIM.AIDriver(me, S, { pitOnly: true });
    me.playerHandling = new SIM.PlayerHandling(); me.controlCalls = 0; me.lastControlStep = -1;
    me.control = (step, sess) => {
      if (me.autoDrive || me.pit) return;
      me.controlCalls++; me.lastControlStep = sess.step;
      human.decide(step, sess.step);
      const raw = { ...human.cmd };
      if (mash && mash(sess)) Object.assign(raw, { throttle: 1, brake: 0, steer: 0, analog: false });
      me.playerHandling.step(me, step, sess, raw);
    };
  }
  return { S, t, me, SIM };
}
const run = (S, sec, each) => { const end = S.time + sec; while (S.time < end && !S.over) { S.events.length = 0; S.fixedStep(dt); if (each) each(); } };
const runUntil = (S, cond, max, each) => { const end = S.time + max; while (!cond() && S.time < end && !S.over) { S.events.length = 0; S.fixedStep(dt); if (each) each(); } return cond(); };
// Stage a crash: the car is put 3.2 m from the barrier on its side of the track and aimed into it at v m/s.
function crash(S, car, v = 60, yaw = 0.5) {
  const t = S.track, w = t.walls(car.idx, car.s, false, { l: 0, r: 0, innerPit: 0 }), side = car.d >= 0 ? 1 : -1;
  car.placeAt(t, car.s, side * ((side > 0 ? w.r : w.l) - 3.2), 0);
  car.psi += yaw * side; car.vx = Math.cos(car.psi) * v; car.vz = Math.sin(car.psi) * v; car.r = 0;
}
const running = (S) => S.cars.filter(c => !c.inGarage && !c.dnf);
// Everything a neutralisation must respect, recorded every physics step while it is out.
function monitor(S, exclude = new Set()) {
  const m = { steps: 0, swaps: [], contacts: [], jumps: [], resets: 0, maxBrakeDecel: 0, minMemberDist: Infinity, prevPos: new Map(), memberOrder: null, phases: [], speedOver: 0 };
  const seen = S.logArr.length;
  m.tick = () => {
    const v = S.vsc;
    if (!m.phases.length || m.phases[m.phases.length - 1].phase !== v.phase) m.phases.push({ phase: v.phase, t: S.time });
    for (const c of S.cars) {
      const p = m.prevPos.get(c);
      if (p && !c.inGarage && !exclude.has(c) && S.vscActive) {
        const moved = Math.hypot(c.x - p.x, c.z - p.z), allowed = Math.max(p.v, c.speed) * dt * 1.5 + 0.08;
        if (moved > allowed) m.jumps.push(c.driver.short + ' ' + moved.toFixed(2) + ' m @' + S.time.toFixed(2));
      }
      m.prevPos.set(c, { x: c.x, z: c.z, v: c.speed });
    }
    if (!S.vscActive) { m.memberOrder = null; return; }
    m.steps++;
    // (two cars inside the pit lane are driven by the pit autopilot exactly as without a VSC: not counted here)
    const inLane = (c) => !!c.pit && S.track.pitProg(c.s) >= 0;
    for (const e of S.events) if (e.type === 'collision' && !exclude.has(e.a) && !exclude.has(e.b) && !(inLane(e.a) && inLane(e.b))) m.contacts.push(e.a.driver.short + '/' + e.b.driver.short + ' j' + e.j.toFixed(0) + ' @' + S.time.toFixed(2));
    // race order of the cars in the queue (by race distance), sampled at 10 Hz
    if (S.step % 24 === 0) {
      const members = S.cars.filter(c => S.vscMember(c) && !exclude.has(c));
      const order = members.slice().sort((a, b) => b.totalDist - a.totalDist).map(c => c.id).join(',');
      const set = members.map(c => c.id).sort((a, b) => a - b).join(',');
      if (m.memberOrder && m.memberOrder.set === set && m.memberOrder.order !== order) m.swaps.push('@' + S.time.toFixed(1) + ' ' + m.memberOrder.order + ' → ' + order);
      m.memberOrder = { set, order };
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) m.minMemberDist = Math.min(m.minMemberDist, Math.hypot(members[i].x - members[j].x, members[i].z - members[j].z));
    }
  };
  m.done = () => { m.resets = S.logArr.slice(seen).filter(l => l[2] === 'marshal reset' && !S.cars.some(c => exclude.has(c) && c.driver.short === l[1])).length; return m; };
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// 1, 4–8, 10–12: a serious crash on each circuit, with the player in the field holding full throttle
// ---------------------------------------------------------------------------------------------------------
for (const id of ['summit', 'rivermere', 'redridge']) {
  test(id + ': a race-ending crash brings out the VSC; race control drives every car into an orderly queue and restarts the race together', () => {
    // the player holds W through the restart
    const { S, t, me } = race(id, { n: 20, player: 11, mash: (sess) => sess.vsc.phase === 'green' && sess.time - sess.vsc.endedAt < 0.5 });
    assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 70, 200));
    assert.equal(S.vsc.count, 0, 'nothing neutralised before the crash');
    const victim = S.order.filter(c => c !== me)[7];
    const before = {
      laps: new Map(S.cars.map(c => [c, c.laps])), fuel: new Map(S.cars.map(c => [c, c.fuel])), wear: new Map(S.cars.map(c => [c, c.tyre.wear.reduce((a, b) => a + b, 0)])),
      compound: new Map(S.cars.map(c => [c, c.tyre.c])), weather: S.weather.time, time: S.time,
    };
    crash(S, victim);
    const crashT = S.time;
    const mon = monitor(S, new Set([victim]));
    // the incident is judged on what happens: the car's race ends, and race control reacts at once
    assert.ok(runUntil(S, () => S.vscActive, 5, mon.tick), 'VSC deployed');
    assert.ok(victim.retiring || victim.dnf, 'a crash that ended the race of ' + victim.driver.short);
    assert.equal(S.vsc.kind, 'crash'); assert.equal(S.vsc.count, 1);
    assert.ok(S.time - crashT < 3, 'deployed ' + (S.time - crashT).toFixed(1) + ' s after the impact');
    const orderAtDeploy = S.order.filter(c => c !== victim).map(c => c.driver.short).join(' ');
    const lapsDown = new Map(S.cars.map(c => [c, c.lapsDown || 0]));
    const deployT = S.time, spread0 = spread(S, victim), front0 = leaderGaps(S, victim), dist0 = new Map(S.cars.map(c => [c, c.totalDist]));
    const playerCalls = me.controlCalls;
    let underControl = 0, controlledSteps = 0, greenStep = -1, thBefore = 0;
    runUntil(S, () => S.vsc.phase === 'green', 25, () => {
      mon.tick();
      if (S.vscActive) {
        controlledSteps++;
        if (S.vscControls(me)) underControl++;
        thBefore = me.input.throttle;
        // every running car is either in the queue or being driven around the incident / through the pits
        for (const c of running(S)) if (c !== victim && !c.retiring) assert.ok(S.vscControls(c));
      }
    });
    greenStep = S.step;
    assert.equal(me.controlCalls, playerCalls + 1, 'no player input reached the car while the VSC was out; it does from the green-flag step');
    assert.equal(underControl, controlledSteps, 'the player\'s car was driven by race control for the whole period');
    const spread1 = spread(S, victim);
    // timing of the neutralisation: 10–20 s in total, the last five seconds the countdown
    const h = S.vsc.history[0];
    assert.ok(h.total >= VSC.minT - 1e-6 && h.total <= VSC.maxT + dt, 'lasted ' + h.total.toFixed(2) + ' s');
    const ending = mon.phases.find(p => p.phase === 'ending'), green = mon.phases.find(p => p.phase === 'green');
    assert.ok(ending && green, 'countdown and green flag');
    assert.ok(Math.abs(green.t - ending.t - VSC.countdown) < 2 * dt, 'countdown ' + (green.t - ending.t).toFixed(3) + ' s');
    assert.ok(Math.abs(green.t - deployT - h.duration) < 2 * dt);
    // the queue: no passing, no contact, no teleporting, and real gap reduction
    assert.deepEqual(mon.swaps, [], 'no overtaking in the queue');
    assert.deepEqual(mon.contacts, [], 'no car-to-car contact');
    assert.deepEqual(mon.jumps, [], 'no car moved further than its speed allows in a step');
    assert.equal(mon.done().resets, 0, 'no car in the queue was repositioned');
    assert.ok(mon.minMemberDist > 2.1, 'queued cars never overlapped: closest ' + mon.minMemberDist.toFixed(2) + ' m centre to centre');
    assert.ok(spread1 < spread0 - 100, 'the field closed up: ' + spread0.toFixed(0) + ' → ' + spread1.toFixed(0) + ' m');
    const front1 = leaderGaps(S, victim);
    assert.ok(front1.span < front0.span, 'the front of the field closed up: ' + front0.list + ' → ' + front1.list);
    assert.ok(front1.first < 40, 'second place sits right behind the leader: ' + front1.first.toFixed(0) + ' m');
    // race order and laps-down kept (the crashed car drops behind everyone still running)
    S.slowUpdate();
    assert.equal(S.order.filter(c => c !== victim).map(c => c.driver.short).join(' '), orderAtDeploy, 'classification unchanged');
    for (const c of S.cars) if (c !== victim) assert.equal(c.lapsDown || 0, lapsDown.get(c), c.driver.short + ' laps down');
    // the race ran on: clock, weather, fuel, tyre wear, compounds, damage, laps
    assert.ok(S.time - before.time > h.total);
    assert.ok(S.weather.time > before.weather + h.total - 0.5, 'weather kept evolving');
    for (const c of running(S)) if (c !== victim && !c.pit) {
      assert.ok(c.fuel < before.fuel.get(c), c.driver.short + ' burnt fuel');
      assert.ok(c.tyre.wear.reduce((a, b) => a + b, 0) >= before.wear.get(c), 'tyres kept wearing');
      assert.equal(c.tyre.c, before.compound.get(c), 'same tyres');
    }
    // distance driven under the VSC is race distance: the lap counter follows it as usual
    for (const c of running(S)) if (c !== victim) {
      assert.ok(c.totalDist - dist0.get(c) > 150, c.driver.short + ' covered ' + (c.totalDist - dist0.get(c)).toFixed(0) + ' m');
      assert.equal(c.lastLapBase, Math.floor(c.totalDist / t.length));
      assert.ok(c.laps >= before.laps.get(c));
    }
    assert.ok(victim.damage.severity() > 0.5 || victim.dnf, 'damage is not undone');
    // green flag: the player has the car back in the same step as everyone else, from the same pedals; holding
    // W, the throttle rises from where race control left it at the handling's normal rate, with no jump
    assert.equal(me.lastControlStep, greenStep, 'the player drives again in the green-flag step');
    assert.ok(Math.abs(me.vscReturnAt - S.vsc.endedAt) < 1e-9);
    assert.ok(me.input.throttle <= thBefore + SIM.HANDLING.thUp * dt + 1e-9, 'no throttle jump in the green-flag step');
    let th = me.input.throttle, rose = false;
    for (let k = 0; k < 120; k++) {
      S.events.length = 0; S.fixedStep(dt);
      assert.ok(me.input.throttle <= th + SIM.HANDLING.thUp * dt + 1e-9, 'throttle step ' + (me.input.throttle - th).toFixed(4));
      rose = rose || me.input.throttle > th; th = me.input.throttle;
    }
    assert.ok(rose && th > thBefore, 'W pressed at the green flag accelerates the car');
    assert.equal(S.vsc.phase, 'green'); assert.ok(!S.vscActive);
    // after the restart cars race normally again, overtaking included
    run(S, 20);
    assert.ok(!S.vscActive && S.vsc.count === 1, 'one VSC for one incident');
    assert.ok(S.cars.every(c => c.vscAhead == null));
  });
}
function spread(S, victim) {
  const m = S.cars.filter(c => S.vscMember(c) && c !== victim).sort((a, b) => b.totalDist - a.totalDist);
  return m[0].totalDist - m[m.length - 1].totalDist;
}
function leaderGaps(S, victim) {
  const m = S.cars.filter(c => S.vscMember(c) && c !== victim).sort((a, b) => b.totalDist - a.totalDist);
  const gaps = []; for (let k = 1; k < 7 && k < m.length; k++) gaps.push(m[k - 1].totalDist - m[k].totalDist);
  return { first: gaps[0], span: gaps.reduce((a, b) => a + b, 0), list: gaps.map(g => g.toFixed(0)).join(' ') };
}

// ---------------------------------------------------------------------------------------------------------
// 2: what does not need neutralising
// ---------------------------------------------------------------------------------------------------------
test('minor contact, a light barrier hit, an off, harmless debris and a routine failure do not bring out the VSC', () => {
  for (const id of ['summit', 'rivermere', 'redridge']) {
    const { S, t } = race(id, { n: 8, seed: 5 });
    assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 30, 120));
    const [a, b, c, d, e, f] = S.order.slice(1, 7);
    // a light barrier hit: a broken wing at most, and the car drives on
    crash(S, a, 20, 0.5); run(S, 8);
    assert.ok(!a.retiring && !a.dnf, 'the car carried on after a light hit');
    // wheel-to-wheel contact at similar speed
    const sd = b.d >= 0 ? -1 : 1; c.placeAt(t, b.s, b.d + sd * 2.1, b.speed); c.vx = b.vx + Math.cos(b.psi + Math.PI / 2) * sd * -1.5; c.vz = b.vz + Math.sin(b.psi + Math.PI / 2) * sd * -1.5;
    run(S, 6);
    // a trip across the run-off with no impact
    d.placeAt(t, d.s, (d.d >= 0 ? 1 : -1) * (t.halfW + 3), d.speed); run(S, 6);
    // debris: a lost front wing lying on the racing line
    S.addDebris(e.x, e.z, 'fw', 1, e, true); run(S, 4);
    // a routine power-unit failure: the car pulls off and stops clear of the racing surface
    f.damage.c[8] = 1; S.checkFailures(f, 0);
    assert.ok(f.retiring);
    assert.ok(runUntil(S, () => f.retiring.phase === 'parked', 40));
    assert.ok(Math.abs(f.d) > t.halfW - 0.5, 'the failed car stopped off the racing line');
    run(S, 30);
    assert.equal(S.vsc.count, 0, id + ': no VSC for minor incidents: ' + S.logArr.filter(l => /VSC/.test(l[2])).map(l => l.join(' ')).join('; '));
  }
});

test('a serious impact that leaves the car stranded on the racing line is neutralised', () => {
  // a 45 m/s glancing barrier hit (≥ 60 kJ): with the car then stranded on the track, the VSC comes out
  const { S, t } = race('redridge', { n: 6, seed: 9 });
  assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 30, 120));
  const car = S.order[3];
  // the driver is out of it from the impact on: the car is not driven again
  car.ai = null; car.input.throttle = 0; car.input.brake = 1; car.input.steer = 0;
  crash(S, car, 45, 0.5);
  run(S, 0.6);
  assert.ok(!car.retiring && S.vscWatch.some(w => w.car === car && w.E >= VSC.seriousE), 'a serious impact the car survived');
  assert.equal(S.vsc.count, 0, 'the impact alone does not bring out the VSC');
  // the wrecked car comes to rest across the racing line (staged: the car slides back onto the track)
  car.placeAt(t, car.s, 0, 0); car.psi += 1.2;
  assert.ok(runUntil(S, () => S.vscActive, 10), 'VSC for a car stranded on the racing line');
  assert.ok(['stranded', 'blocking'].includes(S.vsc.kind), S.vsc.kind);
  assert.ok(S.vsc.duration >= VSC.minT && S.vsc.duration <= VSC.maxT);
});

// ---------------------------------------------------------------------------------------------------------
// 3: at most two per race; never before the start, after the flag, or while one is out
// ---------------------------------------------------------------------------------------------------------
test('no more than two VSC periods per race, none while one is out, before the start or after the flag', () => {
  const { S } = race('rivermere', { n: 10, seed: 13 });
  // before the start: a staged retirement on the grid is not even watched
  run(S, 1);
  assert.ok(!S.lightsOut && !S.vscCanDeploy());
  S.vscNote(S.cars[4], 300000, null); assert.equal(S.vscWatch.length, 0);
  assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 30, 120));
  const durations = [];
  const victims = [];
  for (let k = 0; k < 3; k++) {
    const v = S.order.find(c => !c.retiring && !c.dnf && !c.pit && c.position > 2 && !victims.includes(c));
    victims.push(v); crash(S, v);
    // a second crash while the VSC is out is dealt with by the same neutralisation
    let extra = null;
    runUntil(S, () => S.vscActive || S.vsc.count >= 2, 6);
    if (k === 0) {
      assert.ok(S.vscActive);
      extra = S.order.find(c => !c.retiring && !c.dnf && !c.pit && c.position > 2 && !victims.includes(c)); victims.push(extra); crash(S, extra);
      run(S, 3); assert.equal(S.vsc.count, 1, 'no new VSC while one is out');
    }
    runUntil(S, () => !S.vscActive, 25);
    if (S.vsc.history[k]) durations.push(S.vsc.history[k].total);
    run(S, 25);
  }
  assert.equal(S.vsc.count, 2, 'two activations, the third serious crash had none: ' + S.vsc.history.map(h => h.kind).join(', '));
  assert.equal(S.vsc.history.length, 2);
  for (const d of durations) assert.ok(d >= VSC.minT && d <= VSC.maxT + dt, 'lasted ' + d.toFixed(2) + ' s');
  // after the chequered flag nothing can deploy, and an incident then is not neutralised
  S.finishedFlag = true; assert.ok(!S.vscCanDeploy());
  const S2 = race('summit', { n: 4, seed: 2 }).S; S2.lightsOut = true; S2.finishedFlag = true;
  assert.ok(!S2.vscCanDeploy());
});

test('the leader too close to the flag for the whole neutralisation: no VSC', () => {
  const { S, t } = race('summit', { n: 6, seed: 3, laps: 1 });
  assert.ok(runUntil(S, () => S.lightsOut && S.leader && S.leader.totalDist > t.length - VSC.minToGo + 100, 200));
  assert.ok(!S.vscCanDeploy());
  const v = S.order[3]; crash(S, v); run(S, 4);
  assert.equal(S.vsc.count, 0);
});

// ---------------------------------------------------------------------------------------------------------
// 9: pit stops under the VSC
// ---------------------------------------------------------------------------------------------------------
test('cars in the pit lane carry on with their stops under the VSC, and cars join the queue from the pit exit safely', () => {
  const { S, t, me } = race('summit', { n: 12, player: 6, seed: 4 });
  assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 40, 120));
  // three bots head for the pits on this lap
  const boxers = S.order.filter(c => c.ai).slice(2, 5);
  for (const c of boxers) { c.ai.boxThisLap = true; c.boxCompound = 'H'; }
  assert.ok(runUntil(S, () => boxers.filter(c => c.pit && c.pit.phase !== 'approach').length >= 2, 200), 'cars in the pit lane');
  // crash a car well away from the pit lane
  const victim = S.order.filter(c => c.ai && !c.pit && !boxers.includes(c) && c.position > 1)
    .sort((a, b) => Math.abs(t.dS(b.s, t.pit.entry0)) - Math.abs(t.dS(a.s, t.pit.entry0)))[0];
  crash(S, victim);
  const mon = monitor(S, new Set([victim]));
  const stops0 = new Map(S.cars.map(c => [c, c.pitStops]));
  const timers = [];
  assert.ok(runUntil(S, () => S.vscActive, 5, mon.tick), 'VSC deployed');
  // the player asks for the pits once the VSC is out: race control's driver takes the pit entry
  me.boxRequest = true;
  const inLaneAtDeploy = S.cars.filter(c => c.pit && t.pitProg(c.s) >= 0);
  assert.ok(inLaneAtDeploy.length >= 2, 'cars were in the pit lane at the deployment');
  runUntil(S, () => !S.vscActive, 25, () => {
    mon.tick();
    for (const c of S.cars) if (c.pit && c.pit.phase === 'stopped') timers.push([c, c.pit.timer]);
    // the player's service choice is made at once
    if (me.pit && me.pit.phase === 'awaiting') S.confirmPitService(me, { tyre: 'M', fuel: 0 });
  });
  // service timers kept running under the VSC (they only ever count down)
  const byCar = new Map(); for (const [c, tm] of timers) { if (byCar.has(c)) assert.ok(tm <= byCar.get(c) + 1e-9); byCar.set(c, tm); }
  assert.ok(byCar.size >= 1, 'a car was serviced while the VSC was out');
  assert.deepEqual(mon.swaps, []); assert.deepEqual(mon.contacts, []); assert.deepEqual(mon.jumps, []);
  // everyone gets through the lane and back out: no stop cancelled, nobody stuck
  runUntil(S, () => [...boxers, me].every(c => !c.pit && c.pitStops > stops0.get(c)), 160, () => { if (me.pit && me.pit.phase === 'awaiting') S.confirmPitService(me, { tyre: 'M', fuel: 0 }); });
  for (const c of [...boxers, me]) {
    assert.ok(c.pitStops > stops0.get(c), c.driver.short + ' completed its stop');
    assert.ok(!c.pit, c.driver.short + ' left the pit lane');
    assert.ok(!c.dnf);
  }
  assert.ok(S.pitBoxesInUse() <= 4);
  assert.ok(!S.vscActive && S.vsc.count === 1);
});

test('a car that pits under the VSC rejoins behind the queue, never in it by passing', () => {
  const { S, t } = race('redridge', { n: 10, seed: 8 });
  assert.ok(runUntil(S, () => S.lightsOut && S.time - S.lightsOutTime > 40, 120));
  // a car about 25 s from the pit entry is told to box only once the VSC is out
  const victim = S.order[6]; crash(S, victim);
  assert.ok(runUntil(S, () => S.vscActive, 5));
  const near = S.order.filter(c => c.ai && !c.pit && c !== victim && t.dS(c.s, t.pit.entry0) > 150 && t.dS(c.s, t.pit.entry0) < 900);
  for (const c of near) { c.ai.boxThisLap = true; c.boxCompound = 'M'; }
  const mon = monitor(S, new Set([victim]));
  let entered = 0;
  runUntil(S, () => !S.vscActive, 25, () => { mon.tick(); entered = Math.max(entered, near.filter(c => c.pit && t.pitProg(c.s) >= 0).length); });
  assert.deepEqual(mon.swaps, []); assert.deepEqual(mon.contacts, []); assert.deepEqual(mon.jumps, []);
  runUntil(S, () => near.every(c => !c.pit), 90);
  if (near.length) assert.ok(entered >= 1, 'a car took the pit entry during the VSC');
  for (const c of near) assert.ok(!c.pit && c.pitStops >= 1, c.driver.short + ' stopped and rejoined');
});

// ---------------------------------------------------------------------------------------------------------
// 8: lapped cars stay lapped
// ---------------------------------------------------------------------------------------------------------
test('lapped cars keep their place on the circuit: no unlapping and no lapping under the VSC', () => {
  const { S, t } = race('rivermere', { n: 5, seed: 6 });
  S.lightsOut = true; S.lightsOutTime = 0; S.time = 200;
  const [lead, lapA, lapB, p2, victim] = S.cars;
  const L = t.length, base = 1500;
  // the leader on its third lap; one lapped car 200 m ahead of it on the road, one 120 m behind it;
  // second place 400 m behind the leader on the lead lap
  const put = (c, s, totalDist, laps, v) => {
    c.placeAt(t, t.wrapS(s), t.rlOff[t.wrapI(Math.round(t.wrapS(s) / SIM.DS))] || 0, v); c.started = true; c.crossings = laps + 1; c.laps = laps;
    c.totalDist = totalDist; c.lastLapBase = Math.floor(totalDist / L); c.lastWithin = totalDist - c.lastLapBase * L; c.lapStart = S.time - 30; c.sectorStart = S.time - 10;
  };
  put(lead, base, 2 * L + base, 2, 45); put(lapA, base + 200, L + base + 200, 1, 45); put(lapB, base - 120, L + base - 120, 1, 45);
  put(p2, base - 400, 2 * L + base - 400, 2, 45); put(victim, base + 1500, 2 * L + base - 1000, 1, 45);
  run(S, 3);
  S.slowUpdate();
  const ld0 = new Map(S.cars.map(c => [c, c.lapsDown])); const pos0 = S.order.filter(c => c !== victim).map(c => c.driver.short);
  assert.equal(lapA.lapsDown, 0, 'just under a lap behind the leader'); assert.equal(lapB.lapsDown, 1);
  crash(S, victim);
  const mon = monitor(S, new Set([victim]));
  assert.ok(runUntil(S, () => S.vscActive, 5, mon.tick));
  runUntil(S, () => !S.vscActive, 25, mon.tick);
  S.slowUpdate();
  assert.deepEqual(mon.swaps, []); assert.deepEqual(mon.contacts, []);
  for (const c of [lead, lapA, lapB, p2]) assert.equal(c.lapsDown, ld0.get(c), c.driver.short + ' laps down kept');
  assert.deepEqual(S.order.filter(c => c !== victim).map(c => c.driver.short), pos0);
  // on the road: the lapped car ahead of the leader is still ahead of it, the one behind still behind
  assert.ok(t.dS(lead.s, lapA.s) > 0 && t.dS(lead.s, lapA.s) < 1500, 'the lapped car ahead stayed ahead');
  assert.ok(t.dS(lapB.s, lead.s) > 0 && t.dS(lapB.s, lead.s) < 1500, 'the lapped car behind stayed behind');
});

// ---------------------------------------------------------------------------------------------------------
// 12: no change to driving when there is no VSC
// ---------------------------------------------------------------------------------------------------------
test('without an incident nothing changes: the same race to the metre with the VSC system switched off', () => {
  // each run in a fresh copy of the game, so car numbering and every random draw start the same
  const lap = (off) => {
    const G = fresh();
    if (off) { G.Session.prototype.vscAssess = function () {}; G.Session.prototype.vscNote = function () {}; G.Session.prototype.vscNoteRetirement = function () {}; }
    const t = new G.Track(G.circuitById('summit'));
    const S = new G.Session(t, { type: 'race', laps: 8, entries: G.DRIVERS.slice(0, 8).map(driver => ({ driver })), seed: 21, spectate: true, weather: 'dynamic', weatherState: DRY(3), damage: 'standard' });
    for (let k = 0; k < 90 * 240; k++) S.fixedStep(G.PHYS_DT);
    assert.equal(S.vsc.count, 0);
    return S.cars.map(c => c.totalDist.toFixed(6) + ':' + c.speed.toFixed(6) + ':' + c.fuel.toFixed(6) + ':' + c.tyre.wear[0].toFixed(8)).join(' ');
  };
  assert.equal(lap(false), lap(true));
});
