/**
 * SSRF-safe image fetch used by every server path that pulls a remote image.
 * https only; no userinfo; default port; hostname must not be localhost,
 * an internal name, or a private/loopback/link-local IP literal; redirects
 * followed by hand and re-validated each hop; timeout; byte cap; image/* only.
 * (DNS-rebinding to a private address is not prevented here - UNCERTAINTY,
 * acceptable on Vercel where functions have no private network to reach.)
 */

export const IMAGE_TIMEOUT_MS = 8000;
export const IMAGE_MAX_BYTES = 16 * 1024 * 1024; // largest real cell seen: 10.6 MB
export const MAX_REDIRECTS = 3;

export class ImageFetchError extends Error {
    constructor(readonly reason: string) {
        super(`image fetch refused: ${reason}`);
        this.name = "ImageFetchError";
    }
}

import { isPublicHttpsUrl } from "@/lib/url-safety";
export { isPublicHttpsUrl };

export interface SafeFetchOptions {
    fetch?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
    /** Extra allowlist on top of the public-URL check (e.g. story cover CDNs). */
    allow?: (url: string) => boolean;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
    if (!res.body) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) throw new ImageFetchError("too-big");
        return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new ImageFetchError("too-big");
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

export async function safeFetchImage(
    url: string,
    opts: SafeFetchOptions = {}
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
    const doFetch = opts.fetch ?? fetch;
    const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES;
    const signal = AbortSignal.timeout(opts.timeoutMs ?? IMAGE_TIMEOUT_MS);
    const ok = (u: string) => isPublicHttpsUrl(u) && (!opts.allow || opts.allow(u));

    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!ok(current)) throw new ImageFetchError(hop === 0 ? "host" : "redirect-host");
        let origin = "";
        try {
            origin = new URL(current).origin + "/";
        } catch {
            /* validated above */
        }
        const res = await doFetch(current, {
            redirect: "manual",
            signal,
            headers: {
                Accept: "image/avif,image/webp,image/*;q=0.8",
                "User-Agent": "Mozilla/5.0 (compatible; waifu100-img/1.0; +https://waifu100.vercel.app)",
                Referer: origin,
            },
        });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (!location) throw new ImageFetchError("redirect-empty");
            current = new URL(location, current).toString();
            continue;
        }
        if (!res.ok) throw new ImageFetchError(`http-${res.status}`);
        const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!contentType.startsWith("image/")) throw new ImageFetchError("not-image");
        if (Number(res.headers.get("content-length") || 0) > maxBytes) throw new ImageFetchError("too-big");
        return { bytes: await readCapped(res, maxBytes), contentType, finalUrl: current };
    }
    throw new ImageFetchError("too-many-redirects");
}
