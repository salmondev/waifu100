import { afterEach, describe, expect, it, vi } from "vitest";
import { authSecret, bearerToken, keySecret, matchesSecret, safeEqual, snapshotKeySecret } from "@/lib/secret-auth";
import { missingSecrets, resetSecretWarning, warnIfMissingSecrets } from "@/server/secret-warning";

afterEach(() => {
    vi.unstubAllEnvs();
    resetSecretWarning();
});
const req = (auth?: string) => new Request("http://x", { headers: auth === undefined ? {} : { authorization: auth } });

describe("secret-auth helper (T-0012)", () => {
    it.each(["ADMIN_TOKEN", "CRON_SECRET", "BACKUP_SECRET"] as const)("%s: unset / empty / whitespace never match, even an empty value", (name) => {
        vi.stubEnv(name, undefined as unknown as string);
        expect(authSecret(name)).toBeNull();
        expect(matchesSecret("", name)).toBe(false);
        expect(matchesSecret(undefined, name)).toBe(false);
        for (const blank of ["", "   ", "\t\n"]) {
            vi.stubEnv(name, blank);
            expect(authSecret(name)).toBeNull();
            expect(matchesSecret(blank, name)).toBe(false);
            expect(matchesSecret("", name)).toBe(false);
        }
        vi.stubEnv(name, "right-secret");
        expect(matchesSecret("wrong", name)).toBe(false);
        expect(matchesSecret("right-secre", name)).toBe(false);
        expect(matchesSecret("right-secret ", name)).toBe(true); // both sides trimmed (M1)
        expect(matchesSecret("right-secretx", name)).toBe(false);
        expect(matchesSecret("  ", name)).toBe(false);
        expect(matchesSecret("right-secret", name)).toBe(true);
    });
    it("safeEqual is length-safe (no throw on different lengths)", () => {
        expect(() => safeEqual("a", "a much longer value")).not.toThrow();
        expect(safeEqual("a", "a much longer value")).toBe(false);
        expect(safeEqual("same", "same")).toBe(true);
    });
    it("bearerToken: empty Bearer / other schemes / missing -> null", () => {
        for (const h of [undefined, "", "Bearer", "Bearer ", "Bearer    ", "Basic abc", "bearerabc"]) expect(bearerToken(req(h))).toBeNull();
        expect(bearerToken(req("Bearer abc"))).toBe("abc");
    });
    it("startup warning: names only, never values; louder in production; once per process", () => {
        vi.stubEnv("CRON_SECRET", "");
        vi.stubEnv("BACKUP_SECRET", "  ");
        vi.stubEnv("ADMIN_TOKEN", "admin-value-xyz");
        expect(missingSecrets()).toEqual(["CRON_SECRET", "BACKUP_SECRET"]);
        const log = vi.fn();
        expect(warnIfMissingSecrets(log)).toBe(true);
        expect(warnIfMissingSecrets(log)).toBe(false);
        const dev = log.mock.calls[0][0] as string;
        expect(dev).toContain("CRON_SECRET");
        expect(dev).toContain("401");
        expect(dev).not.toContain("admin-value-xyz");
        resetSecretWarning();
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("CRON_SECRET", "cron-value-123");
        const log2 = vi.fn();
        warnIfMissingSecrets(log2);
        const prod = log2.mock.calls[0][0] as string;
        expect(prod).toContain("FATAL CONFIG: BACKUP_SECRET MISSING IN PRODUCTION");
        expect(prod).not.toContain("cron-value-123");
        expect(prod).not.toContain("admin-value-xyz");
    });
    it("startup warning: silent when both are set", () => {
        vi.stubEnv("CRON_SECRET", "c");
        vi.stubEnv("BACKUP_SECRET", "b");
        const log = vi.fn();
        expect(warnIfMissingSecrets(log)).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });
    it("M1: trailing newline/space in the env value still matches (auth only)", () => {
        for (const v of ["secret\n", "secret ", "  secret\r\n"]) {
            vi.stubEnv("CRON_SECRET", v);
            expect(matchesSecret(bearerToken(req("Bearer secret")), "CRON_SECRET")).toBe(true);
            expect(matchesSecret(bearerToken(req("Bearer secretx")), "CRON_SECRET")).toBe(false);
        }
        vi.stubEnv("ADMIN_TOKEN", "tok\n");
        expect(matchesSecret(new Request("http://x", { headers: { "x-admin-token": "tok" } }).headers.get("x-admin-token"), "ADMIN_TOKEN")).toBe(true);
        expect(authSecret("ADMIN_TOKEN")).toBe("tok");
    });
    it("M1: key accessors keep the RAW value; whitespace-only still means unset", () => {
        vi.stubEnv("BACKUP_SECRET", "backup \n");
        vi.stubEnv("ADMIN_TOKEN", "tok\n");
        expect(keySecret("BACKUP_SECRET")).toBe("backup \n");
        expect(snapshotKeySecret()).toBe("backup \n");
        vi.stubEnv("BACKUP_SECRET", " \n ");
        expect(snapshotKeySecret()).toBe("tok\n");
        vi.stubEnv("ADMIN_TOKEN", "\n");
        expect(snapshotKeySecret()).toBeNull();
        expect(authSecret("ADMIN_TOKEN")).toBeNull();
    });
});
