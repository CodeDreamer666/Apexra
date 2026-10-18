const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

// The built 3D world of every circuit, checked against the circuit it dresses: nothing solid (barriers, fences,
// grandstands, crowd, boards, towers, the bridge, trees, buildings) stands on the road where a car simply drives
// through it, and no ground (terrain, the verge, gravel, paint, water) shows through the road surface or the pit lane. Faces are
// checked as the renderer draws them: every vertex lifted by the circuit's height field, planar in between.
//
// The game loads Three.js from a CDN. Without network access set THREE_JS=/path/to/three.module.js (three@0.160.0);
// if Three.js cannot be loaded at all the test is skipped. CHROMIUM_PATH can select a browser.
const ROOT = path.join(__dirname, '..');
const CIRCUITS = (process.env.CIRCUITS || 'monza,silverstone,spa,suzuka,bahrain,interlagos').split(',');
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
  // and the pit lane, entry ramp to exit ramp: the driven lanes and the boxes (no ground may show through it either)
  const P = t.pit;
  if (P) for (let q = 0; q <= P.len; q += 1.0) {
    const s = t.wrapS(P.entry0 + q), i = t.wrapI(Math.round(s / DS)), lane = t.pitTargetD(s, null) * P.side;
    const a0 = t.inPitMain(s) ? P.fastD - 1.6 : lane - 1.5, a1 = t.inPitMain(s) ? P.boxD + 1.4 : lane + 1.5;
    for (let a = Math.max(a0, t.hw[i] + 0.6); a <= a1; a += 1.0) {
      const d = P.side * a, x = t.cx[i] + t.rx[i] * d, z = t.cz[i] + t.rz[i] * d; pts.push([x, z, hfE(x, z), i, d]);
    }
  }
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
  if (process.env.THREE_JS) await page.route(/three(@0\.160\.0)?\/.*three\.module(\.min)?\.js$/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.THREE_JS) }));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('hidden') || !document.getElementById('loadErr').classList.contains('hidden'), null, { polling: 300 });
  if (await page.evaluate(() => !document.getElementById('loadErr').classList.contains('hidden'))) { await page.close(); return null; }
  assert.equal(await page.evaluate(() => APEX.track.def.id), id, 'the attract race shows the chosen circuit');
  await page.evaluate(() => { let V, M; APEX.scene.traverse(o => { if (!V && o.position && o.position.isVector3) V = o.position.constructor; if (!M && o.matrixWorld) M = o.matrixWorld.constructor; }); APEX.THREE_Vector3 = V; APEX.THREE_Matrix4 = M; });
  const issues = await page.evaluate(DETECT);
  assert.deepEqual(errors, [], 'no page errors');
  await page.close();
  return issues;
}

test('no scenery stands on the road and no ground shows through it, on every circuit', async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const id of CIRCUITS) {
      const issues = await scan(browser, id);
      if (issues === null) { t.skip('Three.js could not be loaded (set THREE_JS to a local three.module.js)'); return; }
      const lines = issues.slice(0, 12).map(q => q.what + ' x' + q.hits + ' at s=' + Math.round(q.s) + ' m, ' + q.d.toFixed(1) + ' m from the centre line' + (q.dh != null ? ', ' + q.dh.toFixed(2) + ' m above the road' : ''));
      assert.equal(issues.length, 0, id + ':\n  ' + lines.join('\n  '));
    }
  } finally { await browser.close(); }
});
