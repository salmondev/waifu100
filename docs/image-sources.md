# Replacing Serper With Free Sources

**Status:** implemented 2026-09-04 — steps 1-3 shipped, step 4 (deleting the Serper branch) deliberately not taken
**Written:** 2026-09-04

> **What actually shipped.** Safebooru (`src/lib/image-sources/safebooru.ts`) and
> Fandom (`src/lib/image-sources/fandom.ts`) run on every `/api/gallery` request
> alongside AniList and Konachan, all keyless. Serper is no longer in that set:
> it runs afterwards and only when the free sources return fewer than
> `SERPER_TOP_UP_BELOW` (12) images, so a typical character never spends credit.
> Measured with `SERPER_API_KEY` unset: Chitanda 81 images, Asuna 73, Marin
> Kitagawa 71, and GIF mode 15 / 8 real `.gif`s for Chitanda / Megumin.
>
> Two things this document did not predict:
> - Wikia serves images from a path that continues past the extension
>   (`.../Foo.jpg/revision/latest?cb=…`), so an extension test against the URL
>   matches nothing. Test the `File:` title instead.
> - The subdomain guess can be right while the page title is wrong — the Sword
>   Art Online wiki files Asuna Yuuki under `Asuna`. Without a wiki-local
>   `list=search` step, cross-wiki search takes over and returns a parody wiki.
**Goal:** drop Serper (Google Images) from `/api/gallery` entirely and cover its job with sources that cost nothing — matching or beating it on coverage, not merely limping along without it.

---

## 1. Why drop it

Serper is a paid, metered API shared across several projects. When its credits ran out on 2026-09-03 the gallery quietly lost its only broad source:

| Source | State that day | Notes |
|---|---|---|
| Serper (Google Images) | **broken** | `{"message":"Not enough credits","statusCode":400}` on every call, GIF or not |
| Jikan (MyAnimeList) | **down** | `504` on every query — still 504 a day later, MAL upstream |
| Konachan | working, thin | intermittent `403` from Vercel's shared IPs; almost no animations per character |

A metered dependency in the hot path means the gallery breaks for reasons that have nothing to do with this project. Everything below is free, and everything marked *keyless* needs no account at all — nothing to run out, nothing to rotate.

## 2. The replacement stack

Every number here was measured against the live APIs on 2026-09-03/04. Nothing is quoted from vendor documentation.

### 2.1 Safebooru — depth of character art, keyless

```
https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=100&tags=<tags>
```

Static art, per character tag:

| tag | posts |
|---|---|
| `chitanda_eru` | 100 (hit the requested limit) |
| `megumin` | 100 |
| `yuuki_asuna` | 100 |
| `frieren` | 100 |

Animations, with the `animated` tag:

| tags | result |
|---|---|
| `chitanda_eru animated` | 15 posts, **all 15 are .gif** |
| `megumin animated` | 8 posts, all .gif |
| `hatsune_miku animated` | 20 posts, 5 .gif (rest .webm) |

Konachan returns **0** for `chitanda_eru animated` — the character that started this whole investigation. Safebooru alone covers both what Serper did for static art and the entirety of GIF mode.

Response fields: `file_url`, `sample_url`, `preview_url`, `image`, `directory`, `tags`, `rating`.

**Resolve the tag, never guess it.** Booru sites tag characters surname-first (`chitanda_eru`), and some use a different name entirely — `asuna_(sword_art_online)` returns nothing while `yuuki_asuna` returns 100 posts. The tag endpoint settles it:

```
https://safebooru.org/index.php?page=dapi&s=tag&q=index&name_pattern=%chitanda%&orderby=count
```

```xml
<tag type="0" count="1"    name="chitandaneko"/>
<tag type="0" count="6"    name="chitanda_eru_(cosplay)"/>
<tag type="4" count="2179" name="chitanda_eru"/>   <!-- type 4 = character -->
```

Take `type="4"` with the highest `count`, then cache it — character tags do not change. Note this endpoint answers in **XML even with `json=1`**, unlike the post endpoint.

### 2.2 Fandom (MediaWiki API) — the source Google was actually surfacing, keyless

Look at the existing grids: a large share of saved characters carry `Google (something.fandom.com)` as their source. Google was mostly acting as an index *into Fandom*. Query Fandom directly and the middleman disappears.

Find which wiki has the character (cross-wiki, no key):

```
https://services.fandom.com/unified-search/page-search?query=Eru%20Chitanda&limit=3&lang=en&namespace=0
```

`namespace=0` is mandatory — without it the endpoint 400s. Results carry `url`, `sitename`, `pageId`, `wikiId`.

Then pull images from that wiki's own API. The character page plus its `/Gallery` subpage:

```
https://hyouka.fandom.com/api.php?action=query&titles=Eru%20Chitanda|Eru%20Chitanda/Gallery&prop=images&imlimit=100&format=json
→ Eru Chitanda: 7 files, Eru Chitanda/Gallery: 35 files
```

Resolve those file names to direct URLs in one call:

```
https://hyouka.fandom.com/api.php?action=query&generator=images&titles=Eru%20Chitanda/Gallery&gimlimit=50&prop=imageinfo&iiprop=url&format=json
→ https://static.wikia.nocookie.net/hyouka/images/3/38/01_(1).png/revision/latest?cb=...
```

