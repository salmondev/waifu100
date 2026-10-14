"use client";
/* eslint-disable @next/next/no-img-element */
import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { proxied } from "@/lib/img-proxy";

/**
 * Shared drag & drop look and feel for waifu100 (page.tsx) and story100
 * (MediaGrid): same activation, same lifted preview, same drop highlight.
 */
export const MOUSE_ACTIVATION = { distance: 10 } as const; // 10 px before a drag starts
export const TOUCH_ACTIVATION = { delay: 150, tolerance: 15 } as const; // press-and-hold on touch

/**
 * Mouse + Touch is exactly waifu's original pair (it never had a KeyboardSensor).
 * Story passes a keyboard getter to add a KeyboardSensor for Space/arrow moves;
 * without one no KeyboardSensor is registered at all.
 */
export function useGridSensors(keyboard?: KeyboardCoordinateGetter) {
    const mouse = useSensor(MouseSensor, { activationConstraint: MOUSE_ACTIVATION });
    const touch = useSensor(TouchSensor, { activationConstraint: TOUCH_ACTIVATION });
    // Hooks run unconditionally; the descriptor is simply left out when there is no getter.
    const kb = useSensor(KeyboardSensor, {
        coordinateGetter: keyboard,
        keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    });
    return useSensors(mouse, touch, keyboard ? kb : null);
}

/** Target cell under the dragged item. */
export const DROP_OVER_CLASS = "border-purple-500 bg-purple-500/20 scale-110";
/** The cell being dragged (left behind, dimmed). */
export const DRAGGING_CLASS = "opacity-50";

/** The lifted card that follows the finger/cursor (used inside a DragOverlay with snapCenterToCursor). */
export function DragPreview({ src, alt, aspect = "portrait" }: { src: string; alt: string; aspect?: "portrait" | "square" }) {
    return (
        <div data-testid="drag-preview" className={`${aspect === "square" ? "w-24 h-24" : "w-24 h-32"} rounded-lg overflow-hidden border-2 border-purple-500 shadow-2xl bg-zinc-900 pointer-events-none cursor-grabbing opacity-70 scale-110 rotate-3`}>
            <img src={proxied(src, 256)} alt={alt} referrerPolicy="no-referrer" className="w-full h-full object-cover" draggable={false} />
        </div>
    );
}
