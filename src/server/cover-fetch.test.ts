import { describe, expect, it, vi } from "vitest";
import { fetchCover } from "@/server/cover-fetch";
import { isAllowedCoverUrl, isCdnCoverUrl } from "@/lib/story/config";

const OK = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg";
const img = (bytes = 10, type = "image/jpeg") =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type } });

describe("cover host allowlist", () => {
    it.each([
        "https://evil.s4.anilist.co/x.jpg",
        "https://s4.anilist.co.evil.com/x.jpg",
        "https://user@s4.anilist.co/x.jpg",
        "https://s4.anilist.co@evil.com/x.jpg",
        "http://s4.anilist.co/x.jpg",
        "https://s4.anilist.co:8443/x.jpg",
        "https://cdn.myanimelist.net.evil.io/x.jpg",
        "javascript:alert(1)",
    ])("rejects %s", (u) => {
        expect(isCdnCoverUrl(u)).toBe(false);
    });
    it("accepts the two CDNs", () => {
        expect(isCdnCoverUrl(OK)).toBe(true);
        expect(isCdnCoverUrl("https://cdn.myanimelist.net/images/anime/1/1.jpg")).toBe(true);
    });
    it("T-0010: story covers accept any PUBLIC https image, nothing else", () => {
        expect(isAllowedCoverUrl("https://i.pinimg.com/x.jpg")).toBe(true);
        for (const u of ["http://i.pinimg.com/x.jpg", "https://127.0.0.1/x.jpg", "https://10.0.0.1/x.jpg", "https://u:p@a.com/x.jpg", "https://localhost/x.jpg", "data:image/png;base64,AA", "blob:https://a.com/1", "javascript:alert(1)"])
            expect(isAllowedCoverUrl(u)).toBe(false);
    });
});

describe("fetchCover", () => {
    it("fetches an allowed image with redirect: manual", async () => {
        const f = vi.fn(async () => img(20));
        const r = await fetchCover(OK, { fetch: f as unknown as typeof fetch });
        expect(r.bytes.byteLength).toBe(20);
        expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: "manual" });
    });

    it("never calls fetch for a bad host", async () => {
        const f = vi.fn(async () => img());
        await expect(fetchCover("https://s4.anilist.co.evil.com/a.jpg", { fetch: f as unknown as typeof fetch })).rejects.toThrow("host");
        expect(f).not.toHaveBeenCalled();
    });

    it("refuses a redirect to another host", async () => {
        const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.com/x.jpg" } }));
        await expect(fetchCover(OK, { fetch: f as unknown as typeof fetch })).rejects.toThrow("redirect-host");
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("follows a redirect that stays on an allowed host", async () => {
        let n = 0;
        const f = vi.fn(async () => (n++ === 0 ? new Response(null, { status: 301, headers: { location: "/file/b.jpg" } }) : img(5)));
        expect((await fetchCover(OK, { fetch: f as unknown as typeof fetch })).bytes.byteLength).toBe(5);
    });

    it("refuses oversize (declared and streamed) and non-images", async () => {
        const big = vi.fn(async () => img(2000));
        await expect(fetchCover(OK, { fetch: big as unknown as typeof fetch, maxBytes: 1000 })).rejects.toThrow("too-big");
        const html = vi.fn(async () => img(10, "text/html"));
        await expect(fetchCover(OK, { fetch: html as unknown as typeof fetch })).rejects.toThrow("not-image");
        const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: OK } }));
        await expect(fetchCover(OK, { fetch: loop as unknown as typeof fetch })).rejects.toThrow("too-many-redirects");
    });
});
