const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports;
test('slow cars, spins, debris and retirements never create a yellow flag', () => {
  const t = new SIM.Track(SIM.CIRCUITS[0]);
  const s = new SIM.Session(t, { type: 'race', seed: 3, entries: SIM.DRIVERS.slice(0, 3).map((driver, i) => ({ driver, isPlayer: i === 0 })) });
  s.lightsOut = true; s.lightsOutTime = 0; s.time = 50;
  const [p, slow, spun] = s.cars;
  for (const [i, c] of s.cars.entries()) { c.placeAt(t, 600 + i * 20, 0, 0); c.speed = 0; }
  spun.spun = true;
  s.addDebris(p.x, p.z, 'tyre', 8, p, true);
  s.debrisUpdate(); s.slowUpdate();
  slow.retiring = { phase: 'stopping', reason: 'Accident damage' };
  s.parkCar(slow); s.slowUpdate();
  assert.equal(s.yellow, undefined); assert.equal(s.yellowAt, undefined); assert.equal(s.flagState, undefined);
  assert.ok(!s.messages.some(m => /yellow flag/i.test(m.text)));
  assert.ok(s.debris.length, 'debris remains physical');
  assert.ok(slow.dnf, 'a damaged car can still retire');
  assert.ok(!s.over, 'other cars keep racing');
});
test('the HUD, minimap, marshal lights and AI have no yellow-flag hooks', () => {
  assert.doesNotMatch(html, /(?:this|sess|race)\.yellow(?:At|\b)|flagbar|flagState|--ic-flag|YELLOW FLAG|yellow flag/i);
  assert.match(html, /CHEQUERED FLAG/, 'race finishes still take the chequered flag');
});
