const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Shared pit boxes, the pit-lane queue, service at the box, refuelling, automatic wing repairs, and the
// removal of DRS and ERS, exercised through the game's own Session, AI and physics.
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
// a car that has just crossed the pit-entry line at time `at`
function arrive(S, car, at, q = 1) {
  car.pit = { phase: 'queue', box: null, boxS: null, stopS: null, timer: 0, entryTime: at, queuePos: 0 };
  S.pitArrivals.push({ car, t: at, q });
}

test('the speed-limited lane is short and every circuit has the same four shared boxes', () => {
  for (const t of tracks.values()) {
    const p = t.pit, limited = p.len - p.E - p.X;
    // a 300 m entry ramp, a ~100 m working lane limited to 100 km/h and a 60 m exit ramp
    assert.ok(limited >= 80 && limited <= 120, t.name + ' limited lane ' + limited.toFixed(0) + ' m');
    assert.ok(Math.abs(p.limit * 3.6 - 100) < 1e-9 && p.len < 480, t.name + ' pit lane ' + p.len.toFixed(0) + ' m');
    assert.equal(p.boxes.length, 4);
    for (let k = 1; k < 4; k++) assert.ok(t.dS(p.boxes[k - 1], p.boxes[k]) >= 15, 'boxes in a row along the lane');
    // the boxes lie inside the speed-limited stretch, the queue line before them
    for (const b of p.boxes) assert.ok(t.inLimiter(b) && t.inPitMain(b));
    assert.ok(t.dS(p.queueS, p.boxes[0]) > 8);
    // a measured clean-stop loss and fuel consumption for this circuit
    assert.ok(t.def.pitLoss >= 18 && t.def.pitLoss <= 25, t.name + ' pit loss ' + t.def.pitLoss);
    assert.ok(t.def.fuelPerLap > 2 && t.def.fuelPerLap < 3.5);
  }
});

test('boxes go strictly first come, first served: at most four occupied, then one FIFO queue', () => {
  const S = session('monza', 8); S.lightsOut = true;
  const c = S.cars;
  // six cars arrive; two of them in the same step at the same instant (ordered by distance into the lane, then car)
  arrive(S, c[5], 10.0); arrive(S, c[2], 10.4); arrive(S, c[7], 10.4, 3); arrive(S, c[1], 10.4, 3); arrive(S, c[0], 11.0); arrive(S, c[3], 11.5);
  S.allocatePitBoxes();
  const order = [c[5], c[1], c[7], c[2], c[0], c[3]]; // by time, then furthest into the lane, then car number
  assert.equal(S.pitBoxesInUse(), 4);
  // (arrays from the game's sandbox are copied into this realm before comparing)
  assert.deepEqual([...S.pitBoxes].reverse(), order.slice(0, 4), 'earliest arrival gets the furthest free box, and so on');
  assert.deepEqual([...S.pitQueue], order.slice(4), 'the rest wait in arrival order');
  assert.deepEqual([...S.pitQueue].map(x => x.pit.queuePos), [1, 2]);
  for (const x of order.slice(0, 4)) assert.equal(x.pit.phase, 'in');
  assert.equal(new Set(S.pitBoxes).size, 4, 'no car holds two boxes');
  // a later arrival with a pit request gets no priority: it queues behind
  c[4].boxRequest = true; arrive(S, c[4], 12.0); S.allocatePitBoxes();
  assert.deepEqual([...S.pitQueue], [c[0], c[3], c[4]]);
  // a box frees when its car leaves; the earliest waiting car takes it
  const leaving = S.pitBoxes[2]; leaving.pit.phase = 'out'; S.allocatePitBoxes();
  assert.equal(S.pitBoxes[2], c[0]); assert.equal(c[0].pit.phase, 'in'); assert.equal(c[0].pit.box, 2);
  assert.deepEqual([...S.pitQueue], [c[3], c[4]]);
  // a car that retires in its box leaves it to the next one
  S.retire(S.pitBoxes[0]); S.allocatePitBoxes();
  assert.equal(S.pitBoxes[0], c[3]); assert.deepEqual([...S.pitQueue], [c[4]]);
  assert.ok(S.pitBoxesInUse() <= 4);
});

