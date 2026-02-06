"use client";

import { GridCell } from "@/types";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { Copy, ArrowLeft, Check } from "lucide-react";
import { useState } from "react";

interface ViewGridProps {
  grid: GridCell[];
  title?: string;
}

export function ViewGrid({ grid, title = "Waifu100 Grid" }: ViewGridProps) {
  // We can add "Click to view details" modal here later if needed
  // For now, it's a static high-fidelity render
  
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
        navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
         
         <div className="flex flex-col items-center justify-center">
             <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent px-4 text-center pb-1">
                 {title}
             </h1>
             {title !== "Waifu100 Grid" && (
                 <p className="text-zinc-400 font-medium text-sm mt-1 max-w-[400px] truncate">
                     Waifu100 Grid
                 </p>
             )}
         </div>

         <div className="flex items-center justify-end">
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
         </div>
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
                 <Image
                    src={cell.character.images.jpg.image_url}
                    alt={cell.character.name}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-110"
                    unoptimized // Allow external URLs
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

      <div className="mt-8 text-zinc-500 text-sm">
         Made with <Link href="/" className="text-purple-400 hover:underline">Waifu100</Link>
      </div>
    </div>
  );
}
