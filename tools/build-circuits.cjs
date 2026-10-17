#!/usr/bin/env node
// Builds the six real circuits' embedded data (the CIRCUIT_DATA block in index.html) from measured sources:
//
//   centre lines and widths  TUM FTM racetrack-database (LGPL-3.0, https://github.com/TUMFTM/racetrack-database):
//                            OpenStreetMap GPS centre lines (smoothed, 5 m spacing) with track widths to the left and
//                            right extracted from satellite images.
//   georeference             bacinger/f1-circuits (MIT, https://github.com/bacinger/f1-circuits): WGS84 centre lines,
//                            used to place the TUM lines (which are in local metres) on the globe by a rigid
//                            (rotation + translation, no scaling) iterative-closest-point fit. The fit residual is
//                            printed: it is the independent agreement between the two traces.
//   elevation                SRTM 1-arc-second (~30 m) DEM tiles, as served by the AWS Terrain Tiles open dataset
//                            (Mapzen "skadi" format, https://registry.opendata.aws/terrain-tiles/; SRTM is public
//                            domain, NASA/USGS). SRTM is a surface model (it includes tree canopy and buildings), so
//                            the profile along the track is median-filtered and smoothed.
//
//   node tools/build-circuits.cjs [--cache DIR] [--write]
//
// Downloads (about 210 MB of DEM tiles) go to the cache directory (default tools/.circuit-cache). Without --write it
// only prints the measurements; with --write it replaces the block between the CIRCUIT-DATA markers in index.html.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const args = process.argv.slice(2);
const CACHE = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : path.join(__dirname, '.circuit-cache');
const WRITE = args.includes('--write');
fs.mkdirSync(CACHE, { recursive: true });
const TUM = 'https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/';
const BAC = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';
const SKADI = 'https://s3.amazonaws.com/elevation-tiles-prod/skadi/';

function fetchCached(url, file) {
  const p = path.join(CACHE, file);
  if (!fs.existsSync(p)) { console.error('fetch ' + url); execFileSync('curl', ['-sS', '-f', '-m', '300', '-o', p, url]); }
  return p;
}

// Per circuit: the TUM and bacinger ids, the start/finish line (metres along the TUM line from its first point), the
// published lap length, and the overpass (Suzuka). The start/finish positions are estimates read off the corner layout
// (see the report in the README): the published lines are not part of either dataset.
const CIRCUITS = [
  { id: 'monza', tum: 'Monza', bac: 'it-1922', length: 5793, startS: 315, smooth: 24 },
  { id: 'silverstone', tum: 'Silverstone', bac: 'gb-1948', length: 5891, startS: 90, smooth: 20 },
  { id: 'spa', tum: 'Spa', bac: 'be-1925', length: 7004, startS: 140, smooth: 6 },
  // Suzuka's figure of eight: the back straight (Spoon to 130R) crosses over the Degner-to-Hairpin section
  { id: 'suzuka', tum: 'Suzuka', bac: 'jp-1962', length: 5807, startS: 235, smooth: 10, bridge: { clearance: 7.5, ramp: 170 } },
  { id: 'bahrain', tum: 'Sakhir', bac: 'bh-2002', length: 5412, startS: 170, smooth: 16 },
  { id: 'interlagos', tum: 'SaoPaulo', bac: 'br-1940', length: 4309, startS: 30, smooth: 6 },
];

