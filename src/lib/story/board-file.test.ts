import { describe, expect, it } from "vitest";
import { BOARD_FILE_MAX_BYTES, BoardFileError, boardFileName, boardFromFile, boardToFile } from "@/lib/story/board-file";
import { emptyDraft } from "@/lib/story/draft";
import { DEFAULT_TITLE_STYLE } from "@/lib/story/config";

const board = () => {
    const d = emptyDraft(10);
    d.title = "My Top 10";
    d.titleStyle = "below";
    d.items[0] = { id: 1, type: "ANIME", title: "Cowboy Bebop", cover: "https://s4.anilist.co/a.jpg", src: "anilist" };
    d.items[3] = { id: 5, type: "MANGA", title: "Berserk", cover: "https://cdn.myanimelist.net/b.jpg", src: "mal" };
    d.items[9] = { id: 77, type: "ANIME", title: "Fan art", cover: "https://abc.public.blob.vercel-storage.com/story/x.png", src: "upload" };
    return d;
};
const fail = (text: string) => {
    try {
        boardFromFile(text);
    } catch (e) {
        expect(e).toBeInstanceOf(BoardFileError);
        return (e as Error).message;
    }
    throw new Error("expected a BoardFileError");
};

describe("story board JSON file (parity item 2)", () => {
    it("round-trips size, title, style, slots and sources", () => {
        const d = board();
        const { draft, dropped } = boardFromFile(boardToFile(d));
        expect(dropped).toBe(0);
        expect(draft).toEqual(d);
        expect(boardFileName(d, new Date("2026-10-14T08:09:10Z"))).toBe("story100-board-2026-10-14_08-09-10.json");
    });
    it("validates cells with the share validator: bad hosts / ids / types are dropped and counted", () => {
        const raw = JSON.parse(boardToFile(board()));
        raw.cells.push({ i: 1, a: 9, t: "ANIME", img: "javascript:alert(1)" });
        raw.cells.push({ i: 2, a: -1, t: "ANIME", img: "https://s4.anilist.co/z.jpg" });
        raw.cells.push({ i: 4, a: 3, t: "NOVEL", img: "https://s4.anilist.co/z.jpg" });
        raw.cells.push({ i: 5, a: 3, t: "ANIME", img: "https://evil.example.com/x.png", src: "upload" });
        raw.cells.push({ i: 99, a: 3, t: "ANIME", img: "https://s4.anilist.co/z.jpg" });
        const { draft, dropped } = boardFromFile(JSON.stringify(raw));
        expect(dropped).toBe(5);
        expect(draft.items.filter(Boolean)).toHaveLength(3);
    });
    it("rejects bad files with a friendly message", () => {
        expect(fail("not json")).toMatch(/isn't a valid board file/);
        expect(fail(JSON.stringify({ hello: 1 }))).toMatch(/isn't a Story100 board file/);
        expect(fail(JSON.stringify([{ i: 0, character: {} }]))).toMatch(/isn't a Story100 board file/); // a waifu save
        expect(fail(JSON.stringify({ format: "story100-board", version: 99, size: 10, cells: [] }))).toMatch(/newer version/);
        expect(fail(JSON.stringify({ format: "story100-board", version: 1, size: 7, cells: [] }))).toMatch(/damaged/);
        expect(fail(JSON.stringify({ format: "story100-board", version: 1, size: 10, cells: [] }))).toMatch(/no valid titles/);
        expect(fail(" ".repeat(BOARD_FILE_MAX_BYTES + 1))).toMatch(/too big/);
    });
});

describe("board file validation extras (parity item 2)", () => {
    it("an upload cell pointing at a non-Blob URL is dropped; valid cells stay", () => {
        const raw = JSON.parse(boardToFile(board()));
        raw.cells.find((c: { src?: string }) => c.src === "upload").img = "https://evil.example.com/x.png";
        const { draft, dropped } = boardFromFile(JSON.stringify(raw));
        expect(dropped).toBe(1);
        expect(draft.items[9]).toBeNull();
        expect(draft.items[0]?.title).toBe("Cowboy Bebop");
    });
    it("invalid titleStyle falls back to the default; an invalid size is rejected", () => {
        const raw = JSON.parse(boardToFile(board()));
        expect(boardFromFile(JSON.stringify({ ...raw, titleStyle: "<script>" })).draft.titleStyle).toBe(DEFAULT_TITLE_STYLE);
        expect(fail(JSON.stringify({ ...raw, size: 7 }))).toMatch(/damaged/i);
    });
});
