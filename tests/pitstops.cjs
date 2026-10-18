const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Ten team boxes (two cars per team), stacking, the automatic service from the pit plan, refuelling in laps, full
// repairs on the shared repair schedule, the time a stop costs, and the removal of DRS and ERS, exercised through the
// game's own Session, AI, pit autopilot and physics.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(context.module); // (not vm.runInNewContext: a separate context runs the simulation about five times slower)
const SIM = context.module.exports;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });

function session(id, n, extra = {}) {
  const t = tracks.get(id);
  return new SIM.Session(t, { type: 'race', laps: 8, entries: SIM.DRIVERS.slice(0, n).map(driver => ({ driver })), seed: 3, spectate: true, weather: 'dynamic', weatherState: DRY(3), ...extra });
}

// a car placed on the entry route just past the commitment gate, where a car that has steered into the entry is
function onEntry(S, car, speed = 30, ds = 20) {
  const t = S.track, s0 = t.wrapS(t.pit.commit + ds); car.placeAt(t, s0, t.pitTargetD(s0, null), speed); car.gear = 5; car.started = true;
}
const lane = (S, ids, sec, each) => { for (let k = 0; k < sec / SIM.PHYS_DT; k++) { S.fixedStep(SIM.PHYS_DT); if (each) each(S); if (ids && ids.every(c => c.pitStops > 0 && !c.pit)) break; } };

test('ten team boxes, one per team, in the speed-limited lane beside the main straight', () => {
  assert.equal(SIM.TEAMS.length, 10); assert.equal(SIM.DRIVERS.length, 20);
  for (let i = 0; i < 20; i++) assert.equal(SIM.DRIVERS[i].team, Math.floor(i / 2), 'two cars per team');
  for (const t of tracks.values()) {
    const p = t.pit, limited = p.len - p.E - p.X;
    assert.equal(p.boxes.length, 10, t.name + ' ten boxes');
    for (let k = 1; k < 10; k++) assert.ok(t.dS(p.boxes[k - 1], p.boxes[k]) >= 12, 'boxes in a row along the lane, one car length and a gap apart');
    for (const b of p.boxes) assert.ok(t.inLimiter(b) && t.inPitMain(b), 'every box inside the limited stretch');
    assert.ok(limited > 120 && limited < 170, t.name + ' limited lane ' + limited.toFixed(0) + ' m');
    assert.ok(Math.abs(p.limit * 3.6 - 120) < 1e-9, 'pit limit 120 km/h');
    assert.ok(p.E >= 160, 'an entry ramp long enough to brake from top speed to the limit');
  }
});

test('each car goes to its own team box; different teams are serviced at the same time', () => {
  const S = session('monza', 6, { spectate: false }); S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const [a1, a2, b1, b2, c1, c2] = S.cars;
  for (const c of [a2, b2, c2]) c.placeAt(S.track, 2500, 0, 40);
  // A1 arrives with heavy damage (a long repair); B1 and C1 follow and are serviced in their own boxes meanwhile
  a1.damage.applyImpact(70000, -2.6, 0.1, 0, S.damageLevel, 0); a1.ai.boxCompound = 'H';
  onEntry(S, a1, 30, 40); onEntry(S, b1, 30, 22); onEntry(S, c1, 30, 4);
  let together = 0;
  lane(S, [a1, b1, c1], 90, (S) => { const n = S.cars.filter(c => c.pit && c.pit.phase === 'stopped').length; together = Math.max(together, n); });
  for (const [c, k] of [[a1, 0], [b1, 1], [c1, 2]]) {
    assert.equal(c.pitStops, 1, c.driver.short + ' serviced'); assert.equal(c.pitHistory[0].box, k + 1, c.driver.short + ' in its team box ' + (k + 1));
  }
  assert.ok(a1.pitHistory[0].service > 6, 'A1 under repair for ' + a1.pitHistory[0].service.toFixed(1) + ' s');
  assert.ok(together >= 2, 'boxes of different teams work at the same time: ' + together + ' cars stationary together');
});

