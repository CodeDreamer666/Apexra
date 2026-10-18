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
const funcs = ['sessionConfig', 'careerSessionConfig', 'buildEntries', 'raceWeatherState', 'circuitFuelPerLap', 'circuitTank', 'briefIcon', 'briefTyreArt',
  'centreLineOf', 'drawBriefCircuit', 'playerGridPos', 'startRace', 'psCard', 'psSelection', 'updatePitService', 'updateStrategyUI', 'renderCareerStrip', 'showResults', 'recordCareerRace', 'updateCareerButton'];
const settings = html.slice(html.indexOf("const SETTINGS_KEY ="), html.indexOf('/* ---------------- audio (WebAudio synthesis)'));
const icons = html.slice(html.indexOf('const PS_ICON ='), html.indexOf('function psCard('));
// Career screen state used by the result screen.
const crui = html.slice(html.indexOf('const CRUI ='), html.indexOf('const teamColour'));
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
      const G = { mode: 'race', attract: false, strategyRefresh: 0, psCards: {}, pitSvcState: null, career: null };
      const GRID_FORMATION_GAP = 120, CENTRE_LINES = new Map();
      // Input clearing belongs to the renderer's input loop, outside this DOM harness.
      const clearKeys = () => {};
      ${icons}
      ${crui}
      ${funcs.map(source).join('\n')}
      window.testUI = { G, S, startRace, updateStrategyUI, updatePitService, showResults, saveSettings, buildEntries, sessionConfig };
      $('loading').classList.add('hidden'); $('menu').classList.add('hidden');` });
    if (errors.length) throw new Error('harness: ' + errors.join(' | '));
    const checks = await page.evaluate(() => {
      const { G, S, startRace, updateStrategyUI, updatePitService, showResults, saveSettings } = testUI;
      const check = (ok, msg) => { if (!ok) throw Error(msg); };
      const visible = el => !el.classList.contains('hidden');
      const obsolete = /penalty|penalties|second dry|two (?:different )?dry|compound rule|compound required/i;
      check(S.startTyre === 'H' && S.startFuel === 6 && S.difficulty === undefined && S.volume === 70, 'race choices kept and removed settings ignored');
      saveSettings(); const saved = JSON.parse(localStorage.getItem('apexgp.settings.v1'));
      check(!('mandatory' in saved) && !('penalty' in saved) && !('compoundPenalty' in saved), 'legacy settings discarded');
      for (const id of ['settings', 'hud-tl', 'board', 'engineerRadio', 'strategyToggle', 'tLast', 'tDelta', 's1', 's2', 's3', 'tt0', 'tt1', 'tt2', 'tt3', 'tyreAge',
        'tw0', 'tw1', 'tw2', 'tw3', 'tyreLife', 'tyreNext', 'vsPit', 'dmgTxt', 'chipFuel']) check(!$(id), id + ' removed');
      for (const id of ['lapNow', 'lapTot', 'posNow', 'posTot', 'tCur', 'tBest', 'minimap', 'spd', 'gear', 'rpm', 'cmpIcon', 'cmpName', 'wearPct', 'fuelVal', 'wxRain', 'wxWet', 'vsBadge', 'vstat']) check(!!$(id), id + ' retained');
      // lap and position share the top-right panel; weather, tyres, fuel and car status share the right panel
      check($('lapNow').closest('#hud-tr') && $('posNow').closest('#hud-tr'), 'lap and position together');
      for (const id of ['wxRain', 'wxWet', 'wearPct', 'fuelVal', 'vsBadge']) check($(id).closest('#hud-br'), id + ' in the status panel');
      check(document.querySelectorAll('#hud [id="fuelVal"]').length === 1, 'fuel shown once');
      check(!document.querySelector('[data-mode="duel"], [data-mode="pursuit"], [data-act="settings"]'), 'deleted menu entries');
      const report = [];
      for (const def of SIM.CIRCUITS) for (const mode of ['grandprix', 'career']) {
        G.career = mode === 'career' ? { rank: 0, team: 0, circuit: def.id } : null;
        G.session = null; G.track = new SIM.Track(def);
        const wantGrid = mode === 'career' ? SIM.PROGRESS.gridPos(PG, 0) : 20;
        startRace();
        const order = G.pendingRace.gridOrder, me = G.pendingRace.entries.findIndex(e => e.isPlayer);
        check(order.length === 20 && new Set(order).size === 20 && order.indexOf(me) + 1 === wantGrid, def.id + ' ' + mode + ': player starts P' + wantGrid + ' (P' + (order.indexOf(me) + 1) + ')');
        check($('briefGrid').textContent === 'P' + wantGrid, 'race brief shows the starting position: ' + $('briefGrid').textContent);
        check(!obsolete.test($('raceBrief').innerText), def.id + ' ' + mode + ': setup text');
        check(!/qualif|eliminat/i.test($('raceBrief').innerText), 'no qualifying or Elimination text');
        check($('briefChoices').children.length === 4, 'four compounds');
        check(visible($('briefChoices')) && visible($('briefFuelSection')), 'pre-grid choices remain');
        check(!document.querySelector('.brief-rules'), 'red Important Rules panel removed');
        $('raceBrief').classList.add('hidden');
        const entries = buildEntries();
        check(entries.length === 20 && entries[0].isPlayer, 'Grand Prix uses Team A');
        const cfg = sessionConfig('race'); check(cfg.difficulty === 1, 'fixed 100% AI');
        for (const [rank, expected] of [1, 1.25, 1.5].entries()) {
          G.career = { rank, team: 7, circuit: def.id };
          check(sessionConfig('race').aiLevel === expected, 'Career difficulty');
          check(buildEntries()[7].isPlayer, 'Career team retained');
        }
        G.career = mode === 'career' ? { rank: 0, team: 0, circuit: def.id } : null;
        const sess = new SIM.Session(G.track, { type: 'race', gameMode: 'grandprix', entries, weather: 'dry', seed: 71,
          career: G.career ? { rank: 0, team: 0, circuit: def.id, id: 'ui-' + def.id } : null, aiLevel: G.career ? 1 : undefined });
        G.session = sess; G.track = sess.track; G.player = sess.player; G.focus = sess.player;
        const p = sess.player; G.strategyRefresh = 0;
        $('strategyPanel').classList.remove('hidden'); updateStrategyUI(p, sess);
        check(!obsolete.test($('strategyPanel').innerText), 'strategy text');
        {
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
        if (G.career) recordCareerRace(sess);
        showResults();
        check(!obsolete.test($('results').innerText), 'results text');
        check(!/Pen\./.test($('resTable').innerText), 'no penalty column');
        const rows = [...$('resTable').rows], width = rows[0].cells.length;
        check(rows.length === 21 && rows.every(r => r.cells.length === width), 'aligned result columns');
        check(sess.results[0].time === 1000, 'raw finish time');
        const acts = [...$('resActions').children].map(b => b.textContent);
        if (mode === 'career') {
          check(acts.some(a => /^Retry /.test(a)), 'a career circuit can be retried: ' + acts);
          check(/Next start/i.test($('resCareer').innerText) && SIM.PROGRESS.gridPos(PG, 0) === sess.results.find(r => r.car.isPlayer).pos, 'the finish sets the next start: ' + $('resCareer').innerText);
          check(/Position/i.test($('resCareer').innerText) && /Lap-time pace/i.test($('resCareer').innerText) && /\/ 100/.test($('resCareer').innerText), 'circuit score shown: ' + $('resCareer').innerText);
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
