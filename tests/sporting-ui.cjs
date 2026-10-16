// DOM regression harness: exercise production UI functions and the simulation in Chromium.
// Rendering is excluded so these checks need neither a GPU nor a Three.js CDN connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function source(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = html.indexOf('\n', start);
  const end = html.slice(start, lineEnd).trimEnd().endsWith('}') ? lineEnd : html.indexOf('\n}', start) + 2;
  const code = html.slice(start, end);
  new Function(code);
  return code;
}
const funcs = ['raceWeatherState', 'circuitFuelPerLap', 'circuitTank', 'circuitPitLoss', 'briefIcon', 'briefTyreArt',
  'centreLineOf', 'drawBriefCircuit', 'startRace', 'psCard', 'psSelection', 'updatePitService', 'updateStrategyUI', 'renderCareerStrip', 'showResults', 'showRankedResults'];
const settings = html.slice(html.indexOf("const SETTINGS_KEY ="), html.indexOf('function updateModeSelection()'));
const icons = html.slice(html.indexOf('const PS_ICON ='), html.indexOf('function psCard('));
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ||
    (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url() === 'http://apex.test/'
      ? route.fulfill({ contentType: 'text/html', body: html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '') }) : route.abort());
    await page.goto('http://apex.test/');
    await page.evaluate(() => localStorage.setItem('apexgp.settings.v1', JSON.stringify({ startTyre: 'H', startFuel: 6,
      difficulty: 82, volume: 23, mandatory: true, penalty: 90, compoundPenalty: true })));
    await page.addScriptTag({ content: html.match(/<script>([\s\S]*?)<\/script>/)[1] });
    await page.addScriptTag({ content: `const $ = id => document.getElementById(id);
      const clamp = SIM.clamp, fmt = SIM.fmtTime;
      ${settings}
      const G = { mode: 'race', attract: false, strategyRefresh: 0, psCards: {}, pitSvcState: null, career: null, ranked: null };
      const GRID_FORMATION_GAP = 120, CENTRE_LINES = new Map();
      // Input clearing belongs to the renderer's input loop, outside this DOM harness.
      const clearKeys = () => {};
      ${icons}
      ${funcs.map(source).join('\n')}
      window.testUI = { G, S, startRace, updateStrategyUI, updatePitService, showResults, saveSettings };
      $('loading').classList.add('hidden'); $('menu').classList.add('hidden');` });
    const checks = await page.evaluate(() => {
      const { G, S, startRace, updateStrategyUI, updatePitService, showResults, saveSettings } = testUI;
      const check = (ok, msg) => { if (!ok) throw Error(msg); };
      const visible = el => !el.classList.contains('hidden');
      const obsolete = /penalty|penalties|second dry|two (?:different )?dry|compound rule|compound required/i;
      check(S.startTyre === 'H' && S.startFuel === 6 && S.difficulty === 82 && S.volume === 23, 'unrelated settings preserved');
      saveSettings(); const saved = JSON.parse(localStorage.getItem('apexgp.settings.v1'));
      check(!('mandatory' in saved) && !('penalty' in saved) && !('compoundPenalty' in saved), 'legacy settings discarded');
      const report = [];
      for (const def of SIM.CIRCUITS) for (const mode of ['grandprix', 'career', 'duel', 'pursuit']) {
        const ranked = mode === 'duel' || mode === 'pursuit';
        G.career = mode === 'career' ? { tier: 0, team: 0 } : null;
        G.ranked = ranked ? { mode, rank: 3, circuit: def.id } : null;
        S.gameMode = ranked ? mode : 'grandprix';
        G.session = null; G.track = new SIM.Track(def);
        startRace();
        check(!obsolete.test($('raceBrief').innerText), def.id + ' ' + mode + ': setup text');
        check(!/qualif|eliminat/i.test($('raceBrief').innerText), 'no qualifying or Elimination text');
        check($('briefChoices').children.length === 4, 'four compounds');
        check(visible($('briefChoices')) === !ranked, 'tyre choice only where there is a strategy');
        check(visible($('briefFuelSection')) === !ranked, 'fuel isolation');
        check(visible($('briefModeNote')) === ranked, 'mode note');
        if (mode === 'pursuit') check(/27% wear/.test($('briefModeNote').innerText) && /3\.5 s/.test($('briefModeNote').innerText) && /new Softs/.test($('briefModeNote').innerText), 'the rival tyre difference and head start are announced');
        const cols = getComputedStyle($('raceBrief').querySelector('.brief-rule-grid')).gridTemplateColumns.split(' ').length;
        check(cols === (ranked ? 1 : 3), 'setup grid has no empty column: ' + cols);
        $('raceBrief').classList.add('hidden');
        const entries = ranked ? SIM.DRIVERS.slice(0, 2).map((driver, i) => ({ driver, isPlayer: i === 0 })) : SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === 0 }));
        const sess = new SIM.Session(G.track, { type: 'race', gameMode: S.gameMode, entries, weather: 'dry', seed: 71,
          career: G.career ? { tier: 0, team: 0, race: 0, id: 'ui' } : null, aiLevel: G.career ? 1 : ranked ? 1.6 : undefined,
          ranked: ranked ? { ...G.ranked, id: 'ui-' + mode } : null, pursuit: mode === 'pursuit' ? { gap: 3.5, rivalWear: 0.25, rival: 1 } : undefined });
        G.session = sess; G.track = sess.track; G.player = sess.player; G.focus = sess.player;
        const p = sess.player; G.strategyRefresh = 0;
        $('strategyPanel').classList.remove('hidden'); updateStrategyUI(p, sess);
        check(!obsolete.test($('strategyPanel').innerText), 'strategy text');
        check(visible($('strategyToggle')) === !ranked, 'no pit/strategy panel in the ranked modes');
        if (!ranked) {
          const pit = G.track.pit;
          p.pit = { phase: 'awaiting', station: pit.id, box: 0, selection: { tyre: p.tyre.c, fuel: 0 } };
          updatePitService(p, sess, true);
          check(!obsolete.test($('pitSvc').innerText), 'pit menu text');
          const same = $('psTyres').querySelector('[data-c="' + p.tyre.c + '"]');
          check(same && !same.disabled, 'current compound is available again'); same.click();
          check(sess.confirmPitService(p, p.pit.selection), 'same-compound selection accepted');
          updatePitService(p, sess, true);
          check(visible($('psFuelSection')), 'pit fuel');
          $('pitSvc').classList.add('hidden');
        }
        for (const [i,c] of sess.cars.entries()) {
          c.finished = true; c.laps = sess.totalLaps; c.finishTime = 1000 + i; c.finishOrder = i + 1;
          c.totalDist = sess.totalLaps * sess.track.length; c.finalLaps = [90 + i,90 + i,90 + i]; c.penalty = 90;
        }
        sess.finishRace();
        if (G.career) {
          const st = SIM.CAREER.create(); SIM.CAREER.start(st, 0, 0);
          sess.careerStaged = SIM.CAREER.stage(st, { tier: 0, team: 0, race: 0, id: 'ui' }, sess.results);
        }
        if (ranked) sess.rankedOutcome = { ok: true, win: true, unlockedNow: true };
        showResults();
        check(!obsolete.test($('results').innerText), 'results text');
        check(!/Pen\./.test($('resTable').innerText), 'no penalty column');
        const rows = [...$('resTable').rows], width = rows[0].cells.length;
        check(rows.length === (ranked ? 3 : 21) && rows.every(r => r.cells.length === width), 'aligned result columns');
        check(sess.results[0].time === 1000, 'raw finish time');
        const acts = [...$('resActions').children].map(b => b.textContent);
        if (mode === 'career') check(acts.includes('Retry race') && acts.includes('Accept result ▸'), 'a career race can be retried or accepted: ' + acts);
        if (ranked) {
          check(/Victory/i.test($('resTitle').innerText) && /Gold/i.test($('resTitle').innerText), 'verdict and rank: ' + $('resTitle').innerText);
          check(acts.some(a => /^Retry/.test(a)), 'immediate retry');
          if (mode === 'pursuit') check(/Starting gap/i.test($('resCareer').innerText) && /Final gap/i.test($('resCareer').innerText), 'pursuit gaps shown');
        }
        $('results').classList.add('hidden');
        report.push(def.id + ' / ' + mode + ': setup, strategy, pit menu and results pass');
      }
      return report;
    });
    assert.deepEqual(errors, []);
    console.log(checks.join('\n')); console.log('Legacy settings and all 12 circuit/mode UI combinations pass.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
