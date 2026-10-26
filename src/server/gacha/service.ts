/**
 * Gacha Guess operations. Server-authoritative: coins, guesses, hints and pulls
 * only change here, under the profile lock, and the client only ever sees the
 * DTOs below - which never carry the answer before the round is over.
 */
import { createHash, randomInt } from "node:crypto";
import { GachaConfigError, resolveDailySalt } from "./config";
import { hintImageUrl, readHintImageToken, type HintImageRef } from "./hint-image";
import { getCatalog, type CatalogAnime, type CatalogCharacter, type CatalogIndex } from "./catalog";
import {
    bangkokDayKey, cardNumber, dailyPick, dayNumber, DAILY_COINS, epochDay, fastBonus,
    HINT_SLOTS, hintLadder, hintValue, isEmptySlot, MAX_GUESSES, missingHints, nextBuyableSlot, openHintCount, pullResult, START_COINS, storyUnlocked,
    secondsUntilNextBangkokDay, streak, tierForGuesses, type HintKey, type HintValue, type PullResult, type Tier,
} from "./rules";
import { defaultGachaStore, KEEP_ROUND_DAYS, withProfileLock, type GachaProfile, type GachaRound, type GachaStore } from "./store";

// ---- errors -----------------------------------------------------------------

export { GachaConfigError };

export type GachaErrorCode =
    | "create_limited"
    | "no_profile"
    | "invalid_character"
    | "already_guessed"
    | "round_over"
    | "no_hint"
    | "not_enough_coins"
    | "hint_out_of_order"
    | "story_locked";

const STATUS: Record<GachaErrorCode, number> = {
    create_limited: 429,
    no_profile: 404,
    invalid_character: 400,
    already_guessed: 409,
    round_over: 409,
    no_hint: 409,
    not_enough_coins: 409,
    hint_out_of_order: 409,
    story_locked: 409,
};

export class GachaError extends Error {
    readonly status: number;
    constructor(readonly code: GachaErrorCode) {
        super(code);
        this.status = STATUS[code];
    }
}

// ---- dependencies (test seam, like configureModeration) ---------------------

interface Deps {
    store: GachaStore;
    now: () => number;
    salt: () => string;
}

let overrides: Partial<Deps> = {};

/** Swap the store / clock / salt; call with nothing to go back to the defaults. */
export function configureGacha(next?: Partial<Deps>): void {
    overrides = next ?? {};
}

/**
 * The salt is resolved up front, before the store is touched, so a deployment
 * without DAILY_SALT fails every operation closed (GachaConfigError -> 503).
 */
function deps(): Deps {
    const salt = (overrides.salt ?? resolveDailySalt)();
    return {
        store: overrides.store ?? defaultGachaStore(),
        now: overrides.now ?? Date.now,
        salt: () => salt,
    };
}

// ---- DTOs -------------------------------------------------------------------

export interface CardDto {
    id: number;
    name: string;
    nameNative: string | null;
    image: string;
    animeId: number;
    setCode: string;
    /** Position within its anime, "001".. */
    number: string;
    tier: Tier | null;
    /** Printed in the card's text box. Real catalog fields only; null when AniList has none. */
    role: "MAIN" | "SUPPORTING";
    occupation: string | null;
    gender: string | null;
    favourites: number;
    animeTitle: string;
    coverColor: string | null;
}

export interface RoundDto {
    day: { key: string; number: number };
    anime: {
        id: number;
        titleRomaji: string;
        titleEnglish: string | null;
        titleNative: string | null;
        cover: string;
        coverColor: string | null;
        setCode: string;
        characterCount: number;
    };
    /** Autocomplete pool. Deliberately no images: that would make the guess a picture match. */
    candidates: { id: number; name: string; nameNative: string | null; alternative: string[] }[];
    maxGuesses: number;
    guesses: { id: number; name: string; image: string; correct: boolean }[];
    hints: {
        /** Always HINT_SLOTS (5): the ladder has the same length for every answer. */
        slots: number;
        /** Values of the open real hints, in ladder order: slots 1..open.length. */
        open: HintValue[];
        /**
         * Open slots with no data, right after `open` (empty slots are always last,
         * so this is 0 until every real hint is open).
         */
        empty: number;
        /**
         * HINT_ORDER kinds this character has no data for, labelling the empty slots.
         * Empty until every slot is open or the round is over, so neither the kinds
         * nor the number of real hints are sent early (P3: hint-count leak).
         */
        missing: HintKey[];
        /** Slots still closed: slots - open.length - empty. */
        locked: number;
        /** The only slot the player can buy (strict ladder order) and its slot-indexed price. */
        next: { slot: number; price: number; affordable: boolean } | null;
    };
    coins: number;
    streak: number;
    /** Coins this day's round granted on creation. */
    dailyCoins: number;
    done: "won" | "lost" | null;
    result: {
        answer: CardDto;
        pull: { result: PullResult; prevTier: Tier | null; tier: Tier } | null;
        storyUnlockedNow: boolean;
        bonus: number;
        /** Characters of this anime in the player's album now. */
        ownedInAnime: number;
    } | null;
}

