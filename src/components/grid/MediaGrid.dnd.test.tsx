import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaGrid, neighbourIndex, type MediaGridProps } from "@/components/grid/MediaGrid";

const toCell = (x: { id: number; t: string }) => ({ key: String(x.id), image: "https://s4.anilist.co/a.jpg", label: x.t });
const W = 100, H = 150, COLS = 3;
/** Slot i laid out on a 3-column grid; the trash zone sits below at y=1000. */
function rectFor(el: Element): DOMRect {
    const slot = el.getAttribute("data-slot");
    let x = 0, y = 0, w = 0, h = 0;
    if (slot !== null) {
        const i = Number(slot);
        x = (i % COLS) * W; y = Math.floor(i / COLS) * H; w = W; h = H;
    } else if (el.querySelector?.(':scope > [data-testid="trash-edge-left"]')) {
        x = -40; y = 0; w = 32; h = 2000; // left screen-edge strip
    } else if (el.querySelector?.(':scope > [data-testid="trash-edge-right"]')) {
        x = 400; y = 0; w = 32; h = 2000; // right screen-edge strip
    }
    return { x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) } as DOMRect;
}
let spy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) { return rectFor(this); });
});
afterEach(() => {
    spy.mockRestore();
    cleanup();
    vi.useRealTimers();
});
const items = [{ id: 1, t: "A" }, { id: 2, t: "B" }, null, { id: 4, t: "D" }];
const slot = (i: number) => document.querySelector(`[data-slot="${i}"]`) as HTMLElement;
const centre = (i: number) => ({ clientX: (i % COLS) * W + W / 2, clientY: Math.floor(i / COLS) * H + H / 2 });

function grid(extra: Partial<MediaGridProps<{ id: number; t: string }>> = {}) {
    const onMove = vi.fn(), onRemove = vi.fn(), onSelect = vi.fn();
    render(<MediaGrid items={items} columns={COLS} toCell={toCell} editable onMove={onMove} onRemove={onRemove} onSelect={onSelect} trashZone {...extra} />);
    return { onMove, onRemove, onSelect };
}

