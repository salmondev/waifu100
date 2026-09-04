"use client";

import { useSyncExternalStore } from "react";
import type { ShareSummary } from "@/lib/share-summary";
import { readUserId, USER_ID_HEADER } from "@/lib/user-id";

/**
 * "Which grids did this browser make?", answered fast and answered once.
 *
 * Two problems this solves, both visible:
 *
 *  - The compare button used to appear a beat after everything else on a
 *    shared grid, because every mount waited on /api/my-grids -> Redis before
 *    it could decide whether to render at all. The list barely changes, so it
 *    is mirrored in localStorage and read from there on mount; the network
 *    answer arrives afterwards and corrects it.
 *  - The showcase renders up to 50 cards at once. Without a shared module-level
 *    cache, a compare control on each card would mean 50 identical requests.
 *    Everyone here shares one in-flight promise and one result.
 *
 * The mirror holds only what the API already returns to this browser about its
 * own grids - no owner id, nothing about anyone else.
 */

const CACHE_KEY = "waifu100-my-grids";

/** Stable empty result: a fresh [] each call would loop useSyncExternalStore. */
const EMPTY: ShareSummary[] = [];

function getServerSnapshot(): ShareSummary[] {
    return EMPTY;
}

let cached: ShareSummary[] | null = null;
let inflight: Promise<ShareSummary[]> | null = null;
const listeners = new Set<(grids: ShareSummary[]) => void>();

function isSummary(value: unknown): value is ShareSummary {
    const v = value as ShareSummary | null;
    return !!v && typeof v.id === "string" && typeof v.title === "string";
}

/** The last known list, straight from localStorage. Never throws. */
export function readCachedGrids(): ShareSummary[] {
    if (cached) return cached;
    if (typeof window === "undefined") return EMPTY;
    try {
        const raw = window.localStorage.getItem(CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        cached = Array.isArray(parsed) ? parsed.filter(isSummary) : [];
    } catch {
        cached = [];
    }
    return cached;
}

function publish(grids: ShareSummary[]) {
    cached = grids;
    try {
        window.localStorage.setItem(CACHE_KEY, JSON.stringify(grids));
    } catch {
        // Private mode or a full quota: the list still works for this session.
    }
    listeners.forEach((fn) => fn(grids));
}

/**
 * Records a grid this browser just created, so the compare button is there the
 * first time its author opens someone else's grid - before any list has been
 * fetched at all.
 */
export function rememberOwnGrid(summary: ShareSummary) {
    const rest = readCachedGrids().filter((g) => g.id !== summary.id);
    publish([summary, ...rest]);
}

/** Fetches the real list, at most once per page regardless of callers. */
export function loadMyGrids(): Promise<ShareSummary[]> {
    if (inflight) return inflight;

    const userId = readUserId();
    if (!userId) {
        // No owner id means no grids to own; nothing to fetch, ever.
        inflight = Promise.resolve([]);
        return inflight;
    }

    inflight = fetch("/api/my-grids", { headers: { [USER_ID_HEADER]: userId } })
        .then((res) => (res.ok ? res.json() : { grids: [] }))
        .then((data) => {
            const grids: ShareSummary[] = Array.isArray(data.grids)
                ? data.grids.filter(isSummary)
                : [];
            publish(grids);
            return grids;
        })
        .catch(() => {
            // Offline or a Redis blip: keep whatever the mirror already had
            // rather than making the button disappear mid-session.
            inflight = null;
            return readCachedGrids();
        });

    return inflight;
}

function subscribe(onChange: (grids: ShareSummary[]) => void): () => void {
    listeners.add(onChange);
    // Refreshing on the first subscription (and only then - loadMyGrids keeps
    // one promise) means a card does not have to ask for the list itself.
    loadMyGrids();
    return () => {
        listeners.delete(onChange);
    };
}

/**
 * This browser's grids: the mirrored list immediately, corrected by the API.
 *
 * useSyncExternalStore rather than fetch-in-an-effect on purpose. It hands back
 * the localStorage list on the very first client render - no waiting a round
 * trip for the button to appear - while still rendering the server's empty list
 * during hydration, so the markup never disagrees with what the server sent.
 */
export function useMyGrids(): ShareSummary[] {
    return useSyncExternalStore(subscribe, readCachedGrids, getServerSnapshot);
}
