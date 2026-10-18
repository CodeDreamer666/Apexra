const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Race classification: one ordering (Session.standings / raceCompare) drives the live positions, the finish,
// the results table and the Career position. Deterministic scenarios with the session's own timing code.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shim = { exports: {} }; new Function('module', html.match(/<script>([\s\S]*?)<\/script>/)[1])(shim);
const SIM = shim.exports, DT = SIM.PHYS_DT;
const track = new SIM.Track(SIM.CIRCUITS.find(c => c.id === 'monza')), L = track.length;

function race(n = 20) {
  const s = new SIM.Session(track, { type: 'race', seed: 5, difficulty: 1, weather: 'dry', damage: 'realistic',
    entries: SIM.DRIVERS.slice(0, n).map((driver, i) => ({ driver, isPlayer: i === 0 })) });
  s.lightsOut = true; s.lightsOutTime = 0; s.time = 10;
  return s;
}
// put a car at a race distance as if it had driven there (completed laps and timing state consistent)
function at(s, car, dist) {
  car.totalDist = dist; car.laps = Math.max(0, Math.floor(dist / L)); car.crossings = car.laps + 1;
  car.lastLapBase = Math.floor(dist / L); car.lastWithin = dist - car.lastLapBase * L; car.lapStart = 0; car.started = true;
  car.sectorIdx = 2;
}
// drive a car forward along the route by d metres in one step at the session's current time
function drive(s, car, d) { car.progress = d; car.totalDist += d; s.timing(car, car.s, DT); }
const pos = (s, car) => (s.standings(), car.position);
// compare cars by id (a Car references the whole session: a failing deepEqual on cars would print all of it)
const ids = (cars) => cars.map(c => c.id);
const order = (s) => ids(s.standings());

test('the player overtaking into the lead is P1 at once, everywhere the position is read', () => {
  const s = race(), me = s.player, rival = s.cars[1];
  s.cars.forEach((c, k) => at(s, c, 2 * L + 3000 - 40 * k));
  at(s, rival, 2 * L + 3000); at(s, me, 2 * L + 2999);
  assert.equal(pos(s, me), 2);
  drive(s, me, 2); // now 1 m ahead
  assert.equal(pos(s, me), 1); assert.equal(s.order[0], me); assert.equal(rival.position, 2);
  // the live standings run every few physics steps, so the HUD never shows a position older than 1/60 s
  at(s, rival, 2 * L + 3000.5); at(s, me, 2 * L + 2999.5);
  for (let k = 0; k < 4; k++) { s.time += DT; s.step++; }
  drive(s, me, 2); s.standings();
  assert.equal(me.position, 1);
});

test('two cars crossing the start/finish line close together: laps and order follow who crossed first', () => {
  const s = race(2), [a, b] = s.cars;
  at(s, a, 3 * L - 0.4); at(s, b, 3 * L - 0.9);
  s.time = 200;
  drive(s, a, 0.9); drive(s, b, 0.9); // both cross within the same physics step
  assert.equal(a.laps, 3); assert.equal(b.laps, 3);
  assert.ok(a.lapStart < b.lapStart, 'a crossed earlier within the step: ' + a.lapStart + ' vs ' + b.lapStart);
  assert.deepEqual(order(s), ids([a, b]));
});

test('a lapping car is ahead by race distance, also when it is just behind the lapped car on the road', () => {
  const s = race(2), [fast, slow] = s.cars;
  at(s, fast, 4 * L - 5); at(s, slow, 3 * L + 20); // 25 m behind on the road, a lap (less 25 m) ahead in the race
  assert.deepEqual(order(s), ids([fast, slow]));
  drive(s, fast, 30); // across the line; the slow car is now 5 m behind on the road
  assert.equal(fast.laps, 4); assert.deepEqual(order(s), ids([fast, slow]));
});

test('a car in the pit lane keeps its place by race distance and drops back only as it is passed', () => {
  const s = race(3), [a, b, c] = s.cars;
  at(s, a, 2 * L + 100); at(s, b, 2 * L + 80); at(s, c, 2 * L + 60);
  a.pit = { phase: 'in' };
  assert.equal(s.legalProgress(a, 3, 0, 0), 3, 'the pit lane in use is route progress');
  assert.equal(pos(s, a), 1);
  drive(s, b, 30); assert.equal(pos(s, a), 2);
  drive(s, c, 60); assert.equal(pos(s, a), 3);
  a.pit = null;
});