test('team-mates arriving together: the first is serviced, the second waits in the fast lane and then takes the box', () => {
  const S = session('bahrain', 2, { spectate: false }); S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const [a1, a2] = S.cars;
  onEntry(S, a1, 28, 40); onEntry(S, a2, 28, 14);
  let stacked = false, both = 0, minGap = 1e9;
  lane(S, [a1, a2], 120, (S) => {
    if (a2.pit && a2.pit.phase === 'stack') stacked = true;
    if (a1.pit && a2.pit && a1.pit.phase === 'stopped' && a2.pit.phase === 'stopped') both++;
    if (a1.pit && a2.pit) minGap = Math.min(minGap, Math.hypot(a1.x - a2.x, a1.z - a2.z));
  });
  assert.ok(stacked, 'the second car stacked');
  assert.equal(both, 0, 'never two cars serviced in one box');
  assert.ok(minGap > 2.2, 'the cars never overlap: closest ' + minGap.toFixed(2) + ' m');
  assert.equal(a1.pitStops, 1); assert.equal(a2.pitStops, 1);
  assert.equal(a1.pitHistory[0].box, 1); assert.equal(a2.pitHistory[0].box, 1);
  assert.ok(a2.pitHistory[0].queued > 0.5, 'the second car waited ' + a2.pitHistory[0].queued.toFixed(1) + ' s for the box');
});

test('all ten boxes busy and both cars of every team in the lane: no overlap, no deadlock, everyone leaves', () => {
  for (const id of ['spa', 'interlagos']) {
    const S = session(id, 20, { spectate: false }); S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
    // the field nose to tail on the entry route, team-mates mixed in the order
    const order = S.cars.slice().sort((x, y) => (x.id * 7) % 20 - (y.id * 7) % 20);
    // (the cars still short of the gate have called a stop, so they steer onto the entry route)
    order.forEach((c, k) => { onEntry(S, c, 22, 70 - k * 9); if (c.ai) c.ai.boxThisLap = true; });
    let maxBusy = 0, overlap = 0;
    lane(S, S.cars, 400, (S) => {
      maxBusy = Math.max(maxBusy, S.pitBoxes.filter(Boolean).length);
      if (S.step % 24) return;
      const L = S.cars.filter(c => c.pit);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.hypot(L[i].x - L[j].x, L[i].z - L[j].z) < 1.6) overlap++;
    });
    assert.ok(S.cars.every(c => c.pitStops === 1 && !c.pit), id + ': every car serviced and out of the lane (' + S.cars.filter(c => c.pit).map(c => c.driver.short + ':' + c.pit.phase).join(' ') + ')');
    assert.ok(maxBusy >= 8, id + ': boxes busy at once ' + maxBusy);
    assert.equal(overlap, 0, id + ': cars overlapping in the lane');
    for (const c of S.cars) assert.equal(c.pitHistory[0].box, c.teamIdx + 1, c.driver.short + ' used its team box');
  }
});

test('the service runs at once from the pit plan: tyres, fuel in laps of the car\'s own consumption, repairs', () => {
  const S = session('silverstone', 2, { spectate: false, entries: [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1], isPlayer: true }] });
  S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const [other, me] = S.cars; other.placeAt(S.track, 3000, 0, 40);
  me.fuel = S.fuelForLaps(2);
  me.pitPlan = { tyre: 'S', fuel: 2, repair: true };
  me.damage.applyImpact(24000, 2.5, -0.6, 0.3, S.damageLevel, 3000);
  const plan = me.damage.repairPlan(); assert.ok(plan.items.length >= 2, 'damaged: ' + plan.items.join(', '));
  onEntry(S, me);
  let P = null, fuel0 = 0;
  lane(S, [me], 90, () => { if (!P && me.pit && me.pit.phase === 'stopped') { P = me.pit; fuel0 = P.fuelStart; } });
  assert.ok(P, 'the car stopped in its box and the service began without any confirmation');
  assert.equal(me.tyre.c, 'S');
  const rate = S.fuelLapRate(me);
  assert.ok(Math.abs(P.fuelAdd - 2 * rate) < 1e-6 && Math.abs(me.fuel - fuel0 - P.fuelAdd) < 0.2, 'two laps of fuel: ' + P.fuelAdd.toFixed(2) + ' kg at ' + rate.toFixed(2) + ' kg/lap');
  assert.ok(me.damage.isClean(), 'repaired in full');
  // the stationary time is the longest crew's work (tyres after the corner repairs, fuel, the other crews), as estimated
  assert.ok(Math.abs(P.total - Math.max(P.tyreT, P.fuelT, P.jobs.reduce((m, j) => Math.max(m, j.station.startsWith('corner') ? 0 : j.end), 0), 0.8)) < 1e-9);
  // a plan of more fuel than the tank holds fills the tank and no more
  const T = session('monza', 1, { spectate: false, entries: [{ driver: SIM.DRIVERS[0], isPlayer: true }] }); T.lightsOut = true; T.time = 30;
  const p2 = T.cars[0]; p2.pitPlan = { tyre: 'keep', fuel: 40, repair: false };
  assert.ok(Math.abs(T.serviceFor(p2).fuelKg - (T.fuelCapacity - p2.fuel)) < 1e-9);
  assert.equal(T.serviceFor(p2).tyre, 'keep');
  // 'finish': enough to reach the flag with a small margin
  p2.fuel = T.fuelForLaps(1); const f = T.fuelToFinish(p2);
  assert.ok(f * 2 === Math.round(f * 2) && (p2.fuel + f * T.fuelLapRate(p2)) / T.fuelLapRate(p2) >= T.lapsLeft(p2) + 0.29, 'fuel to the flag: ' + f);
});

