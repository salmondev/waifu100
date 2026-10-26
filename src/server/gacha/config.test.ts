import { describe, expect, it } from "vitest";
import { GachaConfigError, isDeployedEnv, resolveDailySalt } from "./config";
import { DEV_DAILY_SALT } from "./rules";

describe("resolveDailySalt", () => {
    it("uses DAILY_SALT whenever it is set", () => {
        expect(resolveDailySalt({ NODE_ENV: "production", DAILY_SALT: "s3cret" })).toBe("s3cret");
        expect(resolveDailySalt({ NODE_ENV: "development", DAILY_SALT: "s3cret" })).toBe("s3cret");
    });

    it.each([
        [{ NODE_ENV: "production" }],
        [{ NODE_ENV: "production", DAILY_SALT: "" }],
        [{ NODE_ENV: "production", DAILY_SALT: "   " }],
        [{ NODE_ENV: "development", VERCEL_ENV: "production" }],
        [{ NODE_ENV: "development", VERCEL_ENV: "preview" }],
    ])("fails closed in a deployed env without a salt: %o", (env) => {
        expect(() => resolveDailySalt(env)).toThrow(GachaConfigError);
    });

    it.each([[{ NODE_ENV: "development" }], [{ NODE_ENV: "test" }], [{ NODE_ENV: "test", VERCEL_ENV: "development" }], [{}]])(
        "falls back to the dev salt outside production: %o",
        (env) => expect(resolveDailySalt(env)).toBe(DEV_DAILY_SALT),
    );

    it("the error names the setting, never a value", () => {
        try {
            resolveDailySalt({ NODE_ENV: "production", DAILY_SALT: " " });
        } catch (e) {
            expect((e as Error).message).toBe("DAILY_SALT is not set");
        }
    });

    it("isDeployedEnv", () => {
        expect(isDeployedEnv({ NODE_ENV: "production" })).toBe(true);
        expect(isDeployedEnv({ VERCEL_ENV: "preview" })).toBe(true);
        expect(isDeployedEnv({ NODE_ENV: "development", VERCEL_ENV: "development" })).toBe(false);
    });
});