test('a car that simply steers into the pit entry, with no request, is given a free box and serviced', () => {
  const t = tracks.get('silverstone'), p = t.pit;
  const S = session('silverstone', 2, { spectate: false, entries: [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1], isPlayer: true }] });
  S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const [other, me] = S.cars; other.placeAt(t, 3000, 0, 40);
  assert.ok(!me.boxRequest);
  // (on the entry route, just past the commitment gate, where a car that has steered into the entry is)
  const s0 = t.wrapS(p.commit + 20); me.placeAt(t, s0, t.pitTargetD(s0, null), 30); me.gear = 5;
  let box = null, awaited = false;
  for (let k = 0; k < 240 * 40 && !awaited; k++) {
    S.fixedStep(SIM.PHYS_DT);
    if (me.pit && me.pit.box != null) box = me.pit.box;
    if (me.pit && me.pit.phase === 'awaiting') awaited = true;
  }
  assert.ok(box != null, 'a box was given at the entry');
  assert.ok(awaited, 'and the autopilot stopped in it, waiting for the player');
  assert.equal(S.pitBoxes[box], me);
});

// One car alone on the circuit, the same seed with and without a stop on lap 2.
function soloRace(id, { stop = false, prep = null, fuelLaps = 8, laps = 4, onStep = null } = {}) {
  const t = tracks.get(id);
  const S = new SIM.Session(t, { type: 'race', laps, entries: [{ driver: SIM.DRIVERS[0] }], seed: 11, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, mandatory: false, weatherState: DRY(3) });
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
  test(id + ': a clean tyre-only stop loses 17–27 s against staying out, as the circuit states', () => {
    const base = soloRace(id), pit = soloRace(id, { stop: true });
    const loss = pit.time - base.time;
    assert.ok(pit.P && pit.P.changeTyres && !pit.P.fuelAdd && !pit.P.fwT && !pit.P.rwT, 'a tyre-only stop');
    // (each real circuit's lane is measured: 19.3 s at Interlagos to 24.4 s at Bahrain over four seeds; one seed
    // lands within about 2 s of the mean)
    assert.ok(loss >= 17 && loss <= 27, id + ' clean stop loss ' + loss.toFixed(2) + ' s');
    assert.ok(Math.abs(loss - tracks.get(id).def.pitLoss) < 2.0, 'the stated loss matches the simulation: ' + loss.toFixed(2) + ' vs ' + tracks.get(id).def.pitLoss);
    assert.equal(pit.car.laps, 4); assert.equal(pit.car.pitStops, 1);
  });
}

test('queueing for a box and adding fuel lengthen the stop naturally', () => {
  const clean = soloRace('bahrain', { stop: true });
  // four parked cars hold every box for the first 12 s the car is in the lane
  const queued = soloRace('bahrain', { stop: true, prep: (S, car) => {
    const extra = SIM.DRIVERS.slice(1, 5).map(driver => new SIM.Car({ driver }, S));
    extra.forEach((o, k) => {
      S.cars.push(o); o.placeAt(S.track, S.track.pit.boxes[k], S.track.pit.side * S.track.pit.boxD, 0); o.frozen = true; o.started = true;
      o.pit = { phase: 'stopped', box: k, timer: 1e9, total: 1e9, boxS: S.track.pit.boxes[k], stopS: S.track.pit.boxes[k] }; S.pitBoxes[k] = o;
    });
    S._blockers = extra; S._freeAt = S.time + 12;
  }, onStep: (S) => { if (S._blockers && S.time >= S._freeAt) { for (const o of S._blockers) S.retire(o); S._blockers = null; } } });
  assert.ok(queued.visit.queued > 5, 'waited in the queue ' + queued.visit.queued.toFixed(1) + ' s');
  assert.ok(queued.visit.laneTime > clean.visit.laneTime + 5, 'longer in the lane: ' + queued.visit.laneTime.toFixed(1) + ' vs ' + clean.visit.laneTime.toFixed(1));
  // a light car takes on fuel: the stop lasts as long as the pumping, longer than the tyre change
  const fuel = soloRace('bahrain', { stop: true, fuelLaps: 2.2 });
  assert.ok(fuel.P.fuelAdd > 3, 'fuel added ' + fuel.P.fuelAdd);
  assert.ok(Math.abs(fuel.P.total - Math.max(fuel.P.tyreT, SIM.REFUEL.connect + fuel.P.fuelAdd / SIM.REFUEL.rate)) < 1e-9);
  // (the stationary time is what refuelling adds; the light car's time moving through the lane can be a little shorter)
  assert.ok(fuel.P.total > clean.P.total, 'refuelling took real stationary time');
  assert.ok(!fuel.car.dnf && fuel.car.finished, 'and the car reached the flag');
});

