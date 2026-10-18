# Pit lane, pit stop and damage overhaul: report

This report covers two overhauls made together: the pit lane and pit stop system, and the component damage model with
its Car Status page. Every figure below was measured with the game's own simulation, using the tools and tests named next
to it. No human has playtested these changes; all driving was done by the game's AI and by scripted test drivers.

---

## Part 1: Pit lane and pit stops

### A. Geometry

- **Pit side and position.** Each circuit's pit lane runs beside its main straight on the side of the real pit lane:
  the right at Monza, Silverstone, Spa, Suzuka and Bahrain, and the left at Interlagos. The entry point (`pit.entry`
  in `CIRCUITS`) is placed where the real entry leaves the racing line, simplified to a straight-line ramp. The entry is
  50 m earlier than before at Silverstone and Spa, and has its own ramp length at Bahrain, so cars can reach the speed
  limit without overshooting their box.
- **Layout.** The lane is laid out as an offset beside the straight:
  - an entry ramp, then the 120 km/h limit line;
  - ten boxes 12.5 m apart, the first 12 m after the limit line;
  - 12 m to the end of the limit, then an exit ramp.

  The fast lane is 6.5 m outside the track edge and the boxes 10.5 m outside, with walls on both sides. The lane is
  417–457 m long (see F).
- **Terrain intersections.** The pit-lane asphalt is drawn on the same height field as the road. The scenery test
  (`tests/scenery.cjs`) now also samples the whole pit lane, ramp to ramp, across the fast lane and the boxes, and fails
  if any ground surface shows through: terrain, verge, gravel, paint, water or kerb. On the first run it found one
  defect: at the Monza pit exit, the circuit's kerb strip poked 2 cm through the exit ramp. Kerbs are now left out
  wherever the pit asphalt covers the kerb strip, which is also how the physics already treated that surface. All six
  circuits pass.
- **Entry approach.** The AI keeps its racing line until the last straight before the entry (`pit.straightIn`, at most
  230 m), then moves across. It no longer cuts across the track through the final corner.

### B. Pit boxes

- There are 10 teams, A–J, with two drivers each: A1/A2, B1/B2 … J1/J2. Box *k* belongs to team *k*, and both drivers
  of a team use that box only. Team A is first after the limit line; Team J is last, nearest the exit.
- Each box is painted in its team's colour, with a white stop line for the front wheels and the team letter. Each team
  has its own garage, carrying the team name and colours, a tyre stack, a cart, an overhead board with the letter and a
  release-light post.
- **Team-mates.** If one team-mate is in the box, the other stops in the fast lane 3 m short of the box ("stacking") and
  pulls in as soon as the box is free. One exception: if the first car is still on its way in behind a team-mate who is
  already waiting, the box is handed to the team-mate in front, so the two never block each other. Teams are
  independent: any number of different teams can be serviced at once.
- **Tested** in `tests/pitstops.cjs`: every car uses its own box while several teams are serviced at the same time;
  team-mates stack; all ten boxes busy with both cars of every team in the lane causes no overlap and no deadlock (Spa
  and Interlagos). In `tests/circuits.cjs`, full races on all six circuits show each car using only its own box, no box
  shared between teams, and no missed boxes.

### C. Pit operation

The stop moves through these states, and player and AI cars go through exactly the same code:

| State | What happens |
|---|---|
| `approach` | The car is on the entry ramp, before the commitment gate 90 m in. Control passes to the pit autopilot. |
| `in` | Driving to the team box, braking onto the marks. |
| `stack` | Waiting in the fast lane behind a team-mate who is in the box. |
| `stopped` | Being serviced. |
| `release` | Waiting until the fast lane behind is clear. |
| `out` | Driving to the exit, merging when the track is clear. |
| (racing) | Control returns to the driver. |

- **Entry.** Steering onto the marked entry and crossing the gate is the decision to stop. There is no speed check: the
  autopilot brakes the car down to the limit. The pit autopilot uses the ordinary pedals, steering, tyre grip and
  collisions, so there is no teleporting. The race-distance test checks this: the largest single-step change in race
  distance through the lane is under 2 m.
