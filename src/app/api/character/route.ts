import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { getCharacterProfile } from "@/lib/character-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * One character's profile card, for the modal that opens when a face is tapped.
 *
 * A single name per request on purpose: this fires from a tap, so it wants the
 * shortest possible round trip, and a repeat tap costs nothing at all - the
 * answer is cached in Redis and shared across every grid the character appears
 * in. See src/lib/character-profile.ts.
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
        return NextResponse.json({ profile });
    } catch (e) {
        console.error("Character profile error:", e);
        return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
    }
}
