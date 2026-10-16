import { describe, expect, it } from "vitest";
import { applyTogetherOp, emptyTogether, seenLoudAt, type TogetherItem, type TogetherOp } from "@/lib/together/ops";

const item = (id: number, title = `T${id}`): TogetherItem => ({ id, type: "ANIME", title, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" });

describe("together room ops", () => {
    it("places into an empty slot and refuses a filled one or a duplicate", () => {
        let s = emptyTogether(9);
        s = applyTogetherOp(s, { t: "place", i: 2, item: item(1) }, false)!;
        expect(s.items[2] && "id" in s.items[2] && s.items[2].id).toBe(1);
        expect(applyTogetherOp(s, { t: "place", i: 2, item: item(2) }, false)).toBeNull();
        expect(applyTogetherOp(s, { t: "place", i: 3, item: item(1) }, false)).toBeNull();
    });

    it("host can resize, restyle, and switch mode (which clears the board)", () => {
        let s = applyTogetherOp(emptyTogether(9), { t: "place", i: 0, item: item(1) }, true)!;
        s = applyTogetherOp(s, { t: "layout", size: 10, cols: null }, true)!;
        expect(s.size).toBe(10);
        expect(s.items[0] && "id" in s.items[0] && s.items[0].id).toBe(1);
        expect(applyTogetherOp(s, { t: "layout", size: 9, cols: null }, false)).toBeNull();
        s = applyTogetherOp(s, { t: "style", titleStyle: "below" }, true)!;
        expect(s.titleStyle).toBe("below");
        s = applyTogetherOp(s, { t: "kind", kind: "waifu" }, true)!;
        expect(s.kind).toBe("waifu");
        expect(s.items.every((x) => x === null)).toBe(true);
    });

    it("swaps and lifts a single cell, and only the owner renames", () => {
        let s = applyTogetherOp(emptyTogether(9), { t: "place", i: 0, item: item(1) }, false)!;
        s = applyTogetherOp(s, { t: "swap", from: 0, to: 4 }, false)!;
        expect(s.items[4] && "id" in s.items[4] && s.items[4].id).toBe(1);
        expect(s.items[0]).toBeNull();
        s = applyTogetherOp(s, { t: "lift", i: 4 }, false)!;
        expect(s.items[4]).toBeNull();
        expect(applyTogetherOp(s, { t: "title", title: "Ours" }, false)).toBeNull();
        expect(applyTogetherOp(s, { t: "title", title: "Ours" }, true)?.title).toBe("Ours");
    });

    it("each person can mark a cell seen once, and the marks travel with the cell", () => {
        let s = applyTogetherOp(emptyTogether(9), { t: "place", i: 1, item: item(1) }, false)!;
        s = applyTogetherOp(s, { t: "seen", i: 1 }, false, "ada")!;
        s = applyTogetherOp(s, { t: "seen", i: 1 }, false, "bea")!;
        s = applyTogetherOp(s, { t: "seen", i: 1 }, false, "ada")!;
        expect(s.items[1] && s.items[1].seen).toEqual(["bea"]);
        s = applyTogetherOp(s, { t: "swap", from: 1, to: 4 }, false)!;
        expect(s.items[4] && s.items[4].seen).toEqual(["bea"]);
        expect(applyTogetherOp(s, { t: "seen", i: 0 }, false, "ada")).toBeNull();
    });

    it("nine people turn a seen count amber at 5, and only the host hides the numbers", () => {
        expect(seenLoudAt(9)).toBe(5);
        expect(seenLoudAt(8)).toBe(5);
        expect(seenLoudAt(4)).toBe(2);
        const s = emptyTogether(9);
        expect(applyTogetherOp(s, { t: "seenShow", on: false }, false)).toBeNull();
        expect(applyTogetherOp(s, { t: "seenShow", on: false }, true)?.showSeen).toBe(false);
    });

    it("a message that is not an op is ignored", () => {
        const s = emptyTogether(9);
        expect(applyTogetherOp(s, null as unknown as TogetherOp, true)).toBeNull();
        expect(applyTogetherOp(s, { t: "nope" } as unknown as TogetherOp, true)).toBeNull();
    });
});