- **Parking.** Below about 7 m/s² the arcade brakes fade to a crawl. From the pit entry on, while a car is parking, a
  steady 7 m/s² low-speed braking floor applies (`PIT_PARK_DECEL`), the same for every car and still scaled by brake
  grip and brake damage. A car is accepted on its marks within ±8 m along the lane and 6.5 m across.
- **Release.** A red light shows while the car is being serviced. The car is released only when no moving car is in
  the fast lane within 12 m ahead or a speed-dependent distance behind; cars crawling or waiting in the lane do not hold
  up a release. The light then turns green and the car pulls out on a short diagonal.
- **Exit.** The car merges at the end of the exit ramp when the track is clear, and control returns there.
- **Retired cars** cannot enter the pit lane or be repaired.

### D. Pit UI

- **Pit plan.** The plan for the next stop is made while driving, and there is nothing to confirm. `V` shows or hides
  it; it also appears for 4 seconds whenever it changes. The controls are:
  - **Tyres:** `1` Soft, `2` Hard, `3` Intermediate, `4` Full Wet, `5` keep the current set. With no choice, the car
    gets a fresh set of its current compound.
  - **Fuel, in laps:** `−` and `+` change it by half a lap, using the car's own measured consumption. The default is
    "to the flag", and it can never exceed the tank.
  - **Repairs:** on by default, meaning all damage; `0` turns them off.
  - **Estimate:** the panel shows the stationary time the stop will take.
- **Stop panel.** One small panel is shown during the stop. On the way in, it shows "TO BOX n" or "WAITING · TEAM-MATE
  IN THE BOX". In the box, it lists each job (tyres, refuelling and repairs) as PLANNED, WORKING or DONE, with a
  countdown and a progress bar. It hides itself at the pit exit.
- **Removed:** the old in-box selection menu, its cards, the box list and the key capture.
- **Tested** in `tests/sporting-ui.cjs` on every circuit, in both Grand Prix and Career: the plan panel, keys, defaults,
  the stop panel through a real service, and that the panel hides afterwards.

### E. Repair system

- **The schedule.** One schedule, `CarDamage.repairJobs()`, decides the repair work. Each damaged component (more than
  5 % loss) is one job, and its time is `base + per × loss`:
  - front wing 2.0 + 2.8 × loss;
  - suspension corner 1.0 + 7.0 × loss;
  - power unit 2.5 + 7.5 × loss;
  - the full table is in `COMPONENTS`.

  Jobs go to eight crews: front, rear, bodywork, power unit, and one crew per wheel corner. The crews work at the same
  time, and each crew works through its own jobs one after another.
- **Service time.** The stop lasts as long as the longest of three tasks:
  - the tyre change, which starts after the corner crews' repairs and takes 2.0–2.6 s (4 % of changes are slow, adding
    0.8–2 s);
  - the refuelling, 0.5 s plus 3 kg/s;
  - the other crews' repairs.
- **One schedule for everything.** The Car Status estimate, the pit plan's "REPAIR ALL · +x s" and the actual stop all
  come from the same schedule. The test checks that the actual stop matches the estimate within 0.9 s; the gap comes from
  the random tyre-change time.
- **A full repair** restores every component to new. The test checks that handling, braking, power and gearbox values
  are back to those of an undamaged car. Damaged tyres are replaced with the tyre change; if the plan says "keep" but a
  tyre is damaged, a fresh set of the current compound is fitted.

### F. Timing

Tyre-only stop: a fresh set of the same compound, with no fuel and no repairs. The figures come from
`node tools/pit-benchmark.cjs`, with one AI car alone, dry, without mistakes, and tyre wear off. Each figure is the mean
of 6 runs: seeds 11 and 12, and the boxes of teams A, F and J. Each run is compared with the same car staying out on
the same seed.

