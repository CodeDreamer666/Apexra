const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The three circuits, built and raced through the game's own Track, Session and AI.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const SPEC = {
  summit: { corners: [16, 20], straights: 3 },
  rivermere: { corners: [15, 17], straights: 2 },
  redridge: { corners: [14, 16], straights: 2 },
};
// The circuit's long straights, measured from its racing-line curvature (no straight metadata in the game):
// a lap is scanned from inside a bend, so a straight across the start/finish line is found once, whole.
function straights(t) {
  const N = t.N, sk = t.smoothArr(t.rlKappa.map(Math.abs), 5, 1), found = []; let st = -1, i0 = 0;
  while (i0 < N && sk[i0] < 1 / 700) i0++;
  for (let i = i0; i <= i0 + N; i++) {
    const k = sk[i % N] < 1 / 700;
    if (k && st < 0) st = i; else if (!k && st >= 0) { if (i - st > 120) found.push([st % N, i - st]); st = -1; }
  }
  return found.sort((a, b) => b[1] - a[1]).map(([a, len]) => ({ start: t.wrapS((a + 25) * SIM.DS), len: t.wrapS((len - 70) * SIM.DS) }));
}

test('three distinct six-kilometre circuits are registered', () => {
  assert.equal(SIM.CIRCUITS.map(c => c.id).join(), 'summit,rivermere,redridge');
  assert.equal(SIM.CIRCUITS.map(c => c.name).join(), 'Summit Grand Circuit,Rivermere Grand Prix,Redridge International Circuit');
  assert.equal(SIM.TRACK_DEF, SIM.CIRCUITS[0]);
  for (const t of tracks.values()) assert.ok(Math.abs(t.length - 6000) <= 4, t.name + ' length ' + t.length);
  // genuinely different layouts, not renamed copies
  const ids = [...tracks.keys()];
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const A = tracks.get(ids[a]), B = tracks.get(ids[b]); let diff = 0;
    for (let i = 0; i < Math.min(A.N, B.N); i += 50) diff += Math.hypot(A.cx[i] - B.cx[i], A.cz[i] - B.cz[i]);
    assert.ok(diff / (Math.min(A.N, B.N) / 50) > 150, ids[a] + ' vs ' + ids[b]);
  }
});

test('every circuit passes the geometry checks: no overlaps, barriers clear of the road, drivable corners', () => {
  for (const t of tracks.values()) {
    const v = t.validate();
    assert.ok(v.ok, t.name + ': ' + v.issues.join('; '));
    assert.ok(v.minSep > 60, t.name + ' sections ' + v.minSep.toFixed(0) + ' m apart');
    assert.ok(v.minR >= 18, t.name + ' radius ' + v.minR.toFixed(1));
  }
});

test('corner counts, straights and elevation match each circuit brief', () => {
  for (const [id, t] of tracks) {
    const spec = SPEC[id];
    assert.ok(t.corners.length >= spec.corners[0] && t.corners.length <= spec.corners[1], id + ' corners ' + t.corners.length);
    // the long straights (the circuit layouts are unchanged by the removal of DRS)
    const long = straights(t).slice(0, spec.straights);
    assert.equal(long.length, spec.straights, id + ' long straights');
    for (const z of long) assert.ok(z.len > 200, id + ' straight length');
    const starts = long.map(z => z.start).sort((a, b) => a - b);
    for (let k = 1; k < starts.length; k++) assert.ok(starts[k] - starts[k - 1] > 300, id + ' distinct straights');
    assert.ok(!('drs' in t.def) && !('drsZones' in t), id + ': no DRS metadata');
    const rise = Math.max(...t.elev) - Math.min(...t.elev);
    assert.ok(rise > 8, id + ' elevation change ' + rise.toFixed(1));
    assert.ok(Math.max(...t.grade.map(Math.abs)) < 0.1, id + ' gradient');
  }
  const mainStraight = t => straights(t)[0].len;
  // Redridge has the longest main straight; Summit climbs the most; Rivermere is the flattest
  assert.ok(mainStraight(tracks.get('redridge')) > mainStraight(tracks.get('summit')));
  assert.ok(mainStraight(tracks.get('redridge')) > mainStraight(tracks.get('rivermere')));
  const range = t => Math.max(...t.elev) - Math.min(...t.elev);
  assert.ok(range(tracks.get('summit')) > range(tracks.get('redridge')) && range(tracks.get('redridge')) > range(tracks.get('rivermere')));
  // Rivermere is the most technical: more slow corners per kilometre than Redridge
  const slow = t => t.corners.filter(c => t.refSpeed[c.apex] < 34).length;
  assert.ok(slow(tracks.get('rivermere')) > slow(tracks.get('redridge')));
});

