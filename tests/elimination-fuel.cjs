const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function loadSim() {
  const m = { exports: {} };
  new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
  return m.exports;
}
const SIM = loadSim();
const tracks = SIM.CIRCUITS.map(def => new SIM.Track(def));
function session(track, mode = 'elimination', extra = {}, sim = SIM) {
  return new sim.Session(track, { type: 'race', gameMode: mode, seed: 73, weather: 'dry', damage: 'reduced',
    startCompound: 'M', startFuelLaps: 3, entries: sim.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === 0 })), ...extra });
}
function box(S, car, tyre = 'H', fuel) {
  // Elimination services at its distributed stations (one box each); Grand Prix at the shared pit lane.
  const p = S.track.stations ? S.track.stations[0] : S.track.pit;
  car.placeAt(S.track, p.boxes[0], p.side * p.boxD, 0);
  car.pit = { phase: 'awaiting', station: p.id, box: 0, boxS: p.boxes[0], stopS: p.boxes[0], entryTime: S.time, arrivedAt: S.time };
  car.frozen = true;
  assert.equal(S.confirmPitService(car, { tyre, ...(fuel === undefined ? {} : { fuel }) }), true);
  return car.pit;
}
for (const track of tracks) {
  test(track.name + ': fixed load for all 20 drivers; no starting strategy or fuel calculations', () => {
    for (const startFuelLaps of [undefined, 3, 8, NaN]) {
      const S = session(track, 'elimination', { startFuelLaps });
      assert.equal(S.fuelEnabled, false);
      for (const c of S.cars) {
        assert.equal(c.fuel, SIM.ELIMINATION_FUEL_MASS);
        assert.equal(c.mass, SIM.SPEC.mass + SIM.ELIMINATION_FUEL_MASS);
        assert.equal(c.startFuelLaps, undefined);
        assert.equal(c.fuelPerLapEst, undefined);
        assert.equal(SIM.chooseStartFuelLaps(S, c, c.tyre.c), null);
      }
    }
  });
  test(track.name + ': tyre and wing servicing ignores fuel input and never shortens jobs', () => {
    for (const comp of ['S', 'M', 'H', 'I', 'W']) {
      const S = session(track), c = S.player;
      c.damage.c[0] = c.damage.c[1] = .6; c.damage.c[2] = .5;
      c.damage.c[3] = .4; c.damage.c[5] = .25; c.damage.computePerf();
      S.lightsOut = true;
      const fuel = c.fuel, mass = c.mass;
      const P = box(S, c, comp, 999);
      assert.equal(P.fuelAdd, 0); assert.equal(P.fuelT, 0);
      assert.ok(P.tyreT >= 2);
      assert.ok(P.fwT >= SIM.REPAIR_TIME.fw[0] && P.fwT <= SIM.REPAIR_TIME.fw[1]);
      assert.ok(P.rwT >= SIM.REPAIR_TIME.rw[0] && P.rwT <= SIM.REPAIR_TIME.rw[1]);
      assert.equal(P.total, Math.max(.8, P.tyreT, P.fwT, P.rwT));
      assert.equal('fuel' in S.pitJobProgress(P), false);
      while (P.phase === 'stopped' && S.time < 100) { S.time += SIM.PHYS_DT; S.pitLogic(c, SIM.PHYS_DT); }
      assert.equal(c.tyre.c, comp); assert.equal(c.damage.fw, 0); assert.equal(c.damage.c[2], 0);
      assert.equal(c.damage.c[3], .4); assert.equal(c.damage.c[5], .25);
      assert.equal(c.fuel, fuel); assert.equal(c.mass, mass); assert.equal(c.pitHistory[0].fuelAdded, 0);
    }
  });
  test(track.name + ': engine and identical physics ignore empty or stale tanks', () => {
    const S = session(track); S.lightsOut = true;
    const a = S.player;
    const b = new SIM.Car({ driver: a.driver }, S);
    for (const c of [a, b]) { c.placeAt(track, 200, 0, 35); c.launch.active = false; S.fitTyres(c, 'M', 105); }
    a.fuel = 0; b.fuel = 999;
    const h = [new SIM.PlayerHandling(), new SIM.PlayerHandling()];
    let powered = false;
    for (let i = 0; i < 480; i++) for (const [j, c] of [a, b].entries()) {
      h[j].step(c, SIM.PHYS_DT, S, { throttle: 1, brake: i > 300 ? .4 : 0, steer: .15, analog: true });
      SIM.stepCarPhysics(c, SIM.PHYS_DT, track, { wet: 0, wearScale: 1, fuelRate: 999, trackTemp: 36, pitLimiter: false });
      if (c === a && c.driveForce > 0) powered = true;
    }
    assert.ok(powered, 'empty tank cannot disable the engine');
    for (const k of ['x', 'z', 'psi', 'speed', 'u', 'v', 'r', 'gLong', 'gLat']) assert.equal(a[k], b[k], k);
    assert.equal(a.fuel, 0); assert.equal(b.fuel, 999);
    a.speed = 0; S.slowUpdate(); assert.notEqual(a.dnfReason, 'Out of fuel');
  });
  test(track.name + ': AI and engineer ignore fuel but react to tyres, weather and damage', () => {
    const S = session(track); S.lightsOut = true; S.time = 30;
    // A thrown call proves that strategies do not even request fuel estimates.
    S.fuelRange = S.fuelLapRate = () => { throw Error('Elimination calculated fuel'); };
    for (const c of S.cars) {
      c.fuel = 0;
      for (const situation of ['normal', 'wear', 'rain', 'damage', 'puncture']) {
        c.tyre.wear.fill(situation === 'wear' ? .9 : .1);
        c.surfaceWet = situation === 'rain' ? .85 : 0;
        c.damage.c[0] = c.damage.c[1] = situation === 'damage' ? .7 : 0;
        c.damage.punctRate[0] = situation === 'puncture' ? .1 : 0;
        c.damage.computePerf();
        const rec = c.engineer.analyse();
        assert.notEqual(rec.reason, 'fuel'); assert.equal(rec.fuel, 0); assert.equal(rec.conserve, false);
        if (situation !== 'normal') assert.ok(rec.pit, situation + ' still triggers service');
        assert.equal(c.engineer.refuelFor('H'), 0);
        assert.equal(S.aiServiceChoice(c).fuel, 0);
        c.engineer.update(true);
        for (const msg of c.engineer.active.values()) assert.doesNotMatch(msg.text, /fuel|consumption|lift and coast/i);
        if (c.ai) { c.ai.strategy(); assert.equal(c.ai.fuelSave, false); c.ai.boxThisLap = false; }
      }
    }
  });
  test(track.name + ': Grand Prix and Career retain fuel use, range, mass, refuelling and radio', () => {
    for (const career of [null, { tier: 0, race: 0, team: 0 }]) {
      const S = session(track, 'grandprix', { career, aiLevel: career ? 1 : undefined });
      const c = S.player; S.lightsOut = true; S.time = 30; c.launch.active = false;
      assert.equal(S.fuelEnabled, true); assert.equal(c.startFuelLaps, 3);
      assert.equal(c.fuel, Math.min(S.fuelCapacity, 3 * S.fuelPerLap + SIM.FUEL_RESERVE));
      assert.equal(c.mass, SIM.SPEC.mass + c.fuel);
      const before = c.fuel; c.input.throttle = 1;
      SIM.stepCarPhysics(c, SIM.PHYS_DT, track, { wet: 0, wearScale: 1, fuelRate: S.fuelRate, trackTemp: 36 });
      assert.ok(c.fuel < before); assert.ok(S.fuelRange(c) > 0);
      const old = c.fuel, P = box(S, c, 'H', 12);
      assert.equal(P.fuelT, SIM.REFUEL.connect + 12 / SIM.REFUEL.rate);
      assert.ok(P.total >= P.fuelT);
      while (P.phase === 'stopped' && S.time < 100) { S.time += SIM.PHYS_DT; S.pitLogic(c, SIM.PHYS_DT); }
      assert.ok(Math.abs(c.fuel - old - 12) < 1e-9);
      c.pit = null; c.frozen = false; c.fuel = .1; c.engineer.update(true);
      assert.ok([...c.engineer.active.values()].some(m => /fuel/i.test(m.text)));
      assert.ok(c.engineer.refuelFor('H') > 0);
      c.fuel = 0; c.speed = 0; S.slowUpdate(); assert.equal(c.dnfReason, 'Out of fuel');
    }
    const before = session(track, 'grandprix');
    session(track); const after = session(track, 'grandprix');
    assert.deepEqual(after.cars.map(c => [c.startFuelLaps, c.fuel, c.mass]), before.cars.map(c => [c.startFuelLaps, c.fuel, c.mass]));
  });
}

