"use client";

import { pointerWithin, type CollisionDetection, type UniqueIdentifier } from "@dnd-kit/core";
import { useLayoutEffect, useState, type RefObject } from "react";
import { Trash2 } from "lucide-react";
import { TrashZone } from "@/components/dnd/TrashZone";

/**
 * Story100 drag-to-delete: two narrow vertical strips on the left and right edges of the CANVAS
 * (the story <main>, between the sidebars), rendered only while dragging.
 * Mobile 32 px (keeps the board visible, still a finger-width target), 56 px on sm, 80 px on lg.
 */
export const TRASH_LEFT_ID = "trash-left";
export const TRASH_RIGHT_ID = "trash-right";
export const TRASH_IDS: readonly UniqueIdentifier[] = [TRASH_LEFT_ID, TRASH_RIGHT_ID];
export const isTrashId = (id: UniqueIdentifier | null | undefined) => id != null && TRASH_IDS.includes(id);

/**
 * Trash strips are hit-tested with pointerWithin (the pointer/finger must be
 * inside a strip); board cells keep whatever detection the grid already used.
 */
export function withTrashFirst(fallback: CollisionDetection): CollisionDetection {
    return (args) => {
        const trash = args.droppableContainers.filter((c) => isTrashId(c.id));
        if (trash.length) {
            const hits = pointerWithin({ ...args, droppableContainers: trash });
            if (hits.length) return hits;
        }
        return fallback({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isTrashId(c.id)) });
    };
}

/** Strip widths per breakpoint (px): base / sm / lg. */
export const STRIP_WIDTH_CLASS = "w-8 sm:w-14 lg:w-20";
/**
 * Board side margin so cells clear the strips, measured from the CANVAS edge (the strips are
 * anchored to the canvas): canvas padding (12 / 24 / 24) + this margin (20 / 32 / 56) + frame
 * (7 / 9) = 39 / 65 / 89 px >= strip 32 / 56 / 80 px, whatever the board size.
 */
export const BOARD_GUTTER_CLASS = "mx-5 sm:mx-8 lg:mx-14";
const STRIP = `fixed z-[55] ${STRIP_WIDTH_CLASS}`;
const ZONE = "w-full h-full flex items-center border-dashed border-red-500 text-red-400 transition-all";

export interface StripBounds { left: number; right: number; top: number; bottom: number }
/** Canvas rect clamped to the viewport, as CSS insets for two fixed strips. */
export function canvasInsets(r: Pick<DOMRect, "left" | "right" | "top" | "bottom">, vw: number, vh: number): StripBounds {
    return { left: Math.max(0, r.left), right: Math.max(0, vw - r.right), top: Math.max(0, r.top), bottom: Math.max(0, vh - r.bottom) };
}

/**
 * Strips are `fixed` (so they never scroll away during a long drag) but sized from the
 * canvas's getBoundingClientRect() - taken at drag start and refreshed on scroll/resize -
 * so they sit at the canvas edges and never cover a sidebar. Without a canvas: viewport edges.
 */
function useCanvasInsets(active: boolean, canvas?: RefObject<HTMLElement | null>): StripBounds | null {
    const [b, setB] = useState<StripBounds | null>(null);
    useLayoutEffect(() => {
        if (!active || !canvas) return;
        const update = () => { const el = canvas.current; if (el) setB(canvasInsets(el.getBoundingClientRect(), window.innerWidth, window.innerHeight)); };
        update();
        window.addEventListener("scroll", update, true); // capture: the canvas itself may be the scroller
        window.addEventListener("resize", update);
        return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
    }, [active, canvas]);
    return active && canvas ? b : null;
}

export function EdgeTrashZones({ active, canvas }: { active: boolean; canvas?: RefObject<HTMLElement | null> }) {
    const b = useCanvasInsets(active, canvas);
    if (!active) return null;
    const v = b ? { top: b.top, bottom: b.bottom } : { top: 0, bottom: 0 };
    return (
        <>
            <div data-testid="trash-strip-left" className={STRIP} style={{ ...v, left: b ? b.left : 0 }}>
                <TrashZone id={TRASH_LEFT_ID} className={`${ZONE} justify-start pl-1 lg:pl-4 bg-gradient-to-r from-red-900/80 to-transparent border-r-2`}>
                    <span data-testid="trash-edge-left" aria-label="Drop here to remove" className="pointer-events-none"><Trash2 className="w-6 h-6 lg:w-8 lg:h-8 animate-pulse" /></span>
                </TrashZone>
            </div>
            <div data-testid="trash-strip-right" className={STRIP} style={{ ...v, right: b ? b.right : 0 }}>
                <TrashZone id={TRASH_RIGHT_ID} className={`${ZONE} justify-end pr-1 lg:pr-4 bg-gradient-to-l from-red-900/80 to-transparent border-l-2`}>
                    <span data-testid="trash-edge-right" aria-label="Drop here to remove" className="pointer-events-none"><Trash2 className="w-6 h-6 lg:w-8 lg:h-8 animate-pulse" /></span>
                </TrashZone>
            </div>
        </>
    );
}
