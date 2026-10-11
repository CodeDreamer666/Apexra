const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual game controller and tyre physics on a flat, unobstructed test surface.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const SIM = context.module.exports;
const dt = SIM.PHYS_DT;
const track = { cx: [0], cz: [0], rx: [0], rz: [1], surfaceAt: () => 0, pit: { limit: 22 } };
const env = { wet: 0, wearScale: 0, fuelRate: 0, pitLimiter: false, holdStart: false };
const raw = (steer = 0, throttle = 0, brake = 0) => ({ steer, throttle, brake, analog: false });
function rig(speed = 30) {
  const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, {});
  car.vx = car.u = car.speed = speed;
  car.gear = speed > 50 ? 7 : speed > 20 ? 4 : 1;
  car.rpm = 10000;
  return { car, handling: new SIM.PlayerHandling(), maxSlip: 0 };
}
function run(r, input, seconds, fps = 60) {
  const steps = Math.round(seconds / dt), perFrame = 240 / fps;
  for (let frame = 0; frame < steps; frame += perFrame) {
    for (let step = frame; step < Math.min(frame + perFrame, steps); step++) {
      r.handling.step(r.car, dt, { lightsOut: true, wet: 0 }, input);
      SIM.stepCarPhysics(r.car, dt, track, env);
      r.maxSlip = Math.max(r.maxSlip, Math.abs(r.car.slideAngle));
      for (const k of ['x', 'z', 'psi', 'speed', 'u', 'v', 'r']) assert.ok(Number.isFinite(r.car[k]), k);
    }
  }
  return r;
}

test('W accelerates; releasing it coasts rather than applying full brakes', () => {
  const drive = run(rig(60), raw(0, 1), 3);
  const coast = run(rig(60), raw(), 3);
  assert.ok(drive.car.speed > 70);
  assert.ok(coast.car.speed > 30 && coast.car.speed < 60);
  assert.equal(coast.car.input.brake, 0);
});

test('S stops and holds the car without selecting reverse or generating drive', () => {
  for (const input of [raw(0, 0, 1), raw(1, 0, 1), raw(0, 1, 1)]) {
    const r = run(rig(30), input, 8);
    assert.equal(r.car.speed, 0);
    assert.equal(r.car.u, 0);
    assert.equal(r.car.gear, 1);
    assert.equal(r.car.input.throttle, 0);
  }
  const stopped = run(rig(0), raw(1, 0, 1), 8);
  assert.equal(stopped.car.x, 0);
  assert.equal(stopped.car.z, 0);
  assert.equal(stopped.car.psi, 0);
});

test('steering never applies brakes or imposes a throttle cut at any speed', () => {
  for (const speed of [15, 30, 60, 85]) {
    for (const direction of [-1, 1]) {
      for (const analog of [false, true]) {
        const r = rig(speed);
        for (let step = 0; step < 240; step++) {
          r.handling.step(r.car, dt, { lightsOut: true, wet: 0 }, { ...raw(direction, 1), analog });
          assert.equal(r.car.input.brake, 0);
          // With no rear slip, steering cannot cut the requested throttle.
          if (step > 60 && Math.abs(r.car.slipA[2] + r.car.slipA[3]) / 2 <= 0.1) {
            assert.equal(r.car.input.throttle, 1);
          }
          SIM.stepCarPhysics(r.car, dt, track, env);
        }
        assert.ok(r.car.psi * direction > 0.1);
        assert.ok(r.car.speed > speed * 0.75);
      }
    }
  }
});

test('W+S+steering produces a bounded drift; S+steering stays planted', () => {
  const brake = run(rig(30), raw(1, 0, 1), 1);
  for (const direction of [-1, 1]) {
    const drift = run(rig(30), raw(direction, 1, 1), 1);
    assert.ok(drift.maxSlip > 0.06 && drift.maxSlip < 0.15);
    assert.ok(drift.maxSlip > brake.maxSlip + 0.05);
    assert.ok(drift.car.psi * direction > 0.4);
    assert.ok(drift.car.speed < 25 && drift.car.u > 0);
  }
  assert.equal(brake.handling.drift, 0);
  assert.ok(brake.maxSlip < 0.08);
});

test('drift entry at high speed uses a smaller slide angle', () => {
  const slow = run(rig(30), raw(1, 1, 1), 0.75);
  const fast = run(rig(85), raw(1, 1, 1), 0.75);
  assert.ok(fast.maxSlip < slow.maxSlip);
  assert.ok(fast.maxSlip < 0.25);
});

test('releasing the combination recovers grip, steering and acceleration', () => {
  const r = run(rig(30), raw(1, 1, 1), 1);
  const exitSpeed = r.car.speed;
  run(r, raw(0, 1), 2);
  assert.equal(r.handling.drift, 0);
  assert.equal(r.handling.steer, 0);
  assert.ok(Math.abs(r.car.slideAngle) < 0.02);
  assert.ok(Math.abs(r.car.r) < 0.02);
  assert.ok(r.car.speed > exitSpeed + 10);
});