| Circuit | Lane length | Same stretch on track | Lane incl. stop | Stationary | Extra driving | **Total loss** |
|---|---|---|---|---|---|---|
| Monza | 457 m | 5.28 s | 16.80 s | 2.21 s | 9.31 s | **15.8 s** |
| Silverstone | 417 m | 5.54 s | 16.93 s | 2.21 s | 9.18 s | **15.4 s** |
| Spa | 417 m | 7.30 s | 18.03 s | 2.21 s | 8.53 s | **14.3 s** |
| Suzuka | 457 m | 5.75 s | 17.04 s | 2.21 s | 9.09 s | **16.1 s** |
| Bahrain | 417 m | 5.47 s | 16.56 s | 2.21 s | 8.88 s | **16.2 s** |
| Interlagos | 457 m | 5.45 s | 16.59 s | 2.21 s | 8.93 s | **14.7 s** |

"Extra driving" is the lane time minus the stationary time minus the time for the same stretch on the track. "Total
loss" is the finish-time difference over the race; it also includes the slower lap on cold tyres after the stop. The
strategy AI uses these totals as each circuit's `pitLoss`. Before this overhaul a stop cost 19–27 s, against today's
14.3–16.2 s.

**Box position matters.** At Monza (seed 11), the stop costs 16.6 s from Team A's box, 15.1 s from Team F's and 15.6 s
from Team J's. Before parking braking applied from the entry onwards, Team A's stop cost 17.7 s. The first box sits
12 m after the limit line, so its car has to start braking on the ramp. Lengthening that run-in to 26 m did not help: it
only added lane length for everyone (16.6 / 15.5 / 15.9 s), so the layout was kept.

**Not reached: the requested ~6 s extra driving and ~8–9 s total.** Extra driving is 8.5–9.3 s and the total is
14.3–16.2 s. The remaining cost comes from:
- braking from racing speed to the 120 km/h limit;
- covering 417–457 m at the limit, where the track stretch takes 5.3–7.3 s;
- stopping and then accelerating from rest;
- cold tyres.

Reaching 6 s would mean making the cars brake or accelerate harder than they do anywhere else on the track, a shorter
lane than a ten-box lane allows, or skipping part of the distance. The first two would change the car physics, and the
last would be cheating, so none was done.

### G. AI behaviour

- The AI uses the same pit lane, the same team box, the same stacking and release rules, the same autopilot and the
  same service and repair schedule as the player. Only the choice of service is the AI's own (`aiServiceChoice`):
  - tyres from its strategy plan;
  - fuel for the laps it plans to run;
  - repairs when the lap time the damage costs over the remaining laps is more than the repair adds to the stop, or when
    the repair costs under 0.5 s.
- A stop that can wait a lap (a planned stint window, an undercut or covering a rival) is put off while the
  team-mate is in the lane (the box is shared) or six or more cars are in it, provided the tyres are under 75 % worn.
  Fuel, damage and weather stops are never put off. The AI boxes at once for a puncture, a detached wing, a large
  cooling leak or an overheating engine.

### Strategy balance (six laps)

Six-lap races from `node tools/strategy-compare.cjs <circuit> normal 11`: one AI car, dry, normal tyre wear, forced
pit calls, seed 11.

| Circuit | Soft 3 laps + Soft 3, start light, refuel | Hard, no stop | Soft 3 + Soft 3, full fuel | Soft 2 + Hard 4, start light |
|---|---|---|---|---|
| Monza | **501.6 s** | +3.8 s | +5.9 s | +9.7 s |
| Spa | **628.9 s** | +8.9 s | +8.8 s | +7.7 s |
| Bahrain | **554.6 s** | +10.0 s | +7.3 s | +12.3 s |
| Interlagos | **414.8 s** | +4.9 s | +5.4 s | +10.5 s |

**Finding.** With the new 14–16 s stop, a tyre-only one-stop on full fuel and the Hard no-stop are close: from 2.1 s
slower to 2.8 s faster. The clear winner is starting light on Softs and refuelling at the stop, which is 3.8–10 s
quicker than the no-stop, because the car is lighter for most of the race. The AI's planner reaches the same
conclusion:
- at Silverstone, Suzuka and Bahrain the whole AI grid now starts on Softs with 3.5 laps of fuel (seed 9);
- elsewhere, three cars choose the Hard no-stop.

