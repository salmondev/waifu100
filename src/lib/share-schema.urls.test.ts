import { describe, expect, it } from "vitest";
import { buildWaifuPayload, cleanStoryCells, decodeShare, decodeShareObject } from "@/lib/share-schema";

const BAD = [
    "data:image/png;base64,iVBORw0KGgo=",
    "blob:https://waifu100.app/1234-5678",
    "http://s4.anilist.co/x.jpg",
    "javascript:alert(1)",
    "https://127.0.0.1/x.png",
    "https://user:pw@cdn.myanimelist.net/x.jpg",
    "/api/img?u=x",
];
const GOOD = "https://cdn.myanimelist.net/images/characters/1/1.jpg";
const char = (img: string, custom?: string) => ({ mal_id: 1, name: "A", images: { jpg: { image_url: img }, webp: { image_url: img } }, customImageUrl: custom });

describe("saved waifu cells never carry non-https image URLs (review M3)", () => {
    it.each(BAD)("write drops %s", (bad) => {
        const p = buildWaifuPayload({ title: "t", imageUrl: bad, grid: [{ i: 0, character: char(bad, bad) }] });
        const c = (p.grid[0] as { character: ReturnType<typeof char> }).character;
        expect(c.images.jpg.image_url).toBe("");
        expect(c.images.webp.image_url).toBe("");
        expect(c.customImageUrl).toBeUndefined();
        expect(p.meta.imageUrl).toBeUndefined();
        expect(p.meta.hasImage).toBe(false);
    });
    it.each(BAD)("read of a legacy/hand-written payload drops %s", (bad) => {
        for (const raw of [[{ i: 0, character: char(bad, bad) }], { meta: { imageUrl: bad }, grid: [{ i: 0, character: char(bad, bad) }] }]) {
            const d = decodeShareObject(raw)!;
            expect(d.images[0]).toBeNull();
            expect(d.grid[0].character?.customImageUrl).toBeUndefined();
            expect(d.grid[0].character?.images.jpg.image_url).toBe("");
            expect(d.imageUrl).toBeNull();
        }
    });
    it("keeps public https URLs", () => {
        const d = decodeShare(JSON.stringify(buildWaifuPayload({ title: "t", grid: [{ i: 3, character: char(GOOD) }] })))!;
        expect(d.images[3]).toBe(GOOD);
    });
});

describe("saved story cells never carry non-https image URLs (review M3)", () => {
    const cell = (img: string, src?: string) => ({ i: 0, a: 1, t: "ANIME", img, ...(src ? { src } : {}) });
    it.each(BAD)("write drops %s for every source", (bad) => {
        for (const src of [undefined, "mal", "web", "upload"]) {
            expect(() => cleanStoryCells(9, [cell(bad, src)])).toThrow("Grid is empty");
        }
    });
    it.each(BAD)("read drops %s for every source", (bad) => {
        for (const src of [undefined, "mal", "web", "upload"]) {
            const d = decodeShareObject({ meta: { v: 2, kind: "story", size: 3 }, grid: [cell(bad, src)] })!;
            expect(d.items[0]).toBeNull();
            expect(d.images[0]).toBeNull();
        }
    });
    it("keeps allowed covers", () => {
        const d = decodeShareObject({ meta: { v: 2, kind: "story", size: 3 }, grid: [cell("https://s4.anilist.co/file/a.jpg")] })!;
        expect(d.images[0]).toBe("https://s4.anilist.co/file/a.jpg");
    });
});
