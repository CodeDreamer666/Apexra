const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const SIM = m.exports;
const tracks = SIM.CIRCUITS.map(d => new SIM.Track(d));
const modes = ['grandprix', 'career'];
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
  const p = S.track.pit;
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
    incomplete.finished = false; incomplete.laps--; incomplete.totalDist -= S.track.length;
    retired.dnf = true; retired.finished = false; retired.laps = 2; retired.totalDist = 2 * S.track.length;
    S.finishRace();
    assert.equal(S.results[0].car, a); assert.equal(S.results[1].car, b);
    assert.equal(S.results[0].time, a.finishTime);
    assert.equal(S.results.find(r => r.car === incomplete).time, null);
    assert.equal(S.results.find(r => r.car === retired).points, 0);
    assert.ok(S.results.every(r => !('pen' in r)));
    assert.equal(S.winner, a);
    assert.equal(S.results[0].points, 25); assert.equal(S.results[1].points, 18);
    if (mode === 'career') {
      // Career scores the classified finish (no penalties exist): P1 = 50 position points
      const st = SIM.PROGRESS.create(), me = S.results[0];
      const out = SIM.PROGRESS.recordCareer(st, { rank: 0, circuit: S.track.def.id, id: label, pos: me.pos, dnf: false, pacePts: 30 });
      assert.ok(out.ok); assert.equal(out.entry.posPts, 50); assert.equal(out.entry.total, 80);
    }
  });
  test(label + ': healthy tyres need no compliance stop; wear, weather and damage still prompt service', () => {
    const S = session(track, mode), c = S.player;
    S.lightsOut = true; S.time = 40;
    for (const car of S.cars) {
      car.laps = S.totalLaps - 1; car.totalDist = car.laps * S.track.length;
      car.tyre.wear.fill(.05); car.fuel = S.fuelCapacity;
      const advice = car.strategy.analyse();
      assert.equal(advice.pit, false, car.driver.short + ': no forced final-lap change');
      car.strategy.update(true);
      if (car.ai) { car.ai.strategy(); assert.equal(car.ai.boxThisLap, false); }
    }
    c.laps = 1; c.totalDist = S.track.length;
    c.tyre.wear.fill(.95);
    assert.equal(c.strategy.analyse().pit, true, 'worn tyres still justify stopping');
    c.tyre.wear.fill(.05); c.surfaceWet = .85;
    const rain = c.strategy.analyse();
    assert.ok(rain.pit); assert.equal(rain.compound, 'W');
    c.surfaceWet = 0; c.damage.c[0] = c.damage.c[1] = .7; c.damage.computePerf();
    assert.equal(c.strategy.analyse().pit, true, 'repairable damage still justifies stopping');
    c.damage.c.fill(0); c.damage.punctRate[0] = .1; c.damage.computePerf();
    assert.equal(c.strategy.analyse().reason, 'punctured tyre');
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
      assert.ok(P.tyreT>=2);assert.ok(P.fwT>=SIM.REPAIR_TIME.fw[0]);assert.equal(P.total,Math.max(.8,P.tyreT,P.fwT,P.rwT));
      while (P.phase === 'stopped') { S.time += SIM.PHYS_DT; S.pitLogic(c, SIM.PHYS_DT); }
      assert.ok(S.time - before >= P.total);
      assert.equal(c.tyre.c, comp); assert.equal(c.damage.fw, 0);
      assert.ok(c.tyre.wear.every(w => w === 0));
      assert.equal('used' in c.tyre, false);
    }
  });
  test(label + ': pit speeding and contact never accrue time while physical safeguards remain', () => {
    const S = session(track, mode), [c, o] = S.cars, t = S.track;
    S.lightsOut = true; S.time = 40;
    for (const car of S.cars) { prohibitPenaltyReads(car); car.inGarage = car !== c && car !== o; }
    // Keep the car in the limited portion of a physical pit route while checking the former speeding trigger.
    const p = t.pit;
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
    // a car a lap down is recognised as lapped (no blue flags: it simply races on)
    c.placeAt(t, 150, 0, 45); o.placeAt(t, 135, 0, 50);
    c.speed = 45; o.speed = 50; c.totalDist = t.length + 150; o.totalDist = 2 * t.length + 135;
    c.laps = 1; o.laps = 2; c.retiring = o.retiring = null; c.dnf = o.dnf = false;
    assert.equal(S.isLapping(c, o, -15), true); assert.equal('blueFlag' in c, false);
    o.speed = 0; o.input.brake = 1;
    S.slowUpdate(); assert.equal(S.yellow, undefined, 'stopped cars do not create yellow flags');
    assert.ok(!S.messages.some(m => /yellow flag/i.test(m.text)));
    assert.ok(S.messages.every(msg => !/penalty|second dry|compound rule/i.test(msg.text)));
    // The same legal-progress gate still withholds skipped distance, regardless of sporting rules.
    const fake = { offN: 4, pit: null, s: 150, d: -t.halfW - 20, idx: 30 };
    assert.ok(S.legalProgress(fake, 40, 40, 0) < 40);
  });
}
test('legacy saves and result payloads: obsolete fields are discarded, legitimate progress is kept', () => {
  const P = SIM.PROGRESS, st = P.create();
  P.recordCareer(st, { rank: 0, circuit: 'monza', id: 'legacy', pos: 1, dnf: false, pacePts: 40 });
  const raw = JSON.parse(JSON.stringify(st));
  Object.assign(raw.career.results.rookie.monza, { penalty: 999, pen: 999, compoundPenalty: true });
  const loaded = P.load(raw);
  assert.deepEqual(Object.keys(loaded.career.results.rookie.monza).sort(), ['at', 'dnf', 'id', 'pacePts', 'pos', 'posPts', 'total', 'water']);
  assert.equal(P.status(loaded, 'career', 0).score, 90);
  // the old five-tier Career keeps the access it earned (here: Rookie and Pro completed -> Master open)
  const old = { v: 2, unlocked: 2, completed: [0, 1], best: [1, 1, 0, 0, 0], champion: false, active: null };
  assert.equal(P.load(null, old, null).career.unlocked, 2);
});
