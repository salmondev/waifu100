import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { proxied } from "@/lib/img-proxy";

/**
 * T-0009 review M4: every <img> / element .src in the app must go through the
 * moderated proxy. Static scan of src/ (the "lint") + render checks.
 */
const ROOT = join(process.cwd(), "src");
function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) return files(p);
        return /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
}
const SAFE_CALL = /^(proxied|proxiedAbsolute|optimizedImageSrc)\(/;
/** Variables that are allowed as src, each with the proof it is moderated. */
const SAFE_VARS: Record<string, { name: string; proof: RegExp }[]> = {
    "components/community/GridCard.tsx": [{ name: "preview", proof: /const preview = proxied\(/ }],
    // Server OG cards: src is a data: URI built from getModeratedImage() bytes.
    "lib/share-og.tsx": [{ name: "src", proof: /getModeratedImage\(/ }],
    "lib/compare-og.tsx": [{ name: "src", proof: /resolveImages/ }],
    // Hidden probes / export: assigned from proxied() or canvas data URLs.
    "app/page.tsx": [
        { name: "proxiedSrc", proof: /const proxiedSrc = proxied\(/ },
        { name: "frame", proof: /canvas\.toDataURL/ },
        { name: "src", proof: /swappedSrcs\.push\(\{ el: img, src \}\)/ }, // restores the original (already proxied) src
        { name: "result", proof: /readAsDataURL\(file\)/ }, // user's own local file, never saved as data:
        { name: "next", proof: /const next = tries === 0 \? el\.src : proxied\(/ },
    ],
    "lib/story/export.ts": [{ name: "src", proof: /loadImage\(proxied\(/ }],
};

const sinks: { file: string; expr: string }[] = [];
for (const f of files(ROOT)) {
    const rel = relative(ROOT, f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/<img\b[^>]*?\bsrc=\{\s*([^\s,}][^}]*)/g)) sinks.push({ file: rel, expr: m[1].trim() });
    for (const m of text.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)) sinks.push({ file: rel, expr: `"${m[1]}"` });
    for (const m of text.matchAll(/\b(?:img|el|probe|image)\.src\s*=(?!=)\s*([^;\n]+)/g)) sinks.push({ file: rel, expr: m[1].trim() });
}

describe("image sinks (static)", () => {
    it("found the known sinks", () => {
        expect(sinks.length).toBeGreaterThan(25);
    });
    it.each(sinks.map((s) => [s.file, s.expr] as const))("%s: src=%s is moderated", (file, expr) => {
        if (SAFE_CALL.test(expr)) return;
        if (/^"\/(?!\/)/.test(expr)) return; // local asset
        const allowed = (SAFE_VARS[file] ?? []).find((v) => expr === v.name);
        expect(allowed, `unproxied src in ${file}: ${expr}`).toBeTruthy();
        expect(readFileSync(join(ROOT, file), "utf8")).toMatch(allowed!.proof);
    });
    it("nothing uses next/image or the Next optimizer", () => {
        for (const f of files(ROOT)) expect(readFileSync(f, "utf8"), f).not.toMatch(/from ["']next\/image["']|\/_next\/image\?/);
    });
    it("no CSS background image from a URL", () => {
        for (const f of files(ROOT)) expect(readFileSync(f, "utf8"), f).not.toMatch(/backgroundImage:\s*[`'"]?url\(|background:\s*[`'"]url\(/);
    });
});

describe("proxied()", () => {
    it.each([
        ["https://s4.anilist.co/a.jpg", /^\/api\/img\?u=https%3A%2F%2Fs4\.anilist\.co%2Fa\.jpg&w=256$/],
        ["https://evil.example.com/a.jpg", /^\/api\/img\?u=/],
        ["http://s4.anilist.co/a.jpg", /^$/],
        ["javascript:alert(1)", /^$/],
        ["//evil.example.com/a.jpg", /^$/],
        ["/\\evil.example.com/a.jpg", /^$/],
        ["/story-placeholder.png", /^\/story-placeholder\.png$/],
    ])("%s", (u, re) => expect(proxied(u, 256)).toMatch(re));
});

vi.mock("@/components/compare/CompareWithMine", () => ({ CompareWithMine: () => null }));

describe("render: remote images come out as /api/img", () => {
    const remote = "https://cdn.myanimelist.net/images/characters/1/1.jpg";
    it("GridCard", async () => {
        const { GridCard } = await import("@/components/community/GridCard");
        const { container } = render(<GridCard grid={{ id: "a", title: "T", imageUrl: remote, createdAt: "2026-01-01T00:00:00.000Z", hasGif: false, count: 1 }} />);
        const imgs = [...container.querySelectorAll("img")];
        expect(imgs.length).toBeGreaterThan(0);
        for (const i of imgs) expect(i.getAttribute("src")).toMatch(/^\/api\/img\?u=/);
    });
    it("MediaGrid", async () => {
        const { MediaGrid } = await import("@/components/grid/MediaGrid");
        const { container } = render(<MediaGrid items={[{ id: 1 }]} columns={1} toCell={() => ({ key: "1", image: remote, label: "A" })} />);
        for (const i of container.querySelectorAll("img")) expect(i.getAttribute("src")).toMatch(/^\/api\/img\?u=/);
    });
});
