const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Shared race intelligence (RaceIntel) and the redesigned race engineer: observable information only, robust
// pace trends, grounded damage, AI decisions that change with it (attack range, holding a stop for a chance on
// track, the overcut, rain), the player's messages by priority and mode, and the removal of the VSC and blue
// flags with the slipstream untouched.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
function gp(id = 'monza', extra = {}) {
  return new SIM.Session(tracks.get(id), Object.assign({ type: 'race', seed: 9, difficulty: 1, weather: 'dynamic', weatherState: DRY(9), tyreWear: 'normal', damage: 'realistic',
    entries: SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === 5 })) }, extra));
}
// a running race: lights out, a classification, timing gaps
function running(s, secs = 0) { s.lightsOut = true; s.lightsOutTime = 0; s.time = Math.max(s.time, 30); for (let k = 0; k < secs / DT; k++) s.fixedStep(DT); s.slowUpdate(); return s; }

test('opponent tyre wear is an estimate from public facts (compound, distance on the set), never the hidden value', () => {
  const s = running(gp()), I = s.intel, [a, b] = s.cars;
  for (const c of [a, b]) { c.tyre.c = 'S'; c.totalDist = 9000; }
  I.of(a).stintStart = I.of(b).stintStart = 0;
  a.tyre.wear.fill(0.05); b.tyre.wear.fill(0.95); // very different real wear
  I.next = 0; I.update();
  assert.equal(I.of(a).estWear, I.of(b).estWear, 'same public facts, same estimate');
  assert.ok(Math.abs(I.of(a).estWear - SIM.USEFUL_WEAR * 9000 / (SIM.COMPOUNDS.S.life * s.track.length)) < 1e-9);
  // the Pursuit rival's announced part-worn set is public and counted
  const p = new SIM.Session(tracks.get('monza'), { type: 'race', gameMode: 'pursuit', seed: 3, weather: 'dynamic', pursuit: { gap: 3, rivalWear: 0.3, rival: 1 }, entries: SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })) });
  assert.equal(p.intel.of(p.cars[1]).est0, 0.3); assert.equal(p.intel.of(p.cars[0]).est0, 0);
});

test('damage is reported only when it can be seen (wings, a puncture, a car stopping), never internal damage', () => {
  const s = running(gp()), I = s.intel, c = s.cars[3];
  c.damage.c[8] = 0.9; c.damage.c[9] = 0.9; c.damage.computePerf(); // power unit and cooling: invisible from outside
  I.next = 0; I.update(); assert.equal(I.of(c).damage, '');
  c.damage.c[0] = c.damage.c[1] = 0.8; c.damage.computePerf();
  I.next = 0; I.update(); assert.equal(I.of(c).damage, 'front wing'); assert.ok(I.of(c).vuln >= 0.6);
});

test('pace trends need several half-lap samples: one slow sector is not a trend, a sustained slowdown is', () => {
  const s = running(gp()), I = s.intel, c = s.cars[2], n = s.track.timingPoints;
  // synthetic timing: 1.6 s a loop, then the car's laps get 1 s slower (one sample) / stay slower (many)
  const build = (slowFrom, extra) => { c.tp = []; let t = 0; for (let k = 0; k <= 4 * n; k++) { c.tp[k + 200] = t; t += 1.6 + (k >= slowFrom ? extra / n : 0); } };
  const feed = (from, to) => { for (let k = from; k <= to; k++) { c.tpLast = k; c.laps = Math.floor(k / n); s.time += 1; I.next = 0; I.update(); } };
  c.bestLap = 80; I.of(c).pittedAt = -1e9;
  // one anomalous loop: a single sample, not enough samples for a trend
  build(2 * n + 10, 0); c.tp[2 * n + 30 + 200] += 3; for (let k = 2 * n + 31; k <= 4 * n; k++) c.tp[k + 200] += 3;
  I.of(c).trendN = 0; feed(2 * n + 30, 2 * n + 32);
  assert.ok(I.of(c).trendN < SIM.INTEL.minSamples && I.of(c).vuln < 0.3, 'one slow sector does not flag the car: ' + JSON.stringify({ n: I.of(c).trendN, v: I.of(c).vuln }));
  // a sustained 1.5 s a lap slower: flagged as losing pace
  build(3 * n, 1.5); I.of(c).trendN = 0; I.of(c).trend = 0; feed(3 * n + SIM.INTEL.window, 4 * n);
  assert.ok(I.of(c).trendN >= SIM.INTEL.minSamples && I.of(c).trend > SIM.INTEL.slowTrend, 'trend ' + I.of(c).trend.toFixed(2));
  assert.equal(I.of(c).why, 'losing pace');
});