test('a full repair restores every component; its time is the shared schedule (Car Status estimate = actual stop)', () => {
  const S = session('monza', 1, { spectate: false, entries: [{ driver: SIM.DRIVERS[0], isPlayer: true }] }); S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const me = S.cars[0], D = me.damage, lv = S.damageLevel;
  D.applyImpact(30000, 2.5, -0.7, 0.3, lv, 3000); D.applyImpact(26000, -2.6, 0.3, 0.1, lv, 2000); D.applyImpact(18000, 0.3, 0.9, 1, lv, 2000);
  D.c[SIM.CI.engine] = Math.max(D.c[SIM.CI.engine], 0.5); D.c[SIM.CI.brakeFR] = 0.6; D.computePerf();
  const damaged = SIM.COMPONENTS.filter((C, k) => C.cat !== 'tyre' && D.c[k] >= SIM.DAMAGE_MIN).length;
  assert.ok(damaged >= 6, damaged + ' components damaged');
  const est = D.repairPlan(), perf0 = { ...D.perf };
  assert.ok(perf0.power < 0.95 && perf0.brake < 0.95 && perf0.clAMul < 0.95, 'the damage costs power, braking and downforce');
  me.pitPlan = { tyre: 'H', fuel: 0, repair: true };
  onEntry(S, me);
  let P = null, mid = null;
  lane(S, [me], 120, () => {
    if (me.pit && me.pit.phase === 'stopped') { P = me.pit; const el = P.total - P.timer; if (!mid && el > 1.0 && el < P.total - 1) mid = D.isClean(); }
  });
  assert.ok(P && mid === false, 'still damaged during the work');
  // the stationary time equals the estimate (the tyre change itself varies a little from stop to stop)
  assert.ok(Math.abs(P.total - est.time) < 0.9, 'stop ' + P.total.toFixed(2) + ' s, estimate ' + est.time.toFixed(2) + ' s');
  assert.ok(P.total > 2.4 + 2, 'repairs cost real time');
  assert.ok(D.isClean(), 'every component back to new');
  const H = new SIM.CarDamage().perf;
  for (const k of ['power', 'brake', 'clAMul', 'cdAMul', 'turnLoss', 'aeroTurnLoss', 'pull', 'brakePull', 'rearStab', 'traction', 'steerResp', 'shiftMul', 'gearCap', 'coolEff']) assert.ok(Math.abs(D.perf[k] - H[k]) < 1e-9, k + ' back to healthy: ' + D.perf[k] + ' vs ' + H[k]);
  assert.equal(D.repairPlan().items.length, 0, 'nothing left to repair: the estimate returns to zero');
});

test('a retired car cannot enter the pit lane or be repaired', () => {
  const S = session('monza', 1, { spectate: false, entries: [{ driver: SIM.DRIVERS[0], isPlayer: true }] }); S.lightsOut = true; S.time = 30;
  const me = S.cars[0];
  me.damage.c[SIM.CI.gearbox] = 1; me.damage.computePerf(); S.checkFailures(me);
  assert.ok(me.retiring, 'a broken gearbox retires the car');
  onEntry(S, me);
  for (let k = 0; k < 240 * 20; k++) S.fixedStep(SIM.PHYS_DT);
  assert.ok(!me.pit && me.pitStops === 0, 'no pit stop for a retired car');
  assert.ok(me.dnf || me.retiring);
});

