# Elimination variants

The game remains a single `index.html`. Grand Prix and Career retain their race, fuel, pit-stop, tyre and AI rules.

| Variant | Laps 1–5 | Lap 6 | Winning boundary |
| --- | --- | --- | --- |
| Classic | Finish-line removals: 1, 2, 3, 5, 6 | Last of three out at finish line | End of Lap 8 |
| Chaos | Random 1–6 removals each lap, totalling 17; revealed at halfway | Same as Classic | End of Lap 8 |
| Ruthless | Same count constraints; random main-circuit checkpoints at 1.5–5.5 km | Last of three out at random 2–5 km checkpoint | End of Lap 7 |

The finale uses finishing order. There are no average-lap scores, restarts, position adjustments, tyre changes or damage resets at phase transitions. Retirements may leave fewer than three/two finalists; scheduled removals never remove the sole survivor. A sole survivor must still complete the race distance to win. A race with no eligible finishers reports no winner.

## Randomization and information

`ELIMINATION_RULES` defines the variants. Each session owns an immutable six-event schedule, created from a separate seeded RNG before cars are initialized. The bounded-composition sampler weights each candidate by its number of valid completions, giving each of the 780 five-number compositions of 17 equal probability. Counts and locations never depend on driver position, damage, performance or player identity. Seed zero is supported.

Ruthless uses actual circuit-distance samples, excludes connected service corridors and their merge margins, and warns 500 m before each boundary. A preceding 500 m section with more than 180 m of low reference speed gets a 1,000 m warning. This is a fairness heuristic, not a guarantee that every warning provides an overtaking opportunity.

`eliminationInfo` exposes only the current publicly known count/cutoff/distance. Chaos hides counts before halfway; Ruthless hides counts and distances before the warning. Risk, approach, engineer and service strategy consume this public view. Unknown risk depends on the driver's observed rank, never a guessed private cutoff. Internal schedules remain available for explicitly enabled debugging.

## Checkpoint fairness

All boundaries use the existing legally earned circuit progress, including service lanes and shortcut prevention. Each car gets one immutable, interpolated crossing timestamp per event. Exact timestamp ties use grid slot. Every eligible competitor must cross the same logical boundary before the round resolves, so neither a leader crossing nor overtaking after the boundary changes another driver's result. Future crossing records can accumulate while a delayed/lapped car resolves an earlier event. Eliminated and retired cars leave the eligible set.

Each round targets its scheduled survivor total, adapting removals for retirements and capping them to preserve the final participant. Cars unable to earn progress for 180 seconds retire under the existing inactivity rule. There is no global moving-driver timeout. Legitimate final crossings are retained while earlier checkpoints resolve; only surviving finishers can win.

## Ruthless tactics

Selected difficulty and individual personalities remain in force. Ruthless adds health- and urgency-dependent tactical aggression: broader attack/defence detection, quicker commitment to feasible moves, closer following, stronger risk/attack budgets, shorter abort cooldowns and later braking inside the existing envelope. Damage, tyre wear, caution, prediction, manoeuvre feasibility, side-by-side clearance, collision avoidance, yellow/VSC restrictions and normal physical forces remain active. No engine, grip, acceleration or top-speed bonus is added. Matched 40-second, dry, difficulty-90 starts (seed 73) on all three circuits produced 64 Ruthless attack attempts versus 21 for Chaos, and 177 versus 167 defensive actions. Completed passes were 2 versus 1; increased pass completion and human difficulty are not established by this sample.

## Shared service routes

All variants use the same two connected 420 m service routes, roughly half a lap apart. The routes reuse the existing lane geometry, autopilot, limiter and merge checks. Their 160 km/h limiter and moving gate replace stationary servicing in Elimination only; Grand Prix/Career retain the 80 km/h lane and stationary crews.

At a valid forward, moving gate crossing, tyres and eligible wing repairs apply instantly. Main-track passage, stopping beside the gate, wrong heading, skipping the gate and large projection jumps do not earn service. Players select a compound while approaching the service gate; AI uses its existing strategy. Four compounds are available; legacy Medium requests normalize to Hard in Elimination. Fuel remains disabled with a fixed 820 kg effective mass, and structural/suspension/power-unit damage remains.

Paired dry, clean, AI-driven physical route measurements (`node tests/elimination-physics.cjs`):