test('start grid, pit lane, timing and minimap data come from each circuit', () => {
  for (const t of tracks.values()) {
    assert.equal(t.gridSlots.length, 24);
    // grid boxes behind the line on the straight; the pit lane straight and level
    for (const g of t.gridSlots.slice(0, 20)) { const i = t.wrapI(Math.round(g.s / SIM.DS)); assert.ok(Math.abs(t.kappa[i]) < 1 / 800, t.name + ' grid on the straight'); }
    for (let q = 0; q <= t.pit.len; q += 10) { const s = t.wrapS(t.pit.entry0 + q), i = t.wrapI(Math.round(s / SIM.DS)); assert.ok(Math.abs(t.kappa[i]) < 1 / 600, t.name + ' pit lane bend at ' + s); assert.ok(Math.abs(t.grade[i]) < 0.02, t.name + ' pit lane slope'); }
    assert.equal(t.pit.boxes.length, 4, 'four shared boxes, not one per team');
    assert.ok(t.sector1 > 0 && t.sector2 > t.sector1 && t.sector2 < t.length);
    // the menu map is the playable centre line
    const line = SIM.circuitCentreLine(t.def);
    assert.equal(line.length, t.N);
    for (let i = 0; i < t.N; i += 97) { assert.ok(Math.abs(line[i][0] - t.cx[i]) < 1e-9 && Math.abs(line[i][1] - t.cz[i]) < 1e-9); }
  }
});

test('elevation changes how a car accelerates', () => {
  const t = tracks.get('summit'); let up = -1, down = -1;
  for (let i = 0; i < t.N; i++) { if (up < 0 && t.grade[i] > 0.05) up = i; if (down < 0 && t.grade[i] < -0.05) down = i; }
  assert.ok(up >= 0 && down >= 0, 'Summit has real climbs and descents');
  const coast = (i) => {
    const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, { type: 'race' });
    car.placeAt(t, i * SIM.DS, 0, 40); car.idx = i; car.input.throttle = 0; car.input.brake = 0;
    for (let k = 0; k < 360; k++) { car.idx = i; SIM.stepCarPhysics(car, SIM.PHYS_DT, t, { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false }); }
    return car.speed;
  };
  // about g x 10% x 1.5 s between a 5% climb and a 5% descent
  assert.ok(coast(down) > coast(up) + 1.0, 'a car loses less speed coasting downhill than uphill');
});

function race(id, laps, seed) {
  const t = tracks.get(id);
  const s = new SIM.Session(t, { type: 'race', laps: 8, entries: SIM.DRIVERS.map(driver => ({ driver })), seed, spectate: true, weather: 'dynamic',
    weatherState: Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 }) });
  s.totalLaps = laps;
  const last = new Map(), pits = { maxBoxes: 0, assigned: [], fifo: true };
  for (let step = 0; !s.over && s.time < laps * 160 + 200; step++) {
    s.fixedStep(SIM.PHYS_DT);
    // shared boxes: never more than four, never one car in two, and each box goes to the earliest waiting car
    const held = s.pitBoxes.filter(Boolean); pits.maxBoxes = Math.max(pits.maxBoxes, held.length);
    assert.equal(new Set(held).size, held.length, id + ': a car in two boxes');
    for (const c of held) if (c.pit.assignedAt === s.time && !pits.assigned.includes(c.pit)) {
      pits.assigned.push(c.pit);
      for (const w of s.pitQueue) if (w.pit.entryTime < c.pit.entryTime) pits.fifo = false;
    }
    for (const c of s.cars) if (c.pit && c.pit.entryTime != null) assert.ok(s.time - c.pit.entryTime < 150, id + ': ' + c.driver.short + ' stuck in the pit lane');
    if (step % 2400 === 0) for (const c of s.cars) {
      if (c.dnf || c.finished || c.pit || !s.lightsOut) continue;
      const prev = last.get(c); if (prev && prev.t < s.time - 20) assert.ok(c.totalDist - prev.d > 30, id + ': ' + c.driver.short + ' stuck at s=' + c.s.toFixed(0));
      if (!prev || c.totalDist - prev.d > 30) last.set(c, { d: c.totalDist, t: s.time });
    }
  }
  return { s, pits };
}

