import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * What to actually put in an <img src> for a character.
 *
 * Most remote art goes through Next's optimizer, which is what keeps a page of
 * a hundred thumbnails from pulling a hundred full-size JPEGs. The exceptions
 * all break if optimized: data:/blob: URLs have no origin to fetch, GIFs come
 * back as a single frozen frame, and our own blob storage is already serving
 * the size we uploaded.
 */
export function optimizedImageSrc(url: string, width = 384): string {
    if (
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        isGifUrl(url) ||
        url.includes("vercel-storage.com")
    ) {
        return url;
    }
    return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=75`;
}

/** True when a URL points at a .gif file, query strings ignored. */
export function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".gif");
  } catch {
    return url.toLowerCase().split("?")[0].endsWith(".gif");
  }
}
