import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/story/search", async (orig) => ({
    ...(await orig<typeof import("@/lib/story/search")>()),
    storySearch: { search: vi.fn(async () => ({ items: [], source: "anilist", anilistCooldownUntil: null })), cooldownUntil: () => null },
}));

import { StoryBuilder } from "@/components/story/StoryBuilder";
import { STORY_DRAFT_KEY } from "@/lib/story/config";
import { boardToFile } from "@/lib/story/board-file";
import { emptyDraft } from "@/lib/story/draft";

const item = (id: number, title: string) => ({ id, type: "ANIME", title, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" });
function seed(items: unknown[], size = 10) {
    window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size, type: "ANIME", title: "t", items: Array.from({ length: size }, (_, i) => items[i] ?? null), titleStyle: "overlay" }));
}
const saved = () => JSON.parse(window.localStorage.getItem(STORY_DRAFT_KEY) ?? "{}");
const loadFile = (text: string) => {
    const input = screen.getByTestId("board-load-input") as HTMLInputElement;
    const file = new File([text], "board.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
};
let nativeConfirm: ReturnType<typeof vi.fn>;

beforeEach(() => {
    window.localStorage.clear();
    nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [] }))));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("story parity item 2: JSON save / load", () => {
    it("Save board downloads a story100-board JSON of the current board", async () => {
        seed([item(1, "Bebop")]);
        let blob: Blob | null = null;
        const create = vi.fn((b: Blob) => { blob = b; return "blob:x"; });
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
        const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: /Save board/ }));
        expect(click).toHaveBeenCalled();
        const parsed = JSON.parse(await blob!.text());
        expect(parsed).toMatchObject({ format: "story100-board", version: 1, size: 10, cells: [{ i: 0, a: 1, t: "ANIME", n: "Bebop" }] });
        click.mockRestore();
    });

    it("Load board on an empty board applies it directly (and keeps the localStorage draft in sync)", async () => {
        render(<StoryBuilder />);
        const d = emptyDraft(9);
        d.items[4] = item(7, "Frieren") as never;
        await act(async () => loadFile(boardToFile(d)));
        await waitFor(() => expect(screen.getByRole("button", { name: "5. Frieren" })).toBeTruthy());
        expect(screen.getByTestId("notice").textContent).toBe("Board loaded.");
        await waitFor(() => expect(saved().size).toBe(9));
    });

    it("Load board over a filled board asks first with the in-app modal", async () => {
        seed([item(1, "Bebop")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. Bebop" });
        const d = emptyDraft(10);
        d.items[0] = item(2, "Akira") as never;
        await act(async () => loadFile(boardToFile(d)));
        const dialog = await screen.findByRole("dialog", { name: "Replace your current board?" });
        fireEvent.click(within(dialog).getByRole("button", { name: "Load board" }));
        await screen.findByRole("button", { name: "1. Akira" });
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it("a bad file is rejected with a friendly message and the board is untouched", async () => {
        seed([item(1, "Bebop")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. Bebop" });
        await act(async () => loadFile("{ nope"));
        await waitFor(() => expect(screen.getByTestId("notice").textContent).toMatch(/isn't a valid board file/));
        await act(async () => loadFile(JSON.stringify([{ i: 0, character: { name: "Rem" } }])));
        await waitFor(() => expect(screen.getByTestId("notice").textContent).toMatch(/isn't a Story100 board file/));
        expect(screen.getByRole("button", { name: "1. Bebop" })).toBeTruthy();
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("story parity item 2: size cap before reading", () => {
    it("a file over 512KB is rejected by File.size without calling file.text()", async () => {
        seed([item(1, "Bebop")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. Bebop" });
        const file = new File(["{}"], "big.json", { type: "application/json" });
        Object.defineProperty(file, "size", { value: 512 * 1024 + 1 });
        const text = vi.spyOn(file, "text");
        await act(async () => { fireEvent.change(screen.getByTestId("board-load-input"), { target: { files: [file] } }); });
        await waitFor(() => expect(screen.getByTestId("notice").textContent).toBe("That file is too big to be a Story100 board."));
        expect(text).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "1. Bebop" })).toBeTruthy();
    });
});

describe("story parity item 3: in-app modals instead of window.confirm", () => {
    it("Clear opens the modal; Cancel keeps the board, Clear Everything empties it (waifu copy)", async () => {
        seed([item(1, "Bebop")]);
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: /^Clear Grid$/ }));
        let dialog = screen.getByRole("dialog", { name: "Clear Entire Grid?" });
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.getByRole("button", { name: "1. Bebop" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: /^Clear Grid$/ }));
        dialog = screen.getByRole("dialog", { name: "Clear Entire Grid?" });
        fireEvent.click(within(dialog).getByRole("button", { name: "Clear Everything" }));
        expect(screen.queryByRole("button", { name: "1. Bebop" })).toBeNull();
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it("Shrinking a board that would lose titles opens the modal; Escape cancels", async () => {
        seed([item(1, "A"), null, null, null, null, null, null, null, null, item(10, "J")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "10. J" });
        fireEvent.click(screen.getByRole("button", { name: "3×3" }));
        expect(screen.getByRole("dialog", { name: /Shrink to/ })).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByRole("button", { name: "10. J" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "3×3" }));
        fireEvent.click(screen.getByRole("button", { name: "Shrink" }));
        expect(screen.queryByRole("button", { name: "10. J" })).toBeNull();
        expect(nativeConfirm).not.toHaveBeenCalled();
    });

    it("shrinking without losing titles needs no confirmation", async () => {
        seed([item(1, "A")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. A" });
        fireEvent.click(screen.getByRole("button", { name: "3×3" }));
        expect(screen.queryByRole("dialog")).toBeNull();
        await waitFor(() => expect(saved().size).toBe(9));
    });
});

describe("story parity: multi-select was dropped (scope change)", () => {
    it("there is no Select / bulk bar; tapping a filled cell still opens its picker", async () => {
        seed([item(1, "A")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. A" });
        expect(screen.queryByRole("button", { name: /^Select$/ })).toBeNull();
        expect(screen.queryByRole("toolbar", { name: "Bulk edit" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "1. A" }));
        expect(await screen.findByRole("dialog", { name: "Choose an image for A" })).toBeTruthy();
    });
});

describe("story mobile layout", () => {
    it("search results are capped at 30vh on mobile (was 45vh) and uncapped on desktop", () => {
        render(<StoryBuilder />);
        const panel = screen.getByTestId("search-panel");
        expect(panel.className).toContain("max-h-[30vh]");
        expect(panel.className).toContain("lg:max-h-none");
        expect(panel.className).not.toContain("45vh");
    });
});
