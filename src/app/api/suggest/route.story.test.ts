import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const generateContent = vi.fn();
vi.mock("@/lib/gemini", () => ({ getFlashModel: () => ({ generateContent }) }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: vi.fn(async () => null) }));

import { POST } from "./route";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

const req = (body: unknown) => new NextRequest("http://localhost/api/suggest", { method: "POST", body: JSON.stringify(body) });
const reply = (text: string) => generateContent.mockResolvedValueOnce({ response: Promise.resolve({ text: () => text }) });

describe("/api/suggest kind=story (parity item 5)", () => {
    beforeEach(() => { vi.stubEnv("GEMINI_API_KEY", "test-key"); vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); generateContent.mockReset(); });

    it("uses the same per-IP suggest limit as the other AI routes", async () => {
        reply('{"suggestions":[]}');
        await POST(req({ kind: "story", characterNames: ["A", "B"] }));
        expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), LIMITS.suggest);
    });

    it("returns text only: model URLs, image fields, ids and URL-titles are dropped", async () => {
        reply("```json\n" + JSON.stringify({ suggestions: [
            { title: "Frieren", type: "ANIME", reason: "Quiet fantasy", image: "https://evil.example/x.png", cover: "https://evil.example/c.jpg", url: "https://evil.example", id: 999 },
            { title: "https://evil.example/title", type: "ANIME", reason: "x" },
            { title: "Vinland Saga", type: "MANGA", reason: "see www.evil.example" },
            { title: "A", type: "ANIME", reason: "already on board" },
        ] }) + "\n```");
        const res = await POST(req({ kind: "story", characterNames: ["A", "B"] }));
        const data = await res.json();
        expect(data).toEqual({ suggestions: [
            { title: "Frieren", type: "ANIME", reason: "Quiet fantasy" },
            { title: "Vinland Saga", type: "MANGA", reason: "" },
        ] });
        expect(JSON.stringify(data)).not.toMatch(/evil|https?:|999/);
    });

    it("quota exhausted -> polite ai_busy, no server details", async () => {
        generateContent.mockRejectedValueOnce(new Error("[429 Too Many Requests] RESOURCE_EXHAUSTED quota for project 12345 key AIza..."));
        const res = await POST(req({ kind: "story", characterNames: ["A", "B"] }));
        expect(res.status).toBe(503);
        const data = await res.json();
        expect(data.code).toBe("ai_busy");
        expect(JSON.stringify(data)).not.toMatch(/429|quota|RESOURCE|project|AIza|GEMINI/i);
    });

    it("no key -> ai_unavailable and the model is never called", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const res = await POST(req({ kind: "story", characterNames: ["A", "B"] }));
        expect((await res.json()).code).toBe("ai_unavailable");
        expect(generateContent).not.toHaveBeenCalled();
    });
});
