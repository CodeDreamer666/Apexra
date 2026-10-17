# Apex Grand Prix — Formula Racing Simulator

A 3D Formula-style racing simulator that runs in a desktop browser. Everything (HTML, CSS, physics, AI, shaders, audio synthesis, UI) lives in **`index.html`**; only Three.js (r160) is loaded from a CDN, with jsDelivr → unpkg → cdnjs fallbacks.

## Running

Open `index.html` in Chrome, Edge or Firefox. If your browser blocks module imports from `file://`, serve the folder:

```sh
npx serve .        # or: python3 -m http.server
```

An internet connection is needed the first time to fetch Three.js and the Titillium Web font.

## Driving

The player has one keyboard-friendly arcade driving model. The handling is tuned from playing Super Star Car on Poki: stronger acceleration, light coasting, speed-dependent braking and fast, planted steering. The requested W+S+A/D drift and brake-only S behavior are retained. See [reference measurements](tests/reference/poki-measurements.md) for the captured HUD values, comparison and measurement limits.

| Input | Movement |
|---|---|
| `W` | Accelerate smoothly in the current heading. |
| Release `W` | Coast and slow down through engine braking and drag. |
| `W` + `A`/`D` | Accelerate and turn. Brief taps make corrections; sustained steering holds the turn. Speed changes follow throttle, drag and tyre forces. |
| `S` | Brake quickly and hold the car stopped. Never reverse. |
| `W` + `S` | Braking takes priority. The engine does not fight the brakes. |
| `S` + `A`/`D` | Brake and turn with stable grip. |
| `W` + `S` + `A`/`D` | Enter a controlled drift, losing speed during the turn. Release S to regain grip and accelerate out. |
| Release `A`/`D` | Steering recentres quickly and the car settles into its current direction. |
| `A` + `D` | The opposing steering inputs cancel. |

Throttle and braking are controlled by the player's inputs. Steering never applies the brakes or imposes a corner speed target. Player acceleration, braking, yaw and lateral slide use arcade force curves. Surface resistance, fuel exhaustion, the slipstream and the pit limiter still affect it. Steering responds immediately to digital input, with a short rotation transient and automatic slide recovery. Brief key segments that fall between rendered frames are buffered. Collisions remain in the vehicle model. The handling runs inside the 240 Hz physics loop, independently of the rendering frame rate.

**Bots drive the same car.** Every AI driver, and the autopilot that takes the player's car through the pit lane, uses the player's handling: they press the same steering, throttle and brake controls, which go through the same arcade acceleration, braking, coasting, yaw and slide response. Bots plan corner speeds from the steering's turn-rate limit and braking points from the arcade braking, never reverse, and use the same respawn as the player when stuck.

### Leaving the track

Outside the legal track there are two kinds of surface. **Green painted run-off** (a 3.8 m strip of paint beyond the white line wherever the circuit has it) is drivable asphalt with less grip and a little more rolling resistance (see below). **Grass, gravel, sand and unpainted terrain** are one surface with the same physics on all six circuits; only their look differs. The legal track is the asphalt inside the white lines plus the kerbs, and a pit lane while a car is legitimately using it. Each tyre is checked at its own position against the track edge at that point of the circuit, so curves, hairpins and the pit entry and exit are handled the same way as straights; a tyre counts as off only when all of it is past the line.

**Grass, gravel and terrain:**

| Tyres off | Effect |
|---|---|
| 0 | Normal grip, acceleration and speed. |
| 1 | Grip down by about an eighth and noticeable drag: from 280 km/h the car loses about 20 km/h in a second, and it tops out near 190 km/h. |
| 2 | Stronger drag and less traction: about 50 km/h lost in the first second, top speed near 95 km/h. |
| 3 | Severe drag: 280 km/h falls to about 130 km/h in two seconds; top speed near 80 km/h. |
| 4 | Maximum drag and half the grip: 280 km/h falls to about 100 km/h in two seconds, and the car settles at about 68 km/h on full throttle (on slicks in the rain it struggles for traction and goes slower). |

**Green paint** (`GREEN_RUNOFF`): grip falls by 2.5, 6.5, 11 and 18% with one to four tyres on it, which lengthens braking and lowers the cornering limit, and the rolling resistance rises with the tyre count: nothing extra for one tyre, a deceleration of 0.004, 0.012 and 0.025 × speed (m/s, so about 0.2, 0.7 and 1.4 m/s² at 200 km/h) for two, three and four. Both follow the tyre count over about a tenth of a second and recover over a third. Measured with `node tools/runoff-calibration.cjs` on a straight of each circuit, two seconds at 200 km/h on the pedal that holds 200 on the asphalt end at 198.6 km/h with two tyres on the paint and 191.2 km/h with all four (88 km/h on the grass); flat out the paint costs about 9 km/h over those two seconds, and one second of full braking from 200 km/h leaves the car about 5 km/h faster than on the asphalt. A brief excursion costs little; staying out there costs time. Paint counts as off the track for the progress check below, so it is never a shortcut.

The terrain drag grows with speed (capped at 3 g), so a fast car slows hard but progressively and never jumps to a lower speed. It acts on accelerating, braking, cornering and sliding cars alike, together with the tyre, temperature, wear and wet-weather grip; braking off the track is weaker too. When the tyres come back onto the track, grip, acceleration and handling return over about half a second. The player and all 19 AI drivers run exactly the same calculations, and bots simply steer back onto the track; nobody is reset for leaving the circuit.

**AI and the paint.** The AI used to treat the white line as a wall: its racing lines, every candidate path and its steering target kept the car's centre at least 1.15 m inside it, and touching the paint taught it to take that corner slower. (Its lines now use the whole asphalt, with the car's centre 0.75 m from the line, and only three or four tyres on unplanned paint count as an error to learn from.) It now treats the paint as usable but slower: candidate paths for overtaking on a straight, going around the outside, avoiding a stricken car and (when racing someone, or for a bold driver) running out at a corner exit may extend onto it, by about two tyres for a careful driver and up to all four for a bold one, but never on the inside of a bend, on the pit side along the pit route, or onto the grass. Each path is scored with the paint's grip loss, braking and drag along it plus a margin for the uncertainty (larger for careful drivers and in the wet), so it is chosen only when it pays; the steering follows the chosen path onto the paint, and paint the plan meant to use no longer counts as a mistake to learn from. A misjudged corner (running wide) can now carry the car onto the paint, where the physics decides how much it costs. In six measured three-lap 20-car races (`node tools/runoff-ai.cjs`), cars spent 0.01–0.09% of their time on the paint (before: under 0.02%, never planned), mostly in slipstream passes, avoidance, wide exits and wide mistakes, with no time on the grass and lap times, contacts and overtakes within race-to-race variation. The paint is rarely faster than the asphalt racing line, so the AI rarely chooses it.

There are no track-limit warnings, time penalties, drive-throughs or deleted laps. Instead, race progress is checked silently: while all four tyres are off, a car earns lap distance only for the distance it moves in the circuit's direction where it actually is. Cutting across the inside of a corner or the infield therefore earns less than it skips, and the car has to drive the difference before its lap, position, gaps and timing count it. Jumps of 30 m or more earn nothing. Running wide on the outside costs nothing beyond the slowdown. In simulation, cutting through every corner where a car can physically cut across is slower than driving the corner, typically by 0.2–4 s.

