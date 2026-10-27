import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { markSvg, TIER_STARS, TierMark, type TierName } from "./pixel";

afterEach(cleanup);

describe("tier stars", () => {
    it("common has none, then rare, SR and SSR are 1, 2 and 3", () => {
        const tiers: TierName[] = ["common", "rare", "sr", "ssr"];
        for (const tier of tiers) {
            const view = render(<TierMark tier={tier} />);
            expect(view.container.querySelectorAll(".tm")).toHaveLength(TIER_STARS[tier]);
            expect(markSvg(tier).match(/<svg/g)?.length ?? 0).toBe(TIER_STARS[tier]);
            view.unmount();
        }
        expect(TIER_STARS).toEqual({ common: 0, rare: 1, sr: 2, ssr: 3 });
    });
});
