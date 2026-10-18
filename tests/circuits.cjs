const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The six real circuits, built and raced through the game's own Track, Session and AI.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(context.module); // (not vm.runInNewContext: a separate context runs the simulation about five times slower)
const SIM = context.module.exports;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
// published lap lengths (m), countries, the direction of racing seen from above with north up, and the elevation
// range the measured profile must show (m; published figures, with a tolerance for the DEM)
const SPEC = {
  monza: { name: 'Autodromo Nazionale Monza', country: 'Italy', length: 5793, cw: true, range: [8, 20] },
  silverstone: { name: 'Silverstone Circuit', country: 'United Kingdom', length: 5891, cw: true, range: [8, 18] },
  spa: { name: 'Circuit de Spa-Francorchamps', country: 'Belgium', length: 7004, cw: true, range: [90, 115] },
  suzuka: { name: 'Suzuka International Racing Course', country: 'Japan', length: 5807, cw: null, range: [35, 50] },
  bahrain: { name: 'Bahrain International Circuit', country: 'Bahrain', length: 5412, cw: true, range: [12, 25] },
  interlagos: { name: 'Autódromo José Carlos Pace (Interlagos)', country: 'Brazil', length: 4309, cw: false, range: [36, 50] },
};
// the signature corners in racing order (each must be a detected corner, in this order round the lap)
const ORDER = {
  monza: ['Variante del Rettifilo', 'Curva Biassono', 'Variante della Roggia', 'Lesmo 1', 'Lesmo 2', 'Variante Ascari', 'Curva Alboreto (Parabolica)'],
  silverstone: ['Abbey', 'Farm Curve', 'Village', 'The Loop', 'Aintree', 'Brooklands', 'Luffield', 'Woodcote', 'Copse', 'Maggotts', 'Becketts', 'Chapel', 'Stowe', 'Vale', 'Club'],
  spa: ['La Source', 'Eau Rouge', 'Raidillon', 'Les Combes', 'Malmedy', 'Bruxelles (Rivage)', 'No Name', 'Pouhon', 'Fagnes', 'Stavelot', 'Blanchimont', 'Bus Stop'],
  suzuka: ['First Curve', 'Second Curve', 'S Curves', 'Dunlop Curve', 'Degner 1', 'Degner 2', 'Hairpin', '200R', 'Spoon Curve', '130R', 'Casio Triangle', 'Final Curve'],
  bahrain: ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5', 'Turn 6', 'Turn 7', 'Turn 8', 'Turn 9', 'Turn 10', 'Turn 11', 'Turn 12', 'Turn 13', 'Turn 14', 'Turn 15'],
  interlagos: ['Senna S', 'Curva do Sol', 'Descida do Lago', 'Ferradura', 'Laranjinha', 'Pinheirinho', 'Bico de Pato', 'Mergulho', 'Junção', 'Subida dos Boxes', 'Arquibancadas'],
};

test('six real circuits with their published lap lengths replace the fictional ones', () => {
  assert.equal(SIM.CIRCUITS.map(c => c.id).join(), 'monza,silverstone,spa,suzuka,bahrain,interlagos');
  for (const [id, t] of tracks) {
    const sp = SPEC[id];
    assert.equal(t.def.name, sp.name); assert.equal(t.def.country, sp.country); assert.equal(t.def.length, sp.length);
    assert.ok(Math.abs(t.length - sp.length) <= 2, id + ' length ' + t.length);
  }
  assert.ok(!SIM.CIRCUITS.some(c => /Summit|Rivermere|Redridge/.test(c.name)), 'no fictional circuit is playable');
  // race distances differ as the real laps do (a six-lap Grand Prix at Spa is the longest, at Interlagos the shortest)
  const gp = (id) => tracks.get(id).length * SIM.GAME_MODES.grandprix.laps;
  assert.ok(gp('spa') > gp('silverstone') && gp('interlagos') < gp('bahrain'));
  assert.ok(Math.abs(gp('spa') - 42024) < 15 && Math.abs(gp('interlagos') - 25854) < 15);
});

test('every circuit passes the geometry checks: no overlaps at the same level, barriers clear of the road, drivable corners', () => {
  for (const t of tracks.values()) {
    const v = t.validate();
    assert.ok(v.ok, t.name + ': ' + v.issues.join('; '));
    assert.ok(v.minR >= 12, t.name + ' radius ' + v.minR.toFixed(1));
    // measured widths (with the 10 m floor), between 10 and 20 m
    for (let i = 0; i < t.N; i++) assert.ok(t.hw[i] >= 5 && t.hw[i] <= 10, t.name + ' half width ' + t.hw[i]);
  }
});