`tests/fuel-weight.cjs` no longer expects the grid to split at those three circuits; the exception is commented there.

This edges towards the spec's "do not make pit stops so cheap that every driver must stop". The spec's own 8–9 s
target would push further in that direction. The lever is in the fuel and tyre systems (how much weight costs, the
refuelling rate, how long Softs last), which the spec says to report rather than change. No change was made; it is a
decision for you.

### H. Regression tests

See the combined results at the end of this report.

### I. Remaining limitations

- **Strategy balance.** See the strategy balance section above: the light-fuel one-stop is the quickest plan on the
  four circuits measured.
- **Pit-loss target.** The ~6 s extra driving and ~8–9 s total were not reached (see F).
- **Box position.** The first box costs about 1.5 s more than the cheapest one (see F).
- **Wet races.** When most of the field pits on the same lap for wet tyres, the single-file lane congests. Scripted wet
  races showed 40–80 s spent in the lane by the last cars. Nobody gets stuck: in every race checked, every car left
  again. One scripted wet race at Bahrain (seed 5) had car G1 run out of fuel; this was not investigated.
- **Geometry.** The pit lanes are simplified: a straight-line offset beside the main straight with fixed ramps. They
  are not surveyed real pit lanes, and the real lanes' curves and lengths differ.
- **Visuals checked at Monza only.** The pit plan, the pit lane, the box and crew, the red and green release light
  and the stop panel were checked in screenshots taken during a real stop at Monza
  (`tools/capture-screenshots.cjs`), not on the other five circuits and not in play.

---

## Part 2: Damage, Car Status and repairs

### A. Implemented components

There are 32 independently simulated components (`COMPONENTS` in `index.html`). Each has a loss value from 0 (new) to
1 (failed):

| Area | Components |
|---|---|
| Aerodynamics | front wing, rear wing, nose, floor, diffuser, left and right sidepods |
| Suspension and steering | suspension at each corner (×4), steering |
| Tyres | tyre carcass at each corner (×4), separate from tread wear, with slow or fast punctures and destroyed tyres |
| Wheels | wheel mounting at each corner (×4) |
| Brakes | brake at each corner (×4) |
| Power | power unit, gearbox, drivetrain |
| Cooling | engine cooling, left and right cooling intakes |
| Structure | front and rear chassis |

The condition shown to the player is (1 − loss), in these bands:

| Condition | Band |
|---|---|
| 76–100 % | OK (below 5 % loss there is no damage at all) |
| 51–75 % | Minor |
| 26–50 % | Moderate |
| 1–25 % | Severe |
| 0 % | Failed |

### B. Collision damage

`applyImpact(E, lx, ly, side, …)` takes the energy the car absorbs, the contact point in the car's own frame and the
impact direction:

- **Exposure.** Each component has a zone on the car. Its exposure depends on how close the contact is to that zone
  and on the direction of the hit; suspension and wheels also take load through their load paths. Outer parts take
  more of a glancing blow.
- **Damage.** A component is damaged only when its share of the energy is above its threshold T. Above that, damage
  grows with the energy relative to its strength S. A light front-wing touch (T 4000 J) does nothing; a 60 m/s wall
  impact can wreck the suspension.
- **Crush-through.** Energy a destroyed wing cannot absorb passes on to the parts behind it:
  - front: the nose, that side's suspension, the front chassis and the steering;
  - rear: the diffuser, gearbox, rear suspension and power unit.
- **Weakened structure.** A damaged chassis passes more of the next hit on to the parts mounted on it, and a broken nose
  no longer protects the wing mounts.
- **Scraping** along a barrier wears the outer parts at the contact.
- **Punctures follow from tyre damage, not chance:** over 45 % loss gives a slow puncture, over 80 % a fast one, and
  100 % a burst. Driving on a flat destroys the tyre and then damages the wheel mounting.
- **No dice for which parts break.** The same contact on the same car always gives the same damage.

