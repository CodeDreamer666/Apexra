# Release verification record

Scope: changes based on deployed/main commit `9688204d231fa99b0dd03012fb3f84b205d37d6b`.
No deployment, merge, remote push or real player's save modification was performed.

## Executed checks

| Check | Outcome | Evidence and practical limits |
|---|---|---|
| `node tests/progression.cjs` | **PASS: 24/24, no skips** | Career schedule/thresholds/classification/retirements, save round-trips and tamper handling, v3/v1 migration, VR bands/bounds/history, persistent next circuit, real simulated results and grid placement. Full suite took approximately 17 minutes under constrained CPU. |
| `node tests/sporting-ui.cjs` | **PASS** | Chromium DOM harness: all six circuits × Grand Prix/Career (12 combinations), pit plan/service, car status/results, legacy settings; Endless result changed VR 1,000 → 1,048. Harness excludes the 3D renderer. |
| Simulation preservation comparison | **PASS** | Extracted classic simulation script from working `index.html` and `git show 9688204:index.html`; exact byte comparison passed, including the circuit-data block. This task does not change physics, Career, AI or pit logic. |
| `npm audit --json` | **PASS: 0 known reported vulnerabilities** | Queried installed lockfile dependencies (esbuild/Playwright and platform/optional packages). This does not scan vendored Three.js, proprietary logic or every possible vulnerability. |
| `node --check tools/build-release.cjs`, `node --check legal/clear-data.js`, `node --check tests/legal.cjs` | **PASS** | JavaScript syntax checks. |
| `git diff --check` | **PASS** | Authored diff checked; a narrow `.gitattributes` rule preserves and accepts the font license's original upstream CRLF/trailing spaces without changing its pinned bytes. |
| Vendor integrity / output exposure checks | **PASS** | Pinned engine/font/license hashes verified. Exposed internal files, private release metadata and Git files are absent from staged output. |
| Live HTTPS/HTML comparison | **PASS** | HTTP 200, HTTPS/HSTS observed; original live HTML hash exactly matched audited main. No remote code or configuration changed. |
| Live exposure HEAD checks | **Completed — exposures found** | HTTP 200 for circuit documentation, internal circuit-build script and third-party reference screenshot. HTTP 404 for README, guessed source-map path and Git HEAD. Recorded in `docs/live-exposure-evidence.json`; staged build excludes internal files, live cleanup still requires approval. |
| Live browser request capture | **PASS with transport limitation** | `docs/live-network-evidence.json`: root, Google Fonts CSS, fonts.gstatic.com font, jsDelivr Three.js and favicon; all GET, captured responses 200, no Set-Cookie header, no page errors during bounded network capture. |
| `npm run test:legal` final built-browser pass | **PASS: all 8 check groups** | Real minified draft served with proposed Vercel headers. See `docs/browser-release-evidence.json` for completed checks, observed requests, empty failed-request list and empty error list. |

## Browser test method and coverage

The release test uses isolated Chromium storage, local test saves and a local HTTP server applying `vercel.json`
headers. Legal pages are checked at widths 1280 and 390, including all local license/data links, no horizontal
overflow, keyboard focus/confirmation, cancel/confirm reset behavior, unrelated-key preservation and blocked-storage
error handling. Opening legal pages left every seeded existing save value unchanged.

The built game check follows legal-page back navigation, verifies saved Career state, opens Grand Prix circuit
selection/briefing/grid, and launches Career with a locally persisted active attempt. It also checks requests,
cookies, sessionStorage, IndexedDB, Cache Storage, service workers and console errors. Game-page animation callbacks
are throttled to 250 ms for software rendering; this is an integration test, not a frame-rate, handling or sustained
rendering-performance benchmark. Legal-page animation timing is unmodified.

## Failed, interrupted or limited attempts

- The first sandboxed subprocess attempt failed with `spawnSync ... EPERM`; the test was rerun with execution
  permissions that supported its local subprocesses and browser.
- Earlier full-render browser attempts were too slow for actionability checks under software rendering. A keyboard
  navigation assertion also ran before the navigation committed. The harness now waits for the target URL, follows
  the circuit-selection step, and throttles game-page frames. These earlier attempts are **not** reported as passes.
- An attempted suppression of all animation callbacks interfered with browser test operations; it was replaced by
  finite throttling. The runtime application itself was not changed to accommodate the harness.
- The managed environment restarted during verification. Temporary files/processes disappeared; persisted source
  and live request evidence survived. The final browser pass is executed again against those persisted final files.
- Native Chromium access to the public site returned `ERR_CERT_AUTHORITY_INVALID` for the environment proxy's CA.
  The live network capture used the original responses fetched through `curl` with platform TLS verification and
  fulfilled them into Chromium. No TLS verification was disabled, and no site HTML/JS was rewritten. This confirms
  the observed resource requests, but **does not verify ordinary browser cookie behavior, live browser storage,
  provider backends, complete game boot or an exhaustive play session**. An earlier live boot wait timed out.
- Official trademark portals/statute/PDPC access were incomplete as documented in the audit. No clean trademark
  result or comprehensive legal verification is claimed.
- No Vercel cloud build, deployment or post-deployment header test was performed. The production gate intentionally
  refuses incomplete legal metadata/reviews. A successful local draft build is not a publishable release.

See `docs/development.md` for reproduction and `docs/release-audit.md` for remaining release blockers.