test('dropping any one drift input ends the drift request', () => {
  for (const input of [raw(1, 1, 0), raw(1, 0, 1), raw(0, 1, 1)]) {
    const r = run(rig(30), raw(1, 1, 1), 0.5);
    run(r, input, 0.5);
    assert.equal(r.handling.drift, 0);
  }
});

test('changing steering direction responds without spinning', () => {
  const r = run(rig(30), raw(1, 1), 0.3);
  run(r, raw(-1, 1), 0.3);
  assert.ok(r.handling.steer < -0.9 && r.car.r < 0);
  assert.ok(r.maxSlip < 0.1);
});

test('physics produces the same movement with 30, 60 and 120 Hz frame grouping', () => {
  const snapshots = [30, 60, 120].map(fps => {
    const r = run(rig(30), raw(1, 1, 1), 0.5, fps);
    run(r, raw(0, 1), 1, fps);
    return ['x', 'z', 'psi', 'speed', 'r'].map(k => r.car[k]);
  });
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
});

// Targets come from the usable HUD segments in reference/poki-measurements.md.
// Allow for integer HUD rounding and the reference renderer's clock/display lag.
test('arcade acceleration matches the observed 35–158 km/h segment', () => {
  const r = run(rig(35 / 3.6), raw(0, 1), 1.85);
  assert.ok(r.car.speed * 3.6 > 145 && r.car.speed * 3.6 < 170);
});

test('coasting matches the observed 191–183 km/h segment', () => {
  const r = run(rig(191 / 3.6), raw(), 0.63);
  assert.ok(r.car.speed * 3.6 > 178 && r.car.speed * 3.6 < 188);
  assert.equal(r.car.input.brake, 0);
});

test('S sheds speed progressively like the observed 58–17 km/h segment', () => {
  const r = run(rig(58 / 3.6), raw(0, 0, 1), 2.69);
  assert.ok(r.car.speed * 3.6 > 13 && r.car.speed * 3.6 < 23);
  run(r, raw(0, 0, 1), 6);
  assert.ok(r.car.speed < 0.01 && r.car.u >= -0.01);
});

test('arcade force respects fuel exhaustion and the pit limiter', () => {
  const empty = rig(20); empty.car.fuel = 0;
  run(empty, raw(0, 1), 2);
  assert.ok(empty.car.speed < 20);
  const pit = rig(30);
  for (let i = 0; i < 480; i++) {
    pit.handling.step(pit.car, dt, { lightsOut: true, wet: 0 }, raw(0, 1));
    SIM.stepCarPhysics(pit.car, dt, track, { ...env, pitLimiter: true });
  }
  assert.ok(pit.car.speed < track.pit.limit + 0.5);
});

function headlessRace(count, cfg = {}) {
  const realTrack = new SIM.Track(SIM.TRACK_DEF);
  const entries = SIM.DRIVERS.slice(0, count).map(driver => ({ driver }));
  const sess = new SIM.Session(realTrack, { type: 'race', laps: 1, difficulty: 0.8, entries, seed: 7, spectate: true, ...cfg });
  sess.totalLaps = sess.cfg.laps; // sessions are built for the 8-lap race; these runs are shorter
  return sess;
}

test('bots drive through the same arcade handling as the player', () => {
  const sess = headlessRace(4);
  for (let frame = 0; frame < 60 * 150 && !sess.over; frame++) {
    sess.update(1 / 60, 1, 1e9);
    if (!sess.lightsOut) continue;
    for (const car of sess.cars) {
      assert.ok(car.ai.handling instanceof SIM.PlayerHandling);
      assert.equal(car.aids.arcade, true);
      assert.ok(car.gear >= 1, 'bots never reverse, like the player');
      assert.notEqual(car.ai.mode, 'recover');
    }
  }
  assert.ok(sess.over, 'every bot finished the lap');
  for (const car of sess.cars) assert.ok(car.finished && !car.dnf && car.penaltyLog.length === 0);
});

test('a bot command reaches the car exactly as the same player input would', () => {
  const player = rig(40), bot = rig(40);
  const sess = { lightsOut: true, wet: 0 };
  const ai = new SIM.AIDriver(bot.car, { track: { length: 1000 }, difficulty: 0.8 });
  for (let step = 0; step < 720; step++) {
    const cmd = { steer: Math.sin(step / 90), throttle: step % 300 < 200 ? 1 : 0, brake: step % 300 >= 240 ? 0.6 : 0, analog: true };
    player.handling.step(player.car, dt, sess, cmd);
    Object.assign(ai.cmd, cmd); ai.handling.step(bot.car, dt, sess, ai.cmd);
    SIM.stepCarPhysics(player.car, dt, track, env);
    SIM.stepCarPhysics(bot.car, dt, track, env);
  }
  assert.deepEqual(['x', 'z', 'psi', 'speed', 'r'].map(k => bot.car[k]), ['x', 'z', 'psi', 'speed', 'r'].map(k => player.car[k]));
});

