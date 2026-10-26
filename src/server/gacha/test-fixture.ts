/** Small hand-made catalog for the gacha tests (never imported by app code). */
import type { Catalog, CatalogCharacter, RosterCharacter, VoiceActor } from "./catalog-types";

function ch(id: number, name: string, extra: Partial<CatalogCharacter> = {}): CatalogCharacter {
    return {
        id,
        name,
        nameNative: `${name}-jp`,
        alternative: [`${name}-alt`],
        gender: "Female",
        age: null,
        role: "SUPPORTING",
        favourites: 100,
        image: `https://img.example.test/char/${id}-${name.toLowerCase()}.png`,
        siteUrl: `https://anilist.co/character/${id}`,
        hair: { key: "blue", raw: "blue hair" },
        occupation: "Mage",
        quote: `Famous line no. ${id}`,
        silhouette: `https://img.example.test/sil/${id}.png`,
        birthMonth: null,
        va: null,
        ...extra,
    };
}

const va = (id: number, name: string): VoiceActor => ({ id, name, nameNative: `${name}-jp` });
const TANESAKI = va(9501, "Atsumi Tanezaki");
const ICHINOSE = va(9502, "Kana Ichinose");
const KOBAYASHI = va(9503, "Chiaki Kobayashi");

/** The roster entry of a card character (same data, `card: true`). */
function cardEntry(c: CatalogCharacter): RosterCharacter {
    return {
        id: c.id, name: c.name, nameNative: c.nameNative, alternative: c.alternative, gender: c.gender, age: c.age,
        role: c.role, favourites: c.favourites, birthMonth: c.birthMonth ?? null, va: c.va ?? null, card: true,
    };
}

/** A guess-only roster entry: guessable, never an answer, no art. */
function extra(id: number, name: string, more: Partial<RosterCharacter> = {}): RosterCharacter {
    return {
        id, name, nameNative: null, alternative: [], gender: "Male", age: null, role: "SUPPORTING", favourites: 60,
        birthMonth: null, va: null, card: false, ...more,
    };
}

const FRIEREN_CARDS: CatalogCharacter[] = [
    ch(101, "Frieren", { role: "MAIN", age: "1000+", favourites: 5000, birthMonth: 12, va: TANESAKI }),
    ch(102, "Fern", { age: "16-17", favourites: 3000, birthMonth: 4, va: ICHINOSE }),
    ch(103, "Stark", { gender: "Male", hair: { key: "red", raw: "red" }, age: "17", favourites: 2500, birthMonth: 2, va: KOBAYASHI }),
    ch(104, "Himmel", { gender: "Male", quote: null, age: "Unknown", favourites: 2000, va: va(9504, "Nobuhiko Okamoto") }),
    ch(105, "Eisen", { gender: "Male", hair: null, quote: null, silhouette: null, occupation: null, favourites: 800 }),
    ch(106, "Heiter", { gender: "Male", silhouette: null, favourites: 900, va: va(9505, "Hiroki Touchi") }),
    ch(107, "Flamme", { hair: { key: "multicolour", raw: "multi" }, favourites: 700, va: TANESAKI }),
    ch(108, "Ubel", { quote: null, silhouette: null, age: "~20", favourites: 1200, birthMonth: 9, va: va(9506, "Yuko Hara") }),
];

export const FIXTURE_CATALOG: Catalog = {
    generatedAt: "2026-10-01T00:00:00.000Z",
    source: "fixture",
    imageNote: "fixture",
    anime: [
        {
            id: 9001,
            titleRomaji: "Sousou no Furiiren",
            titleEnglish: "Beyond Journey's End",
            titleNative: "葬送のフリーレン",
            cover: "https://img.example.test/cover/9001.png",
            coverColor: "#e4e0d6",
            popularity: 1000,
            setCode: "FRN",
            siteUrl: "https://anilist.co/anime/9001",
            characters: FRIEREN_CARDS,
            // r2 roster: the cards plus two guess-only characters. 9002 has no roster (pre-r2 catalog shape).
            roster: [
                ...FRIEREN_CARDS.map(cardEntry),
                extra(151, "Sein", { age: "30", favourites: 400, birthMonth: 6, va: va(9507, "Yoshitsugu Matsuoka") }),
                extra(152, "Wirbel", { favourites: 300, va: KOBAYASHI }),
            ].sort((a, b) => b.favourites - a.favourites || a.id - b.id),
        },
        {
            id: 9002,
            titleRomaji: "Oshi no Ko",
            titleEnglish: null,
            titleNative: "【推しの子】",
            cover: "https://img.example.test/cover/9002.png",
            coverColor: null,
            popularity: 900,
            setCode: "OSK",
            siteUrl: "https://anilist.co/anime/9002",
            characters: [
                ch(201, "Ai", { role: "MAIN" }),
                ch(202, "Aqua", { gender: "Male" }),
                ch(203, "Ruby"),
                ch(204, "Kana"),
                ch(205, "Akane"),
                ch(206, "Mem"),
                ch(207, "Miyako"),
            ],
        },
    ],
};
