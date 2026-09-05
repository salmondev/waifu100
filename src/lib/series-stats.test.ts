import { describe, it, expect } from "vitest";
import {
    isSeriesName,
    compareSeries,
    seriesOf,
    unresolvedNames,
    type SeriesInput,
} from "@/lib/series-stats";
import { matchKey } from "@/lib/character-match";

function chars(...pairs: [string, string | null][]): SeriesInput[] {
    return pairs.map(([name, source]) => ({ name, source }));
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

describe("seriesOf", () => {
    it("prefers the stored source when it is a real title", () => {
        const resolved = { [matchKey("Rem")]: "Something Else" };
        expect(seriesOf({ name: "Rem", source: "Re:Zero" }, resolved)).toBe("Re:Zero");
    });

    it("falls back to a looked-up series when the source is a marker", () => {
        const resolved = { [matchKey("Rem")]: "Re:ZERO" };
        expect(seriesOf({ name: "Rem", source: "Uploaded" }, resolved)).toBe("Re:ZERO");
    });

    it("is null when the lookup came back empty", () => {
        const resolved = { [matchKey("Rem")]: "" };
        expect(seriesOf({ name: "Rem", source: "Uploaded" }, resolved)).toBeNull();
    });
});

describe("unresolvedNames", () => {
    it("lists only what nothing knows yet", () => {
        const resolved = { [matchKey("Rem")]: "" };
        const list = unresolvedNames(
            chars(["Rem", "Uploaded"], ["Ram", "Imported"], ["Frieren", "Sousou no Frieren"]),
            resolved
        );
        // Rem was asked (and missed), Frieren has a source: only Ram is left.
        expect(list).toEqual(["Ram"]);
    });

    it("does not repeat a name that appears twice", () => {
        expect(unresolvedNames(chars(["Rem", "Uploaded"], ["rem", "Uploaded"]))).toEqual([
            "Rem",
        ]);
    });
});

describe("compareSeries", () => {
    it("counts each side and finds what both drew from", () => {
        const a = chars(["X", "Frieren"], ["Y", "Frieren"], ["Z", "Fairy Tail"], ["W", "Uploaded"]);
        const b = chars(["P", "frieren"], ["Q", "Bocchi the Rock!"], ["R", "Google (x.com)"]);

        const stats = compareSeries(a, b);

        expect(stats.shared.map((r) => [r.name, r.a, r.b])).toEqual([["Frieren", 2, 1]]);
        expect(stats.aOnly.map((r) => r.name)).toEqual(["Frieren", "Fairy Tail"]);
        expect(stats.bOnly.map((r) => r.name)).toEqual(["Frieren", "Bocchi the Rock!"]);
        expect(stats.knownA).toBe(3);
        expect(stats.knownB).toBe(2);
        expect(stats.countA).toBe(4);
        expect(stats.countB).toBe(3);
    });

    it("uses looked-up series for cells whose source is a marker", () => {
        const resolved = { [matchKey("Rem")]: "Re:ZERO", [matchKey("Ram")]: "Re:ZERO" };
        const stats = compareSeries(
            chars(["Rem", "Uploaded"]),
            chars(["Ram", "Google (pinterest.com)"]),
            resolved
        );

        expect(stats.shared.map((r) => [r.name, r.a, r.b])).toEqual([["Re:ZERO", 1, 1]]);
        expect(stats.knownA).toBe(1);
    });

    it("merges the same title spelled differently", () => {
        const stats = compareSeries(chars(["A", "Free!"], ["B", "free!"]), []);
        expect(stats.aOnly).toHaveLength(1);
        expect(stats.aOnly[0].a).toBe(2);
    });

    it("orders shared rows by the smaller side, so a real overlap wins", () => {
        const a = chars(
            ["1", "Big"],
            ["2", "Big"],
            ["3", "Big"],
            ["4", "Big"],
            ["5", "Even"],
            ["6", "Even"]
        );
        const b = chars(["7", "Big"], ["8", "Even"], ["9", "Even"]);

        expect(compareSeries(a, b).shared[0].name).toBe("Even");
    });

    it("survives sides with no usable series at all", () => {
        const stats = compareSeries(chars(["A", "Uploaded"]), chars(["B", "Imported"]));
        expect(stats.shared).toHaveLength(0);
        expect(stats.aOnly).toHaveLength(0);
        expect(stats.knownA).toBe(0);
        expect(stats.countA).toBe(1);
    });
});
