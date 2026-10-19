const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The starting graphics level a device gets (SIM.graphicsTier): 0 low, 1 medium, 2 high, from the GPU name WebGL
// reports, the CPU cores and memory, and whether float render targets (needed by post-processing) exist.
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sim = src.slice(src.indexOf('<script>') + 8, src.indexOf('// ==SIM-END=='));
const m = {}; new Function('module', sim + ';module.exports = SIM;')(m);
const SIM = m.exports;
const desktop = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0 };
const tier = (gpu, nav = {}, halfFloat = true) => SIM.graphicsTier({ gpu, halfFloat }, { ...desktop, ...nav }).tier;

test('dedicated and Apple GPUs start on high', () => {
  for (const g of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce GTX 1660/PCIe/SSE2',
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)', 'Apple M2', 'Apple GPU', 'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)'])
    assert.equal(tier(g), 2, g);
});

test('capable integrated GPUs start on medium; basic integrated, mobile and software rendering on low', () => {
  for (const g of ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11)', 'AMD Radeon 780M'])
    assert.equal(tier(g), 1, g);
  for (const g of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)', 'Intel(R) HD Graphics 4000', 'Mali-G57', 'Adreno (TM) 618', 'PowerVR Rogue GE8320',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver'])
    assert.equal(tier(g), 0, g);
  // a phone or tablet starts on low whatever its GPU (an iPad reports itself as a Mac with a touch screen)
  assert.equal(tier('Apple GPU', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' }), 0);
  assert.equal(tier('Apple GPU', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 0);
  assert.equal(tier('Adreno (TM) 740', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' }), 0);
  // a name the browser hides or the list does not know gets the middle level
  assert.equal(tier(''), 1); assert.equal(tier('WebKit WebGL'), 1);
});

test('few CPU cores, little memory or no float render targets cap the level', () => {
  const rtx = 'NVIDIA GeForce RTX 4070';
  assert.equal(tier(rtx, { hardwareConcurrency: 4 }), 1, '4 cores: medium at most');
  assert.equal(tier(rtx, { deviceMemory: 4 }), 1, '4 GB: medium at most');
  assert.equal(tier(rtx, { hardwareConcurrency: 2 }), 0, '2 cores: low');
  assert.equal(tier(rtx, { deviceMemory: 2 }), 0, '2 GB: low');
  assert.equal(tier(rtx, {}, false), 1, 'no float render targets: no post-processing, so medium at most');
  // unknown cores / memory (Firefox and Safari do not report deviceMemory) do not cap anything
  assert.equal(SIM.graphicsTier({ gpu: rtx, halfFloat: true }, { userAgent: desktop.userAgent }).tier, 2);
  assert.match(SIM.graphicsTier({ gpu: rtx, halfFloat: true }, { ...desktop, hardwareConcurrency: 2 }).why, /2 CPU cores/);
});

test('4K Ultra renders UHD on smaller, Retina and 4K displays', () => {
  for (const [w, h, dpr] of [[1920, 1080, 1], [1600, 900, 1], [1920, 1080, 2], [3840, 2160, 1]]) {
    const pr = SIM.renderPixelRatio(w, h, dpr, '4k');
    assert.equal(Math.round(w * pr), 3840);
    assert.equal(Math.round(h * pr), 2160);
  }
});

test('resolution preserves aspect ratio and respects GPU limits', () => {
  for (const [w, h] of [[3440, 1440], [1440, 900], [390, 844]]) {
    const pr = SIM.renderPixelRatio(w, h, 1, '4k');
    assert.ok(w * pr <= 3840 && h * pr <= 2160);
    assert.ok(Math.abs(w * pr - 3840) < .001 || Math.abs(h * pr - 2160) < .001);
    assert.ok(Math.abs((w * pr) / (h * pr) - w / h) < .000001);
  }
  assert.equal(SIM.renderPixelRatio(1920, 1080, 1, '4k', 2048), 2048 / 1920);
  assert.equal(SIM.renderPixelRatio(1920, 1080, 1, 'native', 1024), 1024 / 1920);
});

test('Native uses physical pixels on standard and high-density screens', () => {
  assert.equal(SIM.renderPixelRatio(1920, 1080, 1, 'native'), 1);
  assert.equal(SIM.renderPixelRatio(1440, 900, 2, 'native'), 2);
  assert.equal(SIM.renderPixelRatio(1280, 720, 1.25, 'native'), 1.25);
  assert.equal(SIM.renderPixelRatio(3840, 2160, 1, 'native'), 1);
});
