import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildStoryPayload, decodeShare } from "@/lib/share-schema";
import { MediaGrid } from "@/components/grid/MediaGrid";
import { exportLayout, wrapTitle, EXPORT_CAPTION_H } from "@/lib/story/export";
import { parseDraft } from "@/lib/story/draft";

const cells = [{ i: 0, a: 1, t: "ANIME" as const, img: "https://s4.anilist.co/a.jpg", n: "Cowboy Bebop" }];

describe("title style (T-0010)", () => {
    it("is stored in the share and old shares read as overlay", () => {
        expect(decodeShare(JSON.stringify(buildStoryPayload({ title: "t", size: 9, cells, titleStyle: "below" })))!.titleStyle).toBe("below");
        expect(decodeShare(JSON.stringify(buildStoryPayload({ title: "t", size: 9, cells, titleStyle: "bogus" })))!.titleStyle).toBe("overlay");
        expect(decodeShare(JSON.stringify({ meta: { v: 2, kind: "story", size: 9 }, grid: cells }))!.titleStyle).toBe("overlay");
        expect(decodeShare(JSON.stringify([]))!.titleStyle).toBe("overlay");
    });
    it("draft keeps it, defaulting to overlay", () => {
        expect(parseDraft(JSON.stringify({ size: 9, titleStyle: "hidden" })).titleStyle).toBe("hidden");
        expect(parseDraft(JSON.stringify({ size: 9 })).titleStyle).toBe("overlay");
    });
    it.each(["overlay", "below", "hidden"] as const)("MediaGrid renders %s", (style) => {
        render(<MediaGrid items={[{ t: "Cowboy Bebop" }]} columns={1} titleStyle={style} toCell={(x) => ({ key: "k", image: "https://s4.anilist.co/a.jpg", label: x.t })} />);
        const t = screen.queryByTestId("cell-title");
        if (style === "hidden") expect(t).toBeNull();
        else expect(t?.textContent).toBe("Cowboy Bebop");
    });
    it("PNG layout adds a caption band only for 'below'", () => {
        expect(exportLayout(10, "below").height - exportLayout(10, "overlay").height).toBe(2 * EXPORT_CAPTION_H);
        expect(exportLayout(10, "hidden").height).toBe(exportLayout(10, "overlay").height);
    });
    it("wraps titles to two lines with an ellipsis", () => {
        const m = (s: string) => s.length * 10;
        expect(wrapTitle(m, "Short", 100)).toEqual(["Short"]);
        const lines = wrapTitle(m, "The Melancholy of Haruhi Suzumiya Season Two", 100);
        expect(lines).toHaveLength(2);
        expect(lines[1].endsWith("…")).toBe(true);
        expect(lines.every((l) => m(l) <= 100)).toBe(true);
    });
});
