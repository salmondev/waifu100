import { describe, it, expect } from "vitest";
import { isSeriesName, compareSeries } from "@/lib/series-stats";
import { GridCell } from "@/types";

function grid(...sources: (string | null)[]): GridCell[] {
    return Array.from({ length: 100 }, (_, i) => ({
        character: sources[i]
            ? {
                  mal_id: 990000 + i,
                  name: `Character ${i}`,
                  images: { jpg: { image_url: "" } },
                  source: sources[i] as string,
              }
            : null,
    }));
}

describe("isSeriesName", () => {
    it("keeps real titles", () => {
        expect(isSeriesName("Sousou no Frieren")).toBe(true);
        expect(isSeriesName("Free!")).toBe(true);
    });

    it("rejects the picture-source markers real grids are full of", () => {
        for (const junk of [
            "Google (www.pinterest.com)",
            "Official (MAL)",
            "Official (AniList)",
            "Uploaded",
            "Uploaded (GIF)",
            "Imported",
            "URL",
            "Web Search",
            "MyAnimeList",
            "Unknown",
            "Shared",
        ]) {
            expect(isSeriesName(junk), junk).toBe(false);
        }
    });

    it("rejects empty and missing values", () => {
        expect(isSeriesName("")).toBe(false);
        expect(isSeriesName(null)).toBe(false);
        expect(isSeriesName("   ")).toBe(false);
    });
});

describe("compareSeries", () => {
    it("counts each side and finds what both drew from", () => {
        const a = grid("Frieren", "Frieren", "Fairy Tail", "Uploaded");
        const b = grid("frieren", "Bocchi the Rock!", "Google (pinterest.com)");

        const stats = compareSeries(a, b);

        expect(stats.shared.map((r) => [r.name, r.a, r.b])).toEqual([["Frieren", 2, 1]]);
        expect(stats.knownA).toBe(3);
        expect(stats.knownB).toBe(2);
        expect(stats.countA).toBe(4);
        expect(stats.countB).toBe(3);
    });

    it("merges the same title spelled differently", () => {
        const stats = compareSeries(grid("Free!", "free!"), grid());
        expect(stats.all).toHaveLength(1);
        expect(stats.all[0].a).toBe(2);
    });

    it("orders shared rows by the smaller side, so a real overlap wins", () => {
        const a = grid("Big", "Big", "Big", "Big", "Even", "Even");
        const b = grid("Big", "Even", "Even");

        const stats = compareSeries(a, b);
        expect(stats.shared[0].name).toBe("Even");
    });

    it("survives grids with no usable series at all", () => {
        const stats = compareSeries(grid("Uploaded"), grid("Imported"));
        expect(stats.shared).toHaveLength(0);
        expect(stats.all).toHaveLength(0);
        expect(stats.knownA).toBe(0);
    });
});
