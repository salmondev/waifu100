#!/usr/bin/env node
// Build-time content pipeline for Gacha Guess.
// Queries the public AniList GraphQL API and writes server-only data:
//   src/server/gacha/catalog.json       (anime + characters, no descriptions)
//   src/server/gacha/catalog-gaps.json  (coverage counts)
// Usage: node scripts/gacha/build-catalog.mjs [--refresh-anime] [--cache <dir>]
//   (Node 20+, no deps, no env vars). By default the anime list and card set of
//   the committed catalog.json are kept (so players' albums keep their cards) and
//   only the guess roster + feedback fields are (re)fetched; --refresh-anime
//   rebuilds the anime list and card set from scratch first.
// See scripts/gacha/README.md for rate limits, licence/credit and known gaps.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://graphql.anilist.co";
const MIN_INTERVAL_MS = 2500; // AniList degraded limit is 30 req/min
const MAX_TRIES = 5;
const TARGET_ANIME = 150;
const PAGE_SIZE = 50;
const MAX_PAGES = 12;
const MIN_CHARS = 6;
const MAX_CHARS = 10;
const MAX_BYTES = 700 * 1024;
// Guess roster (Wordle-style "allowed guesses", the answer pool stays the card set):
// popular characters with favourites >= ROSTER_MIN_FAV, at most ROSTER_MAX, at least ROSTER_MIN.
const ROSTER_MIN_FAV = 50;
const ROSTER_MAX = 20;
const ROSTER_MIN = 8;
const ROSTER_FETCH_PAGES = 3; // pages of 25 searched for card characters missing from the top page

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "src/server/gacha");
const CATALOG_FILE = path.join(OUT_DIR, "catalog.json");
const GAPS_FILE = path.join(OUT_DIR, "catalog-gaps.json");

const IMAGE_NOTE =
  "Character images are AniList image.large (max 230x345, the largest official size AniList offers for characters); " +
  "anime covers are coverImage.extraLarge (fallback large). Images (c) their respective rights holders; " +
  "data from AniList (anilist.co) and must be shown with AniList credit.";

// ---------------------------------------------------------------- network

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
let requestCount = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function gql(query, variables) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    await throttle();
    requestCount++;
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      lastErr = err;
      await backoff(attempt, `network error (${err?.name ?? "Error"})`);
      continue;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
      console.log(`[gacha] 429 rate limited, waiting ${waitS}s (try ${attempt}/${MAX_TRIES})`);
      lastErr = new Error("HTTP 429");
      await sleep(waitS * 1000 + 500);
      continue;
    }
    let body = null;
    try { body = await res.json(); } catch { /* handled below */ }
    if (!res.ok || !body || body.errors?.length) {
      lastErr = new Error(`HTTP ${res.status}${body?.errors?.length ? ` (${body.errors.length} GraphQL errors)` : ""}`);
      await backoff(attempt, lastErr.message);
      continue;
    }
    return body.data;
  }
  throw lastErr ?? new Error("request failed");
}

async function backoff(attempt, why) {
  if (attempt >= MAX_TRIES) return;
  const ms = 5000 * 2 ** (attempt - 1);
  console.log(`[gacha] ${why}, retrying in ${ms / 1000}s (try ${attempt}/${MAX_TRIES})`);
  await sleep(ms);
}

// ---------------------------------------------------------------- queries

const ANIME_PAGE_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      id format popularity siteUrl
      title { romaji english native }
      coverImage { extraLarge large color }
      relations { edges { relationType(version: 2) node { id type format } } }
    }
  }
}`;

const CHARACTERS_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    characters(sort: [ROLE, FAVOURITES_DESC], perPage: 25) {
      edges {
        role
        node {
          id gender age favourites siteUrl description
          name { full native alternative }
          image { large }
        }
      }
    }
  }
}`;

// ---------------------------------------------------------------- franchise filter

const ROOT_FORMATS = new Set(["TV", "MOVIE", "ONA"]);
// Relations to an already-kept anime that mean "same franchise".
const SAME_FRANCHISE = new Set(["PREQUEL", "PARENT", "SEQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE"]);

