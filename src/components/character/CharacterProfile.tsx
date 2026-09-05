"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn, optimizedImageSrc } from "@/lib/utils";
import type { CharacterProfile } from "@/lib/character-profile";

/**
 * The card that opens when a character's picture is tapped.
 *
 * Every face in the app is already a picture with a name under it; this is the
 * rest of the answer - what they are from, and a few lines about them - which
 * until now was only ever in the visitor's head.
 *
 * The picture is always the one from the grid, never AniList's: the grid owner
 * chose that image, and swapping it for a stock portrait would make the card
 * feel like a different character. AniList fills in the words.
 *
 * A provider rather than local state in each component, because faces appear in
 * four places on the compare page alone (shared, both "only in" columns, the
 * series modal) and every one of them would otherwise carry its own copy.
 */

export interface CharacterRef {
    name: string;
    image?: string | null;
    /** Whatever the grid stored - shown only when the lookup finds nothing. */
    source?: string | null;
}

type OpenFn = (character: CharacterRef) => void;

const OpenContext = createContext<OpenFn | null>(null);

/** Opens the profile card. Returns a no-op outside a provider, never throws. */
export function useOpenCharacter(): OpenFn {
    return useContext(OpenContext) ?? (() => {});
}

function Card({ character, onClose }: { character: CharacterRef; onClose: () => void }) {
    const [profile, setProfile] = useState<CharacterProfile | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(true);

    // No resetting on name change: the card is keyed by name where it is
    // rendered, so a different character mounts a fresh one.
    useEffect(() => {
        let alive = true;

        fetch(`/api/character?name=${encodeURIComponent(character.name)}`)
            .then(async (res) => {
                if (!res.ok) throw new Error(String(res.status));
                return res.json();
            })
            .then((data) => {
                if (alive) setProfile(data?.profile ?? null);
            })
            .catch(() => {
                // A failed lookup is not the same answer as "AniList has never
                // heard of them", and saying so would be a lie about the
                // character rather than about the network.
                if (alive) setFailed(true);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });

        return () => {
            alive = false;
        };
    }, [character.name]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const series =
        profile?.series ||
        // The stored source is a fallback, not a first choice: it is a series
        // title only when the character came from a search.
        (character.source && !/^(google|official|uploaded|imported|url|web search)/i.test(character.source)
            ? character.source
            : null);

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={character.name}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="animate-in slide-in-from-bottom-4 duration-200 w-full max-w-md overflow-hidden rounded-t-3xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-purple-950/40 sm:rounded-3xl"
            >
                <div className="relative">
                    <div className="relative h-56 w-full overflow-hidden bg-zinc-950 sm:h-64">
                        {character.image ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={optimizedImageSrc(character.image, 640)}
                                    alt=""
                                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
                                />
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={optimizedImageSrc(character.image, 640)}
                                    alt={character.name}
                                    className="relative h-full w-full object-contain"
                                />
                            </>
                        ) : (
                            <div className="flex h-full items-center justify-center text-zinc-700">
                                no image
                            </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent" />
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Lifted over the picture is only safe with a stacking
                    context of its own - without it the name sat behind the
                    image block and vanished. */}
                <div className="relative z-10 -mt-6 px-5 pb-5">
                    <h3 className="text-xl font-bold leading-tight text-white">
                        {profile?.name || character.name}
                    </h3>

                    {series ? (
                        <p className="mt-1 text-sm text-purple-300">{series}</p>
                    ) : loading ? (
                        <p className="mt-1 h-4 w-32 animate-pulse rounded bg-zinc-800" />
                    ) : (
                        <p className="mt-1 text-sm text-zinc-600">Series unknown</p>
                    )}

                    <div className="mt-3 max-h-56 overflow-y-auto pr-1">
                        {loading ? (
                            <div className="flex flex-col gap-2">
                                <div className="h-3.5 w-full animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-11/12 animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-800/70" />
                            </div>
                        ) : failed ? (
                            <p className="text-sm text-zinc-500">
                                Could not load this profile just now. Close and tap again.
                            </p>
                        ) : profile?.description ? (
                            <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-300">
                                {profile.description}
                            </p>
                        ) : (
                            <p className="text-sm text-zinc-500">
                                No profile for this one - AniList doesn&apos;t have every
                                VTuber, idol or original character.
                            </p>
                        )}
                    </div>

                    {!loading && profile && !profile.unknown && (
                        <p className="mt-3 text-[11px] text-zinc-600">Profile from AniList</p>
                    )}
                </div>
            </div>
        </div>
    );
}

export function CharacterProfileProvider({ children }: { children: ReactNode }) {
    const [character, setCharacter] = useState<CharacterRef | null>(null);

    const open = useCallback((next: CharacterRef) => setCharacter(next), []);
    const close = useCallback(() => setCharacter(null), []);

    // The modal takes over the screen on a phone, so the page behind it must not
    // keep scrolling under the finger.
    useEffect(() => {
        if (!character) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previous;
        };
    }, [character]);

    const value = useMemo(() => open, [open]);

    return (
        <OpenContext.Provider value={value}>
            {children}
            {character && (
                <Card key={character.name} character={character} onClose={close} />
            )}
        </OpenContext.Provider>
    );
}

/** Shared styling for a face that opens its profile. */
export const faceButtonClass = cn(
    "group flex w-full flex-col gap-1.5 text-left",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-xl"
);
