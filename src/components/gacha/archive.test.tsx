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
    today: { key: TODAY, number: 31, state: "playing", tier: null },
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
    it("the today button shows today's real state and tier (won today: a tier chip, not '?')", () => {
        const c = render(<ArchiveView archive={{ ...archive, today: { key: TODAY, number: 31, state: "won", tier: "ssr" } }} />).container;
        const st = c.querySelector(".g-arch-today .g-arch-st")!;
        expect(st.className).toContain("won");
        expect(st.textContent).toBe("เดาถูกSSR");
        cleanup();
        const lost = render(<ArchiveView archive={{ ...archive, today: { key: TODAY, number: 31, state: "lost", tier: null } }} />).container;
        expect(lost.querySelector(".g-arch-today .g-arch-st")!.textContent).toBe("ไม่ได้การ์ด");
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

    it("says it is a past day, promises the daily coins on finish, and sends the day with every guess", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(pastDto()), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const dto = pastDto();
        expect(dto.archive).toBe(true);
        const c = render(<PlayView round={dto} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;
        expect(c.textContent).toContain("รอบย้อนหลัง");
        expect(c.textContent).toContain("จบรอบรับ +10");
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

    it("today's round also names its day on every hint buy and guess (a page left open past midnight)", async () => {
        const round: GachaRound = {
            day: TODAY, animeId: 9001, answerId: 101, guesses: [], bought: 0, done: null, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false, rules: 2,
        } as GachaRound;
        const profile = { coins: 40, rounds: { [TODAY]: round }, finishedDays: [], collection: {}, storySeen: [] } as unknown as GachaProfile;
        const dto = roundDto(profile, round, idx, TODAY, "arch-test-salt");
        expect(dto.archive).toBe(false);
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(dto), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        const c = render(<PlayView round={dto} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;
        fireEvent.click([...c.querySelectorAll("button")].find((b) => b.textContent?.includes("15"))!);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [hintUrl, hintInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(hintUrl).toBe("/api/gacha/hint");
        expect(JSON.parse(String(hintInit.body))).toEqual({ slot: 1, day: TODAY });
        const name = dto.candidates.find((x) => x.id !== 101)!;
        await vi.waitFor(() => expect((c.querySelector("#go") as HTMLButtonElement).disabled).toBe(false));
        fireEvent.change(c.querySelector("input")!, { target: { value: name.name } });
        fireEvent.click(c.querySelector("#go")!);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [guessUrl, guessInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
        expect(guessUrl).toBe("/api/gacha/guess");
        expect(JSON.parse(String(guessInit.body))).toEqual({ charId: name.id, day: TODAY });
    });

    it("a finished past day is a result view with no guess box", () => {
        const c = render(<PlayView round={pastDto("won")} onRound={() => {}} onOpenPack={() => {}} opened={false} />).container;
        expect(c.querySelector("input")).toBeNull();
        expect(c.querySelector(".g-shop")).toBeNull();
        expect(c.textContent).toContain("เดาถูก");
    });
});
