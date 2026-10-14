import { afterEach, describe, expect, it, vi } from "vitest";
import { resetGeminiKeyWarning, warnIfNoGeminiKey } from "@/server/gemini-key-warning";
import { geminiClassifier } from "@/server/moderation/classifier";

afterEach(() => {
    vi.unstubAllEnvs();
    resetGeminiKeyWarning();
});

describe("GEMINI_API_KEY warning", () => {
    it("warns once per process when the key is missing", () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const log = vi.fn();
        expect(warnIfNoGeminiKey(log)).toBe(true);
        expect(warnIfNoGeminiKey(log)).toBe(false);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][0]).toContain("GEMINI_API_KEY is not set");
        expect(log.mock.calls[0][0]).toContain("no-key");
    });
    it("is extra loud in production", () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("NODE_ENV", "production");
        const log = vi.fn();
        warnIfNoGeminiKey(log);
        const msg = log.mock.calls[0][0] as string;
        expect(msg).toContain("MISSING IN PRODUCTION");
        expect(msg).toContain("UNCHECKED");
        expect(msg.split("\n").length).toBeGreaterThan(4);
    });
    it("is silent when the key is set", () => {
        vi.stubEnv("GEMINI_API_KEY", "x");
        const log = vi.fn();
        expect(warnIfNoGeminiKey(log)).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });
    it("fires on first use from the moderation classifier", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(geminiClassifier([{ jpeg: Buffer.from("x") }])).rejects.toMatchObject({ reason: "no-key" });
        await expect(geminiClassifier([{ jpeg: Buffer.from("x") }])).rejects.toMatchObject({ reason: "no-key" });
        expect(spy.mock.calls.filter((c) => String(c[0]).includes("GEMINI_API_KEY")).length).toBe(1);
        spy.mockRestore();
    });
});
