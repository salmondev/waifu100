import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaGrid, moveSlot } from "@/components/grid/MediaGrid";

type It = { id: number; t: string };
const toCell = (i: It) => ({ key: String(i.id), image: `https://s4.anilist.co/${i.id}.jpg`, label: i.t });

describe("MediaGrid", () => {
    it("renders one cell per slot with the given columns", () => {
        render(<MediaGrid items={[{ id: 1, t: "A" }, null, null]} columns={3} toCell={toCell} />);
        expect(screen.getByTestId("media-grid").children).toHaveLength(3);
        expect(screen.getByAltText("A")).toBeTruthy();
        expect(screen.getByLabelText("Empty slot 2")).toBeTruthy();
    });

    it("selects and removes in edit mode", () => {
        const onSelect = vi.fn();
        const onRemove = vi.fn();
        render(<MediaGrid items={[{ id: 1, t: "A" }, null]} columns={2} toCell={toCell} editable onSelect={onSelect} onRemove={onRemove} />);
        fireEvent.click(screen.getByLabelText("Empty slot 2"));
        expect(onSelect).toHaveBeenCalledWith(1);
        fireEvent.click(screen.getByLabelText("Remove A"));
        expect(onRemove).toHaveBeenCalledWith(0);
    });

    it("moveSlot swaps and ignores bad indexes", () => {
        expect(moveSlot([1, null, 3], 0, 2)).toEqual([3, null, 1]);
        const same = [1, 2];
        expect(moveSlot(same, 0, 5)).toBe(same);
    });
});
