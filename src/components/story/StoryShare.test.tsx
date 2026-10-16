import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { StoryBuilder } from "@/components/story/StoryBuilder";
import { WAIFU_BTN } from "@/components/story/waifu-styles";
import { STORY_DRAFT_KEY } from "@/lib/story/config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

const item = (id: number, title: string) => ({ id, type: "ANIME", title, cover: `https://s4.anilist.co/${id}.jpg`, src: "anilist" });
const seed = (items: unknown[], title = "My board") => window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size: 10, type: "ANIME", title, items: Array.from({ length: 10 }, (_, i) => items[i] ?? null), titleStyle: "overlay" }));
let shareCalls: { body: Record<string, unknown> }[];
let shareReply: () => Response;

beforeEach(() => {
    window.localStorage.clear();
    shareCalls = [];
    shareReply = () => new Response(JSON.stringify({ id: "abc123" }), { status: 200 });
    // Every request is mocked: no real share can happen from tests.
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith("/api/share")) { shareCalls.push({ body: JSON.parse(String(init?.body)) }); return shareReply(); }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openShare = async () => {
    render(<StoryBuilder />);
    await screen.findByRole("button", { name: "1. Bebop" });
    fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
    return screen.getByRole("dialog", { name: "Share Your Grid" });
};

describe("story share: confirm modal first (waifu ShareModal pattern)", () => {
    it("Share opens the modal and sends nothing until Generate Link", async () => {
        seed([item(1, "Bebop")]);
        const dialog = await openShare();
        expect(within(dialog).getByLabelText("Grid Title")).toHaveProperty("value", "My board");
        expect(shareCalls).toHaveLength(0);
        fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog", { name: "Share Your Grid" })).toBeNull();
        expect(shareCalls).toHaveLength(0);
    });

    it("the edited title is what gets sent (server validates it) and also updates the board title", async () => {
        seed([item(1, "Bebop")]);
        const dialog = await openShare();
        const input = within(dialog).getByLabelText("Grid Title") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "  Edited title  " } });
        expect((screen.getByRole("textbox", { name: "Grid title" }) as HTMLInputElement).value).toBe("My board");
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Generate Link/ })); });
        expect(shareCalls).toHaveLength(1);
        expect(shareCalls[0].body).toMatchObject({ kind: "story", customTitle: "Edited title", screen: true });
        expect((screen.getByRole("textbox", { name: "Grid title" }) as HTMLInputElement).value).toBe("Edited title");
        expect(await within(dialog).findByTestId("share-url")).toHaveProperty("textContent", `${window.location.origin}/story/v/abc123`);
        expect(within(dialog).getByRole("button", { name: /Copy Link/ })).toBeTruthy();
        expect(within(dialog).getByRole("button", { name: /Post on X/ })).toBeTruthy();
    });

    it("loading state disables the button and shows 'Saving...'; an error is shown inline and nothing navigates", async () => {
        seed([item(1, "Bebop")]);
        let release!: (r: Response) => void;
        shareReply = () => new Response(JSON.stringify({ error: "Storage is down" }), { status: 500 });
        const pending = new Promise<Response>((r) => { release = r; });
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_u: string, init?: RequestInit) => { shareCalls.push({ body: JSON.parse(String(init?.body)) }); return pending; });
        const dialog = await openShare();
        fireEvent.click(within(dialog).getByRole("button", { name: /Generate Link/ }));
        const busy = await within(dialog).findByRole("button", { name: /Saving\.\.\./ });
        expect(busy).toHaveProperty("disabled", true);
        await act(async () => { release(new Response(JSON.stringify({ error: "Storage is down" }), { status: 500 })); });
        expect((await within(dialog).findByRole("alert")).textContent).toContain("Storage is down");
        expect(within(dialog).queryByTestId("share-url")).toBeNull();
    });

    it("empty title or empty board is refused in the modal (waifu copy), no request", async () => {
        seed([]);
        render(<StoryBuilder />);
        await screen.findByRole("button", { name: /^Share$/ });
        fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
        const dialog = screen.getByRole("dialog", { name: "Share Your Grid" });
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Generate Link/ })); });
        expect(within(dialog).getByRole("alert").textContent).toContain("Go add some titles first!");
        expect(shareCalls).toHaveLength(0);
    });
});

describe("story actions follow waifu's sidebar", () => {
    it("same order, copy and colours as waifu (Save/Load, Ask AI, Share | Save as .png, Clear Grid)", async () => {
        seed([item(1, "Bebop")]);
        render(<StoryBuilder />);
        const bar = await screen.findByTestId("story-actions");
        await waitFor(() => expect(within(bar).getByRole("button", { name: /Ask AI About My Taste/ })).toBeTruthy());
        const names = within(bar).getAllByRole("button").map((b) => b.textContent?.trim());
        expect(names).toEqual(["Build Grid Together", "Save board", "Load board", "Ask AI About My Taste", "Share", "Save as .png", "Clear Grid"]);
        expect(within(bar).getByRole("button", { name: /^Share$/ }).className).toBe(WAIFU_BTN.share);
        expect(within(bar).getByRole("button", { name: /Save as .png/ }).className).toBe(WAIFU_BTN.png);
        expect(within(bar).getByRole("button", { name: /Clear Grid/ }).className).toBe(WAIFU_BTN.clear);
    });
    it("the copied class strings are verbatim from waifu's page.tsx", () => {
        // waifu adds outer margins (mb-2 / mb-6 / mt-2) for its sidebar stack; story uses gap instead.
        const page = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8").replace(/ m[bt]-[26]/g, "");
        for (const k of ["ai", "share", "png", "clear", "ideas"] as const) expect(page).toContain(WAIFU_BTN[k]);
        expect(page).toContain(WAIFU_BTN.neutral.replace(" disabled:opacity-50 disabled:cursor-not-allowed", ""));
    });
});

describe("story share: in-flight guard", () => {
    it("rapid Enter presses and clicks while the request is pending POST exactly once", async () => {
        seed([item(1, "Bebop")]);
        let release!: (r: Response) => void;
        const pending = new Promise<Response>((r) => { release = r; });
        const f = fetch as unknown as ReturnType<typeof vi.fn>;
        f.mockImplementation(async (url: string, init?: RequestInit) => {
            if (String(url).startsWith("/api/share")) { shareCalls.push({ body: JSON.parse(String(init?.body)) }); return pending; }
            return new Response(JSON.stringify({ items: [] }), { status: 200 });
        });
        const dialog = await openShare();
        const input = within(dialog).getByLabelText("Grid Title");
        const btn = within(dialog).getByRole("button", { name: /Generate Link/ });
        // Same tick, before React re-renders the disabled state.
        act(() => {
            for (let i = 0; i < 4; i++) { fireEvent.keyDown(input, { key: "Enter" }); fireEvent.click(btn); }
        });
        await act(async () => { for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "Enter" }); });
        const shareFetches = () => f.mock.calls.filter(([u]) => String(u).startsWith("/api/share")).length;
        expect(shareFetches()).toBe(1);
        await act(async () => { release(new Response(JSON.stringify({ id: "abc123" }), { status: 200 })); });
        await within(dialog).findByTestId("share-url");
        expect(shareFetches()).toBe(1);
        expect(shareCalls).toHaveLength(1);
    });
});
