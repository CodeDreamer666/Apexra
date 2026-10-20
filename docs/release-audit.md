# Apexra pre-release legal, privacy, copyright and compliance audit

> **Deployment follow-up, 20 October 2026:** the developer explicitly requested production deployment despite
> the outstanding reviews. The normal build now emits clearly labeled pre-release information without identity,
> contact or effective-date placeholders; it does not mark any review complete. The strict reviewed-release
> command remains `npm run build:release`. Findings below remain unresolved; deployment is not legal clearance.
> The original audit's statements about an unpublished local artifact and build blocking describe that earlier stage.

Audit date: **19 October 2026 (Singapore)**. Status: **BLOCKED for public release; local implementation prepared.**
This is an engineering audit and preliminary legal research, not a legal clearance opinion or compliance guarantee.
No merge, push, repository visibility change, preview deployment or production publication was performed.

## Scope and evidence

- Started with the supplied clean checkout at `d55677217e24c1e25d47e76dd8bfcdaa91e618d8`, then fast-forwarded
  the local `work` branch to current remote main `9688204d231fa99b0dd03012fb3f84b205d37d6b`. No user edits were present.
- The original request's `CodeDreamer666/F1-Game` resolves through GitHub to `CodeDreamer666/Apexra` (repository ID
  1411448489). Authenticated metadata reports **visibility: public**, contrary to the request's assumption. No
  visibility mutation was attempted; confirmation was requested because changing it affects repository features/forks.
- Read all runtime sections of `index.html`, repository file inventory, README, circuit provenance/build tool,
  existing license texts, test/build utilities, and relevant Git history for the favicon. Searched storage,
  network, capability access, logging, identifiers, credentials and source-map/debug patterns.
- Live GET `https://apexra.vercel.app` returned HTTP 200 and its original HTML SHA-256
  `fc000a6fff7a83e7602459cd67b051681fe83f8cf5c6def4c1ed93adbc80b078`, identical to `git show 9688204:index.html`.
  Thus findings are tied to the current deployed HTML, rather than the stale starting checkout.
- Bounded, read-only HEAD checks also verified that the current public deployment serves
  `/docs/circuit-data.md`, `/tools/build-circuits.cjs` and `/tests/reference/poki-captures.jpg` (HTTP 200).
  `/README.md`, `/index.html.map` and `/.git/HEAD` returned 404. See `docs/live-exposure-evidence.json`.
  The staged allowlisted output excludes these internal documentation/build/reference files; the live site has
  not been changed. Existing exposed files and older deployment URLs need cleanup through an explicitly approved action.
- Connected Vercel project `apexra` reports Node 24, framework null and a READY production deployment. The custom
  public domain responds without authentication; project metadata says SSO protection applies except custom domains.
  This does not establish analytics/log retention, DPA acceptance, subprocessors used, log drains or who can see logs.
- Research sources were accessed on the audit date. Some official sites return bot challenges/403 or require an
  interactive search. An inaccessible registry or statute is not evidence of no applicable rights or requirements.

## A. Privacy findings and data inventory

