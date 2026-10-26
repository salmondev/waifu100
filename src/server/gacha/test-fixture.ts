/** Small hand-made catalog for the gacha tests (never imported by app code). */
import type { Catalog, CatalogCharacter } from "./catalog-types";

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
        ...extra,
    };
}

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
            characters: [
                ch(101, "Frieren", { role: "MAIN" }),
                ch(102, "Fern"),
                ch(103, "Stark", { gender: "Male", hair: { key: "red", raw: "red" } }),
                ch(104, "Himmel", { gender: "Male", quote: null }),
                ch(105, "Eisen", { gender: "Male", hair: null, quote: null, silhouette: null, occupation: null }),
                ch(106, "Heiter", { gender: "Male", silhouette: null }),
                ch(107, "Flamme", { hair: { key: "multicolour", raw: "multi" } }),
                ch(108, "Ubel", { quote: null, silhouette: null }),
            ],
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