function franchiseSkip(media, seenIds, keptIds) {
  if (media.format === "MUSIC") return "music";
  for (const e of media.relations?.edges ?? []) {
    const n = e.node;
    if (!n || n.type !== "ANIME") continue;
    if ((e.relationType === "PREQUEL" || e.relationType === "PARENT") && (seenIds.has(n.id) || ROOT_FORMATS.has(n.format))) {
      return "not root";
    }
    if (SAME_FRANCHISE.has(e.relationType) && keptIds.has(n.id)) return "related to kept";
  }
  return null;
}

// ---------------------------------------------------------------- set codes

const STOPWORDS = new Set(["THE", "A", "AN", "OF", "NO", "WA", "GA", "TO", "NI", "DE", "WO", "AND"]);

function setCodeCandidates(title) {
  const words = title
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z\s]/g, " ")
    .split(/\s+/).filter(Boolean);
  const sig = words.filter((w) => !STOPWORDS.has(w));
  const w = sig.length ? sig : words.length ? words : ["X"];
  const out = [];
  if (w.length >= 3) out.push(w[0][0] + w[1][0] + w[2][0]);
  if (w.length >= 2) {
    if (w[1].length >= 2) out.push(w[0][0] + w[1].slice(0, 2));
    if (w[0].length >= 2) out.push(w[0].slice(0, 2) + w[1][0]);
  }
  if (w[0].length >= 3) out.push(w[0].slice(0, 3));
  const letters = w.join("");
  const first = letters[0];
  const rest = letters.slice(1);
  const consonants = rest.replace(/[AEIOU]/g, "");
  if (consonants.length >= 2) out.push(first + consonants.slice(0, 2));
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) out.push(first + rest[i] + rest[j]);
  }
  const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of AZ) for (const b of AZ) out.push(first + a + b);
  return out;
}

function assignSetCode(title, used) {
  for (const c of setCodeCandidates(title)) {
    if (c.length === 3 && !used.has(c)) { used.add(c); return c; }
  }
  throw new Error("set codes exhausted");
}

// ---------------------------------------------------------------- description parsing

const stripSpoilers = (s) => s.replace(/~![\s\S]*?!~/g, " ");

