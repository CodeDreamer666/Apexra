const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The amplified fuel-weight effect (Grand Prix and Career): about five times the real-world lap-time cost
// of carrying fuel, produced by the physics (inertia, braking, cornering) rather than by the lap timer;
// unchanged top speed, collision mass and consumption; one fixed, equal load in Rival Duel and Pursuit; and AI fuel strategy that weighs it.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const dt = SIM.PHYS_DT;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });

// Flat test surface (as tests/movement.cjs) with a race that manages fuel, like a Grand Prix session.
const flat = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => 0, pit: { limit: 22 }, pitAt() { return this.pit; } };
const env = { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false };
function rig(fuel, speed = 0, fuelEnabled = true) {
  const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, { fuelEnabled, lightsOut: true, time: 0 });
  car.fuel = fuel; car.vx = car.u = car.speed = speed; car.gear = speed > 50 ? 7 : speed > 20 ? 4 : 1; car.rpm = 10000; car.launch.active = false;
  return { car, h: new SIM.PlayerHandling(), sess: { lightsOut: true, wet: 0 } };
}
const step = (r, input) => { r.h.step(r.car, dt, r.sess, { analog: false, steer: 0, throttle: 0, brake: 0, ...input }); SIM.stepCarPhysics(r.car, dt, flat, env); };
function accel(fuel, from, to, fe = true) { const r = rig(fuel, from, fe); let t = 0; while (r.car.speed < to && t < 60) { step(r, { throttle: 1 }); t += dt; } return t; }
function brakeDist(fuel, from, to, fe = true) { const r = rig(fuel, from, fe); const x0 = r.car.x; while (r.car.speed > to) step(r, { brake: 1 }); return r.car.x - x0; }
function topSpeed(fuel) { const r = rig(fuel, 60); for (let k = 0; k < 240 * 120; k++) step(r, { throttle: 1 }); return r.car.speed; }
function yawAt(fuel, speed) {
  const r = rig(fuel, speed); let yaw = 0, n = 0;
  for (let k = 0; k < 240 * 3; k++) {
    step(r, { steer: 1 });
    const c = r.car, h = Math.atan2(c.vz, c.vx); c.vx = Math.cos(h) * speed; c.vz = Math.sin(h) * speed; c.speed = speed;
    if (k > 480) { yaw += Math.abs(c.r); n++; }
  }
  return yaw / n;
}

test('the effect is a smooth, monotonic function of the fuel in the tank, neutral when empty', () => {
  const r = rig(0); let prev = null;
  for (let f = 0; f <= 24.5 + 1e-9; f += 0.05) {
    r.car.fuel = f;
    const k = { i: r.car.fuelInertiaMul(), b: r.car.fuelBrakeMul(), t: r.car.fuelTurnMul() };
    if (f === 0) assert.deepEqual([k.i, k.b, k.t], [1, 1, 1], 'an empty car is the base car: never faster than it');
    for (const x of Object.values(k)) assert.ok(x > 0 && x <= 1);
    if (prev) for (const key of ['i', 'b', 't']) {
      assert.ok(k[key] <= prev[key], 'heavier is never quicker (' + key + ' at ' + f.toFixed(2) + ' kg)');
      assert.ok(prev[key] - k[key] < 0.003, 'no step in performance (' + key + ' at ' + f.toFixed(2) + ' kg)');
    }
    prev = k;
  }
});

test('the real mass is unchanged: tank, consumption and collisions keep 800 kg + fuel', () => {
  const S = new SIM.Session(tracks.get('monza'), { type: 'race', laps: 8, entries: [{ driver: SIM.DRIVERS[0] }], seed: 3, spectate: true, weather: 'dynamic', weatherState: DRY(3) });
  const c = S.cars[0];
  for (const f of [3, 9, 15, 23]) { c.fuel = f; assert.equal(c.mass, SIM.SPEC.mass + f); }
  // consumption: the existing throttle/rpm/time formula, whatever the load
  for (const f of [9, 23]) {
    const r = rig(f, 40); const e = { ...env, fuelRate: 0.04 }; r.car.rpm = 11000; r.car.gear = 6;
    r.h.step(r.car, dt, r.sess, { analog: false, steer: 0, throttle: 1, brake: 0 });
    const before = r.car.fuel;
    SIM.stepCarPhysics(r.car, dt, flat, e);
    // (the step settles the rpm before metering, so the stepped values are the ones used)
    const used = before - r.car.fuel, expect = 0.04 * (0.15 + 0.85 * r.car.throttle) * (r.car.rpm / 12000) * dt;
    assert.ok(Math.abs(used - expect) < 1e-12, 'fuel burns by the unchanged formula (' + f + ' kg)');
  }
});