export interface AlbumDto {
    coins: number;
    streak: number;
    owned: number;
    total: number;
    anime: {
        id: number;
        titleRomaji: string;
        titleEnglish: string | null;
        titleNative: string | null;
        cover: string;
        coverColor: string | null;
        setCode: string;
        owned: number;
        total: number;
        story: { unlocked: boolean; fresh: boolean };
        cards: (CardDto & { day: string })[];
    }[];
}

// ---- profile/round helpers --------------------------------------------------

function newProfile(nowMs: number): GachaProfile {
    return {
        v: 1,
        createdAt: new Date(nowMs).toISOString(),
        coins: START_COINS,
        rounds: {},
        finishedDays: [],
        collection: {},
        storySeen: [],
        recoveryHash: null,
    };
}

/** Today's round, created (with the daily coins, once) if missing. Returns whether the profile changed. */
function ensureRound(profile: GachaProfile, today: string, idx: CatalogIndex, salt: string): boolean {
    if (profile.rounds[today]) return false;
    const pick = dailyPick(idx.catalog, today, salt);
    profile.rounds[today] = {
        day: today,
        animeId: pick.animeId,
        answerId: pick.answerId,
        guesses: [],
        bought: 0,
        done: null,
        dailyCoins: DAILY_COINS,
        bonus: 0,
        pull: null,
        storyUnlockedNow: false,
    };
    profile.coins += DAILY_COINS;
    const oldest = epochDay(today) - KEEP_ROUND_DAYS;
    for (const key of Object.keys(profile.rounds)) if (epochDay(key) <= oldest) delete profile.rounds[key];
    return true;
}

function roundParts(round: GachaRound, idx: CatalogIndex): { anime: CatalogAnime; answer: CatalogCharacter } {
    const anime = idx.anime.get(round.animeId);
    const answer = anime?.characters.find((c) => c.id === round.answerId);
    // Only possible if the catalog was regenerated without this anime mid-day.
    if (!anime || !answer) throw new Error("gacha round refers to a character missing from the catalog");
    return { anime, answer };
}

function card(anime: CatalogAnime, c: CatalogCharacter, tier: Tier | null): CardDto {
    return {
        id: c.id,
        name: c.name,
        nameNative: c.nameNative,
        image: c.image,
        animeId: anime.id,
        setCode: anime.setCode,
        number: cardNumber(anime, c.id),
        tier,
        role: c.role,
        occupation: c.occupation,
        gender: c.gender,
        favourites: c.favourites,
        animeTitle: anime.titleEnglish ?? anime.titleRomaji,
        coverColor: anime.coverColor,
    };
}

function ownedIn(profile: GachaProfile, animeId: number): number {
    return Object.values(profile.collection).filter((e) => e.animeId === animeId).length;
}

function markFinished(profile: GachaProfile, day: string): void {
    if (!profile.finishedDays.includes(day)) profile.finishedDays = [...profile.finishedDays, day].sort();
}

/** Commit the win's pull. Runs once per round: the caller holds the lock and the round is not yet done. */
function commitPull(profile: GachaProfile, round: GachaRound): void {
    const tier = tierForGuesses(round.guesses.length);
    const prevTier = profile.collection[round.answerId]?.tier ?? null;
    const result = pullResult(prevTier, tier);
    const before = ownedIn(profile, round.animeId);
    if (result !== "same") profile.collection[round.answerId] = { tier, day: round.day, animeId: round.animeId };
    round.pull = { result, prevTier, tier };
    round.storyUnlockedNow = !storyUnlocked(before) && storyUnlocked(ownedIn(profile, round.animeId));
}

