import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);
const props = () => ({ isOpen: true, onClose: vi.fn(), onConfirm: vi.fn(), title: "T", message: "M" });

describe("ConfirmModal: waifu default unchanged, story opt-in", () => {
    it("default (waifu, my-grids): no dialog role/aria, Escape does nothing", () => {
        const p = props();
        const { container } = render(<ConfirmModal {...p} />);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect((container.firstChild as HTMLElement).getAttribute("aria-modal")).toBeNull();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(p.onClose).not.toHaveBeenCalled();
    });
    it("accessible (story): dialog role, labelled, Escape closes", () => {
        const p = props();
        render(<ConfirmModal {...p} accessible />);
        expect(screen.getByRole("dialog", { name: "T" })).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(p.onClose).toHaveBeenCalled();
    });
});
