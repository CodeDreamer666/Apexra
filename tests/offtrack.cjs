const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The universal off-track model: per-tyre detection against the legal track edge, one surface for grass, gravel
// and run-off, progressive grip loss and resistance by the number of tyres off, the silent race-progress check
// that replaces track-limit penalties, and AI recovery — through the game's own physics, Session and AI.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const dt = SIM.PHYS_DT, OFF = SIM.OFF_TRACK;
const tracks = new Map(SIM.CIRCUITS.map(def => [def.id, new SIM.Track(def)]));
const DRY = (seed) => Object.assign(new SIM.DynamicWeather(seed).snapshot(), { pattern: 'dry', regime: 'sunny', rain: 0, water: 0, lineWater: 0, cloud: 0.2, targetCloud: 0.2, targetRain: 0, patternEnds: 1e9, regimeEnds: 1e9 });
const env = (wet = 0) => ({ wet, trackTemp: 30, wearScale: 0, fuelRate: 0, pitLimiter: false });

// a flat test surface where the first n tyres (FL, FR, RL, RR) are on `surf` and the rest on asphalt
function flat(n, surf = 3) { let k = 0; return { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => (k++ % 4) < n ? surf : 0, pit: { limit: 22 } }; }
function rig(kmh, opts = {}) {
  const car = new SIM.Car({ driver: SIM.DRIVERS[opts.driver || 0], isPlayer: opts.player !== false }, {});
  car.vx = car.u = car.speed = kmh / 3.6; car.gear = kmh > 200 ? 8 : kmh > 100 ? 5 : 2; car.rpm = 10000;
  return { car, h: new SIM.PlayerHandling() };
}
// drive for `secs` with fixed inputs (or a function of time); records speed (km/h) every step
function drive(r, track, secs, input = {}, wet = 0) {
  const trace = []; let tm = 0;
  for (let i = 0; i < Math.round(secs / dt); i++) {
    const inp = typeof input === 'function' ? input(tm) : input;
    r.h.step(r.car, dt, { lightsOut: true, wet }, { steer: inp.steer || 0, throttle: inp.throttle ?? 1, brake: inp.brake || 0, analog: true });
    SIM.stepCarPhysics(r.car, dt, track, env(wet));
    tm += dt; trace.push(r.car.speed * 3.6);
  }
  return trace;
}
const at = (trace, s) => trace[Math.min(trace.length - 1, Math.round(s / dt) - 1)];

// the longest straight away from the pit lane (start s), for placing cars
function straight(t) {
  let best = 0, start = 0, run = 0;
  for (let k = 0; k < 2 * t.N; k++) {
    const i = k % t.N, ok = Math.abs(t.kappa[i]) < 1 / 3000 && !t.kerbL[i] && !t.kerbR[i] && t.pitProg(i * 2) < 0;
    if (ok) { run++; if (run > best) { best = run; start = i - run + 1; } } else run = 0;
  }
  return t.wrapS((start + best / 2) * 2);
}
// a car placed on track t at (s, d) with a yaw offset; surfaces are read by one zero-length physics step
function placed(t, s, d, yaw = 0, pit = null) {
  const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, {});
  car.placeAt(t, s, d, 0); car.psi += yaw; car.pit = pit;
  SIM.stepCarPhysics(car, 1e-6, t, env());
  return car;
}

