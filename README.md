# Apexra

Apexra is an arcade Formula racing game that runs in your web browser. You race against 19 computer-controlled drivers over six laps of real Formula 1 circuits. Along the way you manage your tyres, fuel and pit stops, and deal with weather that can change mid-race.

It's easy to pick up and hard to master. The opponents race hard, mistakes cost time, and the right strategy can win you a race.

---

## Starting the game

1. Download or clone this project.
2. Open **`index.html`** in a modern desktop browser (Chrome, Edge, Firefox or Safari).

You don't need to install anything. You do need an internet connection the first time, so the browser can download the 3D engine and the game's font.

If the game doesn't load when you double-click the file, your browser may be blocking local files. In that case, serve the folder with any simple local web server and open the address it gives you.

---

## Game modes

### Grand Prix
A single race, open whenever you like:

- six laps
- 20 cars: ten teams of two drivers
- any of the six circuits
- you drive car A1 for Team A, with a computer-controlled team-mate in A2, against the standard (100%) field
- you always start from the back of the grid, in P20

Grand Prix races don't count towards your Career, so it's the place to learn a circuit or try a strategy.

### Career
The main challenge: three championships, then Endless Career.

| Rank | Opponents | Points needed after six races |
|---|---|---|
| Rookie | 100% | 120 / 240 |
| Pro | 125% | 140 / 240 |
| Master | 150% | 200 / 240 |
| Endless Career | 150% | opens when you pass Master |

**Each rank is a six-race championship, raced in a fixed order:** Monza, Silverstone, Spa-Francorchamps, Suzuka, Bahrain, Interlagos. You can't skip a race, pick a later one or race one again.

**Every race counts, once.** There are no retries. A retirement counts as your result for that race, and so does a race you leave with Retire. If you close the browser during a Career race, it counts as a retirement before the first lap the next time you open the game.

**Promotion is decided after race 6.** Reach the target and the next rank opens for good. Miss it and you can start that rank's championship again from race 1. That's the only way to try again; a single race can never be replayed.

**Where you start:** race 1 of a championship starts from the back of the grid, in P20. After that you start each race where you finished the one before: finish P6 and the next race starts from P6; drop to P12 and the race after starts from P12. A retirement counts as the place you were classified in.

### Endless Career
Pass Master and Endless Career opens:
- Every race is six laps against the 150% field.
- The circuit is drawn at random, never the same one twice in a row. You see it before you start.
- Reloading the game doesn't change the draw.
- There's no last race: you build a **VR** rating, starting at 1,000, with 9,999 the maximum.

VR goes up after good races and down after poor ones (see below). The higher your VR, the smaller the gains and the bigger the losses, so staying near the top is hard.

---

## How Career scoring works

Each race is worth up to **40 points**, the same for every driver in the race:
- **Finishing position, up to 20:** P1 20 points, P2 19 … P20 1 point.
- **Best lap, up to 20:** every driver's fastest completed lap is ranked. Fastest 20 points, second fastest 19 … slowest 1 point.

So the race winner who also set the fastest lap scores 40. Finishing far back but setting the second-fastest lap still earns 19 lap points.

**Retirements.** Every car still in the race at the end ranks above every car that retired. Among retired cars, the later a car dropped out, the higher it ranks. A car that retires keeps its best completed lap for the lap ranking. A driver without a completed lap ranks below everyone who has one.

**When you retire, the race goes on.** The rest of the field races to the flag; press `Enter` (or choose *Skip to the result* in the pause menu) to have it run to the end straight away. Your result is worked out from the finished race, because cars may still retire behind you or set faster laps.

### VR (Endless Career)
A race score of **21 / 40** leaves your VR unchanged. Above 21 you gain, below 21 you lose, up to these limits:

| Your VR before the race | Best possible gain (40 / 40) | Worst possible loss (2 / 40) |
|---|---|---|
| 0–1,999 | +48 | −20 |
| 2,000–3,999 | +38 | −28 |
| 4,000–5,999 | +29 | −38 |
| 6,000–7,999 | +19 | −48 |
| 8,000–9,999 | +10 | −60 |

Scores in between give a share of the limit. For example, at 4,250 VR a score of 35 gains 21 VR. VR never goes above 9,999 or below 0, and a bad race still costs VR when you're at the top.

Your progress is saved automatically in your browser. If you clear your browser's site data, your Career progress is cleared too. Results from the previous 100-point Career are kept as history but don't count in the new championships; any ranks you had unlocked stay unlocked.

