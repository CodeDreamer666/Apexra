const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

// The built 3D world of every circuit, checked against the circuit it dresses: nothing solid (barriers, fences,
// grandstands, crowd, boards, towers, the bridge, trees, buildings) stands on the road where a car simply drives
// through it, and no ground (terrain, the verge, gravel, paint, water) shows through the road surface. Faces are
// checked as the renderer draws them: every vertex lifted by the circuit's height field, planar in between.
//
// The game loads Three.js from a CDN. Without network access set THREE_JS=/path/to/three.module.js (three@0.160.0);
// if Three.js cannot be loaded at all the test is skipped. CHROMIUM_PATH can select a browser.
const ROOT = path.join(__dirname, '..');
const { serveGame } = require('../tools/browser-game.cjs');
let gameURL;
const CIRCUITS = (process.env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
const FOREST = function () {
  const G = APEX, t = G.track, f = G.forest, cell = 40, ground = new Map();
  if (!f || f.stats.trees < 100) throw Error('Missing procedural forest');
  // Independently intersect the rendered terrain/verge triangles under every tree root.
  G.world.traverse(o => {
    if (!['terrain', 'verge'].includes(o.userData.kind)) return;
    const p = o.geometry.attributes.position, idx = o.geometry.index, a = [];
    for (let k = 0; k < p.count; k++) a.push([p.getX(k), p.getY(k) + t.elevAt(p.getX(k), p.getZ(k)), p.getZ(k)]);
    for (let k = 0; k < idx.count; k += 3) {
      const [A, B, C] = [a[idx.getX(k)], a[idx.getX(k + 1)], a[idx.getX(k + 2)]];
      const den = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
      if (Math.abs(den) < 1e-9) continue;
      const tri = [A, B, C, den];
      for (let x = Math.floor(Math.min(A[0], B[0], C[0]) / cell); x <= Math.floor(Math.max(A[0], B[0], C[0]) / cell); x++) {
        for (let z = Math.floor(Math.min(A[2], B[2], C[2]) / cell); z <= Math.floor(Math.max(A[2], B[2], C[2]) / cell); z++) {
          const key = x + ',' + z; if (!ground.has(key)) ground.set(key, []); ground.get(key).push(tri);
        }
      }
    }
  });
  let roots = 0, worst = -Infinity, deepest = Infinity;
  for (const c of f.cells) for (const o of c.levels[0].children) {
    for (let k = 0; k < o.count; k++) {
      const m = o.instanceMatrix.array, x = m[k * 16 + 12], z = m[k * 16 + 14], h = m[k * 16 + 13] + t.elevAt(x, z);
      let floor = -Infinity;
      for (const [A, B, C, den] of ground.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []) {
        const u = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / den;
        const v = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / den, w = 1 - u - v;
        if (u >= -1e-5 && v >= -1e-5 && w >= -1e-5) floor = Math.max(floor, u * A[1] + v * B[1] + w * C[1]);
      }
      if (!Number.isFinite(floor)) throw Error('No ground under tree at ' + x + ',' + z);
      const gap = h - floor; worst = Math.max(worst, gap); deepest = Math.min(deepest, gap); roots++;
      if (gap > .01 || gap < -.3) throw Error('Floating/buried tree root: ' + gap.toFixed(3) + ' m at ' + x + ',' + z);
    }
  }
  // Exercise the actual visibility controller without rendering: distance hysteresis and immutable buffers.
  const camera = G.camera, saved = camera.clone(), c = f.cells.find(c => c.treeCount > 3) || f.cells[0];
  f.update(camera, 0); const y = c.sphere.center.y;
  const ids = c.levels.flatMap(g => g.children.map(o => o.geometry.uuid));
  const check = (d, expected) => {
    camera.position.set(c.x - d - 72 * .71, y, c.z); camera.lookAt(c.x, y, c.z); f.update(camera, 0);
    const mask = f.lodData[c.maskIndex];
    if (c.lod !== expected || c.levels.filter(g => g.visible).length !== 1 || (expected === 2 ? mask !== 1 || c.node.visible : mask !== 0 || !c.node.visible)) throw Error('LOD hysteresis/mask at ' + d + ' m');
  };
  check(25, 0); check(40, 0); check(55, 1); check(40, 1); check(30, 0);
  check(80, 1); check(130, 1); check(155, 2); check(130, 2); check(110, 1);
  if (JSON.stringify(ids) !== JSON.stringify(c.levels.flatMap(g => g.children.map(o => o.geometry.uuid)))) throw Error('LOD allocated geometry');
  for (const c of f.cells) {
    if (c.node.visible && f.lodData[c.maskIndex]) throw Error('Near trees and distant silhouettes overlap');
    if (c.trees || c.bushes || c.rocks || c.tufts) throw Error('Generation descriptors retained during racing');
    for (const o of c.levels[1].children) if (o.castShadow) throw Error('Middle foliage casts shadows');
  }
  for (const b of f.farChunks) for (const o of b.node.children) if (o.castShadow) throw Error('Distant foliage casts shadows');
  const version = f.lodTexture.version; f.update(camera, 0);
  if (f.lodTexture.version !== version) throw Error('Stable camera reuploaded forest mask');
  camera.copy(saved); f.update(camera, 0);
  return { ...f.stats, rootsChecked: roots, rootGap: [deepest, worst] };
};
const DETECT = function () {
  const G = APEX, t = G.track, N = t.N, DS = t.ds;
  const hfE = (x, z) => t.elevAt(x, z);
  const op = t.overpass, upper = (i) => { if (!op) return false; let d = Math.abs(i * DS - op.highS); d = Math.min(d, t.length - d); return d < op.ramp; };
  // road cross-sections covering (x, z): [{i, h}] (rendered road height), margin m inside the white line
  const { cell, grid } = t.spatial;
  const roadAt = (x, z, margin) => {
    const out = []; const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get((gx + dx + 1000) * 100000 + (gz + dz + 1000)); if (!arr) continue;
      for (const j of arr) {
        const ex = x - t.cx[j], ez = z - t.cz[j], al = ex * t.tx[j] + ez * t.tz[j]; if (Math.abs(al) > DS * 0.5 + 0.01) continue;
        const d = ex * t.rx[j] + ez * t.rz[j]; if (Math.abs(d) > t.hw[j] - margin) continue;
        out.push({ i: j, h: upper(j) ? t.elev[j] : hfE(x, z), d });
      }
    }
    return out;
  };
  const issues = [];
  const v = new APEX.THREE_Vector3(), m4 = new APEX.THREE_Matrix4(), mw = new APEX.THREE_Matrix4();
  // road sample points for surface checks
  const pts = []; for (let i = 0; i < N; i++) for (let d = -t.hw[i] + 0.6; d <= t.hw[i] - 0.6; d += 1.0) { const x = t.cx[i] + t.rx[i] * d, z = t.cz[i] + t.rz[i] * d; pts.push([x, z, upper(i) ? t.elev[i] : hfE(x, z), i, d]); }
  const PC = 8, pgrid = new Map(); pts.forEach((p, k) => { const key = Math.floor(p[0] / PC) * 100000 + Math.floor(p[1] / PC); if (!pgrid.has(key)) pgrid.set(key, []); pgrid.get(key).push(k); });
  const meshes = []; G.scene.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position && o.visible !== false) meshes.push(o); });
  const carMeshes = new Set(); for (const m of G.models.values()) m.group.traverse(o => carMeshes.add(o));
  const flatKinds = new Set(['terrain', 'verge', 'gravel', 'paint', 'water', 'kerb']);
  const describe = (o) => (o.userData.kind || o.material?.type + '#' + (o.material?.color ? o.material.color.getHexString() : '') + (o.material?.map ? '+map' : '')) + (o.isInstancedMesh ? '[inst]' : '') + ':' + o.geometry.type;
  for (const o of meshes) {
    if (carMeshes.has(o) || o.frustumCulled === false && !o.userData.kind) continue; // cars and fx pools
    const kind = o.userData.kind; if (kind === 'road' || kind === 'marking') continue;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position, idx = o.geometry.index, nI = o.isInstancedMesh ? o.count : 1;
    const tri = idx ? idx.count / 3 : pos.count / 3;
    for (let inst = 0; inst < nI; inst++) {
      mw.copy(o.matrixWorld); if (o.isInstancedMesh) { o.getMatrixAt(inst, m4); mw.multiply(m4); }
      const W = new Float32Array(pos.count * 3); let maxY = -1e9;
      for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(mw); W[k * 3] = v.x; W[k * 3 + 1] = v.y; W[k * 3 + 2] = v.z; maxY = Math.max(maxY, v.y); }
      if (kind && kind.startsWith('forest')) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < pos.count; k++) { x0 = Math.min(x0, W[k*3]); x1 = Math.max(x1, W[k*3]); z0 = Math.min(z0, W[k*3+2]); z1 = Math.max(z1, W[k*3+2]); }
        let nearRoad = false;
        for (let gx = Math.floor((x0-10)/cell); gx <= Math.floor((x1+10)/cell); gx++) for (let gz = Math.floor((z0-10)/cell); gz <= Math.floor((z1+10)/cell); gz++) {
          const arr = grid.get((gx+1000)*100000+(gz+1000)); if (!arr) continue;
          for (const j of arr) if (t.cx[j]+t.hw[j]>=x0 && t.cx[j]-t.hw[j]<=x1 && t.cz[j]+t.hw[j]>=z0 && t.cz[j]-t.hw[j]<=z1) { nearRoad=true;break; }
        }
        if (!nearRoad) continue;
      }
      const flat = flatKinds.has(kind);
      if (!flat && !kind && maxY < 0.06) continue; // untagged flat markings
      let hits = 0, worst = null;
      for (let f = 0; f < tri; f++) {
        const a = idx ? idx.getX(f * 3) : f * 3, b = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, c = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
        const ax = W[a * 3], ay = W[a * 3 + 1], az = W[a * 3 + 2], bx = W[b * 3], by = W[b * 3 + 1], bz = W[b * 3 + 2], cx = W[c * 3], cy = W[c * 3 + 1], cz = W[c * 3 + 2];
        if (flat) {
          // road points under this triangle: is the surface (warped) above the road there?
          const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
          if (x1 - x0 > 400 || z1 - z0 > 400) continue;
          const ha = ay + hfE(ax, az), hb = by + hfE(bx, bz), hc = cy + hfE(cx, cz);
          const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(den) < 1e-9) continue;
          for (let gx = Math.floor(x0 / PC); gx <= Math.floor(x1 / PC); gx++) for (let gz = Math.floor(z0 / PC); gz <= Math.floor(z1 / PC); gz++) {
            const arr = pgrid.get(gx * 100000 + gz); if (!arr) continue;
            for (const k of arr) {
              const [px, pz, ph, pi, pd] = pts[k];
              const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l3 = 1 - l1 - l2;
              if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
              const h = l1 * ha + l2 * hb + l3 * hc;
              // within 1.2 m of the road at that point (a surface far below or above is another level)
              if (h > ph - 0.012 && h < ph + 1.2) { hits++; if (!worst || h - ph > worst.dh) worst = { dh: h - ph, s: pi * DS, d: pd }; }
            }
          }
        } else {
          // sample the face; any point on the road between 0.3 m below and 4 m above its surface is in the way
          const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2, n = Math.min(12, Math.ceil(Math.sqrt(area) / 1.5));
          for (let p = 0; p <= n; p++) for (let q = 0; q <= n - p; q++) {
            const u = n ? p / n : 1 / 3, w = n ? q / n : 1 / 3, x = ax + (bx - ax) * u + (cx - ax) * w, y = ay + (by - ay) * u + (cy - ay) * w, z = az + (bz - az) * u + (cz - az) * w;
            const Ha = ay + hfE(ax, az), h = Ha + (by + hfE(bx, bz) - Ha) * u + (cy + hfE(cx, cz) - Ha) * w; // the shader lifts vertices, faces are planar between them
            for (const r of roadAt(x, z, 0.25)) if (h > r.h - 0.3 && h < r.h + 4) { hits++; if (!worst || Math.abs(r.d) < Math.abs(worst.d)) worst = { s: r.i * DS, d: r.d, y: h - r.h }; }
          }
        }
      }
      if (hits) issues.push({ what: describe(o) + (o.isInstancedMesh ? ' #' + inst : ''), hits, ...worst });
    }
  }
  return issues;
};

