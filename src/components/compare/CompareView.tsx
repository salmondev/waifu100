"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Grid3x3, Link2, Users } from "lucide-react";
import { cn, optimizedImageSrc } from "@/lib/utils";
import type { CompareCharacter, ComparePair } from "@/lib/character-match";
import { CompareVerdict } from "@/components/compare/CompareVerdict";

export interface CompareSide {
    id: string;
    title: string;
    imageUrl: string | null;
    count: number;
}

export interface CompareViewProps {
    a: CompareSide;
    b: CompareSide;
    similarity: number;
    shared: ComparePair[];
    /** In A only - the visitor's side, when they arrived from their own grid. */
    onlyA: CompareCharacter[];
    onlyB: CompareCharacter[];
}

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

/** How many faces each "only in" column shows before "show more". */
const COLLAPSED_FACES = 12;

function cellLabel(index: number) {
    return `${COLUMNS[index % 10]}${Math.floor(index / 10) + 1}`;
}

/**
 * How the number is described in words.
 *
 * A bare percentage invites the question "is that a lot?", and nobody has a
 * baseline for grid overlap - two strangers who both watch a lot of anime
 * typically land in the teens.
 */
function verdictLine(similarity: number, shared: number) {
    if (shared === 0) return "Nothing in common. Completely different worlds.";
    if (similarity >= 60) return "Suspiciously similar taste.";
    if (similarity >= 35) return "Clearly the same corner of the internet.";
    if (similarity >= 15) return "Enough overlap to argue about the rest.";
    return "Barely overlapping - plenty to recommend each other.";
}

function GridBadge({ side, align }: { side: CompareSide; align: "left" | "right" }) {
    return (
        <Link
            href={`/view/${side.id}`}
            className={cn(
                "group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition-colors hover:border-purple-500/40 hover:bg-zinc-900",
                align === "right" && "flex-row-reverse text-right"
            )}
        >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                {side.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={optimizedImageSrc(side.imageUrl, 128)}
                        alt=""
                        className="h-full w-full object-cover"
                    />
                )}
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white group-hover:text-purple-300 sm:text-base">
                    {side.title}
                </p>
                <p className="text-xs text-zinc-500">{side.count} characters</p>
            </div>
        </Link>
    );
}

function Face({
    character,
    className,
}: {
    character: CompareCharacter;
    className?: string;
}) {
    return (
        <div className={cn("group flex flex-col gap-1.5", className)}>
            <div className="relative aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                {character.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={optimizedImageSrc(character.image, 256)}
                        alt={character.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-zinc-700" />
                    </div>
                )}
                <span className="absolute right-1 top-1 rounded bg-black/60 px-1 font-mono text-[9px] text-zinc-400">
                    {cellLabel(character.index)}
                </span>
            </div>
            <p className="truncate text-center text-[11px] leading-tight text-zinc-400">
                {character.name}
            </p>
        </div>
    );
}

/**
 * One "only in this grid" column.
 *
 * Collapsed by default because the full lists are the biggest thing on the
 * page - two nearly-disjoint 100-cell grids put ~170 faces below the number,
 * and the number is what people came for. Twelve is enough to browse and to
 * make the "show all" worth pressing.
 */
function OnlyColumn({
    heading,
    note,
    characters,
}: {
    heading: string;
    note: string;
    characters: CompareCharacter[];
}) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? characters : characters.slice(0, COLLAPSED_FACES);
    const hidden = characters.length - visible.length;

    return (
        <section>
            <h2 className="mb-1 truncate text-sm font-bold uppercase tracking-widest text-zinc-500">
                {heading}
            </h2>
            <p className="mb-3 text-xs text-zinc-600">{note}</p>

            {characters.length === 0 ? (
                <p className="text-sm text-zinc-600">Nothing - every pick is shared.</p>
            ) : (
                <>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-4">
                        {visible.map((character) => (
                            <Face key={character.key} character={character} />
                        ))}
                    </div>
                    {hidden > 0 && (
                        <button
                            onClick={() => setExpanded(true)}
                            className="mt-3 w-full rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:border-purple-500/40 hover:text-purple-300"
                        >
                            Show {hidden} more
                        </button>
                    )}
                </>
            )}
        </section>
    );
}

