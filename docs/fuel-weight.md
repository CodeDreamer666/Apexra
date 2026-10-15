# Fuel weight: five times the real-world effect

Grand Prix and Career only. Elimination is unchanged.

## Target

In real Formula 1, an extra 10 kg of fuel costs about 0.3–0.4 s a lap. The target here is five times that: 23 kg against 9 kg (14 kg more) should cost about 2.1–2.8 s a lap.

## What changed

**Before.** Fuel was only part of the car's mass (800 kg + fuel). In this arcade handling, mass only affected acceleration, and only slightly. Braking and cornering did not depend on mass at all. Measured with the method below, 23 kg against 9 kg cost 0.26 s (Summit), −0.03 s (Rivermere) and 0.11 s (Redridge): effectively nothing.

**After.** The real mass is unchanged and is still used for the tank, consumption, refuelling and collisions. On top of it, each driving system feels an *effective* fuel load (`FUEL_PERF` in `index.html`), in kg of extra effect per kg of fuel:

| System | Factor | What it does |
|---|---|---|
| Acceleration | 24 | Extra inertia. Propulsion and drag are divided by it, so top speed is unchanged. The effective load also presses the tyres down, so a wheelspin-limited launch is not slower. No load makes the car quicker than it is without the effect. |
| Braking | 11 | Lower braking deceleration, on top of the existing tyre-grip limit. |
| Cornering | 0.9 | Lower steering yaw-rate ceiling, which lowers corner speed slightly. |

Each factor is a smooth function of the fuel in the tank and equals 1 with an empty tank, so there are no steps as fuel burns. Without fuel management (Elimination, and bare test rigs) every factor is exactly 1, and the code takes the original arithmetic path. The three were calibrated together on lap time rather than each being set to "×5". The lap time comes from the physics: no timer is touched.

## Measured lap-time cost

Measured with `tools/fuel-calibration.cjs`: one car alone, identical driver, fresh tyres (wear off), dry weather, no mistakes and no pit stops. The fuel load is held fixed for the lap. The figures are paired differences over 8 seeds × 3 flying laps, with standard errors of about ±0.05–0.09 s. `tests/fuel-weight.cjs` re-measures them with the same seeds.

| Circuit | 15 vs 9 kg | 23 vs 9 kg | Before (23 vs 9 kg) |
|---|---|---|---|
| Summit Grand Circuit | +1.00 s | **+2.55 s** | +0.26 s |
| Rivermere Grand Prix | +1.17 s | **+2.75 s** | −0.03 s |
| Redridge International Circuit | +0.92 s | **+2.15 s** | +0.11 s |

Redridge is the least sensitive: 57 % of its lap is flat out above 310 km/h, compared with 34–37 % elsewhere, and weight barely matters there.

## Driving characteristics (flat test surface)

| | 9 kg | 23 kg | Without the effect |
|---|---|---|---|
| 0–100 km/h | 2.90 s | 2.93 s | 2.90 s |
| 0–200 km/h | 5.93 s | 6.71 s | 5.64 s |
| 100–250 km/h | 5.77 s | 7.40 s | 5.01 s |
| Braking 250–80 km/h | 105.7 m | 120.2 m | 95.9 m |
| Lateral grip at 250 km/h | 6.13 g | 6.08 g | 6.16 g |
| Top speed | 329.9 km/h | 329.9 km/h | 329.9 km/h |

On the circuits, the light car reaches 1–3 km/h more before braking at the end of the longest straight, because it gets there sooner.

Starting with 23 kg and letting it burn, the lap times on Summit improve 83.8 → 82.3 → 81.5 s. Part of that improvement is the driver learning the track.

## Side effects

- **Overall pace.** Every Grand Prix car carries some fuel, so race laps are slower than before. At 9 kg, Summit laps went from 79.2 s to 81.2 s.
- **Fuel use.** The fuel formula is unchanged, but heavier cars spend longer on the throttle, so consumption rises by about 0.05–0.25 kg a lap. A full 8-lap load still finishes with about 2 kg to spare on every circuit.
- **Pit loss.** A clean stop costs about 1–2 s more with a full tank, because the car pulls away from the pit exit more slowly. `tests/pitstops.cjs` measures 22.3–22.9 s at 8 laps of fuel, against 20.1–20.7 s before.

## AI strategy

`planStrategy` now adds the fuel side of every plan (`fuelPlanCost`):
- the lap time the load costs over each stint, using the circuit's measured `fuelLapCost` (s per kg per lap);
- refuelling time beyond the tyre change (0.5 s plus 3 kg/s, less about 2.4 s for the tyres);
- a steep cost for a stint the fuel cannot cover.

The **starting fuel** (`chooseStartFuelLaps`) is the load from 3 to 8 laps with the best predicted race time. Each load is judged with its best tyre, stop and refuel plan. A driver's risk tolerance adds a small lean towards a lighter or heavier load, and weaker strategists misjudge it more (one random draw per driver).

At each stop the AI adds fuel (`refuelFor`) for the next stop it will really make, or for the flag when another stop would cost more. A planned tyre stop only counts once the tyres will be worn enough for the strategy to take it.

The safety margin is 0.45–0.8 laps, depending on risk tolerance. That matches the in-race fuel call, which boxes a car when its range at a pit entry is below 1.35 laps.

When it weighs an overtake, the AI assumes a rival's car carries fuel like its own, because rivals' loads are not visible. Its own fuel load and the rival's are judged the same way, so the fuel effect alone doesn't make it think it is the slower car.

Every car runs the same physics, consumption and refuelling rig. There is no AI-only factor.

## Strategy balance

Measured with `tools/fuel-strategy-balance.cjs`: one car over 8 laps, with the AI's own stops and refuelling, 2 seeds per cell. The table shows each start's race time behind the best start.

| Scenario | Light (3 laps) | Medium (5) | Heavy (8) |
|---|---|---|---|
| No reason to stop (soft tyres, wear off) | +19–21 s | +12–16 s | **best** |
| Normal tyre wear | 0 to +9 s | 0 to +3 s | +10 to +15 s |
| High tyre wear | 0 to +6 s | 0 to +5 s | +6 to +18 s |
| Rain arriving mid-race | best on 2 of 3 circuits | best on Summit | +60 to +118 s |

- **Light** is strongest when a stop is coming anyway.
- **Full fuel** wins when it avoids a stop.
- **Rain** results are dominated by when each car switches to wet tyres. They are noisy.

## Elimination

Unchanged. The tests confirm that the factors are exactly 1, the fixed 20 kg load and the mass are unchanged, the fuel value has no effect on driving, and no starting fuel is chosen. `tests/elimination*.cjs` all pass.