---

## The circuits

All six are real Formula 1 circuits in their current Grand Prix layouts, at their real lengths, with their real corners, direction and hills.

| Circuit | Country | Lap | What to expect |
|---|---|---|---|
| **Monza** | Italy | 5.793 km | The fastest circuit: long flat-out straights broken by tight chicanes, set in the woods of a royal park. |
| **Silverstone** | United Kingdom | 5.891 km | Fast, flowing corners on an old airfield in open countryside. |
| **Spa-Francorchamps** | Belgium | 7.004 km | The longest lap: deep forest, big climbs and drops, Eau Rouge and the Bus Stop chicane. Rain is common here. |
| **Suzuka** | Japan | 5.807 km | A figure of eight that crosses over itself on a bridge, with the famous S-curves and an amusement park beside the track. |
| **Bahrain** | Bahrain | 5.412 km | A floodlit night race in the desert, with hard braking into slow corners. |
| **Interlagos** | Brazil | 4.309 km | The shortest lap, run anticlockwise through a hilly bowl surrounded by the city of São Paulo. |

### Corner speed signs
Blue signs beside the track show a recommended speed in km/h before each corner that needs real braking, with an arrow for the corner's direction. They're a guide for a dry track on fresh tyres. In the rain or on worn tyres you'll need to go slower.

The game never brakes or steers for you. The signs are only there to help you learn where to slow down.

### Track limits and cutting corners
There are no time penalties or warnings. Cutting across a chicane simply doesn't pay:

- if you skip a chicane's apex, the distance you skipped isn't counted
- you have to drive that distance again before your lap and position count it

Using the kerbs, running a little wide, or putting two wheels over the inside kerb is all fine.

---

## Controls

