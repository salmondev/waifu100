import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import {
    getCharacterProfile,
    getThaiDescription,
    readThaiDescription,
} from "@/lib/character-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * One character's profile card, for the modal that opens when a face is tapped.
 *
 * A single name per request on purpose: this fires from a tap, so it wants the
 * shortest possible round trip, and a repeat tap costs nothing at all - the
 * answer is cached in Redis and shared across every grid the character appears
 * in. See src/lib/character-profile.ts.
 *
 * `lang=th` also returns the Thai blurb, translated once by Gemini and cached
 * for a year. The card asks for it by default because Thai is the audience's
 * language; the English stays available behind the toggle, and is what the
 * translation is made from.
 */
export async function GET(req: NextRequest) {
    try {
        const limited = await enforceRateLimit(req, LIMITS.profile);
        if (limited) return limited;

        const name = (req.nextUrl.searchParams.get("name") || "").slice(0, 120).trim();
        if (!name) {
            return NextResponse.json({ error: "A name is required." }, { status: 400 });
        }

        const profile = await getCharacterProfile(name);

        const wantsThai = req.nextUrl.searchParams.get("lang") === "th";
        let th: string | null = null;

        if (wantsThai && profile.description) {
            // A translation that already exists is free and unmetered; only the
            // first person to open a given character pays for one, so the budget
            // is consumed here rather than on every card open.
            th = await readThaiDescription(name);

            if (!th) {
                const overBudget = await enforceRateLimit(req, LIMITS.translate);
                if (!overBudget) {
                    th = await getThaiDescription(name, profile.description, profile.series);
                }
                // Over budget: the card falls back to the English it already has
                // rather than failing, and the next visitor gets the Thai.
            }
        }

        return NextResponse.json({ profile, th });
    } catch (e) {
        console.error("Character profile error:", e);
        return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
    }
}
