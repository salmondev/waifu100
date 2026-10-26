import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { AlbumView } from "./album";
import type { AlbumDto } from "./api";

const card = (n: number) => ({
    id: 100 + n, name: `C${n}`, nameNative: null, image: `https://s4.anilist.co/c${n}.png`, number: `00${n}`, tier: "rare" as const,
    setCode: "FRN", animeId: 9001, day: "2026-10-2" + n,
});

const album = (fresh: boolean): AlbumDto => ({
    coins: 10, streak: 1, owned: 3, total: 8,
    anime: [{
        id: 9001, titleRomaji: "Sousou no Frieren", titleEnglish: "Frieren", titleNative: null, cover: "https://s4.anilist.co/cover.png",
        coverColor: "#e4e0d6", setCode: "FRN", owned: 3, total: 8, story: { unlocked: true, fresh },
        cards: [card(1), card(2), card(3)],
    }],
}) as unknown as AlbumDto;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
    // happy-dom has no FontFaceSet; card.tsx waits on it to size titles
    if (!("fonts" in document)) Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ animeId: 9001, fresh: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const storyCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("story-seen"));

describe("album story card 'new' mark", () => {
    it("rendering (even StrictMode double effects) never marks it seen", async () => {
        render(<StrictMode><AlbumView album={album(true)} round={null} animeParam={null} onRestored={() => {}} /></StrictMode>);
        await act(async () => {});
        expect(screen.getByText(/แตะเพื่อเก็บ/)).toBeTruthy();
        expect(storyCalls()).toHaveLength(0);
    });

    it("a tap POSTs once, clears the tag, and the card stops being a button", async () => {
        render(<AlbumView album={album(true)} round={null} animeParam={null} onRestored={() => {}} />);
        const tap = screen.getByRole("button", { name: /สตอรี่การ์ดใหม่/ });
        await act(async () => void fireEvent.click(tap));
        expect(storyCalls()).toHaveLength(1);
        const [url, init] = storyCalls()[0];
        expect(url).toBe("/api/gacha/story-seen");
        expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ animeId: 9001 }) });
        expect(screen.queryByText(/แตะเพื่อเก็บ/)).toBeNull();
        expect(screen.queryByRole("button", { name: /สตอรี่การ์ดใหม่/ })).toBeNull();
    });

    it("a failed save brings the tag back so the next tap retries", async () => {
        fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
        render(<AlbumView album={album(true)} round={null} animeParam={null} onRestored={() => {}} />);
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: /สตอรี่การ์ดใหม่/ })));
        await act(async () => {});
        expect(screen.getByText(/แตะเพื่อเก็บ/)).toBeTruthy();
    });

    it("an already-seen story card is not a button", () => {
        render(<AlbumView album={album(false)} round={null} animeParam={null} onRestored={() => {}} />);
        expect(screen.queryByRole("button", { name: /สตอรี่การ์ดใหม่/ })).toBeNull();
        expect(screen.queryByText(/แตะเพื่อเก็บ/)).toBeNull();
    });
});
