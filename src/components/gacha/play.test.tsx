import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/redis", () => ({ withRedis: async () => { throw new Error("no redis in tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { indexCatalog } from "@/server/gacha/catalog";
import { roundDto, type RoundDto } from "@/server/gacha/service";
import type { GachaProfile, GachaRound } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { PlayView } from "./play";

const idx = indexCatalog(FIXTURE_CATALOG);
const DAY = "2026-10-27";

/** A real DTO from the server's own roundDto, for a fixture answer with gaps. */
function dto(answerId: number, wrong: number[], done: GachaRound["done"] = null): RoundDto {
    const round: GachaRound = {
        day: DAY, animeId: 9001, answerId, guesses: wrong, bought: 0, done, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false,
    };
    const profile = { coins: 50, rounds: { [DAY]: round }, finishedDays: [], collection: {}, storySeen: [] } as unknown as GachaProfile;
    return roundDto(profile, round, idx, DAY, "play-test-salt");
}

beforeEach(() => {
    if (!("fonts" in document)) Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const view = (round: RoundDto) => render(<PlayView round={round} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;

describe("hint slots", () => {
    it("always shows all five kinds; gaps get a 'no data' slot, never a made-up value", () => {
        // 105 Eisen: no hair, no quote, no occupation
        const c = view(dto(105, [101, 102, 103]));
        const kinds = [...c.querySelectorAll<HTMLElement>(".g-hint")].map((el) => `${el.dataset.hint}${el.classList.contains("missing") ? ":missing" : ""}`);
        expect(kinds).toEqual(["role", "silhouette", "blur", "hair:missing", "quote:missing"]);
        const hair = c.querySelector('.g-hint.missing[data-hint="hair"]')!;
        expect(hair.textContent).toContain("ไม่มีข้อมูล");
        expect(hair.querySelector("[style*='background']")).toBeNull(); // no swatch
        expect(c.querySelector('.g-hint[data-hint="quote"] q')).toBeNull();
        expect(c.textContent).toContain("ไม่นับเป็นคำใบ้");
    });

    it("image hints render only the server hint-image URL, never the character art", () => {
        const c = view(dto(105, [101, 102, 103]));
        const srcs = [...c.querySelectorAll<HTMLImageElement>(".g-pic img, .g-frame img")].map((i) => i.getAttribute("src"));
        expect(srcs.length).toBeGreaterThan(0);
        for (const s of srcs) expect(s).toMatch(/^\/api\/gacha\/hint-image\?t=[A-Za-z0-9_-]+$/);
        const art = FIXTURE_CATALOG.anime[0].characters.find((x) => x.id === 105)!.image;
        expect(c.innerHTML).not.toContain(encodeURIComponent(art));
        expect(c.innerHTML).not.toContain(art);
    });

    it("a complete character shows five numbered hints and no 'no data' note", () => {
        const c = view(dto(101, []));
        expect(c.querySelectorAll(".g-hint")).toHaveLength(5);
        expect(c.querySelectorAll(".g-hint.missing")).toHaveLength(0);
        expect(c.textContent).not.toContain("ไม่นับเป็นคำใบ้");
    });
});