for (const id of ['summit', 'rivermere', 'redridge']) {
  test(id + ': the full 20-car field starts, races, pits and is classified', () => {
    const { s, pits } = race(id, 4, 21);
    assert.ok(pits.maxBoxes <= 4 && pits.assigned.length >= 10, id + ' boxes used ' + pits.assigned.length);
    assert.ok(pits.fifo, id + ': a box went to a car that arrived after one still waiting');
    for (const c of s.cars) assert.notEqual(c.dnfReason, 'Out of fuel', id + ': ' + c.driver.short + ' ran out of fuel');
    for (const c of s.cars) for (const h of c.pitHistory) assert.ok(h.fuel <= s.fuelCapacity + 1e-9);
    assert.ok(s.over, 'race finished');
    // every car still running kept racing: at most a lap or two down at the flag
    for (const c of s.cars) if (!c.dnf) assert.ok(c.laps >= 2, id + ': ' + c.driver.short + ' completed only ' + c.laps + ' laps');
    assert.ok(s.cars.filter(c => c.finished).length >= 12, id + ' finishers');
    assert.ok(s.stats.pitstops >= 15, id + ' pit stops ' + s.stats.pitstops);
    assert.equal(s.stats.boxMissed, 0, id + ': a car overshot its box');
    // without DRS the field still races: positions change through the tow, braking and racecraft
    assert.ok(s.stats.overtakes > 0, id + ' overtakes ' + s.stats.overtakes);
    const res = s.results; assert.equal(res.length, 20); res.forEach((r, k) => assert.equal(r.pos, k + 1));
    const winner = res[0].car; assert.equal(winner.laps, 4);
    // the leaders' best laps are realistic for six kilometres
    for (const r of res.slice(0, 5)) assert.ok(r.car.bestLap > 70 && r.car.bestLap < 130, id + ' lap time ' + r.car.bestLap);
  });
}

test('qualifying runs on every circuit', () => {
  for (const id of ['summit', 'rivermere', 'redridge']) {
    const t = tracks.get(id);
    const s = new SIM.Session(t, { type: 'quali', entries: SIM.DRIVERS.slice(0, 4).map(driver => ({ driver })), seed: 4, spectate: true, weather: 'dynamic',
      weatherState: Object.assign(new SIM.DynamicWeather(1).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, patternEnds: 1e9, regimeEnds: 1e9 }) });
    // no out-lap: each car's timed lap starts where the pit exit rejoins the circuit, as it leaves the lane
    const starts = new Map(), phases = new Set();
    while (!s.over && s.time < 600) {
      s.fixedStep(SIM.PHYS_DT);
      for (const c of s.cars) { phases.add(c.q.phase); if (c.q.phase === 'flying' && !starts.has(c)) starts.set(c, { past: t.dS(t.pit.exit1, c.s), dist: c.q.distance, pit: !!c.pit }); }
    }
    assert.ok(s.over, id + ' qualifying ended');
    assert.deepEqual([...phases].sort(), ['complete', 'exit', 'flying', 'waiting'], id + ' phases');
    for (const [c, st] of starts) {
      assert.ok(!st.pit && st.past >= 0 && st.past < 2 && Math.abs(st.dist - st.past) < 1e-6, id + ' ' + c.driver.short + ' timed from the pit exit');
    }
    const timed = s.cars.filter(c => c.q && c.q.result === 'valid');
    assert.ok(timed.length >= 3, id + ' timed laps ' + timed.length);
    // one full circuit distance each, and the grid follows the times
    for (const c of timed) assert.ok(c.q.distance >= t.length && c.q.distance < t.length + 2, id + ' distance ' + c.q.distance);
    for (const c of timed) assert.ok(c.q.time > 70 && c.q.time < 130, id + ' lap time ' + c.q.time);
    assert.ok(s.gridOrder && s.gridOrder.length === 4, id + ' grid order');
    const grid = s.gridOrder.map(e => s.cars[e]).filter(c => c.q.result === 'valid');
    for (let k = 1; k < grid.length; k++) assert.ok(grid[k].q.time >= grid[k - 1].q.time, id + ' grid sorted by time');
  }
});