// ---------------- DEM ----------------
const tiles = new Map();
function tileName(lat, lon) {
  const la = Math.floor(lat), lo = Math.floor(lon);
  return (la >= 0 ? 'N' : 'S') + String(Math.abs(la)).padStart(2, '0') + (lo >= 0 ? 'E' : 'W') + String(Math.abs(lo)).padStart(3, '0');
}
function tile(lat, lon) {
  const name = tileName(lat, lon);
  if (!tiles.has(name)) {
    const gz = fetchCached(SKADI + name.slice(0, 3) + '/' + name + '.hgt.gz', name + '.hgt.gz');
    const buf = zlib.gunzipSync(fs.readFileSync(gz)); const n = Math.round(Math.sqrt(buf.length / 2));
    const a = new Float32Array(n * n); for (let k = 0; k < n * n; k++) a[k] = buf.readInt16BE(2 * k);
    // fill voids (-32768) from neighbours
    for (let pass = 0; pass < 20; pass++) { let left = 0; for (let k = 0; k < n * n; k++) if (a[k] < -1000) { let s = 0, c = 0; for (const o of [-1, 1, -n, n]) { const v = a[k + o]; if (v > -1000) { s += v; c++; } } if (c) a[k] = s / c; else left++; } if (!left) break; }
    tiles.set(name, { a, n, la: Math.floor(lat), lo: Math.floor(lon) });
  }
  return tiles.get(name);
}
function dem(lat, lon) {
  const t = tile(lat, lon), n = t.n - 1;
  const r = (t.la + 1 - lat) * n, c = (lon - t.lo) * n, r0 = Math.min(n - 1, Math.floor(r)), c0 = Math.min(n - 1, Math.floor(c)), fr = r - r0, fc = c - c0;
  const A = (i, j) => t.a[i * t.n + j];
  return A(r0, c0) * (1 - fr) * (1 - fc) + A(r0 + 1, c0) * fr * (1 - fc) + A(r0, c0 + 1) * (1 - fr) * fc + A(r0 + 1, c0 + 1) * fr * fc;
}

