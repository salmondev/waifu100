"use client";

import { useId, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
    DndContext,
    DragOverlay,
    pointerWithin,
    closestCenter,
    useDraggable,
    useDroppable,
    type CollisionDetection,
    type DragEndEvent,
    type DragStartEvent,
    type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { FittedImage } from "@/components/media/FittedImage";
import { Trash2, X } from "lucide-react";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { DragPreview, DRAGGING_CLASS, DROP_OVER_CLASS, useGridSensors } from "@/components/dnd/dnd-config";
import { EdgeTrashZones, isTrashId, withTrashFirst } from "@/components/dnd/EdgeTrashZones";
import { cn } from "@/lib/utils";

/**
 * A size-agnostic grid of image cells (T-0009 U6). Used by story100 for 3x3,
 * 10, 50 and 100 boards; generic over the item type so other modes can reuse
 * it. Editing is opt-in. Reordering (parity item 1) uses dnd-kit with the
 * waifu grid's shared config (components/dnd/dnd-config): MouseSensor (10 px),
 * TouchSensor (150 ms hold, 15 px tolerance), the same lifted DragPreview with
 * snapCenterToCursor and the same drop highlight - plus a KeyboardSensor (Space picks up,
 * arrows move to the next cell, Space drops, Esc cancels). Alt+Arrow also
 * swaps with the neighbour directly. Dropping on the trash zone removes.
 */
export interface MediaGridItem {
    key: string;
    image: string;
    label: string;
}

export interface MediaGridProps<T> {
    items: (T | null)[];
    columns: number;
    /** Required unless renderCell is given. */
    toCell?: (item: T) => MediaGridItem;
    /**
     * Full control of each slot (waifu: dnd-kit droppable/draggable cells).
     * MediaGrid then only owns the layout; slots render as direct children.
     */
    renderCell?: (item: T, index: number) => ReactNode;
    className?: string;
    dataAttribute?: `data-${string}`;
    onMouseLeave?: () => void;
    /** Cells portrait (2:3, covers) or square. */
    aspect?: "portrait" | "square";
    editable?: boolean;
    selected?: number | null;
    onSelect?: (index: number) => void;
    /** Read-only grids whose FILLED cells open something on click (story view card). Off by default. */
    clickable?: boolean;
    onMove?: (from: number, to: number) => void;
    onRemove?: (index: number) => void;
    renderEmpty?: (index: number) => ReactNode;
    showRank?: boolean;
    /** T-0010: cell title on the image (gradient), below it, or not at all. */
    titleStyle?: "overlay" | "below" | "hidden";
    /** Show a waifu-style drag-to-delete zone while dragging (needs onRemove). */
    trashZone?: boolean;
    /** Element the edge trash strips are anchored to (the canvas); defaults to the viewport. */
    trashCanvas?: RefObject<HTMLElement | null>;
}

const slotId = (i: number) => `slot-${i}`;
const slotIndex = (id: unknown) => (typeof id === "string" && id.startsWith("slot-") ? Number(id.slice(5)) : null);

/** Next cell in a direction for Alt+Arrow / keyboard drag; null at an edge. */
export function neighbourIndex(index: number, key: string, columns: number, length: number): number | null {
    const col = index % columns;
    const n = key === "ArrowLeft" ? (col > 0 ? index - 1 : -1) : key === "ArrowRight" ? (col < columns - 1 ? index + 1 : -1) : key === "ArrowUp" ? index - columns : key === "ArrowDown" ? index + columns : -1;
    return n >= 0 && n < length ? n : null;
}

/** Keyboard drag: an arrow jumps to the centre of the nearest droppable cell that way. */
const cellCoordinates: KeyboardCoordinateGetter = (event, { context: { active, over, collisionRect, droppableRects, droppableContainers } }) => {
    if (!collisionRect || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)) return undefined;
    event.preventDefault();
    // Origin = the cell currently hovered (or the start cell), so moves step cell by cell.
    const startIndex = (active?.data.current as { index?: number } | undefined)?.index;
    const origin = (over && !isTrashId(over.id) && droppableRects.get(over.id)) || (startIndex !== undefined ? droppableRects.get(slotId(startIndex)) : undefined) || collisionRect;
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    let best: { x: number; y: number; d: number } | null = null;
    for (const c of droppableContainers.getEnabled()) {
        if (isTrashId(c.id)) continue;
        const r = droppableRects.get(c.id);
        if (!r) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const dx = x - cx, dy = y - cy;
        const ok = event.code === "ArrowLeft" ? dx < -1 && Math.abs(dy) < r.height / 2 : event.code === "ArrowRight" ? dx > 1 && Math.abs(dy) < r.height / 2 : event.code === "ArrowUp" ? dy < -1 && Math.abs(dx) < r.width / 2 : dy > 1 && Math.abs(dx) < r.width / 2;
        if (!ok) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x, y, d };
    }
    if (!best) return undefined;
    return { x: best.x - collisionRect.width / 2, y: best.y - collisionRect.height / 2 };
};

