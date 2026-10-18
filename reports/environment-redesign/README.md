# Apexra environment redesign

## A. Trackside layout

All six circuits share one generated section profile: the preserved road, 1.3 m corner kerbs, up to 3.2 m of green painted asphalt, grass/gravel recovery, a physical barrier and vegetation beyond it. Normal recovery widths are roughly 6–8 m, with up to 12 m extra outside difficult corners. Close parallel sections and Suzuka's crossing take priority over those nominal dimensions. The green strip narrows rather than overlapping barriers or another section of road. Pit approaches keep their connected asphalt and existing routing.

Surface detection and the painted/gravel ribbons read the same section bounds. Existing curvature/reach checks prevent folded ribbons and walls on the inside of tight hairpins. Concrete walls and catch fencing remain, with corrugated metal finishes on straights and tyre-faced protection outside tight corners. These are visual finishes on the same continuous collision face, not additional collision objects.

## B. Surface physics

Any tyre entering green runoff multiplies the car's velocity by **0.85 once per continuous entry**. An 80 ms interval completely clear of green rearms the latch; wheel swaps and brief seams do not multiply the loss. The physics step owns this state, independently of rendering and LOD. Player and AI use the same code.

While on green, one to four tyres reduce grip by 2.5%, 6.5%, 11% or 18%, with modest progressive rolling resistance. Grass/gravel retain their stronger resistance and recoverable full-throttle speed. Forces ease back to asphalt values on re-entry. Steering/braking controls and the existing held-key restoration are preserved. The AI predicts actual wheel surfaces and the entry loss when evaluating a path; recovery allowances are restricted to strips wide enough for the car, away from the inside of bends and pit approaches.

## C. Circuit integration

| Circuit | Published lap | Scenery |
|---|---:|---|
| Monza | 5.793 km | Dense tall temperate broadleaf woodland, conifers, bushes and forest floor; historic banking and royal-park landmarks retained. |
| Silverstone | 5.891 km | Mixed woodland clusters, countryside clearings, gentler silhouettes; airfield landmarks and hedgerows retained. |
| Spa-Francorchamps | 7.004 km | Pine-dominated Ardennes forest, mixed foliage and undergrowth across the existing hills and valleys; chalets retained. |
| Suzuka | 5.807 km | Layered deciduous crowns and conifers, grounded on sloping terrain; amusement-park landmarks, pit facilities and both crossing levels retained. |
| Bahrain | 5.412 km | Sparse low dry woodland, acacias, palms, scrub and more rocks on sandy ground; towers, floodlights and sandstone architecture retained. |
| Interlagos | 4.309 km | Dense subtropical layered crowns, conifers, occasional palms and warm green undergrowth; distant hillside neighbourhoods retained. |

Default high-quality forest counts from the scene audit:

| Circuit | Trees | Bushes | Rocks | Grass tufts | Spatial cells |
|---|---:|---:|---:|---:|---:|
| monza | 11,343 | 5,492 | 1,792 | 3,922 | 840 |
| silverstone | 9,601 | 4,621 | 1,514 | 3,356 | 731 |
| spa | 14,060 | 6,836 | 2,154 | 4,894 | 872 |
| suzuka | 10,425 | 5,060 | 1,651 | 3,640 | 649 |
| bahrain | 2,212 | 1,044 | 1,071 | 780 | 378 |
| interlagos | 7,646 | 3,630 | 1,253 | 2,680 | 472 |

The preserved geometry fixture records SHA-256 hashes of centre-line coordinates, widths, headings, curvature, elevation and gradient, plus the complete pit definition, from main commit `16fbd44e8c726bd0e884e9154b4358f94ffd74dc`. The new simulation must match all of them exactly. Actual sample-based lap lengths keep their existing rounding to 2 m.

## D. Forest generation and rendering

Deterministic circuit-relative bands create clustered woodland, varied setbacks and small clearings, without uniformly spaced rows. Crown shape, branches, trunk thickness, species, height, stretch, rotation and colour vary within bounded ranges. Bushes, rocks and opaque grass tufts sit under selected trees. Exact road/barrier checks, water exclusion and infrastructure keep-outs protect racing and service areas. Trees have no per-tree collision bodies beyond the barriers.

Each 72 m spatial cell selects one of three representations, using immutable instance buffers:

- **Near:** branched 3D trees with several foliage lobes or conifer tiers; detailed undergrowth; the only foliage shadow casters.
- **Middle:** simpler 3D crowns and trunks, instanced with inexpensive opaque Lambert materials.
- **Far:** species-specific alpha-tested crossed silhouettes. Palm, acacia, pine and broadleaf shapes keep appropriate proportions. There is no transparent leaf blending. Far trees are batched in 216 m sections; a small shared visibility texture hides any cell represented by nearer 3D trees. This reduces draw calls without duplicating crowns or updating instance buffers.

