/** Next.js startup hook: warn once, loudly, if GEMINI_API_KEY, CRON_SECRET or BACKUP_SECRET is missing. */
export async function register() {
    if (process.env.NEXT_RUNTIME === "edge") return;
    const { warnIfNoGeminiKey } = await import("@/server/gemini-key-warning");
    warnIfNoGeminiKey();
    const { warnIfMissingSecrets } = await import("@/server/secret-warning");
    warnIfMissingSecrets();
}