test('racing direction: clockwise except Interlagos (anticlockwise); Suzuka is a figure of eight', () => {
  for (const [id, t] of tracks) {
    // shoelace area with north up (z points south)
    let a = 0; for (let i = 0; i < t.N; i++) { const j = (i + 1) % t.N; a += t.cx[i] * -t.cz[j] - t.cx[j] * -t.cz[i]; }
    if (SPEC[id].cw === true) assert.ok(a < 0, id + ' runs clockwise');
    if (SPEC[id].cw === false) assert.ok(a > 0, id + ' runs anticlockwise');
  }
  const s = tracks.get('suzuka'); assert.ok(s.overpass, 'Suzuka crosses itself');
  for (const id of ['monza', 'silverstone', 'spa', 'bahrain', 'interlagos']) assert.equal(tracks.get(id).overpass, null, id + ' has no crossing');
});

test('the signature corners come in the real order from the start/finish line', () => {
  for (const [id, names] of Object.entries(ORDER)) {
    const t = tracks.get(id); let last = -1;
    for (const n of names) {
      const c = t.corners.find(k => k.name === n && k.apex > last);
      assert.ok(c, id + ': ' + n + ' after s=' + last * 2);
      last = c.apex;
    }
  }
  // the start/finish straights: Monza's long run to the first chicane and Spa's short run to La Source
  const first = (id) => tracks.get(id).corners[0].apex * 2;
  assert.ok(first('monza') > 500 && first('monza') < 750, 'Monza first chicane at ' + first('monza'));
  assert.ok(first('spa') > 180 && first('spa') < 330, 'La Source at ' + first('spa'));
});

test('measured elevation: realistic ranges, smooth, Eau Rouge climbs and Interlagos rises to the line', () => {
  for (const [id, t] of tracks) {
    const range = t.elevMax - t.elevMin, [lo, hi] = SPEC[id].range;
    assert.ok(range >= lo && range <= hi, id + ' elevation range ' + range.toFixed(1));
    // no steps or bumps: the slope changes gently (a vertical curve no tighter than ~100 m radius)
    for (let i = 0; i < t.N; i++) {
      const d2 = t.elev[(i + 1) % t.N] - 2 * t.elev[i] + t.elev[(i - 1 + t.N) % t.N];
      assert.ok(Math.abs(d2) / 4 < 1 / 100, id + ' vertical curvature at s=' + i * 2 + ': ' + d2.toFixed(3));
    }
    assert.ok(Math.max(...t.grade.map(Math.abs)) < 0.2, id + ' gradient');
  }
  const spa = tracks.get('spa'), at = (t, s) => t.elev[t.wrapI(Math.round(s / 2))];
  const eau = spa.corners.find(c => c.name === 'Eau Rouge').apex * 2, top = spa.corners.find(c => c.name === 'Les Combes').start * 2;
  assert.ok(at(spa, eau + 350) - at(spa, eau - 50) > 25, 'Raidillon climbs');
  assert.ok(at(spa, top) - at(spa, eau) > 50, 'Kemmel rises to Les Combes');
  const il = tracks.get('interlagos'), j = il.corners.find(c => c.name === 'Junção').apex * 2;
  assert.ok(at(il, il.length - 10) - at(il, j) > 25, 'the uphill run from Junção to the line');
});

test('Suzuka overpass: the two levels stay physically separate', () => {
  const t = tracks.get('suzuka'), op = t.overpass, lo = t.wrapI(Math.round(op.lowS / 2)), hi = t.wrapI(Math.round(op.highS / 2));
  assert.ok(Math.hypot(t.cx[lo] - t.cx[hi], t.cz[lo] - t.cz[hi]) < 3, 'the lines cross');
  assert.ok(t.elev[hi] - t.elev[lo] >= 7, 'clearance ' + (t.elev[hi] - t.elev[lo]).toFixed(2));
  assert.ok(t.levelApart(lo, hi));
  // the land under the crossing is the lower road's; just beyond it the upper road's
  assert.ok(Math.abs(t.elevAt(t.cx[lo], t.cz[lo]) - t.elev[lo]) < 0.3);
  const away = t.wrapI(hi + 40); assert.ok(Math.abs(t.elevAt(t.cx[away], t.cz[away]) - t.elev[away]) < 0.3);
  // a car is projected onto the level it is driving, never jumping to the other one
  for (const [i0, other] of [[lo, hi], [hi, lo]]) {
    const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, {}); car.placeAt(t, t.wrapS((i0 - 30) * 2), 0, 50);
    for (let k = 0; k < 60; k++) {
      car.x += t.tx[car.idx] * 2; car.z += t.tz[car.idx] * 2; t.project(car.x, car.z, car.idx, car.proj); car.idx = car.proj.i;
      assert.ok(Math.abs(t.dS(car.idx * 2, other * 2)) > 400, 'stays on its level');
    }
  }
  // two cars at the crossing, one on each level, never collide
  const S = new SIM.Session(t, { type: 'race', laps: 2, entries: SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), seed: 1, spectate: true, weather: 'dry' });
  const [a, b] = S.cars; a.placeAt(t, op.lowS, 0, 0); b.placeAt(t, op.highS, 0, 0);
  let hits = 0; const on = S.onCollision.bind(S); S.onCollision = (...x) => { hits++; return on(...x); };
  for (let k = 0; k < 40; k++) { a.x = t.cx[lo]; a.z = t.cz[lo]; b.x = t.cx[hi]; b.z = t.cz[hi]; a.idx = lo; b.idx = hi; S.fixedStep(SIM.PHYS_DT); }
  assert.equal(hits, 0, 'no contact between levels');
  // the bridge has barriers close to the road on both levels
  for (const i of [lo, hi]) assert.ok(t.wallL[i] < t.hw[i] + 4.5 && t.wallR[i] < t.hw[i] + 4.5, 'bridge walls');
});

