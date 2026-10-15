import { withRedis } from "@/lib/redis";
import { isVerdictShaped } from "@/lib/compare-verdict-store";
import type { AnalysisResult, VerdictFeedback } from "@/types";
import type { RateLimit } from "@/lib/rate-limit";

/** Story verdict budget (generate / vote / carry-over): same as waifu's LIMITS.compareVerdict - a public page, cached after the first call. */
export const STORY_VERDICT_LIMIT = { name: "story-verdict", limit: 6, windowSec: 60 } satisfies RateLimit;

/**
 * Where a shared story grid's AI verdict lives (story fork of waifu's verdict-on-the-share).
 *
 * Waifu keeps `verdict` / `verdictFeedback` inside the share payload. Story shares are written
 * without one, and rewriting a share payload is a heavier operation than this needs, so the
 * verdict sits next to the share under its own key - read alongside the view page (no request,
 * no spinner for a verdict that already exists), like the compare page's cached pair verdict.
 *
 * Generated once. It is only replaced after the grid's owner votes "disagree".
 */
export const storyVerdictKey = (shareId: string) => `waifu100:story:verdict:${shareId}`;

/** A shared grid never changes; the TTL only stops orphans of deleted grids living forever. */
export const STORY_VERDICT_TTL_SEC = 60 * 60 * 24 * 365;

export interface StoryVerdictEntry {
    verdict: AnalysisResult;
    feedback: VerdictFeedback;
    createdAt: string;
}

export const isFeedback = (v: unknown): v is VerdictFeedback => v === null || v === "agree" || v === "disagree";

/** The stored verdict for a story share, or null. Never throws. */
export async function readStoryVerdict(shareId: string): Promise<StoryVerdictEntry | null> {
    try {
        const raw = await withRedis((r) => r.get(storyVerdictKey(shareId)));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoryVerdictEntry>;
        if (!isVerdictShaped(parsed.verdict)) return null;
        return { verdict: parsed.verdict, feedback: isFeedback(parsed.feedback) ? parsed.feedback : null, createdAt: String(parsed.createdAt ?? "") };
    } catch {
        return null;
    }
}

/** Stores a verdict entry. Returns false (and logs) on failure; never throws. */
export async function writeStoryVerdict(shareId: string, entry: StoryVerdictEntry): Promise<boolean> {
    try {
        await withRedis((r) => r.set(storyVerdictKey(shareId), JSON.stringify(entry), "EX", STORY_VERDICT_TTL_SEC));
        return true;
    } catch (e) {
        console.error("Story verdict write failed:", e);
        return false;
    }
}
