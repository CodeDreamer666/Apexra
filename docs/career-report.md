# Career, race scoring, retirement and Endless VR: report

All results below come from the game's own simulation and from automated browser tests. No human has played these
changes.

## A. Removed functionality

**Respawning**
- The player's respawn: the `R` and `Space` keys in a race, the "Car respawned on track" message, and the "Respawn on
  track" line on the Controls screen.
- `Session.marshalReset` (the teleport back to the track edge) is deleted.
- The AI's own respawn (`AIDriver.respawn`, used for "stuck" and "marshal assistance") is deleted. An AI car that cannot
  move for 5 s (throttle on, below 0.6 m/s), or has not got back on the track after 45 s plus any time spent waiting for
  traffic, now retires ("Stuck" / "Unable to rejoin"), as a player's car would. In six full races at 150% AI, dry and
  wet, the old respawn had never been used.
- Damage is never reset during a race; pit repairs are unchanged.

**Old scoring**
- The 100-point race score: 50 for position (P1 50 … P20 1) plus 50 for lap-time pace.
- The lap-time pace model (`PACE_REF` reference laps per circuit and wetness, the anchors and monotone-cubic
  interpolation, `careerPaceScore`), with the per-lap pace record it needed (`paceLaps`, `lapAcc`, `lineAt`).
- The 600-point rank score, the 360 / 420 / 480 thresholds, the "best result per circuit" rule, free circuit choice,
  replays and the results-screen Retry button.
- The obsolete calibration tool `tools/pace-calibration.cjs`.

## B. New scoring system

Every driver in every race (Grand Prix and Career) is scored by `scoreRace`:
- **Position points = 21 − finishing position.**
- **Lap points = 21 − best-lap rank.**
- **Race score = position points + lap points**, between 2 and 40, always an integer.

**Finishing position (`Session.raceCompare`).**
- Cars still in the race at the end come first. Cars that took the flag are ordered by laps and by finish-line time,
  from the race's own timing. Cars still running when the race is closed are ordered by race distance.
