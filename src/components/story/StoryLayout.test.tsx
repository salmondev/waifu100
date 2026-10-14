import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoryBuilder } from "@/components/story/StoryBuilder";
import { STORY_DRAFT_KEY } from "@/lib/story/config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

const item = (id: number, title: string) => ({ id, type: "ANIME", title, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" });
const seed = (items: unknown[]) => window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size: 10, type: "ANIME", title: "t", items: Array.from({ length: 10 }, (_, i) => items[i] ?? null), titleStyle: "overlay" }));
const AI = /\/api\/(suggest|analyze)/;
let fetchMock: ReturnType<typeof vi.fn>;
const aiCalls = () => fetchMock.mock.calls.filter(([u]) => AI.test(String(u)));
function viewport(width: number) {
    vi.stubGlobal("matchMedia", (q: string) => {
        const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
        return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} };
    });
}

beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (u: string) => (AI.test(String(u)) ? new Response(JSON.stringify({ suggestions: [{ title: "Frieren", type: "ANIME", reason: "r" }] })) : new Response(JSON.stringify({ items: [] }))));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("story layout follows waifu", () => {
    it("desktop (1440): actions sit in the left sidebar footer with Progress; suggestions in an open right panel", async () => {
        viewport(1440);
        seed([item(1, "A"), item(2, "B")]);
        render(<StoryBuilder />);
        const footer = await screen.findByTestId("left-footer");
        expect(within(footer).getByText("Progress")).toBeTruthy();
        expect(within(footer).getByText("2/10")).toBeTruthy();
        expect(within(footer).getByTestId("story-actions")).toBeTruthy();
        expect(screen.getAllByTestId("story-actions")).toHaveLength(1);
        const right = screen.getByTestId("right-panel");
        expect(within(right).getByRole("button", { name: /Generate Ideas/ })).toBeTruthy();
        expect(screen.getByTestId("story-canvas").contains(screen.getByTestId("story-actions"))).toBe(false);
    });
    it("1024: right panel starts collapsed (like waifu) so the canvas keeps its width", async () => {
        viewport(1024);
        seed([item(1, "A")]);
        render(<StoryBuilder />);
        await screen.findByTestId("left-footer");
        expect(screen.getByRole("button", { name: "Expand suggestions" })).toBeTruthy();
    });
    it("mobile: actions stay under the board, suggestions collapse into a bottom panel", async () => {
        viewport(390);
        seed([item(1, "A")]);
        render(<StoryBuilder />);
        const acts = await screen.findByTestId("story-actions");
        expect(screen.getByTestId("story-canvas").contains(acts)).toBe(true);
        expect(screen.queryByTestId("left-footer")).toBeNull();
        expect(screen.getByRole("button", { name: "Expand suggestions" })).toBeTruthy();
    });
});

describe("AI suggest fires only on an explicit click", () => {
    it("no AI fetch on mount, on board change, or when the panel opens/closes", async () => {
        viewport(1024);
        seed([item(1, "A"), item(2, "B")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. A" });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(aiCalls()).toHaveLength(0);
        // board change: remove a title, then rename the board
        fireEvent.keyDown(screen.getByRole("button", { name: "2. B" }), { key: "Delete" });
        fireEvent.change(screen.getByRole("textbox", { name: "Grid title" }), { target: { value: "new" } });
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(aiCalls()).toHaveLength(0);
        // open / close / open the panel
        fireEvent.click(screen.getByRole("button", { name: "Expand suggestions" }));
        fireEvent.click(screen.getByRole("button", { name: "Collapse suggestions" }));
        fireEvent.click(screen.getByRole("button", { name: "Expand suggestions" }));
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(aiCalls()).toHaveLength(0);
    });
    it("one click = one /api/suggest call", async () => {
        viewport(1440);
        seed([item(1, "A"), item(2, "B")]);
        render(<StoryBuilder />);
        const btn = await within(await screen.findByTestId("right-panel")).findByRole("button", { name: /Generate Ideas/ });
        await act(async () => { fireEvent.click(btn); });
        expect(aiCalls().map(([u]) => String(u))).toEqual(["/api/suggest"]);
        expect(await screen.findByRole("button", { name: /Frieren/ })).toBeTruthy();
    });
});

describe("below 1280 the suggestions panel floats over the canvas", () => {
    const open = async (w: number) => {
        viewport(w);
        seed([item(1, "A"), item(2, "B")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. A" });
        const aside = screen.getByTestId("right-panel");
        const before = aside.className;
        fireEvent.click(screen.getByRole("button", { name: "Expand suggestions" }));
        return { aside, before };
    };
    for (const w of [1024, 390]) {
        it(`${w}px: opens as an overlay; the docked column keeps its collapsed width; no AI call`, async () => {
            const { aside, before } = await open(w);
            expect(aside.getAttribute("data-mode")).toBe("overlay");
            expect(aside.className).toBe(before); // still "h-14 w-full lg:w-12" - canvas not narrowed
            const dialog = screen.getByRole("dialog", { name: "AI Suggestions" });
            expect(dialog.className).toMatch(/\bfixed\b/);
            expect(dialog.className).toContain("z-[61]");
            expect(screen.getByTestId("right-panel-backdrop")).toBeTruthy();
            expect(within(dialog).getByRole("button", { name: /Generate Ideas/ })).toBeTruthy();
            await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
            expect(aiCalls()).toHaveLength(0);
        });
    }
    it("outside click (backdrop) closes it", async () => {
        const { aside } = await open(1024);
        fireEvent.click(screen.getByTestId("right-panel-backdrop"));
        expect(aside.getAttribute("data-mode")).toBe("collapsed");
        expect(screen.queryByRole("dialog", { name: "AI Suggestions" })).toBeNull();
    });
    it("Esc closes it", async () => {
        const { aside } = await open(1024);
        fireEvent.keyDown(window, { key: "Escape" });
        expect(aside.getAttribute("data-mode")).toBe("collapsed");
        expect(aiCalls()).toHaveLength(0);
    });
    it("at 1280+ it stays docked (no overlay, no backdrop)", async () => {
        viewport(1440);
        seed([item(1, "A")]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: "1. A" });
        expect(screen.getByTestId("right-panel").getAttribute("data-mode")).toBe("docked");
        expect(screen.queryByTestId("right-panel-backdrop")).toBeNull();
        expect(screen.queryByRole("dialog", { name: "AI Suggestions" })).toBeNull();
    });
});
