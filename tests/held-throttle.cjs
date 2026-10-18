// Chromium exercises the production key handlers and the game's own handling/physics without the renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const simulation = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const input = html.slice(html.indexOf('const KEYS = {};'), html.indexOf('const takePress ='));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button>Drive</button><input id="name"><div class="overlay hidden" style="display:none"></div>');
    await page.addScriptTag({ content: simulation });
    await page.addScriptTag({ content: `const G = { paused: false, attract: false, player: null };
      ${input}
      window.driveTest = {
        reset(speed, debt) {
          const car = G.player = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, { fuelEnabled: false });
          car.vx = car.u = car.speed = speed / 3.6; car.gear = speed > 200 ? 8 : speed > 100 ? 5 : 1;
          car.routeDebt = debt; this.handling = new SIM.PlayerHandling();
        },
        advance(surf, seconds) {
          const car = G.player, dt = SIM.PHYS_DT;
          const t = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => surf, pit: { limit: 22 }, aiLines: { vRef: [90] } };
          let min = Infinity;
          const x0 = car.x;
          for (let k = 0; k < seconds / dt; k++) {
            this.handling.step(car, dt, { lightsOut: true, wet: 0 }, DRIVE_KEYS.step(dt));
            SIM.stepCarPhysics(car, dt, t, { wet: 0, trackTemp: 30, wearScale: 0, fuelRate: 0, pitLimiter: false });
            if (k > 1 / dt) min = Math.min(min, car.speed * 3.6);
          }
          return { speed: car.speed * 3.6, min, moved: car.x - x0, throttle: car.input.throttle, brake: car.input.brake };
        }
      };` });
    let checks = 0;
    for (const surf of [2, 3, 4]) for (const start of [0, 150, 280]) for (const debt of [0, 10000]) {
      await page.evaluate(({ start, debt }) => { clearKeys(); driveTest.reset(start, debt); }, { start, debt });
      await page.keyboard.down('w');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await page.evaluate(() => DRIVE_KEYS.step(SIM.PHYS_DT).throttle), 0, 'blur clears input until a physical event resumes it');
      // The browser reports repeat=true: W has never been released by the user.
      await page.keyboard.down('w');
      const run = await page.evaluate(surf => driveTest.advance(surf, 20), surf);
      assert.equal(run.throttle, 1, 'held W survives cleared input: ' + JSON.stringify({ surf, start, debt, run }));
      assert.equal(run.brake, 0); assert.ok(run.min > 5 && run.speed > 20 && run.moved > 50, 'sustained forward movement');
      if (surf >= 3 && !debt) assert.ok(run.speed >= 60 && run.speed <= 80, 'settles at the off-road speed limit');
      await page.keyboard.up('w');
      assert.equal(await page.evaluate(() => DRIVE_KEYS.step(SIM.PHYS_DT).throttle), 0, 'release still releases throttle');
      checks++;
    }
    // A held brake must also resume, and must remain able to stop the car.
    await page.evaluate(() => driveTest.reset(80, 0));
    await page.keyboard.down('s'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.down('s');
    const stopped = await page.evaluate(() => driveTest.advance(3, 10));
    assert.equal(stopped.speed, 0); assert.equal(stopped.throttle, 0); assert.equal(stopped.brake, 1);
    await page.keyboard.up('s');
    // Repeat events never trigger a recovery, activate throttle in a paused game, or steal text input.
    await page.evaluate(() => { clearKeys(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', repeat: true })); });
    assert.ok(!await page.evaluate(() => PRESSED.KeyR));
    await page.evaluate(() => { G.paused = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true })); });
    assert.equal(await page.evaluate(() => DRIVE_KEYS.step(SIM.PHYS_DT).throttle), 0);
    await page.evaluate(() => { G.paused = false; document.getElementById('name').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true, bubbles: true })); });
    assert.equal(await page.evaluate(() => DRIVE_KEYS.step(SIM.PHYS_DT).throttle), 0);
    console.log(checks + ' held-W surface/speed/shortcut cases pass; braking, key release, pause, text input and recovery repeat checks pass.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
