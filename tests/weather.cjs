const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Repeated simulated events through the game's own DynamicWeather and Session.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const RACE_SECONDS = 840, QUALI_SECONDS = 450, GRID_GAP = 120;
const raining = w => w.rain > 0.025;
const WET = new Set(['light', 'moderate', 'heavy', 'storm']), DRY = new Set(['sunny', 'cloudy']);

test('fresh events start dry or wet with equal probability, with matching track water', () => {
  const N = 4000, water = { light: [], moderate: [], heavy: [], storm: [] }, regimes = {};
  let dry = 0;
  for (let seed = 1; seed <= N; seed++) {
    const w = new SIM.DynamicWeather(seed * 7919);
    regimes[w.regime] = (regimes[w.regime] || 0) + 1;
    if (w.pattern === 'dry') {
      dry++;
      assert.ok(DRY.has(w.regime));
      assert.equal(w.rain, 0); assert.equal(w.water, 0);
    } else {
      assert.ok(WET.has(w.regime));
      assert.ok(raining(w), 'a wet start is already raining');
      assert.ok(w.water >= 0.2 && w.lineWater > 0.15, 'a wet start has a wet track, not dry asphalt');
      water[w.regime].push(w.water);
    }
  }
  const share = dry / N;
  assert.ok(share > 0.47 && share < 0.53, 'dry share ' + share);
  for (const k of ['sunny', 'cloudy', 'light', 'moderate', 'heavy', 'storm']) assert.ok(regimes[k] > N * 0.03, k + ' starts occur');
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(water.light) < mean(water.moderate) && mean(water.moderate) < mean(water.heavy), 'heavier rain, wetter track');
  assert.ok(mean(water.light) > 0.18, 'light rain starts on an intermediate-wet surface');
  assert.ok(mean(water.heavy) > 0.7, 'heavy rain starts with standing water');
});

test('repeated races change in both directions, plausibly and without bias toward sunshine', () => {
  const N = 2000;
  let toWet = 0, toDry = 0, changed = 0, startWet = 0, endWet = 0, wetSeconds = 0, lapChanges = 0, laps = 0;
  let maxRain = 0, maxCloud = 0, maxWater = 0;
  for (let i = 0; i < N; i++) {
    const w = new SIM.DynamicWeather(1000003 + i * 104729);
    let state = raining(w), changes = 0, lapState = state;
    if (state) startWet++;
    for (let t = 1; t <= RACE_SECONDS; t++) {
      const r = w.rain, c = w.cloud, h = w.water;
      for (let k = 0; k < 4; k++) w.update(0.25);
      maxRain = Math.max(maxRain, Math.abs(w.rain - r)); maxCloud = Math.max(maxCloud, Math.abs(w.cloud - c)); maxWater = Math.max(maxWater, Math.abs(w.water - h));
      const now = raining(w);
      if (now !== state) { changes++; if (now) toWet++; else toDry++; state = now; }
      if (now) wetSeconds++;
      if (t % 90 === 0) { laps++; if (now !== lapState) lapChanges++; lapState = now; }
    }
    if (changes) changed++;
    if (state) endWet++;
  }
  assert.ok(Math.abs(startWet / N - 0.5) < 0.04, 'start wet share ' + startWet / N);
  // Balanced transitions: fronts arrive about as often as rain clears.
  assert.ok(toWet > 200 && toDry > 200, `dry→wet ${toWet}, wet→dry ${toDry}`);
  assert.ok(toWet / toDry > 0.85 && toWet / toDry < 1.18, `dry→wet ${toWet}, wet→dry ${toDry}`);
  // Mid-race weather stays balanced rather than drifting to sunshine.
  assert.ok(Math.abs(endWet / N - 0.5) < 0.05, 'end wet share ' + endWet / N);
  assert.ok(Math.abs(wetSeconds / N / RACE_SECONDS - 0.5) < 0.05, 'rain share of race time');
  // Changes happen in some races, not all, and not every lap.
  assert.ok(changed / N > 0.25 && changed / N < 0.65, 'races with a change ' + changed / N);
  assert.ok(lapChanges / laps < 0.12, 'lap-to-lap change rate ' + lapChanges / laps);
  // Progressive atmosphere and surface: no abrupt switches within a second.
  assert.ok(maxRain < 0.03, 'rain step ' + maxRain);
  assert.ok(maxCloud < 0.06, 'cloud step ' + maxCloud);
  assert.ok(maxWater < 0.012, 'water step ' + maxWater);
});

