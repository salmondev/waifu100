"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { GridCard } from "@/components/community/GridCard";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { ShareSummary } from "@/lib/share-summary";
import { USER_ID_HEADER, ensureUserId } from "@/lib/user-id";

export default function MyGridsFeed() {
    const [grids, setGrids] = useState<ShareSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<ShareSummary | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        const userId = ensureUserId();
        if (!userId) {
            // localStorage blocked: there is no way to know which grids are
            // theirs, and no server-side account to fall back on.
            setError("This browser blocks local storage, so it can't remember which grids are yours.");
            setLoading(false);
            return;
        }
        try {
            const res = await fetch("/api/my-grids", { headers: { [USER_ID_HEADER]: userId } });
            if (!res.ok) throw new Error("Request failed");
            const data = await res.json();
            setGrids(data.grids ?? []);
        } catch (e) {
            console.error("Failed to fetch my grids", e);
            setError("Couldn't load your grids. Try again in a moment.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const confirmDelete = async () => {
        const target = pendingDelete;
        setPendingDelete(null);
        if (!target) return;

        const userId = ensureUserId();
        if (!userId) return;

        setDeletingId(target.id);
        try {
            const res = await fetch(`/api/share/${target.id}`, {
                method: "DELETE",
                headers: { [USER_ID_HEADER]: userId },
            });
            if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
            // 404 means it is already gone, which is the state we wanted anyway.
            setGrids((prev) => prev.filter((g) => g.id !== target.id));
        } catch (e) {
            console.error("Failed to delete grid", e);
            setError("Couldn't delete that grid. Try again in a moment.");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
            {/* Background Gradients */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full mix-blend-screen" />
                <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
            </div>

            <div className="relative z-10 container mx-auto px-4 py-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
                    <div className="flex items-center gap-4">
                        <Link
                            href="/"
                            className="p-2 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-full transition-all group shrink-0"
                        >
                            <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                        </Link>
                        <div>
                            <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 pb-1">
                                My Grids
                            </h1>
                            <p className="text-zinc-500 mt-1">
                                Grids shared from this browser. Only you can delete them.
                            </p>
                        </div>
                    </div>

                    <Link
                        href="/community"
                        className="self-start md:self-auto inline-flex items-center gap-2 px-4 py-2 bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-sm text-zinc-300 transition-colors"
                    >
                        <Users className="w-4 h-4 text-indigo-400" />
                        Community Showcase
                    </Link>
                </div>

                {error && (
                    <div className="mb-6 px-4 py-3 rounded-xl border border-red-900/50 bg-red-950/30 text-red-300 text-sm">
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40">
                        <Loader2 className="w-12 h-12 text-purple-500 animate-spin mb-4" />
                        <p className="text-zinc-500 animate-pulse">Looking up your grids...</p>
                    </div>
                ) : grids.length === 0 ? (
                    <div className="text-center py-20 bg-zinc-900/30 rounded-3xl border border-zinc-800/50 px-6">
                        <p className="text-zinc-400 text-lg">You haven&apos;t shared a grid from this browser yet.</p>
                        {/* Worth saying out loud: ownership is per-browser by
                            design, so a grid made on a phone won't show up here. */}
                        <p className="text-zinc-600 text-sm mt-2 max-w-md mx-auto">
                            Grids are remembered per browser, so anything you shared on another
                            device or before clearing site data won&apos;t appear here.
                        </p>
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors"
                        >
                            Create a Grid
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {grids.map((grid) => (
                            <GridCard
                                key={grid.id}
                                grid={grid}
                                onDelete={() => setPendingDelete(grid)}
                                deleting={deletingId === grid.id}
                            />
                        ))}
                    </div>
                )}
            </div>

            <ConfirmModal
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
                title="Delete this grid?"
                message={`"${pendingDelete?.title ?? ""}" will be removed from the Community Showcase and its share link will stop working. This can't be undone.`}
                confirmText="Delete Grid"
                variant="danger"
            />
        </div>
    );
}
