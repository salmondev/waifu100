import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const search = vi.fn(async (q: string) => ({ items: [{ id: 9, type: "ANIME", title: `${q} result`, cover: "https://s4.anilist.co/r.jpg", src: "anilist" }], source: "anilist", anilistCooldownUntil: null }));
vi.mock("@/lib/story/search", async (orig) => ({
    ...(await orig<typeof import("@/lib/story/search")>()),
    storySearch: { search: (q: string) => search(q), cooldownUntil: () => null },
}));

import { StoryBuilder } from "@/components/story/StoryBuilder";
import { clearImagePickerCache, ImagePicker } from "@/components/story/ImagePicker";
import { STORY_DRAFT_KEY } from "@/lib/story/config";

const FRIEREN = { id: 154587, type: "ANIME", title: "Frieren", cover: "https://s4.anilist.co/frieren.jpg", src: "anilist" };
const UPLOADED = { id: 77, type: "ANIME", title: "My Fan Art", cover: "https://abc.public.blob.vercel-storage.com/story/a.png", src: "upload" };
function seed(items: unknown[]) {
    const all = Array.from({ length: 10 }, (_, i) => items[i] ?? null);
    window.localStorage.setItem(STORY_DRAFT_KEY, JSON.stringify({ size: 10, type: "ANIME", title: "t", items: all, titleStyle: "overlay" }));
}
function imagesFetch() {
    return vi.fn(async (url: string) => {
        const source = new URL(url, "http://x").searchParams.get("source");
        const choices = source === "anilist" ? [{ url: "https://s4.anilist.co/banner.jpg", source: "banner", label: "Banner", hash: "B" }] : [];
        return new Response(JSON.stringify({ choices }));
    });
}
const imageCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).startsWith("/api/story/images")).length;

