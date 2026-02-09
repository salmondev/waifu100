import { useEffect, useState } from "react";
import { X, Sparkles, AlertCircle, Quote, Languages, Copy, ThumbsUp, ThumbsDown, Check, Image as ImageIcon, Download } from "lucide-react";
import { GridCell, AnalysisResult, VerdictFeedback } from "@/types";
import { cn } from "@/lib/utils";
import { toBlob } from "html-to-image";

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: GridCell[];
  result: AnalysisResult | null;
  onResult: (result: AnalysisResult | null) => void;
  feedback: VerdictFeedback;
  onFeedback: (feedback: VerdictFeedback) => void;
}

export function AnalysisModal({ isOpen, onClose, grid, result, onResult, feedback, onFeedback }: AnalysisModalProps) {
  const [loading, setLoading] = useState(false);
  // Remove local result state
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'th'>('en');

  useEffect(() => {
    if (isOpen && !result && !loading) {
      handleAnalyze();
    }
  }, [isOpen]);

  const handleAnalyze = async () => {
    const characters = grid
      .filter((cell) => cell.character)
      .map((cell) => cell.character!.name);

    if (characters.length === 0) {
      setError("Add some characters first! I can't judge an empty grid (though that is a mood in itself).");
      return;
    }

    setLoading(true);
    setError(null);
    onResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterNames: characters }),
      });

      if (!res.ok) {
        throw new Error("Failed to analyze");
      }

      const data = await res.json();
      onResult(data);
    } catch (e) {
      console.error(e);
      setError("Something went wrong. The AI needed a break. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Decor: Top Gradient Line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500" />

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors p-2 rounded-full hover:bg-zinc-800 z-10"
        >
          <X size={20} />
        </button>

        <div className="p-6 pt-12 text-center min-h-[400px] flex flex-col justify-center">
            
            {(loading || (!result && !error)) && (
                <div className="flex flex-col items-center justify-center gap-6 animate-pulse mt-10">
                     <div className="p-4 bg-zinc-800/50 rounded-full ring-1 ring-zinc-700">
                        <Sparkles className="w-8 h-8 text-yellow-500 animate-spin-slow" />
                     </div>
                     <div>
                        <h3 className="text-xl font-bold text-white mb-2">Reading Your Vibes...</h3>
                        <p className="text-zinc-500">Analyzing your favorites to discover your true character archetype.</p>
                     </div>
                </div>
            )}

            {error && !loading && (
                <div className="flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
                    <div className="p-4 bg-red-900/20 text-red-500 rounded-full border border-red-900/50">
                        <AlertCircle className="w-8 h-8" />
                    </div>
                    <p className="text-red-400 font-medium">{error}</p>
                    <button 
                        onClick={handleAnalyze}
                        className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white font-medium transition-colors border border-zinc-700"
                    >
                        Try Again
                    </button>
                </div>
            )}

            {result && !loading && (
                <div id="ai-verdict-card" className="space-y-6 animate-in slide-in-from-bottom-4 duration-700 ease-out p-4 bg-zinc-900 rounded-xl">
                    {/* Header Badge & Lang Toggle */}
                    <div className="flex items-center justify-center gap-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-full text-xs font-bold uppercase tracking-wider border border-yellow-500/20 shadow-sm shadow-yellow-500/10">
                            <Sparkles size={12} />
                            <div>AI Verdict</div>
                        </div>
                        
                        <div className="flex items-center bg-zinc-950 rounded-full p-1 border border-zinc-800 shadow-inner">
                            <button 
                                onClick={() => setLang('en')}
                                className={cn(
                                    "px-4 py-1.5 rounded-full text-[10px] sm:text-xs font-bold transition-all min-w-[48px]",
                                    lang === 'en' ? "bg-zinc-700 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-400"
                                )}
                            >
                                EN
                            </button>
                            <button 
                                onClick={() => setLang('th')}
                                className={cn(
                                    "px-4 py-1.5 rounded-full text-[10px] sm:text-xs font-bold transition-all min-w-[48px]",
                                    lang === 'th' ? "bg-gradient-to-r from-blue-600 to-red-600 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-400"
                                )}
                            >
                                TH
                            </button>
                        </div>
                    </div>

                    {/* Main Title */}
                    <div className="relative min-h-[80px] flex items-center justify-center">
                        <h2 className="text-3xl md:text-4xl font-black italic text-transparent bg-clip-text bg-gradient-to-br from-white via-zinc-200 to-zinc-400 drop-shadow-sm px-4 py-2 leading-relaxed">
                            &quot;{lang === 'en' ? result.en.title : result.th.title}&quot;
                        </h2>
                    </div>

                    {/* Emoji Circle (Replaces Score) */}
                    <div className="flex justify-center my-6 relative group cursor-default">
                        <div className="relative w-32 h-32 rounded-full flex flex-col items-center justify-center border-4 border-zinc-800 shadow-xl bg-zinc-900/50 backdrop-blur-sm shadow-purple-500/20 group-hover:border-purple-500/50 transition-colors duration-500">
                            <span className="text-6xl animate-in zoom-in duration-500 delay-150 filter drop-shadow-lg">{result.emoji}</span>
                            
                            {/* Floating Badge */}
                            <div className="absolute -bottom-3 px-3 py-1 bg-zinc-950 text-[9px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-800 rounded-full shadow-lg whitespace-nowrap">
                                Vibe Check
                            </div>
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap justify-center gap-2 px-4">
                        {(lang === 'en' ? result.en.tags : result.th.tags).map((tag, i) => (
                           <span key={i} className="px-3 py-1 bg-zinc-800/80 border border-zinc-700/50 rounded-full text-xs text-zinc-300 font-medium">
                              {tag}
                           </span>
                        ))}
                    </div>

                    {/* Analysis Body */}
                    <div className="bg-zinc-950/50 p-6 rounded-2xl border border-zinc-800/80 text-left relative mx-2 group hover:border-zinc-700 transition-colors">
                        <Quote className="absolute -top-3 -left-2 w-8 h-8 text-zinc-800 rotate-180 fill-zinc-900" />
                        <Quote className="absolute -bottom-3 -right-2 w-8 h-8 text-zinc-800 fill-zinc-900" />
                        <p className="text-zinc-300 leading-relaxed relative z-10 italic text-lg text-center font-medium min-h-[100px] flex items-center justify-center">
                            {lang === 'en' ? result.en.content : result.th.content}
                        </p>
                    </div>



                    {/* Action Buttons */}
                    <div id="verdict-actions" className="flex flex-wrap justify-center items-center gap-3 mt-8 pb-2">
                        <ActionButton 
                            icon={ThumbsUp} 
                            label="Agree" 
                            onClick={() => onFeedback(feedback === 'agree' ? null : 'agree')}
                            hoverColor="hover:text-green-400 hover:border-green-500/30 hover:bg-green-900/20"
                            forceActive={feedback === 'agree'}
                            activeColor="text-green-400 border-green-500/30 bg-green-900/20"
                        />
                        <ActionButton 
                            icon={ThumbsDown} 
                            label="Disagree" 
                            onClick={() => onFeedback(feedback === 'disagree' ? null : 'disagree')}
                            hoverColor="hover:text-red-400 hover:border-red-500/30 hover:bg-red-900/20"
                            forceActive={feedback === 'disagree'}
                            activeColor="text-red-400 border-red-500/30 bg-red-900/20"
                        />
                        <div className="w-px h-6 bg-zinc-800 mx-1 hidden sm:block"></div>
                        <ActionButton 
                            icon={Copy} 
                            label="Copy Text" 
                            onClick={() => {
                                const text = `AI Verdict: "${lang === 'en' ? result.en.title : result.th.title}"\n\n${lang === 'en' ? result.en.content : result.th.content}\n\nVibe: ${result.emoji}\nTags: ${lang === 'en' ? result.en.tags.join(' ') : result.th.tags.join(' ')}`;
                                navigator.clipboard.writeText(text);
                            }}
                            successIcon={Check}
                        />
                         <ActionButton 
                            icon={ImageIcon} 
                            label="Copy Image" 
                            onClick={async () => {
                                const node = document.getElementById('ai-verdict-card');
                                if (node) {
                                    try {
                                        const blob = await toBlob(node, { 
                                            backgroundColor: '#09090b', 
                                            style: { padding: '20px' },
                                            filter: (node) => node.id !== 'verdict-actions' 
                                        });
                                        if (blob) {
                                            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                                        }
                                    } catch (e) { console.error(e); }
                                }
                            }}
                            successIcon={Check}
                        />
                        <ActionButton 
                            icon={Download} 
                            label="Save Image"
                            onClick={async () => {
                                const node = document.getElementById('ai-verdict-card');
                                if (node) {
                                    try {
                                        const blob = await toBlob(node, { 
                                            backgroundColor: '#09090b', 
                                            style: { padding: '20px' },
                                            filter: (node) => node.id !== 'verdict-actions'
                                        });
                                        if (blob) {
                                            const url = URL.createObjectURL(blob);
                                            const link = document.createElement('a');
                                            link.download = `waifu100-verdict-${Date.now()}.png`;
                                            link.href = url;
                                            link.click();
                                            URL.revokeObjectURL(url);
                                        }
                                    } catch (e) { console.error(e); }
                                }
                            }}
                        />
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}

interface ActionButtonProps {
    icon: React.ElementType;
    label: string;
    onClick?: () => void;
    hoverColor?: string;
    successIcon?: React.ElementType;
    forceActive?: boolean;
    activeColor?: string;
}

function ActionButton({ icon: Icon, label, onClick, hoverColor = "hover:text-zinc-300 hover:border-zinc-500/50 hover:bg-zinc-700", successIcon: SuccessIcon, forceActive, activeColor }: ActionButtonProps) {
    const [clicked, setClicked] = useState(false);
    
    const handleClick = () => {
        if (onClick) onClick();
        if (SuccessIcon) { // Only animate click for success actions (like copy)
            setClicked(true);
            setTimeout(() => setClicked(false), 2000);
        }
    };

    const isActive = forceActive || clicked;

    return (
        <button 
            onClick={handleClick}
            className={cn(
                "flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-lg text-xs font-medium text-zinc-400 transition-all border border-zinc-700/50 group",
                hoverColor,
                isActive && (activeColor || (SuccessIcon && "text-green-400 border-green-500/30 bg-green-900/20"))
            )}
        >
            {clicked && SuccessIcon ? <SuccessIcon size={14} /> : <Icon size={14} className="group-hover:scale-110 transition-transform" />}
            {clicked && SuccessIcon ? "Copied!" : label}
        </button>
    );
}
