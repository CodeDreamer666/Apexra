const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const moduleShim = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(moduleShim);
const SIM = moduleShim.exports;

function field(track, player = true, weather = 'dry') {
  const race = new SIM.Session(track, { type: 'race', entries: SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: player && i === 0 })),
    seed: 71, weather, tyreWear: 'off', mandatory: false, mistakes: 0 });
  race.lightsOut = true; race.time = 50; race.drsEnabled = true;
  for (const c of race.cars) { c.inGarage = true; c.launch.active = false; }
  return race;
}
function place(race, car, distance, speed = 50, d = 0) {
  const t = race.track;
  car.inGarage = car.ghost = car.finished = car.dnf = car.spun = car.offTrackFlag = false;
  car.pit = car.retiring = null;
  car.placeAt(t, t.wrapS(distance), d, speed); car.speed = car.u = speed;
  car.totalDist = distance; car.laps = Math.floor(distance / t.length); car.crossings = car.laps + 1;
  car.lastLapBase = car.laps; car.lastWithin = t.wrapS(distance); car.started = true;
  car.input.throttle = .8; car.input.brake = 0;
  if (car.ai) { car.ai.pitting = false; car.ai.pitEntryBlend = 0; car.ai.mode = 'race'; car.ai.boxThisLap = false; }
}
const tracks = SIM.CIRCUITS.map(def => new SIM.Track(def));