/** Pointer first (precise for mouse/touch), centre fallback (keyboard). */
const cellCollision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length ? hits : closestCenter(args);
};
/** Edge trash strips by pointerWithin first, then the cell detection above. */
const collision = withTrashFirst(cellCollision);

/** One slot wired into dnd-kit: draggable when filled, always a drop target. */
function DndSlot({ index, filled, disabled, children }: { index: number; filled: boolean; disabled: boolean; children: (p: { ref: (el: HTMLElement | null) => void; props: HTMLAttributes<HTMLElement>; isOver: boolean; isDragging: boolean }) => ReactNode }) {
    const drag = useDraggable({ id: `drag-${index}`, data: { index }, disabled: disabled || !filled });
    const drop = useDroppable({ id: slotId(index), disabled });
    const ref = (el: HTMLElement | null) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
    };
    // role/tabIndex from dnd-kit are overridden by the slot's own (spread first).
    return <>{children({ ref, props: { ...drag.attributes, ...(drag.listeners as HTMLAttributes<HTMLElement>) }, isOver: drop.isOver && !drag.isDragging, isDragging: drag.isDragging })}</>;
}

/** Swap two slots; pure, exported for tests. */
export function moveSlot<T>(items: (T | null)[], from: number, to: number): (T | null)[] {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = items.slice();
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}

