import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StoryCellCardProvider, useOpenStoryCellAt } from "@/components/story/StoryCellCard";
import { MediaGrid } from "@/components/grid/MediaGrid";
import type { StoryItem } from "@/lib/share-schema";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Grid({ items }: { items: (StoryItem | null)[] }) {
    const open = useOpenStoryCellAt(items);
    return <MediaGrid items={items} columns={3} toCell={(i) => ({ key: String(i.id), image: i.cover, label: i.title })} onSelect={open} clickable />;
}

describe("StoryCellCard", () => {
    it("clicking a cell opens the card with synopsis and facts from /api/story/info", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ info: { title: "Frieren", altTitles: [], type: "ANIME", synopsis: "An elf mage.", format: "TV", year: 2023, status: "Finished", episodes: 28, chapters: null, volumes: null, genres: ["Fantasy"], score: 90, url: null, source: "anilist" } })));
        vi.stubGlobal("fetch", fetchMock);
        render(<StoryCellCardProvider><Grid items={[{ id: 154587, type: "ANIME", title: "Frieren", cover: "https://s4.anilist.co/f.jpg" }, null]} /></StoryCellCardProvider>);
        fireEvent.click(screen.getByRole("button", { name: /1\. Frieren/ }));
        expect(await screen.findByText("An elf mage.")).toBeTruthy();
        expect(screen.getByText("28")).toBeTruthy();
        expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/api/story/info?id=154587&type=ANIME&src=anilist");
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByTestId("story-cell-card")).toBeNull();
    });

    it("uploaded cell: no lookup, Custom badge, friendly no-details text", () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        render(<StoryCellCardProvider><Grid items={[{ id: 1, type: "ANIME", title: "My Movie", cover: "https://abc.public.blob.vercel-storage.com/story/x.png", src: "upload" }]} /></StoryCellCardProvider>);
        fireEvent.click(screen.getByRole("button", { name: /My Movie/ }));
        expect(screen.getByText("Custom")).toBeTruthy();
        expect(screen.getByText(/ไม่มีข้อมูลเรื่องย่อ/)).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
