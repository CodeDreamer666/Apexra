const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Trackside recommended-speed signs: information only, derived from the game's own handling and the real corner
// geometry, placed beside the approach to every corner that needs real braking.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DS = SIM.DS;
const tracks = new Map(SIM.CIRCUITS.map(d => [d.id, new SIM.Track(d)]));

test('every circuit has signs: rounded values in km/h within a sensible range', () => {
  for (const [id, t] of tracks) {
    const signs = SIM.cornerSpeedSigns(t);
    assert.ok(signs.length >= 4 && signs.length <= 14, id + ': ' + signs.length + ' signs');
    for (const g of signs) {
      assert.equal(g.kmh % 5, 0, id + ' ' + g.name + ' rounded to 5 km/h');
      assert.ok(g.kmh >= 40 && g.kmh <= SIM.SIGN_REF.maxKmh, id + ' ' + g.name + ' ' + g.kmh);
    }
  }
});

test('the slow corners everyone brakes hard for are signed with a low speed', () => {
  const want = { monza: ['Variante del Rettifilo'], spa: ['La Source', 'Bus Stop'], suzuka: ['Hairpin'], bahrain: ['Turn 1'], interlagos: ['Senna S'], silverstone: ['The Loop'] };
  for (const [id, names] of Object.entries(want)) {
    const signs = SIM.cornerSpeedSigns(tracks.get(id));
    for (const n of names) {
      const g = signs.find(x => x.name === n);
      assert.ok(g, id + ': a sign for ' + n + ' (' + signs.map(x => x.name).join(', ') + ')');
      assert.ok(g.kmh <= 120, id + ' ' + n + ' at ' + g.kmh + ' km/h');
    }
  }
});

test('sign speeds are conservative: below what the handling can carry through the corner, but not absurdly low', () => {
  for (const [id, t] of tracks) for (const g of SIM.cornerSpeedSigns(t)) {
    const corners = t.corners.filter(x => g.corners.includes(x.num)), kap = t.aiLines.kap[0], N = t.N;
    let vMax = 1e9; // the full steering ceiling on the racing line through the corner (complex), fresh dry Hard tyres
    for (const c of corners) for (let q = 0, n = (c.end - c.start + N) % N; q <= n; q++) vMax = Math.min(vMax, SIM.arcadeCornerSpeed(kap[(c.start + q) % N], SIM.SIGN_REF.mu, 1));
    assert.ok(g.kmh <= vMax * 3.6, id + ' ' + g.name + ': sign ' + g.kmh + ' vs limit ' + (vMax * 3.6).toFixed(0));
    assert.ok(g.kmh >= vMax * 3.6 * 0.75, id + ' ' + g.name + ': sign ' + g.kmh + ' not far below the limit ' + (vMax * 3.6).toFixed(0));
  }
});

test('signs stand beside the approach, before the braking point, off the road and never on the pit lane side', () => {
  for (const [id, t] of tracks) {
    const N = t.N;
    for (const g of SIM.cornerSpeedSigns(t)) {
      const before = (g.brakeAt - g.i + N) % N;
      assert.ok(before * DS <= SIM.SIGN_REF.lead + 1, id + ' ' + g.name + ' sign ' + before * DS + ' m before braking');
      assert.ok(!(g.side === t.pitAt(g.s).side && t.pitProg(g.s) >= 0), id + ' ' + g.name + ' not on the pit lane side');
      assert.ok(g.side === 1 || g.side === -1);
    }
    // never two signs within 60 m of each other
    const s = SIM.cornerSpeedSigns(t).map(g => g.s).sort((a, b) => a - b);
    for (let k = 1; k < s.length; k++) assert.ok(s[k] - s[k - 1] >= 60, id + ' signs ' + s[k - 1] + ' and ' + s[k]);
  }
});

test('the signs are information only: no driving assistance reads them', () => {
  const sim = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const uses = sim.split('cornerSpeedSigns(').length - 1;
  // the definition and its export only; the renderer draws them (outside the simulation script)
  assert.ok(uses <= 2, 'the simulation never uses the signs: ' + uses);
});
