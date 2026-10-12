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
// Run the actual simulation for a full event. Extend only the test duration to 15 laps on an older
// checkout; production phase rules are deliberately owned by a separate change.
for (const track of tracks) test(track.name + ': 15-lap fuel endurance with dynamic weather and AI stops', () => {
  const sim = loadSim();
  // Start dry with a front due after two minutes, so the weather changes however quickly the event runs.
  const weatherState = Object.assign(new sim.DynamicWeather(73).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0,
    lineWater: 0, cloud: .2, targetCloud: .2, targetRain: 0, patternEnds: 120, regimeEnds: 1e9 });
  const S = session(track, 'elimination', { weather: 'dynamic', weatherState, startCompound: 'auto' }, sim);
  S.totalLaps = Math.max(15, S.totalLaps);
  const p = S.player; p.ai = new sim.AIDriver(p, S);
  for (const c of S.cars) Object.defineProperty(c, 'fuel', { get: () => 20, set: () => assert.fail('Fuel was written after setup') });
  let weatherChanged = false, initial = S.wet, maxWear = 0, messages = 0;
  for (let i = 0; !S.over && S.time < 2400; i++) {
    if (p.pit?.phase === 'awaiting') S.confirmPitService(p, S.aiServiceChoice(p));
    S.fixedStep(sim.PHYS_DT);
    if (i % 240 === 0) {
      weatherChanged ||= Math.abs(S.wet - initial) > .05;
      for (const c of S.cars) {
        maxWear = Math.max(maxWear, ...c.tyre.wear);
        assert.notEqual(c.strategyReason, 'fuel'); assert.ok(!c.ai.fuelSave);
        assert.notEqual(c.dnfReason, 'Out of fuel');
        for (const msg of c.engineer.active.values()) { assert.doesNotMatch(msg.text, /fuel|consumption/i); messages++; }
      }
      S.messages.length = 0; S.events.length = 0;
    }
  }
  assert.ok(S.over, 'event classified'); assert.ok(S.cars.some(c => c.laps >= 15), 'completed 15 laps');
  assert.ok(weatherChanged); assert.ok(maxWear > .3); assert.ok(S.stats.pitstops > 0); assert.ok(messages > 0);
  for (const c of S.cars) for (const stop of c.pitHistory) assert.equal(stop.fuelAdded, 0);
  console.log(track.name + ': ' + S.time.toFixed(1) + ' simulated seconds, ' + S.stats.pitstops + ' stops, fuel untouched');
});
