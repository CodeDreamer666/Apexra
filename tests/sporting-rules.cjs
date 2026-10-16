const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const SIM = m.exports;
const tracks = SIM.CIRCUITS.map(d => new SIM.Track(d));
const modes = ['grandprix', 'career', 'elimination'];
function session(track, mode, extra = {}) {
  return new SIM.Session(track, { type: 'race', gameMode: mode === 'career' ? 'grandprix' : mode,
    career: mode === 'career' ? { tier: 0, race: 0, team: 0 } : null,
    aiLevel: mode === 'career' ? 1 : undefined,
    seed: 71, weather: 'dry', damage: 'standard', startCompound: 'H', startFuelLaps: 8,
    entries: SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === 0 })),
    // Simulate a legacy configuration; this must not re-enable the former rule.
    mandatory: true, ...extra });
}
function prohibitPenaltyReads(car) {
  for (const key of ['penalty', 'penaltyLog', 'compoundPenalty', 'pendingColPen']) {
    Object.defineProperty(car, key, { configurable: true,
      get() { assert.fail('Obsolete sporting data read: ' + key); },
      set() { assert.fail('Sporting state accumulated: ' + key); } });
  }
}
function box(S, c, tyre) {
  const p = S.track.stations?.[0] || S.track.pit;
  if(S.eliminationMode){
    c.placeAt(S.track,S.track.wrapS(p.entry0+346),S.track.pitTargetD(S.track.wrapS(p.entry0+346),null,p),30);c.speed=c.u=30;c.boxCompound=tyre;
    c.pit={phase:'out',station:p.id,previousQ:344,entryTime:S.time};S.pitLogic(c,SIM.PHYS_DT);assert.equal(c.pit.serviced,true);return c.pit;
  }
  c.placeAt(S.track, p.boxes[0], p.side * p.boxD, 0);
  c.pit = { phase: 'awaiting', station: p.id, box: 0, boxS: p.boxes[0], stopS: p.boxes[0], entryTime: S.time };
  assert.ok(S.confirmPitService(c, { tyre, fuel: 0 }));
  return c.pit;
}
for (const track of tracks) for (const mode of modes) {
  const label = track.def.id + ' / ' + mode;
  test(label + ': classification uses actual performance despite obsolete penalty values', () => {
    const S = session(track, mode);
    const [a, b, incomplete, retired] = S.cars;
    for (const [i, c] of S.cars.entries()) {
      prohibitPenaltyReads(c);
      c.finished = true; c.laps = S.totalLaps; c.finishOrder = i + 1;
      c.finishTime = 1000 + i; c.totalDist = S.totalLaps * S.track.length;

    }
    // Elimination uses crossing order, even when obsolete average fields favour another car.
    if(S.eliminationMode)b.finalLaps=[1,1,1];
    incomplete.finished = false; incomplete.laps--; incomplete.totalDist -= S.track.length;
    if (S.eliminationMode) incomplete.finalLaps = [70, 70];
    retired.dnf = true; retired.finished = false; retired.laps = 2; retired.totalDist = 2 * S.track.length;
    S.finishRace();
    assert.equal(S.results[0].car, a); assert.equal(S.results[1].car, b);
    assert.equal(S.results[0].time, a.finishTime);
    assert.equal(S.results.find(r => r.car === incomplete).time, null);
    assert.equal(S.results.find(r => r.car === retired).points, 0);
    assert.ok(S.results.every(r => !('pen' in r)));
    if (S.eliminationMode) {
      assert.equal(S.winner,a);assert.equal(S.results[0].car.finishOrder,1);
    } else {
      assert.equal(S.results[0].points, 25); assert.equal(S.results[1].points, 18);
    }
    if (mode === 'career') {
      const st = SIM.CAREER.create(); SIM.CAREER.start(st, 0, 0);
      assert.ok(SIM.CAREER.record(st, { tier: 0, team: 0, race: 0, id: label }, S.results).ok);
      assert.equal(SIM.CAREER.status(st).points, 25);
      assert.equal(SIM.CAREER.status(st).table.find(r => r.d === 1).points, 20);
    }
  });
  test(label + ': healthy tyres need no compliance stop; wear, weather and damage still prompt service', () => {
    const S = session(track, mode), c = S.player;
    S.lightsOut = true; S.time = 40;
    for (const car of S.cars) {
      car.laps = S.totalLaps - 1; car.totalDist = car.laps * S.track.length;
      car.tyre.wear.fill(.05); car.fuel = S.fuelCapacity;
      const advice = car.engineer.analyse();
      assert.equal(advice.pit, false, car.driver.short + ': no forced final-lap change');
      car.engineer.update(true);
      assert.ok([...car.engineer.active.values()].every(msg => !/mandatory|second dry|compound rule|penalty/i.test(msg.text)));
      if (car.ai) { car.ai.strategy(); assert.equal(car.ai.boxThisLap, false); }
    }
    c.laps = 1; c.totalDist = S.track.length;
    c.tyre.wear.fill(.95);
    assert.equal(c.engineer.analyse().pit, true, 'worn tyres still justify stopping');
    c.tyre.wear.fill(.05); c.surfaceWet = .85;
    const rain = c.engineer.analyse();
    assert.ok(rain.pit); assert.equal(rain.compound, 'W');
    c.surfaceWet = 0; c.damage.c[0] = c.damage.c[1] = .7; c.damage.computePerf();
    assert.equal(c.engineer.analyse().pit, true, 'repairable damage still justifies stopping');
    c.damage.c.fill(0); c.damage.punctRate[0] = .1; c.damage.computePerf();
    assert.equal(c.engineer.analyse().reason, 'punctured tyre');
    // With no wear cost, no-stop is a valid and competitive strategic plan.
    const plan = SIM.planStrategy({ ...S, tyreWearOn: false }, c, 1, 'S', 0);
    assert.deepEqual(plan.stops, []);
  });
  test(label + ': repeated same-compound stops retain tyre and repair durations without compulsory changes', () => {
    const S = session(track, mode), c = S.player;
    prohibitPenaltyReads(c); S.lightsOut = true;
    for (const comp of ['S','S','H','H','I','W']) {
      c.tyre.wear.fill(.7); c.damage.c[0] = c.damage.c[1] = .6; c.damage.computePerf();
      const P = box(S, c, comp), before = S.time;
      if(S.eliminationMode){assert.equal(P.total,0);assert.equal(c.speed,30);}else{assert.ok(P.tyreT>=2);assert.ok(P.fwT>=SIM.REPAIR_TIME.fw[0]);assert.equal(P.total,Math.max(.8,P.tyreT,P.fwT,P.rwT));}
      while (P.phase === 'stopped') { S.time += SIM.PHYS_DT; S.pitLogic(c, SIM.PHYS_DT); }
      assert.ok(S.time - before >= P.total);
      assert.equal(c.tyre.c, comp); assert.equal(c.damage.fw, 0);
      assert.ok(c.tyre.wear.every(w => w === 0));
      assert.equal('used' in c.tyre, false);
    }
  });
  test(label + ': pit speeding, contact and flags never accrue time while physical safeguards remain', () => {
    const S = session(track, mode), [c, o] = S.cars, t = S.track;
    S.lightsOut = true; S.time = 40;
    for (const car of S.cars) { prohibitPenaltyReads(car); car.inGarage = car !== c && car !== o; }
    // Keep the car in the limited portion of a physical pit route while checking the former speeding trigger.
    const p = t.stations?.[0] || t.pit;
    c.placeAt(t, t.wrapS(p.entry0 + p.E + 10), p.side * p.fastD, p.limit + 15);
    c.speed = p.limit + 15; c.pit = { phase: 'out', station: p.id, box: 0 };
    for (let k = 0; k < 150; k++) S.pitLogic(c, SIM.PHYS_DT);
    assert.equal(c.pit.speedPenalty, undefined);
    const handling = new SIM.PlayerHandling();
    for (let k = 0; k < 480; k++) {
      handling.step(c, SIM.PHYS_DT, S, { throttle: 1, brake: 0, steer: 0 });
      SIM.stepCarPhysics(c, SIM.PHYS_DT, t, { wet: 0, wearScale: 1, fuelRate: S.fuelRate, trackTemp: 36, pitLimiter: true });
    }
    assert.ok(c.speed < p.limit + .5, 'physical limiter still constrains speed');
    c.pit = null; c.placeAt(t, 600, 0, 65); o.placeAt(t, 607, 0, 40);
    c.speed = 65; o.speed = 40;
    S.onCollision(c, o, 10000, c.x + Math.cos(c.psi) * 2, c.z + Math.sin(c.psi) * 2,
      -Math.cos(c.psi), -Math.sin(c.psi), -20, 2, 200, 400);
    S.time += .2; S.resolveContacts();
    assert.ok(S.stats.collisions > 0); assert.ok(c.damage.severity() > 0 || o.damage.severity() > 0);
    // Actual blue-flag detection remains active for a car one lap behind.
    c.placeAt(t, 150, 0, 45); o.placeAt(t, 135, 0, 50);
    c.speed = 45; o.speed = 50; c.totalDist = t.length + 150; o.totalDist = 2 * t.length + 135;
    c.laps = 1; o.laps = 2; c.retiring = o.retiring = null; c.dnf = o.dnf = false;
    S.vsc.phase = 'idle';
    S.updateBlueFlags(.1); assert.equal(c.blueFlag.target, o);
    o.speed = 0; o.input.brake = 1;
    S.slowUpdate(); assert.ok(S.yellow.some(x => x > 0), 'stopped car produces yellow flags');
    assert.ok(S.messages.every(msg => !/penalty|second dry|compound rule/i.test(msg.text)));
    // The same legal-progress gate still withholds skipped distance, regardless of sporting rules.
    const fake = { offN: 4, pit: null, s: 150, d: -t.halfW - 20, idx: 30 };
    assert.ok(S.legalProgress(fake, 40, 40, 0) < 40);
  });
}
test('legacy career saves and result payloads preserve legitimate progress and discard obsolete fields', () => {
  const C = SIM.CAREER, st = C.create();
  st.unlocked = 7; st.completed = [0, 1, 7]; st.champion = true; st.best[7] = 1;
  C.start(st, 7, 0);
  const results = SIM.DRIVERS.map((_, d) => ({ d, pos: d + 1, dnf: false, penalty: 999, pen: 999, points: -100 }));
  C.record(st, { tier: 7, team: 0, race: 0, id: 'legacy' }, results);
  const raw = JSON.parse(JSON.stringify(st));
  for (const r of raw.active.races[0].results) Object.assign(r, { penalty: 999, pen: 999, compoundPenalty: true });
  const loaded = C.load(raw);
  assert.equal(loaded.unlocked, 7); assert.deepEqual(loaded.completed, [0, 1, 7]);
  assert.equal(loaded.champion, true); assert.equal(loaded.best[7], 1);
  assert.equal(C.status(loaded).points, 25);
  assert.deepEqual(loaded.active.races[0].results, st.active.races[0].results);
  assert.deepEqual(Object.keys(st.active.races[0].results[0]).sort(), ['d', 'dnf', 'pos']);
});