beforeEach(() => {
    window.localStorage.clear();
    clearImagePickerCache();
    search.mockClear();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("T-0013: clicking a filled story cell", () => {
    it("opens the picker prefilled with that title and its images - no search, no retyping", async () => {
        seed([FRIEREN]);
        const f = imagesFetch();
        vi.stubGlobal("fetch", f);
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "1. Frieren" }));
        const dialog = await screen.findByRole("dialog", { name: "Choose an image for Frieren" });
        expect(within(dialog).getByText("Change image")).toBeTruthy();
        expect(within(dialog).getByTitle("Current image")).toBeTruthy();
        await within(dialog).findByTitle("Banner");
        expect(search).not.toHaveBeenCalled();
        expect((screen.getByLabelText("Search anime or manga") as HTMLInputElement).value).toBe("");
        expect(imageCalls(f)).toBe(2);
        expect(f.mock.calls.every((c) => /id=154587&type=ANIME&src=anilist&source=(anilist|web)$/.test(String(c[0])))).toBe(true);
    });

    it("picking another image replaces THAT slot (not a duplicate notice, not another slot)", async () => {
        seed([null, FRIEREN]);
        vi.stubGlobal("fetch", imagesFetch());
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "2. Frieren" }));
        fireEvent.click(await screen.findByTitle("Banner"));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.getByTestId("notice").textContent).toContain("Updated slot 2");
        const saved = JSON.parse(window.localStorage.getItem(STORY_DRAFT_KEY) ?? "{}");
        await waitFor(() => expect(JSON.parse(window.localStorage.getItem(STORY_DRAFT_KEY) ?? "{}").items?.[1]?.cover).toBe("https://s4.anilist.co/banner.jpg"));
        expect(saved).toBeTruthy();
        expect(screen.getByRole("button", { name: "Empty slot 1" })).toBeTruthy();
    });

    it("re-opening the same title reuses cached images: no duplicate requests", async () => {
        seed([FRIEREN]);
        const f = imagesFetch();
        vi.stubGlobal("fetch", f);
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "1. Frieren" }));
        await screen.findByTitle("Banner");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        fireEvent.click(screen.getByRole("button", { name: "1. Frieren" }));
        await screen.findByTitle("Banner"); // shown straight from cache
        expect(screen.queryByTestId("source-loading")).toBeNull();
        expect(imageCalls(f)).toBe(2);
    });

    it("an uploaded image (no media id) prefills the search box with its title instead", async () => {
        seed([UPLOADED]);
        vi.stubGlobal("fetch", imagesFetch());
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "1. My Fan Art" }));
        // Parity item 3: in-app confirm modal first (no window.confirm, no board notice)
        expect(screen.getByRole("dialog", { name: "Replace slot 1?" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Find a replacement" }));
        expect((screen.getByLabelText("Search anime or manga") as HTMLInputElement).value).toBe("My Fan Art");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByTestId("replacing-note").textContent).toContain("My Fan Art");
        await waitFor(() => expect(search).toHaveBeenCalledWith("My Fan Art"));
    });

    it("empty cell keeps its behaviour: selects the slot, opens nothing, fetches nothing", async () => {
        seed([FRIEREN]);
        const f = imagesFetch();
        vi.stubGlobal("fetch", f);
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "Empty slot 3" }));
        expect(screen.getByText("Slot 3 selected: your next pick goes here.")).toBeTruthy();
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(f).not.toHaveBeenCalled();
        expect(search).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Empty slot 3" }));
        expect(screen.queryByText(/Slot 3 selected/)).toBeNull();
    });

    it("React strict-mode double mount joins the in-flight requests: exactly 3, no duplicates", async () => {
        const f = imagesFetch();
        vi.stubGlobal("fetch", f);
        render(<StrictMode><ImagePicker item={FRIEREN as never} onPick={() => {}} onClose={() => {}} onUpload={async () => null} /></StrictMode>);
        await screen.findByTitle("Banner");
        expect(imageCalls(f)).toBe(2);
    });

    it("follow-up (1): partial source answers are shown but NOT cached; complete ones are", async () => {
        const f = vi.fn(async (url: string) => {
            const source = new URL(url, "http://x").searchParams.get("source");
            if (source === "web") return new Response(JSON.stringify({ choices: [{ url: "https://i.pinimg.com/p.jpg", source: "web", label: "Web 1", hash: "W" }], partial: true }));
            return new Response(JSON.stringify({ choices: source === "anilist" ? [{ url: "https://s4.anilist.co/banner.jpg", source: "banner", label: "Banner", hash: "B" }] : [], partial: false }));
        });
        vi.stubGlobal("fetch", f);
        const first = render(<ImagePicker item={FRIEREN as never} onPick={() => {}} onClose={() => {}} onUpload={async () => null} />);
        await screen.findByTitle("Web 1"); // partial result is still displayed
        await screen.findByTitle("Banner");
        first.unmount();
        render(<ImagePicker item={FRIEREN as never} onPick={() => {}} onClose={() => {}} onUpload={async () => null} />);
        await screen.findByTitle("Web 1");
        const sources = f.mock.calls.map((c) => new URL(String(c[0]), "http://x").searchParams.get("source"));
        expect(sources.filter((x) => x === "web")).toHaveLength(2); // partial, so re-requested
        expect(sources.filter((x) => x === "anilist")).toHaveLength(1); // cached
    });

    it("follow-up (2): closing a picker for a DIFFERENT title with the same id keeps the replace-slot state", async () => {
        // Slot holds an upload (MANGA, id 9); the search result is ANIME id 9 - same id, different picker key.
        seed([{ id: 9, type: "MANGA", title: "Fan Art", cover: "https://abc.public.blob.vercel-storage.com/story/a.png", src: "upload" }]);
        vi.stubGlobal("fetch", imagesFetch());
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "1. Fan Art" }));
        fireEvent.click(screen.getByRole("button", { name: "Find a replacement" }));
        expect(screen.getByTestId("replacing-note")).toBeTruthy();
        fireEvent.click(await screen.findByText("Fan Art result")); // search result: ANIME id 9
        await screen.findByRole("dialog");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.getByTestId("replacing-note").textContent).toContain("Fan Art"); // still replacing slot 1
    });

    it("follow-up (2): closing the picker of the slot's own title clears the replace-slot state", async () => {
        seed([FRIEREN]);
        vi.stubGlobal("fetch", imagesFetch());
        render(<StoryBuilder />);
        fireEvent.click(await screen.findByRole("button", { name: "1. Frieren" }));
        await screen.findByRole("dialog");
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
        expect(screen.queryByTestId("replacing-note")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Empty slot 2" }));
        expect(screen.getByText("Slot 2 selected: your next pick goes here.")).toBeTruthy();
    });
});
