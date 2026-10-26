import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderHook } from "@testing-library/react";
import { KeyboardSensor, MouseSensor, TouchSensor } from "@dnd-kit/core";
import { DRAGGING_CLASS, DROP_OVER_CLASS, MOUSE_ACTIVATION, TOUCH_ACTIVATION, useGridSensors } from "@/components/dnd/dnd-config";

const src = (p: string) => readFileSync(join(process.cwd(), "src", p), "utf8");

describe("drag config: story shares waifu's values, waifu unchanged", () => {
    it("activation matches waifu's original values", () => {
        expect(MOUSE_ACTIVATION).toEqual({ distance: 10 });
        expect(TOUCH_ACTIVATION).toEqual({ delay: 150, tolerance: 15 });
    });
    it("waifu100 is pinned to its pre-parity/prod values (page.tsx, GridCell, DragOverlayWrapper untouched)", () => {
        const page = src("app/page.tsx"), cell = src("components/grid/GridCell.tsx"), overlay = src("components/dnd/DragOverlayWrapper.tsx");
        // sensors: Mouse 10 px + Touch 150 ms / 15 px, no KeyboardSensor
        expect(page).toContain("useSensor(MouseSensor, {\n      activationConstraint: { distance: 10 }");
        expect(page).toContain("useSensor(TouchSensor, {\n      activationConstraint: { delay: 150, tolerance: 15 }");
        expect(page).not.toMatch(/KeyboardSensor|useGridSensors|EdgeTrashZones/);
        expect(page).toContain("collisionDetection={pointerWithin}");
        // trash: original desktop-only left/right strips inside <main>
        expect(page).toContain('<TrashZone id="trash-left" className="hidden lg:flex absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-red-900/80 to-transparent border-r-2 border-dashed border-red-500 items-center justify-start pl-4 z-30">');
        expect(page).toContain('<TrashZone id="trash-right" className="hidden lg:flex absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-red-900/80 to-transparent border-l-2 border-dashed border-red-500 items-center justify-end pr-4 z-30">');
        // cells and overlay
        expect(cell).toContain('isOver && "border-purple-500 bg-purple-500/20 scale-110"');
        expect(cell).toContain('isDragging && "opacity-50"');
        expect(cell).toContain('className="w-full h-full touch-none"');
        // "relative" is the one addition: FittedImage's two layers are absolutely
        // positioned, so the card has to be their containing block. The look is pinned as before.
        expect(overlay).toContain('className="relative w-24 h-32 rounded-lg overflow-hidden border-2 border-purple-500 shadow-2xl bg-zinc-900 pointer-events-none cursor-grabbing opacity-70 scale-110 rotate-3"');
        // story's shared constants are copies of the same strings
        expect(cell).toContain(DROP_OVER_CLASS);
        expect(cell).toContain(DRAGGING_CLASS);
    });
    it("waifu (no getter) gets exactly its original Mouse + Touch pair, no KeyboardSensor", () => {
        const { result } = renderHook(() => useGridSensors());
        expect(result.current.map((d) => d.sensor)).toEqual([MouseSensor, TouchSensor]);
        expect(result.current[0].options).toEqual({ activationConstraint: { distance: 10 } });
        expect(result.current[1].options).toEqual({ activationConstraint: { delay: 150, tolerance: 15 } });
    });
    it("story (with a getter) adds a KeyboardSensor that starts on Space", () => {
        const getter = () => undefined;
        const { result } = renderHook(() => useGridSensors(getter));
        expect(result.current.map((d) => d.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
        expect(result.current[2].options).toMatchObject({ coordinateGetter: getter, keyboardCodes: { start: ["Space"] } });
    });
});
