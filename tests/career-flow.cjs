const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

// The Career in the real game, end to end in Chromium: the Career screen offers only the next scheduled race; the
// race brief starts it (saved as the active attempt); Retire from the pause menu ends the player's race, the rest of
// the field is run to the flag in the background and the result is classified, scored and saved once, with no retry;
// a race left by closing the browser is counted as a forfeit on the next start; Endless Career keeps its drawn circuit
// across reloads. The game loads Three.js from a CDN: set THREE_JS=/path/to/three.module.js (three@0.160.0) without
// network access; if it cannot be loaded the test is skipped. CHROMIUM_PATH can select a browser. SHOTS=dir saves
// screenshots of the screens.
const ROOT = path.join(__dirname, '..');
const KEY = 'apexgp.progress.v4';

test('Career end to end: fixed order, Retire is a counted result, no retry, browser-close forfeit, Endless circuit kept', { timeout: 900000 }, async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(600000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // a fresh Career on the first load only (reloads keep what the game saved)
    await page.addInitScript(() => { if (!sessionStorage.getItem('fresh')) { localStorage.clear(); sessionStorage.setItem('fresh', '1'); } });
    if (process.env.THREE_JS) await page.route(/three(@0\.160\.0)?\/.*three\.module(\.min)?\.js$/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) }));
    const load = async () => {
      await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, { polling: 300 });
      return page.evaluate(() => document.getElementById('loadErr').classList.contains('hidden'));
    };
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    if (!await load()) { t.skip('Three.js could not be loaded (set THREE_JS to a local three.module.js)'); return; }
    const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); };
    const ff = (cond, sec) => page.evaluate(([cond, sec]) => { const s = APEX.session, f = new Function('s', 'return ' + cond); for (let k = 0; k < sec / SIM.PHYS_DT && !f(s); k++) s.fixedStep(SIM.PHYS_DT); return f(s); }, [cond, sec]);

    // ---- the Career screen: four stages, only the next race can be started ----
    await page.click('[data-act="career"]');
    await page.waitForSelector('#career:not(.hidden)');
    assert.equal(await page.locator('#crBar > li').count(), 4, 'Rookie, Pro, Master and Endless');
    assert.match(await page.locator('#crActions .btn.primary').textContent(), /Start race 1: Monza/);
    assert.equal(await page.locator('#crTier .cr-go:not([disabled])').count(), 1, 'only the scheduled race can be raced');
    assert.match(await page.locator('#crBar > li').nth(3).textContent(), /Locked/);
    await shot('career-rookie');

    // ---- race 1: start, then Retire from the pause menu ----
    await page.click('#crActions .btn.primary');
    await page.waitForSelector('#raceBrief:not(.hidden)');
    assert.equal(await page.locator('#briefGrid').textContent(), 'P20', 'the first race of a championship starts from P20');
    await page.click('#briefStart');
    await page.waitForFunction(() => APEX.session && APEX.session.type === 'race' && APEX.session.cfg.career);
    let st = await saved();
    assert.equal(st.career.active.circuit, 'monza', 'the running race is saved before the lights');
    assert.ok(await ff('s.lightsOut && s.time - s.lightsOutTime > 12', 60));
    // R and Space do nothing: there is no respawn
    const before = await page.evaluate(() => ({ s: APEX.player.s, d: APEX.player.d }));
    await page.keyboard.press('KeyR'); await page.keyboard.press('Space'); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ s: APEX.player.s, d: APEX.player.d, dnf: APEX.player.dnf }));
    assert.ok(!after.dnf && Math.abs(after.d - before.d) < 3, 'R / Space do not move the car');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause:not(.hidden)');
    assert.match(await page.locator('#btnExit').textContent(), /Retire from the race/);
    // (both clicks in one step: under software rendering one Playwright action can outlast the 4-second arm)
    const arm = await page.evaluate(() => { const b = document.getElementById('btnExit'); b.click(); const t = b.textContent; const alive = !APEX.player.dnf; b.click(); return { t, alive }; });
    assert.match(arm.t, /Click again/, 'retiring needs a second click'); assert.ok(arm.alive, 'the first click alone does not retire');
    await page.waitForSelector('#results:not(.hidden)', { timeout: 600000 });
    const strip = await page.locator('#resCareer').textContent();
    assert.match(strip, /Retired/i); assert.match(strip, /DNF/); assert.match(strip, /\/ 40/); assert.match(strip, /Championship/i);
    const acts = await page.locator('#resActions').textContent();
    assert.ok(!/retry|again/i.test(acts), 'no retry: ' + acts); assert.match(acts, /Next race: Silverstone/);
    await shot('career-retired-result');
    st = await saved();
    const r1 = st.career.ranks.rookie.races;
    assert.equal(r1.length, 1); assert.equal(r1[0].circuit, 'monza'); assert.ok(r1[0].dnf); assert.equal(r1[0].reason, 'retired'); assert.equal(st.career.active, null);
    assert.ok(r1[0].total >= 2 && r1[0].total <= 40 && r1[0].total === r1[0].posPts + r1[0].lapPts);
    const res = await page.evaluate(() => APEX.session.results.map(r => ({ pos: r.pos, dnf: r.dnf, player: r.car.isPlayer, lapRank: r.lapRank })));
    assert.equal(res.length, 20); assert.equal(res.find(r => r.player).pos, r1[0].pos);
    assert.ok(res.filter(r => !r.dnf).every(r => r.pos < r1[0].pos), 'every car still in the race is classified ahead of the retired player');

    // ---- race 2: started, then the browser is closed (a reload) — the race is forfeited, not offered again ----
    await page.click('text=Next race: Silverstone');
    await page.waitForSelector('#raceBrief:not(.hidden)');
    await page.click('#briefStart');
    await page.waitForFunction(() => APEX.session && APEX.session.cfg.career && APEX.session.cfg.career.circuit === 'silverstone');
    await page.reload();
    assert.ok(await load());
    // (the notice hides itself after 9 s, which a slow software-rendered page can outlast: its text stays)
    await page.waitForFunction(() => /counted as a retirement/.test(document.getElementById('toast').textContent));
    st = await saved();
    const r2 = st.career.ranks.rookie.races;
    assert.equal(r2.length, 2); assert.equal(r2[1].circuit, 'silverstone'); assert.equal(r2[1].reason, 'forfeit'); assert.equal(r2[1].total, 2); assert.equal(st.career.active, null);
    await page.click('[data-act="career"]');
    await page.waitForSelector('#career:not(.hidden)');
    assert.match(await page.locator('#crActions .btn.primary').textContent(), /Start race 3: Spa/, 'the Career moved on to race 3');

    // ---- Endless Career: the drawn circuit survives reloads ----
    await page.evaluate((k) => {
      const st = SIM.PROGRESS.create(); st.career.unlocked = 2; st.career.completed = [0, 1, 2]; st.career.endless.unlocked = true;
      localStorage.setItem(k, JSON.stringify(st));
    }, KEY);
    const nextEndless = async () => {
      await page.reload(); assert.ok(await load());
      await page.click('[data-act="career"]'); await page.waitForSelector('#career:not(.hidden)');
      await page.locator('#crBar > li').nth(3).locator('button').click();
      return page.locator('#crEndlessStart').textContent();
    };
    const first = await nextEndless();
    assert.match(first, /Start race: /);
    assert.match(await page.locator('#crTier').textContent(), /1,000/);
    await shot('career-endless');
    for (let k = 0; k < 3; k++) assert.equal(await nextEndless(), first, 'the same drawn circuit after a reload');
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await browser.close(); }
});
