# Gacha Guess content pipeline

`node scripts/gacha/build-catalog.mjs` (or `npm run gacha:catalog`) queries the public
AniList GraphQL API at build time and writes static, committed data:

- `src/server/gacha/catalog.json`: ~150 popular anime, 6-10 characters each
  (MAIN first, then SUPPORTING by favourites). No descriptions are stored.
- `src/server/gacha/catalog-gaps.json`: honest coverage counts (missing hair, occupation,
  gender, age, quote, silhouette).
- Each anime also carries a **guess roster** (`roster`): the card characters plus AniList's
  most-favourited characters of that anime with at least 50 favourites, 8 to 20 names
  (r2). Roster entries are guess-only: answers and cards still come only from the card set.
  For the feedback row each entry keeps gender, role, raw + parsed age, birth month and the
  first Japanese voice actor (id + name). Coverage is in `catalog-gaps.json` -> `roster`.

### Re-running

- Default: keeps the committed anime list and card set exactly as they are and only
  (re)fetches the roster + feedback fields (one AniList request per anime, cached under
  `--cache <dir>`, default a temp dir).
- `--refresh-anime`: rebuilds the anime list and card set too. This changes which
  characters can be answers; stored rounds keep the answer they were created with.

The app never calls AniList at runtime. Images are hot-linked through the existing
`/api/img` proxy.

## Rules

- No API key, no env vars, no deps. Node 20+.
- Throttled: one request every 2.5 s (AniList's degraded limit is 30/min), retries with
  back-off on 429 / 5xx, honours `Retry-After`. A full run takes ~6-7 minutes.
- Nothing is invented. Fields AniList lacks stay `null` and are counted in the gaps file:
  - `hair`: only from an AniList `Hair:` field or plain prose like "long pink hair",
    mapped to a fixed colour key. Most characters have neither.
  - `quote` and `silhouette`: AniList has no such fields, so they are always `null`.
    The hint ladder skips missing hints and the later ones move up.
- Credit: data and images come from AniList (anilist.co); images are (c) their rights
  holders. The /daily footer shows the AniList credit.

## Daily rules that depend on the catalog (r2)

- Answer of the day: one of the anime's top-10 card characters by favourites, drawn with
  weight sqrt(favourites), seeded by `DAILY_SALT` + the Bangkok day (deterministic).
- Day numbering and the archive: `LAUNCH_DAY_KEY` in `src/server/gacha/rules.ts` is the
  production launch day (Bangkok). Puzzle #1 (`FIRST_DAY_KEY`) is derived as launch - 30
  days, so on launch day all 30 past days are playable from the archive
  (`/daily?view=archive`). To move the launch, change only `LAUNCH_DAY_KEY` (a code
  constant, not an env var) before the first production deploy; changing it later
  renumbers days and re-draws picks of days nobody has played yet.
- Archive rules: a never-played past day (1-30 days back, never before `FIRST_DAY_KEY`,
  never in the future) can be played once; a finished one is view-only. Same free first guess + 6 counted guesses,
  tier and hint prices as a normal day; hints are paid from the current balance. When an
  archive round finishes (won or lost) it pays the normal daily coins once per day key
  (idempotent: the finished round refuses further writes under the profile lock and
  records the grant in `dailyCoins`). No fast bonus, and the streak only counts rounds
  finished on their own day, so the archive never extends or repairs it.

## Free first guess (T-0024)

- The first guess of every round (archive included) is free: it gets normal feedback but
  does not count for the card tier, the 6-guess cap, or the fast bonus. A round therefore
  allows 7 guesses; the round is lost after the free one + 6 counted wrong ones, and any
  further guess is `409 round_over`. A right free guess = SSR + the +30 fast bonus.
- Persisted as `GachaRound.free: true`, set when a round receives its first guess under
  this code. Tier = `tierForGuesses(max(1, counted))`, counted = guesses - (free ? 1 : 0).
- In-flight rule (deploy day): a round that already had >= 1 guess before the deploy keeps
  the old rule (6 guesses, all counted, no free flag); a stored round with 0 guesses gets
  the free guess on its first guess. Finished rounds and stored cards are never recomputed.
- DTO: `maxGuesses` = 6 (counted), `steps.used` = counted guesses,
  `freeGuess: { on, used }`; guesses left = `maxGuesses - steps.used` (+1 while the free
  guess is on and unused). The UI shows "เดาครั้งแรกฟรี · เหลือ N ครั้ง" and a 7-slot track.
- Hint prices (`HINT_PRICES`): 30 / 40 / 50 / 60 / 70 coins for slots 1-5.
- Share text (`src/lib/gacha-share.ts`), squares only, never names:
  - free round won on counted guess S: `waifu100 Daily #N S/6 +free`
  - won on the free guess: `waifu100 Daily #N FREE/6`
  - free round lost: `waifu100 Daily #N X/6 +free`
  - the free guess row is prefixed with `🆓 `; old-rule rounds keep `S/6` / `X/6` unchanged.
