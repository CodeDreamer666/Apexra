# Elimination Mode implementation and verification

The event is one continuous 15-lap race. Grand Prix and Career keep their existing eight-lap race rules, conventional pit lanes, vehicle handling, damage, fuel, weather, slipstreaming, VSC and blue flags. All runtime code stays in `index.html`.

## Checkpoints and phases

Legal circuit progress supplies each car's own completed-lap boundary and classification distance. Crossings are interpolated inside the physics step and processed in time order, with grid slot as the stable fallback. A checkpoint waits until **every eligible driver has physically completed that lap**; a leader crossing alone cannot eliminate anyone. Cars in station lanes receive no exemption, and an off-route pit state grants no shortcut credit. Once the checkpoint resolves, the last classified car is removed on Laps 1–8, then the last two on Laps 9–12. Classification uses completed laps plus actual legal progress, never lap-time averages.

The round counter prevents duplicate resolution. Lap 8 changes the phase to 2; Lap 12 captures the four finalists and changes it to 3. No phase transition touches positions, tyres, wear, fuel, damage or the persistent weather object. An eliminated car leaves classification immediately and uses the established safe pull-off / pit-release retirement process.

Actual retirements consume the next checkpoint's scheduled slots. Excess retirements can reduce the field; the implementation never resurrects a driver or deliberately removes the last four survivors to compensate. A car making no new legal progress for 180 seconds retires deterministically; active servicing and a queue behind active servicing do not spend that inactivity deadline. A moving finalist has no global finish timeout. Waiting deliberately does not exempt a driver from the eventual distance classification.

## Final-phase timing and results

Each driver's own Lap 12 crossing starts their Lap 13 clock. Their Lap 13 and Lap 14 crossings close one elapsed interval and open the next. Their Lap 15 crossing closes the third. These clocks also run while braking, queueing, selecting service, refuelling, repairing, changing tyres and accelerating. No pit code resets, pauses or compensates them.

Timing starts individually even if another survivor is still resolving checkpoint 12. Only the resulting finalists compete for the win. The event ends when all remaining finalists have finished or retired. Ranking uses the three-lap elapsed total; ties compare the sorted individual laps (fastest, next fastest, third), then starting-grid slot. Sporting penalties do not affect classification. Results show actual Lap 13–15 times, average, ranking, stops and earlier elimination / retirement laps. Incomplete HUD averages are explicitly labelled with the completed-lap count; they are compared only within that count, not presented as confirmed standings. Physical position becomes `TT` in the final-phase HUD.

## Distributed stations

For each quarter-lap, placement searches ±360 m in 20 m increments on both sides, prefers gentle curvature and rejects shoulders overlapping a separate circuit segment. Each route follows the circuit's coordinate system: a connected 300 m approach, a 60 m exit and a short single-box service section. Total route length is 420 m, versus 560 m for the existing conventional lane. Barriers, asphalt, gate markings, signs, service buildings and wet-surface rendering use the same station definitions as collision and driving geometry. Nearby grandstands move outside a station's shoulder only in Elimination.

Distances below are metres from the timing line; L/R denotes the track side. Geometry is prioritized over exact quarter-lap spacing.

| Circuit | Station 1 entry / box | Station 2 entry / box | Station 3 entry / box | Station 4 entry / box |
|---|---|---|---|---|
| Summit | 0 / 345 L | 1740 / 2085 L | 2760 / 3105 R | 4200 / 4545 L |
| Rivermere | 0 / 345 L | 1860 / 2205 R | 2640 / 2985 R | 4780 / 5125 R |
| Redridge | 20 / 365 L | 1680 / 2025 L | 2840 / 3185 R | 4860 / 5205 R |

Each station has its own single box and FIFO queue. Arrival is physical entry, interpolated within the step; exact arrival ties use progress through the gate, then car ID. Choosing a station reserves nothing. A queued car stays at that station. Cars wait at marks spaced seven metres apart; the first waiting mark is 35 m behind the box so a stationary queue cannot block safe release. A missed AI entry leads to a new choice of a later station before commitment, never a transfer between queues.

Player and AI use the same stopping, service, repair, refuelling and release code, including the existing stochastic crew durations. There are no acceleration boosts or timing reductions. Paired real-physics trials start 250 m before the approach and finish 250 m after the exit, comparing stopping against staying on the circuit:

| Circuit | Station losses (seconds) | Conventional lane loss |
|---|---|---|
| Summit | 14.242, 13.783, 14.342, 15.292 | 19.412 |
| Rivermere | 14.154, 14.771, 14.137, 16.275 | 20.342 |
| Redridge | 14.246, 14.812, 14.692, 14.771 | 19.592 |

