import { useEffect, useState } from "react";
import { X, Copy, Check, Twitter, Link as LinkIcon, AlertCircle, Loader2, Share2, ImageIcon } from "lucide-react";
import { GridCell } from "@/types";
import { cn } from "@/lib/utils";
import { upload } from '@vercel/blob/client';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: GridCell[];
  onCapture: (filename: string) => Promise<Blob | null>;
}

export function ShareModal({ isOpen, onClose, grid, onCapture }: ShareModalProps) {
  const [step, setStep] = useState<'customize' | 'result'>('customize');
  const [customTitle, setCustomTitle] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingState, setLoadingState] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
        setStep('customize');
        setCustomTitle("My 100 Favorite Characters"); // Default
        setUrl("");
        setError(null);
        setLoadingState("");
    }
  }, [isOpen]);

  const handleGenerateLink = async () => {
     const hasData = grid.some(c => c.character);
     if (!hasData) {
         setError("Go add some characters first!");
         return;
     }

     if (!customTitle.trim()) {
         setError("Please enter a title for your grid.");
         return;
     }

     setIsLoading(true);
     setError(null);

     try {
         // 1. Capture Grid Image if possible
         let imageUrl: string | undefined = undefined;
         if (onCapture) {
             setLoadingState("Capturing grid image...");
             const blob = await onCapture('share_thumbnail.png');
             if (blob) {
                 setLoadingState("Uploading thumbnail...");
                 try {
                    const { url } = await upload('shares/thumbnails/thumb.png', blob, {
                        access: 'public',
                        handleUploadUrl: '/api/upload',
                    });
                    imageUrl = url;
                 } catch (e) {
                    console.error("Thumbnail upload failed", e);
                 }
             }
         }

         setLoadingState("Processing images...");
         
         // 2. Prepare Data & Upload Custom Images
         const gridData = await Promise.all(grid.map(async (cell, idx) => {
              if (!cell.character) return null;

              let finalImg = cell.character.images.jpg.image_url;
              let finalCustomImg = cell.character.customImageUrl;

              // Helper for client-side upload
              const uploadAsset = async (base64OrUrl: string, name: string) => {
                  if (base64OrUrl.startsWith('data:')) {
                      // Convert base64 to Blob
                      const res = await fetch(base64OrUrl);
                      const blob = await res.blob();
                      const { url } = await upload(`shares/assets/${name}.png`, blob, {
                          access: 'public',
                          handleUploadUrl: '/api/upload',
                      });
                      return url;
                  }
                  return base64OrUrl;
              };

              try {
                  if (finalImg && finalImg.startsWith('data:')) {
                      finalImg = await uploadAsset(finalImg, `img-${idx}-${Date.now()}`);
                  }
                  if (finalCustomImg && finalCustomImg.startsWith('data:')) {
                      finalCustomImg = await uploadAsset(finalCustomImg, `custom-${idx}-${Date.now()}`);
                  }
              } catch (e) {
                  console.error("Asset upload failed", e);
                  // If upload fails, we might still fail on payload size, but we try sending anyway 
                  // or we could nullify it to save the rest of the grid.
              }

              return {
                i: idx,
                m: cell.character.mal_id,
                n: cell.character.name,
                img: finalImg,
                c_img: finalCustomImg,
                s: cell.character.source
              };
          }));

         const cleanGridData = gridData.filter(Boolean);

         // 3. Send Lightweight Payload
         setLoadingState("Saving...");
         const res = await fetch("/api/share", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ 
                grid: cleanGridData, 
                customTitle: customTitle.trim(), 
                meta: {
                    title: customTitle.trim(),
                    createdAt: new Date().toISOString()
                },
                imageUrl: imageUrl // Send URL, not base64
             })
         });

         if (!res.ok) throw new Error("Failed to save");
         
         const data = await res.json();
         const fullUrl = `${window.location.origin}/view/${data.id}`;
         setUrl(fullUrl);
         setStep('result');
     } catch (e) {
         console.error(e);
         setError("Failed to create share link. Try again.");
     } finally {
         setIsLoading(false);
         setLoadingState("");
     }
  };

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const socialShare = () => {
      if (!url) return;
      
      const hashtags = "Waifu100,CHALLENGEอายุน้อยร้อยเมน";
      // Removed manual #Waifu100 to avoid duplication
      const text = encodeURIComponent(`Check out my "${customTitle}" grid!`); 
      const shareUrl = encodeURIComponent(url);
      
      const target = `https://twitter.com/intent/tweet?url=${shareUrl}&text=${text}&hashtags=${hashtags}`;
      
      window.open(target, '_blank', 'width=600,height=400');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Decor: Top Gradient Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500" />

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors p-2 rounded-full hover:bg-zinc-800"
        >
          <X size={20} />
        </button>

        <div className="p-6 pt-8 text-center">
            <div className="inline-flex items-center justify-center p-3 bg-zinc-800 rounded-full mb-4 shadow-inner">
                <Share2 className="w-6 h-6 text-pink-500" />
            </div>

            <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-2">
                Share Your Grid
            </h2>
        
            {step === 'customize' ? (
                <>
                    <p className="text-zinc-500 text-sm mb-6">
                        Name your grid to create a clean, shareable link.
                    </p>

                    <div className="space-y-4">
                        <div className="text-left">
                            <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider ml-1">Grid Title</label>
                            <input 
                                type="text"
                                value={customTitle}
                                onChange={(e) => setCustomTitle(e.target.value)}
                                maxLength={50}
                                className="w-full mt-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 placeholder-zinc-600 transition-all"
                                placeholder="e.g. My Anime Harem"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <div className="p-3 bg-red-900/20 text-red-400 rounded-xl text-sm flex items-center gap-2 border border-red-900/50">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <button 
                            onClick={handleGenerateLink}
                            disabled={isLoading}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl font-bold text-white hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100 shadow-lg shadow-pink-900/20"
                        >
                            {isLoading ? <Loader2 className="animate-spin w-4 h-4"/> : <LinkIcon className="w-4 h-4"/>}
                            {isLoading ? (loadingState || "Generating...") : "Generate Link"}
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p className="text-zinc-500 text-sm mb-6">
                        Your clean link is ready!
                    </p>

                    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center gap-2 relative group mb-6 text-left">
                        <div className="flex-1 overflow-hidden">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">Your Link</p>
                            <p className="text-base text-pink-400 font-mono truncate">{url}</p>
                        </div>
                        <button 
                            onClick={handleCopy}
                            className={cn(
                                "py-2 px-4 rounded-lg transition-all font-medium flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white shrink-0 text-sm text-nowrap",
                                copied && "bg-green-500/20 text-green-400"
                            )}
                            title="Copy Link"
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? "Copied" : "Copy Link"}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                        <button 
                            onClick={() => socialShare()}
                            className="flex items-center justify-between px-6 bg-black hover:bg-zinc-800 border border-zinc-800 text-white py-4 rounded-xl transition-colors font-bold text-lg hover:border-zinc-600 shadow-lg shadow-blue-500/10 group"
                        >
                            {/* X Logo */}
                            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-white" aria-hidden="true">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                            </svg>
                            
                            <span>Post on X</span>

                            <Twitter size={24} className="text-[#1D9BF0] group-hover:scale-110 transition-transform" />
                        </button>
                    </div>
                </>
            )}
        </div>
      </div>
    </div>
  );
}