test('the AI acts on the shared picture: a vulnerable car ahead is targeted from further back', () => {
  const s = running(gp('silverstone')), t = s.track, [a, b] = [s.cars[0], s.cars[1]];
  for (const c of s.cars) if (c !== a && c !== b) { c.inGarage = true; c.ghost = true; }
  const place = (c, at, v) => { c.placeAt(t, at, 0, v); c.speed = c.u = v; c.totalDist = t.length + at; c.laps = 1; };
  const M = a.ai.mind, base = 1.3 + 0.3 * M.craft; // the range without a reason to chase (skill 0)
  place(b, 1800, 50); place(a, 1800 - 50 * (base + 0.15), 50);
  const pick = (vuln) => { s.intel.of(b).vuln = vuln; s.intel.next = 1e9; a.ai.tactical(0.1); return a.ai.target === b; };
  assert.equal(pick(0), false, 'a healthy car just out of range is not chased');
  assert.equal(pick(1), true, 'the same car, visibly struggling, is');
  assert.ok(a.ai.posValue == null || a.ai.targetVuln > 0);
});

test('AI strategy: a stop that can wait waits for a chance on track; an adjacent rival\'s stop is overcut on healthy tyres; a firm rain forecast delays a dry stop', () => {
  const s = running(gp('monza', { tyreWear: 'normal' })), t = s.track;
  const car = s.cars[8], ahead = s.cars[7];
  // set up a planned stop now: worn softs, laps left
  const prep = () => {
    for (const c of s.cars) { c.position = s.cars.indexOf(c) + 1; c.laps = 2; c.totalDist = 2 * t.length + 1000 - c.position * 30; c.tyre.c = 'S'; c.tyre.wear.fill(0.3); c.pitHistory = []; }
    s.order = s.cars.slice(); car.tyre.wear.fill(0.5); car.intervalAhead = 0.9; car.fuel = s.fuelCapacity;
  };
  prep();
  const base = car.engineer.analyse();
  assert.ok(base.pit && base.flexible, 'a flexible planned stop: ' + base.reason);
  s.intel.of(ahead).vuln = 0.9;
  const chance = car.engineer.analyse();
  assert.equal(chance.pit, false); assert.ok(chance.attackChance, 'held for the attack');
  s.intel.of(ahead).vuln = 0;
  // overcut: the car just ahead has just stopped (public), our tyres are healthy
  prep(); car.tyre.wear.fill(0.4); car.ai.p = { ...car.ai.p, strat: 0.9 }; car.driver = { ...car.driver, strat: 0.9 };
  assert.equal(car.engineer.analyse().overcut, false, 'no rival stop, no overcut');
  ahead.pitHistory.push({ entry: s.time - 5 }); ahead.position = car.position + 1;
  const ov = car.engineer.analyse();
  assert.ok(ov.overcut && !ov.pit, 'stays out on the clear track: ' + JSON.stringify({ r: ov.reason, o: ov.overcut }));
  // rain: a firm public forecast of rain within minutes, dry now: a flexible dry-tyre stop is delayed
  prep(); ahead.pitHistory = [];
  const w = s.weather; w.raining = false;
  car.engineer.forecast = () => ({ probability: 0.85, window: 'Possible rain in ~1–3 min', intensity: '' });
  car.driver = { ...car.driver, strat: 0.9 };
  const rain = car.engineer.analyse();
  assert.ok(rain.rainWait && !rain.pit, 'stop delayed for the rain: ' + JSON.stringify({ r: rain.reason, w: rain.rainWait }));
});

