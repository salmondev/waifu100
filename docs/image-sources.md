# Image Sources: Reducing the Serper Dependency

**Status:** planned, not implemented
**Written:** 2026-09-04
**Trigger:** GIF mode returned nothing in production; the root cause turned out to be a Serper account with no credits left, shared across several projects.

---

## 1. Why this document exists

`/api/gallery` fans out to three sources in parallel. In production on 2026-09-03 they looked like this:

| Source | State | Notes |
|---|---|---|
| Serper (Google Images) | **broken** | `{"message":"Not enough credits","statusCode":400}` on every call, GIF or not |
| Jikan (MyAnimeList) | **down** | `504` on every character query, verified directly against `api.jikan.moe` |
| Konachan | working, thin | intermittent `403` from Vercel's shared IPs; very few animations per character |

Serper is the only source with broad coverage, so when its credits run out the gallery silently degrades to whatever Konachan happens to have. GIF mode degrades to nothing at all. The goal here is to make Serper an *enhancement* rather than the load-bearing source.

## 2. Measured alternatives

All numbers below were measured against the live APIs on 2026-09-03/04, not taken from documentation.

### 2.1 Safebooru — best value, no API key

```
https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=20&tags=<tags>
```

| tags | result |
|---|---|
| `chitanda_eru animated` | 15 posts, **all 15 are .gif** |
| `megumin animated` | 8 posts, all .gif |
| `hatsune_miku animated` | 20 posts, 5 .gif (rest are .webm) |
| `chitanda_eru` | 20 posts, 0 .gif |

For comparison, Konachan returns **0** posts for `chitanda_eru animated` — the character that motivated this whole investigation.

Response fields: `file_url`, `sample_url`, `preview_url`, `image`, `directory`, `tags`, `rating`.

**Tag naming is solved by the tag endpoint.** Booru sites tag characters surname-first (`chitanda_eru`), while the app holds display names (`Eru Chitanda`). Rather than guessing the order:

```
https://safebooru.org/index.php?page=dapi&s=tag&q=index&name_pattern=%chitanda%&orderby=count
```

```xml
<tag type="0" count="1"    name="chitandaneko"/>
<tag type="0" count="6"    name="chitanda_eru_(cosplay)"/>
<tag type="4" count="2179" name="chitanda_eru"/>   <!-- type 4 = character -->
```

Take `type="4"` with the highest `count`. Note this endpoint answers in **XML even with `json=1`**, unlike the post endpoint — parse accordingly, or match with a small regex.

### 2.2 AniList GraphQL — replacement for Jikan, no API key

```graphql
query($s:String){ Page(perPage:5){ characters(search:$s){ id name{full} image{large} } } }
```

`POST https://graphql.anilist.co` returned Eru Chitanda's official portrait immediately while Jikan was returning 504s. Static art only — no use for GIF mode.

### 2.3 If Google results are still wanted

| Option | Free allowance | Trade-off |
|---|---|---|
| Google Programmable Search JSON API | ~100 queries/day, then ~$5/1000 | Official and rule-abiding. Needs a CSE with "search the entire web" enabled. Supports `searchType=image` and `fileType=gif` directly — the closest drop-in for Serper. |
| Brave Search API | ~2,000 queries/month | Smaller index than Google, but has a proper image endpoint. |
| Self-hosted SearXNG | unlimited | The real "do it ourselves" answer: one Docker container, JSON output, `categories=images`. It is a scraper, so expect periodic CAPTCHAs from Google, dead engines to prune, and extra latency. |

Allowances shift — re-check the provider pages before committing to one.

**Run scrapers from the home server, not Vercel.** Vercel's outbound IPs are shared and already get rejected by Konachan (`http-403` observed). A SearXNG instance on the home box behind a Cloudflare Tunnel avoids that entirely, at the cost of the app depending on that box being up.

## 3. Plan

Ordered by value per unit of work.

1. **Add Safebooru as the primary GIF source.**
   - Resolve the character tag through the tag endpoint (cache the mapping — tags never change).
   - Query `<tag> animated`, keep only `.gif` (`.webm` cannot be dropped into the grid).
   - Fall back to the series tag when the character tag has nothing, mirroring the existing Konachan behaviour.
2. **Add AniList as a fallback for Jikan** on the official-art path, and reuse the same tag/name resolution.
3. **Demote Serper to an enhancement.** It already fails soft; what is missing is that nothing else covers GIF mode when it is down. Steps 1–2 fix that.
4. **Optional, only if Google results are genuinely missed:** Google CSE for a legitimate 100/day, or SearXNG on the home server for unlimited-but-maintained.

## 4. Things not to re-learn the hard way

- **`num` must be a multiple of ten** for Serper, mirroring Google's pagination. The sibling route `/api/serper-images` uses 20; `/api/gallery` now does too.
- **`filetype:gif` inside `q` does nothing** on Google Images — it is read as a literal keyword. Image filters travel in `tbs` (`itp:animated`, `ift:gif`).
- **Konachan tags animations as `animated`,** not `gif` (a single safe post site-wide) and not `animated_gif` (does not exist).
- **A `.gif` URL test must ignore query strings,** and Tenor/Giphy/gfycat serve animations under `.webp`/`.mp4` URLs that never end in `.gif`.
- **Booru results are not all images.** `.webm`/`.mp4` posts come back from the same `animated` tag and have to be filtered out.
- **Rating filters cost a tag slot.** Konachan accepts `name animated rating:safe`; Safebooru is already SFW-only, so no slot is needed there.
- **An empty gallery hides its cause.** `/api/gallery` reports per-source counts in `sources`, and `{"debug":true}` in the request body echoes the upstream error body — that is what surfaced the Serper credit message.

## 5. Verifying after any change

```bash
curl -s -X POST https://waifu100.vercel.app/api/gallery \
  -H "content-type: application/json" \
  --data '{"characterName":"Eru Chitanda","animeSource":"Hyouka","isGif":true,"debug":true}'
```

`sources.serper` as a number means Serper is answering; `http-400` with `serperError` means credits again. `sources.fanart` covers the booru path.
