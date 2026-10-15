import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryView } from "@/components/story/StoryView";
import { storyVerdictTitles } from "@/lib/story/verdict-titles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story/v/x", useSearchParams: () => new URLSearchParams() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("story view page: tapping a cell opens the story card", () => {
    it("filled cell -> card with details (mocked /api/story/info), empty cell does nothing", async () => {
        const fetchMock = vi.fn(async (u: string) =>
            String(u).startsWith("/api/story/info")
                ? new Response(JSON.stringify({ info: { title: "Frieren", altTitles: [], type: "ANIME", synopsis: "An elf mage outlives her party.", format: "TV", year: 2023, status: "Finished", episodes: 28, chapters: null, volumes: null, genres: [], score: null, url: null, source: "anilist" } }))
                : new Response("{}")
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<StoryView id="abc" title="t" size={9} items={[{ id: 7, type: "ANIME", title: "Frieren", cover: "https://s4.anilist.co/7.jpg", src: "anilist" }, ...Array.from({ length: 8 }, () => null)]} />);
        expect(screen.queryByTestId("story-cell-card")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: /1\. Frieren/ }));
        expect(await screen.findByText("An elf mage outlives her party.")).toBeTruthy();
        const imgs = screen.getByTestId("story-cell-card").querySelectorAll("img");
        imgs.forEach((i) => expect(i.getAttribute("src")).toMatch(/^\/api\/img\?u=/));
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByTestId("story-cell-card")).toBeNull();
        expect(screen.queryByRole("button", { name: /Empty slot/ })).toBeNull();
    });

    it("verdict prompt labels light novels as such", () => {
        expect(storyVerdictTitles([{ id: 1, type: "NOVEL", title: "LN", cover: "https://s4.anilist.co/x.jpg" }, null])).toEqual(["LN (light novel)"]);
    });
});
