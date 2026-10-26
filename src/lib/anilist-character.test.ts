import { describe, it, expect } from "vitest";
import {
    agreesWithHint,
    pickCharacter,
    usableSeriesHint,
    bestKnownSeries,
    type AniListCandidate,
} from "@/lib/anilist-character";

/**
 * These are the failures the old matcher shipped: it took AniList's first
 * search hit, checked only that the names agreed, and cached the answer under
 * the bare name. Every case below passed that check while being the wrong
 * character.
 */

let nextId = 1;

function character(
    name: string,
    series: string[],
    { favourites = 0, role = "MAIN", native = null as string | null, alternative = [] as string[] } = {}
): AniListCandidate {
    return {
        id: nextId++,
        name: { full: name, native, alternative },
        favourites,
        media: {
            edges: series.map((title) => ({
                characterRole: role,
                node: { title: { english: title, romaji: title, native: null } },
            })),
        },
    };
}

describe("usableSeriesHint", () => {
    it("accepts a real title", () => {
        expect(usableSeriesHint("Fate/stay night")).toBe(true);
        expect(usableSeriesHint("Re:Zero")).toBe(true);
    });

    it("rejects the picture-source markers real grids are full of", () => {
        for (const junk of [
            "Google (www.pinterest.com)",
            "Uploaded",
            "Uploaded (GIF)",
            "Imported",
            "URL",
            "Web Search",
            "Official (MAL)",
            "AniList",
            "Unknown",
            "https://i.pinimg.com/x.jpg",
            "www.pixiv.net",
            "",
            null,
        ]) {
            expect(usableSeriesHint(junk)).toBe(false);
        }
    });
});

describe("pickCharacter - same name, different character", () => {
    const rinTohsaka = character("Rin Tohsaka", ["Fate/stay night"], { favourites: 9000 });
    const rinShima = character("Rin Shima", ["Yuru Camp"], { favourites: 3000 });
    const rinHoshizora = character("Rin Hoshizora", ["Love Live!"], { favourites: 2000 });

    it("lets the grid's own series decide, not popularity", () => {
        const match = pickCharacter("Rin", "Yuru Camp", [rinTohsaka, rinShima, rinHoshizora]);

        expect(match?.best.candidate.id).toBe(rinShima.id);
        expect(match?.confidence).toBe("high");
    });

    it("matches a title spelled the other way round", () => {
        // The grid stored the English title; AniList knows it by both, and the
        // two rarely agree ("Attack on Titan" / "Shingeki no Kyojin").
        const eren: AniListCandidate = {
            id: 4001,
            name: { full: "Eren Yeager" },
            favourites: 50,
            media: {
                edges: [
                    {
                        characterRole: "MAIN",
                        node: {
                            title: {
                                english: "Attack on Titan",
                                romaji: "Shingeki no Kyojin",
                                native: null,
                            },
                        },
                    },
                ],
            },
        };
        const decoy = character("Eren Kruger", ["Something Else"], { favourites: 9000 });

        expect(pickCharacter("Eren Yeager", "Attack on Titan", [decoy, eren])?.best.candidate.id)
            .toBe(eren.id);
        expect(pickCharacter("Eren Yeager", "Shingeki no Kyojin", [decoy, eren])?.confidence)
            .toBe("high");
    });

    it("admits it is guessing when nothing says which one", () => {
        const match = pickCharacter("Rin", "Uploaded", [rinTohsaka, rinShima, rinHoshizora]);

        // A guess is still made - the card needs something - but it is flagged,
        // and the others come back so the reader can correct it.
        expect(match?.confidence).toBe("low");
        expect(match?.alternatives.length).toBeGreaterThan(0);
    });

    it("does not flag a name only one character answers to", () => {
        const frieren = character("Frieren", ["Sousou no Frieren"], { favourites: 8000 });
        const match = pickCharacter("Frieren", null, [frieren]);

        expect(match?.confidence).toBe("high");
        expect(match?.alternatives).toEqual([]);
    });
});

describe("pickCharacter - name matching", () => {
    it("ignores Japanese name order", () => {
        const miku = character("Hatsune Miku", ["Vocaloid"], { favourites: 20000 });
        const match = pickCharacter("Miku Hatsune", null, [miku]);

        expect(match?.best.candidate.id).toBe(miku.id);
        expect(match?.best.nameScore).toBe(3);
    });

    it("never calls a bare mononym certain", () => {
        // "Miku" is inside "Miku Nakano", "Miku Izayoi" and "Hatsune Miku"
        // alike. Asserting the most popular of those is how a card ended up
        // describing a completely different person - so the answer still comes
        // back, but only ever as a guess with the others attached.
        const nakano = character("Miku Nakano", ["Go-toubun no Hanayome"], { favourites: 9000 });
        const izayoi = character("Miku Izayoi", ["Date A Live"], { favourites: 4000 });

        const match = pickCharacter("Miku", null, [nakano, izayoi]);
        expect(match?.confidence).toBe("low");
        expect(match?.alternatives.map((a) => a.candidate.id)).toContain(izayoi.id);
    });

    it("accepts that mononym once the series backs it up", () => {
        const nakano = character("Miku Nakano", ["Go-toubun no Hanayome"], { favourites: 9000 });
        const izayoi = character("Miku Izayoi", ["Date A Live"], { favourites: 4000 });

        const match = pickCharacter("Miku", "Date A Live", [nakano, izayoi]);
        expect(match?.best.candidate.id).toBe(izayoi.id);
        expect(match?.confidence).toBe("high");
    });

    it("still rejects a search that answered with someone else entirely", () => {
        // The original failure this guard was written for: searching "Eula"
        // returns "Seul-A" from an unrelated show.
        const seulA = character("Seul-A Kang", ["My Daughter"], { favourites: 10 });
        expect(pickCharacter("Eula", null, [seulA])).toBeNull();
    });

    it("matches on an alternative spelling", () => {
        const zero = character("Zero Two", ["Darling in the FranXX"], {
            favourites: 40000,
            alternative: ["002", "Nine Iota"],
        });
        expect(pickCharacter("002", null, [zero])?.best.candidate.id).toBe(zero.id);
    });
});

describe("agreesWithHint", () => {
    // This is the gate a web search result has to pass before it may replace
    // AniList's answer. Without it, "the paragraph that sounds more confident
    // wins" - which is how the wrong bios got here.
    it("accepts a title the grid recorded, however it is subtitled", () => {
        expect(agreesWithHint("Genshin Impact", "Genshin Impact")).toBe(true);
        expect(agreesWithHint("Fate/stay night", "Fate/stay night: Unlimited Blade Works")).toBe(
            true
        );
    });

    it("rejects a different work, and anything that is not a title", () => {
        expect(agreesWithHint("Genshin Impact", "Honkai: Star Rail")).toBe(false);
        expect(agreesWithHint("Uploaded", "Genshin Impact")).toBe(false);
        expect(agreesWithHint("Genshin Impact", null)).toBe(false);
    });
});

describe("bestKnownSeries", () => {
    it("prefers a main role over a more popular cameo", () => {
        const miku: AniListCandidate = {
            id: 999,
            name: { full: "Hatsune Miku" },
            media: {
                edges: [
                    {
                        characterRole: "BACKGROUND",
                        node: { title: { english: "Sayonara Zetsubou-Sensei", romaji: null } },
                    },
                    {
                        characterRole: "MAIN",
                        node: { title: { english: null, romaji: "Vocaloid" } },
                    },
                ],
            },
        };
        expect(bestKnownSeries(miku)).toBe("Vocaloid");
    });
});
