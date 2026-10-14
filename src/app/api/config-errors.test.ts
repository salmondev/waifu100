import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { LEAK_PATTERN } from "@/lib/public-errors";

vi.mock("@/lib/rate-limit", async (orig) => ({
    ...(await orig<typeof import("@/lib/rate-limit")>()),
    enforceRateLimit: async () => null,
    consume: async () => ({ allowed: true, retryAfter: 60, remaining: 1 }),
}));

import { POST as analyze } from "@/app/api/analyze/route";
import { POST as suggest } from "@/app/api/suggest/route";
import { POST as serper } from "@/app/api/serper-images/route";
import { POST as upload } from "@/app/api/upload/route";
import { POST as storyUpload } from "@/app/api/story/upload/route";
import { configureModeration } from "@/server/moderation/moderator";
import { memoryVerdictStore } from "@/server/moderation/verdict-store";

const json = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    configureModeration();
});

async function expectGeneric(res: Response, code: string) {
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(LEAK_PATTERN.test(text), text).toBe(false);
    expect(JSON.parse(text)).toMatchObject({ code });
}

describe("unconfigured features answer with a generic message + code; details only in logs (T-0011)", () => {
    it("AI routes without GEMINI_API_KEY", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expectGeneric(await analyze(json({ characterNames: ["Frieren"] })), "ai_unavailable");
        await expectGeneric(await suggest(json({ characterNames: ["A", "B"] })), "ai_unavailable");
        expect(log.mock.calls.flat().join(" ")).toContain("GEMINI_API_KEY");
    });
    it("image search without SERPER_API_KEY", async () => {
        vi.stubEnv("SERPER_API_KEY", "");
        vi.stubEnv("ADMIN_TOKEN", "t0k");
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const req = json({ directQuery: "frieren" });
        req.headers.set("x-admin-token", "t0k");
        const res = await serper(req);
        await expectGeneric(res, "image_search_unavailable");
    });
    it("uploads without BLOB_READ_WRITE_TOKEN (after moderation allowed)", async () => {
        vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
        const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.stubEnv("REDIS_URL", "");
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore() });
        const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } }).png().toBuffer();
        let n = 0;
        for (const route of [upload, storyUpload]) {
            const fd = new FormData();
            fd.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "a.png");
            fd.append("title", "x");
            const res = await route(new NextRequest("http://localhost/x", { method: "POST", body: fd, headers: { "x-forwarded-for": `10.8.0.${++n}` } }));
            await expectGeneric(res, "uploads_unavailable");
        }
        expect(log.mock.calls.flat().join(" ")).toContain("BLOB_READ_WRITE_TOKEN");
    });
});
