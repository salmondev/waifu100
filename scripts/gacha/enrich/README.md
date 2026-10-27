# Catalog enrichment (T-0027 Slice A) — STATUS: WIP

Fills gaps AniList leaves in `src/server/gacha/catalog.json` (age the game can't parse, gender,
birth month, JP voice actor, card occupation, anime coverColor) from other sources, each value
with provenance. **Unit tests for these scripts are not written yet** (see "Pending" below).

## Files

| File | What |
|---|---|
| `src/server/gacha/enrichment.json` | Approved values keyed by AniList id: `characters[id][field]`, `anime[id].coverColor`. Every value is `{value, source, url, confidence, fetchedAt, raw?, note?, reviewedAt?}`. |
| `src/server/gacha/review.json` | Candidates waiting for a human (`items[]`, `status: pending/approved/rejected/merged/superseded`). |
| `src/server/gacha/enrichment.ts` | Types, `validateEnrichment` / `validateReview`, lazy `getEnrichment()`. Not wired into the game; the game reads catalog.json only. |
| `scripts/gacha/build-catalog.mjs` | Generator: now stores roster `image` and applies enrichment.json (see below). |
| `out/`, `.cache/` | Per-run candidate files and raw API pages (gitignored). |

## Rules

- **Never overwrite AniList.** A sidecar value is applied only where AniList's value is null
  (`ageGame` only where AniList `age` is not parseable by the game). Each row lists what the
  sidecar filled in `enriched: [...]`; the next generator run removes those first, so a fresh
  AniList value always wins.
- **Provenance required.** Values without valid source / https url / confidence / ISO `fetchedAt`
  are rejected by the merge.
- **Only high-confidence values from non-review-only sources auto-merge.** Everything else goes to review.json.
  Review-only sources: `anilist-pronouns` (pronoun-inferred gender, at ANY confidence), `serper`, `agent`.
- `age` stays AniList's raw text; `ageGame` is added on BOTH `roster[]` and `characters[]` rows,
  in the game's parseAge format: `"17"`, `"16-18"`, `"100+"` (the game also accepts `"~17"`).
- **Roster images**: `roster[].image` is the exact URL AniList returns (`https://s4.anilist.co/...`)
  or `null` for AniList placeholders. Never rewritten, proxied, resized or given a query string.
  The generator throws if any non-null roster image does not match `^https://s4\.anilist\.co/`.
- **/api/img moderation**: up to ~1,091 new (guess-only character) images will be shown through
  `/api/img`, which runs Gemini moderation lazily, once per image, on first view
  (fail-open on rate limit). Expect at most ~1,091 moderation calls, spread over weeks of play.
  /api/img itself is unchanged.

## Scripts (all in `scripts/gacha/enrich/`, run from the repo root)

Every script that calls a network service is **dry-run by default** and needs `--live`.

| Script | Network | Output (`out/`) |
|---|---|---|
| `normalise-age.mjs` | none (reads catalog.json) | `age-candidates.json` |
| `anilist-desc.mjs [--live] [--max N]` | AniList public, 1 req/2.5 s | `anilist-desc-candidates.json` (age/birthday labels; pronoun gender → review only) |
| `cover-color.mjs [--live]` | AniList cover images | `cover-color-candidates.json` (saturation-weighted accent colour, sharp) |
| `jikan.mjs [--live] [--max N=300] [--cards-only] [--fields …] [--anime id,…] [--cache dir]` | Jikan (no key) ≥1.1 s gap, ≤55/min, retry/back-off | `jikan-candidates.json` |
| `serper.mjs [--live] [--max N=50] [--after file] [--include-guess-only] [--ledger file]` | Serper (paid key) | `serper-candidates.json` (always review) |
| `redis-measure.mjs [--live] [--sample 500] [--max-keys 20000]` | Redis READ-ONLY (SCAN/GET/TYPE) | `redis-counts.json` (counts only) |
| `merge.mjs <candidate files…> [--dry-run]` | none | writes enrichment.json + review.json |

Env vars read (names only): `SERPER_API_KEY` (serper `--live` only; never printed or written; missing
→ exit 2 with a message), `SERPER_DAILY_CAP` (optional; malformed = 0 queries), `SERPER_ENDPOINT`
(tests only; localhost only), `REDIS_URL` (redis-measure `--live` only; missing → exit 2).

## Mac commands (CoS runs these; the box cannot reach Jikan (TLS EOF) and has no keys)

```bash
cd <waifu100 repo>                 # on branch t0027-enrich (or A+B merged)
npm ci                             # if node_modules is missing

# 1. Jikan (free, ~1 req/s). Dry-run first, then live; re-run to continue (cached in .cache/jikan).
node scripts/gacha/enrich/jikan.mjs
node scripts/gacha/enrich/jikan.mjs --live --max 300

# 2. Serper (PAID, uses the key in .env.local). Load the key into THIS shell only; never echo it.
set -a; source .env.local; set +a
node scripts/gacha/enrich/serper.mjs --after scripts/gacha/enrich/out/jikan-candidates.json            # dry-run: prints queries only
node scripts/gacha/enrich/serper.mjs --live --max 50 --after scripts/gacha/enrich/out/jikan-candidates.json

# 3. Redis read-only counts (needs REDIS_URL in the shell; output has counts only)
node scripts/gacha/enrich/redis-measure.mjs              # dry-run
node scripts/gacha/enrich/redis-measure.mjs --live
```

**Bring back** (no secrets inside; serper output is checked for the key before writing):
`scripts/gacha/enrich/out/jikan-candidates.json`, `out/serper-candidates.json`, `out/redis-counts.json`.

## Merge order

```bash
node scripts/gacha/enrich/normalise-age.mjs
node scripts/gacha/enrich/anilist-desc.mjs --live
node scripts/gacha/enrich/cover-color.mjs --live
node scripts/gacha/enrich/merge.mjs scripts/gacha/enrich/out/*.json     # add --dry-run to preview
# review: edit src/server/gacha/review.json, set "status": "approved" (or "rejected") per item,
# then run merge.mjs again (approved items move to enrichment.json with reviewedAt)
npm run gacha:catalog                                     # full refetch (~6-7 min), or:
node scripts/gacha/build-catalog.mjs --apply-only         # no network: re-apply enrichment.json only
```

Field contract for the game side (Slice B): see `docs/gacha-catalog-fields.md` on branch t0027-slice-b.

## Pending (WIP)

- Unit tests (normaliser incl. parity with feedback.ts parseAge; merge: no overwrite / provenance
  required / low+pronoun → review; Serper key never printed, missing key exits non-zero; redis
  read-only proxy; catalog roster images match s4.anilist.co; enrichment.json validates).
- Jikan + Serper + Redis runs on the Mac, then merge + review + regenerate.
