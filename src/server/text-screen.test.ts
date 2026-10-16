import { afterEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("@/lib/gemini", () => ({ getFlashModel: () => ({ generateContent }) }));

import { clearTextScreenCache, screenUserTexts } from "@/server/text-screen";
import { userTextsForShare } from "@/server/user-text";

afterEach(() => {
    clearTextScreenCache();
    generateContent.mockReset();
    vi.unstubAllEnvs();
});

describe("screenUserTexts", () => {
    it("allows everything when there is no model key", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        expect(await screenUserTexts(["anything"])).toBe(true);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it("blocks only the label the model marks, and remembers it", async () => {
        vi.stubEnv("GEMINI_API_KEY", "test-key");
        generateContent.mockResolvedValueOnce({ response: { text: () => '{"results":[{"ok":true},{"ok":false,"why":"slur"}]}' } });
        expect(await screenUserTexts(["Frieren", "slur here"])).toBe(false);
        generateContent.mockClear();
        expect(await screenUserTexts(["slur here"])).toBe(false);
        expect(generateContent).not.toHaveBeenCalled();
    });

    it("a bare refusal with no safety reason is allowed", async () => {
        vi.stubEnv("GEMINI_API_KEY", "test-key");
        generateContent.mockResolvedValueOnce({ response: { text: () => "BLOCK" } });
        expect(await screenUserTexts(["simon x HOIIII like together"])).toBe(true);
    });

    it("allows the batch when the model reply is unusable", async () => {
        vi.stubEnv("GEMINI_API_KEY", "test-key");
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        generateContent.mockResolvedValueOnce({ response: { text: () => "maybe" } });
        expect(await screenUserTexts(["A title"])).toBe(true);
    });
});

describe("userTextsForShare", () => {
    it("keeps typed labels and drops catalog names", () => {
        expect(userTextsForShare("My grid", "story", [
            { i: 0, a: 1, t: "ANIME", img: "https://s4.anilist.co/a.jpg", n: "Bebop" },
            { i: 1, a: 2, t: "ANIME", img: "https://blob.public.blob.vercel-storage.com/x.jpg", n: "My film", src: "upload" },
        ], null)).toEqual(["My grid", "My film"]);
        expect(userTextsForShare(null, "waifu", null, [
            { character: { name: "Rin", source: "Fate" } },
            { character: { name: "Drawn by me", source: "Uploaded" } },
        ])).toEqual(["Drawn by me"]);
    });
});