test('each tyre is checked at its own position against the legal edge, on every circuit (exhaustive reference)', () => {
  for (const [id, t] of tracks) {
    const hw = t.halfW, N = t.N, edge = hw + OFF.tyreHalf;
    let checked = 0, offSeen = 0;
    for (let s = 0; s < t.length; s += 23) {
      for (const d of [-hw - 4, -hw - 1.1, -hw + 0.3, 0, hw - 0.3, hw + 1.1, hw + 4]) {
        for (const yaw of [-0.45, 0, 0.3]) {
          const car = placed(t, s, d, yaw);
          const c = Math.cos(car.psi), sn = Math.sin(car.psi);
          for (let w = 0; w < 4; w++) {
            const lx = [SIM.SPEC.a, SIM.SPEC.a, -SIM.SPEC.b, -SIM.SPEC.b][w], ly = [-SIM.SPEC.tw, SIM.SPEC.tw, -SIM.SPEC.tw, SIM.SPEC.tw][w];
            const wx = car.x + c * lx - sn * ly, wz = car.z + sn * lx + c * ly;
            // reference: the nearest point of the centre line, searched over the whole circuit
            let bi = 0, bd = 1e18;
            for (let i = 0; i < N; i++) { const q = (wx - t.cx[i]) ** 2 + (wz - t.cz[i]) ** 2; if (q < bd) { bd = q; bi = i; } }
            if (Math.abs(t.dS(bi * 2, car.idx * 2)) > 40) continue; // another part of the circuit is closer: walls decide there
            const dw = (wx - t.cx[bi]) * t.rx[bi] + (wz - t.cz[bi]) * t.rz[bi], ad = Math.abs(dw);
            const kerbs = dw > 0 ? t.kerbR : t.kerbL, kerb = kerbs[bi];
            if (kerbs[t.wrapI(bi - 1)] !== kerb || kerbs[t.wrapI(bi + 1)] !== kerb) continue; // a kerb starts or ends right here
            const pitSide = (dw > 0 ? 1 : -1) === t.pit.side && t.pitProg(bi * 2) >= 0 && t.inPitMain(bi * 2) && ad < t.pit.outerWall + 0.5;
            const near = Math.min(Math.abs(ad - edge), kerb ? Math.abs(ad - hw - 1.3) : 9);
            if (near < 0.08) continue; // within rounding of the line itself
            const legal = ad <= edge || (kerb && ad <= hw + 1.3) || pitSide;
            assert.equal(car.surf[w] >= 2, !legal, `${id} s=${s} d=${d} yaw=${yaw} wheel ${w}: lateral ${dw.toFixed(2)}`);
            checked++; if (!legal) offSeen++;
          }
        }
      }
    }
    assert.ok(checked > 5000 && offSeen > 1000, id + ' coverage ' + checked + '/' + offSeen);
  }
});

test('one, two, three and four tyres off are counted from the tyres, not the centre of the car', () => {
  for (const [id, t] of tracks) {
    const s = straight(t), E = t.halfW + OFF.tyreHalf;
    // a yawed car: front wheels sit 0.4 m further out, rear wheels 0.32 m further in
    const cases = [[0, 0, 0], [E - 0.8, 0.2, 1], [E, 0, 2], [E + 0.7, 0.2, 3], [E + 1.5, 0, 4]];
    for (const [d, yaw, n] of cases) {
      const car = placed(t, s, d, yaw);
      assert.equal(car.offN, n, `${id}: centre at ${d.toFixed(2)} m, yaw ${yaw}: ${n} tyres off`);
      if (n === 1) assert.ok(Math.abs(car.d) < t.halfW, 'one tyre off while the centre of the car is still on the track');
    }
    // mirrored on the other side of the track
    assert.equal(placed(t, s, -(E + 1.5)).offN, 4);
    assert.equal(placed(t, s, -E).offN, 2);
  }
});

test('more tyres off means progressively stronger slowdown; with four off the car settles at 60–80 km/h', () => {
  const end = [], first = [];
  for (let n = 0; n <= 4; n++) {
    const tr = drive(rig(280), flat(n), 40);
    end.push(tr[tr.length - 1]); first.push(at(tr, 1));
  }
  for (let n = 1; n <= 4; n++) {
    assert.ok(end[n] < end[n - 1] - 8, `sustained speed falls with ${n} tyres off: ${end.map(v => v.toFixed(0))}`);
    assert.ok(first[n] < first[n - 1] - 8, `and the first second costs more: ${first.map(v => v.toFixed(0))}`);
  }
  assert.ok(first[1] < 270, 'one tyre off is a noticeable deceleration');
  assert.ok(end[4] >= 60 && end[4] <= 80, 'four tyres off settles at ' + end[4].toFixed(1) + ' km/h');
  // the same speed is reached from below on full throttle: the car is never stuck off the track
  const up = drive(rig(20), flat(4), 30);
  assert.ok(Math.abs(up[up.length - 1] - end[4]) < 3, 'accelerates off the track to ' + up[up.length - 1].toFixed(1));
});

