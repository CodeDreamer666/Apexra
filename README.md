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

Throttle and braking are controlled by the player's inputs. Steering never applies the brakes or imposes a corner speed target. Player acceleration, braking, yaw and lateral slide use arcade force curves. Surface resistance, fuel exhaustion, DRS and the pit limiter still affect it. Steering responds immediately to digital input, with a short rotation transient and automatic slide recovery. Brief key segments that fall between rendered frames are buffered. Collisions remain in the vehicle model. The handling runs inside the 240 Hz physics loop, independently of the rendering frame rate.

**Bots drive the same car.** Every AI driver, and the autopilot that takes the player's car through the pit lane, uses the player's handling: they press the same steering, throttle and brake controls, which go through the same arcade acceleration, braking, coasting, yaw and slide response. Bots plan corner speeds from the steering's turn-rate limit and braking points from the arcade braking, never reverse, and use the same respawn as the player when stuck.

Reference: [Super Star Car on Poki](https://poki.com/en/g/super-star-car) for bindings and the directly observed handling.

## What's inside

- **Circuits**: three six-kilometre circuits (see below), each with ridged red/white kerbs on both sides, pebbled gravel traps, painted run-off, braking-zone skid marks, 300/200/100 m braking boards, ad-board walls, catch fences, grandstands with a cheering (animated) crowd, waving team flags, a short pit lane with four shared, numbered service boxes and an illuminated event sign, a start gantry with working lights and APEX GRAND PRIX branding, a lattice sponsor bridge, TV camera towers, marshal light panels and its own landscape.
- **Graphics**: late-afternoon sun with long shadows, a sky with a warm sun halo and high cirrus (a dark, rolling cloud deck in the rain), HDR rendering with multisampling, bloom, ACES tone mapping and colour grading; reflections captured from the real scenery; team liveries on clear-coated bodywork; airfoil wing elements with DRS flap, rounded tyres with compound bands, see-through wheel faces and wheel blur at speed; contact shadows; stable sun shadows; a spring-damped chase camera; a cockpit view with its own slim halo, a steering wheel with a live display and gloved hands, and mirrors, plus a T-cam on the airbox; dynamic resolution to hold the frame rate.
- **Visual effects** (see below): sparks, debris, tyre smoke, dust, gravel, spray, fire, brake glow, tyre marks, rain and screen effects, all driven by the simulation.
- **Physics** (240 Hz; arcade pedal/yaw/slide response for every car, player and AI alike): four-wheel tyre model (Pacejka-style lateral force, friction circle, load sensitivity, lock-ups and wheelspin), downforce and drag (DRS, slipstream, dirty air, aero damage), longitudinal and lateral weight transfer, 8-speed gearbox, fuel mass and consumption (with refuelling), tyre temperature and wear (soft, medium, hard, wet), surface grip, wall and car-to-car collisions with component damage (see below).
- **AI drivers**: 19 opponents, each with pace, consistency, braking, racecraft, aggression, risk, tyre-management and strategy ratings. They drive the same arcade handling as the player, plan their own racing line, compute braking points and corner speeds from that handling's limits, learn each corner as they go, choose lanes around traffic, use slipstream and DRS to attack, defend the inside, give room, respect yellow and blue flags, make mistakes (late braking, over-braking, running wide, early throttle), recover after contact (respawning like the player when stuck), and plan and react to pit strategy (starting fuel, fuel and tyre stops, undercut, covering, damage stops, a busy pit lane). They predict where the car ahead is heading before committing to a gap, drive a damaged car with more margin, limp a punctured car back off the racing line, and stop safely when a failure ends their race.
- **Race weekend**: qualifying with out-laps and a session clock, standing starts with automatic launch control (see below), sector timing (purple/green/yellow), time gaps, track-limit warnings, penalties (track limits, causing a collision, overtaking under yellow), yellow flags, an automatic Virtual Safety Car for serious accidents (see below), pit stops at four shared boxes with refuelling (see below), chequered flag and classified results with points.
- **Modes**: race weekend (qualifying + race), quick race, and spectator mode with car switching, six cameras, an auto-director and up to 4× time.
- **Settings**: race length, AI difficulty, qualifying length, field size, weather, tyre wear, two-compound rule, vehicle damage (Reduced / Standard / Realistic), starting tyre and fuel, driver name and team, default camera, cockpit field of view, graphics quality, volume and units.

## Circuits

Start Grand Prix opens the circuit selection: three cards, each showing only the circuit's name and a glowing map drawn from the same centre line the playable track is built on. Click a card or use the arrow keys, then **Race here** (or Enter) to go to qualifying or the race; Back or Esc returns to the menu. The choice is saved in the browser, and the main menu's circuit card shows it.

| Circuit | Character | Corners | DRS zones |
|---|---|---|---|
| **Summit Grand Circuit** | Alpine highlands. A 1.7 km main straight, a tight technical complex climbing to the summit, a fast sweeping descent with about 40 m of elevation change, and a twisting final section back onto the straight. Snow-capped peaks, spruce forests, a lake and a chalet village. | 18 | 3 |
| **Rivermere Grand Prix** | River valley. Medium-speed flowing corners, a tight hairpin at the end of the main straight, a long diagonal back straight and a technical, hairpin-heavy far end that rewards braking and traction. A lake in the infield, a winding river, a castle, a village and broadleaf woods. | 15 | 2 |
| **Redridge International Circuit** | Red canyon. A 1.8 km main straight into heavy braking, a mix of fast sweepers and slow corners, a climb to the far ridge and a hook-shaped final hairpin. Several realistic overtaking spots. Red sandstone mesas and buttes, dry grass, pines and junipers. | 14 | 2 |

Each circuit is a genuine, separate track. Its centre line, track width, kerbs, run-off, gravel, barriers and collision walls, racing line, corner speeds and braking points, AI lanes, start grid, pit lane and boxes, sector timing, DRS detection and activation zones, marshal sectors, lap counting, minimap, terrain and scenery are all generated from that circuit's definition. Corner counts and DRS zones are measured from the geometry, not hard-coded. Elevation is one smooth height field per circuit. The simulation uses it for gradients: climbs cost speed, descents add it. The renderer lifts every vertex by the same field, so the road, kerbs, barriers, buildings, cars and effects follow the hills together. A geometry check (`Track.validate`) rejects layouts where separate parts of the lap come too close, a barrier reaches the road, a corner is too tight to drive or the gradient is excessive.

## Visual effects

Every effect reacts to what the simulation is doing; nothing is a looping decoration. Effects use fixed-size pools (no allocation while racing), and the pool sizes scale with the Graphics quality setting.

| Situation | What you see |
|---|---|
| Car-to-car or barrier contact | Scaled by the impact's energy and direction. Light contact: sparks sprayed along the direction of sliding, a short flash, a small jolt of the body; wheels rubbing smoke. Moderate: carbon and painted splinters thrown along the push, the tyres scrub and leave marks as the car is shoved sideways. Heavy: pieces of bodywork, a cloud of tyre smoke (dust and turf off track), a car that keeps smoking from the damaged area for a few seconds, and a bounce off the ground; a front wheel riding up another car's rear wheel throws the car up. The body leans, pitches and squashes with each shove. The driver involved gets a directional jolt (the head snaps towards the impact in the cockpit), a brief flash and chromatic fringing; new damage pulses the screen edge red. |
| Parts breaking off | Front-wing endplates, then upper flaps, then the whole wing half; both halves lost in a frontal hit take the nose cone with them; rear-wing endplates, the DRS flap, then the whole rear wing; mirrors in side impacts; floor fences; in a huge crash a broken corner's wheel can tear off its tethers. Each piece leaves the car where it was, keeps the car's momentum plus the push of the impact, tumbles, bounces, slides flat (sparking if it has metal on it, kicking up dust on the grass), stops at the barriers, gets kicked along by cars running over it, and is cleared after about 25 s. A new wing in the pits comes with its pieces. |
| Lock-ups, wheelspin, slides and drifts | Tyre smoke from the wheel that is scrubbing, and black rubber marks laid on the track. |
| Leaving the circuit | Dust clouds, flying gravel or turf, and ruts left in the gravel and grass. |
| Kerbs and rough ground | The car vibrates, the camera shakes, and over kerbs at speed the floor plank throws sparks. |
| Floor contact | Sparks when the plank touches down over kerbs, in the braking dive, when bottoming at top speed, and constantly with a damaged floor. |
| Heavy braking | Brake discs glow orange through the wheel spokes and cool down on the straights. |
| Damage | Sagging, swept-back and fluttering wings that scrape the ground and spark, wobbling bent suspension, broken corners whose wheel hangs on its tethers and flails about, punctured tyres that wobble and thump once per wheel turn (the car and the cockpit view bump with it), shredded tyres (rubber bits, rim sparks), scuffed paint, a grey smoke trail from a damaged power unit, white steam from damaged cooling or overheating, dark smoke from a failed engine. |
| Fire (rare) | A fireball when it starts, flames with a colour ramp, a column of black smoke, the fire lighting up its surroundings, the extinguisher, and soot on the bodywork afterwards. |
| Rain | Darker light, reflective wet asphalt, red rain lights that reflect on the road, rooster-tail spray and a mist cloud behind each car, rain streaks that slant at you with speed, splashes on the ground and drops on the lens. |
| Speed | Rising field of view, radial speed blur, faint speed lines at the screen edges above about 230 km/h, high-speed buffeting and wheel blur. The *Speed blur & speed lines* setting turns the blur and lines off. |
| Pit stops | Crews at the wheels and wings, the car on its jacks and puffs from the wheel guns. The pit-service panel shows the same jobs as animated cards (see below). |

Cockpit view: the eye sits a little above the real eye line so the road and the front of the car stay clear, the halo's top bar runs along the top of the screen and its centre pillar stays narrow. The head rides on springs (forward under braking, back under power, outward in corners, bounced by kerbs and punctures, jolted by impacts) while the neck keeps the horizon steadier than the chassis, and the driver looks slightly into corners and towards a slide. The steering wheel turns with your steering and shows speed, gear, rpm, shift lights, fuel range and delta; damage, punctures, lost wings and fires flash a warning on it, and a bent corner holds it off-centre. Damage you can see from the seat: missing wing elements and nose, a wing dragging and sparking, a wheel hanging off its broken suspension, mirrors knocked off. The *Cockpit field of view* setting picks Narrow, Normal or Wide. **T-cam** is the TV onboard camera on top of the airbox.

Graphics quality: **Low** turns off shadows and post-processing (screen flashes fall back to a lightweight overlay) and uses the smallest particle budgets; **Medium** adds shadows, bloom, grading and the lens effects; **High** adds sharper shadows and textures, more multisampling, denser scenery and the largest particle budgets.

## Damage, repairs and retirement

Every car (player, bots and the pit autopilot) uses the same component damage model. Each impact is judged on the energy it dissipates at the contact point: closing speed, effective mass, where on the car it lands, from which direction, and how much each part was already weakened. Absolute speed does not matter, so cars running side by side can touch without consequence.

| Component | Failure behaviour | Effect on the car |
|---|---|---|
| Front wing (left / right halves) | Endplate and upper flap break off, the half sags and is bent back, then detaches and lies on track as debris | Less front downforce: understeer, mostly at speed |
| Rear wing | Tilts, endplates and the DRS flap come off, then the whole wing; a destroyed rear structure retires the car | Less rear stability and downforce |
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
| DRS (open, inside a zone when eligible) | `G` |
| Box this lap (optional: the autopilot takes the pit entry) | `P` |
| Tyres & pits panel | `V` |
| Camera / look back | `C` / `B` |
| Full leaderboard / telemetry | `Tab` / `T` |
| Race start: rev on the grid (launch control) | hold `W` |
| Respawn car on track | `Space` (or `R`) |
| Pause menu | `Esc` |
| Qualifying: skip to the end | `K` |

Gamepads are supported (left stick steer, right trigger throttle, left trigger brake, X DRS, Y camera, Start pause).

## Pit stops and fuel

**Pit lane.** Each circuit has a 203 m pit lane beside its main straight: a 70 m entry ramp, the 80 km/h zone with four shared service boxes 16 m apart, and a 60 m exit ramp that merges back into the circuit. The speed limit runs from the end of the entry ramp to the start of the exit ramp; speeding costs 5 s. A clean tyre-only stop loses about 14.4–14.8 s against staying out (Rivermere 14.4 s, Redridge 14.7 s, Summit 14.8 s, measured by simulation and checked by the tests). Queueing, refuelling and repairs add to that.

**Four shared boxes, first come, first served.** There are no team garages, reservations or priorities. A car joins the pit queue when it physically crosses the pit-entry line. If a box is free, the earliest arrival gets one at once (the furthest free box down the lane with a clear approach); otherwise cars wait, in arrival order, in one queue on the entry ramp, and the earliest waiting car takes the next box that comes free. Cars arriving in the same physics step are ordered by how far into the lane they are, then by car number. The player and the AI follow exactly the same rules.

**Driving in.** Steer into the pit entry at the edge of the main straight to commit to a stop; `P` (or the Tyres & pits panel) asks the autopilot to take the entry for you, but books nothing. From the entry the autopilot drives: braking, queueing, turning into the box, stopping, the safe release and the exit. Control returns at the end of the exit ramp.

**Service at the box.** Tyres and fuel are chosen only when your car has stopped in its box, in the Pit Service panel: any of the five compounds or the current set (not when punctured), and fuel to add with a slider (shown with your current fuel, the amount added and the estimated range). The race keeps running while you decide, and the car holds its box until you press **Confirm service**. Bots choose instantly from their own tyre, fuel, weather and damage strategy. The crew does every job at once, so the car is stationary for the longest: tyres about 2–3 s (one stop in twenty has a sticking wheel nut, for every car), fuel 0.5 s plus 3 kg/s, a front wing about 5 s, a rear wing about 8 s.

**Pit Service panel.** Shows the stop's status (WAITING FOR BOX, TO BOX n, SELECT SERVICE, SERVICING, WAITING FOR SAFE RELEASE, PIT EXIT), the time in the lane or stationary, which of the four boxes are free or busy, your queue position when all four are taken, and one card per service (tyres, fuel, front wing, rear wing). A card animates only while its job is being done and turns complete only once the car itself has been changed: fuel counts up as it is pumped into the tank, the tyres show fitted after they are on, a wing shows replaced when the new one is on.

**Fuel and refuelling.** Refuelling is allowed (a rule of this game, not of modern Formula 1). Before the race, choose your starting fuel as 3–8 laps of range. Fuel is carried as mass, so a light car accelerates slightly harder, and burns continuously with throttle and revs (about 2.7–2.8 kg per lap at race pace). The tank holds 8.5 laps' worth (about 23–24 kg). The HUD and the steering-wheel display show the estimated laps of range from your own measured consumption, an estimate rather than a guarantee. Running dry stops the car and retires it. Bots pick their own starting fuel for their planned first stint, refuel for the laps to their next planned stop or the flag, and stop early when their fuel would not reach the next pit entry.

**DRS** is manual for the player: press `G` inside a DRS zone when you are eligible (within one second of the car ahead at the detection point, dry track, from lap 3). Braking or the end of the zone closes it, and it stays closed until you press `G` again. The DRS chip on the dashboard shows OFF, CLOSED, READY (outlined) or OPEN (solid). Bots open DRS whenever they are eligible.

There is no ERS: no battery, recovery, deployment or overtake mode.

## Race start

Every car, player and AI alike, starts through the same automatic launch control. Hold `W` on the grid: the engine revs to the fixed launch rpm (`SPEC.launchRpm`, 7,000 rpm, the fastest 0–100 km/h launch in the drivetrain model) and the automatic clutch stays fully open, so no car can creep or jump the start and there is no false-start penalty. The rpm is regulated, not built up: holding `W` early gives exactly the same launch as holding it for a moment, and no fuel is metered on the grid. When the five red lights go out (after the usual random hold), the clutch engages automatically over 0.65 s while the throttle is applied. Pressing `W` at or after lights out launches the same way from that moment; without `W` the car stays where it is. AI drivers hold full throttle on the grid and launch through the identical code path, so after the start the field differs only by grid slot, tyres, team performance and traffic.

## Virtual Safety Car

Race control neutralises the race with a **Virtual Safety Car** (VSC) after a serious accident or a dangerous obstruction. There is no physical safety car, no button and nothing to confirm: it is fully automatic and the same for the player and every bot.

**When it comes out.** Race control watches every crash of 25 kJ or more at the contact (wheel-to-wheel taps and scrapes are far below that) and judges it on what happens next. It deploys the VSC for:

| Incident | What it takes |
|---|---|
| A crash that ends a car's race | The car starts retiring after the impact; deployed about a second later. |
| A car on fire | The car pulls off and stops; marshals put the fire out. |
| A huge impact leaving the car stranded | 150 kJ or more, and the car is stopped on or at the edge of the track for 1.5 s. |
| A serious impact leaving the car on the racing line | 60 kJ or more, and the car is stopped on the racing surface for 2 s. |
| A pile-up | Two or more crashed cars stopped on or beside the track together. |
| A dangerous obstruction | A car with a failure comes to rest on the racing surface instead of pulling off. |

Minor contact, a light barrier hit, a lost wing or other debris, a spin or a trip through the gravel with the car driving on, and a routine failure where the car pulls off safely are left to the yellow flags. There are **at most two VSC periods per race**. There is none before lights out, after the chequered flag, while one is already out, or when the leader is within 2.5 km of the flag (the neutralisation must be over before anyone can finish under it). An incident that cannot have a VSC never gets one later. Nothing is random: the same incident always gets the same response.

**How long.** Each period lasts **10–20 s in total**, from the announcement to the green flag, chosen from the incident: 12 s for an obstruction, 13 s for a stranded car, 14 s for a race-ending crash, 15 s for a pile-up, 16 s for a fire, plus 1.5 s when a car is stopped on the racing line and 1 s for each further car involved (at most 19.5 s). The last five seconds are the restart countdown.

**Automatic control.** On deployment race control drives every car on the circuit, the player's included, through the same arcade controls the drivers use (throttle, brake, steering), with the AI's own navigation, corner speeds and collision avoidance. Player inputs are ignored until the green flag: held keys and taps are not stored up for later, DRS is shut and respawning is disabled. Each car:

- slows progressively to the VSC speed: race control's target falls by 10 m/s² from the speed the car had at deployment to 100 km/h for the leader (lower in corners, which are braked for as usual);
- follows the car physically ahead of it on the circuit (by track distance), closing the gap at up to 200 km/h with planned, gentle braking, and settles 11 m + 0.32 s × speed behind it, nose to nose. A car that was already closer eases back at 3 m/s, never to less than about 3 m between the cars, and brakes firmly only if it is closing in on the car ahead;
- never passes another car in the queue, so the classification and laps-down are kept. A lapped car stays where it is on the road, so it is neither unlapped nor lapped again. Cars stopped, spun or stranded by the incident are driven around, not queued behind.

In this fictional version the field is deliberately bunched up for the restart, as far as is safe in the time available: no car is forced into an impossible catch-up, and collision-free driving comes before a tight queue.

**Pit stops under the VSC.** The four shared boxes keep working first come, first served. A car already in the pit lane carries on with its stop: queueing, service at the box (tyres, fuel and wing repairs; the player still chooses in the Pit Service panel), the stop timers and the safe release. A car may take the pit entry under the VSC (bots on their own strategy, the player with `P`, the autopilot taking the entry). A car committed to the pit entry leaves the queue, and cars behind drive around it as it peels off. A car leaving the pits yields at the exit as usual and joins the queue behind the car ahead of it on the road.

**Restart.** At five seconds to go the panel counts down `VSC ENDING — 5, 4, 3, 2, 1` while cars hold formation. At zero, `GREEN FLAG — RACING RESUMES`: control returns to the player and the bots in the same physics step. The player's pedals continue from where race control left them, through the handling's normal throttle response, and the steering eases over 0.4 s, so there is no jump. Overtaking, DRS (earned again at the next detection point), strategy and the rest of the AI's decisions resume at once.

**Race rules carry on.** The race clock, lap counting, gaps, positions, fuel burn, tyre wear and temperatures, weather, damage and pit timers all run as normal. Distance driven under the VSC counts towards the race. Laps run partly under the VSC are not used for the fuel-consumption estimate.

**On screen.** A compact race-control panel at the top centre shows `VIRTUAL SAFETY CAR DEPLOYED` for three seconds, then shrinks to a slim VSC strip with a bar for the time left. It then shows the countdown and, for 2.5 s, the green flag. The top flag bar shows amber stripes while the VSC is out and green at the restart. The leaderboard shows VSC in place of GRAND PRIX, and the DRS chip reads OFF.

## Weather

Each new event rolls its starting weather with fresh randomness: an even 50/50 split between dry (sunshine or cloud) and rain (light, moderate or heavy rain, or a thunderstorm). A rainy start begins on a track that is already wet, close to the balance between that rainfall and drainage, so the field lines up on Intermediate or Full Wet tyres. With qualifying, the race continues qualifying's weather (it keeps evolving for the two minutes it takes to form the grid) rather than resetting it.

The weather is a persistent simulation, not a per-lap dice roll. A large-scale air mass (dry or wet) lasts several minutes and changes with equal odds in either direction, so a dry race can turn wet and a wet race can dry out; about four races in ten see such a change, and many stay as they started. Inside an air mass the conditions wander between neighbouring states: sunshine and cloud, and rain that strengthens, eases or builds into a thunderstorm with lightning, in passing bands of heavier and lighter rain. Cloud thickens before rain arrives and stays until the rain eases; a storm cell can build within a minute but still towers up first. Standing water fills with rainfall and drains and evaporates with cloud, temperature and wind; the racing line dries first as cars clear it. Grip, tyre wear and temperatures, spray, fog and visibility, and AI tyre calls all follow the surface water and track temperature. The HUD forecast shows only an estimated rain chance and a broad, uncertain window, measured from cloud and rain trends.

## Automated checks

Run `node tests/movement.cjs` to check all 16 WASD/arrow combinations, brief input buffering, micro steering taps, acceleration, coasting, brake-only S, steering without automatic braking or throttle cuts, direction changes, three-key drift, drift recovery and consistency at different frame rates using the actual physics engine. It also checks that bots and the pit autopilot drive through the player's handling: a bot command moves the car exactly as the same player input does, bots finish a lap on the real circuit without reversing or needing recovery, and the autopilot completes a pit stop. The damage tests stage impacts on the real circuit and cover gentle wheel-to-wheel contact, relative-speed and wall impacts, accumulated knocks, punctures, aero, suspension, tyre and power-unit effects, overheating, fire rarity, pit repair times and limits, retirement with clean timing and results, bot pit decisions and the three damage levels.

Run `node tests/weather.cjs` to simulate thousands of events and races: starting weather splits evenly between dry and rain with matching track water, mid-race changes run both ways in balance without drifting towards sunshine or happening every lap, rain, cloud and water change progressively, qualifying weather carries into the race, the forecast never recommends tyres or stops, and in real headless races a wet start, an arriving front and a drying track change grip, tyre temperatures and AI pit stops.

Run `node tests/pitstops.cjs` to check the pit system: the 203 m lanes and four shared boxes, strict first-come-first-served allocation with at most four boxes in use and one FIFO queue (simultaneous arrivals, requests with no priority, boxes freed by departures and retirements), a car with no pit request steering in and getting a box, the 10–15 s clean-stop loss on each circuit against the circuit's stated value, queueing and refuelling lengthening a stop, service chosen only at the box with jobs running at once and wings replaced only when their job ends (other damage stays), fuel loads, mass and tank limits, and manual DRS.

Run `node tests/vsc.cjs` to check the Virtual Safety Car with staged crashes on the real circuits. On Summit Grand Circuit, Rivermere Grand Prix and Redridge International Circuit, with the player in a 20-car field, a race-ending crash brings out the VSC within seconds. The period lasts 10–20 s with an exact five-second countdown. The player's car is driven by race control throughout (held inputs never reach it) and gets control back in the green-flag step without a throttle jump. Queued cars never pass, touch or jump position, and the field closes up. Classification and laps-down are unchanged, and the clock, weather, fuel, tyre wear, compounds, damage and lap counting carry on. It also checks that minor contact, a light barrier hit, an off, debris and a routine failure bring no VSC, while a car stranded on the racing line does. It checks the two-per-race limit, none during an active VSC, before the start, after the flag or near the finish, and pit stops continuing under the VSC (service timers, the player's autopilot taking the entry, rejoining from the exit). Lapped cars stay lapped, and with no incident the race is identical to the metre to one with the VSC system switched off.

Run `node tests/circuits.cjs` to build, validate and race all three circuits: lengths, overlap and barrier checks, corner counts and DRS zones, the grid and level pit lane on each main straight, the menu maps matching the playable centre line, the effect of gradients on a coasting car, a full 20-car field starting, racing, pitting (never more than four boxes in use, boxes given in arrival order, nobody stuck in the lane, overshooting a box or running out of fuel), using DRS and being classified on every circuit, and qualifying on each.
