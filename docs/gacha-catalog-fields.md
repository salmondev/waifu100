# Gacha catalog fields: roster image and game age (T-0027 Slice B)

The app-side contract for two optional catalog fields. `scripts/gacha/build-catalog.mjs`
(T-0027 Slice A) writes them. Every field is optional, so older catalogs still load
and behave byte-identically.

## Fields

| Field | Where | Type | Meaning |
|---|---|---|---|
| `image` | `roster[]` (`RosterCharacter`) | `string \| null`, optional | AniList `image.large`, the full `https://s4.anilist.co/...` URL exactly as AniList returns it (no query string added). Used only for guess-only characters, because card characters already have card art. |
| `ageGame` | `roster[]` and `characters[]` | `string \| number \| null`, optional | Normalized age for the game. A number is that exact age. A string must be readable by `parseAge` (`src/server/gacha/feedback.ts`), e.g. `"17"`, `"17-18"`, `"~17"`, `"100+"`. `age` stays the raw AniList text. |

Types: `src/server/gacha/catalog-types.ts`. `fromCard` in `rules.ts` copies `ageGame`
onto the roster entry only when the card has one.

## Age: `gameAge()` (`src/server/gacha/rules.ts`)

Age feedback (state and shown value) uses `gameAge(c)`:

1. `ageGame` is a safe integer ≥ 0 → `String(ageGame)`.
2. `ageGame` is a string that `parseAge` accepts → that string.
3. Anything else (absent, null, negative, decimal, unparseable) → the raw `age`.

So a bad `ageGame` never hides a usable raw age. A number above `parseAge`'s max age
still parses to null and shows `?`.

## Guess images

The server (`service.ts`, round DTO `guesses[].image`) picks, in order:

1. card art (`characters[].image`) for card characters;
2. else roster `image` (`roster[].image`);
3. else `null` → the client shows the initial-letter face (`.g-noface`).

The client (`src/components/gacha/play.tsx` `Face`, `pack.tsx` `RecapFace`) loads
every image through `/api/img` (`proxied()`). If the `<img>` fires `error`, it
swaps to the same letter face. The answer art has no name, so it shows `?`. A new
`src` gets a fresh try. A successful load or a null image renders exactly as
before.

## Moderation note

New roster images go through `/api/img` Gemini moderation lazily, the first time
each one is shown (`gemini-2.5-flash-lite`). Verdicts are cached in Redis
`waifu100:mod:v1` by the sha256 of the bytes. On a Gemini error or 429,
moderation fails open: the image is served unchecked with a 60 s cache and no
verdict is stored. The route effectively always returns 200, so the client
`onError` fallback only covers real load failures.

Tests: `rules.test.ts` (`gameAge`, `ageGame` feedback), `service.test.ts` (roster
image fallback), `play.test.tsx` ("a broken guess image falls back to the initial face").
