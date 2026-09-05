"use client";

import type {
    CharacterAlternative,
    CharacterProfile,
} from "@/lib/character-profile";

/**
 * The browser's side of the profile card.
 *
 * Three things happen here, all of them about the wait between tapping a face
 * and reading about them:
 *
 * 1. Answers are remembered for the session. The same character appears in
 *    several places on one page - a grid, a compare column, the series modal -
 *    and re-opening the card used to repeat the whole round trip every time.
 * 2. Requests for the same name are shared. A prefetch on hover followed by a
 *    tap is one request, not two.
 * 3. The Thai text is fetched separately from the profile. A character nobody
 *    has opened before needs a Gemini call, which is seconds; asking for both
 *    in one request meant the card sat on a skeleton for all of it. Now the
 *    profile paints as soon as AniList answers, in English, and the Thai
 *    replaces it when it arrives.
 *
 * The cache key is the name *and* the grid's source, never the name alone -
 * the same mistake in the server's cache is what let one wrong lookup describe
 * every character sharing that name.
 */

export interface LoadedCharacter {
    profile: CharacterProfile | null;
    th: string | null;
    /** A Thai version is possible but has not been paid for yet. */
    translatable: boolean;
    /** "low": several characters share this name and nothing chose between them. */
    confidence: "high" | "low";
    alternatives: CharacterAlternative[];
    /** AniList fell short; a web lookup is worth one background request. */
    enrichable: boolean;
    /** Sites the text came from, when it did not come from AniList. */
    webSources: string[];
}

export interface CharacterQuery {
    name: string;
    source?: string | null;
    /** Set when the reader picked a specific character from the alternatives. */
    id?: number | null;
}

const cache = new Map<string, LoadedCharacter>();
const inFlight = new Map<string, Promise<LoadedCharacter>>();
/** Queries whose translation has already been asked for, once per session. */
const translating = new Set<string>();
/** Same, for the web lookup - both spend a metered account per new character. */
const researching = new Set<string>();

/**
 * What makes two lookups the same lookup. Exported because the card resets its
 * state when this changes - picking "the other Rin" has to clear the first
 * Rin's text, and nothing else distinguishes the two.
 */
export function characterKey(query: CharacterQuery): string {
    if (query.id) return `id:${query.id}`;
    return `${query.name.trim().toLowerCase()}|${(query.source ?? "").trim().toLowerCase()}`;
}

const key = characterKey;

/** The extra work a request may ask the server to do before answering. */
type Job = "translate" | "enrich" | null;

function url(query: CharacterQuery, job: Job): string {
    const params = new URLSearchParams({ lang: "th" });
    if (query.id) params.set("id", String(query.id));
    if (query.name) params.set("name", query.name);
    if (query.source) params.set("source", query.source);
    if (job === "translate") params.set("translate", "1");
    if (job === "enrich") params.set("enrich", "1");
    return `/api/character?${params.toString()}`;
}

async function request(query: CharacterQuery, job: Job): Promise<LoadedCharacter> {
    const res = await fetch(url(query, job));
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    return {
        profile: body?.profile ?? null,
        th: body?.th ?? null,
        translatable: !!body?.translatable,
        confidence: body?.confidence === "low" ? "low" : "high",
        alternatives: Array.isArray(body?.alternatives) ? body.alternatives : [],
        enrichable: !!body?.enrichable,
        webSources: Array.isArray(body?.webSources) ? body.webSources : [],
    };
}

/* -------------------------------------------------------------------------- */
/* Session storage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The same characters get opened across page loads - browse the showcase, open
 * a grid, open another - and an in-memory map forgets all of it on every
 * navigation. sessionStorage makes the second open free even then.
 *
 * Bounded and disposable on purpose: it is a latency trick, not a source of
 * truth, and every read is guarded because a private window can throw on
 * access rather than merely come back empty.
 */
const STORE_KEY = "waifu100:profiles:v1";
const STORE_LIMIT = 120;

function loadStore(): Record<string, LoadedCharacter> {
    if (typeof sessionStorage === "undefined") return {};
    try {
        return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
    } catch {
        return {};
    }
}

function persist(k: string, value: LoadedCharacter): void {
    if (typeof sessionStorage === "undefined") return;
    try {
        const store = loadStore();
        store[k] = value;
        const keys = Object.keys(store);
        // Oldest-inserted first: JSON objects keep insertion order, which is
        // all the eviction policy this needs.
        for (const stale of keys.slice(0, Math.max(0, keys.length - STORE_LIMIT))) {
            delete store[stale];
        }
        sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
        // Full, blocked, or unavailable - the memory cache still works.
    }
}

let restored = false;

function restore(): void {
    if (restored) return;
    restored = true;
    for (const [k, value] of Object.entries(loadStore())) {
        if (!cache.has(k)) cache.set(k, value);
    }
}

function remember(k: string, value: LoadedCharacter): void {
    cache.set(k, value);
    // Only a finished answer is worth carrying to the next page.
    if (!value.translatable && !value.enrichable) persist(k, value);
}

/** What is already known about a query, without asking for anything. */
export function cachedCharacter(query: CharacterQuery): LoadedCharacter | undefined {
    restore();
    return cache.get(key(query));
}

/** The profile and whatever Thai already exists. Cached for the session. */
export function loadCharacter(query: CharacterQuery): Promise<LoadedCharacter> {
    restore();
    const k = key(query);

    const hit = cache.get(k);
    if (hit) return Promise.resolve(hit);

    const pending = inFlight.get(k);
    if (pending) return pending;

    const promise = request(query, null)
        .then((loaded) => {
            remember(k, loaded);
            return loaded;
        })
        .finally(() => {
            inFlight.delete(k);
        });

    inFlight.set(k, promise);
    return promise;
}

/**
 * Asks for the Thai translation, which costs a Gemini call and so is only ever
 * requested once per character per session. Resolves to null when there is
 * nothing to add - already translated, not translatable, or the call did not
 * land.
 */
export async function translateCharacter(query: CharacterQuery): Promise<string | null> {
    const k = key(query);
    if (translating.has(k)) return null;
    translating.add(k);

    try {
        const loaded = await request(query, "translate");
        if (loaded.th) remember(k, loaded);
        return loaded.th;
    } catch {
        // The card keeps the English it is already showing.
        translating.delete(k);
        return null;
    }
}

/**
 * Asks the server to search the web for a character AniList could not place -
 * the usual case for game characters, which it does not index.
 *
 * A second request rather than part of the first, for the same reason the
 * translation is: it costs a search and a generation. The card is already on
 * screen saying what little it knows when this comes back.
 */
export async function enrichCharacter(query: CharacterQuery): Promise<LoadedCharacter | null> {
    const k = key(query);
    if (researching.has(k)) return null;
    researching.add(k);

    try {
        const loaded = await request(query, "enrich");
        remember(k, loaded);
        return loaded;
    } catch {
        researching.delete(k);
        return null;
    }
}

/**
 * Starts the lookup before it is needed - on hover, or the moment a cell is
 * selected and the card is one tap away. Failures are ignored on purpose: a
 * prefetch that does not land simply means the tap pays for it instead.
 */
export function prefetchCharacter(query: CharacterQuery): void {
    if (!query?.name?.trim() && !query?.id) return;
    void loadCharacter(query).catch(() => {});
}
