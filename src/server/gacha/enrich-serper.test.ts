// @vitest-environment node
import { createServer, type Server } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { effectiveCap, serperEndpoint } from "../../../scripts/gacha/enrich/lib/serper-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, "scripts/gacha/enrich/serper.mjs");
const FAKE_KEY = "test-serper-key-t0027-do-not-leak";

function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        ...extra,
    };
}

function runSerper(args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        env,
        encoding: "utf8",
    });
}

// Async spawn: a server in this process cannot answer while spawnSync blocks the event loop.
function runSerperAsync(args: string[], env: NodeJS.ProcessEnv) {
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        child.on("error", reject);
        child.on("close", (status: number | null) => resolve({ status, stdout, stderr }));
    });
}

describe("effectiveCap", () => {
    it("uses --max when there is no daily cap", () => {
        expect(effectiveCap({ max: 50, dailyCap: undefined, usedToday: 0 })).toBe(50);
        expect(effectiveCap({ max: 50, dailyCap: "", usedToday: 10 })).toBe(50);
    });

    it("treats a malformed cap as zero queries", () => {
        expect(effectiveCap({ max: 50, dailyCap: "nope", usedToday: 0 })).toBe(0);
        expect(effectiveCap({ max: 50, dailyCap: "-1", usedToday: 0 })).toBe(0);
    });

    it("subtracts queries already used today", () => {
        expect(effectiveCap({ max: 50, dailyCap: "10", usedToday: 3 })).toBe(7);
        expect(effectiveCap({ max: 50, dailyCap: "10", usedToday: 10 })).toBe(0);
        expect(effectiveCap({ max: 4, dailyCap: "10", usedToday: 0 })).toBe(4);
    });
});

describe("serperEndpoint", () => {
    it("rejects a host that is not localhost", () => {
        expect(() => serperEndpoint("https://google.serper.dev/search")).toThrow(/localhost/);
        expect(() => serperEndpoint("http://example.com")).toThrow(/localhost/);
    });

    it("allows a localhost override", () => {
        expect(serperEndpoint(undefined)).toBe("https://google.serper.dev/search");
        expect(serperEndpoint("http://127.0.0.1:9/search")).toBe("http://127.0.0.1:9/search");
        expect(serperEndpoint("http://localhost:9/search")).toBe("http://localhost:9/search");
    });
});

describe("serper.mjs", () => {
    const dirs: string[] = [];
    let server: Server | undefined;

    afterEach(async () => {
        server?.close();
        server = undefined;
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it("exits 2 when --live has no key, and a dry-run does not print a key that is sitting in the environment", () => {
        const missing = runSerper(["--live", "--max", "1"], childEnv());
        expect(missing.status).toBe(2);
        expect(`${missing.stdout}${missing.stderr}`).toMatch(/SERPER_API_KEY/);
        expect(`${missing.stdout}${missing.stderr}`).not.toContain(FAKE_KEY);

        const dry = runSerper(["--max", "1"], childEnv({ SERPER_API_KEY: FAKE_KEY }));
        expect(dry.status).toBe(0);
        expect(`${dry.stdout}${dry.stderr}`).not.toContain(FAKE_KEY);
    });

    it("sends the key only to a localhost endpoint and does not write it to stdout, stderr, or the output file", async () => {
        const seen: string[] = [];
        server = createServer((req, res) => {
            seen.push(req.headers["x-api-key"] as string);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ organic: [{ snippet: "unrelated", link: "https://example.com/a" }] }));
        });
        server.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
        const port = (server.address() as { port: number }).port;
        const dir = mkdtempSync(path.join(tmpdir(), "t0027-serper-"));
        dirs.push(dir);
        const out = path.join(dir, "serper-candidates.json");
        const ledger = path.join(dir, "ledger.json");

        const live = await runSerperAsync(
            ["--live", "--max", "1", "--out", out, "--ledger", ledger],
            childEnv({
                SERPER_API_KEY: FAKE_KEY,
                SERPER_ENDPOINT: `http://127.0.0.1:${port}/search`,
            }),
        );

        const written = existsSync(out) ? readFileSync(out, "utf8") : "";
        const combined = `${live.stdout}${live.stderr}${written}`;
        expect(live.status, combined).toBe(0);
        expect(seen).toEqual([FAKE_KEY]);
        expect(combined).not.toContain(FAKE_KEY);
        expect(written).toContain('"tool": "serper"');
    }, 20000);
});
