/**
 * Spot-checks the profile card against a list of characters, and times it.
 *
 *   node scripts/check-profiles.mjs            # the built-in list
 *   node scripts/check-profiles.mjs "Kafka|Honkai: Star Rail" "Rin|"
 *
 * Each entry is `name|source`, exactly as a grid cell would carry it. For every
 * one it reports the cold answer, the warm answer (which should be the cached
 * path), and what the card would actually say - which series, how sure, and
 * whether the text came from AniList or the web.
 *
 * Needs the dev server running. It spends real Serper and Gemini credit on
 * characters nothing has looked up yet, so it pauses between the lookups that
 * trigger one.
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

const DEFAULT_CASES = [
    // Games, which AniList does not index - the reported weak spot.
    "Raiden Shogun|Genshin Impact",
    "Sangonomiya Kokomi|Genshin Impact",
    "Kafka|Honkai: Star Rail",
    "Asuna|Blue Archive",
    "Amiya|Arknights",
    // Anime, which it does - these should never need the web.
    "Frieren|Sousou no Frieren",
    "Makima|Chainsaw Man",
    "Rin Tohsaka|Fate/stay night",
    // Names with no context at all: the ambiguous case.
    "Rin|Uploaded",
    "Asuna|Uploaded",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(name, source, { enrich = false } = {}) {
    const params = new URLSearchParams({ name, lang: "th" });
    if (source) params.set("source", source);
    if (enrich) params.set("enrich", "1");

    const started = Date.now();
    const res = await fetch(`${BASE}/api/character?${params}`);
    const ms = Date.now() - started;
    const body = await res.json();
    return { ms, status: res.status, ...body };
}

const cases = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CASES;

console.log(
    `${"name".padEnd(22)} ${"source".padEnd(20)} ${"cold".padStart(6)} ${"warm".padStart(6)}  ` +
        `resolved series / origin`
);
console.log("-".repeat(110));

for (const entry of cases) {
    const [name, source = ""] = entry.split("|");

    let answer = await ask(name, source);
    const cold = answer.ms;

    // The card's second request, when AniList fell short.
    let enrichMs = 0;
    if (answer.enrichable) {
        const enriched = await ask(name, source, { enrich: true });
        enrichMs = enriched.ms;
        if (enriched.profile) answer = enriched;
        // The web path costs a Serper credit; the route allows five a minute.
        await sleep(12_000);
    }

    const warm = (await ask(name, source)).ms;

    const profile = answer.profile ?? {};
    const origin = answer.webSources?.length
        ? `web:${answer.webSources.join(",")}`
        : profile.unknown
          ? "not found"
          : "anilist";
    const flag = answer.confidence === "low" ? " [ambiguous]" : "";

    console.log(
        `${name.padEnd(22)} ${(source || "-").padEnd(20)} ${String(cold + "ms").padStart(6)} ` +
            `${String(warm + "ms").padStart(6)}  ${profile.series ?? "-"} (${origin})${flag}` +
            (enrichMs ? `  +web ${enrichMs}ms` : "")
    );

    if (process.env.VERBOSE) {
        console.log(`    ${(profile.description ?? "(no description)").slice(0, 160)}`);
        if (answer.th) console.log(`    TH: ${answer.th.slice(0, 120)}`);
        if (answer.alternatives?.length) {
            console.log(
                `    others: ${answer.alternatives
                    .map((a) => `${a.name} (${a.series ?? "?"})`)
                    .join(" | ")}`
            );
        }
    }
}