for (const t of tracks) {
  test(t.name + ': each of 20 cars receives flags only for genuine approaching lappers', () => {
    const r = field(t), L = t.length;
    for (let i = 0; i < 20; i++) {
      for (const c of r.cars) { c.inGarage = true; r.clearBlueFlag(c); }
      const c = r.cars[i], o = r.cars[(i + 1) % 20];
      place(r, c, L + 400); place(r, o, L + 360, 60);
      r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, 'same-lap battle');
      place(r, o, 2 * L + 360, 60);
      const before = [c.totalDist, o.totalDist, c.laps, o.laps, c.position, o.position];
      const input = { ...c.input };
      r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o, 'car ' + i);
      assert.deepEqual(c.input, input, 'flag detection never changes driver controls');
      assert.deepEqual([c.totalDist, o.totalDist, c.laps, o.laps, c.position, o.position], before);
      place(r, o, 2 * L + 395, 52); r.updateBlueFlags(.1);
      assert.equal(c.blueFlag.target, o, 'retain while alongside');
      place(r, o, 2 * L + 414, 52); r.updateBlueFlags(.1);
      assert.equal(c.blueFlag.target, null, 'clear after safe pass');
    }
  });

  test(t.name + ': timing-line wrap, hysteresis, unlapping and disconnected sections', () => {
    const r = field(t), [c, o] = r.cars, L = t.length;
    place(r, c, L + 10); place(r, o, 2 * L - 20, 60);
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o, 'equal counts across timing line');
    r.clearBlueFlag(c); place(r, o, L - 20, 60);
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, 'same-lap timing-line crossing');
    place(r, c, L + 700); place(r, o, 2 * L + 565, 60);
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o);
    for (const gap of [140, 145, 138, 150]) { place(r, o, 2 * L + 700 - gap, 60); r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o); }
    place(r, o, 2 * L + 660, 45);
    for (let k = 0; k < 30; k++) r.updateBlueFlags(.1);
    assert.equal(c.blueFlag.target, null, 'faster lapped car need not yield indefinitely');
    place(r, o, 2 * L + 1000, 60); o.x = c.x; o.z = c.z;
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, 'world-space proximity cannot trigger a flag');
    place(r, o, 2 * L + 665, 60); o.totalDist -= L * .6;
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, 'half-lap distance is insufficient');
    place(r, o, 2 * L + 665, 60); o.vx *= -1; o.vz *= -1;
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, 'a car travelling backwards is not an approaching lapper');
    place(r, o, 4 * L + 665, 60);
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o, 'multiple laps ahead');
  });

  test(t.name + ': pit, rejoin, retirement, finish and neutralization exclusions', () => {
    const r = field(t), [c, o] = r.cars, L = t.length;
    const setup = () => { r.over = r.finishedFlag = r.vscActive = false; r.vsc = null; c.blueRejoinUntil = o.blueRejoinUntil = 0;
      place(r, c, L + 400); place(r, o, 2 * L + 360, 60); r.clearBlueFlag(c); };
    for (const who of [c, o]) for (const state of ['pit', 'dnf', 'finished', 'retiring', 'ghost', 'inGarage', 'rejoin', 'entry']) {
      setup();
      if (state === 'pit') who.pit = { phase: 'out' };
      else if (state === 'retiring') who.retiring = {};
      else if (state === 'rejoin') who.blueRejoinUntil = r.time + 3;
      else if (state === 'entry') { if (who.ai) who.ai.pitting = true; else { who.boxRequest = true; who.s = t.wrapS(t.pit.entry0 - 50); } }
      else who[state] = true;
      r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null, state);
      who.boxRequest = false;
    }
    setup(); r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o);
    c.blueFlag.blocking = 13; c.blueFlag.warned = true; r.vscActive = true;
    r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null); assert.equal(c.penalty, 0);
    r.vscActive = false; r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o);
    r.vsc = { phase: 'ending' }; r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null);
    setup(); r.finishedFlag = true; r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null);
    setup(); r.over = true; r.updateBlueFlags(.1); assert.equal(c.blueFlag.target, null);
  });

  test(t.name + ': every AI yields on clear straights and waits at unsafe corners', () => {
    const r = field(t), L = t.length;
    for (let i = 1; i < 20; i++) {
      for (const c of r.cars) { c.inGarage = true; r.clearBlueFlag(c); }
      const c = r.cars[i], o = r.cars[0];
      place(r, c, L + 150); place(r, o, 2 * L + 110, 60);
      r.updateBlueFlags(.1); c.ai.tactical();
      assert.equal(c.ai.blue, true); assert.equal(c.ai.blueYield, true);
      assert.equal(c.ai.defending, false); assert.equal(c.ai.vLimit, 110);
      const side = c.blueFlag.side;
      for (let k = 0; k < 4; k++) { c.ai.tactical(); assert.equal(c.blueFlag.side, side); assert.ok(Math.abs(c.ai.laneD) < t.halfW - 1.3); }
      place(r, o, 2 * L + 165, 60); r.updateBlueFlags(.1); c.ai.tactical();
      assert.equal(c.ai.blue, false); assert.equal(c.ai.blueYield, false);
      const corner = t.corners.find(n => Math.abs(t.kappa[n.apex]) > .004);
      place(r, c, L + corner.apex * SIM.DS, 25); place(r, o, 2 * L + corner.apex * SIM.DS - 35, 28);
      r.updateBlueFlags(.1); c.ai.tactical();
      assert.equal(c.ai.blue, true); assert.equal(c.blueFlag.safe, false); assert.equal(c.ai.blueYield, false);
    }
  });

  test(t.name + ': wet and damaged cars yield without performance changes; same-lap battles continue', () => {
    const r = field(t, false, 'wet'), [c, o, rival] = r.cars, L = t.length;
    place(r, c, L + 150, 40); place(r, o, 2 * L + 110, 50);
    c.damage.c[8] = .3; c.damage.computePerf(); c.tyre.wear.fill(.7);
    const performance = JSON.stringify(c.damage.perf), wear = [...c.tyre.wear];
    r.updateBlueFlags(.1); c.ai.tactical();
    assert.equal(c.blueFlag.target, o); assert.equal(c.ai.blueYield, true);
    assert.equal(JSON.stringify(c.damage.perf), performance); assert.deepEqual([...c.tyre.wear], wear);
    place(r, rival, L + 140, 40); r.updateBlueFlags(.1); c.ai.tactical();
    assert.equal(c.blueFlag.target, o, 'warning remains while a lapper approaches');
    assert.equal(c.ai.blueYield, false, 'do not disturb an ongoing same-lap battle');
    assert.equal(c.ai.vLimit, 110, 'no artificial slowing during the battle');
  });
}

