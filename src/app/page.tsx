"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, X, Trash2, Loader2, Sparkles, ChevronRight, ChevronLeft, ExternalLink, ImageIcon, Images, Grid3X3, Lightbulb, GripVertical, HelpCircle, Upload, Link } from "lucide-react";
import { toPng } from "html-to-image";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Character {
  mal_id: number;
  jikan_id?: number | null; // ID specific to Jikan (MyAnimeList)
  name: string;
  images: {
    jpg: {
      image_url: string;
    };
  };
  customImageUrl?: string;
  source?: string;
}

interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

interface GridCell {
  character: Character | null;
}

interface Suggestion {
  name: string;
  from: string;
  reason: string;
}

// --- Hooks ---
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const STORAGE_KEY = "waifu100-grid";

export default function Home() {
  // --- State: Grid ---
  const [grid, setGrid] = useState<GridCell[]>(() =>
    Array(100).fill(null).map(() => ({ character: null }))
  );
  
  // --- State: Search (Left Panel) ---
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 500); 
  const [characterResults, setCharacterResults] = useState<Character[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);

  // --- State: Right Panel (Gallery & Suggestions) ---
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'gallery'>('suggestions');
  
  // Gallery State
  const [galleryImages, setGalleryImages] = useState<ImageResult[]>([]);
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [galleryTargetName, setGalleryTargetName] = useState<string>("");

  // Suggestions State
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  // --- State: Drag & Drop ---
  const [draggedCharacter, setDraggedCharacter] = useState<Character | null>(null);
  const [draggedFromIndex, setDraggedFromIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [lastDroppedIndex, setLastDroppedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [isExporting, setIsExporting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  
  // --- State: URL Modal ---
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);

  // --- Persistence ---
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setGrid(JSON.parse(saved)); } catch (e) { console.error(e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(grid));
  }, [grid]);

  // --- Search Logic (Character Discovery) ---
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      // Don't clear immediately to avoid flickering if user is typing
      if (searchQuery === "") setCharacterResults([]); 
      return;
    }

    const doSearch = async () => {
      setIsSearching(true);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterName: debouncedQuery })
        });
        if (res.ok) {
           const data = await res.json();
           const mapped: Character[] = (data.characters || []).map((c: any) => ({
              mal_id: c.id, 
              jikan_id: c.jikan_id,
              name: c.name,
              images: c.images,
              source: c.source
           }));
           setCharacterResults(mapped);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    };
    doSearch();
  }, [debouncedQuery]);

  // --- Gallery Logic ---
  const openGallery = useCallback(async (char: Character) => {
    setShowRightPanel(true);
    setActiveTab('gallery');
    setGalleryTargetName(char.name);
    setGalleryImages([]);
    
    // Check if we need to load unique images for this char
    // (If user clicks same char, maybe don't reload? But explicit click usually implies refresh)
    setIsGalleryLoading(true);
    setSelectedCharacter(char);

    try {
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            characterName: char.name, 
            animeSource: char.source,
            malId: char.jikan_id 
        })
      });
      if (res.ok) {
        const data = await res.json();
        setGalleryImages(data.images || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGalleryLoading(false);
    }
  }, []);

  // --- Suggestions Logic ---
  const handleGetSuggestions = async () => {
    const names = grid.filter(c => c.character).map(c => c.character!.name);
    if (names.length < 2) {
       setSuggestionsError("Add at least 2 characters to get suggestions!");
       return;
    }
    
    setIsSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
       const res = await fetch("/api/suggest", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ characterNames: names })
       });
       if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions || []);
       } else {
          throw new Error("Failed to get suggestions");
       }
    } catch (e) {
       setSuggestionsError("AI could not generate suggestions.");
    } finally {
       setIsSuggestionsLoading(false);
    }
  };


  const handleApplySuggestion = (suggestion: Suggestion) => {
      // Fill the search bar and trigger search
      setSearchQuery(`${suggestion.name} ${suggestion.from}`);
      // The useEffect will pick this up and search
  };

  // --- Selection Logic ---
  const handleSelectCharacter = (char: Character) => {
    setSelectedCharacter(char);
  };
  
  const handleCellClick = (index: number) => {
    if (selectedCharacter) {
      setGrid(prev => {
        const next = [...prev];
        next[index] = { character: selectedCharacter };
        return next;
      });
    }
  };

  // --- Drag & Drop Handlers ---
  const handleDragStartFromSearch = (e: React.DragEvent, char: Character) => {
    setDraggedCharacter(char);
    setDraggedFromIndex(null);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragStartFromGallery = (e: React.DragEvent, img: ImageResult) => {
    const char: Character = {
       mal_id: Date.now() + Math.floor(Math.random() * 10000),
       name: galleryTargetName || "Character",
       images: { jpg: { image_url: img.url } },
       customImageUrl: img.url
    };
    setDraggedCharacter(char);
    setDraggedFromIndex(null);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragStartFromGrid = (e: React.DragEvent, index: number, char: Character) => {
    setDraggedCharacter(char);
    setDraggedFromIndex(index);
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
    e.dataTransfer.dropEffect = draggedFromIndex !== null ? "move" : "copy";
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(null);

    if (draggedCharacter) {
       setGrid(prev => {
         const next = [...prev];
         if (draggedFromIndex !== null) {
            const targetChar = next[index].character;
            next[index] = { character: draggedCharacter };
            next[draggedFromIndex] = { character: targetChar };
         } else {
            next[index] = { character: draggedCharacter };
         }
         return next;
       });
       // Trigger drop animation
       setLastDroppedIndex(index);
       setTimeout(() => setLastDroppedIndex(null), 300);
    }
    setDraggedCharacter(null);
    setDraggedFromIndex(null);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.dataTransfer.dropEffect === "none" && draggedFromIndex !== null) {
       setGrid(prev => {
         const next = [...prev];
         next[draggedFromIndex!] = { character: null };
         return next;
       });
    }
    setDraggedCharacter(null);
    setDraggedFromIndex(null);
    setDragOverIndex(null);
    setIsDragging(false);
  };

  // --- Export ---
  const handleExport = async () => {
    if (!gridRef.current) return;
    setIsExporting(true);
    try {
       const url = await toPng(gridRef.current, { quality: 1, pixelRatio: 2, backgroundColor: "#000" });
       const link = document.createElement("a");
       link.download = "waifu100.png";
       link.href = url;
       link.click();
    } catch(e) { console.error(e); }
    finally { setIsExporting(false); }
  };

  // --- Manual Upload ---
  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
       const imageUrl = ev.target?.result as string;
       // Create a custom character from the uploaded image
       const customChar: Character = {
          mal_id: Date.now(),
          name: file.name.replace(/\.[^/.]+$/, "") || "Custom Character",
          images: { jpg: { image_url: imageUrl } },
          customImageUrl: imageUrl,
          source: "Uploaded"
       };
       setSelectedCharacter(customChar);
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be uploaded again
    e.target.value = "";
  };

  // --- URL Submit Handler ---
  const handleUrlSubmit = async () => {
    setUrlError(null);
    const url = urlInput.trim();
    
    // Basic validation
    if (!url) {
      setUrlError("Please enter a URL");
      return;
    }
    
    // URL format validation
    try {
      new URL(url);
    } catch {
      setUrlError("Invalid URL format");
      return;
    }
    
    // Check if URL ends with valid image extension
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const urlLower = url.toLowerCase();
    const hasValidExtension = validExtensions.some(ext => urlLower.includes(ext));
    
    if (!hasValidExtension) {
      setUrlError("URL must be an image (jpg, png, gif, webp)");
      return;
    }
    
    // Validate image loads
    setIsValidatingUrl(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = url;
      });
      
      // Success - create character
      const customChar: Character = {
        mal_id: Date.now(),
        name: "Custom Character",
        images: { jpg: { image_url: url } },
        customImageUrl: url,
        source: "URL"
      };
      setSelectedCharacter(customChar);
      setShowUrlModal(false);
      setUrlInput("");
    } catch {
      setUrlError("Could not load image. Check URL or CORS.");
    } finally {
      setIsValidatingUrl(false);
    }
  };

  const filledCount = grid.filter(c => c.character).length;

  return (
    <>
    <div className="min-h-screen bg-black flex flex-col lg:flex-row text-white font-sans h-screen overflow-hidden">
      
      {/* 1. LEFT SIDEBAR: Character Discovery */}
      <aside className="w-full lg:w-80 bg-zinc-950 border-r border-zinc-800 flex flex-col z-20 shadow-xl shrink-0">
        <div className="p-4 border-b border-zinc-800">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent mb-4">
            Waifu100
          </h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"/>
            <input 
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg py-2 pl-10 pr-4 focus:ring-2 focus:ring-purple-500 outline-none"
              placeholder="Search Character..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-800">
          {isSearching ? (
             <div className="flex justify-center py-10"><Loader2 className="animate-spin text-purple-500"/></div>
          ) : characterResults.length === 0 ? (
             <div className="text-center py-10 px-4">
                <p className="text-zinc-500 text-sm mb-4">Search for your favorite characters to start.</p>
             </div>
          ) : (
             <div className="space-y-2">
               {characterResults.map(char => (
                 <div
                   key={char.mal_id}
                   draggable
                   onDragStart={(e) => handleDragStartFromSearch(e, char)}
                   onDragEnd={handleDragEnd}
                   onClick={() => handleSelectCharacter(char)}
                   className={cn(
                     "group flex items-center gap-3 p-2 rounded-lg cursor-pointer border transition-all",
                     selectedCharacter?.mal_id === char.mal_id ? "bg-purple-900/20 border-purple-500" : "bg-zinc-900/50 border-transparent hover:bg-zinc-800"
                   )}
                 >
                   <img src={char.images.jpg.image_url} alt={char.name} className="w-16 h-20 rounded-lg object-cover bg-zinc-800 shrink-0"/>
                   <div className="flex-1 min-w-0">
                     <p className="font-medium truncate text-sm">{char.name}</p>
                     <p className="text-xs text-zinc-500 truncate">{char.source}</p>
                   </div>
                   <button 
                     onClick={(e) => { e.stopPropagation(); openGallery(char); }}
                     title="Gallery: Find more images"
                     className="p-2 rounded-full hover:bg-purple-600/20 text-zinc-400 hover:text-pink-400 transition-colors"
                   >
                     <ImageIcon className="w-4 h-4"/>
                   </button>
                 </div>
               ))}
             </div>
          )}
        </div>

        {/* Stats Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 backdrop-blur">
           <div className="flex justify-between text-sm mb-2">
             <span className="text-zinc-400">Filled</span>
             <span className="font-bold text-purple-400">{filledCount}/100</span>
           </div>
           <div className="h-1 bg-zinc-900 rounded-full overflow-hidden mb-4">
             <div className="h-full bg-purple-500 transition-all duration-500" style={{width: `${filledCount}%`}}/>
           </div>
           
           {/* Hidden file input */}
           <input 
              ref={uploadRef}
              type="file" 
              accept="image/*" 
              onChange={handleManualUpload}
              className="hidden"
           />
           
           {/* Paste URL Button */}
           <button 
              onClick={() => setShowUrlModal(true)}
              className="w-full py-2 mb-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-colors"
           >
              <Link className="w-4 h-4 text-pink-400"/>
              Paste URL
           </button>
           
           {/* Upload Custom Image Button */}
           <button 
              onClick={() => uploadRef.current?.click()}
              className="w-full py-2 mb-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-colors"
           >
              <Upload className="w-4 h-4 text-purple-400"/>
              Upload Image
           </button>
           
           <button 
             onClick={handleExport}
             disabled={isExporting}
             className="w-full py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:opacity-90 flex justify-center items-center gap-2"
           >
             {isExporting ? <Loader2 className="animate-spin w-4 h-4"/> : <Download className="w-4 h-4"/>}
             Export
           </button>
        </div>
      </aside>

      {/* 1.5 CHARACTER PREVIEW PANEL */}
      {selectedCharacter && (
         <aside className="hidden lg:flex w-64 bg-zinc-950 border-r border-zinc-800 flex-col shrink-0">
            <div className="p-4 border-b border-zinc-800">
               <h2 className="font-bold text-sm uppercase tracking-wider text-zinc-400">Selected</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
               <div 
                  draggable
                  onDragStart={(e) => handleDragStartFromSearch(e, selectedCharacter)}
                  onDragEnd={handleDragEnd}
                  className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-zinc-900 mb-4 border border-zinc-800 cursor-grab active:cursor-grabbing hover:border-purple-500 transition-colors"
               >
                  <img 
                     src={selectedCharacter.customImageUrl || selectedCharacter.images.jpg.image_url} 
                     alt={selectedCharacter.name}
                     className="w-full h-full object-cover pointer-events-none"
                  />
               </div>
               <h3 className="font-bold text-lg text-white mb-1">{selectedCharacter.name}</h3>
               <p className="text-sm text-zinc-500 mb-4">{selectedCharacter.source || "Unknown Source"}</p>
               
               <div className="space-y-2">
                  <button 
                     onClick={() => openGallery(selectedCharacter)}
                     disabled={selectedCharacter.source === "Uploaded" || selectedCharacter.source === "URL"}
                     className="w-full py-2 px-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                     <Images className="w-4 h-4 text-purple-400"/>
                     Find More Images
                  </button>
                  <p className="text-xs text-zinc-600 text-center">Drag image to a cell or click a cell</p>
               </div>
            </div>
         </aside>
      )}

      {/* 2. MAIN GRID AREA */}
      <main className="flex-1 bg-black flex items-center justify-center p-4 lg:p-8 overflow-auto h-full relative">
         
         {/* Left Delete Zone */}
         {isDragging && draggedFromIndex !== null && (
            <div 
              className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-red-900/80 to-transparent border-r-2 border-dashed border-red-500 flex items-center justify-start pl-4 z-30"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => {
                 e.preventDefault();
                 if (draggedFromIndex !== null) {
                    setGrid(prev => {
                       const next = [...prev];
                       next[draggedFromIndex] = { character: null };
                       return next;
                    });
                 }
                 setDraggedCharacter(null);
                 setDraggedFromIndex(null);
                 setIsDragging(false);
              }}
            >
               <Trash2 className="w-8 h-8 text-red-400 animate-pulse"/>
            </div>
         )}
         
         {/* Right Delete Zone */}
         {isDragging && draggedFromIndex !== null && (
            <div 
              className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-red-900/80 to-transparent border-l-2 border-dashed border-red-500 flex items-center justify-end pr-4 z-30"
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
              onDrop={(e) => {
                 e.preventDefault();
                 if (draggedFromIndex !== null) {
                    setGrid(prev => {
                       const next = [...prev];
                       next[draggedFromIndex] = { character: null };
                       return next;
                    });
                 }
                 setDraggedCharacter(null);
                 setDraggedFromIndex(null);
                 setIsDragging(false);
              }}
            >
               <Trash2 className="w-8 h-8 text-red-400 animate-pulse"/>
            </div>
         )}
         
         <div ref={gridRef} className="bg-black p-4 shadow-2xl scale-[0.8] lg:scale-100 transition-transform origin-center" style={{maxWidth: '850px'}}>
             <h2 className="text-2xl font-bold text-center mb-6 tracking-widest uppercase text-zinc-300">#CHALLENGEอายุน้อยร้อยเมน</h2>
             
             {/* Onboarding Hint (shows when grid is mostly empty) */}
             {filledCount < 5 && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg text-center">
                   <div className="flex items-center justify-center gap-2 text-purple-300 text-sm font-medium mb-1">
                      <GripVertical className="w-4 h-4"/>
                      <span>Drag & Drop to Build Your Grid</span>
                   </div>
                   <p className="text-xs text-zinc-500">Search characters on the left, then drag them here. Drag to reorder or drop on red zones to delete.</p>
                </div>
             )}
             
             <div className="grid grid-cols-10 gap-1 bg-zinc-900/50 p-1 rounded-sm">
                {grid.map((cell, idx) => (
                  <div 
                    key={idx}
                    draggable={!!cell.character}
                    onDragStart={(e) => cell.character && handleDragStartFromGrid(e, idx, cell.character)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    onClick={() => { 
                        if (selectedCharacter) {
                            handleCellClick(idx);
                        } else if(cell.character) { 
                            openGallery(cell.character); 
                        }
                    }}
                    className={cn(
                      "aspect-square bg-zinc-950 relative group cursor-pointer border border-zinc-800/50 transition-all duration-200",
                      dragOverIndex === idx && "border-purple-500 bg-purple-500/20 scale-110",
                      selectedCharacter && !cell.character && "animate-pulse ring-1 ring-purple-500/50",
                      lastDroppedIndex === idx && "animate-[pop_0.3s_ease-out] scale-105"
                    )}
                  >
                    {cell.character ? (
                       <img 
                         src={cell.character.customImageUrl || cell.character.images.jpg.image_url} 
                         className="w-full h-full object-cover pointer-events-none" 
                       />
                    ) : ( 
                       <div className="w-full h-full flex items-center justify-center text-zinc-900 font-bold text-xs select-none">
                         {idx + 1}
                       </div>
                    )}
                  </div>
                ))}
             </div>
             <p className="text-center text-zinc-600 text-[10px] mt-4 uppercase tracking-wider">Drag to Move • Drag Out to Delete</p>
         </div>
      </main>

      {/* 3. RIGHT SIDEBAR: Suggestions & Gallery */}
      <aside className={cn(
        "bg-zinc-950 border-l border-zinc-800 flex flex-col h-[50vh] lg:h-screen z-20 shadow-xl shrink-0 transition-all duration-300",
        showRightPanel ? "w-full lg:w-80" : "w-12"
      )}>
         
         {/* Toggle / Header */}
         <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-2 bg-zinc-900/50">
            {showRightPanel ? (
                <div className="flex gap-2 p-1 bg-zinc-900 rounded-lg flex-1 mr-2">
                   <button 
                     onClick={() => setActiveTab('suggestions')} 
                     className={cn("flex-1 text-xs py-1.5 rounded-md font-medium transition-colors", activeTab === 'suggestions' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300")}
                   >
                     Suggestions
                   </button>
                   <button 
                     onClick={() => setActiveTab('gallery')} 
                     className={cn("flex-1 text-xs py-1.5 rounded-md font-medium transition-colors", activeTab === 'gallery' ? "bg-pink-900/30 text-pink-200 shadow-sm" : "text-zinc-500 hover:text-zinc-300")}
                   >
                     Gallery
                   </button>
                </div>
            ) : (
                <div className="flex flex-col items-center w-full gap-4 pt-4">
                   <button onClick={() => setShowRightPanel(true)} title="Expand"><ChevronLeft className="text-zinc-500"/></button>
                </div>
            )}
            
            {showRightPanel && (
              <button onClick={() => setShowRightPanel(false)} className="p-2 hover:bg-zinc-800 rounded text-zinc-500">
                <ChevronRight className="w-4 h-4"/>
              </button>
            )}
         </div>

         {/* CONTENT */}
         {showRightPanel && (
           <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
                          {/* TAB: SUGGESTIONS */}
              {activeTab === 'suggestions' && (
                 <div className="p-4">
                    <div className="text-center mb-6">
                       <Sparkles className="w-8 h-8 text-purple-500 mx-auto mb-2"/>
                       <h3 className="font-bold text-lg text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">AI Suggestions</h3>
                       <p className="text-xs text-zinc-500">Based on your current grid</p>
                    </div>
                    
                    <button 
                      onClick={handleGetSuggestions}
                      disabled={isSuggestionsLoading || filledCount < 2}
                      className="w-full py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 mb-6 flex items-center justify-center gap-2 transition-opacity"
                    >
                      {isSuggestionsLoading ? <Loader2 className="animate-spin w-4 h-4"/> : <Lightbulb className="w-4 h-4"/>}
                      Generate Ideas
                    </button>
                    
                    {suggestionsError && <div className="p-2 bg-red-900/20 text-red-300 text-xs rounded mb-4">{suggestionsError}</div>}
                    
                    <div className="space-y-3">
                       {suggestions.map((s, i) => (
                         <div key={i} className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-pink-500/50 transition-colors">
                           <div className="flex justify-between items-start">
                              <div>
                                 <p className="font-bold text-sm text-zinc-200">{s.name}</p>
                                 <p className="text-xs text-zinc-500">{s.from}</p>
                              </div>
                              <button onClick={() => handleApplySuggestion(s)} className="p-1.5 hover:bg-zinc-800 rounded text-purple-400">
                                 <Search className="w-3 h-3"/>
                              </button>
                           </div>
                           <p className="text-xs text-zinc-500 mt-2 italic border-t border-zinc-800/50 pt-2">"{s.reason}"</p>
                        </div>
                      ))}
                   </div>
                   
                   {suggestions.length === 0 && !isSuggestionsLoading && (
                      <p className="text-center text-zinc-700 text-xs">Fill the grid with at least 2 characters to unlock AI powers.</p>
                   )}
                </div>
             )}

             {/* TAB: GALLERY */}
             {activeTab === 'gallery' && (
                <div className="p-2">
                   {!galleryTargetName ? (
                      <div className="text-center py-20 text-zinc-500 px-4">
                         <Images className="w-10 h-10 mx-auto mb-2 opacity-20"/>
                         <p className="text-sm">Select a character or click the image icon <ImageIcon className="w-3 h-3 inline"/> to view their gallery.</p>
                      </div>
                   ) : (
                      <>
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full bg-pink-500"/>
                           {galleryTargetName}
                        </h3>
                        {isGalleryLoading ? (
                           <div className="flex justify-center py-10"><Loader2 className="animate-spin text-pink-500"/></div>
                        ) : galleryImages.length > 0 ? (
                           <div className="grid grid-cols-2 gap-2">
                              {galleryImages.map((img, i) => (
                                 <div
                                    key={i}
                                    draggable
                                    onDragStart={(e) => handleDragStartFromGallery(e, img)}
                                    onClick={() => {
                                        // Create char object for selection
                                        const char: Character = {
                                           mal_id: Date.now() + Math.floor(Math.random() * 10000),
                                           name: galleryTargetName || "Character",
                                           images: { jpg: { image_url: img.url } },
                                           customImageUrl: img.url
                                        };
                                        handleSelectCharacter(char);
                                    }}
                                    className={cn(
                                       "aspect-square relative group rounded-lg overflow-hidden border border-zinc-800 cursor-pointer hover:border-pink-500 transition-all bg-zinc-900",
                                       selectedCharacter?.customImageUrl === img.url && "ring-2 ring-pink-500 border-transparent"
                                    )}
                                 >
                                    <img src={img.thumbnail} className="w-full h-full object-cover pointer-events-none"/>
                                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                       <span className="text-[9px] text-white bg-black/50 px-1 rounded">{img.source}</span>
                                    </div>
                                 </div>
                              ))}
                           </div>
                        ) : (
                           <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                              <p className="text-zinc-500 text-sm font-medium mb-1">No images found.</p>
                              <p className="text-zinc-700 text-xs">Try the "Usage Suggestions" tab to find similar characters!</p>
                           </div>
                        )}
                      </>
                   )}
                </div>
             )}

           </div>
         )}
      </aside>

    </div>
    
    {/* URL Paste Modal */}
    {showUrlModal && (
       <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md p-6">
             <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white">Paste Image URL</h3>
                <button 
                   onClick={() => { setShowUrlModal(false); setUrlInput(""); setUrlError(null); }}
                   className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                   <X className="w-5 h-5 text-zinc-400"/>
                </button>
             </div>
             
             <div className="mb-4">
                <label className="block text-sm text-zinc-400 mb-2">Image URL</label>
                <input 
                   type="url"
                   value={urlInput}
                   onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
                   onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                   placeholder="https://example.com/image.jpg"
                   className={cn(
                      "w-full bg-zinc-800 border rounded-lg py-3 px-4 text-white placeholder-zinc-500 focus:ring-2 focus:ring-purple-500 outline-none transition-colors",
                      urlError ? "border-red-500" : "border-zinc-700"
                   )}
                   autoFocus
                />
                {urlError && (
                   <p className="text-red-400 text-sm mt-2">{urlError}</p>
                )}
                <p className="text-zinc-600 text-xs mt-2">Supports: JPG, PNG, GIF, WebP</p>
             </div>
             
             <div className="flex gap-3">
                <button 
                   onClick={() => { setShowUrlModal(false); setUrlInput(""); setUrlError(null); }}
                   className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium transition-colors"
                >
                   Cancel
                </button>
                <button 
                   onClick={handleUrlSubmit}
                   disabled={isValidatingUrl}
                   className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:opacity-90 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                   {isValidatingUrl ? <Loader2 className="animate-spin w-4 h-4"/> : null}
                   {isValidatingUrl ? "Checking..." : "Add Image"}
                </button>
             </div>
          </div>
       </div>
    )}
    </>
  );
}
