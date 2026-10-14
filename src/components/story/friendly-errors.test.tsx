import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryVerdict } from "@/components/story/StoryExtras";
import { CompareVerdict } from "@/components/compare/CompareVerdict";
import { clearImagePickerCache, ImagePicker } from "@/components/story/ImagePicker";
import { LEAK_PATTERN } from "@/lib/public-errors";

const item = { id: 1, type: "ANIME" as const, title: "Frieren", cover: "https://s4.anilist.co/c.jpg", src: "anilist" as const };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
    clearImagePickerCache();
    cleanup();
    vi.unstubAllGlobals();
});

describe("failure states show friendly text, never internal details (T-0011)", () => {
    it("story AI verdict hides itself when AI is not configured", async () => {
        vi.stubGlobal("fetch", reply(503, { code: "ai_unavailable", error: "AI features are unavailable right now." }));
        const { container } = render(<StoryVerdict items={[item, { ...item, id: 2 }]} />);
        fireEvent.click(screen.getByRole("button", { name: /Ask AI/i }));
        await waitFor(() => expect(screen.queryByTestId("story-verdict")).toBeNull());
        expect(LEAK_PATTERN.test(container.textContent ?? "")).toBe(false);
    });
    it("story AI verdict: a leaky server error (old deploy) becomes friendly text", async () => {
        vi.stubGlobal("fetch", reply(500, { error: "GEMINI_API_KEY not configured" }));
        render(<StoryVerdict items={[item, { ...item, id: 2 }]} />);
        fireEvent.click(screen.getByRole("button", { name: /Ask AI/i }));
        // Waifu's modal error text (AnalysisModal), with Try Again.
        await waitFor(() => screen.getByText("Something went wrong. The AI needed a break. Try again later."));
        expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
        expect(document.body.textContent).not.toContain("GEMINI");
    });
    it("compare verdict hides when AI is not configured, and is friendly on a leaky error", async () => {
        vi.stubGlobal("fetch", reply(503, { code: "ai_unavailable", error: "AI features are unavailable right now." }));
        const a = render(<CompareVerdict a="a1" b="b1" initial={null} autoGenerate />);
        await waitFor(() => expect(a.container.textContent).toBe(""));
        a.unmount();
        vi.stubGlobal("fetch", reply(500, { error: "GEMINI_API_KEY not configured" }));
        render(<CompareVerdict a="a1" b="b1" initial={null} autoGenerate />);
        await waitFor(() => screen.getByText(/Couldn't write a verdict right now/));
        expect(document.body.textContent).not.toMatch(LEAK_PATTERN);
    });
    it("image picker: leaky error is replaced with friendly text", async () => {
        vi.stubGlobal("fetch", reply(500, { error: "REDIS_URL is not defined" }));
        render(<ImagePicker item={item} onPick={() => {}} onClose={() => {}} onUpload={async () => null} />);
        await waitFor(() => screen.getByRole("alert"));
        expect(screen.getByRole("alert").textContent).toContain("You can still use the main cover");
        expect(document.body.textContent).not.toMatch(LEAK_PATTERN);
    });
});
