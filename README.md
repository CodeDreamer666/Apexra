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
- 20 cars
- any of the six circuits
- you drive for Team A against the standard (100%) field

Grand Prix races don't count towards your Career, so it's the place to learn a circuit or try a strategy.

### Career
The main challenge. Career has three ranks, and each rank asks you to race all six circuits:

| Rank | Opponents | Score needed to complete the rank |
|---|---|---|
| Rookie | 100% | 360 / 600 |
| Pro | 125% | 420 / 600 |
| Master | 150% | 480 / 600 |

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
| Tyres and pit info panel | `V` |
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
- **Car status:** `OK` when the car is healthy. When it's damaged, it says `DAMAGED` and lists what's wrong in a few words, for example "Front wing damaged" or "Suspension damaged — pulls right". If the car can't continue, it says `RETIRING` and then `RETIRED`.

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
1. Steer into the marked pit entry at the edge of the main straight and cross the gold line.
2. The car drives itself down the pit lane, at the 100 km/h speed limit, to a free service box.
3. In the box, choose your tyres and how much fuel to add, then confirm.
4. The crew works on the car. A damaged front or rear wing is replaced automatically.
5. The car drives itself to the pit exit and hands control back to you.

### Weather
The weather changes during the race. Watch the rain chance and the track wetness on the status panel. Rain makes the track slippery, and it takes time for a wet track to dry out again. Getting the timing of a switch between dry and wet tyres right can gain or lose a lot of places.

### Slipstream
Following closely behind another car on a straight gives you a tow, which makes you faster. Use it to set up an overtake into the next braking zone.

### Damage
Contact has immediate consequences, depending on how hard the hit was:
- **A light touch** is usually harmless.
- **A harder hit** can break the front wing, damage the suspension or hurt the engine, and the car will handle worse straight away.
- **A heavy crash** can end your race.

Wings can be replaced at a pit stop. Some damage, such as bent suspension, stays with you until the end of the race.

### Your opponents
The other 19 drivers all race the same way: hard, but fair.

- They attack when they see a chance.
- They use the slipstream.
- They defend only when someone is really trying to pass.
- They pounce immediately when a rival runs wide, spins or slows down.
- They leave room for a car that's alongside them.

They drive the same cars under the same rules as you, with no hidden boosts and no catch-up help. Higher ranks make them faster and more precise, not more reckless.

---

## Credits

Circuit layouts are based on the TUM racetrack database and OpenStreetMap (© OpenStreetMap contributors), aligned with the bacinger/f1-circuits traces, with elevation from SRTM. The licences for this data are in [`docs/licenses`](docs/licenses), and the sources are described in [`docs/circuit-data.md`](docs/circuit-data.md).
