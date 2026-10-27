import { describe, expect, it } from "vitest";
import { applyAnime, applyCharacter, undoCharacter } from "../../../scripts/gacha/enrich/lib/apply.mjs";
import { mergeCandidates } from "../../../scripts/gacha/enrich/lib/merge.mjs";

const NOW = "2026-10-27T08:00:00Z";
const FETCHED = "2026-10-27T00:00:00Z";

function stored(value: unknown, extra: Record<string, unknown> = {}) {
    return {
        value,
        source: "anilist-normalised",
        url: "https://anilist.co/character/11",
        confidence: "high",
        fetchedAt: FETCHED,
        ...extra,
    };
}

function catalog() {
    return {
        anime: [
            {
                id: 1,
                coverColor: "#112233",
                characters: [
                    { id: 10, age: "17", gender: "Female", birthMonth: 3, va: { id: 1, name: "A" }, occupation: "student" },
                    { id: 11, age: "Unknown", gender: null, birthMonth: null, va: null, occupation: null },
                ],
                roster: [
                    { id: 10, age: "17", gender: "Female" },
                    { id: 11, age: "Unknown", gender: null },
                    { id: 12, age: null, gender: null },
                ],
            },
        ],
    };
}

function candidate(
    id: number,
    field: string,
    value: { value: unknown; source: string; url?: string; confidence: string; fetchedAt: string },
    kind = "character",
) {
    return { kind, id, field, value };
}

describe("mergeCandidates", () => {
    it("does not overwrite a value AniList already has", () => {
        const { enrichment, report } = mergeCandidates({
            catalog: catalog(),
            now: NOW,
            candidates: [
                candidate(10, "ageGame", stored("16")),
                candidate(1, "coverColor", stored("#abcdef", { source: "derived-cover", url: "https://anilist.co/anime/1" }), "anime"),
            ],
        });
        expect(enrichment.characters).toEqual({});
        expect(enrichment.anime).toEqual({});
        expect(report.skipped).toEqual([
            { key: "character:10:ageGame", reason: "anilist has a value" },
            { key: "anime:1:coverColor", reason: "anilist has a value" },
        ]);
    });

    it("rejects a value that is missing provenance", () => {
        const { enrichment, review, report } = mergeCandidates({
            catalog: catalog(),
            now: NOW,
            candidates: [
                candidate(11, "ageGame", { value: "16", source: "anilist-normalised", confidence: "high", fetchedAt: FETCHED }),
            ],
        });
        expect(enrichment.characters).toEqual({});
        expect(review.items).toEqual([]);
        expect(report.rejected).toEqual([{ key: "character:11:ageGame", reason: "url must be an https URL" }]);
    });

    it("sends medium and low confidence to review", () => {
        const { enrichment, review, report } = mergeCandidates({
            catalog: catalog(),
            now: NOW,
            candidates: [
                candidate(11, "ageGame", stored("16", { confidence: "medium" })),
                candidate(11, "birthMonth", stored(4, { confidence: "low" })),
            ],
        });
        expect(enrichment.characters).toEqual({});
        expect(report.merged).toEqual([]);
        expect(report.toReview.sort()).toEqual(["character:11:ageGame", "character:11:birthMonth"]);
        const byField = Object.fromEntries(review.items.map((item: { field: string; reason: string; status: string }) => [item.field, item]));
        expect(byField.ageGame).toMatchObject({ status: "pending", reason: "medium confidence" });
        expect(byField.birthMonth).toMatchObject({ status: "pending", reason: "low confidence" });
    });

    it("keeps pronoun gender in review even at high confidence", () => {
        const { enrichment, review, report } = mergeCandidates({
            catalog: catalog(),
            now: NOW,
            candidates: [
                candidate(11, "gender", stored("Male", { source: "anilist-pronouns", confidence: "high" })),
            ],
        });
        expect(enrichment.characters).toEqual({});
        expect(report.merged).toEqual([]);
        expect(review.items).toHaveLength(1);
        expect(review.items[0]).toMatchObject({
            status: "pending",
            reason: "review-only source (anilist-pronouns)",
            candidate: { source: "anilist-pronouns", confidence: "high", value: "Male" },
        });
    });

    it("merges an approved review item and records reviewedAt", () => {
        const reviewedAt = "2026-10-27T07:00:00Z";
        const { enrichment, review, report } = mergeCandidates({
            catalog: catalog(),
            now: NOW,
            review: {
                version: 1,
                items: [
                    {
                        key: "character:11:gender",
                        kind: "character",
                        id: 11,
                        field: "gender",
                        status: "approved",
                        candidate: stored("Male", { source: "anilist-pronouns", confidence: "high" }),
                        reviewedAt,
                    },
                ],
            },
            candidates: [],
        });
        expect(report.approvedMerged).toEqual(["character:11:gender"]);
        expect(enrichment.characters["11"].gender).toMatchObject({ value: "Male", source: "anilist-pronouns", reviewedAt });
        expect(review.items[0].status).toBe("merged");
        expect(review.items[0].mergedAt).toBe(NOW);
    });
});

