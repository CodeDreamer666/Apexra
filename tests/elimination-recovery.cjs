const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = { exports: {} };
new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(m);
const SIM = m.exports;
// Exercise the recovery callback installed by the actual browser session setup.
// Camera projection is controlled here; track elevation and retirement logic are real.
const start = html.indexOf('  const recoveryProbe = new THREE.Vector3();');
const end = html.indexOf('\n  };', start) + '\n  };'.length;
assert.ok(start >= 0 && end > start);
const installRecovery = new Function('G', 'SIM', 'THREE', 'camera', html.slice(start, end));
class Vector3 {
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  project(camera) {
    assert.ok(Number.isFinite(this.y), 'recovery position has a finite elevation');
    camera.height = this.y;
    Object.assign(this, camera.projected);
    return this;
  }
}
for (const def of SIM.CIRCUITS) for (const playerLast of [false, true]) {
  test(def.id + ': first-lap ' + (playerLast ? 'player' : 'AI') + ' elimination recovers only outside the camera view', () => {
    const S = new SIM.Session(new SIM.Track(def), { type: 'race', gameMode: 'elimination', weather: 'dry', seed: 11,
      entries: SIM.DRIVERS.map((driver, i) => ({ driver, isPlayer: i === (playerLast ? 19 : 0) })) });
    const camera = { projected: { x: 0, y: 0, z: 0 } };
    installRecovery({ session: S, track: S.track }, SIM, { Vector3 }, camera);
    S.lightsOut = true; S.time = 100;
    for (const c of S.cars) {
      c.stepDistance = c.totalDist = S.track.length + (20 - c.gridSlot) * 5;
      c.timedRaceBoundary = c.laps = 1;
    }
    S.eliminationRound(1, 1, SIM.PHYS_DT);
    assert.equal(S.activeOrder.length, 19);
    const car = S.elimination.out[0].car;
    assert.equal(car.isPlayer, playerLast);
    car.placeAt(S.track, 600, S.track.halfW + 5, 0);
    for (const c of S.activeOrder) c.placeAt(S.track, 1500 + c.gridSlot * 25, 0, 35);
    S.parkCar(car); S.time = car.retiring.recoverAt + 1;
    S.retireStep(car, SIM.PHYS_DT);
    assert.equal(car.retiring.phase, 'parked', 'a visible car is not teleported away');
    assert.equal(car.inGarage, false);
    assert.equal(camera.height, S.track.elevAt(car.x, car.z) + .8);
    camera.projected.x = 2; S.time += .3;
    S.retireStep(car, SIM.PHYS_DT);
    assert.equal(car.retiring.phase, 'recovered');
    assert.equal(car.inGarage, true);
    assert.equal(S.elimination.round, 1);
    assert.equal(S.activeOrder.length, 19);
    for (let i = 0; i < 24; i++) S.fixedStep(SIM.PHYS_DT);
  });
}
