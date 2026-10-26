# Deploy Log — waifu100

Append-only. One entry per production deploy or rollback, newest at the bottom.
Process: see `docs/RELEASE_GATE.md`.

Format (copy this block):

```
## <YYYY-MM-DD HH:MM> <TZ> — <deploy|rollback> — <PASS|FAIL|ROLLED BACK>
- who: <human name> / <agent: claude|cursor|codex|grok|none>
- reviewer: <name/agent>
- commit: <sha> (<branch>) — <one-line summary>
- deployment: <vercel deployment url>
- checks: verify=<PASS|FAIL> (unit <n>/<n>, e2e <n>/<n>, build <s>s, bundle <KB> KB) | audit=<ok|triaged: ...> | secrets=<PASS|FAIL> | smoke:prod=<PASS|FAIL> | headers=<ok|warn: ...>
- result: <shipped | rolled back | aborted at step N>
- rollback ref: <previous prod deployment url> / <revert sha or n/a>
- notes: <anything unusual>
```

---

## 2026-10-22 11:30 ICT — deploy — PASS   (EXAMPLE ENTRY, not a real deploy)
- who: Panurut / agent: grok
- reviewer: claude (review session)
- commit: 0000000 (main) — example: add release gate
- deployment: https://waifu100-example.vercel.app
- checks: verify=PASS (unit 617/617, e2e 19/19, build 60s, bundle 900 KB) | audit=triaged: next (critical) tracked | secrets=PASS | smoke:prod=PASS | headers=warn: no CSP
- result: shipped
- rollback ref: https://waifu100-previous-example.vercel.app / n/a
- notes: example only

## 2026-10-22 15:21 ICT — deploy — PASS
- who: Panurut (approved) / agent: grok
- reviewer: Panurut (direct approval in chat)
- commit: 416e1a3 (main) — test: release gate, e2e + integration coverage, verify/smoke scripts. First prod deploy that also ships 7a41010 + 2b3584f (Next 16.1.6 → 16.4.2, lint fixes, Serper guard test)
- deployment: dpl_J2TjVC6jVWFW2BacVTXdQAhdXWRW — https://waifu100-3mx0e6lix-salmondevs-projects.vercel.app (aliased to https://waifu100.vercel.app)
- checks: verify=PASS in clean worktree after npm ci (typecheck ok, lint 0 errors, unit 618/618, integration 49/50 + 1 skipped, build ok, bundle 385 KB gzip, e2e 35/35) | npm ci --dry-run=ok | secrets=PASS (gitleaks, earlier today) | audit=not re-run for this deploy | smoke:prod=PASS (8/8 GETs) | headers=warn: no CSP
- result: shipped
- rollback ref: `vercel promote https://waifu100-nnk7vg9ox-salmondevs-projects.vercel.app` (dpl_8PAdEFKcSeHZomuxP8EdZb3v74hQ, previous prod) / `git revert --no-edit 416e1a3`
- notes: Git integration deploys main automatically (build ~1 min).

## 2026-10-27 01:41 ICT — deploy — PASS
- who: Panurut (approved) / Chief of Staff pushed from the Mac; agent: grok (Engineer 1)
- reviewer: Engineer 2 (QA PASS on f526166 / eaed3e3)
- commit: eaed3e3 (main) — Merge develop into main: T-0016 Gacha Guess daily game + 30-day archive (/daily, /api/gacha/*). Pushes, no force: develop 7ad2672..f526166 (preview waifu100-5v09q5v8c, Ready), then main 7f3fa5d..eaed3e3 (fast-forward).
- deployment: waifu100-6cdt6zw8v (Ready; aliased to https://waifu100.vercel.app)
- checks: verify=PASS in clean copy after npm ci (typecheck ok, lint 0 errors / 39 warnings, unit 851/851, integration 49 + 1 skipped, build ok, bundle 587 KB gzip, e2e 35/35) | audit=triaged: 13 high, deferred | secrets=PASS | smoke:prod=PASS 8/8 GETs (2026-10-27 01:44 ICT, exit 0) | smoke-gacha=PASS 14/14 (01:44 ICT, exit 0; GET-only supplemental, kept outside the repo) | headers=PASS (required all present; CSP missing, warn)
- result: shipped. /daily live, DAILY_SALT present (API returns 404/400 codes, not 503 gacha_misconfigured), Redis reads ok.
- rollback ref: `vercel promote <previous prod url>` (build of 7f3fa5d; else https://waifu100-3mx0e6lix-salmondevs-projects.vercel.app, 416e1a3, same app code) / `git revert -m 1 eaed3e3` (rollback git ref 7f3fa5d)
- notes:
  - New env: DAILY_SALT (Production + Preview), set in Vercel before deploy. Without it every /api/gacha route returns 503 gacha_misconfigured (fails closed). The value is not recorded.
  - LAUNCH_DAY_KEY = 2026-10-27 (src/server/gacha/rules.ts): puzzle #1 2026-09-27, archive 30 days.
  - New Redis keys; do not delete on rollback; old code never reads them:
    - waifu100:gg:p:<id> (EX 400 d)
    - waifu100:gg:rc:<sha256> (EX 400 d)
    - waifu100:gg:lock:<id> (PX 5 s)
    - waifu100:rl:gacha-{read,write,create,restore,image}:<ip>
  - New deps: motion, @animate-ui/react, three (+@types/three).
  - Deferred:
    - 13 high npm audit findings;
    - 4 P3s: pid token doesn't check that the hint slot was bought; the legacy no-pid token for today is valid for any character; the pid inside the encrypted image URL is exposed if the salt leaks; a round started at 23:59 and finished after midnight gets no bonus/streak, and +10 is credited on the first write after midnight;
    - there is no /daily Playwright e2e yet.
