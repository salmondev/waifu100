"use client";

import { GridCell, AnalysisResult, VerdictFeedback } from "@/types";
import { cn, isGifUrl } from "@/lib/utils";

import Link from "next/link";
import { ArrowLeft, Check, Sparkles, Loader2, Grid3x3, Link2 } from "lucide-react";
import { useState } from "react";
import { AnalysisModal } from "@/components/analysis/AnalysisModal";

interface ViewGridProps {
  grid: GridCell[];
  title?: string;
  verdict?: AnalysisResult | null;
  verdictFeedback?: VerdictFeedback;
  shareId?: string;
}

// Column labels A-J
const COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

export function ViewGrid({ grid, title = "Waifu100 Grid", verdict, verdictFeedback, shareId }: ViewGridProps) {
  const [copied, setCopied] = useState(false);
  const [showVerdict, setShowVerdict] = useState(false);
  const [localVerdict, setLocalVerdict] = useState<AnalysisResult | null>(verdict ?? null);
  const [isGenerating, setIsGenerating] = useState(false);

  const hasGif = grid.some(
    (cell) =>
      isGifUrl(cell.character?.customImageUrl) ||
      isGifUrl(cell.character?.images?.jpg?.image_url)
  );

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleVerdictClick = async () => {
    // If verdict already exists, just show it
    if (localVerdict) {
      setShowVerdict(true);
      return;
    }

    // Generate a new verdict for legacy grids
    const characters = grid
      .filter((cell) => cell.character)
      .map((cell) => cell.character!.name);

    if (characters.length === 0) return;

    setIsGenerating(true);
    try {
      // 1. Call the same analyze API
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterNames: characters }),
      });

      if (!res.ok) throw new Error("Failed to analyze");
      const data = await res.json();

      // 2. Save verdict back to Redis
      if (shareId) {
        await fetch("/api/share/verdict", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shareId, verdict: data }),
        });
      }

      // 3. Update local state and show modal
      setLocalVerdict(data);
      setShowVerdict(true);
    } catch (e) {
      console.error("Failed to generate verdict:", e);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center py-6 sm:py-10 relative">
      {/* Header. Below lg it stacks so the title never sits under the buttons;
          `order` puts the grid's name first on a phone, where it is the only
          thing telling the visitor what they just opened. */}
      <div className="w-full max-w-[1000px] flex flex-col items-stretch gap-4 lg:grid lg:grid-cols-3 lg:items-center lg:gap-0 px-3 sm:px-4 mb-6 sm:mb-8">
         <div className="order-2 lg:order-none flex flex-row lg:flex-col items-center lg:items-start justify-center gap-2">
             {/* Most visitors arrive from the showcase; sending them back there was
                 impossible without the browser's own back button. */}
             <Link
                href="/community"
                className="flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-2 px-3 sm:px-4 py-2 bg-zinc-900 rounded-lg text-sm sm:text-base text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors lg:min-w-[190px]"
             >
                <ArrowLeft size={18} className="shrink-0" />
                <span className="truncate">Community Showcase</span>
             </Link>
             <Link
                href="/"
                className="flex flex-1 lg:flex-none items-center justify-center lg:justify-start gap-2 px-3 sm:px-4 py-2 bg-zinc-900 rounded-lg text-sm sm:text-base text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors lg:min-w-[190px]"
             >
                <Grid3x3 size={18} className="shrink-0" />
                <span className="truncate">Create Your Own</span>
             </Link>
         </div>

         {/* Center Title */}
         <div className="order-1 lg:order-none flex flex-col items-center justify-center gap-2 min-w-0">
             <h1
                className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-transparent px-2 sm:px-4 text-center pb-1 break-words max-w-full"
                style={{
                    textShadow: '0 0 20px rgba(168, 85, 247, 0.4), 0 0 40px rgba(168, 85, 247, 0.2)'
                }}
             >
                 {title}
             </h1>

             {/* Same chip as the showcase card, so a grid keeps its badge when opened. */}
             {hasGif && (
                <span
                   title="This grid contains animated characters"
                   className="gif-badge inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest text-white"
                >
                   <span className="h-1.5 w-1.5 rounded-full bg-white/90 animate-pulse" />
                   GIF
                </span>
             )}
         </div>

         <div className="order-3 lg:order-none flex flex-row lg:flex-col items-center lg:items-end justify-center gap-2">
             <button
                onClick={handleCopyLink}
                className={cn(
                    "flex flex-1 lg:flex-none items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 font-medium text-sm sm:text-base lg:min-w-[140px] justify-center",
                    copied 
                        ? "bg-green-500/20 text-green-400 border border-green-500/20" 
                        : "bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-transparent"
                )}
             >
                 {copied ? <Check size={18} className="shrink-0" /> : <Link2 size={18} className="shrink-0" />}
                 <span className="truncate">{copied ? "Link Copied!" : "Copy Link"}</span>
             </button>

             <button
                onClick={handleVerdictClick}
                disabled={isGenerating}
                className={cn(
                    "flex flex-1 lg:flex-none items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-all duration-200 font-medium text-sm sm:text-base lg:min-w-[140px] justify-center",
                    localVerdict
                        ? "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20"
                        : "bg-gradient-to-r from-yellow-600/20 to-orange-600/20 text-yellow-500 border-yellow-600/30 hover:from-yellow-600/30 hover:to-orange-600/30",
                    isGenerating && "opacity-70 cursor-wait"
                )}
             >
                 {isGenerating ? <Loader2 size={18} className="animate-spin shrink-0" /> : <Sparkles size={18} className="shrink-0" />}
                 <span className="truncate">{isGenerating ? "Generating..." : localVerdict ? "AI Verdict" : "✨ Generate AI Verdict"}</span>
             </button>
         </div>
      </div>

      {/* Grid Container with Row/Column Headers.
          The whole block is fluid: the square is `aspect-square` at whatever
          width the viewport allows, capped at the old 950px so desktop is
          unchanged. The lg:px-6 gutter is where the row/column labels live, so
          their negative offsets never push the page into horizontal scroll. */}
      <div className="w-full max-w-[1000px] px-3 sm:px-4 lg:px-6">
      <div className="relative w-full max-w-[950px] mx-auto">
        {/* Column Headers (A-J). Sized as a matching 10-column grid instead of
            a fixed 95px per label, and dropped below lg where there is no room. */}
        <div className="hidden lg:grid absolute -top-6 inset-x-0 grid-cols-10">
          {COLUMNS.map((col) => (
            <div
              key={col}
              className="text-center text-xs font-medium text-zinc-600/40 select-none"
            >
              {col}
            </div>
          ))}
        </div>

        {/* Row Headers (1-10) */}
        <div className="hidden lg:flex absolute -left-6 top-0 bottom-0 flex-col">
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className="flex-1 flex items-center justify-center text-xs font-medium text-zinc-600/40 select-none"
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-10 grid-rows-10 gap-0 w-full aspect-square border-2 border-zinc-800 bg-black shadow-2xl shadow-purple-900/20">
          {grid.map((cell, idx) => (
            <div
              key={idx}
              className="relative min-w-0 min-h-0 bg-zinc-900/50 border border-zinc-900/50 overflow-hidden group"
            >
              {cell.character ? (
                 <>
                   <img
                      src={(() => {
                              const url = cell.character.customImageUrl || cell.character.images.jpg.image_url;
                              if (url.startsWith('data:') || url.startsWith('blob:') || url.toLowerCase().includes('.gif') || url.includes('vercel-storage.com')) return url;
                              return `/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`;
                      })()}
                      alt={cell.character.name}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                   />
                   {/* Tooltip-like overlay on hover */}
                   <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <p className="text-[10px] font-bold truncate text-white text-center leading-tight">
                          {cell.character.name}
                      </p>
                   </div>
                 </>
              ) : (
                  <div className="w-full h-full flex items-center justify-center opacity-10">
                      <div className="w-2 h-2 rounded-full bg-zinc-700" />
                  </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </div>

      <div className="mt-8 text-zinc-500 text-sm">
         Made with <Link href="/" className="text-purple-400 hover:underline">Waifu100</Link>
      </div>

      <AnalysisModal 
         isOpen={showVerdict}
         onClose={() => setShowVerdict(false)}
         grid={grid}
         result={localVerdict}
         onResult={() => {}} 
         feedback={verdictFeedback ?? null}
         onFeedback={() => {}}
         readonly={true}
      />
    </div>
  );
}
