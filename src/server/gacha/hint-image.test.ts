import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hintImageToken, hintImageUrl, otsuThreshold, readHintImageToken, renderBlurHint, renderSilhouetteHint } from "./hint-image";

const SALT = "test-salt";
const REF = { day: "2026-10-27", charId: 101, kind: "blur" as const };

/** A 230x320 test portrait: dark figure on a light ground, with fine stripes as "detail". */
async function portrait(): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="320">
        <rect width="230" height="320" fill="#f0e0d0"/>
        <ellipse cx="115" cy="110" rx="60" ry="70" fill="#223"/>
        <rect x="45" y="180" width="140" height="140" fill="#334"/>
        ${Array.from({ length: 40 }, (_, i) => `<rect x="${i * 6}" y="0" width="2" height="40" fill="#e00"/>`).join("")}
    </svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

describe("hint image tokens", () => {
    it("round-trips and is deterministic (one CDN-cacheable URL per day/char/kind)", () => {
        const t = hintImageToken(REF, SALT);
        expect(readHintImageToken(t, SALT)).toEqual(REF);
        expect(hintImageToken(REF, SALT)).toBe(t);
        expect(hintImageUrl(REF, SALT)).toBe(`/api/gacha/hint-image?t=${t}`);
        expect(t).toMatch(/^[A-Za-z0-9_-]{24,200}$/);
    });

    it("is opaque: no day, id or kind in clear, and each kind/char/day differs", () => {
        const t = hintImageToken(REF, SALT);
        expect(t).not.toContain("101");
        expect(Buffer.from(t, "base64url").toString("latin1")).not.toMatch(/2026|blur|101/);
        const others = [
            hintImageToken({ ...REF, kind: "silhouette" }, SALT),
            hintImageToken({ ...REF, charId: 102 }, SALT),
            hintImageToken({ ...REF, day: "2026-10-28" }, SALT),
            hintImageToken(REF, "other-salt"),
        ];
        expect(new Set([t, ...others]).size).toBe(5);
    });

    it("rejects tampered, foreign-salt and malformed tokens", () => {
        const t = hintImageToken(REF, SALT);
        const raw = Buffer.from(t, "base64url");
        for (const i of [0, 13, raw.length - 1]) {
            const bad = Buffer.from(raw);
            bad[i] ^= 1;
            expect(readHintImageToken(bad.toString("base64url"), SALT)).toBeNull();
        }
        expect(readHintImageToken(t, "other-salt")).toBeNull();
        expect(readHintImageToken(t.slice(0, -4), SALT)).toBeNull();
        for (const junk of ["", "x", null, 7, "a".repeat(300), "https://s4.anilist.co/x.png"]) expect(readHintImageToken(junk, SALT)).toBeNull();
    });
});

describe("hint image renderers", () => {
    it("otsu splits a bimodal histogram between the modes", () => {
        const t = otsuThreshold(new Uint8Array([...Array(50).fill(20), ...Array(50).fill(220)]));
        expect(t).toBeGreaterThanOrEqual(20);
        expect(t).toBeLessThan(220);
    });

    it("blur: small webp with no fine detail and no metadata", async () => {
        const out = await renderBlurHint(await portrait());
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("webp");
        expect(meta.width).toBe(224);
        expect(meta.exif ?? meta.icc ?? meta.xmp).toBeUndefined();
        // the 2px stripes are gone: neighbouring columns in the top band barely differ
        const { data, info } = await sharp(out).extract({ left: 20, top: 5, width: 180, height: 1 }).raw().toBuffer({ resolveWithObject: true });
        let maxStep = 0;
        for (let x = 1; x < 180; x++) maxStep = Math.max(maxStep, Math.abs(data[x * info.channels] - data[(x - 1) * info.channels]));
        expect(maxStep).toBeLessThan(24);
    });

    it("silhouette: a two-colour png at 40 px resolution", async () => {
        const out = await renderSilhouetteHint(await portrait());
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe("png");
        expect(meta.width).toBe(200);
        const { data, info } = await sharp(out).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const colours = new Set<string>();
        for (let i = 0; i < data.length; i += info.channels) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        expect([...colours].sort()).toEqual(["255,241,232", "29,43,83"]);
    });
});
