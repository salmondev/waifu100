import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/story/search", async (orig) => ({
    ...(await orig<typeof import("@/lib/story/search")>()),
    storySearch: { search: vi.fn(async () => ({ items: [], source: "anilist", anilistCooldownUntil: null })), cooldownUntil: () => null },
}));

import { StoryBuilder } from "@/components/story/StoryBuilder";

afterEach(() => vi.unstubAllGlobals());

describe("StoryBuilder upload fallback", () => {
    it("sidebar has no upload button or box", () => {
        render(<StoryBuilder />);
        expect(screen.queryByRole("button", { name: /Upload your own image/ })).toBeNull();
        expect(screen.queryByLabelText("Title for uploaded image")).toBeNull();
    });

    it("no-results state offers a muted upload link that prefills the title with the query", async () => {
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ item: { id: 5, type: "ANIME", title: "x", cover: "https://abc.public.blob.vercel-storage.com/story/a.png", src: "upload" } }))
        );
        vi.stubGlobal("fetch", fetchMock);
        render(<StoryBuilder />);
        fireEvent.change(screen.getByLabelText("Search anime or manga"), { target: { value: "my obscure show" } });
        const link = await screen.findByRole("button", { name: /Can't find it\? Upload your own image/ }, { timeout: 3000 });
        const input = screen.getByTestId("upload-input") as HTMLInputElement;
        const click = vi.spyOn(input, "click");
        fireEvent.click(link);
        expect(click).toHaveBeenCalled();
        fireEvent.change(input, { target: { files: [new File(["x"], "pic.png", { type: "image/png" })] } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("/api/story/upload");
        expect((init?.body as FormData).get("title")).toBe("my obscure show");
    });
});
