import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import {
    attachThai,
    enrichFromWeb,
    getCharacterProfile,
    getProfileById,
    getThaiDescription,
    type ProfileAnswer,
} from "@/lib/character-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * One character's profile card, for the modal that opens when a face is tapped.
 *
 * `name` is the question and `source` is the context - what the grid says the
 * character is from. Sending it is what stops the card from confidently
 * describing a different character with the same name; see anilist-character.ts
 * for how it is used. `id` skips the matching entirely and is how the card
 * answers "no, I meant the other Rin".
 *
 * The default request is the fast one, and it is meant to stay that way: a warm
 * answer is a single Redis GET, taken in parallel with the rate-limit counter
 * rather than after it. The two expensive things a card can want are separate
 * requests it never waits on:
 *
 *   translate=1  a Thai blurb nobody has paid for yet (Gemini, seconds)
 *   enrich=1     a web lookup for what AniList could not answer (Serper+Gemini)
 *
 * Both are answered from cache ever after, and both are budgeted, because both
 * spend a metered account per new character.
 */
export async function GET(req: NextRequest) {
    try {
        const params = req.nextUrl.searchParams;
        const name = (params.get("name") || "").slice(0, 120).trim();
        const source = (params.get("source") || "").slice(0, 120).trim() || null;
        const rawId = Number.parseInt(params.get("id") ?? "", 10);
        const id = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;

        if (!name && !id) {
            return NextResponse.json({ error: "A name is required." }, { status: 400 });
        }

        const wantsThai = params.get("lang") === "th";
        const wantsTranslation = params.get("translate") === "1";
        const wantsWeb = params.get("enrich") === "1";

        // The counter and the answer are independent, and ioredis writes both
        // commands to the socket before waiting - so together they cost one
        // round trip instead of two, on every single card open.
        const [limited, initial] = await Promise.all([
            enforceRateLimit(req, LIMITS.profile),
            id ? getProfileById(id) : getCharacterProfile(name, source),
        ]);
        if (limited) return limited;

        let answer: ProfileAnswer = initial;

        if (wantsWeb && !id && answer.enrichable) {
            const overBudget = await enforceRateLimit(req, LIMITS.research);
            if (!overBudget) answer = await enrichFromWeb(name, source);
        }

        const { profile, confidence, alternatives, webSources } = answer;

        let th: string | null = answer.th;
        let translatable = false;

        // A web-sourced profile has no AniList id, and its Thai was written in
        // the same call that found it - so there is nothing left to translate.
        if (wantsThai && profile.description && profile.id) {
            if (!th && wantsTranslation) {
                const overBudget = await enforceRateLimit(req, LIMITS.translate);
                if (!overBudget) {
                    th = await getThaiDescription(profile);
                    // Written back onto the entry this request read, so the next
                    // reader gets it from the same single GET as the rest of the
                    // card. `id` here is the request's, not the profile's: a
                    // lookup by name has to update the name's entry.
                    if (th) await attachThai(name, source, id, th);
                }
                // Over budget: the card keeps the English it already has rather
                // than failing, and the next visitor gets the Thai.
            }

            translatable = !th;
        }

        // A character's bio does not change, so a complete answer can sit on the
        // CDN for a day and never reach a lambda or Redis again. An incomplete
        // one - no Thai yet, a web lookup still to do, or nothing found at all -
        // gets a short window so the next attempt is not hidden behind a stale
        // copy.
        const complete =
            !profile.unknown &&
            !answer.enrichable &&
            (!wantsThai || !!th || !profile.description);
        const cacheControl = complete
            ? "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800"
            : "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

        return NextResponse.json(
            {
                profile,
                th,
                translatable,
                confidence,
                alternatives,
                enrichable: answer.enrichable,
                webSources,
            },
            { headers: { "Cache-Control": cacheControl } }
        );
    } catch (e) {
        console.error("Character profile error:", e);
        return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
    }
}