test('the pit autopilot drives the car: commitment at any speed, braking to the limit, no teleport, a smooth stop', () => {
  const S = session('suzuka', 1, { spectate: false, entries: [{ driver: SIM.DRIVERS[4], isPlayer: true }] }); S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const me = S.cars[0], t = S.track;
  onEntry(S, me, 82, 5); // nearly 300 km/h past the gate
  let jump = 0, overLimit = 0, maxDecel = 0, prev = null, pv = me.speed;
  lane(S, [me], 90, () => {
    if (prev) jump = Math.max(jump, Math.hypot(me.x - prev[0], me.z - prev[1]));
    prev = [me.x, me.z];
    if (me.pit && t.inLimiter(me.s) && me.pit.phase !== 'out') overLimit = Math.max(overLimit, me.speed - t.pit.limit);
    maxDecel = Math.max(maxDecel, (pv - me.speed) / SIM.PHYS_DT); pv = me.speed;
  });
  assert.equal(me.pitStops, 1, 'serviced');
  assert.ok(jump < 0.5, 'moved continuously: largest step ' + jump.toFixed(3) + ' m');
  assert.ok(overLimit < 1.5, 'held to the limit in the lane: ' + (overLimit * 3.6).toFixed(1) + ' km/h over');
  assert.ok(maxDecel < 75, 'no sudden stop: ' + maxDecel.toFixed(1) + ' m/s² (full arcade braking from top speed is about 60)');
  assert.ok(me.autoDrive === false, 'control handed back at the pit exit');
});

test('pitting keeps the race distance honest: no lap gained or lost, the classification follows the cars', () => {
  const t = tracks.get('monza');
  const S = new SIM.Session(t, { type: 'race', laps: 3, entries: SIM.DRIVERS.slice(0, 4).map(driver => ({ driver })), seed: 4, spectate: true, weather: 'dynamic', weatherState: DRY(4) });
  S.totalLaps = 3;
  const car = S.cars[0]; let last = car.totalDist, maxStep = 0, lapsAtEntry = null, distAtEntry = null;
  while (!S.over && S.time < 600) {
    S.fixedStep(SIM.PHYS_DT);
    if (car.laps === 1 && !car.pitStops && !car.pit) { car.ai.boxThisLap = true; car.boxCompound = 'H'; }
    if (car.pit && lapsAtEntry == null) { lapsAtEntry = car.laps; distAtEntry = car.totalDist; }
    maxStep = Math.max(maxStep, car.totalDist - last); last = car.totalDist;
  }
  assert.equal(car.pitStops, 1);
  assert.ok(maxStep < 2, 'race distance grows smoothly through the lane: largest step ' + maxStep.toFixed(3) + ' m');
  assert.equal(car.laps, 3, 'three laps, the stop neither added nor removed one');
  assert.ok(S.results.every((r, k) => r.pos === k + 1));
});

// One car alone on the circuit, the same seed with and without a stop on lap 2.
function soloRace(id, { stop = false, prep = null, fuelLaps = 8, laps = 4, onStep = null, driver = 0 } = {}) {
  const t = tracks.get(id);
  const S = new SIM.Session(t, { type: 'race', laps, entries: [{ driver: SIM.DRIVERS[driver] }], seed: 11, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, mandatory: false, weatherState: DRY(3) });
  S.totalLaps = laps; S.mandatory = false; const car = S.cars[0]; car.fuel = S.fuelForLaps(fuelLaps);
  // (the reference run stays out: with the pits open the AI may make a stop of its own, which hides the loss)
  if (!stop) S.pitsEnabled = false;
  let P = null, prepped = false;
  while (!S.over && S.time < 200 * laps) {
    S.fixedStep(SIM.PHYS_DT);
    if (stop && car.laps === 1 && !car.pitStops && !car.pit) { car.ai.boxThisLap = true; car.boxCompound = car.tyre.c; }
    // (staged as the car reaches the pit entry, before the gate where it is given a box)
    if (prep && !prepped && (car.pit || car.ai && car.ai.boxThisLap && t.pitProg(car.s) >= 0)) { prepped = true; prep(S, car); }
    if (car.pit && car.pit.phase === 'stopped') P = car.pit;
    if (onStep) onStep(S, car);
  }
  return { S, car, P, time: car.finishTime, visit: car.pitHistory[0] };
}


for (const id of SIM.CIRCUITS.map(c => c.id)) {
  test(id + ': a clean tyre-only stop costs what the circuit states (measured), far less than the old 19-27 s', () => {
    // (measured from a box in the middle of the lane: the stated loss is the mean over the first, middle and last
    // boxes, tools/pit-benchmark.cjs; the first box costs about a second more, the middle one about half a second less)
    const base = soloRace(id, { driver: 10 }), pit = soloRace(id, { stop: true, driver: 10 });
    const loss = pit.time - base.time;
    assert.ok(pit.P && pit.P.changeTyres && !pit.P.fuelAdd && !pit.P.jobs.length, 'a tyre-only stop');
    // (the stated loss is a mean over seeds and boxes; one run can differ by a few seconds, because a green-paint entry
    // on any lap of either run changes the finish times, as on main: at Bahrain single runs range 14.6-20.6 s)
    assert.ok(loss > 9 && loss < 21, id + ' clean stop loss ' + loss.toFixed(2) + ' s');
    assert.ok(Math.abs(loss - tracks.get(id).def.pitLoss) < 4.0, 'the stated loss matches the simulation: ' + loss.toFixed(2) + ' vs ' + tracks.get(id).def.pitLoss);
    assert.equal(pit.car.laps, 4); assert.equal(pit.car.pitStops, 1);
  });
}

