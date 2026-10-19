# Apexra: photographic forest, graphics levels and performance

## A. The forest

The old trees were low-poly shapes: icosahedron blobs for leafy crowns, cones for conifers, and painted dots on crossed planes in the distance. They have been replaced by foliage built the way real-time photographic vegetation usually is.

- **Leaves, needles and fronds.** One procedural texture atlas is painted when a circuit loads, so the game still needs no image files. It holds two broadleaf twig clusters, a spruce needle spray, a palm frond, a dry-country (acacia / olive) cluster, cherry blossom, a Lombardy-poplar cluster, ferns, long grass, bark, palm bark and rock. Leaves are individual shapes with a midrib, shaded from the top of the cluster to the bottom; needles are thousands of short strokes with lighter new growth at the tips. Each circuit's leaf colour comes from its own palette.
- **Crowns built from cards.** A near broadleaf tree has 78 leaf cards in clumps round an ellipsoid, a tapered bark trunk and six branches; a spruce has 17 tiers of 7 drooping branch sprays; a palm has 12 arching fronds. A middle-distance tree has the same shape with fewer, larger cards. Seven species: broadleaf, conifer, broad low crown, dry-country tree, palm, cherry and poplar. The venue's poplar avenues (Monza) and cherry trees (Suzuka) now use the same system instead of cones and blobs.
- **Lit as a volume.** Card normals are bent outwards from the crown's centre, so a crown is shaded as one soft mass rather than as flat cards; both faces of a card use that normal. Baked occlusion darkens the inside and the underside of every crown. Light shining through the leaves brightens a crown seen against the sun.
- **Wind.** Every crown sways slowly and its leaves flutter, in the vertex shader, with a phase that follows each tree's position. The wind strengthens with rain. Shadows use the same wind and leaf cut-outs.
- **Distant trees are impostors of the real trees.** For each species, the near 3D tree is rendered from the side while the circuit loads, into a colour image (with its occlusion) and a normal image. A distant tree is a single billboard that turns to face the camera and is lit by the sun through that normal image. A tree therefore keeps its shape, colour and lighting when it changes level of detail. Each impostor is 2 triangles, compared with 6 for the old crossed planes.
- **Alpha that survives distance.** The leaf cut-out is corrected for the texture's mip level, so distant crowns stay full instead of thinning to lace.
- **The woods' edge outside the fence.** A band of shrubs (fern rosettes) and long grass runs between the barrier and the first trees, so the forest doesn't start with bare trunks on lawn. Under the canopy the ground is shaded and turned from lawn to forest floor (leaf litter, needles, moss), computed from the actual trees.
- **Woods on the horizon.** Away from the circuit, trees stand in clumps inside the same woods pattern that darkens the ground, with open fields between, instead of being spread evenly. More wooded circuits (Spa, Monza) have more woods. On the medium and high levels, extra outer rings at 600 m and 780 m give the horizon its woods; these are seen only as impostors.
- **Grass.** The turf texture is now three layers of blades (shaded underneath, lit on top, a few dry straws) over mottled ground, with a matching normal map so the sward catches the light. The final colour grade is closer to neutral: saturation 1.0 instead of 1.08–1.10, and lighter contrast and vignette. Together these read as photographed rather than painted.

Level-of-detail switching, the 72 m cells, the shared visibility texture, the hysteresis distances and the immutable instance buffers all work as before (see the [environment report](../environment-redesign/README.md)).

## B. Graphics levels for any device

There is still no graphics menu. The level is picked automatically:

| Level | Chosen for | What it draws |
|---|---|---|
| **High** | Dedicated GPUs (NVIDIA, AMD Radeon RX/Pro, Intel Arc), Apple Silicon | 2048 shadows, 4× MSAA post-processing with bloom, densest forest, up to 1.5× pixel ratio |
| **Medium** | Capable integrated GPUs (Intel Iris, AMD Radeon integrated), unknown GPUs, 4-core or 4 GB machines | 1024 shadows drawn every second frame, 2× MSAA post-processing, up to 1.15× pixel ratio |
| **Low** | Basic Intel HD/UHD, phones and tablets, software rendering, 2-core or 2 GB machines | No shadows or post-processing, a lighter forest and terrain, 0.85× pixel ratio |

- **The starting guess** is `SIM.graphicsTier`. It uses the GPU name WebGL reports, then CPU cores and memory, then whether float render targets exist. It is unit-tested in `tests/graphics.cjs`.
- **The governor** (`governGraphics`) counts only live racing: not menus, pauses, or the first 8 s after a world build.
  - When the frame rate drops, it first lowers the render scale, as before, down to 60 %.
  - If that still gives under 45 FPS for 3 s, it shortens the forest's draw distance, in two steps.
  - If that isn't enough either, it switches post-processing off immediately and lowers the level from the next session, with a short on-screen message.
  - After 90 s at 58+ FPS on full resolution, it raises the level by one, but never back to a level this device has already failed.
  - The level it settles on is stored per GPU (`apexgp.gfx.v1`).
  - `?quality=low|medium|high` in the address forces a level.
