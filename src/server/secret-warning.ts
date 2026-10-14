/**
 * Loud, once-per-process warning when CRON_SECRET or BACKUP_SECRET is missing
 * (T-0012). Names only, never values. Same style as gemini-key-warning.
 * - No CRON_SECRET: /api/cron answers 401 to Vercel Cron on every run (no
 *   heartbeat, no snapshot) - only an x-admin-token call can run it.
 * - No BACKUP_SECRET: snapshots are encrypted with ADMIN_TOKEN instead, or
 *   skipped when that is missing too.
 */
import { hasSecret } from "@/lib/secret-auth";

let warned = false;

export function missingSecrets(): string[] {
    return (["CRON_SECRET", "BACKUP_SECRET"] as const).filter((n) => !hasSecret(n));
}

export function warnIfMissingSecrets(log: (msg: string) => void = console.error): boolean {
    const missing = missingSecrets();
    if (warned || missing.length === 0) return false;
    warned = true;
    const prod = process.env.NODE_ENV === "production";
    const effects = missing.map((n) =>
        n === "CRON_SECRET"
            ? "CRON_SECRET missing: Vercel Cron gets 401 on EVERY run (no heartbeat, no snapshot)."
            : `BACKUP_SECRET missing: snapshots ${hasSecret("ADMIN_TOKEN") ? "fall back to ADMIN_TOKEN encryption" : "are SKIPPED (no ADMIN_TOKEN either)"}.`
    );
    const bar = "!".repeat(78);
    const lines = prod
        ? [bar, `!!! [waifu100] FATAL CONFIG: ${missing.join(" AND ")} MISSING IN PRODUCTION`, ...effects.map((e) => `!!! ${e}`), "!!! Set them and redeploy NOW.", bar]
        : [`[waifu100] WARNING: ${missing.join(" and ")} not set.`, ...effects.map((e) => `[waifu100] ${e}`)];
    log(lines.join("\n"));
    return true;
}

/** Test hook. */
export function resetSecretWarning() {
    warned = false;
}