test('the pit autopilot stops in a shared box using the arcade handling; the player then chooses the service', () => {
  const sess = headlessRace(2, { laps: 2, spectate: false, entries: [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1], isPlayer: true }] });
  const p = sess.player; p.autoDrive = true; p.boxRequest = true;
  let stopped = false, chose = false;
  for (let frame = 0; frame < 60 * 200 && !sess.over; frame++) {
    p.autopilot.boxThisLap = p.boxRequest;
    sess.update(1 / 60, 1, 1e9);
    if (sess.lightsOut && !p.inGarage) assert.equal(p.aids.arcade, true);
    if (p.pit && p.pit.phase === 'awaiting' && !chose) {
      chose = true;
      assert.ok(p.frozen && p.speed === 0, 'the car waits, stationary, in its box');
      assert.ok(sess.pitBoxes.includes(p), 'and occupies a shared box while the player decides');
      assert.ok(sess.confirmPitService(p, { tyre: 'H', fuel: 0 }));
    }
    if (p.pit && p.pit.phase === 'stopped') stopped = true;
  }
  assert.ok(chose && stopped);
  assert.equal(p.pitStops, 1);
  assert.equal(p.tyre.c, 'H');
});

test('ERS and DRS are gone; loose surfaces slow acceleration', () => {
  const standard = run(rig(60), raw(0, 1), 2);
  assert.equal(SIM.SPEC.ersMax, undefined);
  for (const k of ['ers', 'ersDeploy', 'harvesting']) assert.ok(!(k in standard.car), 'no ' + k + ' on the car');
  assert.ok(!('ers' in standard.car.input), 'no ERS control input');
  for (const k of ['drsOpen', 'drsAvail']) assert.ok(!(k in standard.car), 'no ' + k + ' on the car');
  assert.ok(!('drs' in standard.car.input), 'no DRS control input');
  // a stale DRS flag set from outside does nothing: same speed as the standard run
  const drs = rig(60); drs.car.drsOpen = true; drs.car.input.drs = true;
  run(drs, raw(0, 1), 2);
  assert.equal(drs.car.speed, standard.car.speed);
  const gravel = rig(60);
  for (let i = 0; i < 480; i++) {
    gravel.handling.step(gravel.car, dt, { lightsOut: true, wet: 0 }, raw(0, 1));
    SIM.stepCarPhysics(gravel.car, dt, { ...track, surfaceAt: () => 3 }, env);
  }
  assert.ok(gravel.car.speed < standard.car.speed);
});


test('short digital steering taps produce prompt micro-adjustments at road speeds', () => {
  for (const speed of [15, 30, 60]) {
    for (const direction of [-1, 1]) {
      const short = run(rig(speed), raw(direction, 1), 0.06);
      assert.ok(short.car.psi * direction > 0.025);
      const reference = run(rig(speed), raw(direction, 1), 0.19);
      const angle = reference.car.psi * direction * 180 / Math.PI;
      assert.ok(angle > 7 && angle < 12, `speed ${speed}: ${angle} degrees`);
      const entryRate = reference.car.r;
      run(reference, raw(0, 1), 0.3);
      assert.ok(Math.abs(reference.car.r) < Math.abs(entryRate) * 0.06);
    }
  }
});

test('automatic drift tightens the arc promptly and releases without manual countersteer', () => {
  for (const direction of [-1, 1]) {
    const turn = run(rig(30), raw(direction, 1), 0.4);
    const drift = run(rig(30), raw(direction, 1, 1), 0.4);
    assert.ok(Math.abs(drift.car.psi) > Math.abs(turn.car.psi) * 1.15);
    assert.ok(drift.maxSlip > 0.05 && drift.maxSlip < 0.15);
    const speed = drift.car.speed;
    run(drift, raw(0, 1), 0.35);
    assert.equal(drift.handling.drift, 0);
    assert.ok(Math.abs(drift.car.slideAngle) < 0.015);
    assert.ok(drift.car.speed > speed);
  }
});

