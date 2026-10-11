const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Slipstreaming (drafting) on the three circuits, through the game's own Track, Session, Car and physics.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const dt = SIM.PHYS_DT;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const dryState = seed => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });

// A race session on a circuit with the lights already out; cars are placed by hand.
function session(id, n = 3, playerIdx = -1) {
  const t = tracks.get(id);
  const s = new SIM.Session(t, { type: 'race', entries: SIM.DRIVERS.slice(0, n).map((driver, k) => ({ driver, isPlayer: k === playerIdx })), seed: 5, spectate: playerIdx < 0, weather: 'dynamic', weatherState: dryState(5) });
  s.lightsOut = true;
  for (const c of s.cars) { c.inGarage = false; c.pit = null; c.surf.fill(0); place(s, c, 0, 0, 0); }
  return s;
}
function place(s, car, sPos, d, speed) {
  car.placeAt(s.track, s.track.wrapS(sPos), d, speed); car.speed = speed; car.u = speed; car.v = 0;
}
// The main straight: the longest DRS zone, measured from the geometry.
function straight(t) {
  const z = t.drsZones.slice().sort((a, b) => t.wrapS(b.end - b.start) - t.wrapS(a.end - a.start))[0];
  return { start: z.start, len: t.wrapS(z.end - z.start) };
}
function goal(s, follower) { s.updateSlipstream(); return follower.slipGoal; }

test('following closely on a straight gives a tow that grows as the gap closes', () => {
  for (const id of tracks.keys()) {
    const s = session(id), t = s.track, [lead, car] = s.cars, st = straight(t), at = st.start + st.len * 0.5;
    let prev = -1; const seen = [];
    for (const gap of [80, 64, 55, 45, 35, 25, 15, 9]) {
      place(s, lead, at, 0, 80); place(s, car, at - gap, 0, 80);
      const g = goal(s, car); seen.push(g.toFixed(2));
      assert.ok(g >= prev, id + ': tow did not grow as the gap closed ' + seen.join(' '));
      prev = g;
    }
    assert.equal(+seen[0], 0, id + ': no tow 80 m back');
    assert.ok(+seen[1] < 0.02, id + ': the tow fades in at the edge of its range');
    assert.ok(+seen[seen.length - 1] > 0.9, id + ': full tow close behind');
    // the leader feels nothing from the car behind it
    assert.equal(lead.slipGoal, 0);
  }
});

test('moving sideways out of the wake gradually removes the advantage', () => {
  const s = session('redridge'), t = s.track, [lead, car] = s.cars, st = straight(t), at = st.start + 400;
  for (const gap of [12, 30, 50]) {
    let prev = 2; const seen = [];
    for (const lat of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4.5]) {
      place(s, lead, at, -1.5, 80); place(s, car, at - gap, -1.5 + lat, 80);
      const g = goal(s, car); seen.push(g.toFixed(2));
      assert.ok(g <= prev, 'tow grew while pulling out: ' + seen.join(' '));
      prev = g;
    }
    // smooth: no single half-metre step removes most of the tow, and it is gone a car's width out
    const v = seen.map(Number);
    for (let k = 1; k < 6; k++) assert.ok(v[k - 1] - v[k] < 0.45 * v[0] + 1e-9, 'abrupt loss at gap ' + gap + ': ' + seen.join(' '));
    assert.equal(v[v.length - 1], 0, 'still towed 4.5 m to the side at gap ' + gap);
  }
});

test('no tow when stationary, slow, side by side, ahead, going the other way or misaligned', () => {
  const s = session('summit'), t = s.track, [lead, car] = s.cars, st = straight(t), at = st.start + 300;
  const setup = (ls, cs, gap = 20) => { place(s, lead, at, 0, ls); place(s, car, at - gap, 0, cs); };
  setup(0, 0); assert.equal(goal(s, car), 0, 'stationary');
  setup(15, 80); assert.equal(goal(s, car), 0, 'behind a crawling car');
  setup(80, 15); assert.equal(goal(s, car), 0, 'crawling behind a fast car');
  setup(80, 80, 2); assert.equal(goal(s, car), 0, 'overlapping, side by side');
  setup(80, 80, -20); assert.equal(goal(s, car), 0, 'ahead of the other car');
  setup(80, 80); lead.vx *= -1; lead.vz *= -1; assert.equal(goal(s, car), 0, 'leader driving the wrong way');
  setup(80, 80); car.vx *= -1; car.vz *= -1; assert.equal(goal(s, car), 0, 'follower driving the wrong way');
  // follower pointing 25 degrees off the leader's direction
  setup(80, 80); const h = Math.atan2(car.vz, car.vx) + 0.44; car.vx = Math.cos(h) * 80; car.vz = Math.sin(h) * 80;
  assert.equal(goal(s, car), 0, 'misaligned');
  // a few degrees of yaw only trims it
  setup(80, 80); const full = goal(s, car); const h2 = Math.atan2(car.vz, car.vx) + 0.2; car.vx = Math.cos(h2) * 80; car.vz = Math.sin(h2) * 80;
  const yawed = goal(s, car); assert.ok(yawed > 0 && yawed < full, 'slight yaw ' + yawed + ' vs ' + full);
});

