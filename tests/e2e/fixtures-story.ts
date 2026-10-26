import type { Page } from "@playwright/test";

export const COVER = (n: number) => `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx${n}-e2e.jpg`;
const TITLES: Record<string, string> = { ANIME: "E2E Anime Show", MANGA: "E2E Manga Book", NOVEL: "E2E Light Novel" };

/** Fulfils AniList GraphQL locally (never reaches anilist.co). `down` simulates an outage. */
export async function mockAniList(page: Page, opts: { down?: boolean } = {}) {
  const calls: { type?: string; formatIn?: string[] }[] = [];
  await page.route("https://graphql.anilist.co/**", async (route) => {
    const vars = (route.request().postDataJSON()?.variables ?? {}) as { type?: string; format_in?: string[] };
    calls.push({ type: vars.type, formatIn: vars.format_in });
    if (opts.down) return route.fulfill({ status: 503, body: "down" });
    const kind = vars.format_in?.includes("NOVEL") ? "NOVEL" : vars.type ?? "ANIME";
    const media = [{ id: 7000 + Object.keys(TITLES).indexOf(kind), type: kind === "ANIME" ? "ANIME" : "MANGA", format: kind === "NOVEL" ? "NOVEL" : kind === "MANGA" ? "MANGA" : "TV", seasonYear: 2024, title: { english: TITLES[kind], romaji: TITLES[kind] }, coverImage: { large: COVER(7), extraLarge: COVER(7) } }];
    return route.fulfill({ json: { data: { Page: { media } } } });
  });
  return calls;
}