// ---------------- geometry helpers ----------------
const wrap = (i, n) => ((i % n) + n) % n;
function closedLen(P) { let L = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
function densify(P, step) {
  const out = [];
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], m = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let j = 0; j < m; j++) out.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]); }
  return out;
}
function nearestIdx(G, x, y) { let bi = 0, bd = Infinity; for (let i = 0; i < G.length; i++) { const d = (G[i][0] - x) ** 2 + (G[i][1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return [bi, Math.sqrt(bd)]; }
// rigid ICP of P (local metres) onto G (metres in a local tangent plane): returns rotated/translated P and residuals
function icp(P, G) {
  const mean = (A) => A.reduce((s, p) => [s[0] + p[0] / A.length, s[1] + p[1] / A.length], [0, 0]);
  const mp = mean(P); let T = [mean(G)[0] - mp[0], mean(G)[1] - mp[1]], ang = 0;
  const apply = (p) => { const c = Math.cos(ang), s = Math.sin(ang), x = p[0] - mp[0], y = p[1] - mp[1]; return [c * x - s * y + mp[0] + T[0], s * x + c * y + mp[1] + T[1]]; };
  for (let it = 0; it < 40; it++) {
    const Q = P.map(apply), C = Q.map(q => G[nearestIdx(G, q[0], q[1])[0]]);
    const mc = mean(C); let sxx = 0, sxy = 0, syx = 0, syy = 0;
    for (let k = 0; k < P.length; k++) { const ax = P[k][0] - mp[0], ay = P[k][1] - mp[1], cx = C[k][0] - mc[0], cy = C[k][1] - mc[1]; sxx += ax * cx; sxy += ax * cy; syx += ay * cx; syy += ay * cy; }
    ang = Math.atan2(sxy - syx, sxx + syy); T = [mc[0] - mp[0], mc[1] - mp[1]];
  }
  const Q = P.map(apply), res = Q.map(q => nearestIdx(G, q[0], q[1])[1]).sort((a, b) => a - b);
  return { Q, ang, mean: res.reduce((a, b) => a + b, 0) / res.length, p95: res[Math.floor(res.length * 0.95)], max: res[res.length - 1] };
}
function median(a) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
function smoothClosed(arr, rad, passes) { let a = arr.slice(); const n = a.length; for (let p = 0; p < passes; p++) { const o = new Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = -rad; k <= rad; k++) s += a[wrap(i + k, n)]; o[i] = s / (2 * rad + 1); } a = o; } return a; }
function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

// ---------------- encoding ----------------
const b64 = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const i16 = (vals) => { const a = new Int16Array(vals.length); vals.forEach((v, k) => { a[k] = Math.max(-32768, Math.min(32767, Math.round(v))); }); return b64(a); };
const u8 = (vals) => b64(Uint8Array.from(vals.map(v => Math.max(0, Math.min(255, Math.round(v))))));

// ---------------- build ----------------
const geo = JSON.parse(fs.readFileSync(fetchCached(BAC, 'f1-circuits.geojson'), 'utf8'));
const out = {}, report = [];
for (const C of CIRCUITS) {
  const csv = fs.readFileSync(fetchCached(TUM + C.tum + '.csv', C.tum + '.csv'), 'utf8').split('\n').filter(l => l && l[0] !== '#').map(l => l.split(',').map(Number));
  const P = csv.map(r => [r[0], r[1]]), WR = csv.map(r => r[2]), WL = csv.map(r => r[3]), n = P.length;
  const f = geo.features.find(q => q.properties.id === C.bac).geometry.coordinates.slice(0, -1);
  const lat0 = f.reduce((s, p) => s + p[1], 0) / f.length, lon0 = f.reduce((s, p) => s + p[0], 0) / f.length;
  const KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110574;
  const fit = icp(P, densify(f.map(p => [(p[0] - lon0) * KX, (p[1] - lat0) * KY]), 2));
  // re-centre between the measured edges and take the mean half width (TUM's smoothed line is not mid-track)
  const Q = fit.Q, hw = [];
  const tang = (i) => { const a = Q[wrap(i - 1, n)], b = Q[wrap(i + 1, n)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const shift = smoothClosed(WR.map((r, i) => (r - WL[i]) / 2), 4, 3), wsm = smoothClosed(WR.map((r, i) => r + WL[i]), 6, 3);
  const C2 = Q.map((q, i) => { const [tx, ty] = tang(i); return [q[0] + ty * shift[i], q[1] - tx * shift[i]]; }); // right of travel in a y-north frame is (ty, -tx)
  for (let i = 0; i < n; i++) hw.push(wsm[i] / 2);
  // elevation: DEM along the line, a 45 m running median (canopy and buildings), then a smoothing whose length suits
  // the circuit: on the flat parkland and desert circuits the DEM's 1-3 m canopy/structure noise is larger than the
  // real relief over a few hundred metres, so it is smoothed over ~100-120 m; the hilly circuits keep ~30-50 m.
  const latlon = C2.map(q => [q[1] / KY + lat0, q[0] / KX + lon0]);
  const raw = latlon.map(([la, lo]) => dem(la, lo));
  let el = raw.map((_, i) => { const w = []; for (let k = -4; k <= 4; k++) w.push(raw[wrap(i + k, n)]); return median(w); });
  el = smoothClosed(el, C.smooth, 3);
  // overpass: separate the two levels where the line crosses itself
  let bridge = null;
  if (C.bridge) {
    for (let i = 0; i < n && !bridge; i++) for (let j = i + 20; j < n; j++) {
      if (n - (j - i) < 20) continue;
      const hit = segIntersect(C2[i], C2[(i + 1) % n], C2[j], C2[(j + 1) % n]); if (!hit) continue;
      bridge = { lowS: (i + hit[0]) * 5, highS: (j + hit[1]) * 5 }; break;
    }
    const L = n * 5, { clearance, ramp } = C.bridge, ia = bridge.lowS / 5, ib = bridge.highS / 5;
    const natLow = el[Math.round(ia) % n], natHigh = el[Math.round(ib) % n], need = clearance - (natHigh - natLow);
    // the lower road dips into a cutting and the upper one rises onto the bridge, sharing the extra height
    const bump = (s0, amp) => (s) => { let d = Math.abs(s - s0); d = Math.min(d, L - d); return d < ramp ? amp * 0.5 * (1 + Math.cos(Math.PI * d / ramp)) : 0; };
    const dn = bump(bridge.lowS, -need * 0.45), up = bump(bridge.highS, need * 0.55);
    el = el.map((e, i) => e + dn(i * 5) + up(i * 5));
    bridge.natural = natHigh - natLow; bridge.lift = need;
  }
  // rotate so index 0 is on the start/finish line; local frame x east, z south (the game's), origin at the bbox centre
  const s0 = Math.round(C.startS / 5), rot = (a) => a.slice(s0).concat(a.slice(0, s0));
  const xs = C2.map(q => q[0]), ys = C2.map(q => q[1]);
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2, oy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const line = rot(C2).map(q => [q[0] - ox, -(q[1] - oy)]), hwR = rot(hw), elR = rot(el), rawR = rot(raw);
  const toGeo = (x, z) => [(-z + oy) / KY + lat0, (x + ox) / KX + lon0];
  // terrain grids: near (±3 km, 100 m) and far (±10 km, 400 m), 3x3-mean filtered DEM
  const grid = (half, step) => {
    const nn = Math.round(2 * half / step) + 1, vals = [];
    for (let j = 0; j < nn; j++) for (let k = 0; k < nn; k++) {
      const x = -half + k * step, z = -half + j * step; let s = 0;
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) { const [la, lo] = toGeo(x + dx * step / 3, z + dz * step / 3); s += dem(la, lo); }
      vals.push(s / 9);
    }
    return { half, step, n: nn, data: i16(vals.map(v => v * 4)) }; // quarter metres
  };
  // delta-encoded centre line in centimetres (first point absolute)
  const cm = line.map(p => [Math.round(p[0] * 100), Math.round(p[1] * 100)]), del = [];
  cm.forEach((p, k) => { if (k === 0) return; del.push(p[0] - cm[k - 1][0], p[1] - cm[k - 1][1]); });
  const rawLen = closedLen(line);
  let maxG = 0, maxGAt = 0; for (let i = 0; i < n; i++) { const g = Math.abs(elR[(i + 1) % n] - elR[wrap(i - 1, n)]) / 10; if (g > maxG) { maxG = g; maxGAt = i * 5; } }
  if (process.env.PROFILE === C.id) console.log(elR.map((e, i) => (i * 5) + ' ' + e.toFixed(1) + ' ' + rawR[i].toFixed(1)).join('\n'));
  out[C.id] = {
    origin: [+toGeo(0, 0)[0].toFixed(6), +toGeo(0, 0)[1].toFixed(6)], step: 5, n,
    start: [cm[0][0] / 100, cm[0][1] / 100], line: i16(del),
    width: u8(hwR.map(h => h * 20)),            // half width, 5 cm units
    elevBase: +Math.min(...elR).toFixed(2), elev: i16(elR.map(e => (e - Math.min(...elR)) * 100)), // centimetres above elevBase (m above sea level)
    near: grid(3000, 100), far: grid(10000, 400),
    bridge: bridge ? { lowS: +wrap(bridge.lowS - s0 * 5, n * 5).toFixed(1), highS: +wrap(bridge.highS - s0 * 5, n * 5).toFixed(1), ramp: C.bridge.ramp } : null,
  };
  const minE = Math.min(...elR), maxE = Math.max(...elR);
  report.push({ id: C.id, points: n, tumLength: +rawLen.toFixed(1), published: C.length, scale: +(C.length / rawLen).toFixed(5), fitMean: +fit.mean.toFixed(2), fitP95: +fit.p95.toFixed(2), fitMax: +fit.max.toFixed(2), rotDeg: +(fit.ang * 180 / Math.PI).toFixed(2),
    width: [+(2 * Math.min(...hw)).toFixed(1), +(2 * hw.reduce((a, b) => a + b, 0) / n).toFixed(1), +(2 * Math.max(...hw)).toFixed(1)], elev: [+minE.toFixed(1), +maxE.toFixed(1), +(maxE - minE).toFixed(1)], rawDemRange: +(Math.max(...rawR) - Math.min(...rawR)).toFixed(1), maxGradePct: +(maxG * 100).toFixed(1), maxGradeAt: maxGAt, bridge });
}
console.log(JSON.stringify(report, null, 1));
if (WRITE) {
  const file = path.join(__dirname, '..', 'index.html'); let html = fs.readFileSync(file, 'utf8');
  const a = '/* ==CIRCUIT-DATA== */', b = '/* ==CIRCUIT-DATA-END== */', i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('CIRCUIT-DATA markers not found');
  const body = '\n  // Generated by tools/build-circuits.cjs — do not edit by hand. Sources and licences: see the tool and the README.\n  const CIRCUIT_DATA = ' + JSON.stringify(out) + ';\n  ';
  html = html.slice(0, i + a.length) + body + html.slice(j);
  fs.writeFileSync(file, html); console.error('wrote CIRCUIT_DATA (' + body.length + ' bytes)');
}