test('all 16 WASD states and their arrow equivalents reach the same controller inputs', () => {
  for (let bits = 0; bits < 16; bits++) {
    const expected = raw((bits & 8 ? 1 : 0) - (bits & 4 ? 1 : 0), bits & 1 ? 1 : 0, bits & 2 ? 1 : 0);
    for (const keys of [['KeyW', 'KeyS', 'KeyA', 'KeyD'], ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']]) {
      const keyboard = new SIM.KeyboardDriveInput();
      keys.forEach((key, i) => keyboard.setKey(key, !!(bits & 1 << i), 0));
      const input = keyboard.step(dt);
      for (const k of ['steer', 'throttle', 'brake', 'analog']) assert.equal(input[k], expected[k]);
    }
  }
});

test('a tap entirely between rendered frames still turns the real car', () => {
  const keyboard = new SIM.KeyboardDriveInput();
  keyboard.setKey('KeyW', true, 0);
  keyboard.step(dt);
  keyboard.setKey('KeyA', true, 1);
  keyboard.setKey('KeyA', false, 1.06);
  const r = rig(30);
  for (let i = 0; i < 60; i++) run(r, keyboard.step(dt), dt);
  assert.ok(r.car.psi < -0.06);
  assert.equal(keyboard.pending.length, 0);
  assert.equal(keyboard.step(dt).steer, 0);
});

test('buffered three-key drift preserves the combination and clears on reset', () => {
  const keyboard = new SIM.KeyboardDriveInput();
  for (const k of ['KeyW', 'KeyS', 'KeyD']) keyboard.setKey(k, true, 1);
  for (const k of ['KeyD', 'KeyS', 'KeyW']) keyboard.setKey(k, false, 1.08);
  const r = rig(30);
  for (let i = 0; i < 20; i++) run(r, keyboard.step(dt), dt);
  assert.ok(r.handling.drift > 0.5 && r.car.psi > 0.05);
  keyboard.reset();
  assert.equal(keyboard.pending.length, 0);
  assert.equal(keyboard.step(dt).steer, 0);
  assert.equal(keyboard.step(dt).throttle, 0);
  assert.equal(keyboard.step(dt).brake, 0);
});

test('a steering hold already consumed by physics gets no extra buffered turn', () => {
  const keyboard = new SIM.KeyboardDriveInput();
  keyboard.setKey('KeyA', true, 0);
  assert.equal(keyboard.step(dt).steer, -1);
  keyboard.setKey('KeyA', false, 1);
  assert.equal(keyboard.pending.length, 0);
  assert.equal(keyboard.step(dt).steer, 0);
});


test('all moving key combinations have the expected turn, brake and drift behavior', () => {
  for (let bits = 0; bits < 16; bits++) {
    const keyboard = new SIM.KeyboardDriveInput();
    ['KeyW', 'KeyS', 'KeyA', 'KeyD'].forEach((k, i) => keyboard.setKey(k, !!(bits & 1 << i), 0));
    const input = keyboard.step(dt), r = run(rig(30), input, 0.4);
    if (input.steer) assert.ok(r.car.psi * input.steer > 0.1);
    else assert.equal(r.car.psi, 0);
    const drift = input.throttle && input.brake && input.steer;
    assert.equal(r.handling.drift > 0, !!drift);
    if (input.brake && !drift) {
      assert.equal(r.car.input.throttle, 0);
      assert.ok(r.car.speed < 30);
    }
    assert.ok(r.car.u > 0);
  }
});

test('respawn discards queued taps while preserving currently held pedals', () => {
  const keyboard = new SIM.KeyboardDriveInput();
  keyboard.setKey('KeyW', true, 0);
  keyboard.step(dt);
  keyboard.setKey('KeyD', true, 1);
  keyboard.setKey('KeyD', false, 1.06);
  assert.ok(keyboard.pending.length);
  keyboard.clearPending();
  assert.equal(keyboard.pending.length, 0);
  assert.equal(keyboard.step(dt).throttle, 1);
  assert.equal(keyboard.step(dt).steer, 0);
});

// ---------------------------------------------------------------------------
// Collision damage, failures, pit repairs and retirement (same rules for every car).
// ---------------------------------------------------------------------------
const circuit = new SIM.Track(SIM.TRACK_DEF);
// a point on the main straight after the pit exit, well before turn 1
const STRAIGHT = 600;
// a race session whose cars are not driven, so impacts can be staged on the real circuit
function crashLab(level, n = 2, seed = 3) {
  const entries = SIM.DRIVERS.slice(0, n).map(driver => ({ driver }));
  const S = new SIM.Session(circuit, { type: 'race', laps: 5, entries, seed, spectate: true, damage: level });
  S.lightsOut = true; S.time = 20; for (const c of S.cars) { c.ai = null; c.started = true; }
  return S;
}
function place(car, s, d, v, yaw = 0) {
  car.placeAt(circuit, s, d, 0); car.psi += yaw; car.vx = Math.cos(car.psi) * v; car.vz = Math.sin(car.psi) * v; car.r = 0;
  Object.assign(car.input, { throttle: 0, brake: 0, steer: 0 }); car.gear = 6;
}
const simulate = (S, sec) => { for (let k = 0; k < sec * 240; k++) S.fixedStep(1 / 240); };
const worst = (car) => Math.max(...car.damage.c);
function sideSwipe(level, lateral, v = 60) {
  const S = crashLab(level); const [A, B] = S.cars;
  place(A, STRAIGHT, -1.0, v); place(B, STRAIGHT, 1.05, v);
  A.vx -= Math.sin(A.psi) * lateral; A.vz += Math.cos(A.psi) * lateral;
  simulate(S, 0.6); return [A, B];
}
function rearEnd(level, closing, v = 50, seed = 3) {
  const S = crashLab(level, 2, seed); const [A, B] = S.cars;
  place(B, STRAIGHT + 7, 0, v); place(A, STRAIGHT, 0, v + closing);
  simulate(S, 0.8); return [A, B, S];
}
function wallHit(level, v, angle = 0.5) {
  const S = crashLab(level, 1); const [A] = S.cars;
  const w = circuit.walls(circuit.wrapI(Math.round(STRAIGHT / SIM.DS)), STRAIGHT, false, { l: 0, r: 0, innerPit: 0 });
  place(A, STRAIGHT, w.r - 3.2, v, angle);
  simulate(S, 1.2); return [A, S];
}

test('gentle wheel-to-wheel contact at similar speeds causes no damage on any level', () => {
  for (const level of ['reduced', 'standard', 'realistic']) {
    for (const lateral of [0.8, 1.5, 3]) {
      const [A, B] = sideSwipe(level, lateral);
      assert.ok(worst(A) < 0.01 && worst(B) < 0.01, `${level} ${lateral} m/s`);
      assert.ok(!A.damage.anyPuncture() && !B.damage.anyPuncture());
      assert.ok(!A.retiring && !B.retiring);
    }
  }
});

test('damage follows the relative impact speed, not how fast the cars are going', () => {
  const [fastA, fastB] = rearEnd('standard', 3, 80);
  assert.ok(worst(fastA) < 0.02 && worst(fastB) < 0.02, 'a 3 m/s tap at 290 km/h is harmless');
  const [slowA, slowB] = rearEnd('standard', 12, 25);
  assert.ok(slowA.damage.fw > 0.2, 'a 12 m/s rear-end at 90 km/h breaks the front wing');
  assert.ok(slowB.damage.c[2] > 0.05, 'and damages the rear wing it hit');
  const order = [3, 6, 10, 15, 25].map(dv => rearEnd('standard', dv)[0].damage.fw);
  for (let k = 1; k < order.length; k++) assert.ok(order[k] >= order[k - 1]);
});

test('wall impacts: a moderate hit damages the wing, a heavy one ends the race', () => {
  const [light] = wallHit('standard', 20);
  assert.ok(light.damage.fw > 0.1 && !light.retiring && light.damage.maxSus < 0.1);
  const [medium] = wallHit('standard', 45);
  assert.ok(medium.damage.detached[1] && medium.damage.maxSus > 0.15 && !medium.retiring);
  const [heavy, S] = wallHit('standard', 60);
  assert.ok(heavy.retiring && heavy.damage.failed === 'suspension');
  simulate(S, 25);
  assert.ok(heavy.dnf && heavy.dnfReason === 'Suspension', 'the car stops and is classified DNF');
});

test('the damage setting changes real outcomes: Reduced < Standard < Realistic', () => {
  const fw = (level) => rearEnd(level, 10)[0].damage.fw;
  assert.ok(fw('reduced') < fw('standard') && fw('standard') < fw('realistic'));
  assert.ok(!wallHit('reduced', 60)[0].retiring, 'Reduced keeps a heavily damaged car running');
  assert.ok(wallHit('realistic', 60)[0].retiring);
  for (const level of ['reduced', 'standard', 'realistic']) {
    for (const lateral of [1.5, 3]) assert.ok(worst(sideSwipe(level, lateral)[0]) < 0.01);
  }
});

test('repeated minor knocks accumulate, and a weakened part gives way sooner', () => {
  const lv = SIM.DAMAGE_LEVELS.standard;
  const D = new SIM.CarDamage();
  for (let k = 0; k < 12; k++) D.applyImpact(2000, 2.6, 0.5, 0.2, lv); // each below the wing's damage threshold
  assert.ok(D.c[1] > 0.1, 'stress from repeated contact adds up');
  const fresh = new SIM.CarDamage(), worn = new SIM.CarDamage();
  worn.c[1] = 0.5; const before = worn.c[1];
  fresh.applyImpact(5000, 2.6, 0.5, 0.2, lv); worn.applyImpact(5000, 2.6, 0.5, 0.2, lv);
  assert.ok(worn.c[1] - before > fresh.c[1], 'the same hit does more to an already damaged wing');
});

test('punctures need a cutting contact with a real speed difference', () => {
  let cut = 0, rub = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const S = crashLab('standard', 2, seed); const [A, B] = S.cars;
    const ev = (vn, vt) => ({ vn, vt, x: B.x, z: B.z });
    const tyreRL = [-SIM.SPEC.b, -0.75, 0.6], wingTip = [2.8, 0.7, 0.6];
    S.damageCar(B, 3000, 2000, tyreRL, ev(6, 9), A, wingTip); if (B.damage.anyPuncture()) cut++;
    const C = S.cars[0]; C.damage.reset();
    S.damageCar(C, 600, 300, [SIM.SPEC.a, 0.8, 1], ev(1.5, 0.5), B, [-SIM.SPEC.b, -0.8, 1]); if (C.damage.anyPuncture()) rub++;
  }
  assert.ok(cut > 10 && cut < 100, `wing endplate into a tyre at speed: ${cut}/120 punctures`);
  assert.equal(rub, 0, 'wheels rubbing at similar speed never puncture');
});