export function roundDto(profile: GachaProfile, round: GachaRound, idx: CatalogIndex, today: string, salt: string): RoundDto {
    const { anime, answer } = roundParts(round, idx);
    const done = round.done;
    const ladder = hintLadder(answer);
    const wrong = round.guesses.filter((g) => g !== round.answerId).length;
    const open = openHintCount(wrong, round.bought, !!done);
    const openReal = Math.min(open, ladder.length);
    const next = nextBuyableSlot(open, !!done);
    const byId = new Map(anime.characters.map((c) => [c.id, c]));

    return {
        day: { key: round.day, number: dayNumber(round.day) },
        anime: {
            id: anime.id,
            titleRomaji: anime.titleRomaji,
            titleEnglish: anime.titleEnglish,
            titleNative: anime.titleNative,
            cover: anime.cover,
            coverColor: anime.coverColor,
            setCode: anime.setCode,
            characterCount: anime.characters.length,
        },
        candidates: anime.characters.map((c) => ({ id: c.id, name: c.name, nameNative: c.nameNative, alternative: c.alternative ?? [] })),
        maxGuesses: MAX_GUESSES,
        guesses: round.guesses.flatMap((g) => {
            const c = byId.get(g);
            return c ? [{ id: c.id, name: c.name, image: c.image, correct: g === round.answerId }] : [];
        }),
        hints: {
            slots: HINT_SLOTS,
            open: ladder.slice(0, openReal).map((key) =>
                hintValue(answer, key, (kind) => hintImageUrl({ day: round.day, charId: answer.id, kind }, salt))
            ),
            empty: open - openReal,
            missing: done || open >= HINT_SLOTS ? missingHints(ladder) : [],
            locked: HINT_SLOTS - open,
            next: next ? { slot: next.slot, price: next.price, affordable: profile.coins >= next.price } : null,
        },
        coins: profile.coins,
        streak: streak(profile.finishedDays, today),
        dailyCoins: round.dailyCoins,
        done,
        result: done
            ? {
                  answer: card(anime, answer, round.pull?.tier ?? null),
                  pull: round.pull,
                  storyUnlockedNow: round.storyUnlockedNow,
                  bonus: round.bonus,
                  ownedInAnime: ownedIn(profile, anime.id),
              }
            : null,
    };
}

// ---- operations -------------------------------------------------------------

export interface GetTodayOptions {
    /**
     * Asked only when this id has no profile yet; false refuses to create one
     * (the route plugs the per-IP creation limit in here).
     */
    canCreate?: () => Promise<boolean>;
}

/** Today's round for `id`, creating the profile and/or today's round as needed. */
export async function getToday(id: string, opts: GetTodayOptions = {}): Promise<RoundDto & { created: boolean }> {
    const { store, now, salt } = deps();
    const idx = await getCatalog();
    const today = bangkokDayKey(now());

    // Fast path: the common reload needs no lock and no write.
    const existing = await store.load(id);
    const ready = existing?.rounds[today];
    if (existing && ready) return { ...roundDto(existing, ready, idx, today, salt()), created: false };

    return withProfileLock(store, id, async () => {
        let profile = await store.load(id);
        let created = false;
        if (!profile) {
            if (opts.canCreate && !(await opts.canCreate())) throw new GachaError("create_limited");
            profile = newProfile(now());
            created = true;
        }
        const changed = ensureRound(profile, today, idx, salt());
        if (changed || created) await store.save(id, profile);
        return { ...roundDto(profile, profile.rounds[today], idx, today, salt()), created };
    });
}

/** Loads the profile for a write, making sure today's round exists. Caller holds the lock. */
async function loadForWrite(store: GachaStore, id: string, today: string, idx: CatalogIndex, salt: string) {
    const profile = await store.load(id);
    if (!profile) throw new GachaError("no_profile");
    ensureRound(profile, today, idx, salt);
    return { profile, round: profile.rounds[today] };
}

