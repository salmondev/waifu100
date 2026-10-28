import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { AlbumView } from "./album";
import type { AlbumDto } from "./api";

const card = (n: number) => ({
    id: 100 + n, name: `C${n}`, nameNative: null, image: `https://s4.anilist.co/c${n}.png`, number: `00${n}`, tier: "rare" as const,
    setCode: "FRN", animeId: 9001, animeTitle: "Frieren", coverColor: "#e4e0d6", role: "MAIN" as const,
    occupation: "นักเวทย์", gender: "Female", favourites: 1200, day: "2026-10-2" + n,
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

const twoStories = (): AlbumDto => {
    const a = album(false) as unknown as { anime: Record<string, unknown>[] };
    const second = { ...a.anime[0], id: 9002, titleEnglish: "Bocchi", setCode: "BTR", owned: 1, cards: [{ ...card(4), animeId: 9002 }] };
    return { ...a, anime: [a.anime[0], second] } as unknown as AlbumDto;
};

describe("album owned cards open", () => {
    it("an owned card is a button named with the character and tier, and an empty slot is not", () => {
        render(<AlbumView album={album(false)} round={null} animeParam={null} onRestored={() => {}} />);
        expect(screen.getByRole("button", { name: "C1 Rare" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "C2 Rare" })).toBeTruthy();
        expect(document.querySelector('[aria-label="ช่องว่าง 004"]')?.closest("button")).toBeNull();
    });

    it("opens the full card and closes from the button or Escape", async () => {
        render(<AlbumView album={album(false)} round={null} animeParam={null} onRestored={() => {}} />);
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: "C1 Rare" })));
        const dialog = screen.getByRole("dialog");
        expect(dialog.getAttribute("aria-label")).toBe("C1 Rare");
        expect(dialog.querySelector(".c2-mini")).toBeNull();
        expect(dialog.querySelector(".c2-name")?.textContent).toContain("C1");
        expect(dialog.querySelector(".c2-orn")).toBeTruthy();
        expect(dialog.querySelector(".c2-crest")).toBeTruthy();
        expect(dialog.querySelector(".c2-role")?.textContent).toContain("นักเวทย์");
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: "ปิด" })));
        expect(screen.queryByRole("dialog")).toBeNull();
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: "C2 Rare" })));
        expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("C2 Rare");
        await act(async () => void fireEvent.keyDown(window, { key: "Escape" }));
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("share copies the card link for the day they got it", async () => {
        const text = "Rare ★ C1\nwaifu100 Daily #12\nhttps://waifu100.vercel.app/c/Ab3kP9xQ";
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("card-share")) return new Response(JSON.stringify({ text, url: "https://waifu100.vercel.app/c/Ab3kP9xQ" }), { status: 200 });
            return new Response(JSON.stringify({ animeId: 9001, fresh: false }), { status: 200 });
        });
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        render(<AlbumView album={album(false)} round={null} animeParam={null} onRestored={() => {}} />);
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: "C1 Rare" })));
        await act(async () => void fireEvent.click(screen.getByRole("button", { name: "แชร์" })));
        await act(async () => {});
        expect(writeText.mock.calls[0][0]).toBe(text);
        const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("card-share"))!;
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({ day: "2026-10-21" });
        expect(screen.getByRole("button", { name: "คัดลอกแล้ว" })).toBeTruthy();
    });
});

describe("album story tabs", () => {
    it("aria-controls only ever points at a panel that is in the DOM", () => {
        render(<AlbumView album={twoStories()} round={null} animeParam={9002} onRestored={() => {}} />);
        const tabs = screen.getAllByRole("tab");
        expect(tabs).toHaveLength(2);
        for (const t of tabs) {
            const target = t.getAttribute("aria-controls");
            if (target) expect(document.getElementById(target)?.getAttribute("role")).toBe("tabpanel");
        }
        const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
        expect(selected).toHaveLength(1);
        expect(selected[0].textContent).toContain("Bocchi");
        expect(selected[0].getAttribute("aria-controls")).toBeTruthy();
        const panel = screen.getByRole("tabpanel");
        expect(panel.getAttribute("aria-labelledby")).toBe(selected[0].id);
        expect(panel.querySelector(".g-binder")?.getAttribute("aria-label")).toContain("Bocchi");
    });

    it("the selected tab is styled by its own class, not by a separate highlight layer", () => {
        render(<AlbumView album={twoStories()} round={null} animeParam={9001} onRestored={() => {}} />);
        const on = screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")!;
        expect(on.className).toContain("on");
        expect(document.querySelector(".g-tabhl")).toBeNull();
    });
});
