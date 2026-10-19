const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Exercises the actual renderer, saved resolution controls, and the complete menu-to-race path.
// THREE_JS can point at a cached Three.js r160 module. CLARITY_OUT optionally saves lossless review images.
test('sharp display: real 4K buffers, saved Native mode, coherent menus and readable racing HUD', { timeout: 600000 }, async t => {
  const out = process.env.CLARITY_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const root = path.join(__dirname, '..'), origin = 'http://apex.test';
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('window.APEX = G;',
    'window.APEX = G; window.__displayTest = { renderer: () => renderer, settings: S, adaptResolution, showResults, gfx: () => GFX };');
  const engine = process.env.THREE_JS ? fs.readFileSync(process.env.THREE_JS) : null;
  console.log('Starting browser display review.');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }).catch(e => { console.error(e); throw e; });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.setDefaultTimeout(120000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/WebGL.*context.*lost/i.test(m.text()) || (m.type() === 'error' && /shader|GL_INVALID|framebuffer/i.test(m.text()))) errors.push(m.text()); });
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.startsWith(origin + '/')) {
        const pathname = new URL(u).pathname;
        if (pathname === '/') return route.fulfill({ contentType:'text/html', body:html });
        if (pathname === '/favicon.ico') return route.fulfill({ contentType:'image/x-icon', body:fs.readFileSync(path.join(root, 'favicon.ico')) });
        return route.fulfill({ status:404, body:'' });
      }
      if (engine && u.includes('three.module')) return route.fulfill({ contentType: 'application/javascript', body: engine });
      if (u.includes('fonts.googleapis.com') || u.includes('fonts.gstatic.com')) return route.abort();
      return route.continue();
    });
    await page.addInitScript(() => {
      const raf = requestAnimationFrame.bind(window);
      window.__t = 0;
      window.requestAnimationFrame = cb => {
        if (!/\bframe\(/.test(String(cb))) return raf(cb);
        (window.__rafq ||= []).push(cb); return 1;
      };
      window.__frames = (n = 1) => {
        for (let i = 0; i < n; i++) {
          const q = window.__rafq || []; window.__rafq = []; window.__t += 1000 / 60;
          for (const cb of q) cb(window.__t);
        }
      };
    });
    await page.goto(origin + '/?quality=medium', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, { polling: 250 });
    if (await page.locator('#loadErr').isVisible()) {
      t.skip(await page.locator('#loadErr').textContent()); return;
    }
    const dimensions = () => page.evaluate(() => {
      const c = __displayTest.renderer().domElement;
      return { width: c.width, height: c.height, postWidth: APEX.post?.rt.width, postHeight: APEX.post?.rt.height, mode: __displayTest.settings.resolution };
    });
    const frames = async n => { for (let i = 0; i < n; i++) await page.evaluate(() => __frames(1)); };
    const shot = async name => { if (out) await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' }); };
    assert.deepEqual(await dimensions(), { width:3840, height:2160, postWidth:3840, postHeight:2160, mode:'4k' });
    console.log('Default 4K: canvas and multisampled scene target are 3840 × 2160.');
    await frames(2); await shot('01-menu');

    await page.locator('#menu [data-resolution="native"]').click();
    assert.deepEqual(await dimensions(), { width:1600, height:900, postWidth:1600, postHeight:900, mode:'native' });
    assert.equal(await page.locator('#pause [data-resolution="native"]').getAttribute('aria-pressed'), 'true');
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { polling:250 });
    assert.equal((await dimensions()).mode, 'native');
    assert.equal((await dimensions()).width, 1600);
    await page.setViewportSize({ width:1920, height:1080 });
    await page.evaluate(() => { Object.defineProperty(window, 'devicePixelRatio', { value:2, configurable:true }); window.dispatchEvent(new Event('resize')); });
    assert.equal((await dimensions()).width, 3840, 'Native honours a high-density display');
    assert.ok(await page.evaluate(() => APEX.mm.cvs.width >= 782), 'the track map has enough physical pixels');
    await page.evaluate(() => { delete window.devicePixelRatio; window.dispatchEvent(new Event('resize')); });
    await page.setViewportSize({ width:1600, height:900 });
    console.log('Native updates both controls, resizes post-processing, and persists after reload.');
    await frames(2);
    await page.locator('#menu [data-act="controls"]').click(); await shot('10-controls');
    await page.locator('[data-act="controlsClose"]').click();
    await page.locator('#btnCareer').click(); await shot('11-career');
    await page.locator('#crBack').click();

    await page.locator('#menuStart').click();
    await page.locator('.cs-card').first().click(); await shot('02-circuits');
    await page.locator('#csGo').click();
    await page.locator('#raceBrief').waitFor({ state:'visible' });
    await shot('03-race-setup');
    await page.locator('#briefStart').click();
    await page.waitForFunction(() => APEX.mode === 'race' && APEX.player);
    await page.evaluate(() => {
      const g = APEX, s = g.session, t = g.track, start = t.length * .28;
      s.lightsOut = true; s.lights = 0; s.lightsOutTime = 0; s.time = 30; g.timeScale = 0;
      Object.assign(s.weather, { pattern:'dry', regime:'sunny', rain:0, water:0, lineWater:0, cloud:.15, targetCloud:.15, targetRain:0 });
      s.cars.forEach((c, i) => {
        c.placeAt(t, start + (c === g.player ? 0 : 20 + i * 22), i % 2 ? 1.5 : -1.5, 70);
        c.speed = c.u = 70; c.started = true; c.launch.active = false;
        c.totalDist = c.s; c.gear = 6; c.rpm = 10800;
      });
      s.standings();
      g.camRig.init = false; g.planPinned = true; g.strategyRefresh = 0;
    });
    await frames(4); await shot('04-racing-hud');
    await page.keyboard.press('Escape');
    await frames(1);
    await page.locator('#pause [data-resolution="4k"]').click();
    assert.equal((await dimensions()).width, 3840);
    assert.equal((await dimensions()).postWidth, 3840);
    await page.locator('[data-act="resume"]').click();
    await page.setViewportSize({ width:3840, height:2160 });
    await frames(2);
    assert.equal(await page.evaluate(() => __displayTest.renderer().getContext().isContextLost()), false, 'the GPU context survives resolution changes');
    await shot('05-racing-4k');
    assert.deepEqual(await dimensions(), { width:3840, height:2160, postWidth:3840, postHeight:2160, mode:'4k' });
    const post = await page.evaluate(() => ({ samples:APEX.post.rt.samples, uniforms:Object.keys(APEX.post.mComp.uniforms), bloom:APEX.post.bloomStr }));
    for (const effect of ['blur','ca','rain']) assert.ok(!post.uniforms.includes(effect), effect + ' cannot soften the view');
    assert.ok(post.samples >= 2 && post.bloom <= .18);
    await page.keyboard.press('KeyC'); await frames(1); await shot('06-car-status');
    assert.equal(await page.locator('#carStatus .cs-head').evaluate(el => getComputedStyle(el, '::after').content), 'none');
    await page.keyboard.press('KeyC'); await frames(1);
    await page.evaluate(() => {
      const g = APEX; __displayTest.gfx().forced = false; g.worldBuiltAt = performance.now() - 20000; g.fps = 20;
      for (let i = 0; i < 30; i++) __displayTest.adaptResolution();
    });
    assert.equal((await dimensions()).width, 3840);
    assert.equal(await page.evaluate(() => APEX.resScale), 1);
    console.log('4K stays fixed under sustained slow frames; scenery and effects can adapt.');
    await page.evaluate(() => {
      const s = APEX.session;
      s.results = s.cars.map((car, i) => ({ car, pos:i + 1, laps:6, time:500 + i * 1.8, best:78.2 + i * .3, pits:i % 2, points:20 - i }));
      s.bestLap = { car:s.cars[0], time:78.2 }; __displayTest.showResults();
    });
    await shot('12-results');
    await page.evaluate(() => document.getElementById('results').classList.add('hidden'));

    // Inspect layout at laptop and narrow phone widths without spending frames rendering a hidden race.
    await page.evaluate(() => {
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
      document.getElementById('menu').classList.remove('selecting');
    });
    await page.setViewportSize({ width:1280, height:720 }); await frames(1); await shot('07-menu-laptop');
    await page.setViewportSize({ width:390, height:844 }); await frames(1); await shot('08-menu-mobile');
    assert.ok(await page.locator('#menuStart').evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    await page.locator('#menuStart').click(); await shot('09-circuits-mobile');
    const box = await page.locator('#circuitSelect').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.deepEqual(errors, [], 'no JavaScript or shader errors');
    console.log('Menu → circuit → race setup → race → pause/display → car status passes; responsive layouts captured.');
  } catch (e) { console.error('Display review failed:', e); throw e; }
  finally { await browser.close(); }
});