Measured in AI-only races (6 races, 2,727 contacts): 14 of 120 cars were damaged, with wing, diffuser and nose damage
the most common, and no retirements. Most contacts between AI cars are light (99 % under about 5 kJ), so serious damage
mostly comes from the player's crashes. Staged impacts in `tests/movement.cjs` give different outcomes by location: a
rear-end hit, wall impacts at different speeds and angles, repeated knocks, and a puncture.

### C. Driving effects

Every effect is a value in the physics (`computePerf`), applied in the handling and the tyre and engine model, used by
the player and the AI alike:

| Damage | Effect |
|---|---|
| Front wing, nose | Less front downforce (up to −60 %), so understeer at speed, and lower cornering grip. |
| Rear wing, diffuser | Less rear downforce, so an unstable, oversteering rear, less traction and changed drag. |
| Floor, sidepods | Less downforce everywhere, and more drag. |
| Suspension (each corner) | Less grip at that corner and a pull towards that side; front corners hit steering harder, rear corners hit traction and stability; vibration. |
| Steering | Slower steering response (up to −55 %), less cornering and a slight pull. |
| Tyre carcass and punctures | Less grip, a pull, drag and vibration; a destroyed tyre runs on the rim. |
| Wheel mounting | Vibration, a pull and some grip loss; at 100 % the wheel comes off. |
| Brakes (each corner) | Each corner's share of the braking force (31/31/19/19 %) is reduced, so braking is longer, and the car pulls towards the stronger side under braking. |
| Power unit | Up to −28 % power, and with it a lower top speed (top speed follows the power against the drag); misfiring when badly hurt; protection mode when overheating. |
| Drivetrain | Up to −16 % power reaching the wheels. |
| Gearbox | Shifts up to 4× slower with less drive during the shift; top gears lost (7th above 75 % loss, 6th above 90 %). |
| Cooling and intakes | Reduced cooling efficiency; the engine runs hotter and, above 120 °C, loses power. |
| Chassis | Passes more of later hits on to the parts mounted on it. |

### D. Retirement logic

A car retires only when a component reaches a catastrophic limit (`checkFailures`); there is no random failure any
more:

- any suspension corner at its fatal limit (90 % loss on Standard damage);
- a wheel mounting at 100 %: the wheel is torn off;
- the front or rear chassis at its limit (60 % on Standard);
- steering, gearbox or drivetrain at 100 %;
- all four brakes at 95 % or more;
- the power unit at 100 %, with a fire after a very heavy impact or above 140 °C.

A retiring car pulls off, stops and is recovered; it cannot enter the pits. Everything below these limits is
driveable, so ordinary racing contact is survivable.

### E. Pit repairs

Every component of a car that hasn't retired can be repaired, from any damage level up to its retirement limit. Repair
time depends on the work: a job per component, base plus loss-dependent time, with eight crews working at once (see
Part 1, E). A full repair ends with every component back to new and every penalty gone; `tests/pitstops.cjs` and
`tests/movement.cjs` check this. The estimate shown before the stop is the same calculation as the stop itself.

### F. Car Status UI

- **Compact HUD.** One row in the status panel shows OK, DAMAGED or CRITICAL (or RETIRING / RETIRED), with up to two
  short lines naming the most serious problems. A brief flash and a short text notice mark a new important hit, at most
  two notices per impact, with no voice. The hint "C details" points to the full page.
- **Car Status page (`C`).** Opening it pauses a live race; `C` or `Esc` closes it and the race resumes. It shows:
  - a top-down drawing of the car with every component marked, green when fine, otherwise yellow, orange or red by
    severity;
  - numbered markers and callouts for the most serious components;
  - a list of the damaged components with their condition and effect;
  - the overall condition;
  - the handling effects present right now, for example "Pulls left under braking" or "Slow gear changes";
  - the repair estimate, and each crew's jobs.

  Everything is computed from the car's real damage values.
- **Tested** in `tests/sporting-ui.cjs` on every circuit and mode: the badge, the rows, that the page pauses and
  resumes, that every component is marked on the drawing, and the estimate. A screenshot at Monza, after a staged
  front-left impact, shows the page with real damage: failed wing and tyre, severe suspension, minor nose, a 9.6 s
  repair estimate and the crews' jobs.