test('a 280 km/h excursion slows hard but progressively, never jumping to a lower speed', () => {
  const tr = drive(rig(280), flat(4), 8);
  assert.ok(at(tr, 0.25) > 245, 'no instant clamp: ' + at(tr, 0.25).toFixed(0) + ' km/h after 0.25 s');
  assert.ok(at(tr, 1) < 200 && at(tr, 2.5) < 100, 'but it slows rapidly: ' + at(tr, 1).toFixed(0) + ' / ' + at(tr, 2.5).toFixed(0));
  let worst = 0;
  for (let i = 1; i < tr.length; i++) { assert.ok(tr[i] <= tr[i - 1] + 1e-9, 'continuous deceleration'); worst = Math.max(worst, (tr[i - 1] - tr[i]) / 3.6 / dt); }
  assert.ok(worst < OFF.drag.max + 6, 'deceleration bounded: ' + worst.toFixed(1) + ' m/s²');
  // the rise from the first tyre leaving the track is smooth as well
  const r = rig(280); const lv = [];
  drive(r, flat(4), 0.2, {}); lv.push(r.car.offLvl);
  assert.ok(lv[0] > 0.9, 'the full level is reached within ' + OFF.rise * 4 + ' s');
});

test('off the track the car still accelerates, brakes and turns, with less grip than on the asphalt', () => {
  // braking: stops, and harder than coasting off the track, but less effectively than on asphalt
  const brakeOff = drive(rig(150), flat(4), 1, { throttle: 0, brake: 1 }), coastOff = drive(rig(150), flat(4), 1, { throttle: 0 });
  const brakeOn = drive(rig(150), flat(0), 1, { throttle: 0, brake: 1 });
  assert.ok(at(brakeOff, 1) < at(coastOff, 1) - 10, 'brakes work off the track');
  const stop = drive(rig(150), flat(4), 8, { throttle: 0, brake: 1 });
  assert.equal(stop[stop.length - 1], 0, 'brought to a stop');
  assert.ok(at(brakeOn, 1) < 150 && at(brakeOff, 1) < 150);
  // cornering: the same full steering input turns the car less sharply on the grass
  const turn = (n) => { const r = rig(100); drive(r, flat(n), 0.6, { steer: 1, throttle: 0.4 }); return Math.abs(r.car.r); };
  assert.ok(turn(4) < turn(0) * 0.85, `yaw rate off ${turn(4).toFixed(3)} vs on ${turn(0).toFixed(3)}`);
  // sliding/drifting off the track keeps the car controllable and finite
  const slide = rig(140); drive(slide, flat(4), 2, { steer: 1, throttle: 1, brake: 1 });
  for (const k of ['x', 'z', 'psi', 'speed']) assert.ok(Number.isFinite(slide.car[k]));
});

test('back on the asphalt, grip and acceleration return progressively', () => {
  const r = rig(150); let k = 0, off = true;
  const track = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => (k++, off ? 3 : 0), pit: { limit: 22 } };
  drive(r, track, 3);
  assert.ok(r.car.offLvl > 0.99 && r.car.offGrip < 0.51);
  off = false;
  const levels = [], speeds = [];
  for (let i = 0; i < 240 * 2; i++) { drive(r, track, dt); levels.push(r.car.offLvl); speeds.push(r.car.speed); }
  assert.ok(levels[23] > 0.6, 'not restored at once: level ' + levels[23].toFixed(2) + ' after 0.1 s');
  assert.ok(levels[239] < 0.2 && levels[479] < 0.02, 'restored within about a second');
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1e-12, 'monotonic recovery');
  assert.ok(speeds[479] > speeds[0] + 5, 'the car accelerates again');
});

