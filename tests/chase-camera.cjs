const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { serveGame } = require('../tools/browser-game.cjs');

// The chase camera stays at one distance, height and field of view whatever the car does (slow, flat out, braking,
// accelerating, cornering), and on a wet road the tyres throw a low, faint spray that stays below the driver's eye
// line. The game loads Three.js from a CDN: set THREE_JS=/path/to/three.module.js (three@0.160.0) without network
// access; if it cannot be loaded the test is skipped. CHROMIUM_PATH can select a browser.
test('chase camera: fixed distance and field of view in every situation; cockpit camera and driver; low, faint wet spray', { timeout: 600000 }, async (t) => {
  const server = await serveGame(path.join(__dirname, '..'), html => html.replace('window.APEX = G;', 'window.APEX = G; window.__start = (cfg) => startSession(cfg);'));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    page.setDefaultTimeout(500000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('apexgp.settings.v1', JSON.stringify({ circuit: 'monza', resolution: 'native' }));
      const nativeRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = cb => { if (!/\bframe\(/.test(String(cb))) return nativeRaf(cb); (window.__rafq = window.__rafq || []).push(cb); return 1; };
      window.__t = 0; window.__frames = (n, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { const q = window.__rafq || []; window.__rafq = []; window.__t += dt; for (const cb of q) cb(window.__t); } };
    });
    await page.route('**/*', r => {
      const u = r.request().url();
      if (process.env.THREE_JS && u.includes('three.module')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) });
      if (u.includes('fonts.googleapis.com')) return r.fulfill({ contentType: 'text/css', body: '' });
      return r.continue();
    });
    await page.goto(server.url + '/index.html?quality=low');
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, { polling: 300 });
    if (await page.evaluate(() => !document.getElementById('loadErr').classList.contains('hidden'))) { t.skip('Three.js could not be loaded (set THREE_JS to a local three.module.js)'); return; }
    const r = await page.evaluate(() => {
      const G = APEX, W = Object.assign(new SIM.DynamicWeather(7).snapshot(), { pattern: 'wet', rain: 0.8, water: 0.8, lineWater: 0.7, cloud: 0.9, targetRain: 0.8, targetCloud: 0.9, patternEnds: 1e9, regimeEnds: 1e9 });
      G.attract = true; window.__start({ type: 'race', entries: SIM.DRIVERS.map(driver => ({ driver })), seed: 7, difficulty: 1, weather: 'dynamic', weatherState: W });
      const s = G.session, t = G.track; s.lightsOut = true; s.lightsOutTime = 0; s.time = 30; G.attract = false; G.mode = 'race';
      s.cars.forEach((c, i) => { const d = t.length * 0.55 - i * 14; c.placeAt(t, d, i % 2 ? 1.6 : -1.6, 60); c.speed = c.u = 60; c.totalDist = t.length + d; c.laps = 1; c.crossings = 2; c.lastLapBase = Math.floor(c.totalDist / t.length); c.lastWithin = t.wrapS(c.totalDist); c.launch.active = false; c.started = true; c.fuel = s.fuelForLaps(5); });
      const car = G.focus = s.cars[6]; G.camRig.init = false;
      const views = [];
      const look = (label, v, gLong, gLat) => {
        car.speed = car.u = v; car.vx = Math.cos(car.psi) * v; car.vz = Math.sin(car.psi) * v;
        const frame = () => { car.gLong = gLong; car.gLat = gLat; };
        for (let k = 0; k < 20; k++) { frame(); __frames(1); }
        const cam = G.camera.position;
        views.push({ label, dist: Math.hypot(cam.x - car.x, cam.z - car.z), fov: G.camera.fov });
      };
      look('slow', 15, 0, 0); look('flat out', 88, 0, 0); look('accelerating', 50, 9, 0); look('braking', 70, -45, 0); look('cornering', 60, 0, 30);
      // the wet spray thrown so far
      const sp = G.spray, live = [];
      for (let i = 0; i < sp.n; i++) if (sp.life[i] > 0) live.push({ y: sp.pos[i * 3 + 1], a: sp.baseA[i] });
      // the cockpit camera: at the driver's eyes, the focus car's own head hidden, its hands on a wheel turned with the
      // steering, the decorative wheel display; looking back, the nose camera faces the driver
      G.camRig.setMode('cockpit'); __frames(4);
      const m = G.models.get(car), cam = G.camera.position, fx = Math.cos(car.psi), fz = Math.sin(car.psi);
      const cockpit = { along: (cam.x - car.x) * fx + (cam.z - car.z) * fz, side: Math.abs(-(cam.x - car.x) * fz + (cam.z - car.z) * fx), headHidden: !m.helmet.visible,
        wheel: m.driver.angle, steer: car.steer, display: !!m.driver.dispMat.map?.isCanvasTexture, others: s.cars.filter(c => c !== car).every(c => { const o = G.models.get(c); return !o || o.helmet.visible || o.lod >= 2; }) };
      G.lookBack = true; __frames(2);
      const dir = G.camera.getWorldDirection(new cam.constructor());
      cockpit.backDir = dir.x * fx + dir.z * fz; cockpit.backY = cam.y; cockpit.headBack = m.helmet.visible;
      G.lookBack = false; __frames(2);
      cockpit.mirrors = m.mirrorMesh.material === m.mirrorMat && m.mirrorMat.metalness === 1;
      G.lookBack = false; G.camRig.setMode('chase');
      return { views, cockpit, spray: { count: live.length, maxY: Math.max(...live.map(p => p.y)), maxA: Math.max(...live.map(p => p.a)) } };
    });
    const d0 = r.views[0].dist;
    for (const v of r.views) {
      assert.ok(Math.abs(v.dist - d0) < 0.15, v.label + ': camera ' + v.dist.toFixed(2) + ' m behind (slow: ' + d0.toFixed(2) + ' m)');
      assert.equal(v.fov, r.views[0].fov, v.label + ': field of view');
    }
    assert.ok(d0 > 4 && d0 < 6, 'a close chase camera: ' + d0.toFixed(2) + ' m');
    assert.ok(r.spray.count > 20, 'the tyres throw spray on a wet road: ' + r.spray.count);
    assert.ok(r.spray.maxY < 1.2, 'spray stays low: ' + r.spray.maxY.toFixed(2) + ' m');
    assert.ok(r.spray.maxA <= 0.3, 'spray is faint: ' + r.spray.maxA.toFixed(2));
    const k = r.cockpit;
    assert.ok(Math.abs(k.along) < 0.3 && k.side < 0.1, 'cockpit camera at the driver: ' + JSON.stringify(k));
    assert.ok(k.headHidden, 'the camera is the driver\'s head: its own helmet is not drawn');
    assert.ok(k.others, 'every other driver keeps his head');
    assert.ok(Math.abs(k.wheel - Math.max(-2.3, Math.min(2.3, k.steer * 5.5))) < 0.05, 'the wheel turns with the steering: ' + k.wheel + ' for ' + k.steer);
    assert.ok(k.display, 'the wheel keeps its decorative display (race telemetry is in the HUD)');
    assert.ok(k.backDir < -0.5 && k.backY > 0.9 && !k.headBack, 'looking back from the cockpit: over the halo and engine cover at the cars behind: ' + JSON.stringify(k));
    assert.ok(k.mirrors, 'the mirrors keep their reflective material');
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await browser.close(); await server.close(); }
});
