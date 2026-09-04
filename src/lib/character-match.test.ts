import { describe, it, expect } from "vitest";
import { matchKey, compareGrids } from "@/lib/character-match";
import { GridCell } from "@/types";

function grid(...names: (string | null)[]): GridCell[] {
    return Array.from({ length: 100 }, (_, i) => ({
        character: names[i]
            ? {
                  // Pseudo ids on purpose: this is what image-search picks look
                  // like, and matching must not depend on them.
                  mal_id: 990000 + i,
                  name: names[i] as string,
                  images: { jpg: { image_url: `https://example.test/${i}.jpg` } },
              }
            : null,
    }));
}

describe("matchKey", () => {
    it("ignores case and spacing", () => {
        expect(matchKey("  Rem  ")).toBe(matchKey("rem"));
    });

    it("treats swapped Japanese name order as the same person", () => {
        expect(matchKey("Eru Chitanda")).toBe(matchKey("Chitanda Eru"));
    });

    it("drops a bracketed series qualifier", () => {
        expect(matchKey("Hatsune Miku (Vocaloid)")).toBe(matchKey("Miku Hatsune"));
    });

    it("ignores punctuation and diacritics", () => {
        expect(matchKey("Ōkami Mio")).toBe(matchKey("okami・mio"));
        expect(matchKey("Re:Zero Rem")).toBe(matchKey("rem zero re"));
    });

    it("does not match a mononym against a full name", () => {
        // "Sakura" belongs to a dozen characters; a partial match would be wrong
        // far more often than right.
        expect(matchKey("Sakura")).not.toBe(matchKey("Sakura Kinomoto"));
    });

    it("is empty for a name with no letters or digits", () => {
        expect(matchKey("???")).toBe("");
    });
});

describe("compareGrids", () => {
    it("finds overlaps across spelling differences", () => {
        const a = grid("Eru Chitanda", "Rem", "Frieren");
        const b = grid("chitanda eru", "Ram", "Frieren (Sousou no Frieren)");

        const result = compareGrids(a, b);

        expect(result.shared.map((s) => s.key)).toEqual([
            matchKey("Eru Chitanda"),
            matchKey("Frieren"),
        ]);
        expect(result.onlyA.map((c) => c.name)).toEqual(["Rem"]);
        expect(result.onlyB.map((c) => c.name)).toEqual(["Ram"]);
    });

    it("scores two identical grids at 100", () => {
        const a = grid("Rem", "Ram");
        expect(compareGrids(a, grid("Rem", "Ram")).similarity).toBe(100);
    });

    it("scores grids with nothing in common at 0", () => {
        expect(compareGrids(grid("Rem"), grid("Ram")).similarity).toBe(0);
    });

    it("counts a duplicated character once", () => {
        const a = grid("Rem", "rem", "Ram");
        const result = compareGrids(a, grid("Rem"));

        expect(result.countA).toBe(2);
        expect(result.shared).toHaveLength(1);
    });

    it("survives an empty grid", () => {
        const result = compareGrids(grid(), grid("Rem"));
        expect(result.similarity).toBe(0);
        expect(result.shared).toHaveLength(0);
        expect(result.onlyB).toHaveLength(1);
    });

    it("keeps the A-side spelling for a shared character", () => {
        const result = compareGrids(grid("Eru Chitanda"), grid("chitanda eru"));
        expect(result.shared[0].name).toBe("Eru Chitanda");
    });
});