test('grass, gravel and asphalt run-off are one surface; player and AI cars get identical physics', () => {
  const traces = [2, 3, 4].map(surf => drive(rig(220), flat(4, surf), 3, (tm) => ({ steer: Math.sin(tm * 3) * 0.6, throttle: 1, brake: tm > 2 ? 1 : 0 })));
  assert.deepEqual(traces[1], traces[0]); assert.deepEqual(traces[2], traces[0]);
  for (const n of [1, 3]) {
    const p = rig(220), ai = rig(220, { player: false, driver: 5 });
    const input = (tm) => ({ steer: Math.sin(tm * 2) * 0.5, throttle: tm < 1.5 ? 1 : 0, brake: tm >= 1.5 ? 1 : 0 });
    assert.deepEqual(drive(ai, flat(n), 3, input), drive(p, flat(n), 3, input), n + ' tyres off: same trace for a bot');
    assert.equal(ai.car.offLvl, p.car.offLvl);
  }
});

test('a pit lane in use counts as track; the same ground is off-track for a car not in the pits', () => {
  for (const [id, t] of tracks) {
    const p = t.pit;
    const lane = (q) => t.wrapS(p.entry0 + q);
    // the main lane at the boxes and the fast lane, entry and exit ramps
    for (const q of [p.E + 5, (p.E + p.len - p.X) / 2, p.len - p.X - 5]) {
      for (const d of [p.fastD, p.boxD]) assert.equal(placed(t, lane(q), p.side * d, 0, { phase: 'in' }).offN, 0, id + ' pit lane q=' + q.toFixed(0));
    }
    const ramp = lane(p.E * 0.6), dRamp = p.side * (t.halfW + 4);
    assert.equal(placed(t, ramp, dRamp, 0, { phase: 'queue' }).offN, 0, id + ' entry ramp while pitting');
    assert.equal(placed(t, ramp, dRamp, 0, null).offN, 4, id + ' entry ramp is not a shortcut for others');
  }
  // through a real stop: never counted off-track in the lane or on rejoining
  const t = tracks.get('redridge');
  const S = new SIM.Session(t, { type: 'race', laps: 3, entries: [{ driver: SIM.DRIVERS[0] }], seed: 11, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, mandatory: false, weatherState: DRY(3) });
  S.totalLaps = 3; S.mandatory = false; const car = S.cars[0];
  let pitted = false, lastPit = -1;
  while (!S.over && S.time < 400) {
    S.fixedStep(dt);
    if (car.laps === 1 && !car.pitStops && !car.pit) { car.ai.boxThisLap = true; car.boxCompound = car.tyre.c; }
    if (car.pit) { pitted = true; lastPit = S.time; assert.equal(car.offN, 0, 'in the pit lane, phase ' + car.pit.phase); }
    else if (lastPit > 0 && S.time - lastPit < 4) assert.equal(car.offN, 0, 'rejoining from the pit exit');
  }
  assert.ok(pitted && car.pitStops === 1 && car.finished);
});

test('the silent progress check: off-track progress counts only movement along the circuit', () => {
  const t = tracks.get('summit');
  const S = new SIM.Session(t, { type: 'race', laps: 2, entries: [{ driver: SIM.DRIVERS[0] }], seed: 1, spectate: true, weatherState: DRY(1) });
  const car = S.cars[0], corner = t.corners.reduce((a, c) => (c.R < a.R ? c : a)), i = corner.apex;
  car.idx = i; const tx = t.tx[i], tz = t.tz[i];
  car.offN = 2; assert.equal(S.legalProgress(car, 3, 0.5 * tx, 0.5 * tz), 3, 'with a tyre on the track all progress counts');
  car.offN = 4;
  car.d = 0; assert.ok(Math.abs(S.legalProgress(car, 3, 0.5 * tx, 0.5 * tz) - 0.5) < 1e-9, 'only the distance moved along the circuit');
  const inside = Math.sign(t.kappa[i]) * (t.halfW + 4); car.d = inside;
  assert.ok(S.legalProgress(car, 3, 0.5 * tx, 0.5 * tz) < 0.5 * (1 - Math.abs(t.kappa[i]) * Math.abs(inside)) + 1e-9, 'less again on the inside of the corner');
  car.d = -inside; assert.ok(Math.abs(S.legalProgress(car, 1, 2 * tx, 2 * tz) - 1) < 1e-9, 'running wide on the outside: full circuit distance');
  assert.ok(S.legalProgress(car, 3, -tz * 3, tx * 3) < 1e-9, 'moving across the circuit earns nothing');
  assert.equal(S.legalProgress(car, 45, 45 * tx, 45 * tz), 0, 'a jump to another part of the circuit earns nothing');
  car.pit = { phase: 'in' }; assert.equal(S.legalProgress(car, 3, 0.5 * tx, 0.5 * tz), 3, 'the pit lane in use is track');
});

