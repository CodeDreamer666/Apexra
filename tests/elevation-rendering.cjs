const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { serveGame } = require('../tools/browser-game.cjs');

// Exercise the actual road/fence meshes, car materials and both camera rigs. In particular, profile-only tests
// cannot catch terrain cells bending a moving car or lifting a fence onto a neighbouring part of the circuit.
// THREE_JS may supply a local three@0.160.0 module; CHROMIUM_PATH may select the browser.
// CIRCUITS and ELEVATION_QUALITY may narrow a follow-up check; ELEVATION_SCREENSHOTS saves the actual views.
test('smooth hills, rigid cars and continuous fences on every circuit', { timeout: 600000 }, async () => {
  const server = await serveGame(path.join(__dirname, '..'), html => {
    if (process.env.BASELINE_HTML) html = fs.readFileSync(process.env.BASELINE_HTML, 'utf8');
    return html.replace('window.APEX = G;', `window.APEX = G;
      window.__elevation = { THREE, surfaceAt, trackLift, updateCarVisuals, setElevationCamera,
        render() { if (typeof cullCarModels === 'function') cullCarModels(camera); renderer.render(scene, camera); },
        shaders() { return renderer.info.programs.map(p => ({ vertex: p.vertexShader && renderer.getContext().getShaderSource(p.vertexShader) })); }
      };`);
  });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const ids = (process.env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
    for (const id of ids) {
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript(id => {
        localStorage.setItem('apexgp.settings.v1', JSON.stringify({ circuit: id, quality: 'low', resolution: 'native', volume: 0 }));
        const native = requestAnimationFrame;
        window.requestAnimationFrame = cb => /\bframe\(/.test(String(cb)) ? 1 : native(cb);
      }, id);
      await page.route('**/*', route => {
        const url = route.request().url();
        if (process.env.THREE_JS && url.includes('three.module')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) });
        if (url.includes('fonts.googleapis.com')) return route.fulfill({ contentType: 'text/css', body: '' });
        return route.continue();
      });
      await page.goto(server.url + '/index.html?quality=' + (process.env.ELEVATION_QUALITY || 'low'));
      await page.waitForFunction(() => document.querySelector('#loading.hidden'), null, { timeout: 120000 });
      const result = await page.evaluate(() => {
        const G = APEX, D = __elevation, t = G.track, DS = t.ds, car = G.session.cars[0], m = G.models.get(car);
        G.paused = true; G.focus = car;
        // Keep the actual visual-update path, without race traffic, damage, kerbs or intentional buffeting.
        for (const c of G.session.cars) if (c !== car) G.models.get(c).group.visible = false;
        G.session.cars = [car];
        let carDraws = 0;
        m.group.traverse(o => { if (o.isMesh) {
          const before = o.onBeforeRender;
          o.onBeforeRender = function (...args) { carDraws++; before.apply(this, args); };
        } });
        const r = { id: t.def.id, roadVertices: 0, fences: 0, panels: 0, roadError: 0, fenceError: 0, fenceTurn: 0,
          fenceBump: 0, surfaceError: 0, surfaceJump: 0, cameraJump: { chase: 0, cockpit: 0 }, cockpitEyeError: 0, rigidMaterials: 0, carDraws: 0, bridgeDraws: [], checks: 0 };
        // Every rendered road vertex must stay on its own measured profile, including on the bridge.
        const road = G.trackObj.objs.asphaltMesh.geometry.attributes.position;
        for (let i = 0; i <= t.N; i++) for (let k = 0; k <= 16; k++) {
          const q = i * 17 + k, h = road.getY(q) + t.elevAt(road.getX(q), road.getZ(q));
          r.roadError = Math.max(r.roadError, Math.abs(h - t.elev[i % t.N])); r.roadVertices++;
        }
        // Identify fence rows by their actual cross-section coordinates, independently of their vertex heights.
        const expected = new Map(), key = (x, z) => x.toFixed(2) + ',' + z.toFixed(2);
        for (let i = 0; i < t.N; i++) for (const d of [-t.wallL[i], t.wallR[i], t.pit.side * t.pit.trackWall]) {
          const off = d + Math.sign(d) * 0.45, x = t.cx[i] + t.rx[i] * off, z = t.cz[i] + t.rz[i] * off;
          // Store Float32-rounded coordinates just as a GPU position buffer does.
          expected.set(key(Math.fround(x), Math.fround(z)), t.elev[i]);
        }
        G.trackObj.group.traverse(o => {
          if (!o.isMesh || Array.isArray(o.material) || !(o.userData.kind === 'fence' || o.material.map?.image?.width === 128 && o.material.alphaTest === 0.35)) return;
          const p = o.geometry.attributes.position, idx = o.geometry.index, linked = new Set();
          for (let k = 0; k < idx.count; k += 6) linked.add(idx.getX(k) / 2);
          const row = q => [p.getX(q * 2), p.getY(q * 2) + t.elevAt(p.getX(q * 2), p.getZ(q * 2)), p.getZ(q * 2)];
          r.fences++;
          for (let q = 0; q < p.count / 2; q++) {
            const b = row(q), h = expected.get(key(b[0], b[2]));
            if (h == null) throw Error('Unrecognised fence cross-section at ' + b[0] + ',' + b[2]);
            r.fenceError = Math.max(r.fenceError, Math.abs(b[1] - 1.05 - h));
            if (q === 0 || !linked.has(q - 1) || !linked.has(q)) continue;
            const a = row(q - 1), c = row(q + 1);
            const u = [b[0] - a[0], b[2] - a[2]], v = [c[0] - b[0], c[2] - b[2]];
            const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
            r.fenceTurn = Math.max(r.fenceTurn, Math.acos(Math.max(-1, Math.min(1, cos))));
            r.fenceBump = Math.max(r.fenceBump, Math.abs(a[1] - 2 * b[1] + c[1])); r.panels++;
          }
        });
        const height = s => {
          const [x, z] = t.pointAt(s, 0); return D.surfaceAt(x, z, t.wrapI(Math.round(t.wrapS(s) / DS)));
        };
        // Walk the whole lap, probing either side of every nearest-sample transition. The old upper-road lift
        // changed by a whole sample's rise at these transitions, even though the measured profile was smooth.
        for (let i = 0; i < t.N; i++) {
          const s = (i + 0.5) * DS, a = height(s - 0.001), b = height(s + 0.001);
          r.surfaceJump = Math.max(r.surfaceJump, Math.abs(b - a));
          if (t.roadHeightAt) r.surfaceError = Math.max(r.surfaceError, Math.abs(height(s) - t.roadHeightAt(s)));
          r.checks++;
        }
        const pose = (s, mode) => {
          car.placeAt(t, s, 0, 30); car.gLong = car.gLat = 0; car.surf.fill(0);
          G.camRig.setMode(mode); D.updateCarVisuals(0);
          G.camRig.update(1 / 60, car, { model: m });
          D.setElevationCamera(G.camera.position.x, G.camera.position.z, car.idx);
          G.camera.updateMatrixWorld(true);
          if (mode === 'cockpit' && m.ground) {
            const eye = new D.THREE.Vector3(-0.16, 0.9, 0).applyMatrix4(m.group.matrixWorld);
            eye.y += m.ground.value - D.surfaceAt(G.camera.position.x, G.camera.position.z, car.idx);
            r.cockpitEyeError = Math.max(r.cockpitEyeError, eye.distanceTo(G.camera.position));
          }
          return G.camera.getWorldDirection(new D.THREE.Vector3());
        };
        for (const mode of ['chase', 'cockpit']) for (let i = 0; i < t.N; i += 2) {
          const s = (i + 0.5) * DS, a = pose(s - 0.001, mode), b = pose(s + 0.001, mode);
          r.cameraJump[mode] = Math.max(r.cameraJump[mode], a.distanceTo(b));
        }
        const renderPose = (s, mode) => {
          // A teleport needs one follow-up visual update for distance-based driver/wheel detail to settle.
          pose(s, mode); pose(s, mode); carDraws = 0; D.render(); return carDraws;
        };
        // Compile both views and their car materials in WebGL, rather than only checking the numerical model.
        let where = t.corners.find(c => /Raidillon|200R/.test(c.name))?.apex * DS || t.length * 0.6;
        if (t.def.id === 'suzuka') where = 4500;
        r.carDraws = renderPose(where, 'chase');
        r.rigidMaterials = D.shaders().filter(p => p.vertex?.includes('uniform float apexCarGround;')).length;
        renderPose(where, 'cockpit'); renderPose(where, 'chase');
        if (t.overpass) for (const s of [t.overpass.lowS, t.overpass.highS]) {
          r.bridgeDraws.push(renderPose(s, 'cockpit'));
        }
        renderPose(where, 'chase');
        window.__elevationPose = renderPose;
        document.querySelector('#menu').classList.add('hidden');
        return r;
      });
      console.log(JSON.stringify(result));
      if (process.env.ELEVATION_SCREENSHOTS) {
        fs.mkdirSync(process.env.ELEVATION_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.ELEVATION_SCREENSHOTS, id + '-hills.png') });
        if (id === 'suzuka') {
          for (const level of ['lowS', 'highS']) {
            await page.evaluate(level => __elevationPose(APEX.track.overpass[level], 'cockpit'), level);
            await page.screenshot({ path: path.join(process.env.ELEVATION_SCREENSHOTS, id + '-' + level + '-cockpit.png') });
          }
        }
      }
      await page.close();
      assert.equal(result.id, id);
      assert.ok(result.roadVertices > 30000 && result.panels > 1000, 'the full circuit was inspected');
      assert.ok(result.roadError < 0.001, id + ': road vertices differ from the smooth profile by ' + result.roadError + ' m');
      assert.ok(result.fenceError < 0.001, id + ': fence differs from its road profile by ' + result.fenceError + ' m');
      assert.ok(result.fenceTurn < 0.46, id + ': fence folds through ' + result.fenceTurn + ' radians');
      assert.ok(result.fenceBump < 0.2, id + ': vertical fence zigzag of ' + result.fenceBump + ' m');
      assert.ok(result.surfaceError < 0.001 && result.surfaceJump < 0.001, id + ': car height jumps: ' + JSON.stringify(result));
      for (const mode of ['chase', 'cockpit']) assert.ok(result.cameraJump[mode] < 0.002, id + ': ' + mode + ' camera jumps ' + result.cameraJump[mode]);
      assert.ok(result.cockpitEyeError < 1e-6, id + ': cockpit separates from the driver\'s eye on hills');
      assert.ok(result.rigidMaterials >= 4, id + ': rigid car shaders were compiled');
      assert.ok(result.carDraws > 10 && result.bridgeDraws.every(n => n > 10), id + ': the car body is rendered on hills and both bridge decks');
      assert.deepEqual(errors, [], id + ': browser/WebGL errors');
    }
  } finally { await browser.close(); await server.close(); }
});