| Action | Keyboard |
|---|---|
| Accelerate | `W` or `↑` |
| Brake | `S` or `↓` |
| Steer | `A` / `D` or `←` / `→` |
| Controlled drift | `W` + `S` + `A`/`D` |
| Launch at the start | Hold `W` on the grid |
| Switch between the chase camera and the cockpit (first-person) camera | `F` |
| Look back (in the cockpit: the camera on the nose shows your driver's face and hands) | `B` |
| Show or hide the pit plan | `V` |
| Pit plan: tyres Soft / Hard / Inter / Wet / keep | `1` `2` `3` `4` `5` |
| Pit plan: less / more fuel | `−` / `+` |
| Pit plan: repairs on or off | `0` |
| Car Status page (pauses the race) | `C` |
| Telemetry graph | `T` |
| Mute sound | `M` |
| Pause (and Retire from a race) | `Esc` |
| After retiring: skip to the result | `Enter` |

**Gamepad:** left stick to steer, right trigger to accelerate, left trigger to brake, Start to pause.

**Race start:** hold accelerate on the grid. Launch control holds the car and releases it automatically when the red lights go out, so there are no false starts.

---

## The race screen

You watch the race from a camera just behind your car. It stays at the same distance and height all the time, whether you're slow, flat out, braking or cornering.

Press `F` for the cockpit camera: you sit in the driver's seat, behind the halo, with your hands on the steering wheel. The hands turn the wheel as you steer, and the wheel's screen shows your gear, speed, rev lights, position, lap and best lap. All the usual race information stays on screen. Hold `B` in the cockpit to see the driver from the camera on the nose. The game remembers which camera you used last.

**Top right: race information**
- **LAP:** the lap you're on, for example `LAP 3 / 6`.
- **POS:** your current position, for example `POS 2 / 20`.
- **CURRENT** and **BEST:** your current lap time and your best lap of the race.

**Bottom left: track map**
The circuit with every car on it. The large white-ringed dot is you.

**Bottom centre: dashboard**
Speed (km/h), gear, engine revs and the shift lights.

**Bottom right: status panel**
- **Weather:** the chance of rain in the next few minutes, and how wet the track surface is right now.
- **Tyres:** which tyre you're on, and how worn the set is, as one figure and a bar.
- **Fuel:** roughly how many laps of fuel you have left. It turns red and says SHORT if you won't make the finish.
- **Car status:** `OK` when the car is healthy. When it's damaged, it says `DAMAGED` (or `CRITICAL` when a part is close to failing) and lists the two most serious problems in a few words, for example "Front wing — Less front downforce". If the car can't continue, it says `RETIRING` and then `RETIRED`. Press `C` for the full Car Status page.

**Car Status page (`C`)**
Opening it pauses the race; press `C` or `Esc` again to carry on. It shows:
- a top-down drawing of your car with every part marked, green when it's fine and yellow, orange or red when it's damaged
- a list of the damaged parts with their condition and what each one does to the car
- how the car handles right now, for example "Pulls left under braking" or "Slow gear changes"
- how long a pit stop with repairs will take, and which crew works on what

---

## Racing guide

### Tyres
There are four tyres. You choose your starting tyres before the race and can change them at a pit stop.

| Tyre | Use it for | Lasts about |
|---|---|---|
| **Soft** (red) | Dry track, maximum grip | 2–3 laps before it's clearly worn |
| **Hard** (white) | Dry track, steady pace | The whole six-lap race |
| **Intermediate** (green) | A damp or drying track | 3–4 laps |
| **Full Wet** (blue) | Heavy rain and standing water | 6–7 laps |

Tyres lose grip gradually as they wear, so you'll feel the car get slower and slide more long before they're finished. Very worn tyres can puncture. Wet-weather tyres overheat and wear quickly on a dry track.

**Two ways to win a dry race:**
- **No stop:** start on Hards with enough fuel for the whole race.
- **One stop:** start on Softs with less fuel, then stop for fresh tyres and more fuel.

Starting light on Softs and stopping once is usually a few seconds quicker over six laps, because the car is lighter for most of the race. The no-stop avoids the pit lane and any traffic after the stop, and on some circuits it's only a few seconds slower. Which one suits you depends on the circuit, the traffic and how you drive.

### Fuel
You choose your starting fuel before the race, measured in laps. A full car is heavier and slower, so starting light and refuelling at a stop is a real option. The status panel shows how many laps you have left, based on how you've actually been driving.

### Pit stops
Every team has its own box in the pit lane, shared by its two drivers.

**Plan the stop before you come in.** Press `V` to see your pit plan, and change it at any time while you drive:
- **Tyres:** `1` Soft, `2` Hard, `3` Intermediate, `4` Full Wet, or `5` to keep the tyres you're on. If you don't choose, you get a fresh set of the tyres you're using.
- **Fuel:** `−` and `+` change how many laps of fuel go in, half a lap at a time. By default the crew adds enough to reach the finish, worked out from how much fuel you've actually been using. The tank can't be overfilled.
- **Repairs:** on by default, so the crew fixes all the damage. Press `0` to skip the repairs and save time.

The panel also shows how long the stop will take.

**Making the stop**
1. Steer into the pit entry beside the main straight. From there the car drives itself.
2. It keeps to the 120 km/h pit-lane speed limit and parks in your team's box. If your team-mate is already in the box, your car waits just behind it until the box is free.
3. The crew carries out your plan straight away, with nothing to confirm. A small panel shows each job and the time left. A tyre change takes about 2–3 seconds. Refuelling and repairs can take longer; the crews work at the same time, and bigger damage takes longer to fix.
4. A light at the box turns green when it's safe to go. The car pulls out, drives to the pit exit and gives control back to you there.

A stop for tyres only costs about 16–17 seconds compared with staying out, depending on the circuit. The computer drivers use exactly the same pit lane, boxes, crews and timings as you.

### Weather
The weather changes during the race. Watch the rain chance and the track wetness on the status panel. Rain makes the track slippery, and it takes time for a wet track to dry out again. Getting the timing of a switch between dry and wet tyres right can gain or lose a lot of places.

On a wet track the tyres throw up a fine spray of water. It stays low and fades quickly, so you can always see the car in front.

### Slipstream
Following closely behind another car on a straight gives you a tow, which makes you faster. Use it to set up an overtake into the next braking zone.

### Track edges and forests
The road is bordered by red-and-white corner kerbs, green painted runoff, a usable grass or gravel recovery strip, and physical barriers. Entering green runoff costs 15% of your speed, taken off smoothly over about half a second (at 100 km/h the speed runs down to 85 and stops there), once per visit; staying on it adds modest resistance and grip loss. Returning to another surface rearms the next entry. Grass and gravel slow the car more, but held throttle keeps it moving and restores acceleration when you rejoin. The AI follows the same rules.

Each circuit has its own vegetation: temperate woodland at Monza, mixed countryside at Silverstone, Ardennes spruce and fir at Spa, Japanese woodland and cherry trees at Suzuka, dry woodland and palms at Bahrain, and subtropical greenery at Interlagos. Behind the fence the woods start with a band of shrubs and long grass. The trees are built from real-looking leaves, needles and palm fronds, sway in the wind (more in a storm), glow when the sun shines through them, and stand on a darker floor of leaf litter and ferns. Further away, woods cover the hills in clumps with open fields between. Large spectator complexes are replaced by nature; functional pits and circuit landmarks remain.

The implementation, measured before/after results and verification limits are documented in [the environment report](reports/environment-redesign/README.md). The reproducible render benchmark is `node tools/environment-benchmark.cjs`; set `BENCH_ROOT` to compare a checkout and `THREE_JS` to use a local Three.js 0.160 module.

### Graphics and smoothness
There is no graphics menu: the game picks a graphics level for your computer by itself and keeps checking that it runs smoothly.

- **High** (computers with a dedicated graphics card, Apple Silicon Macs): sharp shadows, the most detailed woods and full screen effects.
- **Medium** (good laptops with built-in graphics): softer shadows and lighter effects.
- **Low** (older or basic laptops, phones and tablets): no shadows or screen effects, fewer trees and a lower drawing resolution, so the game stays playable.

If the game can't keep up while you race, it first lowers its drawing resolution, then draws the distant woods less far, and finally switches to a lower level. It shows a short message when it does this, and the new level starts with your next race. If your computer runs smoothly for a long time, it moves up a level. The game remembers the level for your computer. To choose a level yourself, add `?quality=low`, `?quality=medium` or `?quality=high` to the end of the game's address.

### Lap timing and race position
Lap times are recorded when your car crosses the painted start/finish line. Positions follow completed laps and where each car is on the circuit, including the pit lane. Returning a tyre to the track clears extra shortcut braking, so held throttle accelerates the car again as grip returns. It does not move your timing line or leave your displayed position behind your car. Yellow flags and caution restrictions are removed. Reversing over the line and crossing it again cannot count an extra lap.

### Damage
The car is made up of more than 30 parts, and each one is tracked separately: front and rear wings, nose, floor, diffuser, sidepods, each corner's suspension, the steering, each tyre and wheel mounting, each brake, the engine, gearbox, drivetrain, cooling and air intakes, and the front and rear of the chassis.

What breaks depends on where you're hit, which way and how hard, not on luck:
- **Hitting a car with your front wing** damages the wing and nose, and the car understeers.
- **A hit to one wheel** can bend that corner's suspension, so the car pulls to one side, or damage the tyre, which can then lose air slowly or quickly.
- **A heavy hit from behind** can damage the rear wing, diffuser, gearbox or engine: less grip at the rear, slower gear changes, less power.
- **A big crash** can end your race straight away, for example if a wheel is torn off or the suspension or chassis is wrecked.

Every part that's damaged changes how the car drives, and you'll feel it immediately. A short notice tells you when something important is hit.

At a pit stop the crew can repair everything on a car that's still running, with repairs left on in your pit plan. Light damage takes a few seconds and heavy damage longer. A car that has retired stays out of the race. Damage never carries over to the next race.

**There is no respawn.** After a crash or a trip off the track you carry on with whatever damage the car has: drive it back onto the circuit yourself, and limp to the pits if you need repairs. If the damage is too serious, your race is over. If your car ends up stuck and can't move, choose *Retire* in the pause menu; in Career that counts as a retirement at that moment. The computer drivers live by the same rule: a car that can't get going again retires.

### Your opponents
The other 19 drivers all race the same way: hard, but fair.

- They attack when they see a chance.
- They use the slipstream.
- They defend only when someone is really trying to pass.
- They pounce immediately when a rival runs wide, spins or slows down.
- They leave room for a car that's alongside them.

They drive the same cars under the same rules as you, with no hidden boosts and no catch-up help. Their cars are damaged in the same way yours is, and they decide for themselves whether a repair stop is worth the time. Higher ranks make them faster and more precise, not more reckless.

---

## Credits

Circuit layouts are based on the TUM racetrack database and OpenStreetMap (© OpenStreetMap contributors), aligned with the bacinger/f1-circuits traces, with elevation from SRTM. The licences for this data are in [`docs/licenses`](docs/licenses), and the sources are described in [`docs/circuit-data.md`](docs/circuit-data.md).
