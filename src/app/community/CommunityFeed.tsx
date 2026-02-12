"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Calendar, User, ExternalLink } from "lucide-react";

interface CommunityGrid {
  id: string;
  title: string;
  imageUrl: string | null;
  createdAt: string;
}

export default function CommunityFeed() {
  const [grids, setGrids] = useState<CommunityGrid[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCommunity() {
      try {
        const res = await fetch("/api/community");
        const data = await res.json();
        if (data.grids) {
          setGrids(data.grids);
        }
      } catch (e) {
        console.error("Failed to fetch community grids", e);
      } finally {
        setLoading(false);
      }
    }
    fetchCommunity();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-purple-900/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-12 gap-6">
          <div className="flex items-center gap-4 self-start md:self-auto">
            <Link 
              href="/"
              className="p-2 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-full transition-all group"
            >
              <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white" />
            </Link>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 pb-1">
                Community Showcase
              </h1>
              <p className="text-zinc-500 mt-1">
                Discover curated collections from the Waifu100 community.
              </p>
            </div>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-40">
            <Loader2 className="w-12 h-12 text-purple-500 animate-spin mb-4" />
            <p className="text-zinc-500 animate-pulse">Loading amazing collections...</p>
          </div>
        ) : grids.length === 0 ? (
          <div className="text-center py-20 bg-zinc-900/30 rounded-3xl border border-zinc-800/50">
            <p className="text-zinc-500 text-lg">No grids found yet. Be the first to share one!</p>
            <Link 
              href="/"
              className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium transition-colors"
            >
              Create a Grid
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {grids.map((grid) => (
              <Link 
                key={grid.id} 
                href={`/view/${grid.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden hover:border-purple-500/50 hover:shadow-2xl hover:shadow-purple-900/20 transition-all duration-300 hover:-translate-y-1 block h-fit"
              >
                {/* Image Container */}
                <div className="aspect-square relative overflow-hidden bg-zinc-950">
                    {grid.imageUrl ? (
                        <>
                           {/* Blur Backlayer */}
                           <img 
                                src={grid.imageUrl} 
                                alt="" 
                                className="absolute inset-0 w-full h-full object-cover blur-xl opacity-50 scale-110" 
                           />
                           {/* Main Image */}
                           <img 
                                src={grid.imageUrl} 
                                alt={grid.title} 
                                className="relative w-full h-full object-contain z-10 transition-transform duration-500 group-hover:scale-105" 
                           />
                        </>
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 bg-zinc-900/50">
                            <span className="text-4xl mb-2 opacity-20">?</span>
                            <span className="text-xs font-medium uppercase tracking-wider opacity-50">No Preview</span>
                        </div>
                    )}
                    
                    {/* Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-60 group-hover:opacity-40 transition-opacity z-20" />
                    
                    {/* View Button Overlay on Hover */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 z-30 bg-black/20 backdrop-blur-[2px]">
                        <span className="px-5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 backdrop-blur-md rounded-full text-white font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 shadow-xl">
                             View Grid <ExternalLink className="w-4 h-4" />
                        </span>
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 relative z-20 bg-zinc-900/80 backdrop-blur-sm border-t border-white/5">
                  <h3 className="font-bold text-lg text-white truncate group-hover:text-purple-300 transition-colors" title={grid.title}>
                    {grid.title || "Untitled Grid"}
                  </h3>
                  
                  <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
                    <div className="flex items-center gap-1.5">
                       <Calendar className="w-3.5 h-3.5" />
                       <span>
                       {new Date(grid.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                       })}
                       </span>
                    </div>
                    {/* ID Badge */}
                    <span className="font-mono bg-zinc-800 px-1.5 py-0.5 rounded text-[9px] text-zinc-600 uppercase tracking-widest">
                        {grid.id.slice(0, 5)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