test('acceleration, braking and cornering all suffer with fuel; top speed does not', () => {
  // a traction-limited launch is not slower (the effective load also presses the tyres down), and never
  // quicker than the same car without the fuel effect
  const l9 = accel(9, 0.5, 100 / 3.6), l23 = accel(23, 0.5, 100 / 3.6), l0 = accel(9, 0.5, 100 / 3.6, false);
  assert.ok(Math.abs(l23 - l9) < 0.1, '0–100 km/h: ' + l9.toFixed(2) + ' s vs ' + l23.toFixed(2) + ' s');
  assert.ok(l9 >= l0 - 1e-9 && l23 >= l0 - 1e-9, 'never quicker than without the fuel effect (' + l0.toFixed(2) + ' s)');
  const a9 = accel(9, 0.5, 200 / 3.6), a23 = accel(23, 0.5, 200 / 3.6);
  assert.ok(a23 > a9 * 1.08, '0–200 km/h: ' + a9.toFixed(2) + ' s light vs ' + a23.toFixed(2) + ' s heavy');
  const m9 = accel(9, 100 / 3.6, 250 / 3.6), m23 = accel(23, 100 / 3.6, 250 / 3.6);
  assert.ok(m23 > m9 * 1.2, '100–250 km/h: ' + m9.toFixed(2) + ' vs ' + m23.toFixed(2));
  const h9 = accel(9, 250 / 3.6, 300 / 3.6), h23 = accel(23, 250 / 3.6, 300 / 3.6);
  assert.ok(h23 > h9 * 1.2, '250–300 km/h: ' + h9.toFixed(2) + ' vs ' + h23.toFixed(2));
  const b9 = brakeDist(9, 250 / 3.6, 80 / 3.6), b23 = brakeDist(23, 250 / 3.6, 80 / 3.6);
  assert.ok(b23 > b9 * 1.06 && b23 < b9 * 1.2, 'braking 250–80 km/h: ' + b9.toFixed(1) + ' m vs ' + b23.toFixed(1) + ' m');
  const y9 = yawAt(9, 250 / 3.6), y23 = yawAt(23, 250 / 3.6);
  assert.ok(y23 < y9 * 0.995 && y23 > y9 * 0.97, 'corner yaw ceiling at 250 km/h: ' + y9.toFixed(4) + ' vs ' + y23.toFixed(4));
  const v9 = topSpeed(9), v23 = topSpeed(23);
  assert.ok(Math.abs(v9 - v23) < 0.005 * v9, 'top speed on a long straight: ' + (v9 * 3.6).toFixed(1) + ' vs ' + (v23 * 3.6).toFixed(1) + ' km/h');
  // the engine is untouched: the light car's top speed is the base car's
  assert.ok(Math.abs(v9 - topSpeed(0.001)) < 0.005 * v9);
});

test('bare rigs feel no fuel effect; Rival Duel and Pursuit give both cars one fixed, equal load with the same fuel physics', () => {
  // without fuel management only the real mass of the fuel acts (a few per cent), not the amplified effect
  const a9 = accel(9, 0.5, 200 / 3.6, false), a23 = accel(23, 0.5, 200 / 3.6, false), A9 = accel(9, 0.5, 200 / 3.6), A23 = accel(23, 0.5, 200 / 3.6);
  assert.ok(a23 >= a9 && (a23 - a9) / a9 < 0.03, 'real mass only: ' + a9.toFixed(2) + ' / ' + a23.toFixed(2));
  assert.ok(A23 - A9 > 3 * (a23 - a9), 'the amplified effect is much larger with fuel management');
  for (const t of tracks.values()) for (const gameMode of ['duel', 'pursuit']) {
    // the player's saved start-fuel choice is ignored: there is no fuel choice in these modes
    const entries = SIM.DRIVERS.slice(0, 2).map((driver, i) => ({ driver, isPlayer: i === 0 }));
    const S = new SIM.Session(t, { type: 'race', gameMode, entries, seed: 4, weather: 'dynamic', startFuelLaps: 7, pursuit: { gap: 3, rivalWear: 0.25, rival: 1 } });
    assert.equal(S.fuelEnabled, true); assert.equal(S.pitsEnabled, false);
    const want = S.fuelForLaps(SIM.RANKED_FUEL_LAPS);
    for (const c of S.cars) { assert.equal(c.fuel, want); assert.equal(c.startFuelLaps, SIM.RANKED_FUEL_LAPS); }
    assert.ok(want > 2 * S.fuelPerLap, 'enough to finish two laps');
    const [a, b] = S.cars;
    for (const f of ['fuelInertiaMul', 'fuelBrakeMul', 'fuelTurnMul']) assert.equal(a[f](), b[f](), f);
    assert.equal(a.mass, b.mass);
  }
});

