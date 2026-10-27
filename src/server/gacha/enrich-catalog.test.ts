// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEnrichment, validateReview } from "./enrichment";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function readJson(name: string) {
    return JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as {
        anime?: Array<{ roster?: Array<{ image?: string | null }> }>;
    };
}

describe("committed catalog enrichment", () => {
    it("stores every roster image as an AniList CDN URL", () => {
        const catalog = readJson("catalog.json");
        let images = 0;
        for (const anime of catalog.anime ?? []) {
            for (const row of anime.roster ?? []) {
                if (row.image == null) continue;
                images += 1;
                expect(row.image).toMatch(/^https:\/\/s4\.anilist\.co\//);
            }
        }
        expect(images).toBeGreaterThan(0);
    });

    it("accepts the committed enrichment.json and review.json", () => {
        expect(validateEnrichment(readJson("enrichment.json"))).toEqual([]);
        expect(validateReview(readJson("review.json"))).toEqual([]);
    });
});