Reference: [Super Star Car on Poki](https://poki.com/en/g/super-star-car) for bindings and the directly observed handling.

## What's inside

- **Circuits**: six real Formula 1 circuits built from measured data (Monza, Silverstone, Spa-Francorchamps, Suzuka, Bahrain, Interlagos; see below), each with ridged red/white kerbs on both sides, pebbled gravel traps, painted run-off, braking-zone skid marks, 300/200/100 m braking boards, ad-board walls, catch fences, grandstands with a cheering (animated) crowd, waving team flags, a short pit lane, paved and lit like the circuit itself, with four shared, numbered service boxes and an illuminated event sign, a start gantry with working lights and APEX GRAND PRIX branding, a lattice sponsor bridge, TV camera towers, marshal light panels and its own landscape.
- **Graphics**: late-afternoon sun with long shadows, a sky with a warm sun halo and high cirrus (a dark, rolling cloud deck in the rain), HDR rendering with multisampling, bloom, ACES tone mapping and colour grading; reflections captured from the real scenery; team liveries on clear-coated bodywork; airfoil wing elements, rounded tyres with compound bands, see-through wheel faces and wheel blur at speed; contact shadows; stable sun shadows; a spring-damped chase camera; a cockpit view with its own slim halo, a steering wheel with a live display and gloved hands, and mirrors, plus a T-cam on the airbox; dynamic resolution to hold the frame rate.
- **Visual effects** (see below): sparks, debris, collision and damage smoke, dust, gravel, fire, brake glow, tyre marks, rain and screen effects, all driven by the simulation.
- **Physics** (240 Hz; arcade pedal/yaw/slide response for every car, player and AI alike): four-wheel tyre model (Pacejka-style lateral force, friction circle, load sensitivity, lock-ups and wheelspin), downforce and drag (slipstream, aero damage; no dirty air), longitudinal and lateral weight transfer, 8-speed gearbox, fuel mass and consumption (with refuelling) and an amplified fuel-weight effect in Grand Prix and Career (see Pit stops and fuel), tyre temperature and wear (four compounds: soft, hard, intermediate, full wet), surface grip, one universal off-track surface (see below), wall and car-to-car collisions with component damage (see below).
- **AI drivers**: 19 opponents sharing one aggressive racing philosophy (no personalities; see **AI drivers**), on one talent level set by the rank or the difficulty slider. They drive the same arcade handling as the player through the same three controls. Each one plans its own path through the corners ahead from minimum-curvature reference lines, predicts the cars around it from what it can see, and decides between following, lining up a move, attacking (inside, outside, slipstream, switchback or a two-corner set-up), calling a move off, defending (one move, room left, only against a real threat) and yielding. They pounce on rivals' mistakes, respect yellow flags, make situational mistakes, adapt to changing grip and to rivals' habits, recover after offs and contact (respawning like the player only when stuck), and plan and react to pit strategy (starting fuel, fuel and tyre stops, undercut, covering, damage stops, a busy pit lane).
- **Race weekend**: no qualifying: races start straight from the grid, with standing starts with automatic launch control (see below), sector timing (purple/green/yellow), time gaps, no track-limit penalties (leaving the track simply costs time, see below), yellow flags, pit stops at four shared boxes with refuelling and no compulsory stops or compounds (see below), chequered flag and classified results with points.
- **Modes**: exactly four, on the main menu: **Grand Prix** (6 laps, 26–42 km depending on the circuit, 20 drivers from the grid on any circuit), **Career** (three ranks of six circuits, see below), **Rival Duel** and **Pursuit** (two laps, two cars, three ranks of six circuits each, see below). Spectator mode with car switching, six cameras, an auto-director and up to 4× time.
- **Settings**: AI difficulty (Grand Prix only; the Career, Rival Duel and Pursuit ranks set it themselves), your team, starting tyre and fuel (in the race brief), graphics quality, speed effects, engineer voice and volume.

| | Grand Prix | Career | Rival Duel | Pursuit |
|---|---|---|---|---|
| Race length | 6 laps | 6 laps | 2 laps | 2 laps |
| Drivers | 20 | 20 | 2 | 2 |
| Pit stops | Yes | Yes | No | No |
| Fuel | Chosen, refuelling | Chosen, refuelling | Fixed equal load | Fixed equal load |
| Tyres | Chosen, any of four | Chosen, any of four | New Softs for both | New Softs (you); part-worn Softs (rival) |
| Weather | Dynamic | Dynamic | Fixed dry | Fixed dry |
| Race engineer | Full (safety, opportunities, strategy) | Full | Minimal (safety, the rival) | Focused on the gap |
| AI difficulty | Settings slider | Rank (100–150%) | Rank (100–150%) | Rank (100–150%) |

Qualifying, the Elimination variants, Time Attack and Overtake Challenge are not part of the game. No mode has sporting time penalties or compulsory tyre compounds.

## Circuits

Six real Formula 1 circuits in their current Grand Prix layouts, built from measured data (centre lines and widths from the TUM FTM racetrack-database, which is based on OpenStreetMap; elevation from SRTM). Sources, licences, attribution and every measured and estimated figure are in **[docs/circuit-data.md](docs/circuit-data.md)**; `tools/build-circuits.cjs` rebuilds the embedded data from the original files.

Start Grand Prix opens the circuit selection: six cards with the circuit's short name, country and lap length, each with a map drawn from the same centre line the playable track is built on; the selected card also shows the race distance for the mode (6 laps in Grand Prix and Career, 2 in Rival Duel and Pursuit). Click a card or use the arrow keys, then **Race here** (or Enter); Back or Esc returns to the menu. The choice is saved, and the main menu's circuit card shows it.

| Circuit | Country | Lap (published / in game) | 6-lap race | Direction | Elevation range in game | Pit lane | Setting |
|---|---|---|---|---|---|---|---|
| **Autodromo Nazionale Monza** | Italy | 5.793 / 5.794 km | 34.76 km | Clockwise | 14.5 m | Right of the main straight | Royal park: broadleaf woods, grass, light haze |
| **Silverstone Circuit** | United Kingdom | 5.891 / 5.890 km | 35.34 km | Clockwise | 12.8 m | Right | Open, flat former airfield; wide run-off |
| **Circuit de Spa-Francorchamps** | Belgium | 7.004 / 7.004 km | 42.02 km | Clockwise | 105.2 m | Right | Ardennes forest and hills; the wettest weather of the six |
| **Suzuka International Racing Course** | Japan | 5.807 / 5.806 km | 34.84 km | Figure of eight | 42.2 m | Right | Wooded hills, the Ferris wheel; the back straight crosses over the Degner–Hairpin section on a bridge |
| **Bahrain International Circuit** | Bahrain | 5.412 / 5.412 km | 32.47 km | Clockwise | 19.7 m | Right | Desert: sand, palms, the tower; floodlit night race |
| **Autódromo José Carlos Pace (Interlagos)** | Brazil | 4.309 / 4.310 km | 25.86 km | Anti-clockwise | 43.0 m | Left | City bowl: towers around the circuit, hills |

Race distances are the real lap length times the mode's laps; nothing is time-scaled. Corners are numbered and named in the real order (for example Monza's Variante del Rettifilo, Curva Grande, Roggia, Lesmo, Ascari and Parabolica; Spa's La Source, Eau Rouge, Raidillon, Les Combes, Pouhon, Blanchimont and the Bus Stop; Bahrain uses turn numbers), checked by `tests/circuits.cjs`.

Each circuit is a separate track generated from its definition: centre line, per-point track width (with a 10 m minimum where the satellite width is narrower), kerbs, run-off and gravel sized per circuit, barriers and collision walls, racing lines, corner speeds and braking points, AI lanes, start grid, pit lane and boxes, sector timing, marshal sectors, lap counting, minimap, terrain and scenery. Elevation is the measured profile along the line, so Eau Rouge and Raidillon climb about 40 m and Interlagos drops from the Senna S to the Descida do Lago; the simulation uses the gradient (climbs cost speed, descents add it), and the renderer lifts the road, kerbs, barriers, buildings and cars by the same heights, with a fine height grid around the circuit and a coarse one out to 10 km. Suzuka's two levels are physically separate: the upper road crosses on a bridge with 7.5 m clearance, cars on different levels never collide, and the walls and height lookup know which road a car is on. A geometry check (`Track.validate`) rejects layouts where separate parts of the lap at the same level come too close, a barrier reaches the road, a corner is too tight to drive or the gradient is excessive.

**Measured per circuit with the game's own physics** (one car alone, dry): the pit-stop loss of a tyre-only stop (four seeds, the same seed with and without a stop on lap 2), fuel use at race pace, and the fuel-weight lap cost (8 seeds, 23 kg against 9 kg), used by the strategy model and the race engineer.

| Circuit | Pit-stop loss | Fuel per lap | Lap cost per kg of fuel |
|---|---|---|---|
| Monza | 21.1 s | 2.69 kg | 0.247 s |
| Silverstone | 23.4 s | 2.75 kg | 0.256 s |
| Spa-Francorchamps | 20.9 s | 3.27 kg | 0.312 s |
| Suzuka | 22.4 s | 2.74 kg | 0.252 s |
| Bahrain | 24.4 s | 2.77 kg | 0.371 s |
| Interlagos | 19.3 s | 2.15 kg | 0.242 s |

**Not reproduced exactly** (see docs/circuit-data.md): start/finish line positions are estimates; the pit lane is a lane beside the main straight on the real side, so Silverstone's, Spa's and Interlagos's real entries and exits away from the straight are not modelled; SRTM smoothing loses short crests and compressions; the Suzuka bridge height is added (the data has only the ground); kerbs, run-off, barriers and scenery are generated, not surveyed.

**Saves from the old circuits.** A saved circuit choice of Summit, Rivermere or Redridge (the previous fictional circuits, now removed) falls back to Monza; no other setting changes.

## Career

**Career** (on the main menu, "Career — 3 Ranks") has three ranks. Every rank holds all six circuits; each race is a six-lap Grand Prix from the grid with all 20 cars (tyres, fuel, weather, pit stops, damage and race engineers as in Grand Prix), with the whole field at the rank's AI level. You pick your team once and keep it.

| Rank | AI level | To be promoted (of 600) |
|---|---|---|
| Rookie | 100% | 360 → Pro opens |
| Pro | 125% | 420 → Master opens |
| Master | 150% | 480 → Career complete |

Race the six circuits in any order and replay any of them as often as you like. **Every circuit scores up to 100 points**, and the rank's score is the sum of each circuit's **best** result (never a sum of attempts), so a rank is worth at most 600. Promotion needs **all six circuits raced** and the score at or above the threshold. Unlocked ranks stay unlocked; earlier ranks stay replayable.

**Position points (0–50)** follow the official classification (a car that retires keeps its classified place):

| P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 | P11 | P12 | P13 | P14 | P15 | P16 | P17 | P18 | P19 | P20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | 44 | 39 | 35 | 32 | 29 | 26 | 23 | 20 | 18 | 16 | 14 | 12 | 10 | 8 | 6 | 5 | 4 | 2 | 1 |

**Pace points (0–50)** measure your lap times against the game's own drivers on that circuit in the conditions you raced in. Each lap is scored, and the race score is the mean over the race distance (laps not completed after a retirement score 0), so one fast lap cannot hide slow ones. Per lap:

- The **reference** is the Master (150%) AI's lap on that circuit at that track wetness, measured with the real physics (`tools/pace-calibration.cjs`: one car alone, four seeds, fresh tyres of the quickest compound for the conditions, a mid-race fuel load, track water held at 0, 0.3, 0.6 and 0.9; values in between are interpolated by the lap's own average wetness). Matching it scores 50.
- The **anchors** are measured the same way: the Rookie (100%) AI's lap scores 26 and the Grand Prix slider at 0% scores 12; 0 lies 12/14 of the Rookie-to-slider gap beyond that. Between the anchors the score follows a monotone cubic, so it is smooth, never higher for a slower lap, and every whole number from 0 to 50 can be reached (`tests/progression.cjs`).
- **Normalised:** the standing start (lap 1 is allowed the reference's measured extra time from the line) and pit stops (the time between pit entry and exit is replaced by reference pace over the same distance). **Not normalised:** mistakes, time off the track, contact, damage, worn tyres and fuel weight: they are part of your pace.

Measured references (dry, s): Monza 77.28, Silverstone 79.39, Spa 97.18, Suzuka 79.84, Bahrain 84.09, Interlagos 62.50. Rookie AI against the reference, dry: +1.6% (Monza), +2.3% (Silverstone), +1.6% (Spa), +2.1% (Suzuka), +3.6% (Bahrain), +3.2% (Interlagos); in the wet the spreads are larger. The Pro AI measured +0.6% to +1.9% dry; it is not an anchor because its gap to Master is the smallest and least repeatable (0.17% and 0.63% at Monza in two calibration runs). On the fast circuits the scale is steep: at Monza one dry pace point is about 0.05 s a lap.

**Thresholds benchmark (not applied).** `tests/career-ai.cjs career` raced each rank's six circuits three times (54 six-lap races, the game's dynamic weather — 48 of the 54 turned wet — and random grids), with three AI stand-ins for the player at Rookie, Pro and Master skill, scored by these rules. A stand-in at the field's own level averaged 15–23 pace points and 24–29 position points a race, and its best-of-three totals were 370 at Rookie (threshold 360), 305 at Pro (420) and 437 at Master (480). Grid position and weather decided more than the stand-in's skill: the Master stand-in out-scored the Pro one only at Pro rank. The pace references are solo laps on fresh tyres at a mid-race fuel load, so racing in traffic, through changing weather, on a full tank or worn tyres keeps pace points well below 50. Two ways to bring promotion within reach of a player who matches the field and retries, neither applied: thresholds of about 360 / 300 / 420 (the measured best-of-three totals, rounded down to a multiple of 60), or pace references measured in full-field races (not measured: a first attempt with a lone car over six laps in held wet conditions was too noisy to use). As set, Pro and Master ask the player to beat the field clearly.

