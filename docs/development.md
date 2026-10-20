# Authorized developer setup and release review

This repository is intended to be private. Do not change visibility to public or publish internal source archives.
GitHub reported the canonical repository `CodeDreamer666/Apexra` as **public** during this audit; the former
`F1-Game` URL redirects there. Confirm/correct visibility before release. No visibility change was performed.

## Local setup

Use Node 24 (the current Vercel project setting), then `npm ci`. New packages are build/test tools only:
esbuild 0.28.2 and Playwright 1.62.1; no new runtime package or tracking service is introduced. For browser checks,
install Chromium with `npx playwright install chromium`, or set `CHROMIUM_PATH` to an existing Chromium binary.

Run `npm run build:draft`, then `python3 -m http.server 8000 --directory dist`. Open
`http://localhost:8000`. Draft pages carry review warnings, placeholders and noindex metadata. This does not
deploy. Never publish output produced with `--draft`, or serve the repository root publicly. A Python server
does not emulate Vercel headers; `npm run test:legal` serves the artifact with the proposed headers.

The original developer workflow remains available: serve the repository locally with `python3 -m http.server`.
Relative modules require HTTP, rather than opening `index.html` over `file://`. Use the allowlisted build for
approved distribution. Existing simulation tests remain in `tests`. Run `npm run test:legal` for the legal UI,
storage and built runtime. Other browser harnesses may assume old CDN loading or `file://`; adapt them to HTTP
and self-hosted resources when needed. A skipped test is not a pass.

## Deployment modes and required review

Following the developer's explicit production-deployment instruction on 20 October 2026, `npm run build` builds
an expressly labeled **public pre-release**. It omits unknown identity/contact/effective-date fields, retains honest
review-incomplete notices, uses noindex, and does not turn any legal approval flag on. This is not legal clearance.
Use `npm run test:prerelease` to check this deployable artifact. The game and attribution remain accessible.

`npm run build:release` retains the strict check for finalized, reviewed documents. Before using that mode:

1. Read `docs/release-audit.md`, resolve blockers and record evidence/decisions there.
2. Supply the verified owner, monitored public privacy/contact email and ISO effective date in
   `legal/release.json`. Replace the draft owner in `COPYRIGHT.md`. Do not invent a company or address.
3. Resolve every review statement in `privacy.html`, `terms.html`, `credits.html` using actual decisions.
   Replace provider-retention uncertainty, establish children's/territorial scope, confirm original ownership,
   clear the name/logo/sponsor signs, and establish terrain provenance. Resolve LGPL corresponding-source and
   replacement rights and ODbL database-access terms. A data extract plus attribution is not proof all duties
   are met. The build refuses remaining review language.
4. Set each named `approvals` boolean true only after its review is completed. This is a release checklist,
   not evidence an agent checked the dashboard or a lawyer cleared the project. Retain source versions/hashes
   and review decisions privately.
5. Run `npm run build:release` and `npm run test:legal` (the test rebuilds a draft; run the reviewed production build
   again afterwards). Review the final HTML and test the approved artifact. Never deploy a draft artifact.
6. Confirm Vercel uses this build command and `dist` output without overriding the gate. Verify private Git
   integration still works. Obtain explicit approval for publication and deployment.

The strict reviewed-release build fails and removes stale output when details or reviews are incomplete. The gate
cannot detect a dishonest or mistaken manual approval.

## Delivery and security

Automatic Vercel Git deployments use Vercel's default behavior, including builds triggered by pushes to `main`.
The public pre-release build removes placeholder fields and labels incomplete legal information. The separate
reviewed-release command still refuses unresolved details and review decisions. See
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

`vercel.json` uses `npm run build` and serves only `dist`. Production deployment was explicitly authorized on
20 October 2026. `main` is the repository's sole existing branch; use that branch and the production target.
Do not publish local `--draft` output: it is distinct from the sanitized public pre-release build.

The build minifies/extracts runtime scripts, removes known debug accessors, copies only named public files and
license texts, and exports the already-licensed circuit dataset as `data/circuit-data.json`. No maps, tests,
reference screenshots, private audits, configuration, build scripts, history or source archives are in the
public output. Browser-delivered code and data remain inspectable.

Pinned engine/font bytes and upstream URLs/hashes are in `vendor/manifest.json`; the build verifies them.
Those URLs are not contacted at runtime. Preserve full MIT/OFL notices on updates. Re-review requests, CSP,
privacy disclosures, licenses and advisories after dependency changes. The CSP allows current same-origin
scripts/fonts and inline UI styling, and blocks frames, objects, workers and form submission. HTTPS/HSTS are
provided by Vercel; verify deployed headers after an approved deployment. No complete-security claim is made.