test('rain intensity varies, storms occur, and a drying track dries progressively', () => {
  const seen = new Set(); let lightning = 0, dryingRuns = 0;
  for (let i = 0; i < 400; i++) {
    const w = new SIM.DynamicWeather(77 + i * 31);
    let wasRaining = raining(w), stopAt = null, lastWater = w.water;
    for (let t = 0; t < 1500; t++) {
      for (let k = 0; k < 4; k++) w.update(0.25);
      seen.add(w.label); if (w.lightning > 0.9) lightning++;
      if (wasRaining && w.rain === 0) stopAt = { t, water: w.water };
      if (stopAt && w.rain === 0 && t > stopAt.t) assert.ok(w.water <= lastWater + 1e-9, 'water only falls once rain stops');
      if (w.rain > 0) stopAt = null;
      if (stopAt && stopAt.water > 0.3 && t - stopAt.t === 60) { dryingRuns++; assert.ok(w.water > 0.12, 'a soaked track does not dry within a minute'); }
      wasRaining = w.rain > 0; lastWater = w.water;
    }
  }
  for (const label of ['Sunshine', 'Cloudy', 'Light rain', 'Moderate rain', 'Heavy rain', 'Thunderstorm', 'Drying']) assert.ok(seen.has(label), label);
  assert.ok(lightning > 0, 'thunderstorms bring lightning');
  assert.ok(dryingRuns > 5);
});

test('qualifying weather carries into the race without resetting to sunshine', () => {
  // A plain snapshot restores the identical conditions.
  for (let seed = 1; seed <= 200; seed++) {
    const q = new SIM.DynamicWeather(seed);
    for (let t = 0; t < 200; t++) q.update(1);
    const r = new SIM.DynamicWeather(seed + 999, q.snapshot());
    for (const k of ['pattern', 'regime', 'cloud', 'rain', 'water', 'lineWater', 'ambient', 'trackTemp']) assert.equal(r[k], q[k], k);
  }
  // Across the grid-formation gap, wet sessions stay wet and dry ones mostly dry.
  const N = 2000; let wetQ = 0, wetKept = 0, dryQ = 0, dryKept = 0, raceWet = 0;
  for (let i = 0; i < N; i++) {
    const q = new SIM.DynamicWeather(5000 + i * 7);
    for (let t = 0; t < QUALI_SECONDS; t++) q.update(1);
    const r = new SIM.DynamicWeather(900000 + i, q.snapshot(), GRID_GAP);
    if (raining(r)) raceWet++;
    if (raining(q) && q.rain > 0.15) { wetQ++; if (r.water > 0.15) wetKept++; }
    if (!raining(q) && q.water === 0) { dryQ++; if (r.water < 0.15) dryKept++; }
  }
  assert.ok(wetKept / wetQ > 0.9, 'wet qualifying leads to a wet grid');
  assert.ok(dryKept / dryQ > 0.8, 'dry qualifying usually leads to a dry grid');
  assert.ok(Math.abs(raceWet / N - 0.5) < 0.05, 'race starts after qualifying are still balanced ' + raceWet / N);
});

test('fresh seeds give different conditions; the game rolls new seeds per event', () => {
  const starts = new Set(), paths = new Set();
  for (let i = 0; i < 40; i++) {
    const w = new SIM.DynamicWeather(Math.floor(Math.random() * 1e9));
    starts.add(w.pattern);
    for (let t = 0; t < 600; t++) w.update(1);
    paths.add(w.regime + w.cloud.toFixed(4) + w.rain.toFixed(4) + w.water.toFixed(4));
  }
  assert.equal(starts.size, 2); assert.ok(paths.size > 30);
  assert.match(html, /seed:\(Math\.random\(\)\*1e9\)\|0/, 'every session config gets a fresh seed');
  assert.match(html, /weatherSeed: \(Math\.random\(\)\*1e9\)\|0/, 'the background race does not repeat one weather pattern');
});

test('the forecast shows rain chances and uncertain windows only', () => {
  let hitP = 0, hitN = 0, missP = 0, missN = 0;
  for (let i = 0; i < 300; i++) {
    const w = new SIM.DynamicWeather(3 + i * 13), samples = [];
    for (let t = 0; t < 900; t++) {
      w.update(1);
      if (t % 15 === 0) { const f = w.forecast(); samples.push([t, f.probability]);
        assert.ok(f.probability >= 0.03 && f.probability <= 0.97);
        assert.match(f.window, /~?\d+–\d+ min/);
        assert.doesNotMatch(f.window + ' ' + f.intensity, /tyre|tire|pit|box|slick|inter|compound|stop/i); }
      if (t % 15 === 0 && t >= 120) {
        const [, p] = samples[samples.length - 9];
        if (raining(w)) { hitP += p; hitN++; } else { missP += p; missN++; }
      }
    }
  }
  assert.ok(hitP / hitN > missP / missN + 0.25, 'the rain chance has real skill');
});