Distance uses the nearest extent of a cell so a tree near the camera is never prematurely simplified. Near/middle transitions have 34/49 m hysteresis; middle/far transitions have 121/145 m hysteresis. Cell extents make these conservative rather than exact per-tree cutoffs. Far visibility is bounded by quality and the camera frustum. Camera movement toggles visibility and LOD; it does not allocate/rebuild tree meshes or instance buffers. The static forest branch computes its world matrices once, avoiding recursive transform work for thousands of stationary scene nodes each frame. Geometry, materials and textures are reused across cells. Generation-only placement descriptors are released once instance buffers have been built; the visibility texture is released when changing circuits. Reflection capture uses distant silhouettes rather than detailed forest geometry.

## E. Measured performance

The paired capture uses Chromium/ANGLE **SwiftShader software rendering**, a 640 × 360 drawing buffer, medium quality, a fixed seed and 20 AI cars. Four repeatable camera regions per circuit cover quarter-lap and middle-lap packs, the tightest-corner approach and the crossing/hillside approach. The packs span 152 m of road. Each circuit includes a fast straight in these samples: Monza’s middle/far sample, Silverstone/Spa/Bahrain/Interlagos’s quarter-lap sample and Suzuka’s crossing approach. [Sample geometry](region-samples.json) records curvature and reference-line speed; those reference speeds are not measured car velocities. Clear/dry and rainy conditions use the same poses before and after. Bahrain retains its existing floodlit night setting; the other circuits retain daylight. Cars begin each camera segment at a controlled 45 m/s and then use the production simulation. Each weather capture has three warm-up frames and eight measured frames per region (32 measured frames total). The production frame runs physics, AI, models, weather, shadows and post-processing. A blocking pixel readback waits for rendering to complete; CPU submission time is recorded separately. Startup and world construction are outside the timed sample.

These short software-rendered captures are comparisons of this environment, not consumer GPU FPS claims. The raw JSON contains average throughput, p95/p99 frame times, CPU submission, draw calls, triangles, heap snapshots and renderer resource counts. JavaScript heap snapshots are not GPU VRAM measurements. Tail estimates from 32 frames are limited; sustained hardware frame pacing still needs measurement.

The tested source is main `16fbd44` before and implementation `b191ad6` after; both source SHA-256 hashes are in the JSON. **10 of 12 captures were faster**, with a **18.1% geometric-mean throughput increase** across the 12 paired cases. Mean submitted triangles fell **25.2%**, draw calls fell **4.0%**, and mean CPU submission fell from **22.91 to 21.69 ms**. Interlagos was slower by 3.6% dry and 2.6% in rain. Reported heap peaks span 46.5–89.8 MiB before and 55.3–116.7 MiB after. The richer scene has a higher memory cost; these snapshots include garbage-collection variability.

Every cell below is **before → after**. Frame tails are p95 of the short capture. Heap is the maximum browser-reported JS heap in that capture (`heapMB` in the raw files is measured in MiB).

| Circuit | Weather | FPS | p95 frame ms | CPU submission ms | Draw calls | Triangles (thousands) | JS heap MiB |
|---|---|---:|---:|---:|---:|---:|---:|
| Monza | Clear/dry | 0.355 → 0.433 | 3597 → 2802 | 33.1 → 26.3 | 1039 → 971 | 984.6 → 661.4 | 63.8 → 88.1 |
| Monza | Rain | 0.344 → 0.457 | 4269 → 2582 | 29.2 → 21.3 | 1041 → 973 | 983.8 → 661.6 | 46.5 → 64.5 |
| Silverstone | Clear/dry | 0.509 → 0.553 | 2626 → 2110 | 22.9 → 21.4 | 922 → 902 | 645.0 → 605.1 | 77.6 → 116.7 |
| Silverstone | Rain | 0.497 → 0.557 | 2795 → 2123 | 19.8 → 17.8 | 924 → 904 | 645.1 → 606.5 | 48.0 → 68.2 |
| Spa | Clear/dry | 0.365 → 0.491 | 3516 → 2386 | 17.2 → 24.0 | 973 → 917 | 1053.7 → 616.2 | 74.2 → 96.4 |
| Spa | Rain | 0.359 → 0.461 | 3658 → 2729 | 17.5 → 21.9 | 976 → 919 | 1054.8 → 616.3 | 54.5 → 71.2 |
| Suzuka | Clear/dry | 0.394 → 0.499 | 3290 → 2555 | 22.7 → 24.2 | 1008 → 934 | 918.4 → 662.3 | 62.7 → 76.7 |
| Suzuka | Rain | 0.379 → 0.482 | 3100 → 2751 | 24.6 → 20.6 | 1010 → 937 | 922.3 → 665.1 | 50.4 → 68.6 |
| Bahrain | Clear/dry | 0.581 → 0.676 | 2353 → 1924 | 23.7 → 23.9 | 947 → 922 | 587.7 → 492.3 | 78.2 → 55.3 |
| Bahrain | Rain | 0.560 → 0.689 | 2366 → 1954 | 20.1 → 20.2 | 949 → 924 | 587.7 → 492.3 | 51.2 → 61.5 |
| Interlagos | Clear/dry | 0.474 → 0.457 | 2408 → 3018 | 22.2 → 18.0 | 905 → 913 | 774.9 → 675.4 | 89.8 → 78.2 |
| Interlagos | Rain | 0.463 → 0.451 | 2796 → 2862 | 21.9 → 20.8 | 906 → 914 | 774.6 → 675.2 | 48.1 → 60.9 |

