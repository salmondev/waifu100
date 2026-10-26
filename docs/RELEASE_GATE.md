# Release Gate — waifu100

Applies to every change shipped to https://waifu100.vercel.app, whoever makes it
(Claude, Cursor, Codex, or a human). Run the steps **in order**. A step that fails
stops the release. Commands run from the repo root; `npm run X` and `bun run X`
are interchangeable.

> **Safety first.** Dev and prod share Redis, Blob, Gemini and Serper. Local
> tests must never touch them:
> - e2e mocks every `/api/**` call and every off-box host in the browser
>   (`tests/e2e/fixtures.ts`, auto fixture, always on);
> - the e2e/verify server and build run with dummy env (`tests/e2e/safe-env.mjs`)
>   so server code can only reach `127.0.0.1:1`/dummy keys;
> - post-deploy smoke is **GET-only** and never calls `/api/*`.
> - Never open or print `.env*`. Never run `scripts/migrate-*`, `restore`,
>   `prune-cache`, `add-to-feed` as part of a release.

## 0. One-time setup (per machine)
```bash
bun install
npx playwright install chromium
vercel link            # only needed for deploy/rollback steps; .vercel/ already exists here
```

## 1. Change
1. Branch from `main`: `git switch -c <type>/<short-name>`
2. Make the change. Add/adjust tests in the same change:
   - pure logic → unit test next to the file (`src/**/*.test.ts`, Vitest)
   - API route → contract test with mocked Redis/Blob/AI (`src/app/api/**.test.ts`)
   - user-visible flow → Playwright spec in `tests/e2e/` (mock via `fixtures.ts`)
3. Self-check fast loop: `npm run typecheck && npm test`

## 2. Review
1. `git diff main...HEAD --stat` — every file is expected; no `.env*`, no secrets, no debug logs.
2. A second reviewer (human or a different agent session) reads the diff and answers:
   - Does it touch `src/app/api/**`, `next.config.ts`, middleware, auth/admin, Redis keys? → needs a security-minded review.
   - Are new external calls / env vars documented?
   - Are tests meaningful (would fail without the change)?
3. Record reviewer name/agent for the audit log.

## 3. QA (the gate)
Run all of it. Every line must pass.

| # | Layer | Command | Pass criteria |
|---|-------|---------|---------------|
| 3.1 | All-in-one | `npm run verify` | prints `VERIFY: PASS` |
| | ↳ typecheck | (inside verify) `tsc --noEmit` | 0 errors |
| | ↳ lint | (inside verify) `eslint` | 0 errors (warnings allowed) |
| | ↳ unit + integration + API contract | (inside verify) `vitest run` | 0 failures |
| | ↳ integration (route handlers + server pages in-process) | (inside verify) `vitest run -c vitest.integration.config.mts` | 0 failures, 0 outside calls |
| | ↳ build | (inside verify) `next build` with dummy env | succeeds |
| | ↳ perf/bundle budget | (inside verify) `scripts/bundle-budget.mjs` | gzip total ≤ 1500 KB, largest chunk ≤ 350 KB |
| | ↳ Playwright e2e + a11y + visual smoke | (inside verify) `playwright test` on port 3200 | all pass |
| 3.2 | Dependency audit | `npm run security:audit` | no **high/critical** in prod deps (or each one triaged in the log) |
| 3.3 | Secret scan | `npm run security:secrets` | `SECRET SCAN: PASS` (gitleaks if installed, regex fallback otherwise) |
| 3.4 | Headers (preview) | `npm run security:headers -- <preview-url>` | required headers present |

Useful variants:
```bash
npm run verify -- --skip=e2e            # quick local loop
npm run verify -- --only=e2e            # needs an existing build (run build first)
VERIFY_CONTINUE=1 npm run verify        # run every step even after a failure
npx playwright test --ui                # debug e2e; report: npx playwright show-report node_modules/.cache/playwright/report
```

Critical e2e flows covered (`tests/e2e/`): home shell, character search, grid build
(select + place), view (`/view?g=` encoded grid, `/view` redirect, unknown share id),
share (mocked `POST /api/share` → link shown), export (`Save as .png` download),
story builder, story compare, compare picker; axe a11y on `/`, `/story`, `/compare`,
`/community` (fails on **new** critical violations; baseline in `a11y-visual.spec.ts`);
visual smoke (non-blank screenshot attached to the report).

