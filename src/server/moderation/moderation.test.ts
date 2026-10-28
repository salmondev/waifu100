import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { setCatalog } from "@/server/gacha/catalog";
import type { Catalog } from "@/server/gacha/catalog-types";
import { animatedGifFrames, configureModeration, getModeratedImage, GIF_MAX_BYTES, GIF_MAX_FRAMES, moderateBytes, sha256 } from "@/server/moderation/moderator";
import { ClassifyError, parseClassification } from "@/server/moderation/classifier";
import { memoryVerdictStore } from "@/server/moderation/verdict-store";
import { isPublicHttpsUrl } from "@/server/moderation/safe-fetch";

async function png(color: string) {
    return sharp({ create: { width: 20, height: 20, channels: 3, background: color } }).png().toBuffer();
}
const fetchReturning = (bytes: Buffer) =>
    vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } }));

afterEach(() => configureModeration());

describe("classifier parsing (fail closed)", () => {
    it("accepts a complete answer", () => {
        expect(parseClassification('[{"i":1,"ok":false},{"i":0,"ok":true}]', 2)).toEqual([true, false]);
        expect(parseClassification('```json\n[{"i":0,"ok":true}]\n```', 1)).toEqual([true]);
    });
    it.each(["", "nope", "[]", '[{"i":0}]', '[{"i":0,"ok":"yes"}]', '[{"i":0,"ok":true},{"i":0,"ok":true}]', '{"i":0,"ok":true}'])(
        "rejects %j",
        (t) => {
            expect(() => parseClassification(t, t.includes("},{") ? 2 : 1)).toThrow(ClassifyError);
        }
    );
});

describe("moderated image", () => {
    it("serves allowed bytes and caches the verdict by sha256", async () => {
        const bytes = await png("#ff0000");
        const store = memoryVerdictStore();
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store, fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch } });
        const r = await getModeratedImage("https://img.example.com/a.png", 64);
        expect(r.ok).toBe(true);
        expect(store.map.get(sha256(bytes))).toBe("a");
        await getModeratedImage("https://other.example.com/same.png", 64);
        expect(classify).toHaveBeenCalledTimes(1); // same bytes, other URL: cache hit
    });

    it("re-checks when the same URL starts serving different bytes", async () => {
        const store = memoryVerdictStore();
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => false));
        let n = 0;
        const a = await png("#00ff00");
        const b = await png("#0000ff");
        const f = vi.fn(async () => new Response(new Uint8Array(n++ === 0 ? a : b), { status: 200, headers: { "content-type": "image/png" } }));
        store.map.set(sha256(a), "a");
        configureModeration({ classify, store, fetchOptions: { fetch: f as unknown as typeof fetch } });
        expect((await getModeratedImage("https://x.example.com/p.png", 64)).ok).toBe(true);
        const second = await getModeratedImage("https://x.example.com/p.png", 64);
        expect(second).toMatchObject({ ok: false, reason: "blocked" });
        expect(classify).toHaveBeenCalledTimes(1);
    });

    it.each(["no-key", "rate-limited", "timeout", "empty", "malformed", "error"] as const)(
        "shows %s as unchecked (fail open), never caches, re-checks next time",
        async (reason) => {
            const bytes = await png("#123456");
            const store = memoryVerdictStore();
            configureModeration({
                classify: async () => {
                    throw new ClassifyError(reason);
                },
                store,
                fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch },
            });
            const r = await getModeratedImage("https://img.example.com/a.png", 64);
            expect(r).toMatchObject({ ok: true, checked: false, reason });
            expect(store.map.size).toBe(0);
            // uploads still need a real "a"
            expect((await moderateBytes(bytes)).verdict).toBe("u");
        }
    );

    it("safety block on a batch re-checks individually; single safety block is cached as blocked", async () => {
        const store = memoryVerdictStore();
        const classify = vi.fn(async (xs: unknown[]) => {
            if (xs.length > 1) throw new ClassifyError("safety");
            if (classify.mock.calls.length === 2) throw new ClassifyError("safety");
            return [true];
        });
        configureModeration({ classify, store });
        const [x, y] = await Promise.all([moderateBytes(await png("#111111")), moderateBytes(await png("#222222"))]);
        expect([x.verdict, y.verdict].sort()).toEqual(["a", "b"]);
        expect(classify).toHaveBeenCalledTimes(3);
        expect([...store.map.values()].sort()).toEqual(["a", "b"]);
    });

    it("batches concurrent cache misses into one call", async () => {
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store: memoryVerdictStore() });
        const colors = ["#010101", "#020202", "#030303", "#040404"];
        await Promise.all(colors.map(async (c) => moderateBytes(await png(c))));
        expect(classify).toHaveBeenCalledTimes(1);
        expect((classify.mock.calls[0] as unknown[][])[0]).toHaveLength(4);
    });

    it("undecodable bytes are blocked without spending a call", async () => {
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => true));
        configureModeration({ classify, store: memoryVerdictStore() });
        expect((await moderateBytes(Buffer.from("not an image"))).verdict).toBe("b");
        expect(classify).not.toHaveBeenCalled();
    });

    it("SSRF guard rejects private and odd hosts before fetching", async () => {
        const f = vi.fn();
        configureModeration({ fetchOptions: { fetch: f as unknown as typeof fetch }, store: memoryVerdictStore() });
        for (const u of ["http://a.com/x.png", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://169.254.169.254/latest", "https://192.168.1.1/x", "https://u:p@a.com/x", "https://a.com:8080/x", "https://intranet/x", "https://[::1]/x", "https://svc.internal/x"]) {
            expect(isPublicHttpsUrl(u)).toBe(false);
            expect((await getModeratedImage(u, 64)).ok).toBe(false);
        }
        expect(f).not.toHaveBeenCalled();
    });

    it("dev bypass works only outside production", async () => {
        const bytes = await png("#abcdef");
        configureModeration({ classify: async () => { throw new ClassifyError("no-key"); }, store: memoryVerdictStore(), bypass: () => true, fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch } });
        expect((await getModeratedImage("https://img.example.com/a.png", 64)).ok).toBe(true);
    });

    it("AI block still blocks (placeholder), even though failures fail open", async () => {
        const bytes = await png("#654321");
        configureModeration({ classify: async (xs) => xs.map(() => false), store: memoryVerdictStore(), fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch } });
        expect(await getModeratedImage("https://img.example.com/b.png", 64)).toMatchObject({ ok: false, reason: "blocked", definitive: true });
    });

    it("serves a shipped catalog portrait even when the checker would block it, and still blocks other URLs", async () => {
        const bytes = await png("#abcdef");
        const url = "https://s4.anilist.co/file/anilistcdn/character/large/b51347-test.png";
        const catalog = {
            generatedAt: "2026-10-28T00:00:00.000Z",
            source: "test",
            imageNote: "",
            anime: [{
                id: 1,
                titleRomaji: "Test",
                titleEnglish: null,
                titleNative: null,
                cover: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-test.jpg",
                coverColor: null,
                popularity: 1,
                setCode: "TST",
                siteUrl: "https://anilist.co/anime/1",
                characters: [{
                    id: 51347,
                    name: "Akeno Himejima",
                    nameNative: null,
                    alternative: [],
                    gender: "Female",
                    age: null,
                    role: "MAIN" as const,
                    favourites: 1,
                    image: url,
                    siteUrl: "https://anilist.co/character/51347",
                    hair: null,
                    occupation: null,
                    quote: null,
                    silhouette: null,
                }],
            }],
        } satisfies Catalog;
        setCatalog(catalog);
        const classify = vi.fn(async (xs: unknown[]) => xs.map(() => false));
        const store = memoryVerdictStore();
        configureModeration({ classify, store, fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch } });
        try {
            const served = await getModeratedImage(url, 64);
            expect(served.ok).toBe(true);
            if (served.ok) expect(served.checked).toBe(true);
            expect(classify).not.toHaveBeenCalled();
            expect(store.map.size).toBe(0);
            expect(await getModeratedImage("https://img.example.com/upload.png", 64)).toMatchObject({ ok: false, reason: "blocked", definitive: true });
            expect(classify).toHaveBeenCalledTimes(1);
        } finally {
            setCatalog(null);
        }
    });
});