/**
 * The comparison itself.
 *
 * Everything on this page is computed on the server from the two stored grids,
 * so this component only decides how it reads. The order it reads in is the
 * point: the number first (that is what gets screenshotted), then the faces
 * that produced it, then - last and deliberately - what each side is missing,
 * because that list is the reason to keep scrolling and the reason to go build
 * a grid of your own.
 */
export function CompareView({ a, b, similarity, shared, onlyA, onlyB }: CompareViewProps) {
    const [copied, setCopied] = useState(false);

    const handleCopyLink = () => {
        // Rebuilt from the ids rather than copying location.href, so the link
        // never carries whatever tracking query the visitor arrived with.
        navigator.clipboard.writeText(
            `${window.location.origin}/compare?a=${a.id}&b=${b.id}`
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="min-h-screen bg-zinc-950 py-6 text-white sm:py-10">
            <div className="mx-auto w-full max-w-[1000px] px-3 sm:px-4">
                {/* Nav */}
                <div className="mb-6 flex flex-wrap items-center gap-2">
                    <Link
                        href="/community"
                        className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                        <ArrowLeft size={18} className="shrink-0" />
                        <span>Community Showcase</span>
                    </Link>
                    <Link
                        href="/"
                        className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                    >
                        <Grid3x3 size={18} className="shrink-0" />
                        <span>Create Your Own</span>
                    </Link>
                    <button
                        onClick={handleCopyLink}
                        className={cn(
                            "ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                            copied
                                ? "border-green-500/20 bg-green-500/20 text-green-400"
                                : "border-transparent bg-purple-600/20 text-purple-400 hover:bg-purple-600/30"
                        )}
                    >
                        {copied ? <Check size={18} /> : <Link2 size={18} />}
                        <span>{copied ? "Link Copied!" : "Copy Link"}</span>
                    </button>
                </div>

                {/* The two grids being compared */}
                <div className="flex items-stretch gap-2 sm:gap-3">
                    <GridBadge side={a} align="left" />
                    <div className="flex shrink-0 items-center text-lg font-bold text-purple-500 sm:text-2xl">
                        ×
                    </div>
                    <GridBadge side={b} align="right" />
                </div>

                {/* The number */}
                <div className="mt-8 flex flex-col items-center text-center">
                    <div
                        className="bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-[72px] font-black leading-none text-transparent sm:text-[110px]"
                        style={{ textShadow: "0 0 60px rgba(168, 85, 247, 0.25)" }}
                    >
                        {similarity}%
                    </div>
                    <p className="mt-2 flex items-center gap-2 text-sm text-zinc-300 sm:text-base">
                        <Users size={16} className="text-purple-400" />
                        {shared.length} character{shared.length === 1 ? "" : "s"} in common
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
                        {verdictLine(similarity, shared.length)}
                    </p>
                </div>

                <CompareVerdict a={a.id} b={b.id} />

                {/* Shared */}
                {shared.length > 0 && (
                    <section className="mt-10">
                        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-zinc-500">
                            Both of you
                        </h2>
                        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 sm:gap-3 lg:grid-cols-8">
                            {shared.map((pair) => (
                                <Face key={pair.key} character={pair.a} />
                            ))}
                        </div>
                    </section>
                )}

                {/* What each side is missing. Two columns on desktop so the
                    asymmetry is visible at a glance; stacked on a phone, with
                    the other person's picks first because those are the ones
                    worth looking up. */}
                <div className="mt-12 grid gap-8 lg:grid-cols-2">
                    <OnlyColumn
                        heading={`Only in ${b.title}`}
                        note={`${onlyB.length} character${
                            onlyB.length === 1 ? "" : "s"
                        } you have not picked`}
                        characters={onlyB}
                    />
                    <OnlyColumn
                        heading={`Only in ${a.title}`}
                        note={`${onlyA.length} character${
                            onlyA.length === 1 ? "" : "s"
                        } they have not picked`}
                        characters={onlyA}
                    />
                </div>

                <div className="mb-16 mt-12 text-center text-sm text-zinc-500">
                    Want to compare against your own?{" "}
                    <Link href="/" className="text-purple-400 hover:underline">
                        Build a grid
                    </Link>
                </div>
            </div>
        </div>
    );
}