describe("MediaGrid dnd-kit reorder (parity item 1)", () => {
    it("mouse drag (10 px activation, like waifu) swaps slots", async () => {
        const { onMove } = grid();
        fireEvent.mouseDown(slot(0), { ...centre(0), button: 0 });
        await act(async () => {
            fireEvent.mouseMove(document, { clientX: centre(0).clientX + 20, clientY: centre(0).clientY });
            fireEvent.mouseMove(document, centre(1));
        });
        await act(async () => { fireEvent.mouseUp(document, centre(1)); });
        expect(onMove).toHaveBeenCalledWith(0, 1);
    });

    it("touch: hold 150 ms then drag swaps slots (TouchSensor)", async () => {
        const { onMove } = grid();
        const t = (i: number, dx = 0) => ({ touches: [{ clientX: centre(i).clientX + dx, clientY: centre(i).clientY }], changedTouches: [{ clientX: centre(i).clientX + dx, clientY: centre(i).clientY }] });
        fireEvent.touchStart(slot(0), t(0));
        await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
        await act(async () => {
            fireEvent.touchMove(slot(0), t(0, 5));
            fireEvent.touchMove(slot(0), t(3));
        });
        await act(async () => { fireEvent.touchEnd(slot(0), t(3)); });
        expect(onMove).toHaveBeenCalledWith(0, 3);
    });

    it("a quick touch move (before the hold) does not start a drag - page scroll stays possible", async () => {
        const { onMove } = grid();
        const t = (y: number) => ({ touches: [{ clientX: 50, clientY: y }] });
        fireEvent.touchStart(slot(0), t(75));
        await act(async () => { fireEvent.touchMove(slot(0), t(140)); });
        await act(async () => { fireEvent.touchEnd(slot(0), t(140)); });
        expect(onMove).not.toHaveBeenCalled();
    });

    const dragTo = async (from: number, x: number, y: number) => {
        fireEvent.mouseDown(slot(from), { ...centre(from), button: 0 });
        await act(async () => { fireEvent.mouseMove(document, { clientX: centre(from).clientX + 20, clientY: centre(from).clientY }); });
        await act(async () => { fireEvent.mouseMove(document, { clientX: x + 3, clientY: y }); });
        await act(async () => { fireEvent.mouseMove(document, { clientX: x, clientY: y }); });
        await act(async () => { fireEvent.mouseUp(document, { clientX: x, clientY: y }); });
    };

    it("story edge strips: both render only while dragging", async () => {
        grid();
        expect(screen.queryByTestId("trash-edge-left")).toBeNull();
        expect(screen.queryByTestId("trash-edge-right")).toBeNull();
        fireEvent.mouseDown(slot(1), { ...centre(1), button: 0 });
        await act(async () => { fireEvent.mouseMove(document, { clientX: 150, clientY: 120 }); });
        expect(screen.getByTestId("trash-edge-left")).toBeTruthy();
        expect(screen.getByTestId("trash-edge-right")).toBeTruthy();
        await act(async () => { fireEvent.mouseUp(document, { clientX: 150, clientY: 120 }); });
        expect(screen.queryByTestId("trash-edge-left")).toBeNull();
    });

    it("dropping with the pointer inside the LEFT strip removes the title (pointerWithin)", async () => {
        const { onMove, onRemove } = grid();
        await dragTo(1, -25, 300);
        expect(onRemove).toHaveBeenCalledWith(1);
        expect(onMove).not.toHaveBeenCalled();
    });

    it("dropping with the pointer inside the RIGHT strip removes the title", async () => {
        const { onMove, onRemove } = grid();
        await dragTo(3, 415, 75);
        expect(onRemove).toHaveBeenCalledWith(3);
        expect(onMove).not.toHaveBeenCalled();
    });

    it("pointer just outside a strip does not delete; cells keep their detection", async () => {
        const { onMove, onRemove } = grid();
        await dragTo(0, centre(1).clientX, centre(1).clientY);
        expect(onRemove).not.toHaveBeenCalled();
        expect(onMove).toHaveBeenCalledWith(0, 1);
    });

    it("keyboard: Alt+Arrow swaps with the neighbour; Enter still opens; Delete still removes; Space selects an empty slot", () => {
        const { onMove, onRemove, onSelect } = grid();
        fireEvent.keyDown(slot(0), { key: "ArrowRight", altKey: true });
        expect(onMove).toHaveBeenCalledWith(0, 1);
        fireEvent.keyDown(slot(0), { key: "ArrowDown", altKey: true });
        expect(onMove).toHaveBeenLastCalledWith(0, 3);
        fireEvent.keyDown(slot(0), { key: "ArrowLeft", altKey: true }); // edge: nothing
        expect(onMove).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(slot(1), { key: "Enter" });
        expect(onSelect).toHaveBeenCalledWith(1);
        fireEvent.keyDown(slot(2), { key: " " });
        expect(onSelect).toHaveBeenCalledWith(2);
        fireEvent.keyDown(slot(3), { key: "Delete" });
        expect(onRemove).toHaveBeenCalledWith(3);
    });

    it("keyboard sensor: Space picks up, ArrowRight moves one cell, Space drops", async () => {
        const { onMove } = grid();
        slot(0).focus();
        const tick = () => new Promise((r) => setTimeout(r, 10));
        await act(async () => { fireEvent.keyDown(slot(0), { key: " ", code: "Space" }); await tick(); });
        const key = (code: string, key: string) => document.dispatchEvent(new window.KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true }));
        await act(async () => { key("ArrowRight", "ArrowRight"); await tick(); });
        await act(async () => { key("Space", " "); await tick(); });
        expect(onMove).toHaveBeenCalledWith(0, 1);
    });

    it("read-only grids (view pages) have no dnd wiring", () => {
        render(<MediaGrid items={items} columns={COLS} toCell={toCell} />);
        expect(screen.queryByTestId("trash-edge-left")).toBeNull();
        expect(slot(0).getAttribute("aria-roledescription")).toBeNull();
    });

    it("neighbourIndex respects edges", () => {
        expect(neighbourIndex(2, "ArrowRight", 3, 9)).toBeNull();
        expect(neighbourIndex(3, "ArrowLeft", 3, 9)).toBeNull();
        expect(neighbourIndex(0, "ArrowUp", 3, 9)).toBeNull();
        expect(neighbourIndex(7, "ArrowDown", 3, 9)).toBeNull();
        expect(neighbourIndex(4, "ArrowUp", 3, 9)).toBe(1);
    });

    it("waifu look: same lifted DragPreview (rotate/scale/opacity) and same drop highlight while dragging", async () => {
        grid();
        fireEvent.mouseDown(slot(0), { ...centre(0), button: 0 });
        await act(async () => {
            fireEvent.mouseMove(document, { clientX: centre(0).clientX + 20, clientY: centre(0).clientY });
            fireEvent.mouseMove(document, centre(1));
        });
        const preview = screen.getByTestId("drag-preview");
        for (const c of ["border-purple-500", "shadow-2xl", "opacity-70", "scale-110", "rotate-3", "cursor-grabbing"]) expect(preview.className).toContain(c);
        expect(preview.querySelector("img")!.getAttribute("src")).toMatch(/^\/api\/img\?u=/);
        expect(slot(0).className).toContain("opacity-50");
        expect(slot(1).className).toContain("bg-purple-500/20");
        await act(async () => { fireEvent.mouseUp(document, centre(1)); });
    });
});
