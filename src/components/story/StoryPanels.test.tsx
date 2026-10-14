import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoryBuilder } from "@/components/story/StoryBuilder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

const AI = /\/api\/(suggest|analyze)/;
const COMMUNITY = /\/api\/community/;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (re: RegExp) => fetchMock.mock.calls.filter(([u]) => re.test(String(u))).map(([u]) => String(u));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
function viewport(width: number) {
    vi.stubGlobal("matchMedia", (q: string) => {
        const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
        return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} };
    });
}
const summary = (id: string, kind = "story") => ({ id, title: `G ${id}`, imageUrl: null, createdAt: "2026-10-01T00:00:00Z", hasGif: false, count: 3, kind, size: 10 });

beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async (u: string) => {
        const url = String(u);
        if (COMMUNITY.test(url)) {
            const off = Number(new URL(url, "http://x").searchParams.get("offset"));
            return new Response(JSON.stringify(off === 0 ? { grids: [summary("a"), summary("w", "waifu")], nextOffset: 20, hasMore: true, total: 22 } : { grids: [summary("b")], nextOffset: null, hasMore: false, total: 22 }));
        }
        if (AI.test(url)) return new Response(JSON.stringify({ suggestions: [] }));
        return new Response(JSON.stringify({ items: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("right panel tabs: Suggestions / Community", () => {
    it("no community or AI fetch on mount or on switching to Suggestions", async () => {
        viewport(1440);
        render(<StoryBuilder />);
        await screen.findByRole("tab", { name: "Suggestions" });
        await flush();
        fireEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
        await flush();
        expect(calls(COMMUNITY)).toHaveLength(0);
        expect(calls(AI)).toHaveLength(0);
    });
    it("Community fetches once on first open, kind=story, paginates with Load more, shows story grids only", async () => {
        viewport(1440);
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("tab", { name: "Community" }));
        await screen.findByText("G a");
        expect(calls(COMMUNITY)).toEqual(["/api/community?kind=story&offset=0&limit=20"]);
        expect(screen.queryByText("G w")).toBeNull(); // a waifu grid never shows
        expect((screen.getByText("G a").closest("a") as HTMLAnchorElement).getAttribute("href")).toBe("/story/v/a");
        // switching away and back: no refetch
        fireEvent.click(screen.getByRole("tab", { name: "Suggestions" }));
        fireEvent.click(screen.getByRole("tab", { name: "Community" }));
        await flush();
        expect(calls(COMMUNITY)).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "Load more" }));
        await screen.findByText("G b");
        expect(calls(COMMUNITY)[1]).toBe("/api/community?kind=story&offset=20&limit=20");
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
        expect(calls(AI)).toHaveLength(0);
    });
    it("there is no Gallery tab (removed)", async () => {
        viewport(1440);
        render(<StoryBuilder />);
        await screen.findByRole("tab", { name: "Community" });
        expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Suggestions", "Community"]);
        expect(screen.queryByText("Gallery")).toBeNull();
    });
    it("a story card without imageUrl shows a mosaic of its cell images via the proxy, not 'No Preview'", async () => {
        viewport(1440);
        fetchMock.mockImplementation(async (u: string) => COMMUNITY.test(String(u))
            ? new Response(JSON.stringify({ grids: [{ ...summary("m"), previews: ["https://s4.anilist.co/1.jpg", "https://s4.anilist.co/2.jpg", "https://s4.anilist.co/3.jpg", "https://s4.anilist.co/4.jpg"] }, summary("n")], nextOffset: null, hasMore: false, total: 2 }))
            : new Response(JSON.stringify({ items: [] })));
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("tab", { name: "Community" }));
        await screen.findByText("G m");
        const mosaic = within(screen.getByText("G m").closest("a")!).getByTestId("community-mosaic");
        const srcs = [...mosaic.querySelectorAll("img")].map((i) => i.getAttribute("src"));
        expect(srcs).toHaveLength(4);
        for (const s of srcs) expect(s).toMatch(/^\/api\/img\?/);
        // no previews and no imageUrl -> the placeholder
        expect(within(screen.getByText("G n").closest("a")!).getByText("No Preview")).toBeTruthy();
    });
});
