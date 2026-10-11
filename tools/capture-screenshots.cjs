#!/usr/bin/env node
// Captures every screen the driver sees, from the loading screen to the race results, for UI review.
//
//   node tools/capture-screenshots.cjs [outDir] [--only=name,name] [--circuits=summit,rivermere,redridge]
//
// The game runs in headless Chromium (Playwright). Its render loop is driven frame by frame from here, so
// the capture is deterministic and works with software WebGL. The race is played by the game's own AI
// driving the player's car through the player's handling (the same way tests/vsc.cjs drives a "human"), and
// situations such as the Virtual Safety Car, a pit stop or a crash are staged through the game's own
// session API, so every panel is shown in its real state.
//
// Three.js is fetched from the CDN as usual. If the CDN is blocked, set THREE_JS=/path/to/three.module.js
// (for example from `npm pack three@0.160.0`) and it is served locally instead.
const path = require('node:path');
const fs = require('node:fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const OUT = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ROOT, 'screenshots'));
const opt = (k) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1].split(',') : null; };
const ONLY = opt('only');
const CIRCUITS = opt('circuits') || ['summit', 'rivermere', 'redridge'];
const W = 1600, HT = 900;
fs.mkdirSync(OUT, { recursive: true });
const index = [];

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: W, height: HT } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  // the render loop runs only when we ask for frames
  await page.addInitScript(() => {
    localStorage.setItem('apexgp.settings.v1', JSON.stringify({ quality: 'high', camera: 'chase', engineerVoice: 'off', volume: 0 }));
    // only the game's render loop is held; other callbacks (including Playwright's own) run natively
    const nativeRaf = window.requestAnimationFrame.bind(window);
    window.__t = 0; window.requestAnimationFrame = cb => { if (!/\bframe\(/.test(String(cb))) return nativeRaf(cb); (window.__rafq = window.__rafq || []).push(cb); return 1; };
    window.__frames = (n, dt = 1000 / 30) => { for (let i = 0; i < n; i++) { const q = window.__rafq || []; window.__rafq = []; window.__t += dt; for (const cb of q) cb(window.__t); } };
  });
  let releaseThree; const threeGate = new Promise(r => { releaseThree = r; });
  await page.route(/three(@0\.160\.0)?\/.*three\.module(\.min)?\.js$/, async (route) => {
    await threeGate; // hold the engine back so the loading screen can be captured
    if (process.env.THREE_JS) route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) });
    else route.continue();
  });

  let n = 0;
  async function shot(name, desc) {
    n++;
    const file = String(n).padStart(3, '0') + '-' + name + '.jpg';
    if (!ONLY || ONLY.some(o => name.includes(o))) {
      await page.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 82 });
      index.push({ file, desc }); console.log('  ' + file + ' — ' + desc);
    }
  }
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const frames = (k = 4, ts) => ev(([k, ts]) => { if (ts != null && APEX.session) APEX.timeScale = ts; __frames(k); }, [k, ts]);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------- loading ----------
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => document.getElementById('loadSt').textContent.length > 0, null, { polling: 200 });
  await shot('loading', 'Loading screen while the 3D engine downloads');
  releaseThree();
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden'), null, { polling: 300, timeout: 600000 });

  // helpers inside the page: fast-forward the simulation, drive the player's car with the game's AI, stage events
  await ev(() => {
    const H = window.__H = {};
    H.trim = (s) => { s.events = s.events.filter(e => !['collision', 'wall', 'impact', 'detach', 'debris', 'puncture', 'failure'].includes(e.type)); };
    // run the simulation for up to `sec` seconds (or until `cond`), without rendering
    H.ff = (sec, cond) => { const s = APEX.session, n = Math.round(sec / SIM.PHYS_DT); for (let i = 0; i < n; i++) { if (cond && cond(s)) return true; s.fixedStep(SIM.PHYS_DT); H.trim(s); if (s.over && s.type === 'race' && !s.finishedFlag) break; } return cond ? cond(s) : true; };
    H.bot = () => {
      const p = APEX.player, s = APEX.session; if (!p) return;
      const ai = new SIM.AIDriver(p, s, { pitOnly: true }), human = p.control;
      p.control = (dt, sess) => {
        if (!sess.lightsOut || !H.botOn) return human(dt, sess);
        if (p.autoDrive || p.pit) return;
        ai.decide(dt, sess.step); p.playerHandling.step(p, dt, sess, { ...ai.cmd });
      };
      H.botOn = true;
    };
    H.snap = () => { APEX.camRig.init = false; };
    H.cam = (m) => { APEX.camRig.setMode(m); APEX.camRig.init = false; };
    // stage a crash like tests/vsc.cjs: the car is put next to its barrier and aimed into it
    H.crash = (car, v = 60, yaw = 0.5) => {
      const S = APEX.session, t = S.track, w = t.walls(car.idx, car.s, false, { l: 0, r: 0, innerPit: 0 }), side = car.d >= 0 ? 1 : -1;
      car.placeAt(t, car.s, side * ((side > 0 ? w.r : w.l) - 3.2), 0);
      car.psi += yaw * side; car.vx = Math.cos(car.psi) * v; car.vz = Math.sin(car.psi) * v; car.r = 0;
    };
    H.ahead = (k = 1) => { const S = APEX.session, o = S.order || S.cars, i = o.indexOf(APEX.player); return o[Math.max(0, i - k)]; };
    H.dry = () => { const w = APEX.session.weather; if (!w) return; Object.assign(w, { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 }); };
    H.rain = () => { const w = APEX.session.weather; if (!w) return; Object.assign(w, { pattern: 'wet', regime: 'heavy', rain: 0.85, water: 0.7, lineWater: 0.6, cloud: 1, targetCloud: 1, targetRain: 0.85, patternEnds: 1e9, regimeEnds: 1e9 }); };
    H.hideMsgs = () => { document.getElementById('msgs').replaceChildren(); };
  });
  const H = (code, arg) => ev(new Function('a', 'const H=window.__H, G=APEX, S=G.session, p=G.player; return (' + code + ');'), arg);
  const settle = async (k = 6, ts = 0.02) => { await H('H.snap()'); await frames(k, ts); };

  // ---------- menus ----------
  await frames(8, 1);
  await shot('menu-main', 'Main menu over the attract-mode race');
  await page.click('#menu [data-act="settings"]'); await frames(2);
  await shot('menu-race-settings', 'Race settings');
  await page.click('[data-act="settingsClose"]'); await frames(1);
  await page.click('#menu [data-act="controls"]'); await frames(2);
  await shot('menu-controls', 'Controls reference');
  await page.click('[data-act="controlsClose"]'); await frames(1);
  await page.click('#menu [data-act="play"]'); await frames(3);
  await shot('menu-circuit-select', 'Circuit selection');

  // ---------- one weekend per circuit ----------
  for (let ci = 0; ci < CIRCUITS.length; ci++) {
    const id = CIRCUITS[ci], full = ci === 0, tag = (s) => id + '-' + s;
    console.log('Circuit: ' + id);
    if (ci > 0) { await page.click('#menu [data-act="play"]'); await frames(2); }
    await ev((id) => { const k = SIM.CIRCUITS.findIndex(c => c.id === id); document.getElementById('csCards').children[k].click(); }, id);
    await frames(2);
    if (!full) await shot(tag('circuit-select'), 'Circuit selection: ' + id);
    await page.click('#csGo');
    await page.waitForFunction(() => APEX.session && APEX.session.type === 'quali' && document.getElementById('loading').classList.contains('hidden'), null, { polling: 300, timeout: 600000 });
    await H('H.dry()');

    // ---------- qualifying ----------
    await settle(10);
    await shot(tag('quali-garage'), 'Qualifying: waiting in the pit lane (W to leave)');
    if (full) {
      await H('S.releaseFromGarage(p), H.bot()'); await H('H.ff(6)'); await settle(8, 1);
      await shot(tag('quali-outlap'), 'Qualifying: untimed out-lap');
      await H('H.ff(400, s => p.q.phase === "flying")'); await H('H.ff(20)'); await settle(8, 1);
      await shot(tag('quali-flying'), 'Qualifying: flying lap with sector times');
      await H('H.ff(30)'); await frames(1); await page.keyboard.press('Escape'); await frames(2);
      await shot(tag('pause-quali'), 'Pause menu during qualifying (with forfeit option)');
      await page.click('#btnSkipQ'); await frames(1);
    } else {
      await ev(() => { const p = APEX.player; APEX.session.completeQuali(p, 'skipped', 'Attempt forfeited'); });
    }
    await H('H.ff(900, s => s.over)'); await frames(2, 1); await wait(1200); await frames(2);
    await page.waitForFunction(() => !document.getElementById('results').classList.contains('hidden'), null, { polling: 300, timeout: 20000 }).catch(() => ev(() => { /* fall back */ }));
    await shot(tag('quali-results'), 'Qualifying results');
    await page.click('#resActions .btn.primary'); await frames(2);
    await shot(tag('race-brief'), 'Race start brief: starting tyre and fuel');
    await page.click('#briefStart');
    await page.waitForFunction(() => APEX.session && APEX.session.type === 'race', null, { polling: 300 });
    await H('H.dry(), H.bot()');

    // ---------- grid and start ----------
    await settle(10, 1);
    await shot(tag('grid'), 'On the grid before the start sequence');
    await ev(() => window.__setKey('KeyW', true));
    for (const L of full ? [1, 3, 5] : [5]) {
      await H('H.ff(20, s => s.lights >= a)', L); await frames(3, 0.02);
      await shot(tag('lights-' + L), L + ' red light' + (L > 1 ? 's' : '') + ', launch control armed (holding W)');
    }
    await H('H.ff(10, s => s.lightsOut)'); await frames(6, 1);
    await shot(tag('lights-out'), 'Lights out and away we go');
    await ev(() => window.__setKey('KeyW', false));
    await H('H.ff(40)'); await settle(8, 1);
    await shot(tag('race-chase'), 'Racing, chase camera');
    if (full) {
      for (const [m, d] of [['far', 'far chase camera'], ['cockpit', 'cockpit camera'], ['tcam', 'T-cam']]) {
        await H('H.cam(a)', m); await frames(8, 1); await shot(tag('race-' + m), 'Racing, ' + d);
      }
      await H('H.cam("chase")');
      await ev(() => window.__setKey('KeyB', true)); await frames(6, 1); await shot(tag('race-lookback'), 'Look back (B)'); await ev(() => window.__setKey('KeyB', false));
      await page.keyboard.press('Tab'); await frames(3, 1); await shot(tag('race-full-board'), 'Full leaderboard (Tab)');
      await page.keyboard.press('KeyI'); await frames(3, 1); await shot(tag('race-full-board-interval'), 'Full leaderboard, interval gaps (I)');
      await page.keyboard.press('KeyI'); await page.keyboard.press('Tab');
      await page.keyboard.press('KeyT'); await frames(30, 1); await shot(tag('race-telemetry'), 'Telemetry overlay (T)'); await page.keyboard.press('KeyT');
      await page.keyboard.press('KeyV'); await frames(3, 1); await shot(tag('race-strategy'), 'Tyres & pits strategy panel (V)'); await page.keyboard.press('KeyV');
      // DRS
      const drs = await H('H.ff(240, s => p.drsAvail)');
      if (drs) { await frames(4, 1); await shot(tag('race-drs-available'), 'DRS available in an activation zone'); await page.keyboard.press('KeyG'); await frames(8, 1); await shot(tag('race-drs-open'), 'DRS open'); }
      // engineer radio
      await H('H.ff(400, s => document.getElementById("engineerRadio").getAttribute("aria-hidden")==="false" || (G.radio.update(), false))');
      await frames(3, 1);
      if (await ev(() => document.getElementById('engineerRadio').getAttribute('aria-hidden') === 'false')) await shot(tag('race-engineer-radio'), 'Race engineer radio message');
    }

    // ---------- pit stop ----------
    await H('H.ff(1)'); await frames(1, 1);
    await page.keyboard.press('KeyP'); await frames(3, 1);
    await shot(tag('pit-requested'), 'Pit stop requested: BOX THIS LAP');
    await H('H.ff(400, s => p.pit && p.pit.phase === "approach")'); await H('H.ff(200, s => p.pit && G.track.dS(p.s, G.track.pit.entry0) < 150)'); await settle(8, 1);
    await shot(tag('pit-approach'), 'Pit approach: autopilot takes the car to the pit entry');
    await H('H.ff(60, s => p.pit && p.pit.phase !== "approach")'); await H('H.ff(1.5)'); await settle(8, 1);
    await shot(tag('pit-lane'), 'In the pit lane, limiter on, driving to the box');
    if (full) { await H('H.cam("cockpit")'); await frames(6, 1); await shot(tag('pit-lane-cockpit'), 'Pit lane from the cockpit'); await H('H.cam("chase")'); }
    await H('H.ff(60, s => p.pit && p.pit.phase === "awaiting")'); await settle(10, 0.02);
    await shot(tag('pit-box-select'), 'Stopped in the box: choose tyres and fuel');
    await page.click('#psTyres button[data-c="S"]').catch(() => {}); await ev(() => { const f = document.getElementById('psFuel'); f.value = String(Math.min(+f.max, 6)); f.oninput(); }); await frames(3, 0.02);
    await shot(tag('pit-box-selected'), 'Service chosen (softs + fuel) before confirming');
    if (full) { await H('H.cam("cockpit")'); await frames(6, 0.02); await shot(tag('pit-box-cockpit'), 'Pit box selection from the cockpit'); await H('H.cam("chase")'); }
    await page.click('#psConfirm'); await H('H.ff(1.2)'); await settle(8, 1);
    await shot(tag('pit-servicing'), 'Pit crew servicing the car');
    if (full) { await H('H.ff(2)'); await H('H.cam("tcam")'); await frames(6, 1); await shot(tag('pit-servicing-tcam'), 'Servicing, T-cam'); await H('H.cam("chase")'); }
    await H('H.ff(30, s => p.pit && (p.pit.phase === "release" || p.pit.phase === "out"))'); await settle(6, 1);
    await shot(tag('pit-release'), 'Service complete: release / leaving the box');
    await H('H.ff(60, s => !p.pit)'); await H('H.ff(0.5)'); await settle(8, 1);
    await shot(tag('pit-exit'), 'Pit exit: control returns, stop summary');

    // ---------- Virtual Safety Car ----------
    await H('H.ff(15)');
    const vsc = await H(`(() => { const S=APEX.session; if (!S.vscCanDeploy()) return 'cannot';
      const v = H.ahead(1); if (!v || v === p) return 'no car'; H.crash(v, 70, 0.6);
      return H.ff(8, s => s.vscActive) ? 'ok' : (S.vscDeploy('crash', [{ car: v }]), 'forced'); })()`);
    console.log('  VSC:', vsc);
    await settle(10, 1);
    await shot(tag('vsc-deployed'), 'Virtual Safety Car deployed (' + vsc + ')');
    await H('H.ff(3.5)'); await settle(8, 1);
    await shot(tag('vsc-active'), 'VSC running: race control drives the car in the queue');
    if (full) { await H('H.cam("cockpit")'); await frames(6, 1); await shot(tag('vsc-cockpit'), 'VSC from the cockpit'); await H('H.cam("chase")'); }
    await H('H.ff(30, s => s.vsc.phase === "ending")'); await H('H.ff(1.5)'); await settle(6, 1);
    await shot(tag('vsc-ending'), 'VSC ending: five-second countdown');
    await H('H.ff(10, s => s.vsc.phase === "green")'); await H('H.ff(0.3)'); await settle(6, 1);
    await shot(tag('vsc-green'), 'Green flag after the VSC');

    if (full) {
      // ---------- flags ----------
      await H('H.ff(10)');
      await H('(() => { const S = APEX.session, k = Math.floor(p.idx / S.track.N * S.track.marshalCount); S.yellow[k] = 8; S.yellow[(k + 1) % S.track.marshalCount] = 8; })()'); await H('H.ff(0.05)'); await settle(6, 1);
      await shot(tag('flag-yellow'), 'Yellow flag in the sector');
      const blue = await H(`(() => { const S = APEX.session, t = S.track, o = (S.order || S.cars).find(c => c !== p && !c.pit && !c.dnf && !c.inGarage);
        if (!o) return false; o.placeAt(t, t.wrapS(p.s - 45), p.d > 0 ? -2 : 2, Math.max(p.speed, 30) + 12); o.totalDist = p.totalDist + t.length - 45; o.laps = p.laps + 1;
        return H.ff(4, s => !!p.blueFlag.target); })()`);
      await settle(4, 1); await shot(tag('flag-blue'), 'Blue flag: a lapping car behind' + (blue ? '' : ' (not triggered)'));
      await H('H.ff(8)');
      // ---------- damage, respawn ----------
      await H('H.crash(p, 55, 0.45)'); await frames(10, 1);
      await shot(tag('damage-impact'), 'Player crash into the barrier: impact effects');
      await H('H.ff(2)'); await settle(6, 1);
      await shot(tag('damage-status'), 'Vehicle status after the crash');
      await page.keyboard.press('KeyR'); await H('H.bot()'); await frames(10, 1);
      await shot(tag('respawn'), 'Car respawned on track (R)');
      // ---------- rain ----------
      await H('H.rain()'); await H('H.ff(3)'); await H('G.nextRoadWeather=0'); await settle(20, 1);
      await shot(tag('rain-chase'), 'Racing in heavy rain, chase camera');
      await H('H.cam("cockpit")'); await frames(10, 1); await shot(tag('rain-cockpit'), 'Racing in heavy rain, cockpit'); await H('H.cam("chase")');
      await H('H.dry()'); await H('H.ff(2)');
      // ---------- pause ----------
      await page.keyboard.press('Escape'); await frames(2);
      await shot(tag('pause-race'), 'Pause menu during the race');
      await page.keyboard.press('Escape'); await frames(1);
      // ---------- final lap, chequered flag ----------
      await H('(S.totalLaps = p.laps + 2, H.hideMsgs())');
      await H('H.ff(400, s => p.laps >= s.totalLaps - 1)'); await H('H.ff(0.4)'); await settle(6, 1);
      await shot(tag('final-lap'), 'Final lap');
      await H('H.ff(400, s => s.finishedFlag)'); await H('H.ff(400, s => p.finished)'); await H('H.ff(0.5)'); await settle(6, 1);
      await shot(tag('chequered-flag'), 'Chequered flag');
    } else {
      await H('S.totalLaps = p.laps + 1');
      await H('H.ff(400, s => p.finished)');
    }
    await H('H.ff(600, s => s.over)'); await frames(2, 1); await wait(1600); await frames(2, 1);
    await page.waitForFunction(() => !document.getElementById('results').classList.contains('hidden'), null, { polling: 300, timeout: 20000 }).catch(() => {});
    await shot(tag('race-results'), 'Race results');

    if (full) {
      // ---------- retired, watching the race ----------
      await page.click('#resActions .btn'); await frames(2);
      await page.click('#menu [data-act="play"]'); await frames(2);
      await ev((id) => { const k = SIM.CIRCUITS.findIndex(c => c.id === id); document.getElementById('csCards').children[k].click(); }, id);
      await page.evaluate(() => { document.getElementById('csGo').click(); });
      await page.waitForFunction(() => APEX.session && !document.getElementById('raceBrief').classList.contains('hidden') || (APEX.session && APEX.session.type === 'quali'), null, { polling: 300 });
      if (await ev(() => !document.getElementById('raceBrief').classList.contains('hidden'))) await page.click('#briefStart');
      else { await ev(() => APEX.session.completeQuali(APEX.player, 'skipped', '')); await H('H.ff(900, s => s.over)'); await wait(1200); await frames(2); await page.click('#resActions .btn.primary'); await frames(1); await page.click('#briefStart'); }
      await page.waitForFunction(() => APEX.session && APEX.session.type === 'race', null, { polling: 300 });
      await H('H.dry(), H.bot()'); await H('H.ff(30, s => s.lightsOut)'); await H('H.ff(30)');
      await H('(p.dnfReason = "Damage", S.retire(p))'); await H('H.ff(2)'); await frames(4, 1); await H('H.ff(1)'); await settle(8, 1);
      await shot(tag('retired-spectating'), 'Retired: watching the race (←/→ change car)');
      await page.keyboard.press('Escape'); await frames(1); await page.click('#pause [data-act="exit"]'); await frames(2);
    } else {
      await page.click('#resActions .btn'); await frames(2);
    }
  }

  // ---------- index ----------
  const md = ['# Screenshots', '', 'Captured with `node tools/capture-screenshots.cjs` at ' + W + "×" + HT + '.', ''];
  for (const s of index) md.push('### ' + s.file.replace(/\.jpg$/, ''), '', s.desc, '', '![' + s.desc + '](' + s.file + ')', '');
  fs.writeFileSync(path.join(OUT, 'README.md'), md.join('\n'));
  console.log('Wrote ' + index.length + ' screenshots to ' + OUT);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