| Circuit | Station 1 loss | Station 2 loss |
| --- | ---: | ---: |
| Summit | 2.862 s | 4.079 s |
| Rivermere | 2.862 s | 2.717 s |
| Redridge | 2.721 s | 3.446 s |

These are measured conditions, not time corrections or guarantees in traffic, rain or damaged cars. The six-second target is asserted by the test.

## Verification commands

- `node tests/elimination.cjs`: 23 checks including nine circuit/variant rule progressions, finale distances, state continuity, all 780 schedules in 60,000 draws, 1,200 Ruthless schedules/locations, reveal masking, stable crossing order/ties, lapped cars/service users, retirements, depleted fields, recrossings and tactical/physical separation.
- `node tests/elimination-fuel.cjs`: constant mass/fuel, instant services/repairs, invalid gates, four compounds, AI/engineer fuel bypass and Grand Prix/Career isolation.
- `node tests/elimination-queues.cjs`: actual three-car arrivals through both lanes on all circuits, without stationary crews/queues.
- `node tests/elimination-physics.cjs`: paired physical service losses and zero service duration on all circuits.
- `node tests/elimination-recovery.cjs`: visible eliminated vehicles stay on screen until safe recovery.
- `node tests/elimination-fuel-endurance.cjs`: nine full dynamic-weather production-length races, legitimate winners, continuous wear/AI servicing and fuel-write guards.
- `THREE_JS=/path/to/three.module.min.js node tests/elimination-ui.cjs`: headless Chromium selection, briefings, hidden/revealed HUD, live service choices, variant results and Grand Prix service restoration. This uses an in-memory test bridge and holds the game render loop.
- `node tests/elimination-ai.cjs`: actual matched 40-second starts and tactical decision counts on all three circuits.
- Existing Career, movement, weather, racecraft, sporting, pit-stop, blue-flag and slipstream suites cover retained behavior. Tests referencing the removed format were updated for the new rules.

The legacy movement acceleration assertion, six conventional-pit assertions and one full-suite weather temperature assertion also fail on the original checkout; they were not loosened or repaired in this change. The weather assertion passes in isolation on the original checkout, so test ordering affects that result. Browser checks and exact final pass counts are recorded in the verification report. Automated races do not establish a balanced or enjoyable human experience across all seeds, weather and difficulty combinations.


## Recorded results

Verified on the final implementation:

| Check | Result |
| --- | --- |
| Elimination rules, schedules, reveals and edge cases | 23 passed |
| Fuel, compounds, repairs and valid service gates | 17 passed |
| Sporting rules / legacy-save handling | 37 passed |
| Career regression, including a real three-circuit championship | 14 passed |
| Blue flags | 19 passed |
| Eliminated-car recovery | 6 passed |
| Full dynamic-weather races: three variants × three circuits | 9 passed |
| Physical service-route checks | Both stations on all three circuits passed; 2.717–4.079 s clean losses |
| Three-car service arrivals | All six circuit/station cases passed |
| Browser flows | All three variants and return to Grand Prix service passed; no page errors |
| Matched tactical benchmark | All six 40-second starts completed; more Ruthless attack attempts |
| Script syntax and diff whitespace | Passed |

The complete endurance runs retained fuel-write guards for every car, observed weather changes and real tyre wear/service visits, reached all six knockout rounds, and produced legitimate winners at each variant's required race distance. Source comparisons also confirmed unchanged physical integration, player/keyboard handling, tyre updates, damage, weather, camera implementation, conventional pit geometry and circuit definitions.

Eight legacy assertions remain failing: one acceleration calibration (40 other movement tests passed), six conventional-pit checks (four passed), and one full-suite weather temperature check (seven passed). Each failure was reproduced against original commit `738b148`. The acceleration produced the same 95.256 km/h in an isolated original/modified comparison; the old test expects 145–170 km/h. Conventional pit-length, entry, queue and loss expectations already disagree with that commit. The weather failure produced the same 83.6 → 76.1 °C result on both full suites; the original isolated weather test passed, indicating order-dependent setup. Those assertions and Grand Prix physics were left intact.

The extended Career-AI benchmark, full slipstream suite and off-track suite were not completed in this verification pass. Human playtesting, the perceived harshness/fun of Ruthless, every random seed/difficulty combination and the six-second service target in rain, damage or traffic remain unverified. The warning-distance heuristic is intentionally bounded but still needs human fairness feedback on all sections.