test('damage changes the handling: understeer, pull, rear instability, punctures, power', () => {
  const steerFor = (setup, seconds = 1, steer = 1, speed = 55) => { const r = rig(speed); setup(r.car.damage); r.car.damage.computePerf(); return run(r, raw(steer, 1), seconds); };
  const clean = steerFor(() => {});
  const noWing = steerFor(D => { D.c[0] = D.c[1] = 1; });
  assert.ok(noWing.car.psi < clean.car.psi * 0.85, 'a lost front wing turns in less (understeer)');
  const pull = steerFor(D => { D.c[5] = 0.5; }, 1.5, 0);
  assert.ok(pull.car.psi > 0.03, 'bent front-right suspension pulls the car right with no steering');
  const pullL = steerFor(D => { D.c[4] = 0.5; }, 1.5, 0);
  assert.ok(pullL.car.psi < -0.03, 'and front-left pulls left');
  const flat = new SIM.CarDamage(); flat.punct[2] = 1; flat.punctRate[2] = 1; flat.computePerf();
  assert.ok(flat.perf.brake < 1 && flat.perf.traction < 1 && flat.perf.rearStab < 1 && flat.perf.topMul < 1 && flat.pullRate(40) < 0);
  const rear = new SIM.CarDamage(); rear.c[2] = 0.8; rear.computePerf();
  assert.ok(rear.perf.rearStab < 0.7, 'rear wing damage lowers rear stability');
  const floor = new SIM.CarDamage(); floor.c[3] = 1; floor.computePerf();
  assert.ok(floor.perf.clAMul < 0.7 && floor.turnMul(60) < floor.turnMul(10), 'floor damage costs downforce, mostly at speed');
  const pu = new SIM.CarDamage(); pu.c[8] = 0.7; pu.computePerf();
  assert.ok(pu.perf.power < 0.8 && pu.perf.misfire > 0);
  const top = (D) => { const r = rig(60); D(r.car.damage); r.car.damage.computePerf(); return run(r, raw(0, 1), 6).car.speed; };
  assert.ok(top(D => { D.c[8] = 0.8; }) < top(() => {}) - 2, 'a damaged power unit is slower on the straight');
});

