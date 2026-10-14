import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StoryItem } from "@/lib/share-schema";
import type { StoredShare as DecodedShare } from "@/lib/share-store";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story/compare", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/my-grids", () => ({ useMyGrids: () => mine }));
const readShares = vi.fn();
const readShare = vi.fn();
vi.mock("@/lib/share-store", () => ({ readShares: (...a: unknown[]) => readShares(...a), readShare: (...a: unknown[]) => readShare(...a) }));

import { CMP, CMP_SOURCES } from "@/components/story/compare-styles";
import { StoryCompareView } from "@/components/story/StoryCompareView";
import { StoryComparePicker } from "@/components/story/StoryComparePicker";
import { compareStoryGrids } from "@/lib/story/compare";
import StoryComparePage from "@/app/story/compare/page";

let mine: { id: string; title: string; kind?: string; count: number; imageUrl: null; createdAt: string; hasGif: boolean; size?: number }[] = [];
const item = (id: number): StoryItem => ({ id, type: "ANIME", title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" });
const share = (id: string, items: (StoryItem | null)[], over: Partial<DecodedShare> = {}): DecodedShare =>
    ({ version: 2, kind: "story", size: items.length, cols: null, title: `Grid ${id}`, imageUrl: null, createdAt: null, userId: null, grid: [], items, images: [], count: items.filter(Boolean).length, titleStyle: "overlay", verdict: null, verdictFeedback: {} as never, id, ...over }) as DecodedShare;
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => item(from + i));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    mine = [];
    push.mockReset();
    readShares.mockReset();
    readShare.mockReset();
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ grids: [], nextOffset: null })));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("compare styles are waifu's", () => {
    it("every class string appears verbatim in the waifu source it was copied from", () => {
        for (const [k, cls] of Object.entries(CMP)) {
            const src = readFileSync(resolve(__dirname, "../..", CMP_SOURCES[k as keyof typeof CMP]), "utf8");
            expect(src.includes(cls), `${k} drifted from ${CMP_SOURCES[k as keyof typeof CMP]}`).toBe(true);
        }
    });
});