// one car laps Rivermere; on lap 2 it either drives the corner or cuts a chord across its inside at full throttle
function cornerRun(cut) {
  const t = tracks.get('rivermere'), c = t.corners.find(k => k.apex * 2 === 4478);
  const ia = t.wrapI(c.start - 15), ib = t.wrapI(c.end + 15), span = t.dS(ia * 2, ib * 2), B = t.pointAt(ib * 2, 0);
  const S = new SIM.Session(t, { type: 'race', laps: 3, entries: [{ driver: SIM.DRIVERS[0] }], seed: 11, spectate: true, weather: 'dynamic', tyreWear: 'off', mistakes: 0, mandatory: false, weatherState: DRY(3) });
  S.totalLaps = 3; const car = S.cars[0], own = car.ai.update.bind(car.ai);
  let t0 = null, d0 = 0, section = null, crossedAt = null, lapAt = null, maxOff = 0;
  while (!S.over && S.time < 500) {
    if (t0 == null && car.laps === 1 && Math.abs(t.dS(car.s, ia * 2)) < 3) {
      t0 = S.time; d0 = car.totalDist;
      if (cut) car.ai.update = function () {
        const cs = Math.cos(car.psi), sn = Math.sin(car.psi), lx = (B[0] - car.x) * cs + (B[1] - car.z) * sn, ly = -(B[0] - car.x) * sn + (B[1] - car.z) * cs;
        this.handling.step(car, dt, S, { steer: Math.max(-1, Math.min(1, Math.atan2(ly, lx) * 3)), throttle: 1, brake: 0, analog: true });
      };
    }
    if (cut && t0 != null && car.ai.update !== own && Math.hypot(car.x - B[0], car.z - B[1]) < 6) car.ai.update = own;
    const prevS = car.s;
    S.fixedStep(dt);
    if (t0 != null) maxOff = Math.max(maxOff, car.offN);
    if (t0 != null && section == null && car.totalDist - d0 >= span + 250) section = S.time - t0;
    if (car.laps === 1 && crossedAt == null && prevS > t.length * 0.9 && car.s < t.length * 0.1) crossedAt = S.time;
    if (car.laps === 2 && lapAt == null) lapAt = S.time;
  }
  return { S, car, section, maxOff, deficit: t.dS(t.wrapS(car.totalDist), car.s) };
}

test('cutting a corner across the inside is slower than driving it, without any penalty or message', () => {
  const legit = cornerRun(false), cut = cornerRun(true);
  assert.equal(cut.maxOff, 4, 'the cut car really left the track');
  assert.ok(cut.section > legit.section, `corner section: cut ${cut.section.toFixed(2)} s vs driven ${legit.section.toFixed(2)} s`);
  assert.ok(cut.car.finishTime > legit.car.finishTime, 'and over the race');
  assert.ok(cut.deficit > 15, 'the skipped distance is owed: ' + cut.deficit.toFixed(1) + ' m');
  assert.equal(Math.abs(legit.deficit) < 0.5, true);
  assert.equal(cut.car.penaltyLog.length, 0); assert.equal(cut.car.warnings, 0);
  assert.ok(cut.car.lapTimes.every(l => l.valid), 'no lap deleted');
  assert.ok(!cut.S.messages.some(m => /TRACK LIMITS|DELETED|INVALID/i.test(m.text)), 'no notification');
  assert.equal(cut.car.laps, 3); assert.ok(cut.car.finished && !cut.car.dnf);
});