test('cars on nearby but disconnected parts of a circuit never tow each other', () => {
  for (const id of tracks.keys()) {
    const s = session(id), t = s.track, [lead, car] = s.cars;
    // the closest pair of centre-line points that are far apart along the lap
    let best = null;
    for (let i = 0; i < t.N; i += 4) for (let k = 0; k < t.N; k += 4) {
      const lap = Math.abs(t.dS(i * SIM.DS, k * SIM.DS)); if (lap < 400) continue;
      const w = Math.hypot(t.cx[i] - t.cx[k], t.cz[i] - t.cz[k]);
      if (!best || w < best.w) best = { i, k, w };
    }
    assert.ok(best.w < 250, id + ': nearest separate sections ' + best.w.toFixed(0) + ' m');
    // at every relative arrangement around that pair, as fast cars on the racing surface
    for (const di of [-40, -20, 0, 20, 40]) for (const lat of [-4, 0, 4]) {
      place(s, lead, best.i * SIM.DS + di, lat, 80); place(s, car, best.k * SIM.DS, 0, 80);
      assert.equal(goal(s, car), 0, id + ': tow across sections');
      assert.equal(lead.slipGoal, 0, id + ': tow across sections');
      // even if the lap distance were misread as close, the world-space check refuses it
      assert.equal(SIM.slipstreamStrength(car, lead, 30, t), 0);
      assert.equal(SIM.slipstreamStrength(lead, car, 30, t), 0);
    }
  }
});

test('pit lane, the grid, off-track running and calibration get no tow', () => {
  const s = session('rivermere'), t = s.track, [lead, car] = s.cars, st = straight(t), at = st.start + 300;
  const setup = () => { place(s, lead, at, 0, 80); place(s, car, at - 20, 0, 80); lead.pit = car.pit = null; car.surf.fill(0); s.lightsOut = true; s.type = 'race'; };
  setup(); assert.ok(goal(s, car) > 0.5);
  setup(); car.pit = { phase: 'in' }; assert.equal(goal(s, car), 0, 'follower in the pit lane');
  setup(); lead.pit = { phase: 'out' }; assert.equal(goal(s, car), 0, 'leader in the pit lane');
  setup(); car.surf.fill(3); assert.equal(goal(s, car), 0, 'follower on the grass');
  setup(); car.surf[0] = car.surf[2] = 4; assert.equal(goal(s, car), 0, 'two wheels in the gravel');
  setup(); car.surf[0] = 1; assert.ok(goal(s, car) > 0.5, 'a kerb is still the road');
  setup(); s.lightsOut = false; assert.equal(goal(s, car), 0, 'before the start');
  setup(); s.type = 'calib'; assert.equal(goal(s, car), 0, 'handling calibration');
  setup(); car.dnf = true; assert.equal(goal(s, car), 0, 'retired car'); car.dnf = false;
});

test('the player and the bots use the same calculation', () => {
  const s = session('redridge', 3, 1), t = s.track, [ai, player, ai2] = s.cars, st = straight(t), at = st.start + 500;
  assert.ok(player.isPlayer && !ai2.isPlayer);
  for (const [gap, lat] of [[10, 0], [25, 0.8], [40, 1.6], [58, 0.3]]) {
    place(s, ai, at, 0, 82); place(s, player, at - gap, lat, 80); place(s, ai2, at + 2000, 0, 80);
    const gp = goal(s, player);
    place(s, ai, at + 2000, 0, 80); place(s, ai2, at, 0, 82); place(s, player, at - gap, lat, 80);
    // swap roles: the bot follows the player
    place(s, player, at, 0, 82); place(s, ai, at - gap, lat, 80); place(s, ai2, at + 2000, 0, 80);
    const ga = goal(s, ai);
    assert.ok(Math.abs(gp - ga) < 1e-12, 'player ' + gp + ' bot ' + ga);
  }
});