test('a car recovering after going off the track loses its places to the cars that pass it', () => {
  const s = race(3), [a, b, c] = s.cars;
  at(s, a, L + 500); at(s, b, L + 490); at(s, c, L + 480);
  a.offN = 4; // stopped in the gravel: no progress while it sits there
  drive(s, b, 15); drive(s, c, 30);
  assert.deepEqual(order(s), ids([c, b, a]));
  a.offN = 0; drive(s, a, 40); // rejoins and gets going again
  assert.deepEqual(order(s), ids([a, c, b]));
});

test('retired cars are classified behind every running car, among themselves by distance covered', () => {
  const s = race(4), [a, b, c, d] = s.cars;
  at(s, a, 3 * L); at(s, b, 2 * L); at(s, c, 5 * L); at(s, d, 4 * L);
  c.dnf = true; d.dnf = true;
  assert.deepEqual(order(s), ids([a, b, c, d]));
});

test('after the flag a lapped car that crosses the line first is still classified behind the lead-lap cars', () => {
  const s = race(4), [lead, second, lapped, third] = s.cars;
  s.totalLaps = 6;
  at(s, lead, 6 * L - 1); at(s, second, 6 * L - 300); at(s, third, 6 * L - 600); at(s, lapped, 5 * L - 2);
  s.time = 600; drive(s, lead, 3);
  assert.ok(lead.finished && s.finishedFlag, 'the leader takes the flag');
  s.time = 601; drive(s, lapped, 4); // a lap down, it crosses the line next and finishes
  assert.ok(lapped.finished && lapped.laps === 5);
  assert.deepEqual(order(s), ids([lead, second, third, lapped]), 'cars still on the lead lap stay ahead of it');
  s.time = 610; drive(s, second, 302); s.time = 620; drive(s, third, 602);
  assert.ok(second.finished && third.finished);
  s.finishRace();
  assert.deepEqual(ids(s.results.map(r => r.car)), ids([lead, second, third, lapped]));
  for (const r of s.results) assert.equal(r.pos, r.car.position, 'results and live position agree');
});

test('finishing ties within one physics step are resolved by the interpolated crossing time', () => {
  const s = race(3), [a, b, c] = s.cars;
  s.totalLaps = 6; at(s, c, 6 * L - 1); s.time = 500; drive(s, c, 2); // leader already home
  at(s, a, 6 * L - 0.8); at(s, b, 6 * L - 0.2);
  s.time = 520; drive(s, a, 1.0); drive(s, b, 1.0); // b crossed earlier in the same step
  assert.ok(b.finishTime < a.finishTime, b.finishTime + ' vs ' + a.finishTime);
  assert.deepEqual(order(s), ids([c, b, a]));
});

test('a full race: HUD position, results and the Career position agree for every car', () => {
  const s = new SIM.Session(track, { type: 'race', seed: 11, difficulty: 1, weather: 'dry', damage: 'realistic', laps: 2,
    entries: SIM.DRIVERS.slice(0, 8).map((driver) => ({ driver })) });
  s.totalLaps = 2;
  let guard = 0;
  while (!s.over && guard++ < 400 / DT) {
    s.fixedStep(DT);
    if (s.lightsOut && s.step % 240 === 0) {
      // the live order is always sorted by the classification itself
      const o = s.order;
      for (let k = 1; k < o.length; k++) assert.ok(s.raceCompare(o[k - 1], o[k]) <= 0, 'order sorted at t=' + s.time.toFixed(1));
    }
  }
  assert.ok(s.over, 'the race finished');
  for (const r of s.results) assert.equal(r.pos, r.car.position);
  const first = s.results[0].car;
  assert.ok(first.finished && first === s.winner);
  for (let k = 1; k < s.results.length; k++) {
    const p = s.results[k - 1].car, q = s.results[k].car;
    if (p.finished && q.finished && p.laps === q.laps) assert.ok(p.finishTime <= q.finishTime, 'same lap: by finishing time');
  }
  assert.equal(SIM.PROGRESS.positionPoints(s.results[0].pos), 50);
});