## Feature → test coverage matrix

Rule: **every new feature (or new API route / page) adds or updates a row here in the
same change**, naming at least one test that fails without it. A row marked
`gap` must say why and what would close it. Reviewers reject changes that add a
feature without a row.

Legend: **U** = `src/**/*.test.ts(x)` (unit, existing), **I** = `tests/integration/*`
(in-process route/server tests, Redis/Blob/Gemini/Serper mocked, outside fetch
blocked), **E** = `tests/e2e/*` (Playwright, all network mocked).

| Feature | Tests | Status | Gaps |
|---|---|---|---|
| Home shell / grid build | E `home-grid.spec.ts`; U `src/app/page*.test.tsx`, `waifu-grid-ops.test.ts` | covered | drag-and-drop reorder not exercised in e2e |
| Character search | E `home-grid.spec.ts`, `features.spec.ts` (500 → fallback) | covered (UI) | `/api/search` server logic only via U (Engineer 1's Serper guard tests) |
| View grid (`/view?g=`, `/view/[id]`) | E `view-share.spec.ts`; I `og-and-pages.test.ts` (SSR page + metadata, story redirect, missing → home) | covered | — |
| Share create / edit / read / delete | I `share-lifecycle.test.ts` (owner vs stranger, 400/403/404); E `view-share.spec.ts` (modal, mocked POST), `features.spec.ts` (failure state); U `share-service*.test.ts` | covered | — |
| Export (Save as .png) | E `view-share.spec.ts` | covered | image pixels not compared |
| Uploads (grid thumb + story custom cover) | I `uploads.test.ts` (ok, 400 no file, 415 type, 413 size, 422/503 moderation, no-token); E `features.spec.ts` (client-side type/size reject, PNG accepted → cell filled); U `upload.test.ts` | covered | waifu-side manual upload (client compression) not in e2e |
| AI verdict (waifu) | E `features.spec.ts` (generated once, Copy Text → clipboard, Copy Image no error, Disagree → regenerate, 500 → friendly error); I `ai-verdict.test.ts` (once per call, regenerate, input caps, no key, garbage/throw → generic 500) | covered | "save image" checked as no-error only, PNG content not asserted |
| AI verdict (story) / compare verdict | I `verdicts.test.ts` (once → cached, owner disagree → regenerate, stranger keeps stored, 400/403/404) | covered | story verdict UI not in e2e |
| Story mode: Anime / Manga / Light Novel search | E `features.spec.ts` (3 types, AniList mocked, NOVEL format filter) | covered | — |
| Story: pick title + image into cell | E `features.spec.ts` | covered | — |
| Story: cell detail card | I `story-cell-card.test.tsx` (info load, Escape, error state, uploads skip lookup) | covered (component) | card on `/story/v/[id]` not e2e (server-rendered from Redis) |
| Story: Serper web fallback | E `features.spec.ts` (AniList down → web results); I `story-search.test.ts` (no key 503, 3 types parse + cache, upstream 502) | covered | — |
| Together mode | E `features.spec.ts` (start session → room created → board URL; room server down → message) | partial | live sync over WebSocket not tested (room server is a separate Railway service); needs a fake WS server fixture |
| Compare: picker | E `story-compare.spec.ts`, `features.spec.ts` (pick two → `/compare?a&b`, feed failure state) | covered | — |
| Compare: two-grid result page | I `og-and-pages.test.ts` (SSR diff, title "A × B", missing grids fallback) | covered (server) | rendered result UI not e2e (SSR reads Redis) |
| Community | E `features.spec.ts`, `a11y-visual.spec.ts`; I `share-lifecycle.test.ts` (feed lists waifu/story by kind) | covered | — |
| My grids | I `share-lifecycle.test.ts` (owner only, stranger/anon empty, Redis failure 500); E `features.spec.ts` (page renders mocked list) | covered | — |
| OG image routes | I `og-and-pages.test.ts` (share card PNG, compare card PNG, 404s, Redis failure → generic 500) | covered | `community/opengraph-image` (edge) not tested |
| Admin & cron auth | I `auth-routes.test.ts` (cron 401, moderation 401, serper-images 401, admin desk 404 off-localhost); U `secret-routes.test.ts`, `cron-key.test.ts` | covered | admin desk returns **404 not 401** by design (localhost-only) |
| Error states | E: search 500, share 500, analyze 500, compare feed 500, together down; I: bad JSON 400, unknown id 404, Redis down 500, AI garbage 500, no env names leaked | covered | — |
| a11y | E `a11y-visual.spec.ts` (axe, fails on new critical; baseline: `/` button-name, `/community` aria-required-children) | partial | baseline violations need src fixes |
| Visual smoke | E `a11y-visual.spec.ts` (non-blank screenshot) | partial | no pixel baselines |
| Gacha Guess `/daily` (round, Loldle feedback, hint ladder + hint-image tokens, tiers, share text, 30-day archive, coins/streak) | U `src/server/gacha/{rules,feedback,service,config,hint-image}.test.ts`, `src/lib/gacha-{share,hint-image}.test.ts`, `src/components/gacha/{play,album,archive}.test.tsx`; API contract `src/app/api/gacha/gacha-routes.test.ts` (400/404/409, archive future/pre-epoch 404, player+day-bound tokens checked against the stored round's answer incl. legacy pre-r2 rounds, round-day on every write, coins once per day) | partial | no Playwright spec in `tests/e2e/` and no `tests/integration/` file; browser flow only checked by an off-repo isolated smoke (memory store, no network); needs `DAILY_SALT` in Vercel (else 503) |
| Perf / bundle | `scripts/bundle-budget.mjs` in verify | covered | no runtime (LCP) budget |
| Security gates | `security:audit`, `security:secrets`, `security:headers`, `smoke:prod` | covered | CSP missing in prod (warn) |

## 4. Pre-deploy checklist
Copy into the PR/commit message and tick:
```
- [ ] npm run verify → VERIFY: PASS (paste summary table)
- [ ] Coverage matrix row added/updated for every new or changed feature
- [ ] npm run security:audit → no new high/critical (or triaged: ...)
- [ ] npm run security:secrets → PASS
- [ ] Reviewed by: ...
- [ ] No new env var, or it is set in Vercel (Production + Preview) BEFORE deploy
- [ ] No data migration, or migration plan + backup (scripts/backup.mjs) done by a human
- [ ] Current prod deployment URL noted for rollback: `vercel ls waifu100 --prod | head -5`
- [ ] git status clean, commit pushed to main (or PR merged)
```

## 5. Deploy
Preferred: merge/push to `main` → Vercel Git integration builds Production.
Manual (only if Git integration is off):
```bash
PREV=$(vercel ls waifu100 --prod 2>/dev/null | awk '/https:/{print $2; exit}')   # save for rollback
echo "rollback target: $PREV"
vercel deploy --prod
```
Optional preview first: `vercel deploy` → run step 6 against the preview URL.

## 6. Post-deploy verify (read-only)
```bash
npm run smoke:prod                         # https://waifu100.vercel.app
npm run smoke:prod -- https://<preview>.vercel.app
```
Checks GET `/`, `/story`, `/compare`, `/community`, `/manifest.webmanifest`,
`/icon-512.png`, `/favicon.ico`, `/view` (redirect) and security headers
(HSTS + nosniff required; CSP / X-Frame-Options / Referrer-Policy /
Permissions-Policy reported as warnings). It never POSTs and never calls `/api/*`.
Then open the site once by hand: search one character, check the grid renders.
Watch `vercel logs waifu100.vercel.app` for ~5 minutes for 5xx spikes.

## 7. Rollback (if step 6 fails or users report breakage)
Fastest (no rebuild):
```bash
vercel ls waifu100 --prod                 # find last good deployment
vercel rollback <last-good-deployment-url> # or: vercel promote <url>
npm run smoke:prod                         # confirm
```
Then fix forward in git:
```bash
git revert --no-edit <bad-commit-sha>      # never force-push main
npm run verify && git push
```
Data written by the bad deploy (Redis/Blob) is NOT rolled back by either; a human decides on restore (`scripts/restore.mjs`, see backups/).

## 8. Audit log
Append one entry per deploy (and per rollback) to `docs/DEPLOY_LOG.md`, newest at the bottom, using the format in that file. Commit it with the next change (or as `docs: deploy log`).
