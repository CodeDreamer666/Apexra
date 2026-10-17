// Strategy balance: one car alone over the 6-lap Grand Prix distance, starting with 3 (light), 4.5 (medium)
// or 6 (heavy) laps of fuel, everything else identical; the AI's own strategy decides when to stop, which
// tyres to fit and how much fuel to add. Reports total race time, stops and fuel added.
//
//   node tools/fuel-strategy-balance.cjs [--circuits summit,...] [--seeds 2] [--scenario normal|nostop|high|rain]
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
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const SCEN = {
  normal: { label: 'normal tyre wear, dry', cfg: {} },
  nostop: { label: 'tyre wear off, dry, soft tyres', cfg: { tyreWear: 'off' }, comp: 'S' },
  high: { label: 'high tyre wear, dry', cfg: { tyreWear: 'high' } },
  rain: { label: 'rain arriving mid-race (forced tyre stop)', cfg: {}, rainAt: 260 },
};
const sc = SCEN[opt('scenario', 'normal')];
const circuits = opt('circuits', 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
const seeds = +opt('seeds', 2);

function race(id, startLaps, seed) {
  const t = new SIM.Track(SIM.CIRCUITS.find(d => d.id === id));
  const S = new SIM.Session(t, { type: 'race', laps: SIM.GAME_MODES.grandprix.laps, entries: [{ driver: SIM.DRIVERS[0] }], seed, spectate: true, weather: 'dynamic', mistakes: 0, weatherState: DRY(seed), ...sc.cfg });
  const car = S.cars[0];
  S.fitTyres(car, sc.comp || 'H', 78); car.startFuelLaps = startLaps; car.fuel = S.fuelForLaps(startLaps); car.lapFuel = car.fuel;
  let rained = false;
  while (!S.over && S.time < 1400) {
    S.fixedStep(SIM.PHYS_DT);
    if (sc.rainAt && !rained && S.time > sc.rainAt) {
      rained = true; const w = S.weather;
      Object.assign(w, { pattern: 'wet', regime: 'rain', targetRain: 0.9, rain: 0.9, targetCloud: 1, cloud: 1, patternEnds: 1e9, regimeEnds: 1e9 });
    }
  }
  return { time: car.finished ? car.finishTime : NaN, dnf: car.dnf ? car.dnfReason : '', stops: car.pitHistory.map(h => 'L' + h.lap + ' ' + h.from + '>' + h.to + (h.fuelAdded > 0 ? ' +' + h.fuelAdded.toFixed(1) + 'kg' : '') + ' (' + h.service.toFixed(1) + ' s)'), laps: car.lapTimes.map(l => +l.t.toFixed(2)) };
}
console.log('Scenario: ' + sc.label);
for (const id of circuits) {
  const rows = {};
  for (const L of [3, 4.5, 6]) {
    rows[L] = [];
    for (let k = 0; k < seeds; k++) rows[L].push(race(id, L, 31 + 17 * k));
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const best = Math.min(...[3, 4.5, 6].map(L => mean(rows[L].map(r => r.time))));
  console.log('\n' + id);
  for (const L of [3, 4.5, 6]) {
    const m = mean(rows[L].map(r => r.time));
    console.log('  ' + (L === 3 ? 'light ' : L === 4.5 ? 'medium' : 'heavy ') + ' ' + L + ' laps: ' + m.toFixed(2) + ' s (+' + (m - best).toFixed(2) + ')  ' + rows[L].map(r => (r.dnf ? 'DNF ' + r.dnf : r.time.toFixed(1)) + ' [' + r.stops.join('; ') + '] laps ' + r.laps.join(' ')).join(' | '));
  }
}