test('start grid, pit lane, timing and minimap data come from each circuit', () => {
  for (const t of tracks.values()) {
    assert.equal(t.gridSlots.length, 24);
    for (const g of t.gridSlots.slice(0, 20)) { const i = t.wrapI(Math.round(g.s / SIM.DS)); assert.ok(Math.abs(t.kappa[i]) < 1 / 500, t.name + ' grid on the straight'); }
    for (let q = 0; q <= t.pit.len; q += 10) { const s = t.wrapS(t.pit.entry0 + q), i = t.wrapI(Math.round(s / SIM.DS)); assert.ok(Math.abs(t.kappa[i]) < (t.def.id === 'interlagos' ? 1 / 240 : 1 / 450), t.name + ' pit lane bend at ' + s); assert.ok(Math.abs(t.grade[i]) < 0.09, t.name + ' pit lane slope ' + t.grade[i].toFixed(3)); } // (Spa's straight to La Source runs downhill; Interlagos's pit straight curves, about 250 m radius at the tightest)
    // the lane leaves and rejoins the racing line on the main straight, before the first corner
    assert.ok(t.dS(t.pit.exit1, t.corners[0].start * 2) > 20, t.name + ' pit exit before turn 1');
    assert.equal(t.pit.side, t.def.pit.side, t.name + ' pit lane on the real side');
    assert.equal(t.pit.boxes.length, SIM.TEAMS.length, 'one box per team');
    assert.ok(t.sector1 > 0 && t.sector2 > t.sector1 && t.sector2 < t.length);
    const line = SIM.circuitCentreLine(t.def);
    assert.equal(line.length, t.N);
    for (let i = 0; i < t.N; i += 97) { assert.ok(Math.abs(line[i][0] - t.cx[i]) < 1e-9 && Math.abs(line[i][1] - t.cz[i]) < 1e-9); }
  }
  assert.equal(tracks.get('interlagos').pit.side, -1, 'Interlagos pits on the left (the inside of an anticlockwise lap)');
});

test('the road surface is continuous: the renderer height field follows the measured profile', () => {
  for (const [id, t] of tracks) {
    const op = t.overpass; let worst = 0;
    for (let i = 0; i < t.N; i++) {
      assert.ok(Math.abs(t.elev[(i + 1) % t.N] - t.elev[i]) < 0.5, id + ' step in the road at s=' + i * 2);
      if (op) { let d = Math.abs(i * 2 - op.highS); d = Math.min(d, t.length - d); if (d < op.ramp + 20) continue; }
      for (const f of [-0.9, 0, 0.9]) { const x = t.cx[i] + t.rx[i] * f * t.hw[i], z = t.cz[i] + t.rz[i] * f * t.hw[i]; worst = Math.max(worst, Math.abs(t.elevAt(x, z) - t.elev[i])); }
    }
    assert.ok(worst < 0.25, id + ' height field off the road profile by ' + worst.toFixed(3));
  }
});

