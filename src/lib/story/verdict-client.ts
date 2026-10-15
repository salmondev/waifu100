import type { AnalysisResult, VerdictFeedback } from "@/types";
import { USER_ID_HEADER, readUserId } from "@/lib/user-id";

/**
 * Builder-side verdict memory (story fork of waifu's verdict + verdictFeedback in its localStorage
 * draft). Kept under its own key, bound to the exact title list it was written for, so a changed
 * board never shows an old verdict - and an unchanged one never pays for a second Gemini call.
 */
export const STORY_VERDICT_LOCAL_KEY = "story100-verdict";

interface LocalEntry {
    sig: string;
    verdict: AnalysisResult;
    feedback: VerdictFeedback;
}

export const storyVerdictSig = (titles: string[]) => titles.join("\n");

export function loadLocalVerdict(titles: string[]): { verdict: AnalysisResult; feedback: VerdictFeedback } | null {
    if (typeof window === "undefined" || titles.length === 0) return null;
    try {
        const e = JSON.parse(window.localStorage.getItem(STORY_VERDICT_LOCAL_KEY) || "null") as LocalEntry | null;
        if (!e || e.sig !== storyVerdictSig(titles) || !e.verdict) return null;
        return { verdict: e.verdict, feedback: e.feedback ?? null };
    } catch {
        return null;
    }
}

export function saveLocalVerdict(titles: string[], verdict: AnalysisResult | null, feedback: VerdictFeedback) {
    if (typeof window === "undefined") return;
    try {
        if (!verdict) {
            const e = JSON.parse(window.localStorage.getItem(STORY_VERDICT_LOCAL_KEY) || "null") as LocalEntry | null;
            if (e && e.sig === storyVerdictSig(titles)) window.localStorage.removeItem(STORY_VERDICT_LOCAL_KEY);
            return;
        }
        window.localStorage.setItem(STORY_VERDICT_LOCAL_KEY, JSON.stringify({ sig: storyVerdictSig(titles), verdict, feedback } satisfies LocalEntry));
    } catch {
        /* storage full / blocked: the verdict just is not remembered */
    }
}

const headers = () => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const id = readUserId();
    if (id) h[USER_ID_HEADER] = id;
    return h;
};

export type StoryVerdictResponse = { ok: true; verdict: AnalysisResult; feedback: VerdictFeedback } | { ok: false; unavailable: boolean };

/** Stored verdict for a share, generated once server-side when there is none. */
export async function requestStoryVerdict(shareId: string): Promise<StoryVerdictResponse> {
    const res = await fetch("/api/story/verdict", { method: "POST", headers: headers(), body: JSON.stringify({ shareId }) });
    const data = (await res.json().catch(() => ({}))) as { verdict?: AnalysisResult; feedback?: VerdictFeedback; code?: string };
    if (!res.ok || !data.verdict) return { ok: false, unavailable: res.status === 403 || data.code === "ai_unavailable" };
    return { ok: true, verdict: data.verdict, feedback: data.feedback ?? null };
}

/** The owner's vote. Fire-and-forget from the UI's point of view. */
export async function voteStoryVerdict(shareId: string, feedback: VerdictFeedback): Promise<boolean> {
    try {
        const res = await fetch("/api/story/verdict", { method: "PATCH", headers: headers(), body: JSON.stringify({ shareId, feedback }) });
        return res.ok;
    } catch {
        return false;
    }
}

/** Owner on the share page: carry the builder's verdict onto the share (waifu sends it in the share payload). */
export async function seedStoryVerdict(shareId: string, titles: string[]): Promise<void> {
    const local = loadLocalVerdict(titles);
    if (!local || local.feedback === "disagree") return;
    try {
        await fetch("/api/story/verdict", { method: "POST", headers: headers(), body: JSON.stringify({ shareId, verdict: local.verdict, feedback: local.feedback }) });
    } catch {
        /* the view page generates one instead */
    }
}
