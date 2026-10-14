import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StoryBuilder } from "@/components/story/StoryBuilder";
import { STORY_DRAFT_KEY } from "@/lib/story/config";
import { ANILIST_GRAPHQL } from "@/lib/story/search";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

const AI = /\/api\/(suggest|analyze|share)/;
let fetchMock: ReturnType<typeof vi.fn>;
const anilistBodies = () => fetchMock.mock.calls.filter(([u]) => String(u) === ANILIST_GRAPHQL).map(([, init]) => JSON.parse(String((init as RequestInit).body)).variables);
function viewport(width: number) {
    vi.stubGlobal("matchMedia", (q: string) => {
        const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
        return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} };
    });
}

beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (u: string) => {
        if (AI.test(String(u))) throw new Error("no AI / share calls in this test");
        return new Response(JSON.stringify({ data: { Page: { media: [] } } }));
    });
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([1280, 390])("story100 UX at %ipx", (width) => {
    beforeEach(() => viewport(width));

    it("a new board is 3x3, and 5x5 is offered", async () => {
        render(<StoryBuilder />);
        const sizes = await screen.findByRole("group", { name: "Grid size" });
        expect(within(sizes).getByRole("button", { name: "3×3" }).getAttribute("aria-pressed")).toBe("true");
        fireEvent.click(within(sizes).getByRole("button", { name: "5×5" }));
        expect(within(sizes).getByRole("button", { name: "5×5" }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getAllByText("0/25").length).toBeGreaterThan(0);
    });

    it("a saved Top 10 board keeps its size", async () => {
        window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size: 10, type: "ANIME", title: "t", items: Array(10).fill(null), titleStyle: "overlay" }));
        render(<StoryBuilder />);
        const sizes = await screen.findByRole("group", { name: "Grid size" });
        expect(within(sizes).getByRole("button", { name: "Top 10" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("has waifu's Community Showcase button, opening the story showcase", async () => {
        render(<StoryBuilder />);
        const link = await screen.findByTestId("showcase-link");
        expect(link.getAttribute("href")).toBe("/community?kind=story");
        expect(link.textContent).toContain("Community Showcase");
        expect(link.className).toContain("from-indigo-900/40");
    });

    it("the title field is labelled, recommended and highlighted only while empty", async () => {
        render(<StoryBuilder />);
        const input = await screen.findByLabelText("Grid title");
        expect(screen.getByText(/recommended/)).toBeTruthy();
        expect(input.getAttribute("data-empty")).toBe("true");
        expect(document.getElementById(input.getAttribute("aria-describedby")!)!.textContent).toMatch(/Add a title/);
        fireEvent.change(input, { target: { value: "อนิเมะที่ชอบ" } });
        expect(input.getAttribute("data-empty")).toBeNull();
        expect((input as HTMLInputElement).value).toBe("อนิเมะที่ชอบ");
    });

    it("anime / manga radio group: anime by default, keyboard switches, the search follows", async () => {
        // The search module caches per query for 5 min, so each width uses its own Thai query.
        const q = width > 500 ? "นารูโตะ" : "วันพีซ";
        render(<StoryBuilder />);
        const group = await screen.findByRole("radiogroup", { name: "Search for" });
        const [anime, manga] = within(group).getAllByRole("radio");
        expect(anime.getAttribute("aria-checked")).toBe("true");
        expect(manga.getAttribute("tabindex")).toBe("-1");
        fireEvent.change(screen.getByLabelText("Search anime or manga"), { target: { value: q } });
        await waitFor(() => expect(anilistBodies().at(-1)).toMatchObject({ search: q, type: "ANIME" }));
        fireEvent.keyDown(anime, { key: "ArrowRight" });
        expect(manga.getAttribute("aria-checked")).toBe("true");
        expect(document.activeElement).toBe(manga);
        await waitFor(() => expect(anilistBodies().at(-1)).toMatchObject({ search: q, type: "MANGA" }));
        expect(fetchMock.mock.calls.some(([u]) => AI.test(String(u)))).toBe(false);
    });
});