function stripMarkdown(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[_*`~#>]+/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Structured "Label: value" fields. Spoiler blocks are removed first, so a value that sits
// entirely inside ~!...!~ disappears and partially spoiled values lose the spoiler part.
function parseFields(description) {
  const fields = new Map();
  if (!description) return fields;
  const text = stripSpoilers(description).replace(/<br\s*\/?>/gi, "\n");
  const add = (label, value) => {
    const key = label.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
    const v = stripMarkdown(value).replace(/^[:\-\s]+/, "").replace(/[,;.\s]+$/, "").trim();
    if (key && v && !fields.has(key)) fields.set(key, v);
  };
  for (const line of text.split(/\n/)) {
    // Bold labels: __Label:__ value  /  **Label:** value  /  __Label__: value (several may share a line)
    const bold = /(?:__|\*\*)\s*([A-Za-z][A-Za-z /]{0,30}?)\s*(?::\s*(?:__|\*\*)|(?:__|\*\*)\s*:)/g;
    const hits = [...line.matchAll(bold)];
    if (hits.length) {
      hits.forEach((m, i) => {
        const end = i + 1 < hits.length ? hits[i + 1].index : line.length;
        add(m[1], line.slice(m.index + m[0].length, end));
      });
      continue;
    }
    // Plain "Label: value" at the start of a line
    const plain = /^\s*([A-Za-z][A-Za-z /]{0,30}?)\s*:\s*(.+)$/.exec(line);
    if (plain) add(plain[1], plain[2]);
  }
  return fields;
}

const pick = (fields, labels) => {
  for (const l of labels) if (fields.has(l)) return fields.get(l);
  return null;
};

const HAIR_LABELS = ["hair color", "hair colour", "hair colors", "hair colours", "hair"];
const OCCUPATION_LABELS = ["occupation", "position", "affiliation", "class", "race", "species"];

const HAIR_WORDS = [
  ["black", /\b(black|raven|jet)\b/],
  ["brown", /\b(brown|brunette|chestnut|hazel|chocolate)\b/],
  ["blonde", /\b(blond|blonde|golden|gold|yellow|platinum blond)\b/],
  ["red", /\b(red|crimson|scarlet|auburn|ruby|vermilion|maroon)\b/],
  ["orange", /\b(orange|ginger|copper)\b/],
  ["pink", /\b(pink|rose|magenta|salmon)\b/],
  ["purple", /\b(purple|violet|lavender|lilac|indigo)\b/],
  ["blue", /\b(blue|navy|azure|cyan|teal|aqua|turquoise)\b/],
  ["green", /\b(green|emerald|mint|lime)\b/],
  ["white", /\b(white|snow)\b/],
  ["silver", /\b(silver|platinum)\b/],
  ["grey", /\b(grey|gray)\b/],
];
const MULTI = /\b(multi-?colou?r(ed)?|two-?tone[d]?|rainbow|ombre|gradient|streak(s|ed)?|highlights?|tips?)\b/;

function normaliseHair(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\([^)]*\)/g, " ");
  if (MULTI.test(s)) return "multicolour";
  const found = [];
  for (const [name, re] of HAIR_WORDS) {
    const m = re.exec(s);
    if (m) found.push([m.index, name]);
  }
  if (!found.length) return null;
  // "platinum blond" counts as blonde only
  const names = [...new Set(found.sort((a, b) => a[0] - b[0]).map((f) => f[1]))];
  if (names.length === 2 && names.includes("blonde") && names.includes("silver") && /platinum blond/.test(s)) return "blonde";
  return names.length > 1 ? "multicolour" : names[0];
}

// Prose fallback: "long pink hair", "silver-haired". Only the first such phrase in the spoiler-free
// description counts, and only when the colour word is at most two words before "hair"/"haired".
const COLOUR_WORD = HAIR_WORDS.map(([, re]) => re.source.replace(/^\\b\(|\)\\b$/g, "")).join("|");
const PROSE_HAIR = new RegExp(`\\b(${COLOUR_WORD})((?:[\\s-]+(?!eyes?\\b)[a-z]+){0,2}?)[\\s-]+hair(?:ed)?\\b`, "i");

function proseHair(description) {
  if (!description) return null;
  const text = stripMarkdown(stripSpoilers(description)).toLowerCase();
  const m = PROSE_HAIR.exec(text);
  if (!m) return null;
  // reject "...and blue eyes hair" style chains: the in-between words may not name a colour themselves
  if (m[2] && new RegExp(`\\b(${COLOUR_WORD})\\b`).test(m[2])) return null;
  return text.slice(m.index, m.index + m[0].length).trim();
}

function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(";"), cut.lastIndexOf(" "));
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[,;\s]+$/, "");
}

function normaliseGender(g) {
  if (!g) return null;
  const s = g.trim().toLowerCase();
  if (s === "male") return "Male";
  if (s === "female") return "Female";
  if (s === "non-binary" || s === "nonbinary") return "Non-binary";
  return "other";
}

function cleanAge(a) {
  if (!a) return null;
  const s = stripMarkdown(stripSpoilers(String(a))).replace(/[-,\s]+$/, "").trim();
  return s ? s.slice(0, 40) : null;
}

const isPlaceholder = (url) => !url || /\/default\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);

function toCharacter(edge) {
  const n = edge.node;
  const fields = parseFields(n.description ?? "");
  const fieldHair = pick(fields, HAIR_LABELS);
  const prose = fieldHair ? null : proseHair(n.description ?? "");
  const hairRaw = fieldHair ?? prose;
  const occ = pick(fields, OCCUPATION_LABELS);
  const hairKey = normaliseHair(hairRaw);
  const hairText = hairRaw ? shorten(hairRaw, 60) : null;
  return {
    id: n.id,
    name: n.name?.full ?? null,
    nameNative: n.name?.native ?? null,
    alternative: (n.name?.alternative ?? []).map((x) => (x ?? "").trim()).filter(Boolean),
    gender: normaliseGender(n.gender),
    age: cleanAge(n.age),
    role: edge.role,
    favourites: n.favourites ?? 0,
    image: n.image.large,
    imageSize: "230x345",
    siteUrl: n.siteUrl,
    hair: hairKey ? { key: hairKey, raw: hairText } : null,
    // where the hair colour came from ("field" = AniList "Hair:" label, "description" = prose such as "long pink hair")
    hairSource: hairKey ? (fieldHair ? "field" : "description") : null,
    // hair text we found but could not map to a colour key (kept for the gaps report; never shown)
    hairUnparsed: hairKey ? null : hairText,
    occupation: occ ? shorten(occ, 60) : null,
    quote: null,
    silhouette: null,
  };
}

function selectCharacters(edges) {
  const usable = edges.filter((e) => e?.node?.name?.full && !isPlaceholder(e.node.image?.large));
  const main = usable.filter((e) => e.role === "MAIN");
  const supporting = usable
    .filter((e) => e.role === "SUPPORTING")
    .sort((a, b) => (b.node.favourites ?? 0) - (a.node.favourites ?? 0));
  const picked = main.slice(0, MAX_CHARS);
  for (const e of supporting) {
    if (picked.length >= MIN_CHARS) break;
    picked.push(e);
  }
  return picked.map(toCharacter);
}

// ---------------------------------------------------------------- guess roster

const ROSTER_QUERY = `
query ($id: Int, $page: Int, $sort: [CharacterSort]) {
  Media(id: $id) {
    characters(sort: $sort, page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      edges {
        role
        voiceActors(language: JAPANESE, sort: [RELEVANCE, ID]) { id name { full native } }
        node {
          id gender age favourites
          dateOfBirth { month }
          name { full native alternative }
          image { large }
        }
      }
    }
  }
}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CACHE_DIR = option("--cache");

/** gql() with an optional on-disk cache, so a re-run does not hit AniList again. */
async function cachedGql(key, query, variables) {
  const file = CACHE_DIR ? path.join(CACHE_DIR, `${key}.json`) : null;
  if (file && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const data = await gql(query, variables);
  if (file) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(data));
  }
  return data;
}

const validMonth = (m) => (Number.isInteger(m) && m >= 1 && m <= 12 ? m : null);

function voiceActor(edge) {
  const va = (edge.voiceActors ?? []).find((v) => v?.id && v.name?.full);
  return va ? { id: va.id, name: va.name.full, nameNative: va.name.native ?? null } : null;
}

/** Feedback fields for one character edge. Missing data stays null (shown as "?"). */
function feedbackFields(edge) {
  const n = edge.node;
  return {
    gender: normaliseGender(n.gender),
    age: cleanAge(n.age),
    role: edge.role ?? null,
    favourites: n.favourites ?? 0,
    birthMonth: validMonth(n.dateOfBirth?.month),
    va: voiceActor(edge),
  };
}

function rosterEntry(edge, card) {
  const n = edge.node;
  return {
    id: n.id,
    name: n.name.full,
    nameNative: n.name?.native ?? null,
    alternative: (n.name?.alternative ?? []).map((x) => (x ?? "").trim()).filter(Boolean),
    ...feedbackFields(edge),
    card,
  };
}

/**
 * The guess roster of one anime: the card characters (always, so every answer is
 * guessable) plus AniList's most-favourited characters with art, favourites >= 50,
 * capped at 20 (lowest non-card characters dropped first) and topped up to 8 from
 * the most favourited when too few reach 50. Sorted by favourites (that order is
 * the "popularity rank" feedback column).
 */
async function buildRoster(anime) {
  const cardIds = new Set(anime.characters.map((c) => c.id));
  const byId = new Map();
  const top = await cachedGql(`fav-${anime.id}-1`, ROSTER_QUERY, { id: anime.id, page: 1, sort: ["FAVOURITES_DESC"] });
  const topEdges = (top.Media?.characters?.edges ?? []).filter((e) => e?.node?.id && e.node.name?.full);
  for (const e of topEdges) byId.set(e.node.id, e);
  for (let page = 1; page <= ROSTER_FETCH_PAGES && [...cardIds].some((id) => !byId.has(id)); page++) {
    const data = await cachedGql(`role-${anime.id}-${page}`, ROSTER_QUERY, { id: anime.id, page, sort: ["ROLE", "FAVOURITES_DESC"] });
    for (const e of data.Media?.characters?.edges ?? []) if (e?.node?.id && e.node.name?.full && !byId.has(e.node.id)) byId.set(e.node.id, e);
    if (!data.Media?.characters?.pageInfo?.hasNextPage) break;
  }

  const withArt = topEdges.filter((e) => !isPlaceholder(e.node.image?.large)).sort((a, b) => (b.node.favourites ?? 0) - (a.node.favourites ?? 0));
  let extra = withArt.filter((e) => (e.node.favourites ?? 0) >= ROSTER_MIN_FAV && !cardIds.has(e.node.id));
  const popularCount = withArt.filter((e) => (e.node.favourites ?? 0) >= ROSTER_MIN_FAV).length;
  if (popularCount < ROSTER_MIN) extra = withArt.filter((e) => !cardIds.has(e.node.id)).slice(0, Math.max(0, ROSTER_MIN - cardIds.size));
  extra = extra.slice(0, Math.max(0, ROSTER_MAX - cardIds.size));

  const missingCards = [];
  const roster = [];
  for (const c of anime.characters) {
    const e = byId.get(c.id);
    if (e) roster.push(rosterEntry(e, true));
    else {
      missingCards.push(c.id);
      // Not found on AniList's media page any more: keep the card guessable with what the catalog has.
      roster.push({ id: c.id, name: c.name, nameNative: c.nameNative, alternative: c.alternative, gender: c.gender, age: c.age, role: c.role, favourites: c.favourites, birthMonth: null, va: null, card: true });
    }
  }
  for (const e of extra) roster.push(rosterEntry(e, false));
  roster.sort((a, b) => b.favourites - a.favourites || a.id - b.id);
  return { roster, missingCards };
}

/** Copies the fresh feedback fields onto the card characters, so a card and its roster entry agree. */
function enrichCards(anime, roster) {
  const byId = new Map(roster.map((r) => [r.id, r]));
  anime.characters = anime.characters.map((c) => {
    const r = byId.get(c.id);
    if (!r) return c;
    return { ...c, gender: r.gender, age: r.age, role: r.role, favourites: r.favourites, birthMonth: r.birthMonth, va: r.va };
  });
}

// ---------------------------------------------------------------- main

async function main() {
  const started = Date.now();
  if (!flag("--refresh-anime") && existsSync(CATALOG_FILE)) {
    const existing = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
    console.log(`[gacha] keeping the committed anime list and card set (${existing.anime.length} anime); pass --refresh-anime to rebuild them`);
    return finish(existing.anime, 0, started);
  }
  const seenIds = new Set();
  const keptIds = new Set();
  const kept = [];
  let skipped = 0;

  for (let page = 1; page <= MAX_PAGES && kept.length < TARGET_ANIME; page++) {
    const data = await gql(ANIME_PAGE_QUERY, { page, perPage: PAGE_SIZE });
    const media = data.Page.media ?? [];
    for (const m of media) seenIds.add(m.id);
    for (const m of media) {
      if (kept.length >= TARGET_ANIME) break;
      if (franchiseSkip(m, seenIds, keptIds)) { skipped++; continue; }
      keptIds.add(m.id);
      kept.push(m);
    }
    console.log(`[gacha] page ${page}: ${media.length} fetched, ${kept.length} kept, ${skipped} skipped`);
    if (!data.Page.pageInfo?.hasNextPage) break;
  }

  const usedCodes = new Set();
  const anime = [];
  let failed = 0;
  for (const [i, m] of kept.entries()) {
    let chars;
    try {
      const data = await gql(CHARACTERS_QUERY, { id: m.id });
      chars = selectCharacters(data.Media?.characters?.edges ?? []);
    } catch {
      failed++;
      console.log(`[gacha] characters ${i + 1}/${kept.length}: failed after ${MAX_TRIES} tries, anime skipped`);
      continue;
    }
    const title = m.title.english || m.title.romaji || m.title.native || String(m.id);
    anime.push({
      id: m.id,
      titleRomaji: m.title.romaji ?? null,
      titleEnglish: m.title.english ?? null,
      titleNative: m.title.native ?? null,
      cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
      coverColor: m.coverImage?.color ?? null,
      popularity: m.popularity ?? 0,
      setCode: assignSetCode(title, usedCodes),
      siteUrl: m.siteUrl,
      characters: chars,
    });
    if ((i + 1) % 10 === 0 || i + 1 === kept.length) {
      const total = anime.reduce((s, a) => s + a.characters.length, 0);
      console.log(`[gacha] characters ${i + 1}/${kept.length}: ${total} characters so far, ${requestCount} requests`);
    }
  }

  return finish(anime, failed, started);
}

async function finish(anime, failed, started) {
  const missingCardIds = [];
  for (const [i, a] of anime.entries()) {
    try {
      const { roster, missingCards } = await buildRoster(a);
      a.roster = roster;
      enrichCards(a, roster);
      missingCardIds.push(...missingCards);
    } catch {
      console.log(`[gacha] roster ${i + 1}/${anime.length}: failed after ${MAX_TRIES} tries; this anime keeps card-only guessing`);
      delete a.roster;
    }
    if ((i + 1) % 10 === 0 || i + 1 === anime.length) console.log(`[gacha] roster ${i + 1}/${anime.length}, ${requestCount} requests`);
  }

  const catalog = { generatedAt: new Date().toISOString(), source: "AniList GraphQL", imageNote: IMAGE_NOTE, anime };
  let json = JSON.stringify(catalog, null, 1) + "\n";
  if (Buffer.byteLength(json) > MAX_BYTES) json = JSON.stringify(catalog) + "\n";

  const chars = anime.flatMap((a) => a.characters);
  const perAnime = anime.map((a) => a.characters.length);
  const gaps = {
    generatedAt: catalog.generatedAt,
    anime: anime.length,
    animeFailed: failed,
    characters: chars.length,
    charactersPerAnime: {
      min: perAnime.length ? Math.min(...perAnime) : 0,
      max: perAnime.length ? Math.max(...perAnime) : 0,
      avg: perAnime.length ? Math.round((chars.length / perAnime.length) * 100) / 100 : 0,
    },
    missing: {
      hair: chars.filter((c) => !c.hair).length,
      hairFromDescriptionProse: chars.filter((c) => c.hair && c.hairSource === "description").length,
      hairRawButUnnormalised: chars.filter((c) => !c.hair && c.hairUnparsed).length,
      occupation: chars.filter((c) => !c.occupation).length,
      gender: chars.filter((c) => !c.gender).length,
      age: chars.filter((c) => !c.age).length,
      quote: chars.filter((c) => !c.quote).length,
      silhouette: chars.filter((c) => !c.silhouette).length,
    },
    roster: rosterGaps(anime, missingCardIds),
    animeUnderMinCharacters: anime
      .filter((a) => a.characters.length < MIN_CHARS)
      .map((a) => ({ title: a.titleEnglish || a.titleRomaji, characters: a.characters.length })),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(CATALOG_FILE, json);
  await writeFile(GAPS_FILE, JSON.stringify(gaps, null, 1) + "\n");
  console.log(`[gacha] done: ${anime.length} anime, ${chars.length} characters, ${requestCount} requests, ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`[gacha] catalog.json ${Buffer.byteLength(json)} bytes`);
}

function rosterGaps(anime, missingCardIds) {
  const entries = anime.flatMap((a) => a.roster ?? []);
  const sizes = anime.map((a) => (a.roster ?? []).length);
  const have = (pred) => entries.filter(pred).length;
  const sorted = [...sizes].sort((x, y) => x - y);
  return {
    animeWithRoster: anime.filter((a) => a.roster).length,
    entries: entries.length,
    cardEntries: have((r) => r.card),
    guessOnlyEntries: have((r) => !r.card),
    size: { min: sorted[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0, max: sorted[sorted.length - 1] ?? 0 },
    cardsNotFoundOnAniList: missingCardIds,
    // counts of entries WITH the field (of `entries`)
    has: {
      gender: have((r) => r.gender),
      role: have((r) => r.role),
      age: have((r) => r.age),
      birthMonth: have((r) => r.birthMonth),
      voiceActorJP: have((r) => r.va),
    },
  };
}

main().catch((err) => {
  console.error(`[gacha] failed: ${err?.message ?? err}`);
  process.exit(1);
});
