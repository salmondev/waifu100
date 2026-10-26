import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";

vi.mock("@/lib/redis", () => ({ withRedis: async () => { throw new Error("no redis in tests"); } }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
// The top bar's counter renders a plain `motion.span`, which strict LazyMotion rejects in the test DOM.
vi.mock("@animate-ui/react/primitives/texts/sliding-number", () => ({ SlidingNumber: ({ number }: { number: number }) => <span>{number}</span> }));

import { indexCatalog } from "@/server/gacha/catalog";
import { roundDto, type RoundDto } from "@/server/gacha/service";
import type { GachaProfile, GachaRound } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { GachaApp } from "./gacha-app";

const idx = indexCatalog(FIXTURE_CATALOG);
const YESTERDAY = "2026-10-26";
const TODAY = "2026-10-27";

/** Yesterday's round as the server serialises it when "today" is `serverToday`. */
function dto(serverToday: string, guesses: number[] = [], bought = 0): RoundDto {
    const round: GachaRound = {
        day: YESTERDAY, animeId: 9001, answerId: 101, guesses, bought, done: null, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false, rules: 2,
    } as GachaRound;
    const profile = { coins: 50, rounds: { [YESTERDAY]: round }, finishedDays: [], collection: {}, storySeen: [] } as unknown as GachaProfile;
    return roundDto(profile, round, idx, serverToday, "app-test-salt");
}

// Jump every motion animation to its end state. Otherwise unmount cancels running WAAPI
// animations, and happy-dom rejects their `finished` promise ("The animation was canceled"),
// which vitest reports as an unhandled error and the run exits 1.
beforeAll(() => {
    MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
    MotionGlobalConfig.skipAnimations = false;
});
beforeEach(() => {
    if (!("fonts" in document)) Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("GachaApp past Bangkok midnight", () => {
    it("a hint / guess reply for the round on screen updates it even though it now comes back archive=true", async () => {
        const loaded = dto(YESTERDAY);
        expect(loaded.archive).toBe(false);
        const wrong = loaded.candidates.find((x) => x.id !== 101)!;
        const afterHint = dto(TODAY, [], 1);
        const afterGuess = dto(TODAY, [wrong.id], 1);
        expect(afterHint.archive).toBe(true);
        expect(afterHint.day.key).toBe(YESTERDAY);
        const fetchMock = vi.fn(async (url: string) => {
            const body = url.startsWith("/api/gacha/today") ? loaded : url === "/api/gacha/hint" ? afterHint : afterGuess;
            return new Response(JSON.stringify(body), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);

        const c = render(<GachaApp />).container;
        await vi.waitFor(() => expect(c.querySelector(".g-track-h em")).not.toBeNull());
        const left = () => Number(c.querySelector(".g-track-h em")!.textContent);
        const leftBefore = left();
        expect(c.querySelector(".g-fbrow")).toBeNull();
        expect(c.textContent).not.toContain("ซื้อแล้ว");

        fireEvent.click([...c.querySelectorAll("button")].find((b) => b.textContent?.includes("30"))!);
        await vi.waitFor(() => expect(c.querySelector(".g-hint.open")?.textContent).toContain("ซื้อแล้ว"));
        // slot 1 now shows the bought hint itself, not the lock
        const slot1 = c.querySelector(".g-hints .g-hint")!;
        expect(slot1.getAttribute("data-hint")).toBe(afterHint.hints.open[0].key);
        expect(slot1.textContent).not.toContain("ยังไม่ได้ซื้อ");
        expect(slot1.querySelector(".g-lock")).toBeNull();

        await vi.waitFor(() => expect((c.querySelector("#go") as HTMLButtonElement).disabled).toBe(false));
        fireEvent.change(c.querySelector("input")!, { target: { value: wrong.name } });
        fireEvent.click(c.querySelector("#go")!);
        await vi.waitFor(() => expect(c.querySelector(".g-fbrow")).not.toBeNull());
        expect(c.querySelector(".g-fbrow")!.textContent).toContain(wrong.name);
        expect(left()).toBe(leftBefore - 1);
        expect(fetchMock.mock.calls.map((x) => x[0])).toEqual(["/api/gacha/today", "/api/gacha/hint", "/api/gacha/guess"]);
    });
});