test('qualifying: leaving the track deletes nothing, and the lap only ends once a full lap has been earned', () => {
  const t = tracks.get('summit');
  const S = new SIM.Session(t, { type: 'quali', entries: SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), seed: 4, spectate: true, weather: 'dynamic', weatherState: DRY(1) });
  let flying = null, offFlying = 0;
  while (!S.over && S.time < 600) {
    S.fixedStep(dt);
    for (const c of S.cars) {
      if (c.q.phase === 'flying') {
        // shove the first car onto the grass in the middle of its flying lap
        if (!flying && c.q.distance > 2500) { flying = c; c.placeAt(t, c.s, t.pit.side * -(t.halfW + 4), c.speed); }
        if (c === flying && c.offN === 4) offFlying++;
      }
    }
  }
  assert.ok(flying && offFlying > 0, 'a flying lap went off the track');
  assert.equal(flying.q.result, 'valid', 'lap kept: ' + flying.q.reason);
  assert.ok(flying.q.distance >= t.length, 'a full lap was earned');
  assert.ok(!S.messages.some(m => /TRACK LIMITS|DELETED|INVALID/i.test(m.text)));
});

test('AI drivers shoved off the track at speed recover on their own, with no resets or penalties', () => {
  for (const [id, t] of tracks) {
    const S = new SIM.Session(t, { type: 'race', laps: 3, entries: SIM.DRIVERS.map(driver => ({ driver })), seed: 5, spectate: true, weather: 'dynamic', weatherState: DRY(5) });
    S.totalLaps = 3;
    let resets = 0; const reset = S.marshalReset.bind(S); S.marshalReset = (c) => { resets++; return reset(c); };
    const pushed = new Map(); let k = 0;
    while (!S.over && S.time < 1100) {
      S.fixedStep(dt);
      if (S.lightsOut && S.time > 30 && S.time < 230 && Math.abs(S.time % 5) < dt) {
        const c = S.cars.find(c => !c.pit && !c.dnf && !c.finished && !pushed.has(c) && c.ai.mode === 'race');
        if (c) {
          // either side, 3–9 m beyond the edge, at 60–260 km/h: along the track, angled back towards it, or (slowly)
          // angled 20° away from it
          const side = k % 2 ? 1 : -1, v = [260, 180, 120, 60][(k >> 1) % 4] / 3.6, w = {};
          t.walls(c.idx, c.s, false, w);
          const d = Math.max(-w.l + 3, Math.min(w.r - 3, side * (t.halfW + [3, 6, 9][k % 3])));
          const yaw = side * (v < 20 ? 0.35 : [0, -0.25][k % 2]); // +yaw turns towards +d
          c.placeAt(t, c.s, d, v); c.psi += yaw;
          c.vx = Math.cos(c.psi) * v; c.vz = Math.sin(c.psi) * v;
          pushed.set(c, { at: S.time, back: null, v: Math.round(v * 3.6), yaw, d }); k++;
        }
      }
      for (const [c, p] of pushed) if (p.back == null && S.time - p.at > 0.1 && c.offN === 0) p.back = S.time - p.at;
    }
    assert.ok(S.over && pushed.size >= 30 / 5, id + ' race over with cars pushed off: ' + pushed.size);
    for (const [c, p] of pushed) assert.ok(p.back != null && p.back < 15, `${id} ${c.driver.short} back on track after ${p.back} (dnf ${c.dnf} ${c.dnfReason || ''}, ${c.ai.mode}, d ${c.d.toFixed(1)}, ${p.v} km/h ${p.yaw} rad from d ${p.d.toFixed(1)})`);
    assert.equal(resets, 0, id + ' nobody needed a marshal reset');
    // every car took the flag or retired from racing damage later on (contact between cars); none stuck or out of fuel
    assert.ok(S.cars.every(c => c.finished || (c.dnf && c.dnfReason !== 'Out of fuel')), id + ' every car finished or retired: ' + S.cars.filter(c => !c.finished).map(c => c.driver.short + ' ' + c.dnfReason));
    assert.ok(!S.cars.some(c => c.penaltyLog.some(r => /track limits/i.test(r)) || c.warnings));
  }
});
