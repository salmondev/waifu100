import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("@/lib/redis", () => ({ withRedis: async () => { throw new Error("no redis in tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { indexCatalog } from "@/server/gacha/catalog";
import { roundDto, type ArchiveDto } from "@/server/gacha/service";
import type { GachaProfile, GachaRound } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { ArchiveView } from "./archive";
import { PlayView } from "./play";

const idx = indexCatalog(FIXTURE_CATALOG);
const TODAY = "2026-10-27";
const PAST = "2026-10-20";

beforeEach(() => {
    if (!("fonts" in document)) Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const archive: ArchiveDto = {
    today: { key: TODAY, number: 31, state: "playing" },
    days: [
        { key: "2026-10-26", number: 30, state: "won", tier: "sr" },
        { key: "2026-10-25", number: 29, state: "lost", tier: null },
        { key: "2026-10-24", number: 28, state: "playing", tier: null },
        { key: "2026-10-23", number: 27, state: "new", tier: null },
    ],
};

describe("ArchiveView", () => {
    it("lists each day with a text + symbol state and links into /daily (no new top-level route)", () => {
        const c = render(<ArchiveView archive={archive} />).container;
        const links = [...c.querySelectorAll<HTMLAnchorElement>(".g-arch-day")];
        expect(links.map((a) => a.getAttribute("href"))).toEqual(archive.days.map((d) => `/daily?day=${d.key}`));
        expect(links.map((a) => a.querySelector(".g-arch-st")!.textContent)).toEqual(["เดาถูกSR", "ไม่ได้การ์ด", "เล่นค้างไว้", "ยังไม่เล่น"]);
        for (const a of links) expect(a.querySelector(".g-arch-st svg, .g-arch-st i, .g-arch-st span")).not.toBeNull();
        expect(c.querySelector(".g-arch-today")!.getAttribute("href")).toBe("/daily");
        expect(c.textContent).toContain("เล่นได้อีก 1 วัน");
        expect(c.textContent).toContain("ไม่นับวันติดกัน");
        expect(c.querySelector("[role=dialog], [role=alert], [role=tooltip]")).toBeNull();
    });
});

describe("PlayView on an archive day", () => {
    function pastDto(done: GachaRound["done"] = null) {
        const round: GachaRound = {
            day: PAST, animeId: 9001, answerId: 101, guesses: done ? [101] : [], bought: 0, done, dailyCoins: 0, bonus: 0,
            pull: done === "won" ? { tier: "ssr", result: "new", prevTier: null } : null, storyUnlockedNow: false, rules: 2, archive: true,
        } as GachaRound;
        const profile = { coins: 40, rounds: { [PAST]: round }, finishedDays: [], collection: {}, storySeen: [] } as unknown as GachaProfile;
        return roundDto(profile, round, idx, TODAY, "arch-test-salt");
    }

    it("says it is a past day, shows no daily coins, and sends the day with every guess", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(pastDto()), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const dto = pastDto();
        expect(dto.archive).toBe(true);
        const c = render(<PlayView round={dto} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;
        expect(c.textContent).toContain("รอบย้อนหลัง");
        expect(c.textContent).toContain("ไม่มีเหรียญรายวัน");
        expect(c.textContent).not.toContain("รับฟรีวันนี้");
        expect(c.querySelector('a[href="/daily"]')).not.toBeNull();
        // buy the first hint: the body carries the archive day
        const buy = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("15"))!;
        fireEvent.click(buy);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("/api/gacha/hint");
        expect(JSON.parse(String(init.body))).toEqual({ slot: 1, day: PAST });
    });

    it("a finished past day is a result view with no guess box", () => {
        const c = render(<PlayView round={pastDto("won")} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;
        expect(c.querySelector("input")).toBeNull();
        expect(c.querySelector(".g-shop")).toBeNull();
        expect(c.textContent).toContain("เดาถูก");
    });
});
