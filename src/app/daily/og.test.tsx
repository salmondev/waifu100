// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/gacha/gacha-app", () => ({ GachaApp: () => null }));
vi.mock("./gacha.css", () => ({}));

describe("/daily link preview (T-0025)", () => {
    it("has absolute-URL metadata, a large X card and a theme colour", async () => {
        const { metadata, viewport } = await import("./page");
        expect(String(metadata.metadataBase)).toBe("https://waifu100.vercel.app/");
        expect(metadata.openGraph).toMatchObject({ url: "/daily", siteName: "WAIFU100", title: metadata.title, description: metadata.description });
        expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
        expect(viewport.themeColor).toBe("#29adff");
    });

    it("renders a 1200x630 PNG from local fonts only (no network font fallback)", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const { renderDailyOg, OG_SIZE } = await import("./_og/card");
        const res = await renderDailyOg();
        const png = Buffer.from(await res.arrayBuffer());
        expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_SIZE.width, OG_SIZE.height]);
        // next/og loads its own wasm from a data: URL; anything else (e.g. its Google Fonts fallback for a glyph our
        // bundled fonts miss) would be a runtime external fetch.
        const urls = fetchSpy.mock.calls.map(([u]) => String(u)).filter((u) => !u.startsWith("data:"));
        expect(urls).toEqual([]);
    }, 30000);
});
