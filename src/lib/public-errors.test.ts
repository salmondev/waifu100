import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { friendlyError, LEAK_PATTERN, UNAVAILABLE } from "@/lib/public-errors";

function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
    }
    return out;
}
const STRING = /(["'`])((?:\\.|(?!\1).)*)\1/g;
/** String literals in code (comments, console.* and featureUnavailable(..., "<log detail>") excluded). */
function leakingLiterals(file: string): string[] {
    const hits: string[] = [];
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || /console\.(error|warn|log|info)\(/.test(t)) return;
        const code = t.replace(/featureUnavailable\(\s*"[^"]+"\s*,\s*"[^"]*"\s*\)/g, "featureUnavailable()")
            // Secret NAMES passed to the central secret helper are lookups, not output.
            .replace(/(authSecret|keySecret|hasSecret|matchesSecret)\(((?:[^()]|\([^()]*\))*,\s*)?"[A-Z_]+"\s*\)/g, "$1()");
        for (const m of code.matchAll(STRING)) if (LEAK_PATTERN.test(m[2])) hits.push(`${file}:${i + 1}: ${m[0]}`);
    });
    return hits;
}
const SRC = join(process.cwd(), "src");

describe("no env names / internal config details reach the UI (T-0011)", () => {
    it("pattern catches the known leaks", () => {
        for (const s of ["GEMINI_API_KEY not configured", "SERPER_API_KEY not configured", "BLOB_READ_WRITE_TOKEN", "Uploads are not configured.", "REDIS_URL is not defined", "ADMIN_TOKEN"]) expect(LEAK_PATTERN.test(s), s).toBe(true);
        for (const s of Object.values(UNAVAILABLE)) expect(LEAK_PATTERN.test(s.error)).toBe(false);
    });
    it("API route source has no leaking string literals in responses", () => {
        const files = walk(join(SRC, "app/api"));
        expect(files.length).toBeGreaterThan(10);
        expect(files.flatMap(leakingLiterals)).toEqual([]);
    });
    it("client components and pages have no leaking string literals", () => {
        const files = [...walk(join(SRC, "components")), ...walk(join(SRC, "app")).filter((f) => !f.includes("/api/"))];
        expect(files.flatMap(leakingLiterals)).toEqual([]);
    });
    it("story web-search message is generic", () => {
        expect(leakingLiterals(join(SRC, "server/story-web-search.ts"))).toEqual([]);
    });
    it("friendlyError keeps readable messages, replaces leaks / junk with the fallback", () => {
        expect(friendlyError("This image was rejected by moderation.", "F")).toBe("This image was rejected by moderation.");
        expect(friendlyError("GEMINI_API_KEY not configured", "F")).toBe("F");
        expect(friendlyError("Uploads are not configured.", "F")).toBe("F");
        expect(friendlyError("x".repeat(201), "F")).toBe("F");
        expect(friendlyError(undefined, "F")).toBe("F");
        expect(friendlyError("  ", "F")).toBe("F");
    });
});