test('player penalties require repeated reactive obstruction, with warning first and a cooldown', () => {
  const t = tracks[0], r = field(t), [c, o] = r.cars, L = t.length;
  place(r, c, L + 150); place(r, o, 2 * L + 135, 50);
  r.updateBlueFlags(.1);
  for (let k = 0; k < 500; k++) { r.time += .1; r.updateBlueFlags(.1); }
  assert.equal(c.penalty, 0); assert.equal(c.blueFlag.warned, false, 'stationary lane choice is not blocking');
  // Three visible reactive moves following the lapper across a clear straight.
  for (const direction of [1, -1, 1]) {
    r.time += 1.5;
    c.blueFlag.lastD = -.5 * direction; c.blueFlag.lastTargetD = 1 * direction;
    c.d = 0; o.d = 1.2 * direction;
    r.updateBlueFlags(.1);
  }
  assert.ok(c.blueFlag.moves >= 2);
  for (let k = 0; k < 65; k++) { r.time += .1; r.updateBlueFlags(.1); }
  assert.equal(c.blueFlag.warned, true); assert.equal(c.penalty, 0);
  for (let k = 0; k < 90; k++) { r.time += .1; r.updateBlueFlags(.1); }
  assert.equal(c.penalty, 5);
  for (let k = 0; k < 200; k++) { r.time += .1; r.updateBlueFlags(.1); }
  assert.equal(c.penalty, 5, 'one penalty per encounter');
  assert.equal(c.penaltyLog[0], 'Repeated blocking under blue flags');
});

test('unsafe corners, wet conditions, same-lap battles and VSC never accrue obstruction', () => {
  const t = tracks[0], r = field(t), [c, o, rival] = r.cars, L = t.length;
  place(r, c, L + 150); place(r, o, 2 * L + 135, 50); r.updateBlueFlags(.1);
  for (const condition of ['corner', 'wet', 'battle', 'vsc']) {
    c.blueFlag.moves = 3; c.blueFlag.blocking = 5.9; c.blueFlag.age = 20;
    r.wet = 0; r.vscActive = false; rival.inGarage = true;
    if (condition === 'corner') c.input.brake = .5; else c.input.brake = 0;
    if (condition === 'wet') r.wet = .8;
    if (condition === 'battle') place(r, rival, L + 165, 50);
    if (condition === 'vsc') r.vscActive = true;
    r.updateBlueFlags(.1);
    assert.equal(c.penalty, 0); assert.equal(c.blueFlag.warned, false, condition);
    assert.ok(c.blueFlag.blocking < 5.9);
  }
});

for (const t of tracks) test(t.name + ': 20-car lapping traffic keeps moving with real physics and classification', () => {
  const r = field(t, false), L = t.length;
  // Ten lapping pairs, spread around the actual route. Each slower driver is
  // marked a lap down; no flags alter these distances or the starting order.
  for (let i = 0; i < 10; i++) {
    const s = t.wrapS(150 + i * L / 10);
    place(r, r.cars[i * 2], L + s, 45);
    place(r, r.cars[i * 2 + 1], 2 * L + s - 40, 60);
  }
  const start = r.cars.map(c => c.totalDist), baseCollisions = r.stats.collisions;
  let flags = 0, cleared = new Set(), previouslyFlagged = new Set();
  for (let step = 0; step < 45 / SIM.PHYS_DT; step++) {
    r.fixedStep(SIM.PHYS_DT);
    if (step % 24 === 0) for (const c of r.cars) {
      if (c.blueFlag.target) { flags++; previouslyFlagged.add(c); }
      else if (previouslyFlagged.has(c)) cleared.add(c);
      assert.ok(Number.isFinite(c.speed) && Number.isFinite(c.x) && Number.isFinite(c.z));
    }
  }
  assert.ok(flags > 20); assert.ok(cleared.size >= 5, 'lapping encounters complete');
  for (let i = 0; i < 20; i++) {
    const c = r.cars[i]; assert.ok(c.totalDist - start[i] > 600, c.driver.short + ' became stuck');
    assert.equal(c.dnf, false); assert.equal(c.ai.mode, 'race');
    assert.ok(Math.abs(c.d) < t.halfW + 1.5, 'stays on the racing surface');
    assert.equal(c.laps, Math.floor(c.totalDist / L));
  }
  assert.ok(r.stats.collisions - baseCollisions <= 3, 'avoid unnecessary contact');
  assert.equal(r.order.length, 20);
  for (let k = 1; k < 20; k++) assert.ok(r.order[k - 1].totalDist >= r.order[k].totalDist);
});