export async function guess(id: string, charId: number): Promise<RoundDto> {
    const { store, now, salt } = deps();
    const idx = await getCatalog();
    const today = bangkokDayKey(now());

    return withProfileLock(store, id, async () => {
        const { profile, round } = await loadForWrite(store, id, today, idx, salt());
        if (round.done) throw new GachaError("round_over");
        const { anime } = roundParts(round, idx);
        if (!anime.characters.some((c) => c.id === charId)) throw new GachaError("invalid_character");
        if (round.guesses.includes(charId)) throw new GachaError("already_guessed");

        round.guesses.push(charId);
        if (charId === round.answerId) {
            round.done = "won";
            round.bonus = fastBonus(round.guesses.length);
            profile.coins += round.bonus;
            // The pull is committed here, with the win, in the same write - so a
            // reload or a second tab reads it back instead of pulling again.
            commitPull(profile, round);
            markFinished(profile, today);
        } else if (round.guesses.length >= MAX_GUESSES) {
            round.done = "lost";
            markFinished(profile, today);
        }
        await store.save(id, profile);
        return roundDto(profile, round, idx, today, salt());
    });
}

/**
 * Buys the next closed slot of today's ladder at its slot price. Strict ladder
 * order: there is no way to name a kind, and `slot` (1-based, optional for
 * older clients) must be exactly the next closed slot, so a retried or stale
 * request is refused instead of buying a further slot.
 *
 * An empty ("no data") slot opens like any other but costs nothing net: the
 * price is checked and charged like any slot (so affordability says nothing
 * about the slot) and refunded in the same locked write. Coins can therefore
 * never go up here, and each slot can be bought at most once.
 */
export async function buyHint(id: string, slot?: number): Promise<RoundDto> {
    const { store, now, salt } = deps();
    const idx = await getCatalog();
    const today = bangkokDayKey(now());

    return withProfileLock(store, id, async () => {
        const { profile, round } = await loadForWrite(store, id, today, idx, salt());
        if (round.done) throw new GachaError("round_over");
        const { answer } = roundParts(round, idx);
        const wrong = round.guesses.filter((g) => g !== round.answerId).length;
        const open = openHintCount(wrong, round.bought, false);
        const next = nextBuyableSlot(open, false);
        if (!next) throw new GachaError("no_hint");
        if (slot !== undefined && slot !== next.slot) throw new GachaError("hint_out_of_order");
        if (profile.coins < next.price) throw new GachaError("not_enough_coins");

        profile.coins -= next.price;
        if (isEmptySlot(hintLadder(answer), open)) {
            profile.coins += next.price;
            round.refunded = (round.refunded ?? 0) + next.price;
        }
        round.bought += 1;
        await store.save(id, profile);
        return roundDto(profile, round, idx, today, salt());
    });
}

function storyFresh(profile: GachaProfile): number[] {
    const animeIds = new Set(Object.values(profile.collection).map((e) => e.animeId));
    return [...animeIds].filter((a) => storyUnlocked(ownedIn(profile, a)) && !profile.storySeen.includes(a));
}

/**
 * The album. Read-only: loading it never changes the profile, so a double
 * render (React StrictMode, a retry, a prefetch) cannot use up the "new story
 * card" mark. A story card stays `fresh` until the player taps it, which calls
 * markStorySeen.
 */
export async function getAlbum(id: string): Promise<AlbumDto> {
    const { store, now } = deps();
    const idx = await getCatalog();
    const today = bangkokDayKey(now());

    const profile = await store.load(id);
    const fresh = profile ? storyFresh(profile) : [];

    let total = 0;
    for (const a of idx.catalog.anime) total += a.characters.length;
    if (!profile) return { coins: 0, streak: 0, owned: 0, total, anime: [] };

    const groups = new Map<number, AlbumDto["anime"][number]>();
    for (const [charKey, entry] of Object.entries(profile.collection)) {
        const anime = idx.anime.get(entry.animeId);
        const c = anime?.characters.find((x) => x.id === Number(charKey));
        if (!anime || !c) continue; // dropped from a regenerated catalog
        let g = groups.get(anime.id);
        if (!g) {
            g = {
                id: anime.id,
                titleRomaji: anime.titleRomaji,
                titleEnglish: anime.titleEnglish,
                titleNative: anime.titleNative,
                cover: anime.cover,
                coverColor: anime.coverColor,
                setCode: anime.setCode,
                owned: 0,
                total: anime.characters.length,
                story: { unlocked: false, fresh: false },
                cards: [],
            };
            groups.set(anime.id, g);
        }
        g.cards.push({ ...card(anime, c, entry.tier), day: entry.day });
        g.owned += 1;
    }

    const anime = [...groups.values()];
    for (const g of anime) {
        g.cards.sort((a, b) => a.number.localeCompare(b.number));
        g.story = { unlocked: storyUnlocked(g.owned), fresh: fresh.includes(g.id) };
    }
    const latest = (g: AlbumDto["anime"][number]) => g.cards.reduce((m, c) => (c.day > m ? c.day : m), "");
    anime.sort((a, b) => latest(b).localeCompare(latest(a)) || a.id - b.id);

    return {
        coins: profile.coins,
        streak: streak(profile.finishedDays, today),
        owned: anime.reduce((n, g) => n + g.owned, 0),
        total,
        anime,
    };
}