test('damaged cooling overheats the power unit, which derates and then wears out', () => {
  const S = crashLab('standard', 1); const [A] = S.cars;
  A.damage.c[9] = 0.85; A.damage.computePerf();
  A.throttle = 1; A.rpm = 11500; A.speed = 70;
  for (let k = 0; k < 900; k++) A.damage.tick(A, 0.1, S); // 90 s flat out
  assert.ok(A.damage.engT > 135, 'runs hot: ' + A.damage.engT.toFixed(0));
  assert.ok(A.damage.perf.power < 0.9, 'engine protection cuts power');
  assert.ok(A.damage.c[8] > 0.05, 'and the power unit wears');
  const B = crashLab('standard', 1).cars[0]; B.throttle = 1; B.rpm = 11500; B.speed = 70;
  for (let k = 0; k < 900; k++) B.damage.tick(B, 0.1, S);
  assert.ok(B.damage.engT < 112 && B.damage.c[8] === 0, 'a healthy car stays cool');
});

test('fires are rare and need a plausible cause; Reduced never has them', () => {
  const fires = (level, prep, trials = 1500) => {
    let n = 0;
    for (let k = 0; k < trials; k++) {
      const S = crashLab(level, 1, 100 + k); const [A] = S.cars; prep(A);
      S.checkFailures(A, A._E || 0); if (A.damage.fire > 0) n++;
    }
    return n / trials;
  };
  const engineDies = (A) => { A.damage.c[8] = 1; };
  const hotFailure = (A) => { A.damage.c[8] = 1; A.damage.engT = 150; };
  assert.equal(fires('reduced', hotFailure, 300), 0);
  assert.ok(fires('standard', engineDies) < 0.05, 'a plain engine failure rarely burns');
  const hot = fires('realistic', hotFailure);
  assert.ok(hot > 0.1 && hot < 0.45, 'an engine failing hot is the plausible fire case: ' + hot);
  assert.equal(fires('realistic', (A) => { A.damage.c[0] = 1; A._E = 40000; }, 300), 0, 'wing damage never starts a fire');
});