test('the player\'s engineer: critical first, grounded opportunities, mode-specific advice, every message short', () => {
  const s = running(gp('bahrain'), 2), me = s.player, I = s.intel;
  const msgs = () => { me.engineer.active.clear(); me.engineer.compose(me.surfaceWet ?? s.wet, Math.max(...me.tyre.wear), s.fuelRange(me), s.lapsLeft(me)); return [...me.engineer.active.values()]; };
  s.time = 200;
  // fuel shortage comes from the car's own measured consumption
  me.fuel = me.fuelPerLapEst * 0.6; me.laps = 3; me.totalDist = 3 * s.track.length + 100;
  let m = msgs(); const fuel = m.find(x => x.key === 'fuel');
  assert.ok(fuel && fuel.category === 'critical' && /Fuel/.test(fuel.say), 'fuel shortage announced');
  me.fuel = s.fuelCapacity;
  // a car ahead with a visible wing problem, within reach
  const order = s.order, ahead = order[me.position - 2];
  if (ahead) {
    me.intervalAhead = 1.2; I.of(ahead).damage = 'front wing'; I.next = 1e9;
    m = msgs(); const o = m.find(x => x.key === 'ahead-damage');
    assert.ok(o && o.category === 'opportunity' && /wing damage/.test(o.say), 'damage ahead announced');
  }
  for (const x of msgs()) {
    assert.ok(x.say.split(/\s+/).length <= 12, 'spoken in a few seconds: ' + x.say);
    assert.ok(x.caption.split(/\s+/).length <= 6, 'caption of a few words: ' + x.caption);
    assert.ok(x.expires > s.time);
  }
  // collect hands each situation over once; the same fingerprint is not repeated
  const first = me.engineer.collect().map(x => x.key), again = me.engineer.collect().map(x => x.key);
  for (const k of again) assert.ok(!first.includes(k) || k === 'pursuit-gap', 'not repeated: ' + k);
  // Rival Duel and Pursuit: no pit, fuel or weather advice
  for (const gameMode of ['duel', 'pursuit']) {
    const r = new SIM.Session(tracks.get('monza'), { type: 'race', gameMode, seed: 5, weather: 'dynamic', pursuit: { gap: 3, rivalWear: 0.27, rival: 1 },
      entries: [{ driver: SIM.DRIVERS[0], isPlayer: true }, { driver: SIM.DRIVERS[1] }] });
    const p = r.player; p.ai = new SIM.AIDriver(p, r, {});
    const said = [];
    while (!r.over && r.time < 400) { r.fixedStep(DT); if (r.step % 240 === 0) said.push(...p.engineer.collect()); }
    for (const x of said) assert.ok(!['fuel', 'box', 'traffic', 'nostop', 'rain', 'drying', 'rival-pit', 'water'].includes(x.key), gameMode + ': ' + x.key);
    if (gameMode === 'pursuit') assert.ok(said.some(x => x.key === 'pursuit-gap'), 'Pursuit reports the gap');
  }
});

test('no VSC and no blue flags anywhere; a big crash leaves the race running; the slipstream is unchanged', () => {
  assert.equal(SIM.VSC, undefined);
  assert.deepEqual({ ...SIM.SLIPSTREAM }, { maxCut: 0.15, range: 65, full: 8, overlap: 4.5, speedLo: 25, speedHi: 55, tau: 0.4 });
  const s = gp('monza'); s.totalLaps = 2;
  const events = new Set(); let crashed = false, after = 0, tow = 0;
  while (!s.over && s.time < 520) {
    s.fixedStep(DT);
    for (const e of s.events) events.add(e.type); s.events.length = 0;
    if (!crashed && s.lightsOut && s.time - s.lightsOutTime > 60) { crashed = true; s.startRetirement(s.cars[10], 'Accident damage'); }
    if (crashed) { const lead = s.order && s.order[0]; if (lead && lead.speed > after) after = lead.speed; }
    for (const c of s.cars) tow = Math.max(tow, c.slipstream);
  }
  assert.ok(s.over, 'classified');
  for (const k of ['vsc', 'vsctakeover', 'vschandover']) assert.ok(!events.has(k), k);
  assert.ok(after > 70, 'racing speed after the incident: ' + (after * 3.6).toFixed(0) + ' km/h');
  assert.ok(s.cars.every(c => !('blueFlag' in c) && (!c.ai || !('blueYield' in c.ai))));
  assert.ok(tow > 0.5, 'cars still draft (peak tow ' + tow.toFixed(2) + '); the tow itself is checked by tests/slipstream.cjs');
});
