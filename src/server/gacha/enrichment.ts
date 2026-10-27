/**
 * T-0027 data sidecar: values that fill AniList gaps, each with provenance.
 *
 * - enrichment.json: approved values, keyed by AniList character / anime id.
 *   scripts/gacha/build-catalog.mjs merges them into catalog.json (never over an
 *   AniList value), so the game itself keeps reading only the catalog.
 * - review.json: candidates a human must approve first (low/medium confidence,
 *   and every web, agent or pronoun-inferred value).
 *
 * Server-only, like catalog.json. Validation mirrors
 * scripts/gacha/enrich/lib/provenance.mjs (a test keeps them in step).
 */

export type EnrichmentSource =
    | "anilist-normalised"
    | "anilist-desc"
    | "anilist-pronouns"
    | "derived-cover"
    | "jikan"
    | "serper"
    | "agent";

export type Confidence = "high" | "medium" | "low";

export interface Provenance {
    source: EnrichmentSource;
    /** https page the value was read from. */
    url: string;
    confidence: Confidence;
    /** ISO UTC time the source was read. */
    fetchedAt: string;
    /** The text as found, before normalising. */
    raw?: string | null;
    note?: string;
    /** Set when a human approved it in review.json. */
    reviewedAt?: string;
}

export interface Stored<T> extends Provenance {
    value: T;
}

export interface CharacterEnrichment {
    /** parseAge format: "17", "16-18", "100+". */
    ageGame?: Stored<string>;
    birthMonth?: Stored<number>;
    gender?: Stored<"Male" | "Female" | "Non-binary">;
    va?: Stored<{ id: number | null; name: string; nameNative?: string | null; malId?: number }>;
    occupation?: Stored<string>;
}

export interface AnimeEnrichment {
    coverColor?: Stored<string>;
}

export interface Enrichment {
    version: 1;
    characters: Record<string, CharacterEnrichment>;
    anime: Record<string, AnimeEnrichment>;
}

export type ReviewStatus = "pending" | "approved" | "rejected" | "merged" | "superseded";

export interface ReviewItem {
    key: string;
    kind: "character" | "anime";
    id: number;
    field: string;
    status: ReviewStatus;
    reason: string;
    candidate: Stored<unknown>;
    alternatives?: Stored<unknown>[];
    context?: Record<string, unknown>;
    addedAt: string;
    reviewedAt?: string;
    mergedAt?: string;
    note?: string;
}

export interface Review {
    version: 1;
    items: ReviewItem[];
}

export const SOURCES: readonly EnrichmentSource[] = [
    "anilist-normalised",
    "anilist-desc",
    "anilist-pronouns",
    "derived-cover",
    "jikan",
    "serper",
    "agent",
];
/** Never merged without a human approving them. */
export const REVIEW_ONLY_SOURCES: readonly EnrichmentSource[] = ["anilist-pronouns", "serper", "agent"];
const CONFIDENCE: readonly Confidence[] = ["high", "medium", "low"];
const CHARACTER_FIELDS = ["ageGame", "birthMonth", "gender", "va", "occupation"];
const ANIME_FIELDS = ["coverColor"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function provenanceErrors(where: string, v: unknown): string[] {
    if (!v || typeof v !== "object") return [`${where}: not an object`];
    const p = v as Partial<Stored<unknown>>;
    const errors: string[] = [];
    if (!SOURCES.includes(p.source as EnrichmentSource)) errors.push(`${where}: bad source`);
    if (typeof p.url !== "string" || !/^https:\/\/\S+$/.test(p.url)) errors.push(`${where}: url must be https`);
    if (!CONFIDENCE.includes(p.confidence as Confidence)) errors.push(`${where}: bad confidence`);
    if (typeof p.fetchedAt !== "string" || !ISO.test(p.fetchedAt)) errors.push(`${where}: bad fetchedAt`);
    if (!("value" in p) || p.value === null || p.value === undefined) errors.push(`${where}: missing value`);
    // a review-only value in enrichment.json must carry the human approval
    if (REVIEW_ONLY_SOURCES.includes(p.source as EnrichmentSource) && !p.reviewedAt) errors.push(`${where}: ${p.source} value without reviewedAt`);
    return errors;
}

/** Structural check of enrichment.json; returns the list of problems (empty = valid). */
export function validateEnrichment(data: unknown): string[] {
    if (!data || typeof data !== "object") return ["enrichment: not an object"];
    const e = data as Partial<Enrichment>;
    const errors: string[] = [];
    if (e.version !== 1) errors.push("enrichment: version must be 1");
    const groups: [string, unknown, string[]][] = [
        ["characters", e.characters, CHARACTER_FIELDS],
        ["anime", e.anime, ANIME_FIELDS],
    ];
    for (const [name, group, fields] of groups) {
        if (!group || typeof group !== "object") { errors.push(`enrichment.${name}: missing`); continue; }
        for (const [id, entry] of Object.entries(group as Record<string, Record<string, unknown>>)) {
            if (!/^[1-9]\d*$/.test(id)) errors.push(`enrichment.${name}.${id}: id must be an AniList id`);
            for (const [field, v] of Object.entries(entry ?? {})) {
                if (!fields.includes(field)) errors.push(`enrichment.${name}.${id}.${field}: unknown field`);
                else errors.push(...provenanceErrors(`enrichment.${name}.${id}.${field}`, v));
            }
        }
    }
    return errors;
}

/** Structural check of review.json. */
export function validateReview(data: unknown): string[] {
    if (!data || typeof data !== "object") return ["review: not an object"];
    const r = data as Partial<Review>;
    if (r.version !== 1 || !Array.isArray(r.items)) return ["review: needs version 1 and items[]"];
    const errors: string[] = [];
    const statuses: ReviewStatus[] = ["pending", "approved", "rejected", "merged", "superseded"];
    for (const [i, it] of r.items.entries()) {
        if (it.key !== `${it.kind}:${it.id}:${it.field}`) errors.push(`review.items[${i}]: key mismatch`);
        if (!statuses.includes(it.status)) errors.push(`review.items[${i}]: bad status`);
        const c = it.candidate as Partial<Stored<unknown>> | undefined;
        // review items are not yet approved, so reviewedAt is not required here
        errors.push(...provenanceErrors(`review.items[${i}]`, c ? { ...c, reviewedAt: c.reviewedAt ?? "pending" } : c));
    }
    return errors;
}

let loaded: Promise<Enrichment> | null = null;

/** The committed enrichment.json (validated). Build/tooling use; the game reads catalog.json. */
export async function getEnrichment(): Promise<Enrichment> {
    if (!loaded) {
        loaded = import("./enrichment.json")
            .then((m) => {
                const data = (m.default ?? m) as unknown;
                const errors = validateEnrichment(data);
                if (errors.length) throw new Error(`enrichment.json invalid: ${errors.slice(0, 3).join("; ")}`);
                return data as Enrichment;
            })
            .catch((e) => {
                loaded = null;
                throw e;
            });
    }
    return loaded;
}
