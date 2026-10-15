import { NextRequest, NextResponse } from "next/server";
import { featureUnavailable } from "@/lib/public-errors";
import { getFlashModel } from "@/lib/gemini";
import { enforceRateLimit } from "@/lib/rate-limit";
import { withRedis } from "@/lib/redis";
import { decodeShare, type DecodedShare } from "@/lib/share-schema";
import { isValidShareId, shareKey } from "@/lib/share-keys";
import { userIdFromRequest } from "@/lib/user-id";
import { isVerdictShaped } from "@/lib/compare-verdict-store";
import { buildGridVerdictPrompt, parseVerdictJson, GRID_VERDICT_STYLE_VERSION } from "@/lib/verdict-tone";
import { STORY_VERDICT_ENABLED } from "@/lib/story/config";
import { STORY_VERDICT_LIMIT, isFeedback, readStoryVerdict, writeStoryVerdict } from "@/lib/story/verdict-store";
import { storyVerdictTitles } from "@/lib/story/verdict-titles";
import type { AnalysisResult } from "@/types";

export const dynamic = "force-dynamic";

async function readStoryShare(id: string): Promise<DecodedShare | null> {
    const raw = await withRedis((r) => r.get(shareKey(id)));
    const d = raw ? decodeShare(raw) : null;
    return d && d.kind === "story" ? d : null;
}

const isOwner = (req: NextRequest, share: DecodedShare) => {
    const caller = userIdFromRequest(req);
    return !!caller && !!share.userId && caller === share.userId;
};

/**
 * POST /api/story/verdict - the verdict for a shared story grid.
 *
 *  - `{ shareId }`: the stored verdict if there is one; otherwise generate ONCE and store it.
 *    A stored verdict the owner voted "disagree" on is regenerated - by the owner only, so a
 *    crowd opening the link never spends more than the first Gemini call.
 *  - `{ shareId, verdict, feedback? }`: the owner's builder verdict, carried over at share time
 *    (waifu sends it inside the share payload). Only fills an empty slot or a disagreed one.
 *
 * Rate limited like /api/compare/verdict; AI off -> 503 ai_unavailable; story verdicts off -> 403.
 */
export async function POST(req: NextRequest) {
    try {
        const limited = await enforceRateLimit(req, STORY_VERDICT_LIMIT);
        if (limited) return limited;
        if (!STORY_VERDICT_ENABLED) return NextResponse.json({ error: "Story verdicts are disabled." }, { status: 403 });

        const body = (await req.json().catch(() => ({}))) as { shareId?: unknown; verdict?: unknown; feedback?: unknown };
        const { shareId } = body;
        if (!isValidShareId(shareId)) return NextResponse.json({ error: "A grid id is required." }, { status: 400 });

        const cached = await readStoryVerdict(shareId);

        if (body.verdict !== undefined) {
            if (!isVerdictShaped(body.verdict)) return NextResponse.json({ error: "Invalid verdict." }, { status: 400 });
            if (cached && cached.feedback !== "disagree") return NextResponse.json({ verdict: cached.verdict, feedback: cached.feedback, cached: true });
            const share = await readStoryShare(shareId);
            if (!share) return NextResponse.json({ error: "Grid not found" }, { status: 404 });
            if (!isOwner(req, share)) return NextResponse.json({ error: "Only the grid's owner can set its verdict." }, { status: 403 });
            const feedback = body.feedback === "agree" ? "agree" : null;
            const verdict = body.verdict as AnalysisResult;
            await writeStoryVerdict(shareId, { verdict, feedback, createdAt: new Date().toISOString() });
            return NextResponse.json({ verdict, feedback, cached: false });
        }

        if (cached && cached.feedback !== "disagree") return NextResponse.json({ verdict: cached.verdict, feedback: cached.feedback, cached: true });

        const share = await readStoryShare(shareId);
        if (!share) return NextResponse.json({ error: "Grid not found" }, { status: 404 });
        // Disagreed: only the owner asks for a new one; everyone else keeps seeing the stored one.
        if (cached && !isOwner(req, share)) return NextResponse.json({ verdict: cached.verdict, feedback: cached.feedback, cached: true });

        const titles = storyVerdictTitles(share.items);
        if (titles.length === 0) return NextResponse.json({ error: "Add some titles first." }, { status: 400 });
        if (!process.env.GEMINI_API_KEY) return featureUnavailable("ai", "GEMINI_API_KEY is not set");

        const generated = await getFlashModel().generateContent(buildGridVerdictPrompt(titles, "story"));
        const text = (await generated.response).text();
        const parsed = parseVerdictJson(text);
        if (!isVerdictShaped(parsed)) {
            console.error("Failed to parse story verdict response:", text);
            return NextResponse.json({ error: "Failed to generate a verdict." }, { status: 500 });
        }
        const verdict = { ...parsed, styleVersion: GRID_VERDICT_STYLE_VERSION } as AnalysisResult;
        await writeStoryVerdict(shareId, { verdict, feedback: null, createdAt: new Date().toISOString() });
        return NextResponse.json({ verdict, feedback: null, cached: false });
    } catch (e) {
        console.error("Story Verdict Error:", e);
        return NextResponse.json({ error: "Failed to generate a verdict." }, { status: 500 });
    }
}

/** PATCH /api/story/verdict `{ shareId, feedback }` - the owner's agree / disagree / clear vote. */
export async function PATCH(req: NextRequest) {
    try {
        const limited = await enforceRateLimit(req, STORY_VERDICT_LIMIT);
        if (limited) return limited;
        const body = (await req.json().catch(() => ({}))) as { shareId?: unknown; feedback?: unknown };
        if (!isValidShareId(body.shareId) || !isFeedback(body.feedback)) return NextResponse.json({ error: "shareId and feedback are required." }, { status: 400 });
        const cached = await readStoryVerdict(body.shareId);
        if (!cached) return NextResponse.json({ error: "No verdict yet." }, { status: 404 });
        const share = await readStoryShare(body.shareId);
        if (!share) return NextResponse.json({ error: "Grid not found" }, { status: 404 });
        if (!isOwner(req, share)) return NextResponse.json({ error: "Only the grid's owner can rate its verdict." }, { status: 403 });
        await writeStoryVerdict(body.shareId, { ...cached, feedback: body.feedback });
        return NextResponse.json({ feedback: body.feedback });
    } catch (e) {
        console.error("Story Verdict Vote Error:", e);
        return NextResponse.json({ error: "Failed to save the vote." }, { status: 500 });
    }
}
