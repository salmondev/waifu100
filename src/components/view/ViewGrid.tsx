"use client";

import { GridCell, AnalysisResult, VerdictFeedback } from "@/types";
import { cn } from "@/lib/utils";

import Link from "next/link";
import { Copy, ArrowLeft, Check, Sparkles, Loader2 } from "lucide-react";
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
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center py-10 relative">
      {/* Header */}
      <div className="w-full max-w-[1000px] grid grid-cols-3 items-center px-4 mb-8">
         <div className="flex items-center justify-start">
             <Link 
                href="/"
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
             >
                <ArrowLeft size={20} />
                <span>Create Your Own</span>
             </Link>
         </div>
         
         {/* Center Title */}
         <div className="flex items-center justify-center">
             <h1 
                className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-purple-400 bg-clip-text text-transparent px-4 text-center pb-1"
                style={{
                    textShadow: '0 0 20px rgba(168, 85, 247, 0.4), 0 0 40px rgba(168, 85, 247, 0.2)'
                }}
             >
                 {title}
             </h1>
         </div>

         <div className="flex flex-col items-end justify-center gap-2">
             <button
                onClick={handleCopyLink}
                className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 font-medium min-w-[140px] justify-center",
                    copied 
                        ? "bg-green-500/20 text-green-400 border border-green-500/20" 
                        : "bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-transparent"
                )}
             >
                 {copied ? <Check size={18} /> : <Copy size={18} />}
                 <span>{copied ? "Copied!" : "Share Linked"}</span>
             </button>

             <button
                onClick={handleVerdictClick}
                disabled={isGenerating}
                className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all duration-200 font-medium min-w-[140px] justify-center",
                    localVerdict
                        ? "bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 border-yellow-500/20"
                        : "bg-gradient-to-r from-yellow-600/20 to-orange-600/20 text-yellow-500 border-yellow-600/30 hover:from-yellow-600/30 hover:to-orange-600/30",
                    isGenerating && "opacity-70 cursor-wait"
                )}
             >
                 {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                 <span>{isGenerating ? "Generating..." : localVerdict ? "AI Verdict" : "✨ Generate AI Verdict"}</span>
             </button>
         </div>
      </div>

      {/* Grid Container with Row/Column Headers */}
      <div className="relative">
        {/* Column Headers (A-J) */}
        <div className="absolute -top-6 left-6 right-0 flex">
          {COLUMNS.map((col) => (
            <div 
              key={col} 
              className="w-[95px] text-center text-xs font-medium text-zinc-600/40 select-none"
            >
              {col}
            </div>
          ))}
        </div>

        {/* Row Headers (1-10) */}
        <div className="absolute -left-6 top-0 bottom-0 flex flex-col">
          {Array.from({ length: 10 }, (_, i) => (
            <div 
              key={i} 
              className="h-[95px] flex items-center justify-center text-xs font-medium text-zinc-600/40 select-none"
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div 
          className="grid grid-cols-10 grid-rows-10 gap-0 border-2 border-zinc-800 bg-black shadow-2xl shadow-purple-900/20"
          style={{ width: '950px', height: '950px' }}
        >
          {grid.map((cell, idx) => (
            <div 
              key={idx}
              className="relative w-[95px] h-[95px] bg-zinc-900/50 border border-zinc-900/50 overflow-hidden group"
            >
              {cell.character ? (
                 <>
                   <img
                      src={(() => {
                              const url = cell.character.customImageUrl || cell.character.images.jpg.image_url;
                              if (url.startsWith('data:') || url.startsWith('blob:') || url.toLowerCase().includes('.gif')) return url;
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