async function scan(browser, id) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page.setDefaultTimeout(900000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript((id) => {
    localStorage.setItem('apexgp.settings.v1', JSON.stringify({ quality: 'high', camera: 'chase', volume: 0, circuit: id }));
    // the render loop only runs when asked
    const nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { if (!/\bframe\(/.test(String(cb))) return nativeRaf(cb); (window.__rafq = window.__rafq || []).push(cb); return 1; };
  }, id);
  await page.route('**/*', r => {
    if (process.env.THREE_JS && r.request().url().includes('three.module')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) });
    if (r.request().url().includes('fonts.googleapis.com')) return r.fulfill({ contentType: 'text/css', body: '' });
    return r.continue();
  });
  await page.goto(gameURL + '/index.html');
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, { polling: 300 });
  if (await page.evaluate(() => !document.getElementById('loadErr').classList.contains('hidden'))) { await page.close(); return null; }
  assert.equal(await page.evaluate(() => APEX.track.def.id), id, 'the attract race shows the chosen circuit');
  await page.evaluate(() => { let V, M; APEX.scene.traverse(o => { if (!V && o.position && o.position.isVector3) V = o.position.constructor; if (!M && o.matrixWorld) M = o.matrixWorld.constructor; }); APEX.THREE_Vector3 = V; APEX.THREE_Matrix4 = M; });
  const issues = await page.evaluate(DETECT);
  const forest = await page.evaluate(FOREST);
  console.log(id + ': ' + JSON.stringify(forest));
  assert.deepEqual(errors, [], 'no page errors');
  await page.close();
  return issues;
}

test('no scenery stands on the road and no ground shows through it, on every circuit', async (t) => {
  const server = await serveGame(ROOT); gameURL = server.url;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const id of CIRCUITS) {
      const issues = await scan(browser, id);
      if (issues === null) { t.skip('Three.js could not be loaded (set THREE_JS to a local three.module.js)'); return; }
      const lines = issues.slice(0, 12).map(q => q.what + ' x' + q.hits + ' at s=' + Math.round(q.s) + ' m, ' + q.d.toFixed(1) + ' m from the centre line' + (q.dh != null ? ', ' + q.dh.toFixed(2) + ' m above the road' : ''));
      assert.equal(issues.length, 0, id + ':\n  ' + lines.join('\n  '));
    }
  } finally { await browser.close(); await server.close(); }
});
