import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("@/lib/redis", () => ({ withRedis: async () => { throw new Error("no redis in tests"); } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock("./pack-scene", () => ({ createPackScene: () => new Promise(() => {}), T: { reveal: 0 } }));

import { indexCatalog } from "@/server/gacha/catalog";
import { roundDto, type RoundDto } from "@/server/gacha/service";
import type { GachaProfile, GachaRound } from "@/server/gacha/store";
import { FIXTURE_CATALOG } from "@/server/gacha/test-fixture";
import { PackView } from "./pack";
import { PlayView } from "./play";

const idx = indexCatalog(FIXTURE_CATALOG);
const DAY = "2026-10-27";

/** A real DTO from the server's own roundDto, for a fixture answer with gaps. */
function dto(answerId: number, wrong: number[], done: GachaRound["done"] = null, bought = 0, r2 = false, extra: Partial<GachaRound> = {}): RoundDto {
    const round: GachaRound = {
        day: DAY, animeId: 9001, answerId, guesses: wrong, bought, done, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false,
        ...(r2 ? { rules: 2 as const } : {}),
        ...extra,
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

describe("free first guess (T-0024): counter, track, result line", () => {
    const track = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".g-track li")];
    const head = (c: HTMLElement) => c.querySelector(".g-track-h span")!.textContent;

    it("a fresh round says the first guess is free and shows 7 slots, the free one first", () => {
        const c = view(dto(101, [], null, 0, true));
        expect(head(c)).toBe("เดาครั้งแรกฟรี · เหลือ 6 ครั้ง");
        const slots = track(c);
        expect(slots).toHaveLength(7);
        expect(slots.map((li) => li.textContent)).toEqual(["ฟรี", "1", "2", "3", "4", "5", "6"]);
        expect(slots[0].classList.contains("now")).toBe(true);
        expect(c.querySelector(".g-rules")!.textContent).toContain("เดาครั้งแรกฟรี ไม่นับเป็นครั้งที่เดา");
        expect(c.querySelector(".g-ladder li.on .t-ssr")).not.toBeNull();
    });

    it("after a wrong free guess: 6 left, the next slot is counted guess 1 and still SSR", () => {
        const c = view(dto(101, [103], null, 0, true, { free: true }));
        expect(head(c)).toBe("เหลือ 6 ครั้ง");
        const slots = track(c);
        expect(slots).toHaveLength(7);
        expect(slots[1].classList.contains("now")).toBe(true);
        expect(slots[1].textContent).toBe("1");
        expect(c.querySelector(".g-ladder li.on .t-ssr")).not.toBeNull();
        cleanup();
        const later = view(dto(101, [103, 104, 105], null, 0, true, { free: true }));
        expect(head(later)).toBe("เหลือ 4 ครั้ง");
    });

    it("an old-rule round in flight keeps 6 slots and the plain counter", () => {
        const c = view(dto(101, [103, 104], null, 0, true));
        expect(head(c)).toBe("เหลือ 4 ครั้ง");
        expect(track(c)).toHaveLength(6);
        expect(c.querySelector(".g-track")!.textContent).not.toContain("ฟรี");
        expect(c.querySelector(".g-track-h")!.textContent).not.toContain("ฟรี");
    });

    it("result line: a free-guess win, a counted win, and a loss after the free guess", () => {
        const pull = (tier: string) => ({ result: "new" as const, prevTier: null, tier: tier as "ssr" });
        const free = view(dto(101, [101], "won", 0, true, { free: true, pull: pull("ssr") }));
        expect(free.querySelector(".g-result .g-sub")!.textContent).toContain("เดาถูกตั้งแต่ครั้งฟรี");
        expect(free.textContent).not.toContain("กฎเดิม");
        cleanup();
        const counted = view(dto(101, [103, 104, 101], "won", 0, true, { free: true, pull: pull("sr") }));
        expect(counted.querySelector(".g-result .g-sub")!.textContent).toContain("เดาครั้งที่ 2 ได้การ์ด");
        expect(counted.textContent).not.toContain("กฎเดิม");
        cleanup();
        const lost = view(dto(101, [102, 103, 104, 105, 106, 107, 108], "lost", 0, true, { free: true }));
        expect(lost.querySelector(".g-stamp")!.textContent).toBe("ครบ 6 ครั้ง + เดาฟรี");
    });

    it("a round scored under the old rule says so, and keeps its stored tier", () => {
        // T-0016 rule: 1 guess + 2 bought hints = Rare; the table now says 1 guess = SSR
        const old = view(dto(101, [101], "won", 2, true, { pull: { result: "new", prevTier: null, tier: "rare" } }));
        const sub = old.querySelector(".g-result .g-sub")!;
        expect(sub.textContent).toContain("เดาครั้งที่ 1 ได้การ์ด");
        expect(sub.querySelector(".t-rare")).not.toBeNull();
        expect(old.textContent).toContain("รอบนี้คิดระดับการ์ดตามกฎเดิม");
        cleanup();
        const match = view(dto(101, [103, 101], "won", 0, true, { pull: { result: "new", prevTier: null, tier: "sr" } }));
        expect(match.textContent).not.toContain("กฎเดิม");
    });

    it("the share text of a free round marks the free row", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const c = view(dto(101, [103, 101], "won", 0, true, { free: true, pull: { result: "new", prevTier: null, tier: "ssr" } }));
        [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("คัดลอกผลลัพธ์"))!.click();
        await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
        const lines = (writeText.mock.calls[0][0] as string).split("\n");
        expect(lines[0]).toMatch(/^waifu100 Daily #\d+ 1\/6 \+free$/);
        expect(lines[1].startsWith("🆓 ")).toBe(true);
        expect(lines[2]).toBe("🟩🟩🟩🟩🟩🟩");
    });
});

describe("pack recap counts only counted guesses (T-0024)", () => {
    const pull = { result: "new" as const, prevTier: null, tier: "ssr" as const };
    const recap = (r: RoundDto) => render(<PackView round={r} coins={0} />).container;

    it("a free-guess win: 'ครั้งฟรี', 6 + 1 free, 7 slots", () => {
        const c = recap(dto(101, [101], "won", 0, true, { free: true, pull }));
        expect(c.querySelector(".g-recap-h")!.textContent).toBe("เดาถูกครั้งฟรีจาก 6 + ฟรี 1");
        expect(c.querySelectorAll(".g-recap .g-track li")).toHaveLength(7);
    });

    it("free wrong then right: counted guess 1; an old-rule round keeps 6 slots", () => {
        const c = recap(dto(101, [103, 101], "won", 0, true, { free: true, pull }));
        expect(c.querySelector(".g-recap-h")!.textContent).toBe("เดาถูกครั้งที่ 1จาก 6 + ฟรี 1");
        cleanup();
        const old = recap(dto(101, [103, 101], "won", 0, true, { pull: { ...pull, tier: "sr" } }));
        expect(old.querySelector(".g-recap-h")!.textContent).toBe("เดาถูกครั้งที่ 2จาก 6");
        expect(old.querySelectorAll(".g-recap .g-track li")).toHaveLength(6);
    });
});

describe("rollback skew (T-0024 r2): a server without freeGuess (old code) does not crash the new client", () => {
    /** What eaed3e3 sends: the same DTO with no `freeGuess` field at all. */
    const old = (r: RoundDto): RoundDto => {
        const { freeGuess: _drop, ...rest } = r;
        void _drop;
        return rest as RoundDto;
    };

    it("renders an in-progress round as the old rule: 6 counted slots, no free label or rule text", () => {
        const c = view(old(dto(105, [])));
        const track = c.querySelector(".g-track")!;
        expect(track.classList.contains("free")).toBe(false);
        expect(track.querySelectorAll("li")).toHaveLength(6);
        expect(c.textContent).not.toContain("ฟรี ไม่นับ");
        expect(c.querySelector(".free-slot")).toBeNull();
    });

    it("renders a finished round (share button) and the pack recap", () => {
        expect(() => view(old(dto(105, [101, 105], "won")))).not.toThrow();
        expect(() => render(<PackView round={old(dto(105, [101, 105], "won"))} coins={0} />)).not.toThrow();
    });

    it("gachaApi normalizes a round response without freeGuess to {on:false, used:false}", async () => {
        const { gachaApi } = await import("./api");
        const body = old(dto(105, [101]));
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        try {
            for (const r of [await gachaApi.today(), await gachaApi.day(DAY), await gachaApi.guess(102, DAY), await gachaApi.hint(1, DAY)]) {
                expect(r.freeGuess).toEqual({ on: false, used: false });
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("hint shop: not enough coins (T-0024 r2)", () => {
    /** Same as dto() but the profile holds `coins`. */
    function withCoins(coins: number, wrong: number[] = []): RoundDto {
        const round: GachaRound = {
            day: DAY, animeId: 9001, answerId: 105, guesses: wrong, bought: 0, done: null, dailyCoins: 10, bonus: 0, pull: null, storyUnlockedNow: false, rules: 2,
        };
        const profile = { coins, rounds: { [DAY]: round }, finishedDays: [], collection: {}, storySeen: [] } as unknown as GachaProfile;
        return roundDto(profile, round, idx, DAY, "play-test-salt");
    }

    it("shows the inline reason with have/need next to the disabled button", () => {
        const r = withCoins(12);
        expect(r.hints.next).toMatchObject({ price: 30, affordable: false });
        const c = view(r);
        const reason = c.querySelector(".g-shoprow .g-short");
        expect(reason?.textContent).toBe("เหรียญไม่พอ (มี 12 ต้องใช้ 30)");
        const btn = c.querySelector<HTMLButtonElement>(".g-shoprow button")!;
        expect(btn.disabled).toBe(true);
        expect(btn.getAttribute("aria-describedby")).toBe(reason!.id);
        expect(c.querySelector("[role=dialog], [role=alert]")).toBeNull();
    });

    it("shows no reason when the hint is affordable", () => {
        const c = view(withCoins(50));
        expect(c.querySelector(".g-short")).toBeNull();
        expect(c.querySelector<HTMLButtonElement>(".g-shoprow button")!.hasAttribute("aria-describedby")).toBe(false);
    });
});