- Retired cars come after all of them: the later the retirement (race time, which a pause doesn't affect), the higher
  the place. At the same moment, the car that had got further ranks higher; then the fixed driver order.
- A car that was still pulling off to retire when the race ended counts as retired.
- Positions are always unique, P1 to P20.

**Best lap (`rankBestLaps`).**
- Each driver's fastest valid, completed lap is used, at full precision. A valid lap passes all three sectors and isn't
  backed across the line. A shortcut can't shorten a lap, because the distance it skips is withheld from the car's race
  progress.
- Exactly equal times: the lap set earlier in the race wins, then the driver order.
- Drivers without a lap rank below everyone with one. Among them, the one who stayed in the race longer ranks higher
  (a car still running at the end counts as longest), then the one that got further, then the driver order.

**Lap 1** is now timed from the start line, like every other lap. Before, it included each car's run-up from its own
grid slot, so the back of the grid was penalised.

## C. Career progression

- Rookie (100% AI), Pro (125%) and Master (150%) are each a six-race championship in a fixed order: Monza,
  Silverstone, Spa-Francorchamps, Suzuka, Bahrain, Interlagos. The Career screen enables only the next scheduled race;
  the others show as done or upcoming.
- One attempt per race:
  - The race brief's start button saves the race as the active attempt.
  - Its result is saved before the next race opens.
  - The results screen offers only "Next race" (or the championship verdict); there is no Retry.
  - A retirement, and the player's Retire, both count as the result.
- After race 6 the championship (out of 240) is judged: Rookie 160, Pro 180, Master 200. A pass unlocks the next rank
  permanently; passing Master opens Endless Career.
- A failed championship, or a new attempt at a passed one, starts again from race 1. That is the only restart. It is
  refused in the middle of a championship, and it never re-locks a rank.
- The grid rule is kept: P20 for race 1 of a championship, then the previous race's finishing place.

## D. Retirement behaviour

- A car's retirement moment is the race time when its race ended: the start of a mechanical retirement, running out of
  fuel, a stuck AI car, or the player's Retire. That moment and the car's race distance at it are saved with the car.
- When the player retires, the race is not scored yet. The AI keeps racing:
  - The player can keep watching (←/→ changes car).
  - Or press `Enter` / choose "Skip to the result". The remaining race then runs without drawing, in time slices,
    with a progress bar, until the normal end of race. Nothing is invented or slowed down.
- The classification and scores are then taken from the finished race. An AI that retires later ranks above the
  player, and laps set after the player's retirement count in the best-lap ranking.
- Retiring is final. The pause-menu button reads "Retire from the race (the result counts)" and needs a second click.

## E. Endless Career

- It opens only after passing Master with 200 / 240, and appears as the fourth stage on the Career screen.
- Six-lap races, 20 cars, 150% AI, no last race and no further ranks.
- **Circuit draw.** Each race's circuit is drawn with equal chances from the five circuits that were not used last
  time, so there is never an immediate repeat and no fixed rotation. The draw is saved as soon as it is made and shown
  before the race; reloading the page or reopening the menu does not change it.
- No retries: every result, including retirements, changes the VR.

## F. VR system

- **Range.** Integer, starting at 1,000 when Master is first passed, never below 0 or above 9,999. The best VR reached
  is kept.
- **Neutral score.** 21 / 40 leaves VR unchanged.
- **Bands.** Decided by the VR at the start of the race, and stored with each result:

| VR | Max gain | Max loss |
|---|---|---|
| 0–1,999 | +48 | −20 |
| 2,000–3,999 | +38 | −28 |
| 4,000–5,999 | +29 | −38 |
| 6,000–7,999 | +19 | −48 |
| 8,000–9,999 | +10 | −60 |

- **Formula** (`calculateVrChange`, the agreed function):
  - gain = round((score − 21) / 19 × max gain);
  - loss = −round((21 − score) / 19 × max loss).
- **Cap and floor.** The new VR is clamped to 0–9,999 (`calculateNewVr`). The result records the VR actually gained
  (`change`) and the formula's value (`rawChange`).
- **Examples.**
  - 8,450 with 40 points → 8,460; 8,450 with 2 points → 8,390.
  - 9,995 with 40 points → 9,999.
  - 8 with a 2-point race → 0.
  - 1,990 with 40 points → 2,038 (the starting band's +48).

## G. Save system

- **Storage.** Saved under a new key, `apexgp.progress.v4`, version 4. It holds:
  - unlocked and completed ranks;
  - per rank: the attempt number, its results so far and its grid;
  - Endless: unlocked, VR, best VR, race count, the last 50 results and the drawn next circuit;
  - the active race attempt;
  - the ids of counted races;
  - the team.
- **Integrity.**
  - Everything is validated on load: results must follow the schedule and their points must add up, or the list is
    cut at the first bad entry; VR must be within range; the active attempt must match the schedule.
  - Each race attempt has a unique id. It is recorded only if it is the active attempt and has not been counted before,
    so a reloaded results screen, a double click or a late result can't award points or VR twice.
- **Interruption.** If the game opens with a Career race still active (the browser was closed during it), that race is
  recorded as a forfeit: P20 and the last lap rank, 2 points, marked `forfeit`. The Career moves on, and a notice says
  so. Full race restoration was not attempted; this is the simpler policy the brief allows. A retry is impossible.
- **Migration.**
  - **v3 (100-point) saves.** Results are not converted. The old results are kept unchanged in `legacy.v3`, and the
    Career screen says they don't count.
  - **Unlocks.** Ranks opened under v3 stay open. A rank completed under the old rules (all six circuits and the old
    threshold) counts as completed, marked `legacyCompleted`, so an old Master completion opens Endless Career.
  - **v1 and v2 saves.** These keep access only, as before.
  - **Old storage.** The old v3 key is left untouched.

## H. Testing

Every file was run with `node --test tests/<file>.cjs`, using Chromium (`CHROMIUM_PATH`) and a local three.js 0.160.0
(`THREE_JS`) for the browser tests.

**New or rewritten**
- **`progression` (23 / 23 pass)**
  - Ranking points, and the race score's range and independence.
  - Best-lap ranking: exact ties, full precision, drivers without a lap, survival order.
  - Classification in a real 20-car race: finishers above retirees; retirements on different laps; two retirements
    in the same instant; positions P1–P20 unique.
  - The player retiring: later AI retirements rank above, and laps set afterwards count.
  - Every driver retiring.
  - Lap 1 timed from the line for every car.
  - Fixed order, no skipping or replay, duplicate results rejected.
  - Retirement counted as the race.
  - Promotion only after six races, with 159/160, 179/180 and 199/200 checked exactly.
  - Restart only after race 6, never re-locking a rank.
  - Grid rule.
  - Browser-close forfeit.
  - Save validation and tampering.
  - v3 and v1/v2 migration.
  - VR formula for every score 2–40 at VR 0, 1,999, 2,000, 3,999, 4,000, 5,999, 6,000, 7,999, 8,000, 9,998 and
    9,999, plus the reference table.
  - Cap and floor; starting-band rule.
  - Endless draws: all six circuits, equal shares, no repeats, no fixed cycle, kept across reloads.
  - VR applied exactly once.
  - A real race fed into the Career.
  - Respawn gone; a stuck AI car retires and is not moved.
- **`career-flow` (1 / 1 pass, new)** drives the real game in Chromium:
  - The Career screen offers only race 1 (Monza); the race starts from P20.
  - The running race is saved; R and Space don't move the car.
  - Retire needs two clicks. The rest of the race is resolved in the background, then the result is classified,
    scored and saved as `retired`. All cars still in the race rank above the player. The only next action is "Next
    race: Silverstone".
  - Race 2 started, then the page reloaded: forfeit (2 points), notice shown, the Career moves to race 3.
  - The Endless circuit is unchanged across three reloads.
- **`sporting-ui` (pass)**
  - All 12 circuit/mode combinations.
  - The Career is raced in order and each result is saved once.
  - The results show position, lap and race-total points and the championship, with no retry.
  - The next race, or after race 6 the championship verdict.
  - Endless: VR 1,000 → 1,048 for a P1 with the top lap rank, and the next circuit drawn without repeat.
  - No respawn on the Controls screen.

**Updated:** `sporting-rules` 49 / 49, `classification` 9 / 9, `timing-position` 27 / 27 (marshal-reset test replaced
by a retirement test), `movement` 42 / 42, `offtrack` 12 / 12, `ai-racecraft` 14 / 14.

**Unchanged and passing:** `pitstops` 17 / 17, `green-entry` 19 / 19, `circuits` 15 / 15, `fuel-weight` 13 / 13,
`weather` 8 / 8, `intel` 6 / 6, `runoff` 10 / 10, `shortcuts` 7 / 7, `slipstream` 10 / 10, `damage-timing` 5 / 5,
`corner-signs` 5 / 5, `no-yellow-flags` 2 / 2, `held-throttle` pass, `scenery` pass (6 circuits).

**Benchmark:** `node tests/career-ai.cjs career`. Three AI stand-in "players" at Rookie, Pro and Master skill raced
every circuit of each rank twice (seeds 901/902 + rank × 100), from random grid slots rather than the Career's P20
start. Mean championship total out of 240:

| Rank (field) | Rookie-skill stand-in | Pro-skill | Master-skill | Threshold |
|---|---|---|---|---|
| Rookie (100%) | 141 | 129 | 173 | 160 |
| Pro (125%) | 84 | 144 | 167 | 180 |
| Master (150%) | 114 | 108 | 134 | 200 |

A driver exactly as quick as the field averages about 135–145 points, so each threshold asks the player to clearly
beat the field. Master's 200 is the hardest by a wide margin.

**Not run in this round:** the `career-ai` benchmark's pace, duel and race modes (no assertions). Human playtesting was
not done.

## I. Remaining issues and limitations

- **Not playtested.** No human has played the new Career: championship difficulty against 160 / 180 / 200, how often
  players retire, and how fast VR moves. The benchmark above suggests the thresholds are demanding: AI stand-ins at the
  field's own skill average about 135–145 of 240, and the Master-skill stand-in managed 134 against the Master field.
  They are the agreed values and were not changed.
- **Interrupted races** are forfeited rather than restored with their damage, position, laps and timing.
- **Weather re-roll.** Before the start, leaving the race brief (Back) and opening it again draws new weather and a new
  shuffle of the other cars' grid slots. Your own grid slot is fixed by the rules, and no attempt begins until you press
  start, so no result can be avoided.
- **Simultaneous retirements** are broken by race distance, then driver order, as specified. The race time of a
  retirement is the start of the retirement sequence for mechanical failures (the car then coasts to a stop), not the
  moment it stops.
- **Grand Prix** also computes the race score for every driver but keeps its usual results table and points.
- **No stuck-AI fallback.** With the AI's respawn gone, an AI car that gets genuinely wedged retires. In the race
  samples this never happened, but a geometry spot that traps cars would now cost them the race.
