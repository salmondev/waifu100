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

## 2026-10-27 ~09:40 ICT — deploy — PASS — T-0024 r2 (free first guess + hint prices 30/40/50/60/70) + T-0023 (tier counts guesses only)
- who: Panurut (approved; tier option 1 = tier rules as built, no tier change) / Chief of Staff pushed from the Mac; agent: grok (Engineer 1)
- reviewer: Engineer 2 (QA r2 on a2a7f33 / 20121cd)
- commits: develop f526166..a2a7f33 (fast-forward; T-0023 42bb61d, T-0024 630f9cc, r2 a2a7f33; preview waifu100-f8o4fivj7) | main eaed3e3..20121cd (--no-ff merge, first parent eaed3e3, tree = a2a7f33)
- deployment: waifu100-r502ail4q (Ready; aliased to https://waifu100.vercel.app)
- checks (pre-push gate at a2a7f33): verify=PASS (unit 882/882, integration 49 + 1 skipped, e2e 35/35, lint 0 errors / 39 warnings) | targeted gacha 248/248 | secrets=PASS
- prod smoke (2026-10-27 09:30 ICT, GET-only, no profile created; evidence projects/waifu100/t0024-prod-smoke/): smoke:prod=PASS 8/8 GETs + headers (CSP missing, warn) | smoke-gacha=PASS 14/14 | T-0024 static=PASS 7/7 (/ and /daily 200; deployed /daily JS/CSS carry the free-guess rule text, freeGuess reader, r2 'เหรียญไม่พอ (มี' reason, free-slot 12px; none of these exist at eaed3e3)
- not checked on prod: live round DTO freeGuess {on:true} and first hint price 30. Reading them needs a player profile, and GET /api/gacha/today with a new id creates one (prod write). Covered by the gate tests instead.
- rollback ref: Vercel promote waifu100-6cdt6zw8v (eaed3e3 build) / `git revert -m 1 20121cd` on main (also reverts T-0023; T-0024 only = `git revert a2a7f33 630f9cc` on develop). Caveats in projects/waifu100/t0024/ROLLBACK.md: open rounds get counted guesses +1 (and bought hints count again on full rollback), coins spent at new prices not refunded, re-ship = revert the revert, client/server skew ('เหลือ N' shown too low until reload).
- notes:
  - No env change, no Redis migration. New optional round field `free: true` (ignored by old code).
  - Open P3s: rollback skew 'เหลือ N' display too low; pack recap has no free-guess badge; old client + new server shows 6 slots until reload; fast-bonus note (SR = SSR +30 once the first guess is free).

## 2026-10-27 ~10:55 ICT — deploy — PASS — T-0025 r2 (rules guide callout on the .win frame, invite share text + auto-grow share box, /daily og/twitter link preview)
- who: Panurut (approved: "ขึ้น prod") / Chief of Staff pushed from the Mac, no force; agent: grok (Engineer 1)
- reviewer: Engineer 2 (QA r2 PASS on bc498ca / 0c0d47f)
- commits: develop a2a7f33..bc498ca (fast-forward; r1 5bae594, r2 bc498ca) | main 20121cd..0c0d47f (--no-ff merge t0025-main-merge, first parent 20121cd, tree c3aae8a = bc498ca)
- deployment: waifu100-dwbk47aqm (Ready; aliased to https://waifu100.vercel.app)
- checks (pre-push gate at bc498ca, fresh archive + npm ci + unshare -rn): verify=PASS exit 0 (typecheck ok, lint 0 errors / 39 warnings, unit 893/893, integration 49 + 1 skipped, build ok, bundle ok, e2e 35/35) | E2 QA r2=PASS
- prod smoke (2026-10-27 11:00 ICT, GET-only, no /api calls, no profile created; evidence projects/waifu100/t0025-prod-smoke/): smoke:prod=PASS 8/8 GETs + headers (CSP missing, warn) | smoke-gacha --pages-only=PASS 6/6 | T-0025 static=PASS 20/20 (/daily og:title/description/url/image + og:image:width/height 1200x630, twitter:card summary_large_image, twitter:image, theme-color #29adff; og and twitter image 200 image/png 1200x630, byte-identical to the local r2 render; deployed JS/CSS carry "g-rules win", .win frame, .g-rules without its own frame, .g-sharebox textarea field-sizing:content, the invite "ทายตัวละครอนิเมะประจำวัน คุณทายได้กี่ครั้ง? 👇" + https://waifu100.vercel.app/daily; none of these markers exist at a2a7f33)
- not checked on prod: the live share/copy flow and the result screens (they need a played round = a profile = a prod write). Covered by the gate e2e and the r2 screenshots (projects/waifu100/t0025/screenshots/r2/).
- rollback ref: Vercel promote waifu100-r502ail4q (20121cd build) / `git revert -m 1 0c0d47f` on main (rollback git ref 20121cd). Client-only + metadata change: no data, Redis or API change, so rollback has no data caveats.
- notes:
  - No env change, no Redis change, no new deps.
  - Open P3: T-0026, loss screen at 320px: .g-stats overflows by 19px (gacha.css:233-236). Predates r2; backlog, not started.

## 2026-10-27 22:14 ICT — deploy — PASS
- who: Panurut (approved: "ทำตามกระบวนการตรวจสอบและ deploy prod ได้เลย") / agent: grok
- reviewer: same session ran the gate; no separate reviewer
- commit: c7f241f (main, --no-ff, first parent 0c0d47f, tree = develop 649767e) — T-0027 enrichment + roster images/ageGame, star tiers, streak shield, practice mode, album badge, grid drop; Jikan removed
- deployment: waifu100-fqc96gtoi (Ready; aliased to https://waifu100.vercel.app). Preview first: waifu100-3eyhyluwp (develop 649767e)
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 988/988, integration 49 + 1 skipped, build ok, bundle 593 KB gzip, e2e 35/35) | audit=triaged: 13 high, same set as the previous deploy, lockfile unchanged | secrets=PASS | smoke:prod=PASS 8/8 GETs | headers=warn: no CSP
- result: shipped
- rollback ref: `vercel promote https://waifu100-dwbk47aqm-salmondevs-projects.vercel.app` (0c0d47f) / `git revert -m 1 c7f241f`
- notes:
  - No new env var. New optional profile fields `shields`, `shieldDays`, `practice` (old code ignores them).
  - Jikan is not called. Catalog enrichment is the committed sidecar only; review.json stays unmerged.
  - GET https://waifu100.vercel.app/daily returned 200 with title "Gacha Guess รายวัน | WAIFU100". No /api/gacha/today call.

## 2026-10-27 23:10 ICT — deploy — PASS
- who: Panurut (approved: "เอาตามนี้ปรับแล้วขึ้น prod เลย ด่วน") / agent: grok
- reviewer: same session, gate only
- commit: 3057114 (main, --no-ff, first parent e6ae3d1, tree = develop 8162c96) — simpler share text
- deployment: waifu100-r5ef0osm3 (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-kszvnhx4f
- checks: verify=PASS (unit, integration 49 + 1 skipped, e2e 35/35, bundle 593 KB) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200
- result: shipped
- rollback ref: `vercel promote https://waifu100-2t1hfpuph-salmondevs-projects.vercel.app` / `git revert -m 1 3057114`
- notes: Share text is now `waifu100 Daily #N`, one square row per guess, then `ทายตัวละครอนิเมะ สะสมการ์ด 👇` and the /daily link. No 1/6, no 🆓, no archive line.

## 2026-10-27 23:36 ICT — deploy — PASS
- who: Panurut (approved: "ขึ้นเลย") / agent: grok
- reviewer: same session, gate only
- commit: 16d0a43 (main, --no-ff, first parent d73f856, tree = develop 40e176f) — archive day list shows the anime title
- deployment: waifu100-htjhk2ijt (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-b200ef3dh
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 981/981, integration 49 + 1 skipped, build ok, bundle 593 KB gzip, largest 132 KB, e2e 35/35) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200
- result: shipped
- rollback ref: `vercel promote https://waifu100-r5ef0osm3-salmondevs-projects.vercel.app` / `git revert -m 1 16d0a43`
- notes: Each archive day and the today button show the series title (English, else romaji). A started day keeps the anime stored on that round. The character stays hidden. No new env, no Redis migration. No /api/gacha/today call.

## 2026-10-28 16:02 ICT — deploy — PASS
- who: Panurut (approved: "ลองทำแล้วเอาขึ้น prod เลย") / agent: grok
- reviewer: same session, gate only
- commit: 85d9024 (main, --no-ff, first parent 9e76b0e, tree = develop 968d9d3) — share a won card on its own link
- deployment: waifu100-bdvqfirgp (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-cht8jqdjv
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 991/991, integration 49 + 1 skipped, build ok, bundle 605 KB gzip, largest 132 KB, e2e 35/35) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200 | audit=not re-run; lockfile unchanged, previous triage stands (13 high)
- result: shipped
- rollback ref: `vercel promote https://waifu100-lgg2o5h3f-salmondevs-projects.vercel.app` / `git revert -m 1 85d9024`
- notes: After a win, «แชร์การ์ด» is the large red button. It copies `SSR ★★★ Name`, `waifu100 Daily #N`, and `https://waifu100.vercel.app/c/<code>`. The preview image is that pull. Opening the link shows the same card as the pack, plus «มาเล่น». «คัดลอกผลลัพธ์» stays, smaller, and still hides the name. Practice and a loss have no card button. The code is signed with the existing daily salt; no new env and no Redis write. No /api/gacha/today call.

## 2026-10-28 16:19 ICT — deploy — PASS
- who: Panurut (approved: "ทำแล้วเอาขึ้น prod เลย") / agent: grok
- reviewer: same session, gate only
- commit: 70fc9fc (main, --no-ff, first parent 8a508ea, tree = develop f8d35b9) — catalog card art is no longer replaced by the moderation placeholder
- deployment: waifu100-13a9ivofb (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-hro1v20ik
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 992/992, integration 49 + 1 skipped, build ok, bundle 606 KB gzip, largest 132 KB, e2e 35/35) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200
- result: shipped
- rollback ref: `vercel promote https://waifu100-3j5y3kaba-salmondevs-projects.vercel.app` / `git revert -m 1 70fc9fc`
- notes: Akeno Himejima's portrait was already in the catalog and the AniList file returned 200. The mountain on the card was the moderation placeholder, cached after a safety block. Shipped catalog images (918 cards, 2069 roster faces, 150 covers; 2142 unique URLs, all HTTP 200, none missing) are now served as themselves. Visitor uploads are still checked. Image URLs gained `&v=2` so the cached placeholder is not reused. If a portrait still cannot load, the card shows that character's initial. No new env, no Redis migration, no /api/gacha/today call.

## 2026-10-28 16:41 ICT — deploy — PASS
- who: Panurut (approved: "เอาทุกอย่างขึ้น prod เลย") / agent: grok
- reviewer: same session, gate only
- commit: f843fa3 (main, --no-ff, first parent efdfedf, tree = develop b5da5da) — framed card shares, short links, copy-only share, album card view
- deployment: waifu100-l77dvjowc (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-o4u236onh
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 994/994, integration 49 + 1 skipped, build ok, bundle 606 KB gzip, largest 132 KB, e2e 35/35) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200
- result: shipped
- rollback ref: `vercel promote https://waifu100-lses2x8op-salmondevs-projects.vercel.app` / `git revert -m 1 f843fa3`
- notes: Share preview is a framed card (tier border, name, series, drawn stars). The public link is `https://waifu100.vercel.app/c/` plus 8 characters. «แชร์การ์ด» only copies text. An owned album card opens the full card; close with the button or Escape. New Redis key `waifu100:gg:cs:<code>` holds the pull. No new env. No /api/gacha/today call. Catalog art fix from f8d35b9 stays in this tree.

## 2026-10-28 17:00 ICT — deploy — PASS
- who: Panurut (approved: "ปรับแล้วเอาขึ้น prod เลย") / agent: grok
- reviewer: same session, gate only
- commit: d167b8c (main, --no-ff, first parent 16f77cc, tree = develop c98125b) — clearer streak shield, album share, shorter Thai
- deployment: waifu100-mbvmm4s6w (Ready; aliased to https://waifu100.vercel.app). Preview: waifu100-ah3k3b3zc
- checks: verify=PASS (typecheck ok, lint 0 errors, unit 995/995, integration 49 + 1 skipped, build ok, bundle 606 KB gzip, largest 132 KB, e2e 35/35) | secrets=PASS | smoke:prod=PASS 8/8 | headers=warn: no CSP | GET /daily=200
- result: shipped
- rollback ref: `vercel promote https://waifu100-1qj2nob68-salmondevs-projects.vercel.app` / `git revert -m 1 d167b8c`
- notes: The shield price sits on the same control as «กันสตรีค». Opening an album card has «แชร์», which copies the same card text as a win (tier, name, the day, the short link). Nearby album and recovery lines are shorter. A card whose round is gone can still be shared from the album entry. No new env. No /api/gacha/today call.