"Personal data" is contextual: under Singapore PDPA it concerns an identifiable individual, including identification
with other information accessible to an organisation. A lack of names/accounts is not proof that technical data is
anonymous. See [PDPA, especially ss 2, 4 and Parts 3–6A](https://sso.agc.gov.sg/Act/PDPA2012) and
[PDPC obligations](https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations).
Direct statutory retrieval returned 403; current applicability and commencement should be confirmed by legal review.

| Data/category | Purpose | Location and recipient | Retention verified | Personal data assessment | Player deletion |
|---|---|---|---|---|---|
| `apexgp.progress.v4`: Career ranks/completed stages, championship results/grid position, Endless VR/best VR/count/history/next circuit, active attempt, result IDs/timestamps, migrated history | Save play and avoid duplicate results; count an abandoned active race on next game startup | Browser localStorage only; no app upload path | No time expiry; Endless history capped at 50 entries, seen IDs at 60; rank results bounded to schedule; legacy history may remain | Not inherently a name; may relate to an identifiable player when linked to a browser/device or other information | New confirmed reset or browser site-data settings |
| `apexgp.progress.v3`, `apexgp.career.v1`, `apexgp.ranked.v1` | Legacy progression migration | Browser localStorage; read during migration, originals retained | No expiry or automatic deletion | Same contextual assessment | All included in reset; prevents old progress being migrated back |
| `apexgp.settings.v1`: starting tyre/fuel, circuit, camera, chosen resolution | Player preferences | Browser localStorage only | Until overwritten/deleted/evicted | Potentially player-related; no visitor ID in inspected record | Reset or browser settings |
| `apexgp.gfx.v1`: tier, GPU renderer string, failed tiers | Remember automatic graphics tuning for same GPU | Browser localStorage only; written when graphics tier changes | No expiry | Renderer string/capability combinations can contribute to identification; do not call anonymous | Reset or browser settings |
| GPU renderer (including unmasked renderer extension), WebGL/float/render-target limits, browser UA, CPU cores, approximate memory, max touch points, viewport/device pixel ratio, frame timings | Local compatibility/performance selection | Browser memory; GPU name can enter graphics save; no inspected transmission | Mostly page/session lifetime; GPU save above persists | Capability probing is fingerprint-capable, although no tracking fingerprint/hash or upload was found | Close game; remove saved GPU record using reset; browser controls govern exposed capabilities |
| Keyboard input, gamepad connection/control values, simulation telemetry, local classification/event logs, synthesized audio buffers | Run game/controls/audio | Browser memory only | Current session; no server copy in inspected code | Usually gameplay/technical data; contextual if linked | Close page; relevant Career result summary persists as above |
| Ordinary HTTP cache: HTML, JS, fonts, favicon and legal files | Faster delivery | Browser-managed cache | Response headers/browser eviction; live root: `public, max-age=0, must-revalidate` | Content cache itself has no app visitor ID; request metadata is separate | Browser cached-files/site settings; reset clears saves, not ordinary HTTP cache |
| Cookies, sessionStorage, IndexedDB, Cache Storage, service workers | None implemented by game | No runtime API use found in source | Not applicable to app code | No claim made about all provider security modes/browsers | Browser settings if provider behavior introduces any |
| IP address, requested URL/query, time, user-agent/other request headers, delivery/security metadata | Vercel HTTP delivery, security and operational processing | Vercel and its infrastructure/subprocessors; developer access through logs depends on configuration | **Unverified**; no project-specific retention or access record supplied | Can be personal data; IP is necessarily processed to deliver the response | Save reset does not delete provider logs; operator must establish lawful retention/request handling |
| Google Fonts CSS/fonts in current live baseline | Typography | Google Fonts endpoints; IP and request headers necessarily reach provider | Provider retention **unverified** | Technical data can be personal data | Browser clearing does not recall provider requests; removed from proposed runtime |
| Three.js CDN and fallback requests in live baseline | 3D engine | jsDelivr; unpkg/cdnjs only if earlier imports fail | Provider retention **unverified** | Technical data can be personal data | Removed from proposed runtime by pinned same-origin module |
| Browser console errors (`audio init failed`, caught runtime/boot errors) | Local diagnostics | Browser developer console; no Sentry/remote error transport found | Console/session/browser controlled | Error objects may contain local stack/context; no inspected personal fields | Browser console controls/close; never paste sensitive logs publicly |
| Voluntary privacy/contact email, once a real contact is supplied | Respond to enquiries and rights requests | Operator and chosen email provider; **future contact route, provider not verified** | **Requires confirmation** before publishing a retention statement | Sender address and message may be personal data | Request handling depends on applicable law/necessary retention; local reset does not remove correspondence |

`index.html` contains no account form, backend API endpoint, `fetch`, XHR, beacon, WebSocket, analytics package,
Vercel Analytics/Speed Insights integration, ads SDK, social embed, microphone, geolocation or remote speech engine.
Live hosted HTML matched the source. This establishes inspected application behavior, not a guarantee about every
browser extension or future platform injection. Tests may use storage/network APIs; they are not deployed.

No application API sends Career/VR to the developer. Hosting requests still reach infrastructure controlled or
engaged by the developer, and dashboard logging could expose technical data. Keep these distinctions in the policy.
See [Vercel Privacy Notice](https://vercel.com/legal/privacy-notice),
[Vercel DPA](https://vercel.com/legal/dpa),
[Web Analytics privacy](https://vercel.com/docs/analytics/privacy-policy) and
[Speed Insights privacy](https://vercel.com/docs/speed-insights/privacy-policy). Those product documents describe
products, not proof they are enabled on Apexra. [Google Fonts privacy](https://developers.google.com/fonts/faq/privacy)
explains the external-font request issue that self-hosting avoids.

## B. Legal documents

- `privacy.html`: actual six-key browser storage, GPU capabilities, no cloud saves, hosting/transfer uncertainty,
  cookies/network purposes, local reset, rights/contact, children and effective date.
- `terms.html`: free personal play, no accounts/prizes, original-work rights with third-party/statutory carveouts,
  compatibility/availability/local-save loss, changes/discontinuation, qualified liability and draft Singapore law.
- `credits.html`: readable third-party sources, license texts, modifications and separate circuit-data download.
- `legal/release.json`: explicit **[VERIFIED COPYRIGHT OWNER REQUIRED]**, **[PUBLIC PRIVACY AND CONTACT EMAIL REQUIRED]**,
  **[EFFECTIVE DATE REQUIRED]**, with every review approval false. No legal name, email, business or address invented.

Drafts and local output are visibly marked as drafts and use noindex. The ordinary production build refuses missing
details, unapproved reviews and remaining review statements. No intrusive terms acceptance modal is added. Legal
review must determine whether the chosen notice/contract-formation approach makes any contractual terms effective.
No promise of universal rights, universal compliance, zero data, anonymity or zero provider cookies is made.

## C. Copyright and proprietary distribution

`COPYRIGHT.md` reserves original-work rights with a verified-owner placeholder; no MIT/Apache grant was added to
original game code. Free browser play includes copies needed to play, not unrestricted proprietary redistribution.
Third-party permissions and mandatory statutory uses are expressly preserved. The original-work notice is not a
claim over OSM/TUM/Three.js/fonts or other independently owned material.

Copyright protection and ownership differ: the operator must establish authorship and any employee, commissioned,
contributor or AI-tool terms. [IPOS copyright guidance](https://www.ipos.gov.sg/about-ip/copyright/) distinguishes
protected expression and ownership. No registration or company status was inferred from a GitHub handle or game name.

The repository is currently reported public. Make it private only with an informed authorized visibility change and
verify the result. Previous public downloads/forks cannot be recalled. See
[GitHub visibility consequences](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
Even a private repository cannot conceal browser-delivered JavaScript. Minification reduces delivery/development
material; it is not anti-inspection, encryption or legal protection. No anti-debugging/obfuscation traps were added.

## D. Third-party inventory and obligations

| Resource / author | Identified license and source | Attribution / distribution / modifications / commercial use | Status |
|---|---|---|---|
| Three.js 0.160.0/r160, Three.js authors © 2010–2023 | MIT; pinned module and `vendor/three/LICENSE.txt`; [upstream](https://github.com/mrdoob/three.js/tree/r160) | Preserve copyright/permission/warranty notice in copies/substantial portions. Commercial use permitted. Unmodified vendored bytes verified by manifest. | Notice included; engine version intentionally unchanged. No complete CVE certification. |
| Titillium Web, Accademia di Belle Arti di Urbino / MA Visual design students © 2009–2011 | OFL 1.1, `vendor/fonts/OFL.txt`; [upstream](https://github.com/google/fonts/tree/main/ofl/titilliumweb) | Unmodified 400/600/700/900 TTF files; retain notice/license. OFL font conditions apply, including limits on selling font alone and conditions on modifications/reserved names. Commercial use with proprietary game permitted. | Full font notice shipped; system font fallbacks are used from player OS and are not redistributed. |
| Six circuit centerlines/widths, TUM FTM; README contact Alexander Heilmeier, width algorithm credit Andressa de Paula Suiti | LGPL 3.0; [upstream](https://github.com/TUMFTM/racetrack-database), existing full LGPL/GPL texts | Includes Monza, Silverstone, Spa, Suzuka, Sakhir, São Paulo CSV inputs. Changes: recenter/resample/smooth/rotate/scale/encode. Commercial use is not forbidden, but source/modification/combined-work obligations require analysis. | **Blocking:** source revisions not pinned in existing generator; exact source/replacement requirements and compatibility with proprietary combined runtime unresolved. Attribution alone is insufficient. |
| Underlying map geometry, © OpenStreetMap contributors | ODbL 1.0; [OSM copyright](https://www.openstreetmap.org/copyright), existing ODbL text | Visible attribution/license notice; assess Derived Database / Produced Work and publicly-used derivative database access/share-alike obligations. Commercial use allowed under license conditions. | Attribution in menu/Credits; extracted data included in local build. **Blocking:** legal review of data/source offer and terms. |
| Georeferencing, Tomislav Bacinger © 2019–2025 | MIT; [upstream](https://github.com/bacinger/f1-circuits), existing notice | GeoJSON only used by generator to align TUM geometry. Preserve existing notice regardless of whether geometry itself is embedded; commercial use permitted under MIT. Upstream README also acknowledges original traces from other sources; verify upstream provenance if reliance extends beyond alignment. | Notice preserved; exact source commit unrecorded. |
| Terrain heights/near/far grids, AWS Terrain Tiles / Mapzen Skadi and upstream providers | Mixed terms; [AWS dataset](https://registry.opendata.aws/terrain-tiles/) links [joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) | Existing generator downloads HGT tiles, not proof of SRTM-only origin. Upstream lists USGS SRTM/GMTED, Copernicus EU-DEM, UK Environment Agency and other sources with different notices/terms. Which applies to each circuit/terrain grid is unverified. | **Blocking:** retain original tile version/hash, identify inputs and applicable commercial/redistribution/modification terms, add exact notices. Blanket public-domain statement corrected. |
| Procedural car/driver models, scenery, textures, particles, canvas signs, shaders, inline SVG icons, synthesized WebAudio | Generated by inspected game code; no external model, texture, sound recording or external AI request loaded | Generation does not prove originality or rights. Confirm copied snippets, commissioned contributions and AI provenance. | Developer confirmation required; do not claim exclusively owned without evidence. |
| `favicon.png`, `favicon.ico`, stylized A emblem / wordmark | No source artwork, artist, commission or license recorded; favicon introduced in commit `a7e394d` | Visual inspected; geometric metallic A with red slash. No formal similarity or trademark clearance. | **Blocking** provenance/owner and brand review. |
| Fictional signs PANORAMIC SYSTEMS, VOLTEX RACING ENERGY, AURORA TELECOM, ZENITH WATCHES | Programmatic lettering; brand/name rights not established | No ads SDK/payment path, but fictitious intent does not establish trademark clearance. Zenith Watches and other names warrant particular human review. | **Blocking** clearance or approved replacement; gameplay/scenery left unchanged. |
| `tests/reference/poki-captures.jpg`, measurements and third-party game references | Reference screenshot is third-party game material; reproduction permission not supplied | Internal behavioral reference only; exclude from public output. Functional comparison alone is not proof no protected expression was copied. | Excluded. Confirm lawful retention/use; do not publish reference screenshot/archive. |
| esbuild 0.28.2 (+ platform optional binaries), Playwright 1.62.1 (+ playwright-core; optional fsevents in lockfile) | Build/test only: esbuild MIT, Playwright Apache 2.0; [esbuild](https://github.com/evanw/esbuild), [Playwright](https://github.com/microsoft/playwright) | Package notices remain in installed tools. Packages/test browser are not in `dist`; no new client runtime package. Lockfile pins resolved dependencies. | Development inventory; do not describe these as player analytics/dependencies loaded by the game. |

Full shipped notices are copied into `dist/licenses` and beside the vendors. The build exports only the existing
licensed circuit data as `dist/data/circuit-data.json`; no internal source archive or repository history is exposed.
This export does **not** establish that LGPL preferred source, build information, relinking/replacement or ODbL
requirements are fully discharged. Resolve the appropriate separation, source offer and licensing terms or obtain
alternative permission before public release. Do not apply a proprietary restriction to those data rights, and do
not assume the entire game must be open-sourced without a legal assessment of the combination.

## E. Branding risks and preliminary searches

The current game uses generic Team A–J / A1–J2 identities, procedural liveries and real circuit names/corners. No
official team logo/model downloads were found. A procedural car shape or color scheme can still raise design,
trade-dress or association issues; no formal image clearance was performed. Real circuit names and marketing claims
must be reviewed independently of rights in geographic data. Keep Formula terminology descriptive and avoid official
F1 logos, endorsement claims or official styling. A disclaimer does not cure infringement.

The menu and Terms/Credits now explain non-affiliation with Formula 1 companies, FIA, teams and circuit owners.
No trademark filing, registration, purchase or external contact was made.

Preliminary search record (19 October 2026):

| Search | Result / limitation |
|---|---|
| Exact name and broader web queries, including site-filtered IPOS/USPTO queries for Apexra | Not a clearance search. Found other APEXRA uses; search-index absence is not a clean registry result. |
| [IPOS Digital Hub](https://digitalhub.ipos.gov.sg/) and [official similar-mark guide](https://isomer-user-content.by.gov.sg/61/73d98e79-6084-4d98-92e4-13d9523f3164/guide-to-search-for-similar-tms-in-idh.pdf) | Portal accessible; basic/advanced/similar-mark entry points identified. A completed official Apexra query and record export were **not** obtained. |
| [WIPO Global Brand Database](https://branddb.wipo.int/) | Challenge page; no reliable result set obtained. No challenge bypass attempted. |
| [USPTO trademark search](https://tmsearch.uspto.gov/) | JavaScript interface returned no usable result text. No search-result conclusion. |
| Relevant adjacent use: [TStudio Karin Apexra](https://shop.tstudio3d.com/package/7452122) and [Hachiraito Apexra Pack](https://forum.cfx.re/t/paid-the-apexra-pack/5405875) | Primary seller/forum pages describe a purchasable FiveM sports-car asset; forum post dated 28 May 2026. Same name in vehicle/gaming space is a material conflict lead, **not proof of infringement or a registered mark**. |

**Blocking:** obtain Singapore and intended-market word, phonetic/visual and logo clearance (consider relevant
software and entertainment classes 9 and 41, related goods/services and unregistered rights). Confirm sponsor-sign
names and circuit representations. Do not assert Apexra is available or register it on this evidence.

## F. Age, jurisdiction and cookies/consent

**Verified legal framework / source-backed obligations:** where PDPA applies, assess notification, purpose and
consent or an applicable exception; reasonable security; retention limitation; access/correction; accountability
and public DPO/business contact; overseas-transfer safeguards; and breach assessment/notification. No-account/free
status is not itself an exemption. An individual can fall within the organisation concept; the personal/domestic
exception must not be assumed for a publicly offered game. Use [PDPC obligations](https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations)
and [Singapore Statutes Online](https://sso.agc.gov.sg/Act/PDPA2012) for the current law. PDPC direct HTML was challenged
and SSO retrieval was forbidden during this run; do not treat this report as verification of every current amendment.

**Children:** no ages or accounts are collected, but technical requests still occur. PDPC's
[children's digital-environment guidelines](https://www.pdpc.gov.sg/-/media/files/pdpc/pdf-files/advisory-guidelines/advisory-guidelines-on-the-pdpa-for-children%27s-personal-data-in-the-digital-environment_mar24.pdf)
address age-appropriate information/consent and parental involvement, including the under-13 case. Determine the
intended audience and actual data processing before relying on an exception or collecting age information. Do not
add an unsupported “13+” statement or intrusive birth-date collection as a substitute for review. Review US COPPA
if child-directed/actual-knowledge conditions arise, and EU/UK scope/children's rules if offering/monitoring there.
Public reachability alone does not settle every foreign law's territorial scope.

**Consent decision:** no tracking banner or cookie policy page was added. The inspected app has functional browser
saves, graphics capability access and ordinary resource delivery, rather than an advertising/tracking integration.
Singapore PDPA does not translate automatically into a European-style cookie banner, but lawful processing and
notification still need assessment. EU/UK storage/access rules also cover localStorage and capability access, even
without cookies/personal data; do not presume every preference, automatic pre-play save or GPU record is exempt.
[ICO storage/cookie guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/)
describes the service-requested/strictly-necessary exception and its limits. The inspected ICO page flags updated
guidance under consultation; confirm the current final rules before relying on a particular exception.

**Uncertain / review required:** justify the service-requested save/performance uses for each intended market;
otherwise remove/defer optional storage/access or obtain valid consent **before** it occurs. No fake control was
added. Self-hosting removes the separate font/CDN disclosures and possible legal-basis concerns for routine play.
Provider security cookies and new analytics would require a fresh assessment. These unresolved scope/necessity
questions are covered by the false release approvals; the absence of a banner is not a worldwide compliance claim.

**Singapore business status:** free play and a GitHub handle do not establish a registered company or whether any
registration is required. No company name/registration was assumed. Check [ACRA's registration guidance](https://www.acra.gov.sg/how-to-guides/before-you-start/who-must-register)
against the actual activity if it becomes a business. Liability/consumer protections, minor capacity, Singapore-law
clause and availability/change provisions require legal review; no exclusion of non-excludable rights was drafted.

## G. Website implementation

Standalone `privacy.html`, `terms.html` and `credits.html` fit the current dark blue/cyan UI and Titillium typography.
They have ordinary accessible links, semantic headings, visible keyboard focus, responsive wrapping, selectable
text, print styles and a Back to the game link. They load without WebGL or the simulation and remain readable when
the game engine fails. Stable `.html` URLs work on static Vercel hosting without rewrites.

Main-menu Privacy/Terms/Credits links and visible OSM/non-affiliation notices are available before starting a race.
OSM data credit and a Credits link also appear beside the race map; the link opens separately to preserve the race.
The local reset uses a real browser confirmation, warns about irreversible Career/VR/settings loss and other tabs,
and removes only six known Apexra keys. Cancel does nothing; failed storage reports failure. It does not remove
another application's data, contact a server or automatically clear anything when a legal page opens. A still-running
game in another tab can restore its in-memory state; close it before reset. Browser-wide site-data controls are the
fallback and affect this origin/profile only. No server save/account recovery was introduced.

The simulation block and circuit dataset remain byte-for-byte unchanged. No physics, AI, Career rules, circuits or
pit-stop behavior was changed. Existing rendering/UI/runtime code remains, with only legal navigation and dependency
loading changed; known debug exports are stripped in the build rather than removing test harnesses from source.

## H. Security and deployment findings

| Finding | Change / evidence | Remaining limit |
|---|---|---|
| Live static root delivers full unminified runtime; developer accessors include `APEX`, `__game`, `__setKey` and camera/render probes | Allowlisted build minifies/extracts `sim.js` and `game.js`, strips known accessors; emits no source maps | Browser runtime remains readable; no anti-inspection claim |
| Live HEAD checks returned 200 for internal circuit documentation, the circuit build script and the third-party reference screenshot | Vercel `outputDirectory: dist`; only named public assets/notices copied. Those files are absent from staged output. README, a guessed source-map path and Git HEAD returned 404. | **Blocking:** remove existing exposures through an approved deployment/configuration action; check old deployment URLs too. No remote cleanup was performed. |
| Remote CDN engine and Google Fonts receive routine requests | Same-origin pinned Three.js/font files and hash manifest; full MIT/OFL included | Hosting provider still receives requests; future updates need review |
| Live HTTPS/HSTS verified; no CSP, Referrer-Policy, nosniff or frame headers appeared in inspected root response | `vercel.json` adds tested CSP, no-referrer, nosniff, DENY/frame-ancestors and restricted unused hardware permissions | Browser CSP testing is local; no remote header change deployed; inline styling remains allowed for existing UI |
| No obvious hardcoded credentials, tokens, exposed environment values, source-map directives, debug server/API endpoints or suspicious upload URLs found in runtime/current source searches | Public output excludes private config/audits/scripts; no new secrets introduced | Pattern review is not exhaustive history/secret scanning or penetration testing; previously public history warrants owner review/rotation if a secret was ever present |
| Upstream circuit/terrain downloads use moving branches and cached filenames | Documented blocker; did not regenerate or alter circuits | Record exact original inputs/hashes and license decisions; fetching today's bytes does not prove the original source version |

Runtime data logs stay in memory/console in inspected code; no remote log endpoint was added. Vercel/build-platform
logs may still hold data. See [Vercel project configuration](https://vercel.com/docs/project-configuration) for output
and headers. The CSP intentionally contains no telemetry/report destination and no unsafe-eval; shader compilation
does not require opening arbitrary remote script origins. A dependency/advisory review should precede engine updates;
the audit does not silently change the 3D engine version or claim a scan proves complete security.

## I. Required developer actions

1. Confirm/correct public GitHub visibility and verify the private repository remains connected to Vercel. Changing
   visibility was left pending your answer; no permission was inferred to make anything public.
2. Supply **[VERIFIED COPYRIGHT OWNER]**, **[MONITORED PUBLIC PRIVACY/CONTACT EMAIL]**, **[POLICY EFFECTIVE DATE]**;
   confirm who handles PDPA/DPO enquiries and any identity/address disclosures applicable to your actual operation.
3. Establish rights to original code/logo/favicon/procedural artwork, contributor/commission arrangements and
   any AI-assisted assets. Resolve possible copied third-party expression.
4. Resolve TUM LGPL corresponding-source/combined-work and OSM ODbL database/source-access obligations. Approve a
   concrete distribution method that preserves third-party modification rights without unnecessarily releasing
   proprietary code. Exact upstream revisions and original source data are required evidence.
5. Identify actual terrain sources/version/hash per tile and add the applicable permissions/notices. Existing
   SRTM-only assertions are not sufficient.
6. Clear Apexra word/logo and sponsor signs in intended territories; investigate the existing gaming vehicle use;
   review real-circuit branding/depictions. Decide retention/replacement of challenged assets before publication.
7. Confirm Vercel analytics/Speed Insights settings, security services/cookies, access logs, log drains, retention,
   access roles, processor agreement, subprocessors and cross-border safeguards. Do not supply credentials here.
8. Review intended age/territories, the storage/capability-access exemption or consent approach, privacy rights
   process, non-excludable liability, Singapore-law clause and terms effectiveness. Resolve draft statements.
9. Record decisions, update actual policy/credits content, then complete `legal/release.json` reviews. Run reviewed
   production build and browser checks; confirm Vercel uses that output and gate. Publication remains a separate
   explicit approval. A passing local build alone is not authorization to deploy.

## J. Release-readiness classification

**Blocking:** public repository contrary to intended distribution; current deployment exposing an internal build
script/documentation and third-party reference screenshot; missing verified owner/contact/effective date;
unproven original-art rights; LGPL/ODbL source/combination questions; mixed terrain provenance/terms; Apexra/logo/sponsor
clearance; hosting/privacy and age/territorial/consent/terms decisions. These stop the production build by default.

**Important:** record pinned original circuit/DEM inputs and maintain a rights ledger; verify post-approval Vercel
headers/output/routes/log controls; review previous public history and existing source-exposing deployments; keep a
privacy enquiry/breach process and dependency review cadence. No blanket security certification is made.

**Optional:** approved save export/import for player convenience, more browser/device compatibility checks, a longer
term asset-source ledger and professionally reviewed trademark strategy. None is implemented as a new data service.

## K. Testing results

Testing outcomes and any failed/limited checks are recorded after execution in `docs/release-tests.md`. No skipped,
timed-out, indirect or unexecuted check should be described as passed. The release gate is expected to fail while
blockers remain. The local draft is reviewable; the game is not legally cleared or authorized for deployment.
