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
function dto(answerId: number, wrong: number[], done: GachaRound["done"] = null, bought = 0, r2 = false): RoundDto {
    const round: GachaRound = {
        day: DAY, animeId: 9001, answerId, guesses: wrong, bought, done, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false,
        ...(r2 ? { rules: 2 as const } : {}),
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

describe("hint slots (legacy round: a free hint per wrong guess)", () => {
    const slotsOf = (c: HTMLElement) =>
        [...c.querySelectorAll<HTMLElement>(".g-hint")].map((el) => `${el.dataset.hint}${el.classList.contains("missing") ? ":missing" : ""}`);

    it("always five slots; real hints first, empty slots last and only once reached", () => {
        // 105 Eisen: no JP voice actor -> 4 real hints
        const three = view(dto(105, [101, 102, 103]));
        expect(slotsOf(three)).toEqual(["eyes", "silhouette", "blur", "locked", "locked"]);
        expect(three.querySelector(".g-hint.missing")).toBeNull();
        expect(three.textContent).not.toContain("ไม่นับเป็นคำใบ้");
        cleanup();
        // slot 5 reached by buying it: empty, unnamed, refunded
        const c = view(dto(105, [101, 102, 103, 104], null, 1));
        // every slot is open now, so the empty one may be named
        expect(slotsOf(c)).toEqual(["eyes", "silhouette", "blur", "initial", "va:missing"]);
        const empty = c.querySelector(".g-hint.missing")!;
        expect(empty.textContent).toContain("นักพากย์ญี่ปุ่น");
        expect(empty.textContent).toContain("ไม่มีข้อมูล");
        expect(empty.textContent).toContain("คืนเหรียญแล้ว");
        cleanup();
        // reached but not every slot open: the empty slot stays unnamed (legacy 3 wrongs: slot 4 = initial is real,
        // so use a round where the 5th is still locked)
        const mid = view(dto(105, [101, 102, 103], null, 1));
        expect(slotsOf(mid)).toEqual(["eyes", "silhouette", "blur", "initial", "locked"]);
        expect(mid.querySelector(".g-hint.missing")).toBeNull();
        cleanup();
        const c2 = view(dto(105, [101, 102, 103, 104], null, 1));
        expect(c2.textContent).toContain("ไม่นับเป็นคำใบ้");
        // the initial hint: first letter + one box per letter, nothing else
        const initial = c2.querySelector('.g-hint[data-hint="initial"]')!;
        expect(initial.textContent).toContain("E");
        expect(initial.textContent).not.toContain("Eisen");
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
        // 105 has no voice actor; with one hint open none of that may leak
        const round = dto(105, [101]);
        const { open, ...rest } = round.hints;
        for (const kind of ["eyes", "va", "silhouette", "blur", "initial"]) expect(JSON.stringify(rest)).not.toContain(`"${kind}"`);
        expect(round.hints.missing).toEqual([]);
        expect(open.map((h) => h.key)).toEqual(["eyes"]);
        const c = view(round);
        const slots = [...c.querySelectorAll<HTMLElement>(".g-hint")].map((el) => el.dataset.hint);
        expect(slots).toEqual(["eyes", "locked", "locked", "locked", "locked"]);
        expect(c.querySelectorAll('.g-hint[data-hint="locked"]')[0].textContent).toContain("คำใบ้ลับ");
        expect(c.querySelector(".g-hint.missing")).toBeNull();
        expect(c.querySelector(".g-shoprow")!.textContent).toContain("คำใบ้ข้อที่ 2");
        expect(c.querySelector(".g-shoprow")!.textContent).not.toMatch(/เงา|ภาพเบลอ|นักพากย์|ตัวอักษร/);
    });

    it("a finished round shows the 'no data' slots even with hints still locked", () => {
        const c = view(dto(105, [105], "won"));
        expect([...c.querySelectorAll<HTMLElement>(".g-hint.missing")].map((el) => el.dataset.hint)).toEqual(["va"]);
        expect(slotsOf(c)).toEqual(["eyes", "silhouette", "blur", "initial", "va:missing"]);
        expect(c.textContent).not.toContain("คืนเหรียญแล้ว"); // nothing was bought
    });
});

describe("r2 round: feedback rows, bought hints count, share", () => {
    it("a wrong guess adds a feedback row with a symbol and text in every cell, and opens no hint", () => {
        const round = dto(101, [103, 151], null, 0, true);
        expect(round.hints.open).toHaveLength(0);
        const c = view(round);
        expect(c.querySelectorAll('.g-hint[data-hint="locked"]')).toHaveLength(5);
        const rows = [...c.querySelectorAll<HTMLElement>('.g-fb [role="row"][aria-label]')];
        expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Stark", "Sein"]);
        for (const r of rows) {
            const cells = [...r.querySelectorAll<HTMLElement>('[role="cell"]')];
            expect(cells).toHaveLength(6);
            for (const cell of cells) {
                expect(cell.querySelector("svg, .g-ico, [data-icon]") ?? cell.firstElementChild).not.toBeNull(); // colour is never alone
                expect(cell.textContent!.length).toBeGreaterThan(0);
                expect(cell.getAttribute("aria-label")).toMatch(/: /);
            }
        }
        // Sein: no card, so the guess list shows an initial tile instead of art
        expect(c.querySelector(".g-noface")).not.toBeNull();
        expect(c.textContent).toContain("ไม่มีข้อมูล"); // legend explains "?"
    });

    it("missing data shows '?' and is never coloured as a hit", () => {
        const round = dto(101, [104], null, 0, true); // Himmel: age "Unknown", no month
        const fb = Object.fromEntries(round.guesses[0].feedback.map((f) => [f.col, f]));
        expect(fb.age.state).toBe("unknown");
        expect(fb.month.state).toBe("unknown");
        const c = view(round);
        const unknown = [...c.querySelectorAll<HTMLElement>(".g-cell.s-unknown[role='cell']")];
        expect(unknown.length).toBeGreaterThanOrEqual(2);
        for (const u of unknown) expect(u.textContent).toContain("?");
    });

    it("the stake ignores bought hints; a won round offers the copy button", async () => {
        const playing = view(dto(101, [103], null, 1, true));
        expect(playing.textContent).not.toContain("นับคำใบ้ที่ซื้อ");
        expect(playing.querySelector(".g-ladder li.on .t-sr")).not.toBeNull(); // 1 wrong guess: next guess is SR, the hint does not count
        cleanup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const c = view(dto(101, [103, 101], "won", 0, true));
        const btn = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("คัดลอกผลลัพธ์"))!;
        expect(btn).toBeTruthy();
        btn.click();
        await vi.waitFor(() => expect(btn.textContent).toContain("คัดลอกแล้ว"));
        const text = writeText.mock.calls[0][0] as string;
        expect(text.split("\n")[0]).toBe("waifu100 Daily #" + text.split("\n")[0].split("#")[1]);
        expect(text).toMatch(/^waifu100 Daily #\d+ 2\/6\n/);
        expect(text).not.toMatch(/Frieren|Stark/);
        expect(text.split("\n")[2]).toBe("🟩🟩🟩🟩🟩🟩");
        expect(c.querySelector("[role='alert'], [role='dialog'], [role='tooltip']")).toBeNull();
    });

    it("a failed clipboard write falls back to an inline text box, not a popup", async () => {
        Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
        const c = view(dto(101, [102, 103, 104, 105, 106, 107], "lost", 0, true));
        const btn = [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("คัดลอกผลลัพธ์"))!;
        btn.click();
        await vi.waitFor(() => expect(c.querySelector(".g-sharebox textarea")).not.toBeNull());
        expect((c.querySelector(".g-sharebox textarea") as HTMLTextAreaElement).value).toMatch(/ X\/6\n/);
    });
});