/**
 * The player tapped an unlocked story card: stop showing it as new. Idempotent
 * (a second tap, a retried request or a second tab is a no-op). Refuses an
 * anime whose story card is not unlocked, so the list only holds real unlocks.
 */
export async function markStorySeen(id: string, animeId: number): Promise<{ animeId: number; fresh: false }> {
    const { store } = deps();
    return withProfileLock(store, id, async () => {
        const p = await store.load(id);
        if (!p) throw new GachaError("no_profile");
        if (p.storySeen.includes(animeId)) return { animeId, fresh: false as const };
        if (!storyFresh(p).includes(animeId)) throw new GachaError("story_locked");
        p.storySeen = [...p.storySeen, animeId];
        await store.save(id, p);
        return { animeId, fresh: false as const };
    });
}

// ---- recovery codes ---------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_CHARS = 12; // 12 x 5 bits = 60 bits

/** XXXX-XXXX-XXXX from 60 bits of crypto randomness. */
export function generateRecoveryCode(): string {
    let s = "";
    for (let i = 0; i < CODE_CHARS; i++) s += CROCKFORD[randomInt(32)];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Canonical XXXX-XXXX-XXXX for anything a person might type, or null. Crockford: O->0, I/L->1. */
export function normalizeRecoveryCode(input: unknown): string | null {
    if (typeof input !== "string" || input.length > 40) return null;
    const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    if (s.length !== CODE_CHARS || [...s].some((ch) => !CROCKFORD.includes(ch))) return null;
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function hashRecoveryCode(canonical: string): string {
    return createHash("sha256").update(canonical).digest("hex");
}

/** Creates (or rotates: the old code stops working) this profile's recovery code. */
export async function mintRecovery(id: string): Promise<{ code: string }> {
    const { store } = deps();
    return withProfileLock(store, id, async () => {
        const profile = await store.load(id);
        if (!profile) throw new GachaError("no_profile");
        const code = generateRecoveryCode();
        const hash = hashRecoveryCode(code);
        const old = profile.recoveryHash;
        await store.setRecovery(hash, id);
        profile.recoveryHash = hash;
        await store.save(id, profile);
        if (old && old !== hash) await store.deleteRecovery(old);
        return { code };
    });
}

/** The profile id a recovery code belongs to, or null. */
export async function restore(code: unknown): Promise<string | null> {
    const { store } = deps();
    const canonical = normalizeRecoveryCode(code);
    if (!canonical) return null;
    const hash = hashRecoveryCode(canonical);
    const id = await store.getRecovery(hash);
    if (!id) return null;
    const profile = await store.load(id);
    // A rotated code is deleted, but check anyway: only the current code restores.
    return profile && profile.recoveryHash === hash ? id : null;
}

// ---- hint images -------------------------------------------------------------

/**
 * Resolves a /api/gacha/hint-image token to the art it stands for. Tokens are
 * valid for the Bangkok day they were minted on only: anything else (another
 * day's token, a forged or edited token, a character no longer in the catalog)
 * is null. The art URL stays on the server. `expiresInSec` is how long until
 * the token stops working, so caches never outlive it.
 */
export async function resolveHintImage(token: unknown): Promise<(HintImageRef & { artUrl: string; expiresInSec: number }) | null> {
    const { now, salt } = deps();
    const nowMs = now();
    const today = bangkokDayKey(nowMs);
    const ref = readHintImageToken(token, salt(), today);
    if (!ref) return null;
    const hit = (await getCatalog()).characters.get(ref.charId);
    if (!hit?.character.image) return null;
    return { ...ref, artUrl: hit.character.image, expiresInSec: secondsUntilNextBangkokDay(nowMs) };
}