Full results, p99 tails and geometry/texture resource counts are in [before/metrics.json](before/metrics.json) and [after/metrics.json](after/metrics.json); [summary.json](summary.json) contains the aggregates. No console or uncaught runtime errors were recorded in either paired run.


To reproduce:

```sh
BENCH_ROOT=/path/to/checkout BENCH_OUT=/tmp/apexra-bench THREE_JS=/path/to/three.module.js node tools/environment-benchmark.cjs
```

Use Three.js 0.160.0 and the same Chromium binary and host for both checkouts. `CHROMIUM_PATH`, `CIRCUITS` and `BENCH_FRAMES` can select a browser, circuit subset and sample count. The game itself retains its existing high default quality.

## F. Visual improvements

Large grandstands, spectator terraces, car parks and animated crowds are removed. Functional pit garages, service boxes, team banners, camera infrastructure and characteristic circuit landmarks remain. Forest approaches the barriers in layered bands rather than leaving an empty surrounding field.

The measured circuit/terrain elevation and distant relief are preserved. Ground colours now favour woodland and leaf litter, blend small exposed-soil patches into the grass, and keep Bahrain sandy and rocky. Tree roots sample the actual rendered terrain and fine-verge triangles, including lowered coarse terrain, rather than an approximate unsunk noise surface. This avoids floating vegetation beside steep terrain.

All 12 final dry/rain screenshots were inspected, along with a [960 × 540 high-quality Monza preview](monza-high.png). The paired [before](before) and [after](after) directories retain these rendered views for review. The existing sky, sunlight, fog, rain, wet roads, floodlights and time-of-day settings remain. Shared forest materials darken with track wetness; rain keeps the forest visible through the existing atmospheric haze. Distant trees do not cast expensive shadows or use per-tree reflections.

## G. Collision, shortcut and gameplay validation

**132 automated tests passed, plus 18 held-W browser scenarios and their input/rejoin checks.** The new green-entry tests exercise 100/200/300 km/h, one/two/four tyres, sustained entries, wheel swaps, seams, exits and re-entries, mixed grass/paint, AI/player parity, held throttle on rejoin, both sides of all six profiles and actual wall contacts on every circuit. Existing impact tests cover light brushes, heavy crashes, immediate damage and deterministic contact accounting.

Ordered route gates and the existing physical shortcut slowdown remain; kerbs, normal wide exits and pit routes stay valid. Physical timing and position remain tied to the car rather than a delayed distance credit. There are no sporting time penalties or yellow-flag restrictions.

Full race, recovery, shortcut, pit, weather and rendered-geometry results are recorded in [validation](validation). The pit calibration test retains its 17–27 s clean-stop range and allows 4 s around the existing circuit estimate, because a whole-race comparison now also contains green-entry losses on surrounding laps. The refuelling test observes actual stationary pumping time; fuel and tyre jobs may overlap, so a small top-up need not lengthen a tyre stop. An original refuelling assertion also failed on unchanged main ([baseline evidence](validation/pitstops-baseline.txt)); that test expectation was corrected without changing service or fuel code. The rendered-geometry audit passed on all six circuits at the game’s default high quality: 55,287 tree roots were checked against the actual terrain/verge triangles, with root bases consistently about 0.14 m below the visible ground. No scenery/ground intrusion on the road was detected, and all near/middle/far hysteresis and immutable-geometry checks passed. All six full 20-car, six-lap races completed with pit stops and classification (15 circuit tests passed). Off-track recovery, direct chicane cutting, ordered gates, held W and asphalt rejoins, weather/tyre strategy and progression checks also passed. The shortcut drives at Rettifilo, Ascari, Bus Stop and Casio Triangle were slower than the legal route; the AI missed no ordered gate in the full-field Monza/Suzuka checks.

## H. Remaining issues and test limits

- Hardware GPU performance, VRAM and sustained 1% lows cannot be established from this software-rendered host. The available timer extension is not used as a hardware GPU measurement.
- Nearby trees use faceted procedural crown/branch geometry; no scanned vegetation assets are included.
- Forest LOD uses cell-level hysteresis rather than a transparency crossfade. A representation change can still be visible, particularly from an elevated/free camera.
- Barrier metal/tyre detail is material-based; collision still uses the existing simplified wall faces and damage model.
- The existing game has no new terrain collision bodies or individual tree physics. Rendered landscape relief remains scenery around the existing planar vehicle simulation.
- Interlagos’s paired captures were 2.6–3.6% slower despite the overall rendering improvement; memory peaks are higher for the denser scenery.
- High quality was used for the six-circuit geometry/grounding audits and the 960 × 540 preview. Timed captures use medium quality; sustained high-quality performance on a hardware GPU remains unmeasured.
