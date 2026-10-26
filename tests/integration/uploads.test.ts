import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { blob, expectNoOutsideCalls } from "./setup";

const moderate = vi.fn(async () => ({ hash: "h".repeat(64), verdict: "a" as "a" | "b" | null }));
vi.mock("@/server/moderation/moderator", async (orig) => ({ ...(await orig<typeof import("@/server/moderation/moderator")>()), moderateBytes: () => moderate() }));
vi.mock("@/server/text-screen", () => ({ screenUserTexts: vi.fn(async () => true), clearTextScreenCache: () => {} }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: async () => null }));

import { POST as upload } from "@/app/api/upload/route";
import { POST as storyUpload } from "@/app/api/story/upload/route";

function form(file: Blob | null, extra: Record<string, string> = {}) {
  const f = new FormData();
  if (file) f.set("file", file, "x");
  Object.entries(extra).forEach(([k, v]) => f.set(k, v));
  return new NextRequest("http://localhost/api/upload", { method: "POST", body: f });
}
const png = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe.each([
  ["grid thumbnail /api/upload", upload, 4 * 1024 * 1024],
  ["story custom cover /api/story/upload", storyUpload, 2 * 1024 * 1024],
] as const)("%s", (_name, route, max) => {
  it("accepts a PNG and stores it via (mocked) Blob", async () => {
    const res = await route(form(png(), { title: "My cover", type: "ANIME" }));
    expect(res.status).toBe(200);
    expect(blob.put).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(JSON.stringify(json)).toContain("blob.e2e.invalid");
    expectNoOutsideCalls();
  });
  it("rejects missing file (400)", async () => {
    expect((await route(form(null))).status).toBe(400);
  });
  it("rejects wrong type (415)", async () => {
    expect((await route(form(new Blob(["gif"], { type: "image/gif" })))).status).toBe(415);
    expect((await route(form(new Blob(["<svg/>"], { type: "image/svg+xml" })))).status).toBe(415);
    expect(blob.put).not.toHaveBeenCalled();
  });
  it("rejects oversize (413)", async () => {
    expect((await route(form(png(max + 1)))).status).toBe(413);
    expect(blob.put).not.toHaveBeenCalled();
  });
  it("moderation reject -> 422, moderation unavailable -> 503, never stored", async () => {
    moderate.mockResolvedValueOnce({ hash: "h", verdict: "b" });
    expect((await route(form(png()))).status).toBe(422);
    moderate.mockResolvedValueOnce({ hash: "h", verdict: null });
    expect((await route(form(png()))).status).toBe(503);
    expect(blob.put).not.toHaveBeenCalled();
  });
  it("no Blob token -> feature unavailable, no leak of env names", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const res = await route(form(png()));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.text()).not.toContain("BLOB_READ_WRITE_TOKEN");
  });
});
