import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@/lib/redis", () => ({
    withRedis: async (fn: (r: unknown) => unknown) =>
        fn({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => void store.set(k, v) }),
}));
const generateContent = vi.fn();
vi.mock("@/lib/gemini", () => ({ getFlashModel: () => ({ generateContent }) }));
const enforce = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: (...a: unknown[]) => enforce(...a) }));

import { NextRequest } from "next/server";
import { POST, PATCH } from "@/app/api/story/verdict/route";
import { STORY_VERDICT_LIMIT, storyVerdictKey } from "@/lib/story/verdict-store";
import { USER_ID_HEADER } from "@/lib/user-id";

const OWNER = "11111111-1111-4111-8111-111111111111";
const V = (t: string) => ({ emoji: "🌸", en: { title: t, content: "c", tags: ["#a"] }, th: { title: `th-${t}`, content: "ค", tags: ["#ก"] } });
const reply = (t: string) => generateContent.mockResolvedValueOnce({ response: Promise.resolve({ text: () => JSON.stringify(V(t)) }) });
const req = (method: string, body: unknown, user?: string) =>
    new NextRequest("http://localhost/api/story/verdict", { method, body: JSON.stringify(body), headers: { "content-type": "application/json", ...(user ? { [USER_ID_HEADER]: user } : {}) } });

function putShare(id: string, kind = "story", type = "ANIME") {
    store.set(`waifu100:share:${id}`, JSON.stringify(kind === "story"
        ? { meta: { v: 2, kind: "story", size: 9, title: "G", userId: OWNER }, grid: [{ i: 0, a: 1, t: type, img: "https://s4.anilist.co/1.jpg", n: "Frieren" }] }
        : { meta: { v: 2, kind: "waifu", size: 100, title: "W", userId: OWNER }, grid: [] }));
}

beforeEach(() => {
    store.clear();
    generateContent.mockReset();
    enforce.mockClear();
    process.env.GEMINI_API_KEY = "test";
});

describe("POST /api/story/verdict (mocked Redis + Gemini)", () => {
    it("generates once, stores it, and every later call reads the cache", async () => {
        putShare("s1");
        reply("First");
        const a = await (await POST(req("POST", { shareId: "s1" }))).json();
        const b = await (await POST(req("POST", { shareId: "s1" }, "33333333-3333-4333-8333-333333333333"))).json();
        expect(a.verdict.en.title).toBe("First");
        expect(b).toMatchObject({ cached: true, verdict: { en: { title: "First" } } });
        expect(generateContent).toHaveBeenCalledTimes(1);
        expect(JSON.parse(store.get(storyVerdictKey("s1"))!).feedback).toBeNull();
        expect(enforce.mock.calls[0][1]).toBe(STORY_VERDICT_LIMIT);
    });
    it("agree keeps it; only the owner's disagree regenerates (once), strangers keep the stored one", async () => {
        putShare("s1");
        reply("First");
        await POST(req("POST", { shareId: "s1" }));
        expect((await PATCH(req("PATCH", { shareId: "s1", feedback: "agree" }, OWNER))).status).toBe(200);
        expect((await (await POST(req("POST", { shareId: "s1" }, OWNER))).json()).cached).toBe(true);
        await PATCH(req("PATCH", { shareId: "s1", feedback: "disagree" }, OWNER));
        expect((await (await POST(req("POST", { shareId: "s1" }, "22222222-2222-4222-8222-222222222222"))).json()).verdict.en.title).toBe("First");
        reply("Second");
        const r = await (await POST(req("POST", { shareId: "s1" }, OWNER))).json();
        expect(r).toMatchObject({ cached: false, feedback: null, verdict: { en: { title: "Second" } } });
        expect((await (await POST(req("POST", { shareId: "s1" }, OWNER))).json()).cached).toBe(true);
        expect(generateContent).toHaveBeenCalledTimes(2);
    });
    it("votes are owner-only and need a verdict", async () => {
        putShare("s1");
        expect((await PATCH(req("PATCH", { shareId: "s1", feedback: "agree" }, OWNER))).status).toBe(404);
        reply("First");
        await POST(req("POST", { shareId: "s1" }));
        expect((await PATCH(req("PATCH", { shareId: "s1", feedback: "disagree" }, "22222222-2222-4222-8222-222222222222"))).status).toBe(403);
        expect((await PATCH(req("PATCH", { shareId: "s1", feedback: "meh" }, OWNER))).status).toBe(400);
    });
    it("owner carry-over of the builder verdict fills an empty slot only; no AI call", async () => {
        putShare("s1");
        expect((await POST(req("POST", { shareId: "s1", verdict: V("Local") }, "22222222-2222-4222-8222-222222222222"))).status).toBe(403);
        const r = await (await POST(req("POST", { shareId: "s1", verdict: V("Local"), feedback: "agree" }, OWNER))).json();
        expect(r).toMatchObject({ feedback: "agree", verdict: { en: { title: "Local" } } });
        const again = await (await POST(req("POST", { shareId: "s1", verdict: V("Other") }, OWNER))).json();
        expect(again.verdict.en.title).toBe("Local");
        expect((await POST(req("POST", { shareId: "s1", verdict: { nope: 1 } }, OWNER))).status).toBe(400);
        expect(generateContent).not.toHaveBeenCalled();
    });
    it("waifu or missing grids are 404; AI off is 503 ai_unavailable; bad id 400", async () => {
        putShare("w1", "waifu");
        expect((await POST(req("POST", { shareId: "w1" }))).status).toBe(404);
        expect((await POST(req("POST", { shareId: "nope" }))).status).toBe(404);
        expect((await POST(req("POST", { shareId: "../x" }))).status).toBe(400);
        putShare("s1");
        delete process.env.GEMINI_API_KEY;
        vi.spyOn(console, "error").mockImplementation(() => {});
        const r = await POST(req("POST", { shareId: "s1" }));
        expect(r.status).toBe(503);
        expect((await r.json()).code).toBe("ai_unavailable");
    });
    it("prompt carries any media type generically (e.g. NOVEL)", async () => {
        putShare("s1", "story", "NOVEL");
        reply("N");
        await POST(req("POST", { shareId: "s1" }));
        expect(String(generateContent.mock.calls[0][0])).toContain("Frieren (light novel)");
    });
});
