import { describe, expect, it } from "vitest";
import { cardShareDescription, cardShareHeading, cardShareText, cardShareUrl } from "./gacha-card-share";

describe("cardShareText", () => {
    it("puts the tier, the stars, the name, the day and one card link on their own lines", () => {
        const url = cardShareUrl("Ab3kP9xQ");
        expect(url).toBe("https://waifu100.vercel.app/c/Ab3kP9xQ");
        expect(cardShareText("ssr", "Frieren", 30, url)).toBe(
            ["SSR ★★★ Frieren", "waifu100 Daily #30", "https://waifu100.vercel.app/c/Ab3kP9xQ"].join("\n"),
        );
        expect(cardShareHeading("sr", "Fern")).toBe("SR ★★ Fern");
        expect(cardShareHeading("rare", "Stark")).toBe("Rare ★ Stark");
        expect(cardShareHeading("common", "Heiter")).toBe("Common Heiter");
        expect(cardShareDescription(30)).toBe("waifu100 Daily #30 · ทายตัวละครอนิเมะ สะสมการ์ด");
    });
});
