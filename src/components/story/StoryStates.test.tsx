import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryBuilder } from "@/components/story/StoryBuilder";
import { StoryToast } from "@/components/story/StoryHints";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/story", useSearchParams: () => new URLSearchParams() }));

const media = [{ id: 1, type: "ANIME", title: { english: "Frieren" }, coverImage: { large: "https://s4.anilist.co/1.jpg" } }];
let release: (() => void) | null = null;
beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: /1024/.test(q), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("fetch", vi.fn((u: string) => {
        if (/graphql|anilist/.test(String(u))) return new Promise<Response>((r) => { release = () => r(new Response(JSON.stringify({ data: { Page: { media } } }))); });
        return Promise.resolve(new Response("{}"));
    }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); release = null; });

describe("waifu toast", () => {
    it.each([["success", "bg-green-950/80"], ["error", "bg-red-950/80"], ["info", "bg-zinc-800/80"]] as const)("%s uses waifu's classes", (type, cls) => {
        render(<StoryToast message="m" type={type} />);
        const t = screen.getByTestId("notice");
        expect(t.className).toContain(cls);
        expect(t.className).toContain("rounded-full");
        expect(t.parentElement!.className).toContain("fixed bottom-8");
    });
});

describe("search states follow waifu", () => {
    it("loading = waifu's centred spinner; first results of the session show the 'Found them!' hint once", async () => {
        render(<StoryBuilder />);
        fireEvent.change(screen.getByLabelText("Search anime or manga"), { target: { value: "frieren" } });
        expect(await screen.findByTestId("search-loading", {}, { timeout: 3000 })).toBeTruthy();
        expect(screen.queryByTestId("result-skeleton")).toBeNull();
        await waitFor(() => expect(release).not.toBeNull(), { timeout: 3000 });
        release!();
        expect(await screen.findByText("Found them!")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Close hint" }));
        expect(screen.queryByTestId("search-hint")).toBeNull();
        // a second search in the same session: no hint again
        fireEvent.change(screen.getByLabelText("Search anime or manga"), { target: { value: "frieren 2" } });
        release = null;
        await waitFor(() => expect(release).not.toBeNull(), { timeout: 3000 });
        release!();
        await screen.findByRole("list", { name: "Search results" });
        expect(screen.queryByTestId("search-hint")).toBeNull();
    });
});