// One AI car alone, the fuel load held fixed through the laps: identical car, tyres, weather and driver.
function lapTimes(id, fuel, seed) {
  const t = tracks.get(id);
  const S = new SIM.Session(t, { type: 'race', laps: 4, entries: [{ driver: SIM.DRIVERS[0] }], seed, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, weatherState: DRY(seed) });
  S.totalLaps = 4; const car = S.cars[0]; car.fuel = fuel;
  while (!S.over && S.time < 1000) { S.fixedStep(dt); car.fuel = fuel; assert.ok(!car.pit, 'no pit stop'); }
  return car.lapTimes.slice(1).map(l => l.t);
}
for (const id of SIM.CIRCUITS.map(c => c.id)) {
  test(id + ': 23 kg against 9 kg costs about 2.5–5.5 s a lap, through the physics (slow)', () => {
    const d = { 15: [], 23: [] };
    // the calibration seeds of tools/fuel-calibration.cjs (8 seeds × 3 flying laps)
    for (let k = 0; k < 8; k++) { const seed = 11 + 7 * k;
      const l9 = lapTimes(id, 9, seed), l15 = lapTimes(id, 15, seed), l23 = lapTimes(id, 23, seed);
      l9.forEach((x, j) => { d[15].push(l15[j] - x); d[23].push(l23[j] - x); });
    }
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const d15 = mean(d[15]), d23 = mean(d[23]);
    // (the real circuits differ: about 3.2 s a lap at Silverstone and Interlagos, 4.4 s at Bahrain and 5 s over Spa's
    // 7 km, where the climbs and the long lap both add to what the weight costs)
    assert.ok(d23 >= 2.5 && d23 <= 5.5, id + ': 23 vs 9 kg ' + d23.toFixed(2) + ' s');
    assert.ok(d15 > 0.6 && d15 < d23 * 0.65, id + ': 15 vs 9 kg ' + d15.toFixed(2) + ' s');
    // the circuit's strategy figure (s per kg per lap) matches what the cars actually lose
    assert.ok(Math.abs(d23 / 14 - tracks.get(id).def.fuelLapCost) < 0.05, id + ' fuelLapCost ' + tracks.get(id).def.fuelLapCost + ' vs measured ' + (d23 / 14).toFixed(3));
  });
}

function grid(id, extra = {}) {
  const t = tracks.get(id);
  return new SIM.Session(t, { type: 'race', laps: SIM.GAME_MODES.grandprix.laps, entries: SIM.DRIVERS.slice(0, 20).map(driver => ({ driver })), seed: 9, spectate: true, weather: 'dynamic', weatherState: DRY(9), ...extra });
}

test('the strategy model prices fuel weight, refuelling time and extra stops', () => {
  const S = grid('monza', { tyreWear: 'off' });
  const c = S.cars[0], L = S.totalLaps;
  // on the quickest dry tyre with no wear there is no reason to stop: carrying the whole race's fuel
  // beats a stop for fuel
  const full = SIM.planStrategy(S, c, L, 'S', 0, { fixed: S.fuelForLaps(L) });
  const light = SIM.planStrategy(S, c, L, 'S', 0, { fixed: S.fuelForLaps(3) });
  assert.equal(full.stops.length, 0); assert.equal(light.stops.length, 1, 'a 3-lap load has to stop for fuel');
  assert.ok(light.stops[0].lap <= 3);
  assert.ok(full.cost < light.cost, 'with no tyre stop, the extra stop costs more than the weight saves');
  // the fuel weight itself is priced: a lighter load for the same plan is quicker
  const a = SIM.planStrategy(S, c, 3, 'S', 0, { fixed: S.fuelForLaps(4) });
  const b = SIM.planStrategy(S, c, 3, 'S', 0, { fixed: S.fuelForLaps(8) });
  assert.equal(a.stops.length, 0); assert.equal(b.stops.length, 0);
  assert.ok(b.cost - a.cost > 0.5 * 2.78 * 4 * 3 * S.fuelLapCost, 'four extra laps of fuel carried for three laps');
});

