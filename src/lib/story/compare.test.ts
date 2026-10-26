import { describe, expect, it } from "vitest";
import { compareStoryGrids } from "@/lib/story/compare";
import { exportLayout } from "@/lib/story/export";

const it_ = (id: number, type: "ANIME" | "MANGA" = "ANIME") => ({ id, type, title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg` });

describe("compareStoryGrids", () => {
    it("finds shared titles with both ranks; type matters", () => {
        const r = compareStoryGrids([it_(1), it_(2), null, it_(3)], [it_(3), it_(1), it_(2, "MANGA")]);
        expect(r.shared.map((s) => [s.item.id, s.rankA, s.rankB])).toEqual([[1, 1, 2], [3, 4, 1]]);
        expect(r.onlyA.map((x) => x.id)).toEqual([2]);
        expect(r.onlyB.map((x) => x.type)).toEqual(["MANGA"]);
        expect(r.similarity).toBe(67);
    });
    it("empty grids are 0%", () => {
        expect(compareStoryGrids([null], [it_(1)]).similarity).toBe(0);
    });
});

describe("story PNG layout", () => {
    it("matches board shapes", () => {
        expect(exportLayout(9)).toMatchObject({ cols: 3, rows: 3 });
        expect(exportLayout(10)).toMatchObject({ cols: 5, rows: 2 });
        expect(exportLayout(100)).toMatchObject({ cols: 10, rows: 10 });
    });
});

describe("compareStoryGrids counts", () => {
    it("reports filled cells per side and ignores duplicates", () => {
        const r = compareStoryGrids([it_(1), it_(1), null, it_(2)], [it_(2), null]);
        expect(r.countA).toBe(3);
        expect(r.countB).toBe(1);
        expect(r.shared.map((s) => [s.rankA, s.rankB])).toEqual([[4, 1]]);
        expect(r.similarity).toBe(100);
    });
    it("identical grids are 100% with nothing only-in", () => {
        const g = [it_(1), it_(2), it_(3)];
        const r = compareStoryGrids(g, [...g]);
        expect([r.similarity, r.onlyA.length, r.onlyB.length]).toEqual([100, 0, 0]);
    });
});
