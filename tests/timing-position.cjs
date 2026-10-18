const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT;
const tracks = SIM.CIRCUITS.map(def => new SIM.Track(def));
function race(t, n = 1) {
  const s = new SIM.Session(t, { type: 'race', seed: 7, weather: 'dry', laps: 6,
    entries: SIM.DRIVERS.slice(0, n).map((driver, i) => ({ driver, isPlayer: i === 0 })) });
  s.lightsOut = true; s.lightsOutTime = 0; s.time = 76;
  for (const c of s.cars) { c.ai = null; c.ghost = true; c.started = true; c.crossings = 1; }
  return s;
}
function place(s, c, distance, speed = 50, d = 0) {
  const t = s.track, L = t.length;
  c.placeAt(t, distance, d, speed);
  // Account for the small projection error on a curved centre line.
  c.totalDist = distance + t.dS(t.wrapS(distance), c.s);
  c.laps = Math.max(0, Math.floor(distance / L)); c.lastLapBase = Math.floor(c.totalDist / L);
  c.lastWithin = t.wrapS(c.totalDist); c.sectorIdx = 2; c.lapStart = 0; c.sectorStart = 50;
  c.control = (dt, sess) => {
    (c.handling || (c.handling = new SIM.PlayerHandling())).step(c, dt, sess, { throttle: 1, brake: 0, steer: 0 });
  };
}
for (const t of tracks) {
  test(t.def.id + ': a 1:16 lap ends at the painted line even after a shortcut', () => {
    const s = race(t), c = s.player;
    place(s, c, t.length - 0.1);
    c.routeDebt = 240; // a previous off-track excursion must not displace the timing line
    const before = c.s, beforeTime = s.time;
    s.fixedStep(DT);
    assert.ok(c.s < 1, 'car physically crossed the line');
    assert.equal(c.laps, 1, 'lap counts in the crossing physics step');
    assert.ok(c.lastLap >= 76 && c.lastLap < 76 + DT, 'records 1:16, without extra seconds');
    const crossing = beforeTime + DT * t.dS(before, 0) / t.dS(before, c.s);
    assert.ok(Math.abs(c.lapStart - crossing) < 1e-8, 'crossing time interpolated at the painted line');
    assert.ok(s.time - c.lapStart < DT, 'next lap timer has already restarted');
    assert.equal(c.lapTimes.length, 1);
    assert.ok(Math.abs(t.dS(t.wrapS(c.totalDist), c.s)) < 1e-6);
    c.laps = s.totalLaps - 1; c.crossings = s.totalLaps;
    place(s, c, s.totalLaps * t.length - 0.1);
    s.fixedStep(DT);
    assert.ok(c.finished, 'chequered flag also occurs at the physical line');
    assert.equal(c.finishDist, s.totalLaps * t.length);
  });
  test(t.def.id + ': every displayed position follows the cars on the road despite different shortcut histories', () => {
    const s = race(t, 20);
    s.cars.forEach((c, i) => { place(s, c, t.length + 500 - i * 2, 50); c.routeDebt = i % 3 ? 0 : 240; });
    for (let k = 0; k < 240; k++) {
      s.fixedStep(DT);
      if (s.step % 4 !== 2) continue; // the live standings update at 60 Hz
      const physical = s.cars.slice().sort((a, b) => b.s - a.s);
      physical.forEach((c, i) => {
        assert.equal(c.position, i + 1, 'P' + (i + 1) + ' matches physical order at ' + s.time);
        assert.ok(Math.abs(t.dS(t.wrapS(c.totalDist), c.s)) < 1e-6, 'no invisible distance deficit');
      });
    }
  });
  test(t.def.id + ': holding W accelerates immediately after returning from the verge', () => {
    const s = race(t), c = s.player, keys = new SIM.KeyboardDriveInput(), handling = new SIM.PlayerHandling();
    keys.setKey('KeyW', true, 0);
    c.placeAt(t, t.length - 80, -t.pit.side * (t.halfW + 5), 25);
    c.speed = c.u = 25; c.gear = 3; c.launch.active = false; c.routeDebt = 10000;
    const env = { wet: 0, trackTemp: 30, wearScale: 0, fuelRate: 0, pitLimiter: false };
    const step = () => {
      handling.step(c, DT, s, keys.step(DT)); SIM.stepCarPhysics(c, DT, t, env);
      t.project(c.x, c.z, c.idx, c.proj); c.idx = c.proj.i; c.s = c.proj.s; c.d = c.proj.d;
    };
    for (let k = 0; k < 0.75 / DT; k++) step();
    assert.equal(c.offN, 4, 'the excursion is really off the circuit');
    const rejoinSpeed = c.speed;
    c.placeAt(t, c.s, 0, rejoinSpeed);
    for (let k = 0; k < 3 / DT; k++) {
      step(); assert.equal(c.input.throttle, 1); assert.equal(c.input.brake, 0);
      assert.equal(c.routeDebt, 0, 'no queued slowdown after rejoining');
      assert.ok(c.speed > 5, 'held W never stalls');
    }
    assert.ok(c.speed > rejoinSpeed + 6, 'the car accelerates without another keypress');
  });
  test(t.def.id + ': marshal recovery keeps the timing coordinate at the car', () => {
    const s = race(t), c = s.player;
    place(s, c, t.length - 2, 0, 2);
    const before = c.totalDist;
    for (let k = 0; k < 5; k++) s.marshalReset(c);
    assert.ok(Math.abs(c.totalDist - before) < 0.1, 'recovery does not jump down the straight');
    assert.ok(Math.abs(t.dS(t.wrapS(c.totalDist), c.s)) < 1e-6);
    assert.equal(c.laps, 0, 'recovery does not complete a lap');
  });
}
test('backing across the line and driving forward again cannot count a second lap', () => {
  const t = tracks[0], s = race(t), c = s.player;
  place(s, c, t.length - 0.1); s.fixedStep(DT);
  assert.equal(c.laps, 1);
  const lastLap = c.lastLap, lapStart = c.lapStart;
  for (const distance of [t.length - 0.1, t.length + 0.1]) {
    const old = c.totalDist;
    c.totalDist = distance; c.progress = distance - old;
    s.time += DT; s.timing(c, c.s, DT);
  }
  assert.equal(c.laps, 1); assert.equal(c.lastLap, lastLap); assert.equal(c.lapStart, lapStart);
});
test('pending off-track slowdown cannot brake a car back on the asphalt', () => {
  const t = tracks[0], s = race(t), c = s.player;
  place(s, c, t.length - 150, 50); c.routeDebt = 10000;
  let slowest = 50;
  for (let k = 0; k < 3 / DT; k++) {
    s.fixedStep(DT);
    slowest = Math.min(slowest, c.speed);
    assert.equal(c.input.brake, 0);
    assert.equal(c.routeDebt, 0, 'no off-track braking is carried onto asphalt');
  }
  assert.ok(slowest > 45, 'no rejoin braking dip');
  assert.ok(c.speed > 60, 'held W accelerates again');
  assert.ok(Math.abs(t.dS(t.wrapS(c.totalDist), c.s)) < 1e-6);
});
test('a projection jump during an excursion does not leave a permanent timing offset', () => {
  const t = tracks[0], s = race(t), c = s.player;
  place(s, c, t.length + 500, 0);
  const [x, z] = t.pointAt(c.s + 40, 0);
  c.control = () => { c.x = x; c.z = z; c.control = null; };
  s.fixedStep(DT);
  assert.equal(c.routeDebt, 0, 'a jump judged on asphalt cannot queue a later braking dip');
  assert.ok(Math.abs(t.dS(t.wrapS(c.totalDist), c.s)) < 1e-6, 'recorded progress still matches the car');
});
