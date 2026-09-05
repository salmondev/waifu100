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
import {
    characterKey,
    cachedCharacter,
    loadCharacter,
    enrichCharacter,
    translateCharacter,
    type LoadedCharacter,
} from "@/lib/character-cache";
import { usableSeriesHint } from "@/lib/anilist-character";

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

type Loaded = LoadedCharacter;

function Card({ character, onClose }: { character: CharacterRef; onClose: () => void }) {
    /**
     * Which AniList character this card is showing. Null means "whoever the
     * name and the grid's source resolve to"; a number means the reader looked
     * at the answer, said it was the wrong person, and picked from the others
     * who share the name.
     */
    const [pickedId, setPickedId] = useState<number | null>(null);

    const query = useMemo(
        () => ({ name: character.name, source: character.source, id: pickedId }),
        [character.name, character.source, pickedId]
    );

    // A character opened before - or hovered a moment ago - is already known,
    // and the card opens with its text rather than a skeleton.
    const known = cachedCharacter(query);
    const [data, setData] = useState<Loaded | null>(known ?? null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(!known);
    // A web lookup running behind a card that is already showing something.
    const [researching, setResearching] = useState(false);
    // Thai first, like the AI verdict: it is the language this is read in, and
    // the English original is one tap away.
    const [lang, setLang] = useState<"th" | "en">("th");

    /**
     * Picking one of the alternatives asks a different question, so the first
     * answer has to go - leaving it up would show one character's bio under
     * another's name for as long as the second lookup takes. Done during render
     * rather than in an effect: React applies it before anything paints, so
     * there is no frame where the two disagree.
     */
    const queryKey = characterKey(query);
    const [shownKey, setShownKey] = useState(queryKey);
    if (shownKey !== queryKey) {
        const cached = cachedCharacter(query);
        setShownKey(queryKey);
        setData(cached ?? null);
        setFailed(false);
        setLoading(!cached);
    }

    useEffect(() => {
        let alive = true;

        loadCharacter(query)
            .then((loaded) => {
                if (!alive) return;
                setData(loaded);
                setLoading(false);

                // Nobody has paid for this character's Thai yet. Ask for it in
                // the background: the English is already on screen, so this is
                // an upgrade rather than something the reader waits on.
                if (loaded.translatable) {
                    translateCharacter(query).then((th) => {
                        if (alive && th) setData((prev) => (prev ? { ...prev, th } : prev));
                    });
                }

                /**
                 * AniList had nothing, or could not tell which character this
                 * is. That is the normal answer for a game character, and the
                 * web usually can - so ask, behind the card rather than in
                 * front of it. Whatever comes back replaces what is showing,
                 * including its own Thai.
                 */
                if (loaded.enrichable) {
                    setResearching(true);
                    enrichCharacter(query)
                        .then((better) => {
                            if (alive && better) setData(better);
                        })
                        .finally(() => {
                            if (alive) setResearching(false);
                        });
                }
            })
            .catch(() => {
                // A failed lookup is not the same answer as "AniList has never
                // heard of them", and saying so would be a lie about the
                // character rather than about the network.
                if (alive) {
                    setFailed(true);
                    setLoading(false);
                }
            });

        return () => {
            alive = false;
        };
    }, [query]);

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
        (usableSeriesHint(character.source) ? character.source : null);

    /**
     * Several characters answer to this name and the grid said nothing about
     * which. The card shows its best guess - but as a guess, with the others
     * one tap away. Asserting it silently is what made these cards wrong.
     */
    /**
     * Shown whenever the answer was a guess, with or without runners-up to
     * offer. A web result found without any series to go on has no alternatives
     * to list, but it is no more certain for that - it is simply whoever
     * dominates the search results, and saying nothing would be the same silent
     * confidence this card is meant to have stopped having.
     */
    const ambiguous =
        !loading && !failed && !researching && data?.confidence === "low" && !!english;

    /** The text came from search results rather than AniList; the card says so. */
    const fromWeb = (data?.webSources.length ?? 0) > 0;

    // Thai is the default, but a character whose translation is missing should
    // show the English rather than an empty card.
    const body = lang === "th" ? thai ?? english : english;
    const showingFallbackLanguage = lang === "th" && !thai && !!english;
    // The English is up while Gemini writes the Thai. Saying so is the
    // difference between "still working" and "there is no Thai for this one".
    const translationPending = showingFallbackLanguage && !!data?.translatable;

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
                                โหลดไม่สำเร็จ ลองใหม่อีกครั้ง
                            </p>
                        ) : body ? (
                            <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-300">
                                {body}
                            </p>
                        ) : researching ? (
                            /* AniList had nothing and the web is being asked.
                               Saying which step is running beats a blank card
                               that looks like the final answer. */
                            <p className="text-sm text-zinc-500">
                                กำลังค้นข้อมูล…
                            </p>
                        ) : (
                            <p className="text-sm text-zinc-500">
                                ไม่พบข้อมูลตัวละครนี้
                            </p>
                        )}

                        {ambiguous && (
                            /* Inside the scrolling area rather than pinned to
                               the card: it belongs to the text it is qualifying,
                               and a long blurb should not have to fight it for
                               room. */
                            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                                <p className="text-[12px] leading-snug text-amber-200/90">
                                    ชื่อนี้มีหลายตัวละคร นี่คือตัวที่ดังที่สุด
                                </p>
                                <div className="mt-2.5 flex flex-wrap gap-2">
                                    {data?.alternatives.map((alt) => (
                                        <button
                                            key={alt.id}
                                            type="button"
                                            onClick={() => setPickedId(alt.id)}
                                            className="rounded-lg border border-zinc-700 bg-zinc-800/60 px-2.5 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:border-amber-400/50 hover:text-white"
                                        >
                                            <span className="font-medium">{alt.name}</span>
                                            {alt.series && (
                                                <span className="block text-zinc-500">
                                                    {alt.series}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {pickedId !== null && !loading && (
                            <button
                                type="button"
                                onClick={() => setPickedId(null)}
                                className="mt-3 text-[11px] text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
                            >
                                ← ย้อนกลับ
                            </button>
                        )}
                    </div>

                    {!loading && body && (
                        <p className="mt-3 shrink-0 text-[11px] text-zinc-600">
                            {translationPending
                                ? "กำลังแปล…"
                                : showingFallbackLanguage
                                ? "ยังไม่มีฉบับแปลไทย"
                                : fromWeb
                                  ? // Where a web-sourced blurb came from, named:
                                    // it is assembled from search results rather
                                    // than a maintained database, and the reader
                                    // should be able to weigh it accordingly.
                                    `${data!.webSources[0]} · Gemini`
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