type Row = {
    age: string | null;
    gender: string | null;
    occupation?: string | null;
    va?: unknown;
    birthMonth?: number | null;
    ageGame?: string;
    enriched?: string[];
};

describe("applyCharacter", () => {
    const sidecar = {
        ageGame: stored("16"),
        gender: stored("Male"),
        occupation: stored("witch"),
    };

    it("adds ageGame on a card row and a roster row only when the raw age does not parse", () => {
        const card: Row = { age: "Unknown", gender: null, occupation: null, va: null, birthMonth: null };
        const roster: Row = { age: null, gender: null };
        applyCharacter(card, sidecar, { card: true });
        applyCharacter(roster, sidecar, { card: false });
        expect(card.age).toBe("Unknown");
        expect(card.ageGame).toBe("16");
        expect(roster.ageGame).toBe("16");
        expect(card.enriched).toEqual(expect.arrayContaining(["ageGame"]));
        expect(roster.enriched).toEqual(expect.arrayContaining(["ageGame"]));
        expect(card.occupation).toBe("witch");
        expect(roster).not.toHaveProperty("occupation");

        const parsed: Row = { age: "17 years old", gender: null, occupation: null, va: null, birthMonth: null };
        applyCharacter(parsed, sidecar, { card: true });
        expect(parsed).not.toHaveProperty("ageGame");
        expect(parsed.enriched ?? []).not.toContain("ageGame");
        expect(parsed.age).toBe("17 years old");
    });

    it("does not replace a gender AniList already stored", () => {
        const row: Row = { age: "Unknown", gender: "Female" };
        applyCharacter(row, sidecar, { card: false });
        expect(row.gender).toBe("Female");
        expect(row.enriched).toEqual(["ageGame"]);
    });

    it("undo drops sidecar fields and the next apply starts from AniList", () => {
        const row: Row = { age: "Unknown", gender: "Male", ageGame: "99", enriched: ["gender", "ageGame"] };
        undoCharacter(row);
        expect(row.gender).toBeNull();
        expect(row).not.toHaveProperty("ageGame");
        expect(row).not.toHaveProperty("enriched");

        applyCharacter(row, undefined, { card: true });
        expect(row.gender).toBeNull();
        expect(row).not.toHaveProperty("ageGame");
    });
});

describe("applyAnime", () => {
    it("undoes a previous coverColor before applying a new one", () => {
        const anime: { coverColor: string | null; enriched?: string[] } = { coverColor: "#aabbcc", enriched: ["coverColor"] };
        applyAnime(anime, { coverColor: stored("#445566", { source: "derived-cover" }) });
        expect(anime.coverColor).toBe("#445566");
        expect(anime.enriched).toEqual(["coverColor"]);

        applyAnime(anime, undefined);
        expect(anime.coverColor).toBeNull();
        expect(anime).not.toHaveProperty("enriched");
    });
});