test('FIFO queues, physical stopping and safe release still operate in Elimination', () => {
  const S = session(tracks[0]), track = S.track, st = track.stations[0]; S.lightsOut = true;
  // Five arrivals at station 1 and one at station 2: each station's single box is first come, first served.
  const p = S.player, order = [p, ...S.cars.filter(c => c !== p).slice(0, 5)];
  order.forEach((c, i) => {
    c.pit = { phase: 'queue', station: i < 5 ? 0 : 1, entryTime: i, queuePos: 0 };
    S.pitArrivals.push({ car: c, t: i, q: 1 });
  });
  S.allocatePitBoxes();
  assert.equal(S.pitBoxes[0], p); assert.equal(S.pitBoxes[1], order[5]);
  assert.deepEqual(S.pitQueue.map(c => c.id), order.slice(1, 5).map(c => c.id));
  const P = p.pit;
  p.placeAt(track, P.stopS, st.side * st.boxD, 1); p.speed = 1;
  S.pitLogic(p, SIM.PHYS_DT); assert.equal(P.phase, 'in', 'service needs a complete stop');
  p.placeAt(track, P.stopS, st.side * st.boxD, 0); p.speed = 0;
  S.pitLogic(p, SIM.PHYS_DT); assert.equal(P.phase, 'awaiting');
  assert.ok(S.confirmPitService(p, { tyre: 'H' }), 'tyre-only confirmation needs no fuel field');
  while (P.phase === 'stopped' && S.time < 100) { S.time += SIM.PHYS_DT; S.pitLogic(p, SIM.PHYS_DT); }
  const rival = S.cars.find(c => !order.includes(c)); rival.placeAt(track, p.s - 5, st.side * st.fastD, 15); rival.speed = 15;
  S.pitLogic(p, SIM.PHYS_DT); assert.equal(P.phase, 'release', 'release waits for traffic');
  rival.inGarage = true;
  for (const c of S.cars) if (c !== p) c.inGarage = true;
  S.pitLogic(p, SIM.PHYS_DT); assert.equal(P.phase, 'out'); assert.equal(p.frozen, false);
});

test('all five starting tyres remain available without compliance tracking', () => {
  for (const comp of ['S', 'M', 'H', 'I', 'W']) {
    const S = session(tracks[0], 'elimination', { startCompound: comp });
    assert.equal(S.player.tyre.c, comp);
    assert.equal('used' in S.player.tyre, false);
    S.fitTyres(S.player, comp, 80);
    assert.equal(S.player.tyre.c, comp);
  }
});