test('fuel: start loads of 2–7 laps, a lighter car accelerates a little harder, the tank and range are respected', () => {
  const S = session('monza', 20);
  assert.equal(S.fuelCapacity, Math.round(S.fuelPerLap * SIM.FUEL_TANK_LAPS * 2) / 2);
  for (const c of S.cars) {
    assert.ok(c.startFuelLaps >= 2 && c.startFuelLaps <= 7, c.driver.short + ' start fuel ' + c.startFuelLaps);
    assert.ok(Math.abs(c.fuel - S.fuelForLaps(c.startFuelLaps)) < 1e-9 && c.fuel <= S.fuelCapacity);
  }
  assert.ok(S.fuelForLaps(20) === S.fuelCapacity, 'never more than the tank');
  const P = new SIM.Session(tracks.get('monza'), { type: 'race', laps: 6, entries: [{ driver: SIM.DRIVERS[0], isPlayer: true }], seed: 1, startFuelLaps: 3 });
  assert.equal(P.player.startFuelLaps, 3);
  assert.ok(Math.abs(P.fuelRange(P.player) - (3 + SIM.FUEL_RESERVE / P.fuelPerLap)) < 1e-9);
  // mass: the same car with 3 and 7 laps of fuel, full throttle from 100 km/h for 3 s
  const flat = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => 0, pit: { limit: 22 } };
  const accel = (fuel) => {
    const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, {}); car.fuel = fuel;
    car.vx = car.u = car.speed = 100 / 3.6; car.gear = 4; car.rpm = 10000;
    const h = new SIM.PlayerHandling();
    for (let k = 0; k < 720; k++) { h.step(car, SIM.PHYS_DT, { lightsOut: true, wet: 0 }, { steer: 0, throttle: 1, brake: 0, analog: false }); SIM.stepCarPhysics(car, SIM.PHYS_DT, flat, { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false }); }
    return car.speed;
  };
  const light = accel(S.fuelForLaps(3)), heavy = accel(S.fuelForLaps(7));
  assert.ok(light > heavy && light - heavy < 2.5, 'lighter is faster, modestly: ' + ((light - heavy) * 3.6).toFixed(2) + ' km/h after 3 s');
  // consumption is continuous and never negative
  const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, {}); car.fuel = 0.002; car.vx = car.u = car.speed = 40; car.gear = 6; car.rpm = 11000;
  const h = new SIM.PlayerHandling();
  for (let k = 0; k < 480; k++) { h.step(car, SIM.PHYS_DT, { lightsOut: true, wet: 0 }, { steer: 0, throttle: 1, brake: 0, analog: false }); SIM.stepCarPhysics(car, SIM.PHYS_DT, flat, { wet: 0, wearScale: 0, fuelRate: 0.04, pitLimiter: false }); }
  assert.equal(car.fuel, 0);
});

test('DRS no longer exists: no zones, no eligibility, no control, no drag change, no trace in the game', () => {
  for (const t of tracks.values()) assert.ok(!('drsZones' in t) && !('drs' in t.def), t.name + ' DRS metadata');
  const S = session('bahrain', 2); S.lightsOut = true; S.time = 400; S.leaderLap = 5;
  assert.equal(S.updateDRS, undefined); assert.ok(!('drsEnabled' in S));
  const car = S.cars[0];
  assert.ok(!('drsOpen' in car) && !('drsAvail' in car) && !('drs' in car.input));
  // even forcing the old flags changes nothing in the aerodynamics or the race state
  const cd = car.effCdA(), cl = car.effClA();
  car.drsOpen = true; car.drsAvail = true; car.input.drs = true; S.fixedStep(SIM.PHYS_DT);
  assert.equal(car.effCdA(), cd); assert.equal(car.effClA(), cl);
  for (const m of S.logArr || []) assert.ok(!/drs/i.test(String(m.text || m)));
  // no DRS key, gamepad button, HUD chip, help text, message, flap animation or comment anywhere in the game
  // (outside the embedded circuit data, whose base64 can spell anything)
  const code = html.replace(/\/\* ==CIRCUIT-DATA== \*\/[\s\S]*?\/\* ==CIRCUIT-DATA-END== \*\//, '');
  assert.equal((code.match(/drs/gi) || []).length, 0, 'DRS references left in index.html');
});