async function gif(frames: string[]) {
    const raw = await Promise.all(frames.map((c) => sharp({ create: { width: 16, height: 16, channels: 3, background: c } }).raw().toBuffer()));
    return sharp(Buffer.concat(raw), { raw: { width: 16, height: 16 * frames.length, channels: 3, pageHeight: 16 } as never })
        .gif()
        .toBuffer();
}

describe("animated GIFs", () => {
    it("checks first/middle/last frames in ONE request and serves the exact original bytes", async () => {
        const bytes = await gif(["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff"]);
        expect(await animatedGifFrames(bytes)).toBe(5);
        const classify = vi.fn(async (xs: { jpeg: Buffer }[]) => xs.map(() => true));
        configureModeration({ classify, store: memoryVerdictStore(), fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/gif" } })) as unknown as typeof fetch } });
        const r = await getModeratedImage("https://media.tenor.com/x.gif", 64, { animated: true });
        expect(r.ok && r.gif && Buffer.compare(r.gif, bytes)).toBe(0);
        expect(classify).toHaveBeenCalledTimes(1);
        const input = (classify.mock.calls[0][0] as { jpeg: Buffer }[])[0].jpeg;
        const meta = await sharp(input).metadata();
        expect([meta.width, meta.height]).toEqual([768, 256]); // 3 frames side by side
    });
    it("over the frame cap or size cap: first frame only", async () => {
        expect(animatedGifFrames(Buffer.alloc(GIF_MAX_BYTES + 1))).resolves.toBe(0);
        const bytes = await gif(Array.from({ length: GIF_MAX_FRAMES + 1 }, (_, i) => (i % 2 ? "#000000" : "#ffffff")));
        expect(await animatedGifFrames(bytes)).toBe(0);
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore(), fetchOptions: { fetch: (async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/gif" } })) as unknown as typeof fetch } });
        const r = await getModeratedImage("https://media.tenor.com/big.gif", 64, { animated: true });
        expect(r.ok && r.gif).toBeFalsy();
        expect(r.ok && r.jpeg.length).toBeGreaterThan(0);
    });
    it("a still image never gets a gif body", async () => {
        const bytes = await png("#777777");
        configureModeration({ classify: async (xs) => xs.map(() => true), store: memoryVerdictStore(), fetchOptions: { fetch: fetchReturning(bytes) as unknown as typeof fetch } });
        const r = await getModeratedImage("https://img.example.com/s.png", 64, { animated: true });
        expect(r.ok && r.gif).toBeFalsy();
    });
});
