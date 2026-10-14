/** Pure URL checks shared by client and server (no Node APIs). */

function isPrivateIpv4(host: string): boolean {
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
        a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
}

/** Public https URL check (no allowlist). */
export function isPublicHttpsUrl(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2048) return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return false;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host.startsWith("[")) return false; // no bare names, no IPv6 literals
    if (host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
    if (isPrivateIpv4(host)) return false;
    if (/^\d+$/.test(host.replace(/\./g, "")) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // odd numeric forms
    return true;
}

