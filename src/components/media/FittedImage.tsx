/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";
import { proxied } from "@/lib/img-proxy";

/**
 * A picture that fills its slot without ever being cropped.
 *
 * The slot keeps whatever size and aspect ratio its parent already gives it -
 * this only decides how the picture sits inside it. `object-cover` used to
 * guarantee a full tile by throwing away whatever did not fit, which is fine
 * for a 2:3 cover in a 2:3 slot and ruinous for everything else: an AniList
 * banner is 1900x400, so a 2:3 cell showed about 14% of it, and a portrait
 * cover in a square cell lost a quarter of its height off the top and bottom.
 *
 * So the picture is `contain` - nothing is ever cut - and the letterbox left
 * over is filled with a blurred, enlarged copy of the SAME image, so the tile
 * still reads as a full, designed tile rather than art floating on a grey
 * rectangle. Same src means the same download: the browser paints the backdrop
 * from cache. (The pattern is lifted from the community card,
 * components/community/GridCard.tsx, which has always done this.)
 *
 * The parent must be positioned and `overflow-hidden`; both layers are
 * absolutely positioned to fill it. The visible image comes FIRST in the DOM
 * and is lifted with z-index, so `querySelector("img")` still finds the real
 * picture and its alt text.
 */
export function FittedImage({
    src,
    alt,
    title,
    width = 256,
    className,
    backdrop = true,
    loading,
    decoding,
    fetchPriority,
    draggable,
    onError,
}: {
    src: string;
    alt: string;
    title?: string;
    /** Width asked of /api/img. The backdrop reuses it, so it costs no extra request. */
    width?: number;
    /** Extra classes for the visible image (transforms, transitions). */
    className?: string;
    /** Off for tiles too small for a blur to read, where a flat backing looks cleaner. */
    backdrop?: boolean;
    loading?: "lazy" | "eager";
    decoding?: "async" | "sync" | "auto";
    fetchPriority?: "high" | "low" | "auto";
    draggable?: boolean;
    onError?: React.ReactEventHandler<HTMLImageElement>;
}) {
    return (
        <>
            <img
                src={proxied(src, width)}
                alt={alt}
                title={title}
                loading={loading}
                decoding={decoding}
                fetchPriority={fetchPriority}
                referrerPolicy="no-referrer"
                draggable={draggable}
                onError={onError}
                className={cn("absolute inset-0 z-10 w-full h-full object-contain", className)}
            />
            {backdrop && (
                <img
                    src={proxied(src, width)}
                    alt=""
                    aria-hidden
                    loading={loading}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="absolute inset-0 z-0 w-full h-full object-cover scale-110 blur-xl opacity-45 select-none pointer-events-none"
                />
            )}
        </>
    );
}