export function MediaGrid<T>({
    items,
    columns,
    toCell,
    aspect = "portrait",
    editable = false,
    selected = null,
    onSelect,
    clickable = false,
    onMove,
    onRemove,
    renderEmpty,
    showRank = true,
    titleStyle = "hidden",
    renderCell,
    className,
    dataAttribute,
    onMouseLeave,
    trashZone = false,
    trashCanvas,
}: MediaGridProps<T>) {
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    // Stable id: dnd-kit's aria-describedby ids otherwise differ between SSR and the client (hydration warning).
    const dndId = useId();
    const sensors = useGridSensors(cellCoordinates);
    const extra = dataAttribute ? { [dataAttribute]: "" } : {};

    if (renderCell) {
        return (
            <div className={className ?? "grid gap-1.5 w-full"} style={className ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-testid="media-grid" onMouseLeave={onMouseLeave} {...extra}>
                {items.map((item, index) => renderCell(item as T, index))}
            </div>
        );
    }
    if (!toCell) return null;
    const dndOn = editable && !!onMove;

    const onDragStart = (e: DragStartEvent) => setDragFrom((e.active.data.current as { index?: number } | undefined)?.index ?? null);
    const onDragEnd = (e: DragEndEvent) => {
        const from = (e.active.data.current as { index?: number } | undefined)?.index;
        setDragFrom(null);
        if (from === undefined || !e.over) return;
        if (isTrashId(e.over.id)) return onRemove?.(from);
        const to = slotIndex(e.over.id);
        if (to !== null && to !== from) onMove?.(from, to);
    };
    const dragged = dragFrom !== null && items[dragFrom] ? toCell(items[dragFrom] as T) : null;

    const grid = (
        <div
            className={className ?? "grid gap-1.5 w-full"}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            data-testid="media-grid"
            onMouseLeave={onMouseLeave}
            {...extra}
        >
            {items.map((item, index) => {
                const cell = item ? toCell(item) : null;
                const below = titleStyle === "below";
                const box = (
                    <>
                        {cell ? (
                            <>
                                {/* Whole cover, never cropped: an AniList banner (1900x400) and a
                                    2:3 cover both have to live in this one slot shape. */}
                                <FittedImage src={cell.image} alt={cell.label} title={cell.label} width={256} loading="lazy" decoding="async" draggable={false} />
                                {titleStyle === "overlay" && (
                                    <div className="absolute inset-x-0 bottom-0 z-20 pt-8 pb-1 px-1.5 bg-gradient-to-t from-black/95 via-black/60 to-transparent pointer-events-none">
                                        <p data-testid="cell-title" className="text-[10px] sm:text-[11px] font-semibold leading-tight text-white line-clamp-2 text-center drop-shadow">{cell.label}</p>
                                    </div>
                                )}
                                {editable && onRemove && (
                                    <button
                                        type="button"
                                        aria-label={`Remove ${cell.label}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemove(index);
                                        }}
                                        className="absolute top-1 right-1 z-20 p-1 rounded-full bg-black/70 text-zinc-200 opacity-100 sm:opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </>
                        ) : (
                            renderEmpty?.(index) ?? null
                        )}
                        {showRank && (
                            <span className={cn("absolute left-0 z-20 px-1 text-[10px] font-bold bg-black/70 text-zinc-300", titleStyle === "overlay" && cell ? "top-0 rounded-br" : "bottom-0 rounded-tr")}>
                                {index + 1}
                            </span>
                        )}
                    </>
                );
                const frame = (dnd?: { ref: (el: HTMLElement | null) => void; props: HTMLAttributes<HTMLElement>; isOver: boolean; isDragging: boolean }) => (
                    <div
                        key={cell ? `${cell.key}-${index}` : `empty-${index}`}
                        ref={dnd?.ref}
                        {...dnd?.props}
                        role={editable || (clickable && cell) ? "button" : undefined}
                        tabIndex={editable || (clickable && cell) ? 0 : undefined}
                        aria-label={cell ? `${index + 1}. ${cell.label}` : `Empty slot ${index + 1}`}
                        aria-disabled={undefined}
                        data-slot={index}
                        onClick={() => onSelect?.(index)}
                        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                            if (e.altKey && cell && onMove) {
                                const to = neighbourIndex(index, e.key, columns, items.length);
                                if (to !== null) {
                                    e.preventDefault();
                                    onMove(index, to);
                                    // keep focus on the moved title
                                    requestAnimationFrame(() => (document.querySelector(`[data-slot="${to}"]`) as HTMLElement | null)?.focus());
                                    return;
                                }
                            }
                            if (e.key === "Enter" || (e.key === " " && (!cell || !onMove))) {
                                e.preventDefault();
                                onSelect?.(index);
                                return;
                            }
                            if ((e.key === "Delete" || e.key === "Backspace") && cell) {
                                onRemove?.(index);
                                return;
                            }
                            (dnd?.props.onKeyDown as ((ev: KeyboardEvent<HTMLDivElement>) => void) | undefined)?.(e);
                        }}
                        // Not touch-none like waifu's 100-grid: story boards scroll on phones, and the
                        // 150 ms hold already separates a drag from a scroll.
                        style={{ touchAction: editable && cell ? "manipulation" : undefined }}
                        className={cn(
                            "group relative rounded-md select-none",
                            !below && "overflow-hidden bg-zinc-900 border border-zinc-800",
                            !below && (aspect === "portrait" ? "aspect-[2/3]" : "aspect-square"),
                            (editable || (clickable && cell)) && "cursor-pointer",
                            clickable && cell && !below && "hover:border-purple-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500",
                            editable && !below && "hover:border-purple-500/60",
                            selected === index && !below && "ring-2 ring-purple-500 border-purple-500",
                            "transition-all duration-200",
                            dnd?.isOver && DROP_OVER_CLASS,
                            dnd?.isDragging && DRAGGING_CLASS
                        )}
                    >
                        {below ? (
                            <>
                                <div className={cn("relative overflow-hidden rounded-md bg-zinc-900 border border-zinc-800", aspect === "portrait" ? "aspect-[2/3]" : "aspect-square", editable && "group-hover:border-purple-500/60", selected === index && "ring-2 ring-purple-500 border-purple-500")}>{box}</div>
                                <p data-testid="cell-title" className="mt-1 text-[10px] sm:text-[11px] leading-tight text-zinc-300 line-clamp-2 text-center min-h-[2.2em]">{cell?.label ?? ""}</p>
                            </>
                        ) : (
                            box
                        )}
                    </div>
                );
                if (!dndOn) return frame();
                return (
                    <DndSlot key={cell ? `${cell.key}-${index}` : `empty-${index}`} index={index} filled={!!cell} disabled={false}>
                        {(d) => frame(d)}
                    </DndSlot>
                );            })}
        </div>
    );
    if (!dndOn) return grid;
    return (
        <DndContext id={dndId} sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragFrom(null)}
            accessibility={{ screenReaderInstructions: { draggable: "To move a title, press Space, use the arrow keys, then Space to drop. Escape cancels. Alt+Arrow swaps with the neighbour." } }}>
            {grid}
            <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
                {dragged ? <DragPreview src={dragged.image} alt={dragged.label} aspect={aspect} /> : null}
            </DragOverlay>
            <EdgeTrashZones active={!!(trashZone && onRemove && dragFrom !== null)} canvas={trashCanvas} />
        </DndContext>
    );
}
