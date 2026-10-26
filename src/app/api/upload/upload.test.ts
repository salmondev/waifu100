import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";

const put = vi.fn(async (path: string) => ({ url: `https://abc123.public.blob.vercel-storage.com/${path}` }));
vi.mock("@vercel/blob", () => ({ put: (p: string) => put(p) }));

import { POST } from "@/app/api/upload/route";
import { configureModeration, sha256 } from "@/server/moderation/moderator";
import { memoryVerdictStore } from "@/server/moderation/verdict-store";
import { ClassifyError } from "@/server/moderation/classifier";

let ip = 0;
async function req(bytes: Buffer, type = "image/png", fixedIp?: string) {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type }), "x");
    return new NextRequest("http://localhost/api/upload", {
        method: "POST",
        body,
        headers: { "x-forwarded-for": fixedIp ?? `10.9.0.${++ip}` },
    });
}
const png = (c: string) => sharp({ create: { width: 16, height: 16, channels: 3, background: c } }).png().toBuffer();

beforeEach(() => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    vi.stubEnv("REDIS_URL", "");
    put.mockClear();
});
afterEach(() => {
    configureModeration();
    vi.unstubAllEnvs();
});

describe("/api/upload moderates before storing (review M1)", () => {
    it("stores allowed bytes under their sha256", async () => {
        const bytes = await png("#ff0000");
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore() });
        const res = await POST(await req(bytes));
        expect(res.status).toBe(200);
        expect(put).toHaveBeenCalledWith(`shares/${sha256(bytes)}.png`);
        expect((await res.json()).url).toContain(sha256(bytes));
    });
    it("rejects blocked bytes and never stores them", async () => {
        configureModeration({ classify: async (xs) => xs.map(() => false), store: memoryVerdictStore() });
        const res = await POST(await req(await png("#00ff00")));
        expect(res.status).toBe(422);
        expect(put).not.toHaveBeenCalled();
    });
    it("fails closed when the classifier is unavailable", async () => {
        configureModeration({ classify: async () => { throw new ClassifyError("no-key"); }, store: memoryVerdictStore() });
        const res = await POST(await req(await png("#0000ff")));
        expect(res.status).toBe(503);
        expect(put).not.toHaveBeenCalled();
    });
    it("refuses non-images and oversize files", async () => {
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore() });
        expect((await POST(await req(Buffer.from("<svg/>"), "image/svg+xml"))).status).toBe(415);
        expect((await POST(await req(Buffer.alloc(4 * 1024 * 1024 + 1), "image/png"))).status).toBe(413);
        expect(put).not.toHaveBeenCalled();
    });
    it("rate-limits per IP", async () => {
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore() });
        const bytes = await png("#abcdef");
        const statuses: number[] = [];
        for (let i = 0; i < 31; i++) statuses.push((await POST(await req(bytes, "image/png", "10.8.8.8"))).status);
        expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
    });
});
