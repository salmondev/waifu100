/**
 * Loud, once-per-process warning when GEMINI_API_KEY is missing.
 * Without it, image moderation cannot run: every image is served UNCHECKED
 * (X-Moderation: unchecked; reason "no-key" visible only with x-admin-token), and AI verdicts and
 * translation are off. Called at startup (src/instrumentation.ts) and on
 * first use (moderation classifier), whichever comes first.
 */
let warned = false;

export function warnIfNoGeminiKey(log: (msg: string) => void = console.error): boolean {
    if (warned || process.env.GEMINI_API_KEY) return false;
    warned = true;
    const prod = process.env.NODE_ENV === "production";
    const bar = "!".repeat(78);
    const lines = prod
        ? [
              bar,
              "!!! [waifu100] FATAL CONFIG: GEMINI_API_KEY IS MISSING IN PRODUCTION",
              "!!! IMAGE MODERATION IS OFF: every user image is served UNCHECKED",
              "!!! (X-Moderation: unchecked; reason no-key visible only with x-admin-token).",
              "!!! AI verdicts and translation are disabled. Set GEMINI_API_KEY and redeploy NOW.",
              bar,
          ]
        : [
              "[waifu100] WARNING: GEMINI_API_KEY is not set. Image moderation is off;",
              "[waifu100] images are served unchecked (X-Moderation: unchecked; reason no-key only with x-admin-token). AI verdicts are disabled.",
          ];
    log(lines.join("\n"));
    return true;
}

/** Test hook. */
export function resetGeminiKeyWarning() {
    warned = false;
}
