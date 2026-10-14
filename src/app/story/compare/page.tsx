import type { Metadata } from "next";
import Link from "next/link";
import { readShares } from "@/lib/share-store";
import { compareStoryGrids } from "@/lib/story/compare";
import { MediaGrid } from "@/components/grid/MediaGrid";
import { STORY_BRAND, storyColumns, storyViewPath } from "@/lib/story/config";
import type { StoryItem } from "@/lib/share-schema";
import { proxied } from "@/lib/img-proxy";

interface Props {
    searchParams: Promise<{ a?: string; b?: string }>;
}

export const metadata: Metadata = { title: `Compare story grids | ${STORY_BRAND}` };

/** Story-vs-story compare (item 5). Same kind only: anything else is "not found". */
export default async function StoryComparePage({ searchParams }: Props) {
    const { a = "", b = "" } = await searchParams;
    const [A, B] = await readShares([a, b]).catch(() => [null, null]);
    if (!A || !B || A.kind !== "story" || B.kind !== "story" || a === b) {
        return (
            <main className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center p-6 text-center">
                <div className="space-y-3">
                    <p>These two story grids can&apos;t be compared (missing, the same, or not story grids).</p>
                    <Link className="text-purple-300 underline" href="/community?kind=story">Back to the showcase</Link>
                </div>
            </main>
        );
    }
    const r = compareStoryGrids(A.items, B.items);
    const toCell = (i: StoryItem) => ({ key: `${i.src ?? "anilist"}-${i.type}-${i.id}`, image: i.cover, label: i.title });
    return (
        <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <header className="text-center space-y-1">
                    <p className="text-xs uppercase tracking-widest text-purple-300">{STORY_BRAND} compare</p>
                    <h1 className="text-2xl font-bold">{A.title} × {B.title}</h1>
                    <p className="text-3xl font-bold text-purple-300">{r.similarity}% match</p>
                    <p className="text-sm text-zinc-500">{r.shared.length} titles in common</p>
                </header>
                {r.shared.length > 0 && (
                    <ul className="flex flex-wrap gap-3 justify-center">
                        {r.shared.map((s) => (
                            <li key={`${s.item.type}-${s.item.id}`} className="w-24 text-center text-[11px]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={proxied(s.item.cover, 160)} alt={s.item.title} className="w-24 aspect-[2/3] object-cover rounded" />
                                <span className="block truncate">{s.item.title}</span>
                                <span className="text-zinc-500">#{s.rankA} vs #{s.rankB}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="grid md:grid-cols-2 gap-6">
                    {[{ s: A, id: a }, { s: B, id: b }].map(({ s, id }) => (
                        <section key={id} className="space-y-2">
                            <Link href={storyViewPath(id)} className="font-semibold hover:text-purple-300">{s.title}</Link>
                            <MediaGrid items={s.items} columns={storyColumns(s.size)} toCell={toCell} />
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