**The results screen** shows position points, pace points and the circuit total, whether it improved the circuit's best, the rank score and what is still needed, with **Retry circuit**, **Next circuit** and, once all six are raced and the threshold is met, the promotion. The Career screen shows the three ranks, the six circuit cards of the selected rank with their best results, and a summary table.

**Saving.** Ranked progress for Career, Rival Duel and Pursuit lives in one browser entry (`apexgp.progress.v3`): per mode, the unlocked rank and every circuit's best result per rank. Status (scores, wins, promotion) is always recomputed from those results; malformed entries are dropped one by one, so one bad value never wipes the rest. A result is recorded once per race session.

**Old saves** (the five-tier or eight-tier Career in `apexgp.career.v1`, the eight-rank Rival Duel and Pursuit in `apexgp.ranked.v1`) are migrated once. Their races were on the removed fictional circuits, so **no result, score or win is carried over**; what is kept is access and your team. A rank opens when the old save had completed an old tier or rank whose AI level was at least the level of the rank below it (for example, an old completed 125% tier opens Master; an old completed 100% tier opens Pro). The old entries are left untouched in storage and copied into the new save's `legacy` record.

## Rival Duel and Pursuit

Two ranked two-lap modes, one rival, the same car for both drivers: same power, aero, grip, brakes and damage model, both on Soft tyres, both with the same fixed fuel load (two laps plus a spare, no fuel choice or refuelling), no pit stops (the pit-lane gate does nothing), a dry track that stays dry, no sporting penalties and no rubber-banding. The rival is a random driver from another team; the rank sets its AI level.

**Rival Duel**: both cars start side by side on the front row, at exactly the same distance from the line; the sides alternate between attempts. The first car to complete two laps wins.

**Pursuit**: you start on pole on new Softs; the rival starts 1.0 s ahead (a distance up the grid, from the launch model, calibrated so that two identical cars are about that far apart once up to speed) on Softs that are already worn (the race brief and the HUD say how much). Both cars launch on the same lights and are timed from the same moment. You win only by finishing ahead at the end of Lap 2; the rival races and defends like any AI driver.

**Ranks** (each mode has its own three, and each rank holds all six circuits):

| Rank | Rival AI | To complete the rank |
|---|---|---|
| Rookie | 100% | All six circuits attempted and at least five won |
| Pro | 125% | The same |
| Master | 150% | The same; completing Master completes the mode |

Pick the mode, an unlocked rank and a circuit; retry any circuit as often as you like. **A win stays won**: a later loss on the same circuit never takes it away. The panel under the mode buttons shows each rank's state and the six circuits (won, lost, not attempted). Completing a rank unlocks the next one in that mode only.

**Pursuit balance.** The rival's tyre wear is set per circuit and rank (`PURSUIT_WEAR`), measured with `tools/pursuit-balance.cjs wear`: a chaser driven by the AI at the rank's own level (a stand-in for a player as good as the rival), four seeds per wear level, choosing the wear at which it wins about half the time. A longer or harder lap wears the tyres further in two laps, and a sharper rival pushes worn tyres harder, so the values differ:

| Rival Soft wear | Monza | Silverstone | Spa | Suzuka | Bahrain | Interlagos |
|---|---|---|---|---|---|---|
| Rookie | 38% | 44% | 46% | 46% | 66% | 66% |
| Pro | 40% | 50% | 46% | 54% | 66% | 64% |
| Master | 46% | 46% | 40% | 32% | 50% | 42% |

Checked on six fresh seeds with the final AI (`tools/pursuit-balance.cjs ranks`, seeds 11–16): an equal-level chaser won 24 of 36 at Rookie, 24 of 36 at Pro and 27 of 36 at Master (Master: Monza 3/6, Silverstone 4/6, Spa 6/6, Suzuka 4/6, Bahrain 4/6, Interlagos 6/6), so every rank is a little easier than the even odds the wear was set for. Against the Master rival a 100% chaser won 8 of 36 and a 125% chaser 9 of 36; against the Rookie rival a 150% chaser won 26 of 36. Outcomes are bimodal: the chaser either gets by as the rival's worn tyres fade in the second lap, or finishes a tenth or two behind, unable to pass an equal car. The AI stand-in passes less readily than a human usually does, so these rates are a guide, not a promise.

**Saving.** Duel and Pursuit progress is stored with Career in `apexgp.progress.v3` (per mode: unlocked rank, and per rank and circuit the attempts, whether it was won, the best time and margin). Old eight-rank saves (`apexgp.ranked.v1`) keep access only (see Career, Old saves); no win is carried over.

## AI drivers

The 19 AI drivers are meant to feel like 19 racers who observe, plan, attack, defend, make mistakes and adapt, not like cars on rails. Everything they do goes through the player's own controls and physics.

**Racing lines.** The circuit's geometric line (used for corner numbering, braking boards and timing) is an elastic-band line: it shortens the path, so it hugs the inside kerb through 90–100 % of every corner. The AI used to drive it, which is why it always took the inside line. The AI now drives **minimum-curvature lines** solved once per circuit (and cached) from the real centre line and track width. Curvature changes linearly between the points where the line touches a track limit, which gives the classic outside–apex–outside line with clothoid entries and exits. Because corner speed in this handling grows with the radius, tight corners are weighted more. Three variants are solved alongside: an **inside** line (taken before the braking zone and held to the apex, giving up exit speed), an **outside** line (outer half through entry and apex) and a **late-apex** line (wide entry, straighter and faster exit). Every line uses the whole asphalt while keeping the wheels inside the white line plus the tyre margin that still counts as track (`AI_EDGE`, 0.75 m from the line to the car's centre; it used to be 1.35 m, which left about 1.2 m of every corner unused), so no plan cuts a corner or bypasses the race-progress checks. Driven alone, the minimum-curvature line was roughly 15 % quicker than the old inside line on the three earlier, fictional circuits (about 92 s → 78 s a lap for a top driver on the first of them), and the full width is worth another 0.2–0.4 s a lap.

