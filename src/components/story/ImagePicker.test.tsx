import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { clearImagePickerCache, ImagePicker } from "@/components/story/ImagePicker";

const item = { id: 1, type: "ANIME" as const, title: "Cowboy Bebop", cover: "https://s4.anilist.co/xl.jpg", src: "anilist" as const, year: 1998 };
afterEach(() => { clearImagePickerCache(); }); afterEach(() => vi.unstubAllGlobals());

describe("ImagePicker (T-0010)", () => {
    it("main cover is shown and selectable immediately; sources stream in independently; only ids go to the server", async () => {
        const pending: Record<string, (r: Response) => void> = {};
        const urls: string[] = [];
        vi.stubGlobal("fetch", vi.fn((u: string) => { urls.push(u); return new Promise<Response>((r) => (pending[new URL(u, "http://x").searchParams.get("source")!] = r)); }));
        const onPick = vi.fn();
        render(<ImagePicker item={item} onPick={onPick} onClose={() => {}} onUpload={async () => null} />);
        // before any source answers
        expect(screen.getAllByTestId("choice-skeleton").length).toBeGreaterThan(0);
        fireEvent.click(screen.getByTitle("Cover"));
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ cover: item.cover }));
        expect(urls).toHaveLength(3);
        for (const u of urls) {
            const p = new URL(u, "http://x").searchParams;
            expect([...p.keys()].sort()).toEqual(["id", "source", "src", "type"]);
            expect(u).not.toContain("https");
        }
        // jikan answers first; anilist still loading -> mal section visible already
        pending.jikan(new Response(JSON.stringify({ choices: [{ url: "https://cdn.myanimelist.net/p.jpg", source: "mal", label: "MAL 1", hash: "H2" }] })));
        await waitFor(() => screen.getByTitle("MAL 1"));
        expect(screen.getByTestId("source-loading")).toBeTruthy();
        pending.anilist(new Response(JSON.stringify({ choices: [
            { url: "https://s4.anilist.co/xl.jpg", source: "anilist", label: "Cover (AniList)", hash: "H1" },
            { url: "https://s4.anilist.co/rel.jpg", source: "relation", label: "Sequel: X", hash: "H2" },
        ] })));
        pending.web(new Response(JSON.stringify({ choices: [] })));
        await waitFor(() => expect(screen.queryByTestId("source-loading")).toBeNull());
        // cross-source dedupe by server hash: anilist (higher priority) keeps H2, the MAL duplicate goes
        expect(screen.getByTitle("Sequel: X")).toBeTruthy();
        expect(screen.queryByTitle("MAL 1")).toBeNull();
        expect(screen.queryByLabelText("From the web")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        for (const img of document.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/^\/api\/img\?u=/);
    });
    it("a failing extra source stays quiet", async () => {
        vi.stubGlobal("fetch", vi.fn(async (u: string) => u.includes("source=jikan") ? new Response("{}", { status: 502 }) : new Response(JSON.stringify({ choices: [] }))));
        render(<ImagePicker item={item} onPick={() => {}} onClose={() => {}} onUpload={async () => null} />);
        await waitFor(() => expect(screen.queryByTestId("source-loading")).toBeNull());
        expect(screen.queryByRole("alert")).toBeNull();
    });
    it("picking an image places the title with that cover", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ url: "https://cdn.myanimelist.net/p.jpg", source: "mal", label: "MAL 1" }] }))));
        const onPick = vi.fn();
        render(<ImagePicker item={item} onPick={onPick} onClose={() => {}} onUpload={async () => null} />);
        await waitFor(() => screen.getByTitle("MAL 1"));
        fireEvent.click(screen.getByTitle("MAL 1"));
        expect(onPick).toHaveBeenCalledWith({ id: 1, type: "ANIME", title: "Cowboy Bebop", cover: "https://cdn.myanimelist.net/p.jpg", src: "anilist" });
    });
    it("an API error is readable and the main cover is still offered", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Couldn't load images for this title right now. Please try again." }), { status: 502 })));
        render(<ImagePicker item={item} onPick={() => {}} onClose={() => {}} onUpload={async () => null} />);
        await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't load images"));
        expect(screen.getByTitle("Cover")).toBeTruthy();
    });
    it("upload is a small link at the END of the list and uploads with the title prefilled", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ url: "https://cdn.myanimelist.net/p.jpg", source: "mal", label: "MAL 1" }] }))));
        const onUpload = vi.fn(async () => null);
        render(<ImagePicker item={item} onPick={() => {}} onClose={() => {}} onUpload={onUpload} />);
        await waitFor(() => screen.getByTitle("MAL 1"));
        expect(screen.queryByText("Upload your own image for this title")).toBeNull();
        const link = screen.getByRole("button", { name: /Can't find it\? Upload your own image/ });
        const all = [...document.querySelectorAll("section, button")];
        expect(all.indexOf(link)).toBeGreaterThan(all.indexOf(screen.getByLabelText("MyAnimeList pictures")));
        const input = screen.getByTestId("picker-upload-input") as HTMLInputElement;
        const click = vi.spyOn(input, "click");
        fireEvent.click(link);
        expect(click).toHaveBeenCalled();
        const file = new File(["x"], "mine.png", { type: "image/png" });
        fireEvent.change(input, { target: { files: [file] } });
        await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file, expect.objectContaining({ title: "Cowboy Bebop", id: 1, type: "ANIME" })));
    });
});