These are strategy estimates, not deductions from actual lap clocks. Queueing, decisions, extra fuel and repairs add real time. Reproduce the seeded measurements with `node tests/elimination-physics.cjs`; the recorded reference is `tests/reference/elimination-pit-measurements.json`.

## Tyres, weather, AI and fuel

All five compounds and the existing 2/3/5/3/5-lap useful-life targets remain unchanged. The pre-race selector and every station retain all five choices. Compound compliance tracking and compulsory changes are removed. Drivers may keep a usable set or fit the same compound again; tyre stops are based on performance, wear and weather.

Dynamic weather continues through every phase. Both human and AI engineers use the same observed conditions and uncertain forecasts. Phase 1/2 strategy compares observed position, elimination risk, likely rejoin distance, tyre wear, weather, station distance, observed occupancy and repairs against measured stop loss. Optional stops / repairs can be deferred near the cut; urgent safety and fuel needs remain meaningful. Phase 3 removes physical-position undercut incentives and compares estimated remaining tyre / repair time recovery against stop and queue cost. No future weather knowledge or privileged servicing is added.

Elimination has no fuel management: every car carries a fixed 20 kg reference load that never burns, refuelling and fuel strategy are absent, and an empty tank cannot cause retirement (see the README's *Pit stops and fuel*). Grand Prix and Career keep their fuel capacity, consumption, reserve, starting-load limits and refuelling mechanics unchanged. Saved mode selections use the updated `GAME_MODES` lap count; there is no persisted live race state to migrate.

## Verification

- `node tests/elimination.cjs`: fourteen rule tests, including schedule on all three circuits, checkpoint crossings and pit users, retirements, phase carryover, independent final clocks, pit-inclusive time, fourth-on-road winner, delayed final resolution, ties, compound use, connected surfaces / barriers, shortcut rejection, FIFO isolation, persistent weather, equal crew durations and unchanged fuel mechanics.
- `node tests/elimination-physics.cjs`: all twelve stations physically entered, stopped, serviced and exited without damage at 240 Hz; paired losses smaller than each circuit's conventional lane.
- `node tests/elimination-queues.cjs`: three cars at each of the twelve stations, occupied box held for twenty seconds until the queue has stopped; service / exit order remains FIFO with no damage.
- Three seeded full-event smoke trials (60 Hz headless integration): all circuits reached an event result with four finalists and three measured laps each. Summit exercised the normal 20→12→4 schedule; Rivermere and Redridge also exercised crash / stalled-car retirements. Redridge’s third-on-road finalist won on elapsed time. Recorded evidence is in `tests/reference/elimination-race-smoke.json`. Production-resolution station / queue trials use 240 Hz.
- Additional full-wet physical access trials completed all twelve stations without damage.
- Chromium browser check: menu → 15-lap session → four station surfaces → final-four HUD → results, including a winner starting the final in fourth; no JavaScript errors. Browser test fixtures explicitly advance checkpoint / timing states; actual driving is checked separately above. A local copy of the unchanged Three.js CDN module was used in the test server.

GPU frame-rate testing on player hardware and broad stochastic AI / incident balancing remain outside the automated checks. Three existing Grand Prix test failures were reproduced on the untouched default branch (`97cd2d1`) with exactly the same assertions: the weather test expects all sampled AI drivers to fit rain tyres (`HHIHIM` is the observed result), the pit test's manual-entry fixture expects an assigned box before reaching the current commitment gate, and the off-track pit fixture expects an outdated gravel surface on the now-connected entry ramp (expected `4`, observed `0`). The FIFO-allocation and crew-service checks pass. These baseline failures were not changed as part of this mode-scoped task.

The twelve selected Career regression checks (tiers, points, standings, promotions, save handling, car parity and standalone Grand Prix configuration), ten selected movement checks and all ten slipstream checks pass, including the twenty-car physics race on each circuit. The selected off-track braking, handling and legal-progress checks also pass. Long existing physics tests were run using the same assertions with their SIM source evaluated in the Node host realm instead of a VM to reduce harness overhead; selected checks were filtered by test title. Headless CPU sampling with twenty cars at 240 Hz measured about 9.2 seconds for 2,400 GP steps and 10.0 seconds for Elimination under concurrent test load (approximately 9% overhead); this is a relative simulation check, not a GPU frame-rate claim.

A direct default-branch comparison also reproduced identical twenty-car Grand Prix vehicle, tyre, fuel, AI pit-call and weather states over 2,400 production-resolution steps on each of the three circuits.

The selected legacy VSC regression run also reports four failures (Rivermere queue contact, Redridge leader spacing, a serious-impact survival fixture, and a pit-under-VSC fixture). The identical seven-test selection on the untouched default branch reproduced the same four assertions and three passes. No VSC behavior was changed to mask these existing failures.