test('pit stops: tyres 2–4.5 s, a new front wing about 5 s, a new rear wing about 8 s; structural damage is not repaired', () => {
  const stop = (prep, sel, seed) => {
    const entries = [{ driver: SIM.DRIVERS[0] }, { driver: SIM.DRIVERS[1], isPlayer: true }];
    const S = new SIM.Session(circuit, { type: 'race', laps: 2, entries, seed, damage: 'standard' });
    S.totalLaps = 2;
    const p = S.player; p.autoDrive = true; p.boxRequest = true;
    let P = null, prepped = false;
    for (let f = 0; f < 60 * 150 && !S.over; f++) {
      p.autopilot.boxThisLap = p.boxRequest; S.update(1 / 60, 1, 1e9);
      if (!prepped && p.pit && p.pit.phase === 'in') { prepped = true; prep(p); }
      if (p.pit && p.pit.phase === 'awaiting') assert.ok(S.confirmPitService(p, sel));
      if (p.pit && p.pit.phase === 'stopped') P = p.pit;
      if (P && p.pit && p.pit.phase === 'out') break;
    }
    return [P, p];
  };
  const [tyres] = stop(() => {}, { tyre: 'H', fuel: 0 }, 11);
  assert.ok(tyres.total >= 2 && tyres.total <= 4.5 && !tyres.fwT, 'tyre-only stop ' + tyres.total.toFixed(2));
  const [wing, car] = stop((p) => { p.damage.c[0] = 0.7; p.damage.c[1] = 0.4; p.damage.c[6] = 0.3; p.damage.c[3] = 0.4; p.damage.computePerf(); }, { tyre: 'H', fuel: 0 }, 12);
  assert.ok(wing.fwT >= 4.6 && wing.fwT <= 5.4, 'front wing ' + wing.fwT.toFixed(2));
  assert.equal(wing.total, Math.max(wing.tyreT, wing.fwT), 'tyres and wing at the same time: ' + wing.total.toFixed(2));
  assert.equal(car.damage.fw, 0, 'new front wing fitted');
  assert.ok(car.damage.c[6] >= 0.3 && car.damage.c[3] >= 0.4, 'suspension and floor damage remain');
  assert.equal(car.tyre.c, 'H');
  const [rear, car2] = stop((p) => { p.damage.c[2] = 0.6; p.damage.computePerf(); }, { tyre: 'keep', fuel: 0 }, 13);
  assert.ok(rear.rwT >= 7.4 && rear.rwT <= 8.6 && rear.total === rear.rwT, 'rear wing ' + rear.total.toFixed(2));
  assert.equal(car2.damage.c[2], 0, 'new rear wing fitted');
});

test('a retired car stops, stays out and never corrupts timing or results', () => {
  const S = new SIM.Session(circuit, { type: 'race', laps: 2, entries: SIM.DRIVERS.slice(0, 6).map(driver => ({ driver })), seed: 5, spectate: true, damage: 'standard' });
  S.totalLaps = 2;
  let victim = null;
  for (let f = 0; f < 60 * 400 && !S.over; f++) {
    S.update(1 / 60, 1, 1e9);
    if (!victim && S.lightsOut && S.time - S.lightsOutTime > 30) {
      victim = S.cars.find(c => c.position === 2);
      victim.damage.c[8] = 1; S.checkFailures(victim, 0);
      assert.ok(victim.retiring && victim.damage.perf.power === 0);
    }
    if (victim && victim.dnf) assert.ok(victim.speed === 0 || victim.ghost, 'a retired car does not move again');
  }
  assert.ok(S.over && victim.dnf && victim.dnfReason);
  const last = S.results[S.results.length - 1];
  assert.equal(last.car, victim, 'the retirement is classified last');
  assert.equal(last.points, 0);
  for (const r of S.results) {
    assert.ok(Number.isFinite(r.dist) && (r.dnf || Number.isFinite(r.time)));
    if (!r.dnf) assert.equal(r.laps, 2);
  }
  assert.equal(new Set(S.results.map(r => r.pos)).size, 6);
});

test('bots pit for damage when the repair is worth it, limp in with a puncture, and race on with a scratch', () => {
  const S = new SIM.Session(circuit, { type: 'race', laps: 12, entries: SIM.DRIVERS.slice(0, 2).map(driver => ({ driver })), seed: 9, spectate: true, damage: 'standard' });
  S.lightsOut = true; S.lightsOutTime = 0; S.time = 30;
  const [A, B] = S.cars;
  A.damage.c[0] = A.damage.c[1] = 0.8; A.damage.computePerf(); A.ai.assessDamage();
  assert.ok(A.ai.boxThisLap, 'a badly damaged wing with many laps left is worth a stop');
  B.damage.c[0] = 0.06; B.damage.computePerf(); B.ai.assessDamage();
  assert.ok(!B.ai.boxThisLap, 'a scratched endplate is not');
  S.totalLaps = 1; A.ai.boxThisLap = false; A.ai.damageStop = false; A.ai.assessDamage();
  assert.ok(!A.ai.boxThisLap, 'on the last lap the stop would cost more than it saves');
  B.damage.puncture(3, false); B.ai.assessDamage();
  assert.ok(B.ai.boxThisLap, 'a puncture always means pitting');
});