function weatherState(over) {
  return Object.assign(new SIM.DynamicWeather(1).snapshot(), { patternEnds: 1e9, regimeEnds: 1e9, forecastNext: 1e9 }, over);
}
function weatherRace(over, cars = 6) {
  const track = new SIM.Track(SIM.TRACK_DEF);
  return new SIM.Session(track, { type: 'race', laps: 8, entries: SIM.DRIVERS.slice(0, cars).map(driver => ({ driver })), seed: 3,
    spectate: true, weather: 'dynamic', weatherState: weatherState(over) });
}
const rainTyre = c => c === 'I' || c === 'W';

test('a wet start puts the field on rain tyres on a wet track; a dry start on slicks', () => {
  const wet = weatherRace({ pattern: 'wet', regime: 'moderate', targetCloud: 0.93, targetRain: 0.38, cloud: 0.93, rain: 0.38, water: 0.62, lineWater: 0.58 });
  assert.ok(wet.wet > 0.5);
  assert.ok(wet.cars.every(c => rainTyre(c.tyre.c)));
  for (let i = 0; i < 240; i++) wet.fixedStep(SIM.PHYS_DT);
  assert.ok(wet.cars.every(c => c.surfaceWet > 0.4));
  const dry = weatherRace({ pattern: 'dry', regime: 'sunny', targetCloud: 0.15, targetRain: 0, cloud: 0.15, rain: 0, water: 0, lineWater: 0 });
  assert.equal(dry.wet, 0);
  assert.ok(dry.cars.every(c => !rainTyre(c.tyre.c)));
});

test('weather changes grip, tyre temperature and the AI pit strategy', () => {
  // Grip: slicks lose grip on water, rain tyres gain it.
  assert.ok(SIM.tyreWeatherGrip('S', 0.7) < SIM.tyreWeatherGrip('S', 0) * 0.7);
  assert.ok(SIM.tyreWeatherGrip('W', 0.8) > SIM.tyreWeatherGrip('S', 0.8) * 1.5);
  // A front arrives on a dry track: AI drivers switch to rain tyres as it soaks.
  const front = weatherRace({ pattern: 'wet', regime: 'heavy', storm: false, targetCloud: 0.97, targetRain: 0.65, cloud: 0.6, rain: 0, water: 0, lineWater: 0, cloudTau: 30, rainRate: 0.01, rainHold: 0 });
  assert.ok(front.cars.every(c => !rainTyre(c.tyre.c)));
  const temps = () => front.cars.reduce((a, c) => a + c.tyre.temp.reduce((x, y) => x + y, 0) / 4, 0) / front.cars.length;
  while (front.time < 40) front.fixedStep(SIM.PHYS_DT);
  const dryTemp = temps(), dryTrack = front.trackTemp;
  while (front.time < 100) front.fixedStep(SIM.PHYS_DT);
  assert.ok(temps() < dryTemp - 8, `wet slicks run cooler: ${dryTemp.toFixed(1)} -> ${temps().toFixed(1)}`);
  while (front.time < 260) front.fixedStep(SIM.PHYS_DT);
  assert.ok(front.trackTemp < dryTrack - 5, 'rain cools the track');
  assert.ok(front.cars.filter(c => rainTyre(c.tyre.c)).length >= 5, 'AI pits for rain tyres: ' + front.cars.map(c => c.tyre.c).join(''));
  assert.ok(front.cars.some(c => c.pitHistory.length > 0));
  // The track dries: AI drivers return to slicks.
  const drying = weatherRace({ pattern: 'dry', regime: 'sunny', storm: false, targetCloud: 0.15, targetRain: 0, cloud: 0.8, rain: 0.05, water: 0.3, lineWater: 0.25, cloudTau: 50, baseAmbient: 26 });
  assert.ok(drying.cars.every(c => rainTyre(c.tyre.c)));
  while (drying.time < 300) drying.fixedStep(SIM.PHYS_DT);
  assert.ok(drying.cars.filter(c => !rainTyre(c.tyre.c)).length >= 5, 'AI returns to slicks: ' + drying.cars.map(c => c.tyre.c).join(''));
});
