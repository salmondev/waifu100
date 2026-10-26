import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StoryBuilder } from "@/components/story/StoryBuilder";
import { STORY_DRAFT_KEY } from "@/lib/story/config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

function viewport(width: number) {
    vi.stubGlobal("matchMedia", (q: string) => {
        const min = Number(/min-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
        return { matches: width >= min, media: q, addEventListener: () => {}, removeEventListener: () => {} };
    });
}
beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [] } } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([1280, 390])("custom grid size at %ipx", (width) => {
    beforeEach(() => viewport(width));
    it("applies rows x cols, clamps typed values, keeps presets as shortcuts", async () => {
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "Custom…" }));
        const box = screen.getByRole("group", { name: "Custom grid size" });
        fireEvent.change(within(box).getByLabelText("Rows"), { target: { value: "4" } });
        fireEvent.change(within(box).getByLabelText("Columns"), { target: { value: "60" } });
        expect((within(box).getByLabelText("Columns") as HTMLInputElement).value).toBe("10");
        fireEvent.change(within(box).getByLabelText("Columns"), { target: { value: "6" } });
        fireEvent.click(within(box).getByRole("button", { name: "Apply" }));
        expect(screen.getByRole("button", { name: "Custom 4×6" }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getAllByText("0/24").length).toBeGreaterThan(0);
        expect(screen.getByTestId("media-grid").style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
        expect(JSON.parse(window.localStorage.getItem(STORY_DRAFT_KEY)!)).toMatchObject({ size: 24, cols: 6 });
        fireEvent.click(screen.getByRole("button", { name: "3×3" }));
        expect(screen.getAllByText("0/9").length).toBeGreaterThan(0);
        expect(JSON.parse(window.localStorage.getItem(STORY_DRAFT_KEY)!).cols).toBeNull();
    });
    it("Apply is disabled below 2 cells", async () => {
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "Custom…" }));
        const box = screen.getByRole("group", { name: "Custom grid size" });
        fireEvent.change(within(box).getByLabelText("Rows"), { target: { value: "1" } });
        fireEvent.change(within(box).getByLabelText("Columns"), { target: { value: "0" } });
        expect((within(box).getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    });
    it("a saved custom draft reloads as custom", async () => {
        window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size: 12, cols: 2, type: "ANIME", title: "t", items: [], titleStyle: "overlay" }));
        render(<StoryBuilder />);
        expect((await screen.findByRole("button", { name: "Custom 6×2" })).getAttribute("aria-pressed")).toBe("true");
    });
});
