import { createHash, timingSafeEqual } from "crypto";

/**
 * The one place secrets from the environment are read and compared (T-0012).
 * Fail closed: an unset, empty or whitespace-only secret never matches
 * anything, including an empty header.
 */
export type SecretName = "ADMIN_TOKEN" | "CRON_SECRET" | "BACKUP_SECRET";

/**
 * Two accessors on purpose (T-0012 review M1):
 * - authSecret: TRIMMED, for comparisons only. `vercel env add` via a pipe
 *   often stores a trailing newline; the incoming Bearer/header is trimmed too,
 *   so both sides must be.
 * - keySecret: RAW (untrimmed), for the snapshot encryption key only - old
 *   snapshots were encrypted with the raw value and must still decrypt.
 * Both: unset / empty / whitespace-only => null (fail closed).
 */
export function authSecret(name: SecretName): string | null {
    const v = process.env[name];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** RAW env value for key derivation. Never use it for comparisons. */
export function keySecret(name: "BACKUP_SECRET" | "ADMIN_TOKEN"): string | null {
    const v = process.env[name];
    return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Snapshot encryption key: BACKUP_SECRET, falling back to ADMIN_TOKEN - raw values. */
export function snapshotKeySecret(): string | null {
    return keySecret("BACKUP_SECRET") ?? keySecret("ADMIN_TOKEN");
}

/** Is the secret set (non-blank)? For presence checks / warnings only. */
export function hasSecret(name: SecretName): boolean {
    return authSecret(name) !== null;
}

/**
 * Constant-time equality for strings of any length: both sides are hashed to
 * fixed 32-byte digests first, so neither timing nor a length check leaks the
 * secret's length.
 */
export function safeEqual(provided: string, expected: string): boolean {
    const a = createHash("sha256").update(provided, "utf8").digest();
    const b = createHash("sha256").update(expected, "utf8").digest();
    return timingSafeEqual(a, b);
}

/** True only if the secret is configured AND the provided value is non-blank and equal. */
export function matchesSecret(provided: string | null | undefined, name: SecretName): boolean {
    const expected = authSecret(name);
    if (!expected) return false;
    if (typeof provided !== "string" || provided.trim() === "") return false;
    return safeEqual(provided.trim(), expected);
}

/** `Authorization: Bearer <token>` -> token; empty / missing / other schemes -> null. */
export function bearerToken(req: Request): string | null {
    const h = req.headers.get("authorization");
    const m = h ? /^Bearer[ \t]+(.+)$/.exec(h) : null;
    const t = m ? m[1].trim() : "";
    return t === "" ? null : t;
}
