import { afterEach, describe, expect, it } from "vitest";
import { clampSerperBody, dayKey, takeSerperCredit } from "@/server/serper-budget";

const env = { ...process.env };
afterEach(() => {
    process.env = { ...env };
});

function counter() {
    const m = new Map<string, number>();
    return { m, incr: async (k: string) => m.set(k, (m.get(k) ?? 0) + 1).get(k)! };
}

describe("serper budget", () => {
    it("allows up to SERPER_DAILY_CAP per UTC day, then refuses", async () => {
        process.env.SERPER_API_KEY = "fake";
        process.env.SERPER_DAILY_CAP = "2";
        const c = counter();
        const day = new Date("2026-10-14T05:00:00Z");
        expect(await takeSerperCredit(c, day)).toBe(true);
        expect(await takeSerperCredit(c, day)).toBe(true);
        expect(await takeSerperCredit(c, day)).toBe(false);
        expect(await takeSerperCredit(c, new Date("2026-10-15T00:00:01Z"))).toBe(true);
        expect(dayKey(day)).toBe("waifu100:serper:day:2026-10-14");
    });
    it("default is unlimited; no key => no Serper; broken counter or no Redis => still call", async () => {
        delete process.env.SERPER_API_KEY;
        expect(await takeSerperCredit(counter())).toBe(false);
        process.env.SERPER_API_KEY = "fake";
        for (const cap of [undefined, "", "0"]) {
            if (cap === undefined) delete process.env.SERPER_DAILY_CAP;
            else process.env.SERPER_DAILY_CAP = cap;
            const c = counter();
            for (let i = 0; i < 500; i++) expect(await takeSerperCredit(c)).toBe(true);
        }
        expect(await takeSerperCredit({ incr: async () => { throw new Error("down"); } })).toBe(true);
        process.env.REDIS_URL = "";
        expect(await takeSerperCredit()).toBe(true);
    });
    it("clamps num to 10", () => {
        expect(JSON.parse(clampSerperBody(JSON.stringify({ q: "x", num: 50 }))!).num).toBe(10);
        expect(JSON.parse(clampSerperBody(JSON.stringify({ q: "x" }))!).num).toBe(10);
        expect(JSON.parse(clampSerperBody(JSON.stringify({ q: "x", num: 8 }))!).num).toBe(8);
    });
});