test('AI starting fuel is chosen on predicted race time, not simply the minimum', () => {
  for (const id of SIM.CIRCUITS.map(c => c.id)) {
    // soft tyres that last the race and no second compound required: nothing gains from stopping
    const none = grid(id, { tyreWear: 'off' });
    const L = none.totalLaps, [lo] = SIM.START_FUEL_LAPS;
    const heavy = none.cars.filter(c => SIM.chooseStartFuelLaps(none, c, 'S') >= L - 0.5).length;
    assert.ok(heavy >= 16, id + ': ' + heavy + '/20 run to the flag without a fuel stop');
    // with normal tyre wear a tyre stop is often coming anyway: those cars run lighter and refuel then (on
    // Redridge, where grip matters least, many plan the Hard no-stop and carry the whole race's fuel; with its
    // measured 19 s pit loss about a third of that grid starts light)
    const stop = grid(id);
    const laps = stop.cars.map(c => c.startFuelLaps);
    assert.ok(laps.filter(x => x < L - 0.5).length >= (id === 'bahrain' ? 6 : 8), id + ' starting fuel ' + laps.join(','));
    for (const c of stop.cars) if (c.startFuelLaps < L - 0.5) {
      const plan = SIM.planStrategy(stop, c, L, c.tyre.c, 0, { fixed: stop.fuelForLaps(c.startFuelLaps) });
      assert.ok(plan.stops.length > 0, id + ': ' + c.driver.short + ' starts on ' + c.startFuelLaps + ' laps of fuel with a stop planned');
    }
    assert.ok(new Set(laps).size >= 3, 'drivers still differ');
    assert.ok(laps.filter(x => x === lo).length < 12, 'not everyone takes the minimum');
    for (const x of laps) assert.ok(x >= lo && x <= L);
  }
  // personality: with the same plan a bold driver leans lighter than a careful one
  const S = grid('monza');
  const bold = S.cars[0], careful = S.cars[1];
  bold.ai.p = { ...bold.ai.p, risk: 1, strat: 1 }; careful.ai.p = { ...careful.ai.p, risk: 0, strat: 1 }; careful.ai.skill = bold.ai.skill = 0;
  careful.fuelPerLapEst = bold.fuelPerLapEst = S.fuelPerLap;
  const b = SIM.chooseStartFuelLaps(S, bold, 'H'), c = SIM.chooseStartFuelLaps(S, careful, 'H');
  assert.ok(b <= c, 'bold ' + b + ' vs careful ' + c);
});

test('AI refuelling: to the next real stop when one is coming, to the flag when not', () => {
  const S = grid('monza', { tyreWear: 'off' });
  S.lightsOut = true; const c = S.cars[3];
  c.laps = 3; c.totalDist = S.track.length * 3; c.fuel = 2;
  const toFlag = c.engineer.refuelFor('keep'), left = S.lapsLeft(c);
  assert.ok(c.fuel + toFlag >= left * S.fuelPerLap + SIM.FUEL_RESERVE, 'enough for the remaining ' + left.toFixed(1) + ' laps');
  assert.ok(c.fuel + toFlag <= S.fuelCapacity + 1e-9);
  // the same fuel-weight physics as the player's car: no AI-only factor
  const p = new SIM.Car({ driver: SIM.DRIVERS[19], isPlayer: true }, S);
  for (const f of [4, 12, 22]) {
    c.fuel = p.fuel = f;
    assert.deepEqual([c.fuelInertiaMul(), c.fuelBrakeMul(), c.fuelTurnMul()], [p.fuelInertiaMul(), p.fuelBrakeMul(), p.fuelTurnMul()]);
  }
});