test('service is chosen only at the box; jobs run at once; wings are replaced when their job is done', () => {
  const t = tracks.get('monza');
  const S = new SIM.Session(t, { type: 'race', laps: 2, entries: [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1], isPlayer: true }], seed: 21, damage: 'standard', weather: 'dynamic', weatherState: DRY(5), startFuelLaps: 3 });
  S.totalLaps = 2;
  const p = S.player; p.autoDrive = true; p.boxRequest = true;
  assert.ok(!S.confirmPitService(p, { tyre: 'S', fuel: 0 }), 'no choice is possible before the car is in its box');
  let P = null, mid = null, before = null, after = null, prepped = false, massBefore = 0;
  for (let f = 0; f < 60 * 150 && !S.over; f++) {
    p.autopilot.boxThisLap = p.boxRequest; S.update(1 / 60, 1, 1e9);
    if (!prepped && p.pit && p.pit.phase === 'in') {
      prepped = true; p.damage.c[0] = 0.6; p.damage.c[1] = 0.4; p.damage.c[2] = 0.5; p.damage.c[3] = 0.35; p.damage.c[5] = 0.25; p.damage.computePerf();
    }
    if (p.pit && p.pit.phase === 'awaiting' && !P) {
      const room = S.fuelCapacity - p.fuel;
      assert.ok(S.pitSelectionError(p, { tyre: 'H', fuel: room + 1 }), 'more fuel than the tank holds is refused');
      assert.ok(S.pitSelectionError(p, { tyre: 'X', fuel: 0 }), 'only the four compounds or keep');
      massBefore = p.mass;
      assert.ok(S.confirmPitService(p, { tyre: 'H', fuel: 9 }));
      P = p.pit;
    }
    if (P && p.pit === P && P.phase === 'stopped') {
      const el = P.total - P.timer;
      if (!mid && el > 1.5 && el < P.fuelT - 0.5) mid = { fuel: P.fuelAdded, mass: p.mass };
      if (!before && el > 1 && el < P.fwT - 0.2) before = { fw: p.damage.fw, rw: p.damage.c[2], card: P.fwDone };
      if (!after && el > P.fwT + 0.05 && el < P.rwT - 0.1) after = { fw: p.damage.fw, rw: p.damage.c[2], card: P.fwDone };
    }
    if (P && p.pit && p.pit.phase === 'out') break;
  }
  assert.ok(P, 'the player chose the service in the box');
  // tyres ~2.5 s, fuel 0.5 + 9 / 3 = 3.5 s, front wing ~5 s, rear wing ~8 s: the stop is the longest job
  assert.ok(Math.abs(P.total - Math.max(P.tyreT, P.fuelT, P.fwT, P.rwT)) < 1e-9 && P.total < P.tyreT + P.fuelT + P.fwT + P.rwT - 5);
  assert.ok(P.fwT >= 4.6 && P.fwT <= 5.4 && P.rwT >= 7.4 && P.rwT <= 8.6, 'front ' + P.fwT.toFixed(2) + ' s, rear ' + P.rwT.toFixed(2) + ' s');
  assert.ok(mid && mid.fuel > 0 && mid.fuel < 9 && mid.mass > massBefore, 'fuel flows into the tank while the rig is on');
  assert.ok(before && before.fw > 0.3 && !before.card, 'the damaged wing stays on until its job is done');
  assert.ok(after && after.fw === 0 && after.card && after.rw > 0.3, 'then the new front wing is on; the rear wing is still being changed');
  assert.equal(p.damage.c[2], 0, 'new rear wing');
  assert.ok(p.damage.c[3] >= 0.35 && p.damage.c[5] >= 0.25, 'floor and suspension damage are not repaired');
  assert.equal(p.tyre.c, 'H');
  assert.ok(Math.abs(p.mass - massBefore - 9) < 0.2, 'the added fuel is carried as mass');
});

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
