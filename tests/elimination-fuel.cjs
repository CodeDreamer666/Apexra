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
  test(track.name + ': all variants service moving cars instantly, preserve fuel and nonrepairable damage', () => {
    for (const eliminationVariant of ['classic','chaos','ruthless']) for(const comp of ['S','H','I','W']) {
      const S=session(track,'elimination',{eliminationVariant}),c=S.player,p=S.track.stations[0];S.lightsOut=true;
      c.damage.c[0]=c.damage.c[1]=.6;c.damage.c[2]=.5;c.damage.c[3]=.4;c.damage.c[5]=.25;c.damage.computePerf();
      const fuel=c.fuel,mass=c.mass;c.boxCompound=comp;c.launch.active=false;
      c.placeAt(S.track,S.track.wrapS(p.entry0+346),S.track.pitTargetD(S.track.wrapS(p.entry0+346),null,p),30);
      c.speed=c.u=30;c.pit={station:0,phase:'out',entryTime:0,previousQ:344};S.pitLogic(c,SIM.PHYS_DT);
      assert.equal(c.pit.serviced,true);assert.equal(c.speed,30);assert.equal(c.frozen,false);assert.equal(c.pit.phase,'out');
      assert.equal(c.pit.total,0);assert.equal(c.tyre.c,comp);assert.equal(c.damage.fw,0);assert.equal(c.damage.c[2],0);
      assert.equal(c.damage.c[3],.4);assert.equal(c.damage.c[5],.25);assert.equal(c.fuel,fuel);assert.equal(c.mass,mass);
      assert.equal(c.pitHistory[0].fuelAdded,0);assert.equal(c.pitHistory[0].service,0);
      S.pitLogic(c,SIM.PHYS_DT);assert.equal(c.pitStops,1,'one service per visit');
      assert.equal(S.confirmPitService(c,{tyre:'H',fuel:999}),false,'no stationary service bypass');
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

test('only four compounds are used in Elimination; Grand Prix keeps Medium',()=>{
 for(const comp of ['S','M','H','I','W']){
  const S=session(tracks[0],'elimination',{startCompound:comp});assert.equal(S.player.tyre.c,comp==='M'?'H':comp);assert.equal('used' in S.player.tyre,false);
  const gp=session(tracks[0],'grandprix',{startCompound:comp});assert.equal(gp.player.tyre.c,comp);
 }
});
test('invalid service gate triggers cannot change tyres or repair damage',()=>{
 for(const kind of ['main-track','stopped','wrong-heading','teleport','missed-gate']){
  const S=session(tracks[0]),c=S.player,p=S.track.stations[0];c.tyre.wear.fill(.5);c.damage.c[0]=.4;c.boxCompound='S';
  c.placeAt(S.track,S.track.wrapS(p.entry0+346),kind==='main-track'?0:S.track.pitTargetD(S.track.wrapS(p.entry0+346),null,p),kind==='stopped'?0:30);
  c.speed=c.u=kind==='stopped'?0:30;
  if(kind==='wrong-heading')c.psi+=Math.PI;
  c.pit={station:0,phase:'out',entryTime:0,previousQ:kind==='teleport'?200:kind==='missed-gate'?346:344};
  S.pitLogic(c,SIM.PHYS_DT);assert.equal(c.pitStops,0,kind);assert.equal(c.tyre.wear[0],.5);assert.equal(c.damage.c[0],.4);
 }
});