**Four layers.** *Strategic* (10 Hz): the race engineer's pit, tyre and fuel calls as before, plus how much risk the moment is worth (laps left, gaps ahead and behind, damage, worn tyres, fuel saving, a recent scare, the urgency of a two-car race in Rival Duel and Pursuit). *Tactical* (10 Hz): follow, prepare, attack, defend, yield, abort or recover, with commitment periods and hysteresis. *Trajectory planning* (10 Hz, half that when alone): candidate paths for the next 140–360 m, built as smooth blends of the reference lines through the next corner or two, plus ramped lateral offsets for passing or avoiding a stricken car. Each candidate is driven in thought with the car's own corner-speed limit (from the driver's read of the grip), braking and measured acceleration, the slipstream and the predicted cars around it, and is scored on time, exit speed down the next straight, contact risk and what the tactical state wants. *Vehicle control* (240 Hz): the chosen path is followed by pure-pursuit steering (look-ahead 6 m + 0.22 s; the old longer look-ahead turned in early and cut every apex by a metre or more) and the speed envelope. The pedals are feed-forward from the arcade force laws plus feedback on the speed error: the throttle that holds the speed plus a correction, and on a braking curve the brake that sheds speed at exactly the planned rate, modulated continuously instead of switching pedals on every small error. A path's curvature is the racing line's own smoothed curvature plus that of the path's deviation from it, so a re-plan never makes a corner look tighter than it is (the raw curvature used to read 10–15 % high at the start of every new plan and braked the car below the corner's speed). Where the car is still braking towards a slower point ahead, a skilled driver enters above its steady cornering limit using the same three-key drift the player has (W + S + steering: full brake, a little throttle, more rotation), up to 15 % above it at the top of the difficulty scale and not at all at the bottom; never with a car alongside, in the pit lane or while recovering. A 60 Hz safety layer keeps the following distance (checking where the cars will actually meet when closing fast) and a car's width of room from any car alongside. The path near the car (just past the steering look-ahead) is committed, so the target the car steers at never jumps and new decisions blend in beyond it.

**Overtaking.** A driver racing a car ahead keeps weighing the passes it could make: through the tow and out on a straight, up the inside (braking a little later than when following, within its own braking), around the outside, a switchback (wide entry and cut back under a car that has covered the inside), and with good racecraft a set-up (a compromised line through one corner to be on the inside for the next). A move must be in reach: close now, or clearly closing, and alongside by the turn-in for a corner move. A straight-line move is judged at the braking point it is aimed at, beyond the planner's few-second horizon (`slipstreamRun`): from what the driver can feel and see — the closing speed, and the speed in hand while held up behind the car (the throttle it is leaving unused, less the tow it gives up by pulling out) — it projects the gap left at the next passing place's braking point. The driver closes into the wake on the straight, pulls out with a smooth sideways move on the side with room once the gap is down to about 0.1 s, keeps that side and becomes the inside or outside move at the braking point. A slipstream run is called off when it is unsafe, when it stops promising an overlap for over a second, when the braking point arrives without one or when no path for it is left; it is not called off merely because, out of the tow, it is briefly slower over the next few seconds. Its value combines the time gained, how likely it is to end alongside or ahead, and what the place is worth, including the time a slower rival would keep costing over the laps left. The urge to go builds over consecutive evaluations, faster for aggressive and impatient drivers and as frustration grows behind a car; patient drivers wait for a move that looks likely to work. Once committed, the move is re-judged every plan and called off, with a stated reason, when the door closes, contact becomes likely, the braking zone arrives without an overlap, it is costing time, or it simply is not on. A covered inside can turn into a switchback instead. Aborts and failures are remembered against that rival.

**Defending.** A car within about half a second behind, or further back but closing fast, is a threat (with a wider band for letting go of the threat than for taking it up, so the state does not flicker); a driver in a train races the car ahead and keeps an eye on the one behind, and only an imminent threat (on the gearbox or alongside) takes priority. Defending is worth time only at a real passing place: each corner carries a `passZone` (how much speed is shed into it; a flat-out kink has none), and the price a defensive line may cost there grows with how close the attacker is and how fast it is closing (a passive follower in the tow is only a modest threat). The planner covers the inside only when that is cheaper than the price, and holds the racing line otherwise. A car that is wholly behind and in the same lane is its own driver's to avoid: it never makes this car's own line look blocked or risky (that misreading used to push a defender off its line all round the lap). With a passive car held 15 m behind on its own line (`tools/defence-cost.cjs`, one seed, three flying laps against the same laps alone), the leader's lap changed by −0.6 to +0.7 s across the six circuits at 100–150%; at 150% the changes were +0.23 (Monza), +0.72 (Silverstone), −0.54 (Spa), +0.14 (Suzuka), −0.22 (Bahrain) and −0.17 s (Interlagos), averaging +0.03 s, within the run-to-run noise. A car that close (about 0.2 s) counts as a threat, so the leader is in its defending state throughout, but it covers only at real passing places. An attacker set up wide for a switchback makes a good defender protect its exit. Rules: at most one blocking move per corner approach, made before the braking zone; none once braking; moving away to leave an attacker room is always allowed; a car alongside always gets a car's width.

**Measured in full fields** (`tools/field-benchmark.cjs`, 20 cars, six dry laps, seeds 1 and 2, mean of the two; "before" is the previous AI with personalities, same circuits and seeds):

| Circuit, level | Overtakes | Committed moves (completed) | Time following | Contacts | Mistakes |
|---|---|---|---|---|---|
| Monza 100% | 3.0 (before 3.0) | 38 (0) | 24 % (21 %) | 2.5 (1.5) | 3.5 (10.5) |
| Monza 150% | 6.5 (before 4.5 at 150%, 3.5 at 300%) | 73 (0) | 53 % (23 % / 39 %) | 5.0 (2.0 / 0.5) | 0 (3.5 / 0.5) |
| Bahrain 100% | 1.5 (before 6.5) | 14 (0) | 11 % (15 %) | 3.5 (5.0) | 6.0 (11.0) |
| Bahrain 150% | 6.0 (before 9.0 at 150%, 9.5 at 300%) | 88 (2) | 36 % (14 % / 46 %) | 16.5 (4.5 / 9.5) | 0 (3.0 / 0) |
| Silverstone 100% / 125% / 150% | 22.5 / 8.5 / 15.0 | 50 / 63 / 31 (7 / 0.5 / 0.5) | 21 / 30 / 42 % | 9.5 / 4.5 / 6.0 | 6.0 / 2.5 / 0 |
| Spa 100% / 125% / 150% | 19.0 / 9.5 / 8.5 | 132 / 87 / 35 (18 / 9 / 1) | 22 / 27 / 31 % | 8.0 / 11.5 / 10.0 | 3.5 / 3.5 / 1.0 |
| Suzuka 100% / 125% / 150% | 13.5 / 11.0 / 10.5 | 44 / 92 / 59 (2 / 2.5 / 1) | 20 / 30 / 44 % | 2.5 / 6.0 / 11.5 | 7.5 / 5.5 / 0.5 |
| Interlagos 100% / 125% / 150% | 4.0 / 7.5 / 8.5 | 17 / 38 / 14 (0.5 / 0.5 / 0) | 19 / 39 / 47 % | 2.5 / 1.0 / 4.5 | 9.0 / 4.0 / 0 |

What this shows, plainly: the shared aggressive profile commits to more moves and accepts more contact at the top level, but committed moves rarely complete (most passes still happen outside a committed move, as a car on better tyres or fuel simply gets by), and at 150% the field spends more time following than before. Identical drivers in identical cars, with no random pace differences, form trains; strategy differences by grid slot, mistakes and tyre wear break them up only partly. Overtaking between equal AI cars remains the weakest part of the racecraft.

**Prediction.** Each driver predicts the cars within reach for four seconds from what is observable: position, speed, longitudinal acceleration, brake lights and lateral motion. The prediction blends what a car is doing now with what a racing driver would expect it to do (follow its line at the speed the corner allows), adjusted by what this driver has seen of that car (its corner speed, where it places the car at the apex, whether it covers the inside when attacked). Racecraft decides how much of that expectation is used. Nothing is read from another driver's plan. Measured over races, the predicted position is unbiased, about 3 m out after one second and 10 m after two.

**One racing philosophy.** There are no personalities. All 19 AI drivers (and the AI stand-in for the player's car when it is driven by the AI) share one profile (`AI_RACER`): aggressive, impatient, high racecraft, a high tolerance for contact risk. They differ only through what happens in the race (grid position, tyres, fuel, damage, the cars around them), and the rank or difficulty sets one talent level for the whole field. There is no random per-driver speed. Starting strategy (tyres and fuel) varies with the grid slot instead of with a personality, so the field still splits across plans. The attitude:

- **Attack.** A car within striking distance (a few tenths of a second, or clearly closing) lines up a move quickly; a late dive from up to about two car lengths back is a move every driver makes. Following closer than before, a car stays on the gearbox to be ready.
- **Punish mistakes.** A rival's visible mistake ahead (a lock-up, running wide, a slide, a car off the track) is pounced on at once: the move goes in while the chance is there.
- **Defend only a real threat.** A car within about half a second behind, closing, at a real passing place (see Defending). A passive follower is not a threat.
- **Accept the consequences.** Contact, damage and retirement are part of racing hard; there are no safety nets for the AI that the player does not have.

**Mistakes and recovery.** Mistakes come from the situation: pressure from behind, an attack in progress, worn tyres, rain, a grip reading that lags the conditions, and the driver's consistency and difficulty. They are misjudgements played out by the physics: braking too late (more likely when attacking), locking up, running wide, too much throttle on worn tyres, overestimating the grip in changing weather, and underestimating a rival's pace. None is a scripted spin, crash or steering jolt. After a spin or an off the driver re-plans from where the car is and rejoins with a few seconds of extra margin; nobody is reset unless physically stuck.

**Adaptation.** Within a race only, and only from what can be observed: each 50 m of the lap is learnt both ways and within bounds — a real failure there (off the road, three or four tyres on paint the plan did not choose, a big tracking error, the steering run out) takes a little off it, never below 90 %, and clean laps give it back, quicker while it is below the driver's own estimate; learning upwards closes at most half of a driver's margin to the handling's ceiling, so it never erases the difference between levels; the driver's read of the grip follows the real grip with a lag (adaptable drivers read it faster; a slide corrects it at once; the error is bounded), so arriving rain is briefly over-driven; a rival's habits are learnt (bounded); a near miss or contact makes a driver more careful for a while; risk appetite rises as laps run out and falls when comfortably clear; the outside line is weighed down in the wet.

**Fairness.** The AI changes judgement, never the car: the same acceleration, braking, grip, tyre wear, fuel use and weight, damage, weather, off-track, pit, slipstream and collision physics as the player, through the same steering, throttle and brake controls. There is no DRS or ERS, no rubber-banding and no hidden boosts. No attacking or defending under yellow; the pit entry, exit and lane rules are unchanged. There are no blue flags: a lapped car races its own race and a lapping car has to pass it like anyone else. Higher levels predict better, judge paths better, execute more precisely, use a wider repertoire and make fewer mistakes (see AI difficulty).

**AI difficulty (100–150%).** One talent scale drives every level. The Grand Prix slider (0–100) covers the lower part of it, and its 100 is the 100% level the Rookie rank uses; the ranks are Rookie 100%, Pro 125% and Master 150% (`aiSkillForLevel`, `AI_MAX_LEVEL` = 1.5). Talent sets the share of the handling's yaw-rate ceiling used in corners (up to the physical ceiling, never more), of the car's braking, the precision of the pedal control, how far above the steady cornering limit the driver enters on the drift, mistakes (rarer and smaller, never zero), how far away a rival's mistake is seen and pounced on, and judgement (prediction, path judgement, execution scatter, racecraft), which approaches but never reaches perfect. Measured solo flying laps (`tools/pace-calibration.cjs`, dry, quickest tyres, four seeds, median):

| Circuit | GP slider 0% | Rookie 100% | Pro 125% | Master 150% |
|---|---|---|---|---|
| Monza | 82.15 s | 78.58 s | 77.77 s | 77.28 s |
| Silverstone | 86.35 s | 81.22 s | 80.33 s | 79.39 s |
| Spa-Francorchamps | 104.79 s | 98.75 s | 97.81 s | 97.18 s |
| Suzuka | 86.22 s | 81.51 s | 80.47 s | 79.84 s |
| Bahrain | 93.34 s | 87.12 s | 85.67 s | 84.09 s |
| Interlagos | 68.36 s | 64.49 s | 63.48 s | 62.50 s |

These are the game's own car and handling on the real layouts, with no time scaling; they are not tuned to real Formula 1 lap times (the game's car is quicker than a current F1 car on most of these circuits). The spread between levels is smallest at Monza, where most of the lap is flat out.

**AI diagnostics (development).** Open the game with `?aidebug` in the URL, or press `F9` during a session, for a panel showing one AI driver's mind: a top-down view with the chosen path, the candidate paths it weighed (feasible or not), the cars it is tracking with their predicted positions, and its braking point; and its tactical state and why, the move in progress and the reasons for any abort, its personality and skill parameters, risk budget, grip read, what it has learnt about the rival, and its candidate costs. `Shift+F9` picks the next AI car. It is off by default, adds nothing to the normal HUD and costs nothing while off.

## Visual effects

Every effect reacts to what the simulation is doing; nothing is a looping decoration. Effects use fixed-size pools (no allocation while racing), and the pool sizes scale with the Graphics quality setting.

| Situation | What you see |
|---|---|
| Car-to-car or barrier contact | Scaled by the impact's energy and direction. Light contact: sparks sprayed along the direction of sliding, a short flash, a small jolt of the body; wheels rubbing smoke. Moderate: carbon and painted splinters thrown along the push, the tyres scrub and leave marks as the car is shoved sideways. Heavy: pieces of bodywork, a cloud of tyre smoke (dust and turf off track), a car that keeps smoking from the damaged area for a few seconds, and a bounce off the ground; a front wheel riding up another car's rear wheel throws the car up. The body leans, pitches and squashes with each shove. The driver involved gets a directional jolt (the head snaps towards the impact in the cockpit), a brief flash and chromatic fringing; new damage pulses the screen edge red. |
| Parts breaking off | Front-wing endplates, then upper flaps, then the whole wing half; both halves lost in a frontal hit take the nose cone with them; rear-wing endplates, the upper flap, then the whole rear wing; mirrors in side impacts; floor fences; in a huge crash a broken corner's wheel can tear off its tethers. Each piece leaves the car where it was, keeps the car's momentum plus the push of the impact, tumbles, bounces, slides flat (sparking if it has metal on it, kicking up dust on the grass), stops at the barriers, gets kicked along by cars running over it, and is cleared after about 25 s. A new wing in the pits comes with its pieces. |
| Lock-ups, wheelspin, slides and drifts | Black rubber marks laid on the track. Normal driving makes no tyre smoke, so the car ahead stays visible. |
| Leaving the circuit | Dust clouds, flying gravel or turf, and ruts left in the gravel and grass. |
| Kerbs and rough ground | The car vibrates, the camera shakes, and over kerbs at speed the floor plank throws sparks. |
| Floor contact | Sparks when the plank touches down over kerbs, in the braking dive, when bottoming at top speed, and constantly with a damaged floor. |
| Heavy braking | Brake discs glow orange through the wheel spokes and cool down on the straights. |
| Damage | Sagging, swept-back and fluttering wings that scrape the ground and spark, wobbling bent suspension, broken corners whose wheel hangs on its tethers and flails about, punctured tyres that wobble and thump once per wheel turn (the car and the cockpit view bump with it), shredded tyres (rubber bits, rim sparks), scuffed paint, a grey smoke trail from a damaged power unit, white steam from damaged cooling or overheating, dark smoke from a failed engine. |
| Fire (rare) | A fireball when it starts, flames with a colour ramp, a column of black smoke, the fire lighting up its surroundings, the extinguisher, and soot on the bodywork afterwards. |
| Rain | Darker light, reflective wet asphalt, compact red rain lights without glare halos or reflection streaks, and suppressed white collision flashes on a wet track; cars throw no spray or mist, so cars ahead stay visible. Rain streaks that slant at you with speed, splashes on the ground and drops on the lens. |
| Speed | Rising field of view, radial speed blur, faint speed lines at the screen edges above about 230 km/h, high-speed buffeting and wheel blur. The *Speed blur & speed lines* setting turns the blur and lines off. |
| Pit stops | Crews at the wheels and wings, the car on its jacks and puffs from the wheel guns. The pit-service panel shows the same jobs as animated cards (see below). |

Cockpit view: the eye sits a little above the real eye line so the road and the front of the car stay clear, the halo's top bar runs along the top of the screen and its centre pillar stays narrow. The head rides on springs (forward under braking, back under power, outward in corners, bounced by kerbs and punctures, jolted by impacts) while the neck keeps the horizon steadier than the chassis, and the driver looks slightly into corners and towards a slide. The steering wheel turns with your steering and shows speed, gear, rpm, shift lights, fuel range and delta; damage, punctures, lost wings and fires flash a warning on it, and a bent corner holds it off-centre. Damage you can see from the seat: missing wing elements and nose, a wing dragging and sparking, a wheel hanging off its broken suspension, mirrors knocked off. The *Cockpit field of view* setting picks Narrow, Normal or Wide. **T-cam** is the TV onboard camera on top of the airbox.

Graphics quality: **Low** turns off shadows and post-processing (screen flashes fall back to a lightweight overlay) and uses the smallest particle budgets; **Medium** adds shadows, bloom, grading and the lens effects; **High** adds sharper shadows and textures, more multisampling, denser scenery and the largest particle budgets.

## Damage, repairs and retirement

Every car (player, bots and the pit autopilot) uses the same component damage model. Each impact is judged on the energy it dissipates at the contact point: closing speed, effective mass, where on the car it lands, from which direction, and how much each part was already weakened. Absolute speed does not matter, so cars running side by side can touch without consequence.

| Component | Failure behaviour | Effect on the car |
|---|---|---|
| Front wing (left / right halves) | Endplate and upper flap break off, the half sags and is bent back, then detaches and lies on track as debris | Less front downforce: understeer, mostly at speed |
| Rear wing | Tilts, endplates and the upper flap come off, then the whole wing; a destroyed rear structure retires the car | Less rear stability and downforce |
| Floor | Scrapes and sparks | Downforce loss everywhere |
| Suspension ×4 | Bent alignment, then breaks (retirement) | Less grip at that corner, the car pulls to that side, the steering shakes |
| Tyres ×4 | Slow leak or blow-out; a flat tyre shreds and the rim damages the corner | Grip, braking, traction and top speed loss, strong pull |
| Power unit | Misfires, then fails (stop safely) | Power loss |
| Cooling | Leaks and runs hot; overheating derates and wears the power unit | Lift-and-coast needed |
| Chassis | Structural; heavy damage retires the car | Slight handling loss |

Damage accumulates: repeated knocks below a part's threshold still weaken it, and a damaged part gives way sooner. Crushed wings pass leftover energy on to the suspension and tub behind them. Light contact leaves scratches and sparks; moderate impacts break wings, bend suspension or cut tyres; heavy crashes break suspension or the power unit and end the race.

**Pit repairs.** A damaged front wing (over 5 %, or a lost half) and a damaged rear wing (over 8 %, or lost) are replaced automatically at every stop, for every car: about 5 s for a front wing and 8 s for a rear wing, done at the same time as the tyres and fuel. The old wing and its handling effect stay on the car until its job is finished. A destroyed rear-wing assembly cannot be replaced, and suspension, floor, power unit, cooling and chassis damage are never repaired.

**Failures and fire.** Fires are rare and need a plausible cause, such as a power unit failing hot or after a heavy impact, or a huge impact into the fuel cell or battery. A car with a fire or catastrophic failure pulls off the racing line, stops and retires. Race control shows a yellow flag until marshals recover it. The driver is classified DNF and cannot rejoin; every car is restored for the next session.

**Vehicle Damage setting** (main menu, Race Settings or the pause menu; Standard by default):
- **Reduced:** minor contact is mostly cosmetic, failures are unlikely, no fires; only serious crashes end a race.
- **Standard:** balanced damage, punctures and repair decisions; big crashes have real consequences.
- **Realistic:** stricter thresholds, more cumulative damage, rare reliability failures and fires; heavy crashes can end the race.

When the car is damaged, the tyre panel (bottom right) becomes a vehicle-status panel: the car diagram colours each component by its condition, and the panel lists the worst problems with their handling effect and what a pit stop could repair, with its estimated duration.

## Controls

The core keyboard controls follow Super Star Car on Poki: WASD or arrow keys to drive, `Space` to respawn, and `C` to change the camera. Extra race features use the keys below.

| Action | Keys |
|---|---|
| Throttle / brake only | `W` `S` or `↑` `↓` |
| Steer | `A` `D` or `←` `→` |
| Controlled drift | `W` + `S` + `A`/`D` |
| Box this lap (optional: the autopilot takes the pit entry) | `P` |
| Tyres & pits panel | `V` |
| Camera / look back | `C` / `B` |
| Full leaderboard / telemetry | `Tab` / `T` |
| Scroll the leaderboard (all 20 cars) | mouse wheel / trackpad over it |
| Race start: rev on the grid (launch control) | hold `W` |
| Respawn car on track | `Space` (or `R`) |
| Pause menu | `Esc` |

Gamepads are supported (left stick steer, right trigger throttle, left trigger brake, Y camera, Start pause).

## Pit stops and fuel

**Rival Duel and Pursuit** have no fuel management: both cars start with the same fixed load (two laps plus a spare lap, `RANKED_FUEL_LAPS`), which burns and weighs exactly as in Grand Prix for both cars; there is no fuel choice, range display, refuelling or pit stop. Grand Prix and Career retain the fuel systems described below.

**Pit lane.** Each circuit has a pit lane beside its main straight, on the real side (the left at Interlagos, the right elsewhere): an entry ramp (180–300 m, long enough to move across smoothly from racing speed), a working lane limited to 100 km/h with four shared service boxes 16 m apart, and an exit ramp that merges back into the circuit. The speed limit runs from the end of the entry ramp to the start of the exit ramp. A clean tyre-only stop costs 19.3–24.4 s against staying out, depending on the circuit (measured per circuit, see **Circuits**). About 9 s of that is braking from the limit to a standstill, the 2–3 s service and accelerating away from rest. Queueing, refuelling and repairs add to that. Real pit lanes that leave or rejoin away from the main straight (Silverstone, Spa, Interlagos) are approximated by this lane.

**Four shared boxes, first come, first served.** There are no team garages, reservations or priorities. A car joins the pit queue when it physically crosses the pit-entry line. If a box is free, the earliest arrival gets one at once (the furthest free box down the lane with a clear approach); otherwise cars wait, in arrival order, in one queue just ahead of the boxes (a long queue reaches back up the outer half of the entry ramp, clear of the track), and the earliest waiting car takes the next box that comes free. Cars arriving in the same physics step are ordered by how far into the lane they are, then by car number. The player and the AI follow exactly the same rules.

**Driving in.** Steer into the pit entry at the edge of the main straight to commit to a stop; `P` (or the Tyres & pits panel) asks the autopilot to take the entry for you, but books nothing. A request made too late to brake and stop at the box you can expect (for example a few hundred metres from the entry at full speed) stays on, and the autopilot takes the entry next lap instead of diving in and missing the box. From the entry the autopilot drives: braking, queueing, turning into the box, stopping, the safe release and the exit. A car held in the fast lane by cars turning in ahead brakes early enough to turn into its own box at walking pace, and one that comes to rest a few metres off its marks (up to half a box spacing) is serviced where it stands. Control returns at the end of the exit ramp.

**Service at the box.** Tyres and fuel are chosen only when your car has stopped in its box, in the Pit Service panel: any of the four compounds or the current set (not when punctured), and fuel to add with a slider (shown with your current fuel, the amount added and the estimated range). The race keeps running while you decide, and the car holds its box until you press **Confirm service**. Bots choose instantly from their own tyre, fuel, weather and damage strategy. The crew does every job at once, so the car is stationary for the longest: tyres about 2–3 s (one stop in twenty has a sticking wheel nut, for every car), fuel 0.5 s plus 3 kg/s, a front wing about 5 s, a rear wing about 8 s.

**Pit Service panel.** Shows the stop's status (WAITING FOR BOX, TO BOX n, SELECT SERVICE, SERVICING, WAITING FOR SAFE RELEASE, PIT EXIT), the time in the lane or stationary, which of the four boxes are free or busy, your queue position when all four are taken, and one card per service (tyres, fuel, front wing, rear wing). A card animates only while its job is being done and turns complete only once the car itself has been changed: fuel counts up as it is pumped into the tank, the tyres show fitted after they are on, a wing shows replaced when the new one is on.

**Fuel and refuelling.** Refuelling is allowed (a rule of this game, not of modern Formula 1). Before the race, choose your starting fuel as 2–7 laps of range (6.5 is enough for all six laps without a stop). Fuel burns continuously with throttle and revs (2.15 kg per lap at Interlagos to 3.27 kg at Spa at race pace). The tank holds 8.5 laps' worth (about 23–24 kg). The HUD and the steering-wheel display show the estimated laps of range from your own measured consumption, an estimate rather than a guarantee. Running dry stops the car and retires it.

**Fuel weight (Grand Prix and Career).** In real Formula 1, an extra 10 kg of fuel costs about 0.3–0.4 s a lap. Here the effect is five times stronger, so the starting fuel and every refuel are real decisions. The lap time comes from how the car drives, not from a timer penalty. A heavier car accelerates more slowly, takes longer to stop and corners a little slower. It still reaches the same top speed on a long straight. As fuel burns off, the car gets quicker lap by lap, smoothly, with no steps. With an empty tank the car is exactly the base car, never faster. The fuel's real mass (800 kg + fuel) is unchanged for the tank, consumption, refuelling and collisions, so crashes are not five times harsher. Measured with one car alone on the track, dry weather, fuel held fixed:

| Circuit | 23 kg vs 9 kg (flying lap) |
|---|---|
| Monza | +3.45 s |
| Silverstone | +3.59 s |
| Spa-Francorchamps | +4.36 s |
| Suzuka | +3.53 s |
| Bahrain | +5.19 s |
| Interlagos | +3.39 s |

(`tests/fuel-weight.cjs`: fuel held at 23 and 9 kg, 8 seeds × 2 flying laps.) Bahrain is the most sensitive, with its slow corners and long full-throttle exits, then Spa, the longest lap.

On a flat test surface, 9 kg against 23 kg:

| | 9 kg | 23 kg | Without the fuel effect |
|---|---|---|---|
| 0–100 km/h | 2.9 s | 2.9 s | 2.9 s |
| 0–200 km/h | 5.9 s | 6.7 s | 5.6 s |
| 100–250 km/h | 5.8 s | 7.4 s | 5.0 s |
| Braking 250–80 km/h | 106 m | 120 m | 96 m |
| Cornering limit | −0.5 % | −1.3 % | — |
| Top speed | 329.9 km/h | 329.9 km/h | 329.9 km/h |

The launch is unchanged: the extra effective weight also presses the tyres down, so a car limited by wheelspin pulls away as before. The heavier car loses out once the engine, not the tyres, is the limit. No load makes the car quicker than it is without the fuel effect. On a circuit, the lighter car reaches 1–3 km/h more before the braking point at the end of a long straight. The pre-race fuel panel shows what each lap of fuel costs per lap at that circuit. See [the fuel-weight report](docs/fuel-weight.md) for the calibration, side effects and strategy-balance measurements.

Bots drive under exactly the same fuel-weight physics as the player. Their strategy compares plans on predicted race time. It weighs the lap time the fuel costs, refuelling time beyond the tyre change (0.5 s plus 3 kg/s), the time an extra stop loses, tyre wear, weather and laps remaining. They choose a starting load from 2 laps up to the whole race. If a tyre stop is coming anyway, they usually start light and refuel then. If nothing would make them stop, they carry the full race's fuel. At each stop they take fuel for the next stop they will really make, or for the flag. Bolder drivers keep a smaller margin and weaker strategists misjudge it more. They stop early when their fuel would not reach the next pit entry.

**Rival Duel and Pursuit** use the same fuel physics for both cars with one fixed, equal load (see above).

## Tyres and strategy

Four compounds: **Soft** (red), **Hard** (white), **Intermediate** (green) and **Full Wet** (blue). Wear is continuous and distance-based, scaled by how the car is driven (throttle, braking, sliding and wheelspin, cornering load, tyre temperature) and by the surface (a wet-weather tyre on a dry track overheats and wears several times faster). 60 % wear is a reference point, not a failure: a worn tyre keeps going with progressively less cornering, braking and traction grip, and past 80 % the puncture risk climbs with every metre (faster for a driver who slides the car).

| Compound | 60 % wear after (reference driving, suitable conditions) | Measured on the previous three circuits | Fresh pace |
|---|---|---|---|
| Soft | 12 km (2 laps) | 11.5–13.0 km | quickest: 2.4–3.4 s a lap faster than a fresh Hard (Monza 2.5, Silverstone 2.7, Spa 3.4, Suzuka 3.0, Bahrain 2.4, Interlagos 2.4) |
| Hard | 24 km (4 laps) | 22.9–25.4 km; 85–93 % after six laps | steady, lower grip |
| Intermediate | 12 km (2 laps) on a damp track | 11.1–12.7 km | best on a damp, moderately wet track |
| Full Wet | 24 km (4 laps) on a wet track | 23.0–25.6 km | best in heavy rain and standing water |

Grip falls gently to 60 % wear (about 8 %), then faster: a Soft at 75 % wear is 7.0–9.5 s a lap off its fresh pace on the six circuits, and at around 90 % a Hard was about 12–17 s off on the previous circuits: still drivable, but slow in the corners, long in the braking zones, easy to pass and quick to slide.

**No compulsory stops or compounds.** There is no mandatory pit stop, no two-compound rule and no strategy penalty. Typical dry six-lap plans: Hard all the way (no stop: no pit loss, but a very slow last lap or two and some puncture risk); Soft for two laps then Hard (strong opening, durable finish); Hard then Soft (a fast finish on fresh rubber); Soft three and three; and the Soft two-stop (rarely worth two pit losses). Measured with one AI car alone, the same driver, car and dry weather for every plan, two seeds (`node tools/strategy-compare.cjs`): on **Summit** Soft→Hard is quickest, the Soft two-stop about 4 s behind and the Hard no-stop 8–9 s (about 3 s when the driver pushes throughout); on **Rivermere** the two one-stops and the Hard no-stop finish within about 3 s; on **Redridge**, where grip matters least, Hard→Soft and the Hard no-stop finish within a second of each other. Soft three-and-three is 5–6 s behind everywhere. These comparisons were measured before the amplified fuel-weight effect (see Fuel weight above), which now makes a light start with a refuel more attractive against carrying the whole race's fuel; rerun the tool for current figures. In full 20-car races the AI picks from the same options: on Summit and Rivermere a mix of one-stops in both orders, Soft three-and-three and some Soft two-stops; on Redridge most of the field runs the Hard no-stop (16 of 20 in a sample race), with bolder drivers starting on the Soft. In traffic a Hard wears a little faster (about 16–17 % a lap rather than 15 %), which the planner sees in each car's measured wear and which can turn a planned no-stop into a late stop. (The plan comparisons above were measured on the three earlier, fictional circuits and have not been re-measured on the real ones; the strategy model itself uses each real circuit's measured pit loss, fuel and tyre figures.)

**Wet races.** The wet compounds follow the same rules in their own conditions: on a moderately wet track (55–70 % water) the field runs Intermediates with about two stops in six laps; on a heavily wet one (about 80 %) Full Wets with about one stop; an arriving front takes cars from slicks to Intermediates and then Full Wets as the water builds; a drying track brings one stop from Intermediates to slicks. Wet-weather tyres on a dry track overheat, lose grip and wear several times faster.

**Rival Duel and Pursuit** race on Softs only (the Pursuit rival's set starts part-worn), with the same wear and grip model.

**AI and the race engineer** plan from the same data the player has: each car's own measured wear and fuel use, the circuit's measured pit loss and pace sensitivity, the weather and the busy pit lane. The planner compares staying out with one- and two-stop plans over the laps left, pricing each plan's fuel load, refuelling time and any shortfall in range alongside tyre wear. Each driver adds a small, fixed leaning (bolder drivers favour the Soft and an extra stop; gentler tyre managers favour a longer stint), so close calls go different ways in the same race. The engineer recommends stops, compounds and fuel from that plan, and when staying out is the plan it says so, with the wear expected at the flag.

There is no DRS and no ERS: no drag-reduction flap or zones, no battery, recovery, deployment or overtake mode. The slipstream below is the only aerodynamic help for overtaking.

**Slipstream** is automatic and invisible, the same for the player and every bot: there is no button, setting or gauge. A car running at speed in the wake of the car ahead sees up to 15 % less aerodynamic drag, so it accelerates a little harder and reaches a higher speed at the end of a straight. The tow fades in from about 65 m behind, is strongest a few metres off the gearbox, fades as you pull out of the wake (it is gone about a car's width to the side, a little wider further back) and needs both cars quick, pointing the same way and genuinely one behind the other on the same part of the circuit, so nearby sections of the lap never tow each other. It builds and fades over a fraction of a second rather than switching. There is none in the pit lane (or from a car in it), with two or more tyres off the track, before the start or for a retired car. Only drag changes: following never costs downforce, grip, steering, braking or tyre life (there is no dirty air), and lifting or braking behind another car is exactly as without it. On a 1.8 km straight from 180 km/h, a full tow is worth about +20 km/h; a typical tow a few car lengths back is worth roughly half the full figure.

## Race start

Every car, player and AI alike, starts through the same automatic launch control. Hold `W` on the grid: the engine revs to the fixed launch rpm (`SPEC.launchRpm`, 7,000 rpm, the fastest 0–100 km/h launch in the drivetrain model) and the automatic clutch stays fully open, so no car can creep or jump the start and there is no false-start penalty. The rpm is regulated, not built up: holding `W` early gives exactly the same launch as holding it for a moment, and no fuel is metered on the grid. When the five red lights go out (after the usual random hold), the clutch engages automatically over 0.65 s while the throttle is applied. Pressing `W` at or after lights out launches the same way from that moment; without `W` the car stays where it is. AI drivers hold full throttle on the grid and launch through the identical code path, so after the start the field differs only by grid slot, tyres, team performance and traffic.

## Race engineer and race intelligence

**Shared race picture.** Once a second the race keeps one picture of every car built only from what a pit wall could see: the timing loops (each car's pace over the last 25 timing points against the same stretch a lap earlier), gaps and how fast they change, pit stops (when, and how far each car has run on its tyres since), an estimate of each car's tyre wear from its stint length and compound (never its real wear), visible damage (a puncture, a broken wing, a car slowing to stop) and the public weather forecast. From these it rates how vulnerable each car looks. It never reads another car's real tyre wear, fuel, ratings or plans. The same picture (`RaceIntel`) is read by the player's engineer and by every AI driver.

**AI drivers use it.** A vulnerable car ahead (losing pace, visibly damaged, on an old set) is attacked from further back and with more commitment, the more so for better racers; an AI strategist that sees the car behind pit while its own tyres are healthy pushes to stay ahead (the overcut) instead of reacting; a car with a real chance at the car ahead holds a flexible stop to keep attacking; and with rain likely within a few minutes on a dry track a good strategist delays a flexible stop for slicks. All of it changes decisions only: the cars, physics and controls are untouched.

**The player's engineer** speaks short radio messages (one sentence) and shows a compact caption, in three priorities:

| Priority | Examples |
|---|---|
| Critical | `Puncture. Pit when safe.` · `Front wing damaged. Expect understeer.` · `Engine overheating. Lift and coast.` · `Fuel won't last. Box this lap.` · `Tyres at the limit. Consider a stop.` · `Standing water. These tyres are struggling.` |
| Opportunity | `P6 is losing pace. You're closing.` · `Car ahead has front wing damage.` · `Car ahead is likely on worn tyres.` · `You're gaining four tenths a lap on P4.` · `Car ahead has pitted. Clear track ahead.` · `Car behind is closing.` |
| Strategy | `Rain likely in the next few minutes. Consider delaying your stop.` · `Box window open. Softs could be quicker now.` · `Pitting now could put you in traffic.` · `Your tyres may last to the finish.` · `Track is drying. Slicks may soon be faster.` |

Grand Prix and Career get all three. Rival Duel gets only the critical messages and what the rival is doing (damage, pace, the gap closing). Pursuit gets the gap to the rival twice a lap, with whether it is coming down (from the gap given half a lap earlier), plus critical messages and the rival's damage or pace. Messages are worded as estimates where they are estimates (`likely`, `may`, `could`).

**Voice playback.** Messages go into a small priority queue (critical, then opportunity, then strategy; oldest first within a priority; at most four). A new reading of a queued situation replaces the queued one rather than adding another; a message that is no longer true or older than its life (9–20 s) is dropped before it is spoken; each kind of message has a cooldown, the same situation is never announced twice, and chatter is spaced at least 10 s apart. **A message that has started is always finished**: braking, throttle, steering, gear changes, pit entry, contact, position changes and new events never cancel or restart it; a new message waits for it, then for a short gap. Speech stops only when the player switches the engineer voice off, mutes the game, leaves or restarts the race. If the browser blocks or fails speech (no voices, autoplay rules, an error) the caption still shows for its normal time and the queue moves on. Everything is the browser's own speech synthesis: no network, no external AI service.

Removed: the Virtual Safety Car and blue flags no longer exist. Serious accidents are covered by yellow flags in the marshal sectors; the slipstream is unchanged.

## Weather

Each new event rolls its starting weather with fresh randomness: an even 50/50 split between dry (sunshine or cloud) and rain (light, moderate or heavy rain, or a thunderstorm). A rainy start begins on a track that is already wet, close to the balance between that rainfall and drainage, so the field lines up on Intermediate or Full Wet tyres. Rival Duel and Pursuit always race on a dry track with no weather changes.

The weather is a persistent simulation, not a per-lap dice roll. A large-scale air mass (dry or wet) lasts several minutes and changes with equal odds in either direction, so a dry race can turn wet and a wet race can dry out; about four races in ten see such a change, and many stay as they started. Inside an air mass the conditions wander between neighbouring states: sunshine and cloud, and rain that strengthens, eases or builds into a thunderstorm with lightning, in passing bands of heavier and lighter rain. Cloud thickens before rain arrives and stays until the rain eases; a storm cell can build within a minute but still towers up first. Standing water fills with rainfall and drains and evaporates with cloud, temperature and wind; the racing line dries first as cars clear it. Grip, tyre wear and temperatures, fog and visibility, and AI tyre calls all follow the surface water and track temperature. The HUD forecast shows only an estimated rain chance and a broad, uncertain window, measured from cloud and rain trends.

## Automated checks

Run `node tests/movement.cjs` to check all 16 WASD/arrow combinations, brief input buffering, micro steering taps, acceleration, coasting, brake-only S, steering without automatic braking or throttle cuts, direction changes, three-key drift, drift recovery and consistency at different frame rates using the actual physics engine. It also checks that bots and the pit autopilot drive through the player's handling: a bot command moves the car exactly as the same player input does, bots finish a lap on the real circuit without reversing or needing recovery, and the autopilot completes a pit stop. The damage tests stage impacts on the real circuit and cover gentle wheel-to-wheel contact, relative-speed and wall impacts, accumulated knocks, punctures, aero, suspension, tyre and power-unit effects, overheating, fire rarity, pit repair times and limits, retirement with clean timing and results, bot pit decisions and the three damage levels.

Run `node tests/weather.cjs` to simulate thousands of events and races: starting weather splits evenly between dry and rain with matching track water, mid-race changes run both ways in balance without drifting towards sunshine or happening every lap, rain, cloud and water change progressively, a weather snapshot continues the same conditions, the forecast never recommends tyres or stops, and in real headless races a wet start, an arriving front and a drying track change grip, tyre temperatures and AI pit stops.

Run `node tests/pitstops.cjs` to check the pit system: the short 100 km/h working lanes and four shared boxes, strict first-come-first-served allocation with at most four boxes in use and one FIFO queue (simultaneous arrivals, requests with no priority, boxes freed by departures and retirements), a car with no pit request steering in and getting a box, the clean-stop loss on each circuit (17–27 s) against the circuit's measured value (within 2 s), queueing and refuelling lengthening a stop, service chosen only at the box with jobs running at once and wings replaced only when their job ends (other damage stays), fuel loads, mass and tank limits, and that DRS no longer exists anywhere in the game.

Run `node tests/intel.cjs` for the shared race picture: opponents' tyre wear is an estimate from public facts (compound, distance on the set) and never the hidden value; only visible damage is reported; a pace trend needs several samples (one slow sector is not a trend); AI drivers target a vulnerable car ahead from further back; AI strategy holds a flexible stop for a chance on track, overcuts an adjacent rival's stop on healthy tyres and delays a dry stop for a firm rain forecast; the player's engineer puts critical messages first, keeps every message short, does not repeat a situation and gives no pit, fuel or weather advice in Rival Duel and Pursuit (Pursuit reports the gap); and the VSC and blue flags are gone, a race-ending crash leaves the race running and the slipstream constants and drafting are unchanged. Run `node tests/engineer-voice.cjs` for the radio queue with the game's own `EngineerRadio` against a scripted speech engine: a message being spoken is never cut by driving, pit entry, position changes or new events; priority order, merging, expiry and the four-message limit; no backlog from a flood; blocked or throwing speech; and stopping on reset or voice off (but not on pause).

Run `node tests/slipstream.cjs` to check drafting on all six circuits: a tow that grows as the gap closes and fades smoothly when pulling out of the wake, none when stationary, slow, alongside, ahead, going the other way or misaligned, none between nearby but separate parts of a circuit, none in the pit lane, off the road, before the start or in calibration, identical results for the player and a bot, a measured but bounded straight-line gain, the tow as the only aerodynamic aid, unchanged downforce, cornering, braking and coasting, no strength or speed jumps, and 20-car races in which the bots draft, pit cars never do, top speeds stay sane and the scan stays cheap.

Run `node tests/offtrack.cjs` to check leaving the track: each tyre's position against the legal edge on all six circuits (matched against an exhaustive reference, including corners, hairpins and the pit entry and exit), one, two, three and four tyres off on a real straight, the progressively stronger slowdown with more tyres off and the 60–80 km/h speed with all four off, a 280 km/h excursion that slows hard without any jump, accelerating, braking and cornering off the track, a gradual return of grip on the asphalt, identical physics for player and AI cars, the same model on every off-track surface, the pit lane counting as track while it is used, the silent progress check against a corner cut and an infield shortcut, no warnings or penalties, and AI drivers shoved off the track at speed in a full race recovering on their own.

Run `node tests/progression.cjs` for the three ranks: exactly Rookie, Pro and Master at 100/125/150%; the position table for all 20 places; the pace score (smooth, monotonic and continuous per circuit and wetness, anchored on the measured laps, every whole number from 0 to 50 reachable, the standing start and pit stops normalised, mistakes not, one fast lap not hiding slow ones, retirements scoring 0 for laps not completed); circuit score and the six-best rank score capped at 600; best-per-circuit replays and sessions counted once; promotion needing all six circuits and 360/420/480; retirements keeping their classified place; Rival Duel and Pursuit needing all six attempted and five won, wins staying won, each mode independent; save round trips and broken data; migration from the five-tier Career and the eight-rank modes (access kept, nothing invented); a Career result from a real race; Rival Duel and Pursuit set-ups (side by side, same fuel and tyres, the Pursuit head start and per-circuit rival wear, same lights); no artificial catch-up; a race-ending crash not neutralising the race; and real two-car races on every circuit. `node tests/career-ai.cjs` (slow; `LEVELS=1,1.25,1.5`) benchmarks the levels: solo pace, duels between identical cars, dry and wet races, and `career`: six-lap Career races on all six circuits at each rank with three AI stand-in players (Rookie, Pro and Master skill) scored by the Career rules.

Run `node tests/ai-racecraft.cjs` to check the AI's racecraft on the real circuits: the old geometric line hugging the inside and the new racing line using the width (outside–apex–outside, inside at the apex, never past the track limits), a lone driver following its line with no time off, steering targets that never jump when plans change, two instrumented 20-car races (inside, outside, slipstream and other moves attempted, some completed and some called off with a reason, a car's width kept when side by side, at most one blocking move per defended corner, close cars on different lines, mistakes without wrecks, and the planning cost), a faster car spotting and taking a real opportunity, an attacker backing out when the door is closed, a covered inside becoming a switchback, one shared aggressive profile judging the same chance alike, a visible mistake pounced on at once, the grip read lagging rain within bounds, rivals' habits learnt within bounds, recovery from a high-speed off without a reset, no overtaking under yellow, the VSC and blue flags gone, higher ranks judging better with identical physics, Rival Duel and Pursuit running, and qualifying and Elimination gone.

Run `node tests/circuits.cjs` to build, validate and race all six circuits: published lengths, names and countries, overlap and barrier checks, racing direction, corner order, elevation ranges and vertical curvature, the Suzuka overpass (separate levels, no contact between them, walls on the bridge), the grid and pit lane on each main straight, surface continuity, the menu maps matching the playable centre line, Spa's gradients acting on a coasting car, a full 20-car field starting, racing, pitting (never more than four boxes in use, boxes given in arrival order, nobody stuck in the lane, overshooting a box or running out of fuel), overtaking and being classified on every circuit, and a two-lap Rival Duel on each (no pit stops, the winner completing two laps).

Run `node tests/fuel-weight.cjs` to check the fuel-weight effect: smooth, monotonic and neutral with an empty tank; real mass, collisions and the consumption formula unchanged; slower acceleration, longer braking and a lower cornering limit with fuel, but the same top speed; one fixed, equal load in Rival Duel and Pursuit; no effect in bare test rigs; 23 kg against 9 kg costing about 2.5–5.5 s a lap on each circuit and matching the circuit's stated cost per kg (slow); the strategy model's pricing of fuel weight, refuelling and extra stops; the AI's starting fuel and refuelling choices. `node tools/fuel-calibration.cjs` measures lap times at 9, 15 and 23 kg plus the straight-line, braking and cornering figures. `node tools/fuel-strategy-balance.cjs --scenario normal|nostop|high|rain` races light (3 laps), medium (4.5) and heavy (6) starting loads over the full six-lap distance.

Sporting time penalties and mandatory tyre-compound requirements are removed in every mode. Classification uses actual race performance; tyre changes are strategic. Flags, pit speed limits, damage and valid-distance checks remain active.

Run `node tests/sporting-rules.cjs` for penalty-free classification, strategic tyre choices, same-compound services, safety consequences and legacy save compatibility on all circuits and modes. `node tests/sporting-ui.cjs` checks setup, strategy, pit menus, results (including Career retry/accept and the ranked verdicts) and legacy settings for all four modes in Chromium using the production DOM functions without the 3D renderer; it uses the same Playwright tooling as screenshot capture (`CHROMIUM_PATH` can select a browser).

Run `node tests/runoff.cjs` for the green paint: the grip loss per tyre and the progressive rolling resistance (forced tyre counts), two seconds at 200 km/h on each circuit's flattest straight with the tyre surfaces held (held pedal, flat out, coasting, braking, cornering) against the asphalt and the grass, identical results for player and AI, where the planner may and may not use the paint, and 20-car races in which some paint use is planned while the paint and grass stay rare. `node tools/runoff-calibration.cjs` and `node tools/runoff-ai.cjs` print the measurements.

`node tools/pursuit-balance.cjs gap|wear|ranks` (slow) measures the head start between identical cars, scans the Pursuit rival's tyre wear per circuit and rank, and races every rank against chasers driven by the AI at 100/125/150%. `node tools/pace-calibration.cjs` measures the Career pace references, `node tools/circuit-calibration.cjs` the per-circuit pit loss, fuel and tyre figures, `node tools/field-benchmark.cjs` full-field racecraft statistics with matched seeds, and `node tools/defence-cost.cjs` what a passive follower costs the car ahead.

The headless tests load the simulation with a plain function rather than `vm.runInNewContext`, which ran it about five times slower.

**Known failures.** `tests/ai-racecraft.cjs` "20-car races: drivers attack with different moves, complete some": in the two instrumented three-lap races no committed move completes (moves are attempted, of several kinds, and called off with reasons; the few overtakes happen outside a committed move); see **Measured in full fields** under AI drivers. Present before the circuit change too, on the old circuits: `tests/movement.cjs` "arcade acceleration matches the observed 35–158 km/h segment" (the rig car reaches about 95 km/h), and three `tests/offtrack.cjs` checks (the exhaustive per-tyre reference disagrees on the pit entry ramp, which the game treats as a connected surface; "grass, gravel and asphalt run-off are one surface"; "the same ground is off-track for a car not in the pits" on the entry ramp).
