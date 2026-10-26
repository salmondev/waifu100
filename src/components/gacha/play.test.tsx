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
function dto(answerId: number, wrong: number[], done: GachaRound["done"] = null, bought = 0): RoundDto {
    const round: GachaRound = {
        day: DAY, animeId: 9001, answerId, guesses: wrong, bought, done, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false,
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
    const slotsOf = (c: HTMLElement) =>
        [...c.querySelectorAll<HTMLElement>(".g-hint")].map((el) => `${el.dataset.hint}${el.classList.contains("missing") ? ":missing" : ""}`);

    it("always five slots; real hints first, empty slots last and only once reached", () => {
        // 105 Eisen: no hair, no quote, no occupation -> 3 real hints
        const three = view(dto(105, [101, 102, 103]));
        expect(slotsOf(three)).toEqual(["role", "silhouette", "blur", "locked", "locked"]);
        expect(three.querySelector(".g-hint.missing")).toBeNull();
        expect(three.textContent).not.toContain("ไม่นับเป็นคำใบ้");
        cleanup();
        // slot 4 reached by buying it: empty, unnamed, refunded
        const c = view(dto(105, [101, 102, 103], null, 1));
        expect(slotsOf(c)).toEqual(["role", "silhouette", "blur", "empty:missing", "locked"]);
        const empty = c.querySelector('.g-hint.missing[data-hint="empty"]')!;
        expect(empty.textContent).toContain("คำใบ้ข้อที่ 4");
        expect(empty.textContent).toContain("ไม่มีข้อมูล");
        expect(empty.textContent).toContain("คืนเหรียญแล้ว");
        expect(empty.textContent).not.toMatch(/สีผม|คำพูด/);
        expect(empty.querySelector("[style*='background']")).toBeNull(); // no swatch
        expect(c.querySelector('.g-hint[data-hint="locked"]')!.textContent).toContain("คำใบ้ลับ");
        expect(c.textContent).toContain("ไม่นับเป็นคำใบ้");
        expect(c.querySelector(".g-shoprow")!.textContent).toContain("คำใบ้ข้อที่ 5");
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

    it("before reveal, nothing says which hint kinds the answer has", () => {
        // 105 has no hair and no quote; with one hint open none of that may leak
        const round = dto(105, [101]);
        const hints = JSON.stringify(round.hints);
        for (const kind of ["hair", "quote", "silhouette", "blur"]) expect(hints).not.toContain(kind);
        expect(round.hints.missing).toEqual([]);
        expect(round.hints.open.map((h) => h.key)).toEqual(["role"]);
        const c = view(round);
        const slots = [...c.querySelectorAll<HTMLElement>(".g-hint")].map((el) => el.dataset.hint);
        expect(slots).toEqual(["role", "locked", "locked", "locked", "locked"]);
        expect(c.querySelectorAll('.g-hint[data-hint="locked"]')[0].textContent).toContain("คำใบ้ลับ");
        expect(c.querySelector(".g-hint.missing")).toBeNull();
        expect(c.querySelector(".g-shoprow")!.textContent).toContain("คำใบ้ข้อที่ 2");
        expect(c.querySelector(".g-shoprow")!.textContent).not.toMatch(/เงา|ภาพเบลอ|สีผม|คำพูด/);
    });

    it("a finished round shows the 'no data' slots even with hints still locked", () => {
        const c = view(dto(105, [105], "won"));
        expect([...c.querySelectorAll<HTMLElement>(".g-hint.missing")].map((el) => el.dataset.hint)).toEqual(["hair", "quote"]);
        expect(slotsOf(c)).toEqual(["role", "silhouette", "blur", "hair:missing", "quote:missing"]);
        expect(c.textContent).not.toContain("คืนเหรียญแล้ว"); // nothing was bought
    });
});