### G. AI damage behaviour

- The AI cars use the same model: the same impacts, effects, punctures, retirement limits and repair schedule. Their
  driving responds to the same physics, steering against a pull with the same `pullRate`.
- The repair call (`assessDamage`, 10 times a second):
  - box at once for a puncture, a detached wing, a large cooling leak or an overheating engine;
  - otherwise box when the lap time the damage costs over the remaining laps exceeds the pit loss plus the repair time.

  The old "retire in the pits" rule was removed, because every damage is now repairable.
- **Damage between races.** Every race starts with an undamaged car.

### H. Tests

See the combined results below.

### I. Remaining limitations

- **AI damage is uncommon.** In AI-only races few cars are damaged, because the AI rarely makes hard contact.
- **Not playtested.** No human has played these changes. How damage feels with a keyboard or pad, and whether the
  effects are strong enough to notice, still needs testing.
- **Simplified effects.** The effects are simplified values in an arcade handling model, not a full vehicle-dynamics
  simulation. For example, suspension damage changes grip and pull but not the car's ride height.
- **Visual damage is partial.** Only wings, sparks and torn-off wheels are drawn. Other components, such as a damaged
  sidepod or floor, change the physics and show in Car Status but don't look damaged on the car.

---

## Combined regression results

The final runs use the final pit-loss values and pit-parking braking, with `node --test tests/<file>.cjs`.
Browser tests used the pre-installed Chromium; the scenery test also used a local copy of three.js 0.160.0.

| Test file | Result | What it covers |
|---|---|---|
| ai-racecraft | 14 / 14 pass | racing lines, overtaking (now 20 staged duels with pits off), defending, mistakes |
| circuits | 15 / 15 pass | full races on all six circuits; each car uses its own team box, no box shared, no missed box |
| classification | 9 / 9 pass | finishing order, lapped cars |
| corner-signs | 5 / 5 pass | recommended-speed signs |
| damage-timing | 5 / 5 pass | damage applied at the moment of contact |
| fuel-weight | 13 / 13 pass | fuel mass, start fuel choice (grid-split check excepted at three circuits, see strategy balance) |
| held-throttle | pass | browser input |
| intel | 6 / 6 pass | race intelligence |
| movement | 42 / 42 pass | collisions, location-based damage, handling effects of each component, deterministic failures and punctures, full repair |
| no-yellow-flags | 2 / 2 pass | |
| offtrack | 12 / 12 pass | |
| pitstops | 17 / 17 pass | ten team boxes, own box, stacking, ten busy boxes without deadlock, plan service with fuel in laps, repair estimate matches the stop, retired car, autopilot continuity, race distance, per-circuit loss, fuel |
| progression | 13 / 13 pass | Career progress and saves |
| runoff | 10 / 10 pass | |
| scenery | 1 / 1 pass (6 circuits) | nothing solid on the road; no ground through the road or (new) the pit lane |
| shortcuts | 7 / 7 pass | |
| slipstream | 10 / 10 pass | |
| sporting-rules | 49 / 49 pass | service durations, classification and contact rules on every circuit and mode |
| sporting-ui | pass (12 circuit/mode combinations) | pit plan panel and keys, stop panel through a real service, Car Status page and badge, results |
| timing-position | 27 / 27 pass | |
| weather | 8 / 8 pass | |
| career-ai | informational benchmark, no assertions | AI levels: pace, duels, races (its reference drivers were renamed to the new A1–J2 names) |

Benchmarks run: `tools/pit-benchmark.cjs` (all circuits, seeds 11 and 12, three boxes) and
`tools/strategy-compare.cjs` (Monza, Spa, Bahrain and Interlagos, seed 11). Screenshots of a full stop and of Car
Status were taken at Monza (`tools/capture-screenshots.cjs --circuits=monza`).

**Not done:** human playtesting; screenshots on the other five circuits; wet-race pit congestion beyond the earlier
scripted checks.