- **A pixel budget** caps each level's total drawing-buffer size (high 3.7 MP, medium 2.1 MP, low 1.0 MP). A 4K or Retina screen therefore doesn't multiply the cost of every pass.

## C. Optimisations

- **Shader precompile.** Every shader the world uses is compiled behind the loading screen instead of stalling on first sight mid-race.
- **Texture painting moved to in-memory canvases.** The grass and foliage atlas are painted on CPU canvases (`willReadFrequently`), and blades of one colour are batched into one path. Painting them on the software-rendered GPU canvas had added 3–4 s to loading. The load time is now back to the old figure: about 6.4 s at Monza on high, against 6.0 s before.
- **Cars.** Distant cars hide their mirrors, visors, wheel covers and helmets, saving a draw call each. The car detail distances shrink with the level (full detail 90/70/45 m, mid detail 220/180/130 m).
- **Medium shadows** are redrawn every second frame.
- **Medium and high levels** no longer request an antialiased canvas that their own multisampled target made redundant.
- **Forest data on the GPU.** A billboard impostor is one draw per species per 216 m batch, with 2 triangles per tree. Near and middle trees are a few hundred triangles each; the scenery test caps them at 2,400.

## D. Measurements

Same protocol as the environment report: `tools/environment-benchmark.cjs`, Chromium with **SwiftShader software rendering**, a 640 × 360 buffer, a fixed seed, 20 AI cars, four camera regions, dry and rain, 16 measured frames per weather. "Before" is commit `87b0451`; "after" is this branch. Both source hashes are in the JSON files.

**These are comparisons on a software rasteriser, not FPS on real hardware.** A software rasteriser makes every pixel expensive, so the absolute frame rates (about 1–1.5 FPS) say nothing about a GPU. I could not measure real-GPU FPS here.

| Level | Circuit | Weather | FPS before → after | Draw calls | Triangles |
|---|---|---|---|---|---|
| Medium | Monza | dry | 0.92 → 0.99 | 1018 → 844 | 663k → 490k |
| Medium | Monza | rain | 0.94 → 0.96 | 1020 → 846 | 663k → 489k |
| Medium | Spa | dry | 1.01 → 0.95 | 915 → 736 | 616k → 532k |
| Medium | Spa | rain | 1.00 → 0.93 | 917 → 741 | 616k → 533k |
| Low | Monza | dry | 1.36 → 1.51 | 640 → 627 | 404k → 358k |
| Low | Monza | rain | 1.38 → 1.57 | 642 → 629 | 404k → 358k |
| Low | Spa | dry | 1.44 → 1.52 | 559 → 533 | 411k → 400k |
| Low | Spa | rain | 1.43 → 1.47 | 561 → 535 | 411k → 400k |

- **Draw calls and triangles** fell in every case: on medium, draw calls by 17–20 % and triangles by 14–26 %; on low, draw calls by 2–5 % and triangles by 3–11 %. This is despite more trees (Monza medium 8,108 → 11,360; Spa 9,939 → 14,953), because impostors and the car level of detail are cheaper.
- **Low level** throughput rose by 3–14 %.
- **Spa on medium** was 6–7 % slower on the software rasteriser. Its spruce crowns are many overlapping cut-out cards, and a software rasteriser pays for every covered pixel. Desktop GPUs handle alpha-tested overdraw far better. Tile-based mobile GPUs, where it is costly, start on the low level, which has a shorter forest draw distance and fewer cards (×0.6).
- **Load time** at Monza, high level: 6.0 s before, 6.4 s after.

## E. Tests

- `tests/graphics.cjs` (new): the starting level for dedicated, integrated, mobile and software GPUs, and the caps for cores, memory and float targets.
- `tests/scenery.cjs`, extended:
  - every near and middle tree has a foliage texture and wind weights, and stays within its triangle cap;
  - every distant tree is a single billboard whose colour and normal images were baked from its 3D tree.
  - It still checks that nothing stands on the road, tree roots sit on the ground, the level-of-detail hysteresis holds and no buffers are reallocated.
  - It runs on the high level through `?quality=high`.
- The rest of the suite is run as before. See the commit message for the results of this change.

## F. Limits

- **No real GPU measurement.** No human has played this, and it hasn't been run on real GPUs here. The 60 FPS goal relies on the level choice and the governor rather than on a measured guarantee.
- **Hand-painted foliage.** It is procedural, not scanned. Close up, a leaf card can show its painted texture, and leaf colour is uniform within a species apart from per-tree tint.
- **Impostor angle.** Impostors are rendered from the horizon; seen from high above, a distant tree is still a side view.
- **One-way governor changes within a session.** A lowered level takes effect from the next session, so the session in which it happens keeps its world. After a mid-session drop from medium to low the canvas has no antialiasing until the page is reloaded.
