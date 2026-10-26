import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { gemini, expectNoOutsideCalls } from "./setup";

vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), enforceRateLimit: async () => null }));
import { POST as analyze } from "@/app/api/analyze/route";

const req = (body: unknown) => new NextRequest("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const VERDICT = { en: { title: "Tsundere Collector", content: "You like them sharp.", tags: ["#a"] }, th: { title: "ซึน", content: "ชอบคม", tags: ["#b"] }, emoji: "🔥" };

describe("/api/analyze (AI verdict, Gemini mocked)", () => {
  it("generates a verdict once per request", async () => {
    gemini.generateContent.mockResolvedValueOnce({ response: Promise.resolve({ text: () => JSON.stringify(VERDICT) }) });
    const res = await analyze(req({ characterNames: ["Rin", "Saber"] }));
    expect(res.status).toBe(200);
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.styleVersion).toBeDefined();
    expectNoOutsideCalls();
  });
  it("regenerate (disagree) is a fresh call with the same names", async () => {
    gemini.generateContent.mockResolvedValue({ response: Promise.resolve({ text: () => JSON.stringify(VERDICT) }) });
    await analyze(req({ characterNames: ["Rin"] }));
    await analyze(req({ characterNames: ["Rin"] }));
    expect(gemini.generateContent).toHaveBeenCalledTimes(2);
    expect(String(gemini.generateContent.mock.calls[1][0])).toContain("Rin");
  });
  it("error states: empty grid 400, no key -> unavailable, garbage AI -> 500, AI throws -> 500", async () => {
    expect((await analyze(req({ characterNames: [] }))).status).toBe(400);
    gemini.generateContent.mockResolvedValueOnce({ response: Promise.resolve({ text: () => "not json at all" }) });
    expect((await analyze(req({ characterNames: ["Rin"] }))).status).toBe(500);
    gemini.generateContent.mockRejectedValueOnce(new Error("quota GEMINI_API_KEY"));
    const boom = await analyze(req({ characterNames: ["Rin"] }));
    expect(boom.status).toBe(500);
    expect(await boom.text()).not.toContain("GEMINI_API_KEY");
    vi.stubEnv("GEMINI_API_KEY", "");
    const off = await analyze(req({ characterNames: ["Rin"] }));
    expect(off.status).toBeGreaterThanOrEqual(500);
    expect(await off.text()).not.toContain("GEMINI_API_KEY");
  });
  it("caps input to 100 names of 120 chars", async () => {
    gemini.generateContent.mockResolvedValueOnce({ response: Promise.resolve({ text: () => JSON.stringify(VERDICT) }) });
    await analyze(req({ characterNames: Array.from({ length: 150 }, (_, i) => `N${i}` + "x".repeat(200)) }));
    const prompt = String(gemini.generateContent.mock.calls[0][0]);
    expect(prompt).not.toContain("N120");
    expect(prompt).not.toContain("x".repeat(150));
  });
});
