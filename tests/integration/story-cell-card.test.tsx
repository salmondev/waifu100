// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { StoryCellCard } from "@/components/story/StoryCellCard";

const INFO = { title: "E2E Anime Show", altTitles: ["E2E Romaji"], type: "ANIME", synopsis: "A mocked synopsis for the card.", format: "TV", year: 2024, status: "FINISHED", episodes: 12, chapters: null, volumes: null, genres: ["Action", "Drama"] };
const item = (id: number, src?: "anilist" | "upload") => ({ id, type: "ANIME" as const, title: `E2E Anime Show ${id}`, cover: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-x.jpg", ...(src ? { src } : {}) });
afterEach(cleanup);

describe("story cell detail card", () => {
  it("loads info from /api/story/info (mocked) and shows synopsis + genres; Escape closes", async () => {
    const f = vi.fn(async (u: string) => new Response(JSON.stringify({ info: INFO }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const onClose = vi.fn();
    render(<StoryCellCard item={item(1)} onClose={onClose} />);
    expect(await screen.findByText(/A mocked synopsis/)).toBeTruthy();
    expect(screen.getByText(/Action/)).toBeTruthy();
    expect(String(f.mock.calls[0][0])).toMatch(/^\/api\/story\/info\?/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("error state: info API failure still renders the card without crashing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    render(<StoryCellCard item={item(2)} onClose={() => {}} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
  it("uploaded covers never call the info API", async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    render(<StoryCellCard item={item(3, "upload")} onClose={() => {}} />);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
  });
});