describe("StoryCompareView", () => {
    const view = (A: DecodedShare, B: DecodedShare) =>
        render(<StoryCompareView a={{ id: "a", title: A.title, imageUrl: null, size: A.size, cols: A.cols, items: A.items }} b={{ id: "b", title: B.title, imageUrl: null, size: B.size, cols: B.cols, items: B.items }} result={compareStoryGrids(A.items, B.items)} />);

    it("identical grids: 100%, all shared, nothing only-in, waifu nav + copy colours", async () => {
        const g = range(1, 9);
        view(share("a", g), share("b", [...g]));
        expect(screen.getByTestId("story-similarity").textContent).toBe("100%");
        expect(screen.getByText("9 titles in common")).toBeTruthy();
        expect(screen.getByText("Suspiciously similar taste.")).toBeTruthy();
        expect(screen.getAllByText("Nothing - every pick is shared.")).toHaveLength(2);
        expect(screen.getByRole("link", { name: /Community Showcase/ }).getAttribute("href")).toBe("/community?kind=story");
        expect(screen.getByRole("link", { name: /Compare others/ }).getAttribute("href")).toBe("/story/compare?a=a");
        const writeText = vi.fn(async () => {});
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
        const btn = screen.getByRole("button", { name: /Copy Link/ });
        expect(btn.className).toContain(CMP.copyIdle);
        await act(async () => fireEvent.click(btn));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/story/compare?a=a&b=b`);
        expect(screen.getByRole("button", { name: /Link Copied!/ }).className).toContain(CMP.copyDone);
    });

    it("nothing in common: 0% and both only-in lists", () => {
        view(share("a", range(1, 3)), share("b", range(10, 3)));
        expect(screen.getByTestId("story-similarity").textContent).toBe("0%");
        expect(screen.getByText("Nothing in common. Completely different shelves.")).toBeTruthy();
        expect(screen.queryByText("Both of you")).toBeNull();
    });

    it("long only-in lists collapse to 12 with Show more", () => {
        view(share("a", range(1, 25)), share("b", range(100, 25)));
        const more = screen.getAllByRole("button", { name: "Show 13 more" });
        expect(more).toHaveLength(2);
        fireEvent.click(more[0]);
        expect(screen.getAllByRole("button", { name: /Show \d+ more/ })).toHaveLength(1);
    });

    it("keeps non-square layouts (cols) for each side", () => {
        view(share("a", range(1, 12), { cols: 4 }), share("b", range(1, 6), { cols: 6 }));
        expect(screen.getByTestId("story-compare-grid-a").dataset.cols).toBe("4");
        expect(screen.getByTestId("story-compare-grid-b").dataset.cols).toBe("6");
        expect(screen.getByText("12/12 titles")).toBeTruthy();
    });

    it("makes no network request", () => {
        view(share("a", range(1, 3)), share("b", range(1, 3)));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("StoryComparePicker", () => {
    const g = (id: string, kind: "story" | "waifu" = "story") => ({ id, title: `Grid ${id}`, kind, count: 3, size: 9, imageUrl: null, createdAt: "", hasGif: false });

    it("loads only the story feed, filters other kinds, picks A then B and navigates", async () => {
        mine = [g("mine"), g("w", "waifu")];
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ grids: [g("x"), g("y", "waifu")], nextOffset: null })));
        render(<StoryComparePicker />);
        await screen.findByText("Grid x");
        expect(urls()).toEqual(["/api/community?offset=0&limit=50&kind=story"]);
        expect(screen.queryByText("Grid y")).toBeNull();
        expect(screen.queryByText("Grid w")).toBeNull();
        const go = screen.getByRole("button", { name: /Pick two grids to compare/ });
        expect(go.className).toContain(CMP.goIdle);
        fireEvent.click(screen.getByText("Grid mine"));
        fireEvent.click(screen.getByText("Grid x"));
        const ready = screen.getByRole("button", { name: /Compare these two/ });
        expect(ready.className).toContain(CMP.goReady);
        fireEvent.click(ready);
        expect(push).toHaveBeenCalledWith("/story/compare?a=mine&b=x");
    });

    it("error, empty and load-more states", async () => {
        fetchMock.mockResolvedValueOnce(new Response("x", { status: 500 }));
        const { unmount } = render(<StoryComparePicker />);
        expect(await screen.findByText("Couldn't load the showcase. Try again in a moment.")).toBeTruthy();
        unmount();
        render(<StoryComparePicker />);
        expect(await screen.findByText("No story grids yet.")).toBeTruthy();
        cleanup();
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ grids: [g("p")], nextOffset: 50 })));
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ grids: [g("q")], nextOffset: null })));
        render(<StoryComparePicker />);
        fireEvent.click(await screen.findByRole("button", { name: /Load more grids/ }));
        await screen.findByText("Grid q");
        expect(screen.queryByRole("button", { name: /Load more grids/ })).toBeNull();
    });

    it("preset A focuses slot B; tapping a picked tile un-picks it", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ grids: [g("a"), g("b")], nextOffset: null })));
        render(<StoryComparePicker initialA={g("a")} />);
        await screen.findByText("Grid b");
        fireEvent.click(screen.getByText("Grid b"));
        expect(screen.getByRole("button", { name: /Compare these two/ })).toBeTruthy();
        fireEvent.click(screen.getAllByText("Grid b")[1] ?? screen.getAllByText("Grid b")[0]);
        await waitFor(() => expect(screen.getByRole("button", { name: /Pick two grids/ })).toBeTruthy());
    });
});

describe("/story/compare page states (mocked share-store)", () => {
    const page = async (a?: string, b?: string) => render(await StoryComparePage({ searchParams: Promise.resolve({ a, b }) }));

    it("no ids -> picker", async () => {
        await page();
        expect(screen.getByTestId("story-compare-picker")).toBeTruthy();
        expect(readShares).not.toHaveBeenCalled();
    });
    it("same id twice -> picker with notice, preset A", async () => {
        readShare.mockResolvedValue(share("a", range(1, 3)));
        await page("a", "a");
        expect(screen.getByText(/same grid twice/)).toBeTruthy();
        expect(screen.getAllByText("Grid a").length).toBeGreaterThan(0);
    });
    it("missing grid -> gone state", async () => {
        readShares.mockResolvedValue([share("a", range(1, 3)), null]);
        await page("a", "b");
        expect(screen.getByText("One of these grids is gone")).toBeTruthy();
    });
    it("waifu grid -> can't compare", async () => {
        readShares.mockResolvedValue([share("a", range(1, 3)), share("b", [], { kind: "waifu" })]);
        await page("a", "b");
        expect(screen.getByText("These grids can't be compared")).toBeTruthy();
    });
    it("store error -> unavailable, not a 500", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        readShares.mockRejectedValue(new Error("redis down"));
        await page("a", "b");
        expect(screen.getByText("Compare is unavailable right now")).toBeTruthy();
    });
    it("two story grids -> comparison", async () => {
        readShares.mockResolvedValue([share("a", range(1, 4)), share("b", range(3, 4), { cols: 2 })]);
        await page("a", "b");
        expect(screen.getByTestId("story-similarity").textContent).toBe("50%");
        expect(screen.getByTestId("story-compare-grid-b").dataset.cols).toBe("2");
    });
});