// ---- physics: a flat, unobstructed straight (as tests/movement.cjs) ----
const flat = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => 0, pit: { limit: 22 } };
const env = { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false };
function drive(opts) {
  const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, {});
  car.vx = car.u = car.speed = opts.speed || 50; car.gear = opts.gear || 6; car.rpm = 10000;
  const h = new SIM.PlayerHandling(), out = { car, dist: 0, trace: [] };
  const raw = { steer: opts.steer || 0, throttle: opts.throttle ?? 1, brake: opts.brake || 0, analog: false };
  for (let k = 0; k < (opts.secs || 1e9) / dt && out.dist < (opts.dist || 1e9); k++) {
    h.step(car, dt, { lightsOut: true, wet: 0 }, raw);
    car.slipstream = opts.slip || 0; car.drsOpen = !!opts.drs;
    SIM.stepCarPhysics(car, dt, flat, env);
    out.dist += car.speed * dt;
    if (k % 24 === 0) out.trace.push([car.x, car.z, car.psi, car.r, car.speed, car.gLat]);
  }
  out.kmh = car.speed * 3.6;
  return out;
}

test('the tow is a measured drag cut: faster down a long straight, but not absurdly so', () => {
  const clean = drive({ dist: 1800 }), half = drive({ dist: 1800, slip: 0.5 }), full = drive({ dist: 1800, slip: 1 });
  const drs = drive({ dist: 1800, drs: true }), both = drive({ dist: 1800, drs: true, slip: 1 });
  console.log(`# 1.8 km from 180 km/h: clean ${clean.kmh.toFixed(1)}, half tow ${half.kmh.toFixed(1)}, full tow ${full.kmh.toFixed(1)}, DRS ${drs.kmh.toFixed(1)}, DRS + full tow ${both.kmh.toFixed(1)} km/h`);
  assert.ok(half.kmh > clean.kmh + 4 && full.kmh > half.kmh + 4);
  assert.ok(full.kmh - clean.kmh < 25, 'tow alone adds ' + (full.kmh - clean.kmh).toFixed(1));
  // DRS and the tow combine, with diminishing returns
  assert.ok(both.kmh > drs.kmh + 3 && both.kmh > full.kmh);
  assert.ok(both.kmh - drs.kmh < full.kmh - clean.kmh, 'the tow adds less on top of DRS');
  assert.ok(both.kmh - clean.kmh < 40 && both.kmh < 370, 'combined ' + both.kmh.toFixed(1));
  // it also helps acceleration lower down, not only at the top end
  const a0 = drive({ speed: 45, secs: 2 }), a1 = drive({ speed: 45, secs: 2, slip: 1 });
  assert.ok(a1.kmh > a0.kmh + 0.5 && a1.kmh < a0.kmh + 6, 'mid-speed gain ' + (a1.kmh - a0.kmh).toFixed(2));
});

test('the tow never changes downforce, cornering, braking or the lift-off coast', () => {
  const car = new SIM.Car({ driver: SIM.DRIVERS[0] }, {});
  const cl = car.effClA(), cd = car.effCdA();
  car.slipstream = 1; assert.equal(car.effClA(), cl, 'downforce unchanged'); assert.ok(car.effCdA() < cd);
  assert.ok(Math.abs(car.effCdA() / cd - (1 - SIM.SLIPSTREAM.maxCut)) < 1e-12);
  car.drsOpen = true; const drsOnly = SIM.SPEC.cdA * 0.8, both = car.effCdA();
  assert.ok(both < drsOnly && both > drsOnly * (1 - SIM.SLIPSTREAM.maxCut), 'DRS + tow combine with diminishing returns');
  for (const opts of [{ throttle: 0, secs: 4, speed: 80 }, { throttle: 0, brake: 1, secs: 3, speed: 85 }, { throttle: 0, steer: 0.8, secs: 3, speed: 60 }, { throttle: 0, steer: -1, brake: 0.5, secs: 2, speed: 70 }]) {
    const a = drive(opts), b = drive(Object.assign({ slip: 1 }, opts));
    assert.deepEqual(b.trace, a.trace, JSON.stringify(opts));
  }
  // under power the path through a steady corner is the same, only a touch faster
  const a = drive({ steer: 0.5, secs: 3, speed: 55 }), b = drive({ steer: 0.5, secs: 3, speed: 55, slip: 1 });
  const lastA = a.trace[a.trace.length - 1], lastB = b.trace[b.trace.length - 1];
  assert.ok(Math.abs(lastB[5]) >= Math.abs(lastA[5]) - 0.05, 'lateral g held');
  assert.ok(lastB[4] >= lastA[4] && lastB[4] - lastA[4] < 2, 'speed ' + lastA[4] + ' ' + lastB[4]);
});

