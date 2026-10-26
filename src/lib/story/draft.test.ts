import { describe, expect, it } from "vitest";
import { emptyDraft, parseDraft, placeItem, resizeDraft } from "@/lib/story/draft";

const item = (id: number) => ({ id, type: "ANIME" as const, title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg` });

describe("story draft", () => {
    it("places into the first empty slot or the selected one, rejects duplicates and full boards", () => {
        let d = emptyDraft(9);
        d = placeItem(d, item(1), null)!;
        d = placeItem(d, item(2), 5)!;
        expect(d.items[0]?.id).toBe(1);
        expect(d.items[5]?.id).toBe(2);
        expect(placeItem(d, item(1), null)).toBeNull();
        let full = emptyDraft(9);
        for (let i = 0; i < 9; i++) full = placeItem(full, item(i + 10), null)!;
        expect(placeItem(full, item(99), null)).toBeNull();
    });

    it("resizes keeping order", () => {
        const d = placeItem(emptyDraft(10), item(1), 9)!;
        expect(resizeDraft(d, 9).items.every((x) => x === null)).toBe(true);
        expect(resizeDraft(d, 50).items[9]?.id).toBe(1);
        expect(resizeDraft(d, 50).items).toHaveLength(50);
    });

    it("parses garbage and non-public covers safely", () => {
        expect(parseDraft("nope").size).toBe(9); // new boards default to 3x3
        const d = parseDraft(JSON.stringify({ size: 9, items: [{ ...item(1), cover: "http://evil.example/x.jpg" }, item(2)] }));
        expect(d.items[0]).toBeNull();
        expect(d.items[1]?.id).toBe(2);
    });
});
