// Strategy comparison (development tool, not part of the test suite): one AI car alone on the circuit runs a
// forced six-lap Grand Prix strategy, always the same driver, team and seed, in dry weather. Only the pit calls
// are forced; the driving, tyre management (the engineer's preserve/push advice), wear, fuel and pit lane are
// the game's own. Every car carries fuel for the whole race unless a light-fuel variant is asked for, so the
// comparison isolates tyres and stops; the light-fuel run shows the real refuelling cost.
//   node tools/strategy-compare.cjs [circuits] [styles] [seeds]
//   e.g. node tools/strategy-compare.cjs summit,rivermere,redridge normal,aggressive 11,12
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const STRATEGIES = {
  'H6 (no stop)': { start: 'H', stops: [] },
  'S2-H4': { start: 'S', stops: [[2, 'H']] },
  'H4-S2': { start: 'H', stops: [[4, 'S']] },
  'S3-S3': { start: 'S', stops: [[3, 'S']] },
  'S2-S2-S2': { start: 'S', stops: [[2, 'S'], [4, 'S']] },
  'S2-H4 light fuel': { start: 'S', stops: [[2, 'H']], fuel: 2.5 },
};
function run(id, name, { style = 'normal', seed = 11, driver = 0 } = {}) {
  const plan = STRATEGIES[name], track = new SIM.Track(SIM.CIRCUITS.find(c => c.id === id));
  const S = new SIM.Session(track, { type: 'race', gameMode: 'grandprix', entries: [{ driver: SIM.DRIVERS[driver] }], seed, spectate: true,
    weather: 'dynamic', weatherState: DRY(seed), tyreWear: 'normal', damage: 'realistic' });
  const car = S.cars[0];
  S.fitTyres(car, plan.start, 78); car.fuel = S.fuelForLaps(plan.fuel || S.totalLaps + 0.3);
  const ai = car.ai, own = ai.strategy.bind(ai);
  ai.strategy = () => {
    own();
    const next = plan.stops[car.pitStops];
    ai.boxThisLap = !!(next && car.laps === next[0] - 1 && !car.pit) || ai.damageStop || car.damage.anyPuncture();
    if (next) car.boxCompound = next[1];
  };
  let lapStart = 0, l = 0; const laps = [];
  while (!S.over && S.time < 1400) {
    S.fixedStep(SIM.PHYS_DT);
    if (style === 'aggressive') { ai.tyreMode = 'push'; ai.pushMode = 1; }
    if (car.laps !== l) { laps.push(S.time - lapStart); lapStart = S.time; l = car.laps; }
  }
  return { time: car.finished ? car.finishTime : null, dnf: car.dnf ? car.dnfReason : '', stops: car.pitHistory.map(h => h.from + '>' + h.to + '@' + (h.lap + 1) + (h.fuelAdded > 0.05 ? ' +' + h.fuelAdded.toFixed(1) + 'kg' : '')),
    wear: Math.max(...car.tyre.wear), punctures: car.damage.anyPuncture(), laps };
}
module.exports = { run, STRATEGIES };
if (require.main === module) {
  const ids = (process.argv[2] || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(','), styles = (process.argv[3] || 'normal').split(','), seeds = (process.argv[4] || '11').split(',').map(Number);
  for (const id of ids) for (const style of styles) {
    const rows = Object.keys(STRATEGIES).map(name => {
      const rs = seeds.map(seed => run(id, name, { style, seed }));
      const ok = rs.filter(r => r.time != null);
      return { name, time: ok.length ? ok.reduce((a, r) => a + r.time, 0) / ok.length : null, rs };
    });
    const best = Math.min(...rows.filter(r => r.time != null).map(r => r.time));
    console.log('\n' + id + ' · ' + style + ' driving · seeds ' + seeds.join(','));
    for (const r of rows.sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9)))
      console.log('  ' + r.name.padEnd(18) + (r.time != null ? r.time.toFixed(1).padStart(7) + ' s  ' + ('+' + (r.time - best).toFixed(1)).padStart(6) : '   DNF') + '  | ' +
        r.rs.map(x => (x.dnf ? 'DNF ' + x.dnf : x.time.toFixed(1)) + ' [' + x.stops.join(', ') + '] end wear ' + Math.round(x.wear * 100) + '%' + (x.punctures ? ' PUNCTURE' : '')).join(' ; '));
  }
}