test('drafting builds and fades smoothly, without speed jumps', () => {
  const s = session('redridge'), t = s.track, [lead, car] = s.cars, st = straight(t);
  for (const c of s.cars) c.ai = null; // no bot driver: the test presses the pedals through the shared handling
  place(s, lead, st.start + 150, 0, 78); place(s, car, st.start + 150 - 18, 0, 78);
  s.cars[2].inGarage = true;
  const hl = new SIM.PlayerHandling(), hc = new SIM.PlayerHandling();
  // hold a lateral position on the straight with a little proportional steering
  const steerTo = (c, d) => { let he = c.psi - t.heading[c.idx]; he = Math.atan2(Math.sin(he), Math.cos(he)); return Math.max(-1, Math.min(1, (d - c.d) * 0.25 - he * 4)); };
  let maxStep = 0, maxDv = 0, prevSlip = 0, prevSpeed = car.speed, peak = 0;
  for (let k = 0; k < 240 * 4; k++) {
    hl.step(lead, dt, s, { steer: steerTo(lead, 0), throttle: 1, brake: 0, analog: true });
    // after two seconds the follower pulls out of the wake
    hc.step(car, dt, s, { steer: steerTo(car, k > 480 ? 3.5 : 0), throttle: 1, brake: 0, analog: true });
    s.fixedStep(dt);
    maxStep = Math.max(maxStep, Math.abs(car.slipstream - prevSlip)); prevSlip = car.slipstream; peak = Math.max(peak, car.slipstream);
    maxDv = Math.max(maxDv, Math.abs(car.speed - prevSpeed)); prevSpeed = car.speed;
  }
  assert.ok(peak > 0.4, 'tow built ' + peak.toFixed(2));
  assert.ok(maxStep <= dt / SIM.SLIPSTREAM.tau + 1e-9, 'strength step ' + maxStep);
  assert.ok(maxDv < 0.05, 'speed step ' + maxDv);
  assert.ok(car.slipstream < 0.6 * peak, 'tow lost after pulling out (' + car.slipstream.toFixed(2) + ' of ' + peak.toFixed(2) + ')');
});

test('a 20-car race on each circuit: bots draft, pit cars never do, speeds stay sane, the scan is cheap', () => {
  for (const id of tracks.keys()) {
    const t = tracks.get(id);
    const s = new SIM.Session(t, { type: 'race', laps: 8, entries: SIM.DRIVERS.map(driver => ({ driver })), seed: 9, spectate: true, weather: 'dynamic', weatherState: dryState(9) });
    s.totalLaps = 4;
    let towed = 0, maxV = 0, pitTow = 0, both = 0;
    for (let step = 0; !s.over && s.time < 260; step++) {
      s.fixedStep(dt);
      for (const c of s.cars) {
        if (c.pit && (c.slipGoal > 0 || c.slipstream > 0)) pitTow++;
        if (c.slipstream > 0.3 && !c.pit) towed++;
        if (c.slipstream > 0.2 && c.drsOpen) both++;
        if (!c.pit) maxV = Math.max(maxV, c.speed);
        assert.ok(Number.isFinite(c.slipstream) && c.slipstream >= 0 && c.slipstream <= 1);
      }
    }
    console.log(`# ${id}: towed car-steps ${towed}, tow + DRS ${both}, top speed ${(maxV * 3.6).toFixed(1)} km/h`);
    assert.equal(pitTow, 0, id + ': tow in the pit lane');
    assert.ok(towed > 500, id + ': the bots drafted ' + towed);
    assert.ok(maxV * 3.6 < 370, id + ' top speed ' + (maxV * 3.6).toFixed(1));
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < 2000; k++) s.updateSlipstream();
    const us = Number(process.hrtime.bigint() - t0) / 2000 / 1000;
    console.log(`# ${id}: slipstream scan ${us.toFixed(1)} µs for 20 cars`);
    assert.ok(us < 200, id + ' scan ' + us.toFixed(1) + ' µs');
  }
});
