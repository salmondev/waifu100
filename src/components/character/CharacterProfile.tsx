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
 * feel like a different character. AniList fills in the words, and Gemini says
 * them in Thai.
 *
 * The card is one fixed size whatever it holds. A tall portrait, a wide banner
 * and a character with no blurb at all produced three differently shaped cards,
 * which made the modal feel like it was resizing itself around its contents
 * rather than being a card.
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

interface Loaded {
    profile: CharacterProfile | null;
    th: string | null;
}

function Card({ character, onClose }: { character: CharacterRef; onClose: () => void }) {
    const [data, setData] = useState<Loaded | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(true);
    // Thai first, like the AI verdict: it is the language this is read in, and
    // the English original is one tap away.
    const [lang, setLang] = useState<"th" | "en">("th");

    // No resetting on name change: the card is keyed by name where it is
    // rendered, so a different character mounts a fresh one.
    useEffect(() => {
        let alive = true;

        fetch(`/api/character?name=${encodeURIComponent(character.name)}&lang=th`)
            .then(async (res) => {
                if (!res.ok) throw new Error(String(res.status));
                return res.json();
            })
            .then((body) => {
                if (alive) setData({ profile: body?.profile ?? null, th: body?.th ?? null });
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

    const profile = data?.profile ?? null;
    const english = profile?.description ?? null;
    const thai = data?.th ?? null;

    const series =
        profile?.series ||
        // The stored source is a fallback, not a first choice: it is a series
        // title only when the character came from a search.
        (character.source &&
        !/^(google|official|uploaded|imported|url|web search|myanimelist|anilist|shared|unknown)/i.test(
            character.source
        )
            ? character.source
            : null);

    // Thai is the default, but a character whose translation is missing should
    // show the English rather than an empty card.
    const body = lang === "th" ? thai ?? english : english;
    const showingFallbackLanguage = lang === "th" && !thai && !!english;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={character.name}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className={cn(
                    "animate-in slide-in-from-bottom-4 duration-200 flex w-full flex-col overflow-hidden",
                    "rounded-t-3xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-purple-950/40 sm:rounded-3xl",
                    // One size for every character: picture area and text area
                    // are both fixed, and a long blurb scrolls inside its own box.
                    "h-[86vh] max-h-[680px] sm:h-[620px] sm:max-w-lg"
                )}
            >
                <div className="relative h-64 shrink-0 overflow-hidden bg-zinc-950 sm:h-72">
                    {character.image ? (
                        <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={optimizedImageSrc(character.image, 640)}
                                alt=""
                                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={optimizedImageSrc(character.image, 640)}
                                alt={character.name}
                                className="relative h-full w-full object-contain"
                            />
                        </>
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-zinc-700">
                            no image
                        </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-900 to-transparent" />

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-zinc-300 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Lifted over the picture, which needs a stacking context of
                    its own - without it the name sat behind the image block. */}
                <div className="relative z-10 -mt-8 flex min-h-0 flex-1 flex-col px-6 pb-6">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="text-2xl font-bold leading-tight text-white">
                                {profile?.name || character.name}
                            </h3>
                            {series ? (
                                <p className="mt-1 text-sm text-purple-300">{series}</p>
                            ) : loading ? (
                                <p className="mt-2 h-4 w-32 animate-pulse rounded bg-zinc-800" />
                            ) : (
                                <p className="mt-1 text-sm text-zinc-600">Series unknown</p>
                            )}
                        </div>

                        {/* The same switch as the AI verdict, so the two cards
                            read as one feature rather than two conventions. */}
                        <div className="flex shrink-0 rounded-lg bg-zinc-800/80 p-0.5 text-xs font-medium">
                            <button
                                onClick={() => setLang("th")}
                                className={cn(
                                    "rounded-md px-2.5 py-1 transition-colors",
                                    lang === "th"
                                        ? "bg-gradient-to-r from-blue-600 to-red-600 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                TH
                            </button>
                            <button
                                onClick={() => setLang("en")}
                                className={cn(
                                    "rounded-md px-2.5 py-1 transition-colors",
                                    lang === "en"
                                        ? "bg-zinc-700 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300"
                                )}
                            >
                                EN
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                        {loading ? (
                            <div className="flex flex-col gap-2">
                                <div className="h-3.5 w-full animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-11/12 animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-4/5 animate-pulse rounded bg-zinc-800/70" />
                                <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-800/70" />
                            </div>
                        ) : failed ? (
                            <p className="text-sm text-zinc-500">
                                Could not load this profile just now. Close and tap again.
                            </p>
                        ) : body ? (
                            <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
                                {body}
                            </p>
                        ) : (
                            <p className="text-sm text-zinc-500">
                                No profile for this one - AniList doesn&apos;t have every
                                VTuber, idol or original character.
                            </p>
                        )}
                    </div>

                    {!loading && body && (
                        <p className="mt-3 shrink-0 text-[11px] text-zinc-600">
                            {showingFallbackLanguage
                                ? "English only - no Thai version for this one yet."
                                : lang === "th"
                                  ? "AniList · แปลไทยโดย Gemini"
                                  : "Profile from AniList"}
                        </p>
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
