// Fuel-weight calibration: drives identical cars with different fixed fuel loads round each circuit
// through the game's own Session, AI driver, handling and physics, and reports lap times plus the
// separate acceleration, braking, cornering and top-speed measurements.
//
//   node tools/fuel-calibration.cjs [path/to/index.html] [--seeds 3] [--circuits summit,rivermere,redridge]
//
// Everything that is not the fuel load is identical between runs: circuit, seed, driver, compound,
// fresh tyres (wear off), dry weather, no traffic, no mistakes, no pit stops. The fuel load is held
// constant during the measured laps so that each lap is driven at exactly the stated weight; a second
// pass lets the fuel burn to show the car getting quicker as it lightens.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const file = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
// --perf accel,brake,corner overrides the effective fuel-load coefficients (calibration scans)
if (opt('perf', null) && SIM.FUEL_PERF && opt('perf') !== 'default') { const [a, b, c] = opt('perf').split(',').map(Number); Object.assign(SIM.FUEL_PERF, { accel: a, brake: b, corner: c }); }
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const FUELS = [9, 15, 23];
const SEEDS = +opt('seeds', 4), LAPS = +opt('laps', 4);
const CIRCUITS = opt('circuits', 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');

// One car alone; laps 2..laps are flying laps. `hold` keeps the fuel load fixed.
function drive(id, fuel, seed, { laps = 3, hold = true, gameMode = 'grandprix' } = {}) {
  const t = tracks.get(id);
  const S = new SIM.Session(t, { type: 'race', laps, gameMode, entries: [{ driver: SIM.DRIVERS[0] }], seed, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, weatherState: DRY(seed) });
  S.totalLaps = laps;
  const car = S.cars[0];
  if (S.fuelEnabled) car.fuel = fuel;
  let vmax = 0;
  while (!S.over && S.time < 260 * laps) {
    S.fixedStep(SIM.PHYS_DT);
    if (hold && S.fuelEnabled) car.fuel = fuel;
    if (car.laps >= 1) vmax = Math.max(vmax, car.speed);
    if (car.pit) throw new Error('unexpected pit stop');
  }
  return { laps: car.lapTimes.map(l => l.t), vmax, car, S };
}

// Straight-line and cornering rig on a flat test surface (the same one tests/movement.cjs uses),
// with a race object that has fuel management on, like a Grand Prix session.
const flat = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => 0, pit: { limit: 22 }, pitAt() { return this.pit; } };
const env = { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false };
function rig(fuel, speed, fuelEnabled = true) {
  const race = { fuelEnabled, lightsOut: true, time: 0 };
  const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, race);
  car.fuel = fuel; car.vx = car.u = car.speed = speed; car.gear = speed > 50 ? 7 : speed > 20 ? 4 : 1; car.rpm = 10000;
  car.launch.active = false;
  return { car, h: new SIM.PlayerHandling(), sess: { lightsOut: true, wet: 0 } };
}
function step(r, input) { r.h.step(r.car, SIM.PHYS_DT, r.sess, { analog: false, ...input }); SIM.stepCarPhysics(r.car, SIM.PHYS_DT, flat, env); }
function accelTime(fuel, from, to, fe) { const r = rig(fuel, from, fe); let t = 0; while (r.car.speed < to && t < 60) { step(r, { steer: 0, throttle: 1, brake: 0 }); t += SIM.PHYS_DT; } return t; }
function brakeDist(fuel, from, to, fe) { const r = rig(fuel, from, fe); const x0 = r.car.x; while (r.car.speed > to) step(r, { steer: 0, throttle: 0, brake: 1 }); return r.car.x - x0; }
function topSpeed(fuel, fe) { const r = rig(fuel, 60, fe); for (let k = 0; k < 240 * 90; k++) step(r, { steer: 0, throttle: 1, brake: 0 }); return r.car.speed; }
// Steady full-lock turn at a held speed (the speed is pinned each step): yaw rate and lateral acceleration.
function cornering(fuel, speed, fe) {
  const r = rig(fuel, speed, fe); let yaw = 0, n = 0;
  for (let k = 0; k < 240 * 3; k++) {
    step(r, { steer: 1, throttle: 0, brake: 0 });
    const c = r.car, h = Math.atan2(c.vz, c.vx); c.vx = Math.cos(h) * speed; c.vz = Math.sin(h) * speed; c.speed = speed;
    if (k > 240 * 2) { yaw += Math.abs(c.r); n++; }
  }
  return { yaw: yaw / n, lat: yaw / n * speed / SIM.G };
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const out = { file: path.relative(process.cwd(), file), perf: SIM.FUEL_PERF || null, circuits: {}, rig: {} };
for (const id of CIRCUITS) {
  const res = {};
  for (const f of FUELS) {
    const laps = [], vm = [];
    for (let s = 0; s < SEEDS; s++) { const r = drive(id, f, 11 + s * 7, { laps: LAPS }); laps.push(...r.laps.slice(1)); vm.push(r.vmax); }
    res[f] = { lap: mean(laps), n: laps.length, vmax: mean(vm) * 3.6, all: laps };
  }
  // paired differences (same seed, same lap number) and their standard error
  const paired = (a, b) => { const d = res[b].all.map((x, k) => x - res[a].all[k]), m = mean(d); return { mean: m, se: Math.sqrt(mean(d.map(x => (x - m) ** 2)) / Math.max(1, d.length - 1)) }; };
  // Burning fuel: a 23 kg start, three laps, fuel consumed normally.
  const burn = drive(id, 23, 11, { laps: 4, hold: false });
  out.circuits[id] = { name: tracks.get(id).name, byFuel: res,
    delta15v9: paired(9, 15), delta23v9: paired(9, 23), delta23v15: paired(15, 23),
    burnLaps: burn.laps, burnFuelEnd: burn.car.fuel };
}
for (const f of FUELS) {
  out.rig[f] = {
    accel0to200: accelTime(f, 0.5, 200 / 3.6), accel100to250: accelTime(f, 100 / 3.6, 250 / 3.6),
    brake250to80: brakeDist(f, 250 / 3.6, 80 / 3.6), brake300to100: brakeDist(f, 300 / 3.6, 100 / 3.6),
    corner150: cornering(f, 150 / 3.6), corner250: cornering(f, 250 / 3.6), top: topSpeed(f) * 3.6,
  };
}
out.rig.noFuelManagement = { accel0to200_9: accelTime(9, 0.5, 200 / 3.6, false), accel0to200_23: accelTime(23, 0.5, 200 / 3.6, false) };
console.log(JSON.stringify(out, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v, 2));
