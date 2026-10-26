/**
 * Gacha Guess server configuration. The daily salt decides every day's answer,
 * so a deployed build must never fall back to the public dev salt: without
 * DAILY_SALT it fails closed (the routes answer 503) instead.
 */
import { DEV_DAILY_SALT } from "./rules";

export class GachaConfigError extends Error {
    constructor(readonly setting: string) {
        super(`${setting} is not set`);
        this.name = "GachaConfigError";
    }
}

type Env = Readonly<Record<string, string | undefined>>;

/** A production build or a Vercel production/preview deployment. */
export function isDeployedEnv(env: Env): boolean {
    return env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/**
 * DAILY_SALT when it is set (non-blank). Otherwise the dev salt, but only
 * outside production; in production this throws GachaConfigError.
 */
export function resolveDailySalt(env: Env = process.env): string {
    const salt = env.DAILY_SALT;
    if (salt && salt.trim()) return salt;
    if (isDeployedEnv(env)) throw new GachaConfigError("DAILY_SALT");
    return DEV_DAILY_SALT;
}
