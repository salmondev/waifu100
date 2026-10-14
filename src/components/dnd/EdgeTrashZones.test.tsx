import { describe, expect, it } from "vitest";
import { BOARD_GUTTER_CLASS, STRIP_WIDTH_CLASS } from "./EdgeTrashZones";
import { readFileSync } from "fs";
import { join } from "path";

const PX: Record<string, number> = { "5": 20, "8": 32, "14": 56, "20": 80, "0": 0 };
const tw = (cls: string, prefix: string, bp: "" | "sm:" | "lg:" | "xl:") => {
    const m = cls.split(" ").find((c) => c.startsWith(`${bp}${prefix}-`));
    return m === undefined ? undefined : PX[m.slice(bp.length + prefix.length + 1)];
};

describe("story edge strips never overlap the board's outer columns", () => {
    it("board left edge >= strip width at every breakpoint (main padding + gutter + frame)", () => {
        const main = { "": 12, "sm:": 24, "lg:": 24 }, frame = { "": 7, "sm:": 9, "lg:": 9 };
        for (const bp of ["", "sm:", "lg:"] as const) {
            const strip = tw(STRIP_WIDTH_CLASS, "w", bp)!;
            const gutter = tw(BOARD_GUTTER_CLASS, "mx", bp)!;
            expect(main[bp] + gutter + frame[bp]).toBeGreaterThanOrEqual(strip);
        }
        expect(BOARD_GUTTER_CLASS).not.toContain("xl:mx-0");
        expect(STRIP_WIDTH_CLASS).toBe("w-8 sm:w-14 lg:w-20"); // 32 px on phones: still a finger-width target
    });
    it("the story board frame uses the gutter and the main padding the maths assumes", () => {
        const src = readFileSync(join(process.cwd(), "src/components/story/StoryBuilder.tsx"), "utf8");
        expect(src).toContain('data-testid="board-frame" className={cn("p-1.5 sm:p-2 rounded-lg bg-zinc-900/50 border border-zinc-800", BOARD_GUTTER_CLASS)}');
        expect(src).toContain('"mx-auto p-3 sm:p-6 space-y-4"');
    });
});

import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach } from "vitest";
import { EdgeTrashZones, canvasInsets } from "./EdgeTrashZones";

describe("strips are anchored to the canvas, not the viewport", () => {
    afterEach(cleanup);
    it("canvasInsets clamps the canvas rect to the viewport", () => {
        expect(canvasInsets({ left: 320, right: 1440, top: 0, bottom: 900 }, 1440, 900)).toEqual({ left: 320, right: 0, top: 0, bottom: 0 });
        // mobile: canvas starts below the stacked sidebar, and runs past the fold
        expect(canvasInsets({ left: 0, right: 390, top: 300, bottom: 2400 }, 390, 844)).toEqual({ left: 0, right: 0, top: 300, bottom: 0 });
        expect(canvasInsets({ left: 0, right: 390, top: -1500, bottom: 600 }, 390, 844)).toEqual({ left: 0, right: 0, top: 0, bottom: 244 });
    });
    it("fixed strips take the canvas edges at drag start and follow scroll", async () => {
        const canvas = createRef<HTMLDivElement>();
        let rect = { left: 320, right: 1240, top: 0, bottom: 900 };
        const Host = ({ on }: { on: boolean }) => <div ref={canvas} data-testid="c"><EdgeTrashZones active={on} canvas={canvas} /></div>;
        const orig = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            return (this.getAttribute("data-testid") === "c" ? { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top, x: rect.left, y: rect.top } : orig.call(this)) as DOMRect;
        };
        try {
            Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
            Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
            const { rerender } = render(<Host on={false} />);
            rerender(<Host on />); // drag starts after the canvas is mounted, as in the app
            const L = screen.getByTestId("trash-strip-left"), R = screen.getByTestId("trash-strip-right");
            expect(L.className).toContain("fixed");
            expect(L.style.left).toBe("320px");
            expect(R.style.right).toBe("200px");
            rect = { left: 320, right: 1240, top: 150, bottom: 900 };
            await act(async () => { window.dispatchEvent(new Event("scroll")); });
            expect(L.style.top).toBe("150px");
        } finally {
            Element.prototype.getBoundingClientRect = orig;
        }
    });
});