42 images for one character, official stills included. A single-image lead is also available cheaply via `generator=search&prop=pageimages&piprop=original`.

Guessing the subdomain from the series name works often enough to try first (`hyouka`, `konosuba`, `frieren` all resolve; `sao` 404s), with unified-search as the fallback.

### 2.3 AniList GraphQL — official portrait, keyless

```graphql
query($s:String){ Page(perPage:5){ characters(search:$s){ id name{full} image{large} } } }
```

`POST https://graphql.anilist.co` returned Eru Chitanda's official portrait instantly while Jikan was answering 504. One canonical image per character. This should become the primary official-art source with Jikan demoted to a fallback — the reverse of today.

### 2.4 GIFs beyond the boorus (free, needs a key)

Safebooru's `animated` tag covers GIF mode on its own for most characters. If more volume is wanted, **Tenor** (Google-run, GIF-first) and **Giphy** both issue free API keys with no billing attached. These are free-tier keys rather than metered credit — but they are still an account to manage, so treat them as optional.

### 2.5 If a general web image search is ever needed again

Not required by the plan above. Kept for the record:

| Option | Free allowance | Trade-off |
|---|---|---|
| Google Programmable Search JSON API | ~100 queries/day | Official; supports `searchType=image` and `fileType=gif` directly. Closest drop-in for Serper. A `/api/images` route wired this up (Gemini wrote the query, CSE ran it) but nothing in the app ever called it; it was deleted on 2026-09-04 along with `GOOGLE_CSE_API_KEY` / `GOOGLE_CSE_ID`. Recover it from git history if this row is ever taken up. |
| Brave Search API | ~2,000 queries/month | Smaller index, proper image endpoint. |
| Self-hosted SearXNG | unlimited | One Docker container, JSON output, `categories=images`. It is a scraper: periodic CAPTCHAs, dead engines to prune, extra latency. |

Allowances shift — re-check before committing to one.

**Run any scraper from the home server, not Vercel.** Vercel's outbound IPs are shared and already get rejected by Konachan (`http-403` observed in production). SearXNG on the home box behind a Cloudflare Tunnel avoids that, at the cost of the app depending on that box being up.

## 3. Plan

1. **Safebooru as the primary source**, static and GIF alike.
   - Resolve the character tag through the tag endpoint; cache the mapping.
   - GIF mode: query `<tag> animated`, keep only `.gif` — `.webm` cannot go in the grid.
   - Fall back to the series tag when the character tag has nothing.
2. **Fandom as the second source**, replacing what Google was fetching from those same wikis: unified-search for the wiki, then page + `/Gallery` images.
3. **AniList promoted over Jikan** for the official portrait; keep Jikan as a fallback for when MAL is actually up.
4. ~~**Remove the Serper branch from `/api/gallery`**~~ — *not done, on purpose.* Demoting it to a top-up costs nothing while credits are absent (`sources.serper` reads `not-needed`) and keeps a broad web fallback for the characters the boorus and wikis genuinely do not cover. Deleting it would throw that away to remove a branch that no longer runs. `/api/serper-images` is a separate route — decide it separately.
5. Optional: Tenor/Giphy for GIF volume; SearXNG only if a genuine web-wide search turns out to be missed.

Target end state: no metered API in the gallery path, and `sources` in the response showing at least two independent sources answering for a typical character.

## 4. Things not to re-learn the hard way

- **Konachan tags animations as `animated`,** not `gif` (a single safe post site-wide) and not `animated_gif` (does not exist). Same tag on Safebooru.
- **Booru results are not all images.** `.webm`/`.mp4` posts come back from the same `animated` tag and must be filtered out.
- **A `.gif` URL test must ignore query strings,** and Tenor/Giphy/gfycat serve animations under `.webp`/`.mp4` URLs that never end in `.gif`.
- **Rating filters cost a tag slot.** Konachan accepts `name animated rating:safe`; Safebooru is already SFW-only, so the slot is free there.
- **Fandom's unified-search 400s without `namespace=0`.**
- **Safebooru's tag endpoint returns XML even with `json=1`;** its post endpoint honours the flag.
- **Vercel's IPs get rejected** by these sites at random. Retry once before concluding a tag is empty, and cache aggressively.
- **Send a descriptive User-Agent** on every one of these — they are free services being asked for a favour.
- **An empty gallery hides its cause.** `/api/gallery` reports per-source counts in `sources`, and `{"debug":true}` in the request body echoes the upstream error body — that is what surfaced the Serper credit message in the first place.
- Serper-specific, until the branch is deleted: **`num` must be a multiple of ten**, and **`filetype:gif` inside `q` does nothing** — Google Images reads it as a literal keyword; image filters travel in `tbs` (`itp:animated`, `ift:gif`).

## 5. Verifying after any change

```bash
curl -s -X POST https://waifu100.vercel.app/api/gallery \
  -H "content-type: application/json" \
  --data '{"characterName":"Eru Chitanda","animeSource":"Hyouka","isGif":true,"debug":true}'
```

Chitanda is the useful test case: Konachan has nothing animated for her, so a non-empty GIF result means the new sources are genuinely carrying the feature rather than Serper quietly doing the work.