test('damage persists through a respawn and is gone in the next session', () => {
  const S = crashLab('standard', 1); const [A] = S.cars;
  A.damage.c[0] = 0.6; A.damage.c[5] = 0.3; A.damage.computePerf();
  S.marshalReset(A);
  assert.equal(A.damage.c[0], 0.6); assert.equal(A.damage.c[5], 0.3);
  const fresh = crashLab('standard', 1).cars[0];
  assert.ok(fresh.damage.isClean());
});

// ---- race start: automatic launch control, identical for every car ----
// A car on a flat surface; W (throttle) is pressed from `pressAt` seconds, lights go out at 3 s.
function gridLaunch(pressAt, seconds = 10) {
  const race = { type: 'race', lightsOut: false, time: 0, lightsOutTime: 0, wet: 0 };
  const car = new SIM.Car({ driver: SIM.DRIVERS[0], isPlayer: true }, race); car.input.ers = 0;
  const handling = new SIM.PlayerHandling(), out = { car, rpmAtLightsOut: 0, moved: 0, t100: null };
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    race.time = k * dt;
    if (!race.lightsOut && race.time >= 3) { race.lightsOut = true; race.lightsOutTime = race.time; out.rpmAtLightsOut = car.rpm; }
    handling.step(car, dt, race, raw(0, race.time >= pressAt ? 1 : 0));
    SIM.stepCarPhysics(car, dt, track, env);
    if (!race.lightsOut) out.moved = Math.max(out.moved, Math.hypot(car.x, car.z), car.speed);
    if (out.t100 == null && car.speed * 3.6 >= 100) out.t100 = race.time - Math.max(3, pressAt);
  }
  return out;
}

test('launch control: holding W early only revs to the regulated launch rpm and never moves the car', () => {
  const early = gridLaunch(0.2), late = gridLaunch(2.5);
  for (const r of [early, late]) {
    assert.equal(r.moved, 0, 'no movement before lights out');
    assert.equal(r.rpmAtLightsOut, SIM.SPEC.launchRpm);
    assert.equal(r.car.launch.active, false, 'launch control hands over after the start');
  }
  // how early W was pressed makes no difference at all
  assert.equal(early.t100, late.t100);
  assert.equal(early.car.x, late.car.x);
  assert.equal(early.car.fuel, late.car.fuel, 'no fuel is burnt on the grid');
  assert.ok(early.t100 > 2.5 && early.t100 < 4.5, '0-100 km/h ' + early.t100);
});

test('launch control: W pressed at or after lights out launches the same way; no W keeps the car still', () => {
  const held = gridLaunch(0), atOut = gridLaunch(3), after = gridLaunch(4.5), never = gridLaunch(1e9, 6);
  assert.equal(never.car.speed, 0); assert.equal(never.car.x, 0);
  assert.ok(atOut.t100 >= held.t100, 'no advantage over holding W through the lights');
  // a later press launches the same way from the press; only the tyres have cooled a little while waiting
  assert.ok(Math.abs(after.t100 - atOut.t100) < 0.03, 'a later press gives the same launch from the press');
});

test('race start: all 20 cars sit at the same launch rpm, stay on their grid slots and get no false starts', () => {
  const realTrack = new SIM.Track(SIM.TRACK_DEF);
  const entries = SIM.DRIVERS.slice(0, 20).map((driver, k) => ({ driver, isPlayer: k === 7 }));
  const sess = new SIM.Session(realTrack, { type: 'race', laps: 1, difficulty: 0.8, entries, seed: 11 });
  const player = sess.player, h = new SIM.PlayerHandling();
  player.control = (cdt, s) => h.step(player, cdt, s, raw(0, 1, 0)); // W held from the very beginning
  const grid = sess.cars.map(c => [c.x, c.z]);
  let rpms = null;
  while (!sess.lightsOut) {
    rpms = sess.cars.map(c => c.rpm);
    sess.update(1 / 60, 1, 1e9);
    if (!sess.lightsOut) sess.cars.forEach((c, k) => { assert.equal(c.x, grid[k][0]); assert.equal(c.z, grid[k][1]); assert.equal(c.speed, 0); });
  }
  for (const r of rpms) assert.equal(r, SIM.SPEC.launchRpm);
  for (let k = 0; k < 60 * 6; k++) sess.update(1 / 60, 1, 1e9);
  for (const c of sess.cars) {
    assert.equal(c.penaltyLog.length, 0, 'no false-start penalty');
    // the back of a 20-car grid can still be held up by the traffic ahead of it
    assert.ok(c.speed > 15, 'every car launched: ' + c.driver.short + ' at ' + c.speed.toFixed(1) + ' m/s, s=' + c.s.toFixed(0) + ', d=' + c.d.toFixed(1));
  }
});
