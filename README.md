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
The main challenge. Career has three ranks, and each rank asks you to race all six circuits:

| Rank | Opponents | Score needed to complete the rank |
|---|---|---|
| Rookie | 100% | 360 / 600 |
| Pro | 125% | 420 / 600 |
| Master | 150% | 480 / 600 |

**Where you start:** your first race in a rank starts from the back of the grid, in P20. After that, you start every race in that rank where you finished the last one. Finish P6 and your next race starts from P6; drop to P12 and the race after starts from P12. A retirement counts as the place you were classified in. Replays count as your next race too, and a race you leave before the chequered flag doesn't change your grid spot. Each rank keeps its own starting position, so every new rank begins from P20. The Career screen shows your next starting position.

Completing a rank unlocks the next one. Ranks you've unlocked stay open, so you can go back and improve your results at any time.

---

## How Career scoring works

Each race is worth up to **100 points**: up to 50 for where you finish, and up to 50 for how fast you lap.

**Finishing position (up to 50 points)**

| P1 | P2 | P3 | P4 | P5 | P6 | P7 | P8 | P9 | P10 |
|---|---|---|---|---|---|---|---|---|---|
| 50 | 44 | 39 | 35 | 32 | 29 | 26 | 23 | 20 | 18 |

| P11 | P12 | P13 | P14 | P15 | P16 | P17 | P18 | P19 | P20 |
|---|---|---|---|---|---|---|---|---|---|
| 16 | 14 | 12 | 10 | 8 | 6 | 5 | 4 | 2 | 1 |

**Lap-time pace (up to 50 points)**

Every lap you complete is compared with a target time for that circuit, adjusted for how wet the track was. The score is the average over the whole race, so consistency matters as much as one quick lap.

- The slower first lap from the standing start is allowed for.
- Time spent in the pit lane doesn't count against you.
- Spins, trips off the track and heavy damage all show up in your lap times.
- Every point from 0 to 50 is possible.

**Retries and best scores**

- You can race any circuit in a rank as often as you like.
- Only your best score on each circuit counts, so a worse result never undoes a good one.
- A race you leave before the chequered flag doesn't count at all.

Your progress is saved automatically in your browser. If you clear your browser's site data, your Career progress is cleared too.

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
| Look back | `B` |
| Show or hide the pit plan | `V` |
| Pit plan: tyres Soft / Hard / Inter / Wet / keep | `1` `2` `3` `4` `5` |
| Pit plan: less / more fuel | `−` / `+` |
| Pit plan: repairs on or off | `0` |
| Car Status page (pauses the race) | `C` |
| Telemetry graph | `T` |
| Back onto the track (after the start) | `R` or `Space` |
| Mute sound | `M` |
| Pause | `Esc` |

**Gamepad:** left stick to steer, right trigger to accelerate, left trigger to brake, Start to pause.

**Race start:** hold accelerate on the grid. Launch control holds the car and releases it automatically when the red lights go out, so there are no false starts.

---

## The race screen

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

Both are competitive. Which one is quicker depends on the circuit and on how you drive.

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

A stop for tyres only costs about 15–16 seconds compared with staying out, depending on the circuit. The computer drivers use exactly the same pit lane, boxes, crews and timings as you.

### Weather
The weather changes during the race. Watch the rain chance and the track wetness on the status panel. Rain makes the track slippery, and it takes time for a wet track to dry out again. Getting the timing of a switch between dry and wet tyres right can gain or lose a lot of places.

### Slipstream
Following closely behind another car on a straight gives you a tow, which makes you faster. Use it to set up an overtake into the next braking zone.

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
