# Gacha Guess content pipeline

`node scripts/gacha/build-catalog.mjs` (or `npm run gacha:catalog`) queries the public
AniList GraphQL API at build time and writes static, committed data:

- `src/server/gacha/catalog.json`: ~150 popular anime, 6-10 characters each
  (MAIN first, then SUPPORTING by favourites). No descriptions are stored.
- `src/server/gacha/catalog-gaps.json`: honest coverage counts (missing hair, occupation,
  gender, age, quote, silhouette).

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
