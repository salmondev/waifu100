import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryView } from "@/components/story/StoryView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story/v/x", useSearchParams: () => new URLSearchParams() }));

const item = (id: number) => ({ id, type: "ANIME" as const, title: `T${id}`, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" as const });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("story view page follows waifu's view page", () => {
    it("waifu header: Community Showcase + Create Your Own (story targets), gradient title, Copy Link", async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
        render(<StoryView id="abc" title="My Picks" size={9} items={Array.from({ length: 9 }, (_, i) => (i < 3 ? item(i + 1) : null))} />);
        expect(screen.getByRole("link", { name: /Community Showcase/ }).getAttribute("href")).toBe("/community?kind=story");
        expect(screen.getByRole("link", { name: /Create Your Own/ }).getAttribute("href")).toBe("/story");
        const h1 = screen.getByRole("heading", { level: 1, name: "My Picks" });
        expect(h1.className).toContain("from-purple-400 via-pink-500 to-purple-400");
        expect(screen.getByTestId("story-count").textContent).toBe("3/9 titles");
        expect(screen.getByTestId("story-view-grid").className).toContain("border-2 border-zinc-800 bg-black");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy Link/ })); });
        expect(writeText).toHaveBeenCalledWith(window.location.href);
        expect(screen.getByRole("button", { name: /Link Copied!/ })).toBeTruthy();
    });
    it("no AI (or any) fetch on mount; the verdict only runs on click", async () => {
        render(<StoryView id="abc" title="t" size={10} items={Array.from({ length: 10 }, (_, i) => item(i + 1))} />);
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: /Generate AI Verdict/ })).toBeTruthy();
    });
    it("A-J / 1-10 coordinate labels only on a 10x10 board (like waifu's 100 grid)", () => {
        render(<StoryView id="a" title="t" size={100} items={Array.from({ length: 100 }, () => null)} />);
        expect(screen.getByText("J")).toBeTruthy();
        cleanup();
        render(<StoryView id="b" title="t" size={10} items={Array.from({ length: 10 }, () => null)} />);
        expect(screen.queryByText("J")).toBeNull();
    });
    it("a together grid invites the reader to start a session; other grids do not", () => {
        render(<StoryView id="abc" title="t" size={9} items={Array.from({ length: 9 }, () => null)} />);
        expect(screen.queryByRole("button", { name: "Build Grid Together" })).toBeNull();
        cleanup();
        render(<StoryView id="abc" title="t" size={9} together items={Array.from({ length: 9 }, () => null)} />);
        expect(screen.getByRole("button", { name: "Build Grid Together" })).toBeTruthy();
        const badge = screen.getByTestId("together-badge");
        expect(badge.textContent).toBe("Together");
        expect(badge.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });
});
