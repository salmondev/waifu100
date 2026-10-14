import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDecipheriv, scryptSync } from "crypto";

/** Decrypts the cron snapshot layout magic(8) salt(16) iv(12) tag(16) body with `secret`; null if the key is wrong. */
function decryptWith(buf: Buffer, secret: string): string | null {
    const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52), body = buf.subarray(52);
    try {
        const d = createDecipheriv("aes-256-gcm", scryptSync(secret, salt, 32), iv);
        d.setAuthTag(tag);
        return Buffer.concat([d.update(body), d.final()]).toString("utf8");
    } catch {
        return null;
    }
}
const put = vi.fn(async (name: string, _body: Buffer) => ({ url: `https://blob.test/${name}` }));
vi.mock("@vercel/blob", () => ({ put: (n: string, b: Buffer) => put(n, b), list: async () => ({ blobs: [] }), del: async () => {} }));
const fakeRedis = {
    set: async () => "OK",
    scan: async () => ["0", ["waifu100:share:abc"]],
    pipeline() {
        const p = { type: () => p, pttl: () => p, exec: async () => [[null, "string"], [null, -1]] };
        return p;
    },
    get: async () => JSON.stringify({ grid: [] }),
};
vi.mock("@/lib/redis", async (orig) => ({ ...(await orig<typeof import("@/lib/redis")>()), withRedis: (fn: (r: unknown) => unknown) => Promise.resolve(fn(fakeRedis)) }));

import { GET as cron } from "@/app/api/cron/route";

afterEach(() => {
    vi.unstubAllEnvs();
    put.mockClear();
});

describe("cron (T-0012 review M1)", () => {
    it("CRON_SECRET with a trailing newline authorizes Bearer <trimmed>; snapshot key gets the RAW BACKUP_SECRET", async () => {
        vi.stubEnv("CRON_SECRET", "secret\n");
        vi.stubEnv("BACKUP_SECRET", "backup-key \n");
        vi.stubEnv("ADMIN_TOKEN", "");
        const res = await cron(new NextRequest("http://l/api/cron", { headers: { authorization: "Bearer secret" } }));
        expect(res.status).toBe(200);
        expect(put).toHaveBeenCalledTimes(1);
        const enc = put.mock.calls[0][1] as Buffer;
        expect(enc.subarray(0, 8).toString("ascii")).toBe("W100BAK1");
        expect(decryptWith(enc, "backup-key \n")).toContain("waifu100:share:abc"); // RAW value is the key
        expect(decryptWith(enc, "backup-key")).toBeNull(); // trimmed value is NOT
    });
    it("falls back to the RAW ADMIN_TOKEN as key when BACKUP_SECRET is blank", async () => {
        vi.stubEnv("CRON_SECRET", "secret ");
        vi.stubEnv("BACKUP_SECRET", "  ");
        vi.stubEnv("ADMIN_TOKEN", "tok\n");
        const res = await cron(new NextRequest("http://l/api/cron", { headers: { authorization: "Bearer secret" } }));
        expect(res.status).toBe(200);
        const enc = put.mock.calls[0][1] as Buffer;
        expect(decryptWith(enc, "tok\n")).not.toBeNull();
        expect(decryptWith(enc, "tok")).toBeNull();
    });
    it("no usable key: snapshot skipped, nothing uploaded", async () => {
        vi.stubEnv("CRON_SECRET", "secret");
        vi.stubEnv("BACKUP_SECRET", " \n");
        vi.stubEnv("ADMIN_TOKEN", "");
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const res = await cron(new NextRequest("http://l/api/cron", { headers: { authorization: "Bearer secret" } }));
        expect((await res.json()).snapshot).toBeNull();
        expect(put).not.toHaveBeenCalled();
    });
});