test('elevation changes how a car accelerates (Spa)', () => {
  const t = tracks.get('spa'); let up = -1, down = -1;
  // (on a straight: the coasting car runs straight ahead for 60 m)
  const straight = (i) => { for (let q = 0; q < 35; q++) if (Math.abs(t.kappa[t.wrapI(i + q)]) > 1 / 1500) return false; return true; };
  for (let i = 0; i < t.N; i++) { if (up < 0 && t.grade[i] > 0.05 && straight(i)) up = i; if (down < 0 && t.grade[i] < -0.04 && straight(i)) down = i; }
  assert.ok(up >= 0 && down >= 0, 'Spa has real climbs and descents');
  const coast = (i) => {
    const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, { type: 'race' });
    car.placeAt(t, i * SIM.DS, 0, 40); car.idx = i; car.input.throttle = 0; car.input.brake = 0;
    for (let k = 0; k < 360; k++) { car.idx = i; SIM.stepCarPhysics(car, SIM.PHYS_DT, t, { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false }); }
    return car.speed;
  };
  assert.ok(coast(down) > coast(up) + 1.5, 'a car loses less speed coasting downhill than uphill');
});

function race(id, laps, seed) {
  const t = tracks.get(id);
  const s = new SIM.Session(t, { type: 'race', laps: 8, entries: SIM.DRIVERS.map(driver => ({ driver })), seed, spectate: true, weather: 'dynamic',
    weatherState: Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 }) });
  s.totalLaps = laps;
  const last = new Map(), pits = { maxBoxes: 0, ownBox: true, shared: 0 };
  for (let step = 0; !s.over && s.time < laps * 170 + 220; step++) {
    s.fixedStep(SIM.PHYS_DT);
    const held = s.pitBoxes.filter(Boolean); pits.maxBoxes = Math.max(pits.maxBoxes, held.length);
    assert.equal(new Set(held).size, held.length, id + ': a car in two boxes');
    s.pitBoxes.forEach((c, k) => { if (c && c.teamIdx !== k) pits.ownBox = false; });
    if (step % 24 === 0) for (let k = 0; k < s.pitBoxes.length; k++) if (s.cars.filter(c => c.pit && c.pit.box === k && ['stopped', 'release'].includes(c.pit.phase)).length > 1) pits.shared++;
    for (const c of s.cars) if (c.pit && c.pit.entryTime != null) assert.ok(s.time - c.pit.entryTime < 150, id + ': ' + c.driver.short + ' stuck in the pit lane');
    if (step % 2400 === 0) for (const c of s.cars) {
      if (c.dnf || c.finished || c.pit || !s.lightsOut) continue;
      const prev = last.get(c); if (prev && prev.t < s.time - 20) assert.ok(c.totalDist - prev.d > 30, id + ': ' + c.driver.short + ' stuck at s=' + c.s.toFixed(0));
      if (!prev || c.totalDist - prev.d > 30) last.set(c, { d: c.totalDist, t: s.time });
    }
  }
  return { s, pits };
}

// lap-time window per circuit for the leaders (real F1 pole laps are about Monza 79, Silverstone 86, Spa 104,
// Suzuka 89, Bahrain 89, Interlagos 70 s; the game's car is an arcade car, so the window is generous)
const LAP = { monza: [70, 100], silverstone: [75, 105], spa: [92, 125], suzuka: [76, 108], bahrain: [80, 112], interlagos: [60, 86] };
for (const id of tracks.keys()) {
  test(id + ': the full 20-car field starts, races six laps, pits and is classified', () => {
    const { s, pits } = race(id, SIM.GAME_MODES.grandprix.laps, 21);
    assert.ok(pits.ownBox, id + ': a car held another team\'s box');
    assert.equal(pits.shared, 0, id + ': two cars serviced in one box at once');
    for (const c of s.cars) assert.notEqual(c.dnfReason, 'Out of fuel', id + ': ' + c.driver.short + ' ran out of fuel');
    for (const c of s.cars) for (const h of c.pitHistory) assert.ok(h.fuel <= s.fuelCapacity + 1e-9);
    assert.ok(s.over, 'race finished');
    for (const c of s.cars) if (!c.dnf) assert.ok(c.laps >= 4, id + ': ' + c.driver.short + ' completed only ' + c.laps + ' laps');
    assert.ok(s.cars.filter(c => c.finished).length >= 12, id + ' finishers');
    assert.ok(s.stats.pitstops >= 4, id + ' pit stops ' + s.stats.pitstops);
    assert.equal(s.stats.boxMissed, 0, id + ': a car overshot its box');
    const res = s.results; assert.equal(res.length, 20); res.forEach((r, k) => assert.equal(r.pos, k + 1));
    const winner = res[0].car; assert.equal(winner.laps, SIM.GAME_MODES.grandprix.laps);
    for (const r of res.slice(0, 5)) assert.ok(r.car.bestLap > LAP[id][0] && r.car.bestLap < LAP[id][1], id + ' lap time ' + r.car.bestLap);
  });
}
