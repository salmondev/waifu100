"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, X, Trash2, Loader2, Sparkles, ChevronRight, ChevronLeft, ExternalLink, ImageIcon, Images, Grid3X3, Lightbulb, GripVertical, HelpCircle, Upload, Link, Save, FileJson, Copy, Check, AlertCircle, Info } from "lucide-react";
import { toPng, toBlob, toJpeg } from "html-to-image";
import NextImage from "next/image";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | boolean)[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Notification {
  message: string;
  type: 'success' | 'error' | 'info';
}

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
  
  // --- State: Notifications ---
  const [notification, setNotification] = useState<Notification | null>(null);

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
      setNotification({ message, type });
      setTimeout(() => setNotification(null), 3000);
  }, []);
  
  // --- State: Search (Left Panel) ---
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 600); // 600ms debounce to reduce API spam
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
  const [gallerySearchQuery, setGallerySearchQuery] = useState<string>(""); // Custom search keywords

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
  const [showSaveLoadModal, setShowSaveLoadModal] = useState(false);
  const [saveLoadTab, setSaveLoadTab] = useState<'save' | 'load'>('save');
  const [jsonInput, setJsonInput] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  // Reverted format toggle to ensure stability
  const gridRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  
  // --- State: URL Modal ---
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  
  // --- State: Replace Confirmation ---
  const [pendingReplace, setPendingReplace] = useState<{index: number, newChar: Character, oldChar: Character} | null>(null);

  // --- Persistence ---
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setGrid(JSON.parse(saved)); } catch (e) { console.error(e); }
    }
  }, []);

  // Track if we've already shown the storage warning this session
  const storageWarningShown = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grid));
      storageWarningShown.current = false; // Reset if save succeeds
    } catch (e: any) {
      if ((e.name === 'QuotaExceededError' || e.message?.includes('exceeded the quota')) 
          && !storageWarningShown.current) {
         storageWarningShown.current = true;
         showNotification("Storage nearly full. Your changes are saved in memory.", 'info');
         console.warn("Storage Quota Exceeded - changes saved in memory only");
      }
    }
  }, [grid, showNotification]);

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
  const openGallery = useCallback(async (char: Character, customQuery?: string) => {
    setShowRightPanel(true);
    setActiveTab('gallery');
    setGalleryTargetName(char.name);
    setGalleryImages([]);
    
    setIsGalleryLoading(true);
    setSelectedCharacter(char);

    try {
      // Combine character name with custom query if provided
      const searchName = customQuery 
        ? `${char.name} ${customQuery}`.trim()
        : char.name;
        
      const res = await fetch("/api/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            characterName: searchName, 
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

  // Search gallery with custom keywords
  const searchGalleryWithQuery = useCallback(() => {
    if (!selectedCharacter) return;
    openGallery(selectedCharacter, gallerySearchQuery);
  }, [selectedCharacter, gallerySearchQuery, openGallery]);

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
    openGallery(char); // Auto-find more images
  };
  
  const handleCellClick = (index: number) => {
    if (selectedCharacter) {
      const existingChar = grid[index].character;
      
      if (existingChar) {
         // User Request: Don't replace on click. Show details instead.
         // Switch selection to the clicked character and open gallery
         setSelectedCharacter(existingChar);
         openGallery(existingChar);
      } else {
         // Empty cell, just place
         setGrid(prev => {
           const next = [...prev];
           next[index] = { character: selectedCharacter };
           return next;
         });
         setLastDroppedIndex(index);
         setTimeout(() => setLastDroppedIndex(null), 300);
      }
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
       // Use thumbnail first to avoid hotlink/cors issues with full URLs
       images: { jpg: { image_url: img.thumbnail || img.url } },
       customImageUrl: img.thumbnail || img.url
    };
    setDraggedCharacter(char);
    setDraggedFromIndex(null);
    setIsDragging(true);
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
       const existingChar = grid[index].character;
       
       // If dragged from grid (swap), always allow
       if (draggedFromIndex !== null) {
          setGrid(prev => {
            const next = [...prev];
            const targetChar = next[index].character;
            next[index] = { character: draggedCharacter };
            next[draggedFromIndex] = { character: targetChar };
            return next;
          });
          setLastDroppedIndex(index);
          setTimeout(() => setLastDroppedIndex(null), 300);
       } 
       // If dropping from search onto occupied cell, ask for confirmation
       else if (existingChar) {
          setPendingReplace({ index, newChar: draggedCharacter, oldChar: existingChar });
       }
       // If dropping onto empty cell, just place
       else {
          setGrid(prev => {
            const next = [...prev];
            next[index] = { character: draggedCharacter };
            return next;
          });
          setLastDroppedIndex(index);
          setTimeout(() => setLastDroppedIndex(null), 300);
       }
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
  // --- Export ---
  // --- Export ---
  const handleExport = async () => {
    if (!gridRef.current) return;
    setIsExporting(true);
    try {
       const filename = 'waifu100-challenge.png';
       const options = { 
           quality: 1, 
           pixelRatio: 1, 
           // cacheBust: true, // REMOVED: Breaks Data URLs and causes duplication
           backgroundColor: "#000",
           width: 1080, 
           height: 1080,
           filter: (node: HTMLElement) => {
               if (node.classList?.contains("export-exclude")) return false;
               // Robust Ghost Filter: Ignore images inside cells marked as empty
               if (node.tagName === 'IMG' && node.closest('[data-export-empty="true"]')) {
                   return false; 
               }
               return true;
           },
           style: {
               // ... existing style ...
               width: "1080px",
               height: "1080px",
               boxSizing: "border-box", 
               transform: "none",
               maxWidth: "none",
               maxHeight: "none",
               margin: "0",
               padding: "30px",
               display: "flex", 
               flexDirection: "column",
               alignItems: "center", 
               justifyContent: "center",
               overflow: "hidden" 
           }
       };

       // ... (Resize logic same as before) ...
       // 1. Force the Inner Grid to be 950px
       const nodes = gridRef.current.querySelectorAll('.grid');
       nodes.forEach(n => {
           const el = n as HTMLElement;
           el.style.width = '950px';
           el.style.height = '950px';
           // ... (rest of styles)
           el.style.maxWidth = 'none';
           el.style.aspectRatio = 'unset';
           el.style.gap = '0px'; 
           el.style.display = 'grid';
           el.style.gridTemplateColumns = 'repeat(10, 95px)';
           el.style.gridTemplateRows = 'repeat(10, 95px)';
           el.style.padding = '0';
           el.style.margin = '0';
           el.style.border = 'none';
       });
       
       // ... (Title logic same as before) ...
       const titles = gridRef.current.querySelectorAll('h2');
       titles.forEach(t => {
           const el = t as HTMLElement;
           el.style.marginBottom = '25px';
           el.style.fontSize = '42px';
           el.style.textAlign = 'center';
           el.style.width = '100%';
           el.style.color = '#fff';
           el.style.textShadow = '0 2px 10px rgba(168, 85, 247, 0.5)';
       });
       
       // ... (Container logic same as before) ...
       gridRef.current.style.width = '1080px';
       gridRef.current.style.height = '1080px';
       gridRef.current.style.maxWidth = 'none';
       gridRef.current.style.maxHeight = 'none';
       gridRef.current.style.aspectRatio = 'unset';
       gridRef.current.style.padding = '0';
       gridRef.current.style.margin = '0';
       
       // 4. Force Cells to be Exact 95px + MARK EMPTY CELLS
       const cells = gridRef.current.querySelectorAll('.grid > div');
       cells.forEach((c, idx) => {
           const el = c as HTMLElement;
           el.style.width = '95px';
           el.style.height = '95px';
           el.style.border = 'none';
           el.style.borderRadius = '0';
           el.style.minWidth = '95px';
           el.style.minHeight = '95px';
           
           // Clean Empty Cells (Source of Truth: Grid State)
           if (!grid[idx]?.character) {
               // Visual cleanup
               el.style.backgroundImage = 'none';
               el.style.backgroundColor = '#000000';
               // Mark for Filter
               el.setAttribute('data-export-empty', 'true');
               
               // Force hide any images in empty slots (Defense in Depth)
               const imgs = el.querySelectorAll('img');
               imgs.forEach(img => {
                   (img as HTMLElement).style.display = 'none';
                   (img as HTMLElement).style.visibility = 'hidden';
               });
           }
       });

       // Generate Blob
       const blob = await toBlob(gridRef.current, options);
       
       // Restore styles
       gridRef.current.style.width = '';
       gridRef.current.style.height = '';
       gridRef.current.style.maxWidth = '';
       gridRef.current.style.maxHeight = '';
       gridRef.current.style.aspectRatio = '';
       gridRef.current.style.padding = '';
       gridRef.current.style.margin = '';
       
       titles.forEach(t => {
            const el = t as HTMLElement;
            el.style.marginBottom = '';
            el.style.fontSize = '';
            el.style.textAlign = '';
            el.style.width = '';
            el.style.color = '';
            el.style.textShadow = '';
       });

       nodes.forEach(n => {
           const el = n as HTMLElement;
           el.style.width = '';
           el.style.height = '';
           el.style.maxWidth = '';
           el.style.aspectRatio = '';
           el.style.gap = '';
           el.style.gridTemplateColumns = '';
           el.style.gridTemplateRows = '';
           el.style.display = '';
           el.style.padding = '';
           el.style.margin = '';
           el.style.border = '';
       });
       
       cells.forEach(c => {
            const el = c as HTMLElement;
            el.style.width = '';
            el.style.height = '';
            el.style.border = '';
            el.style.borderRadius = '';
            el.style.minWidth = '';
            el.style.minHeight = '';
            el.style.backgroundImage = '';
            el.style.backgroundColor = '';
       });

       if (!blob) throw new Error("Blob generation failed");

       // Try Modern File System Access API (Save As Dialog)
       if ('showSaveFilePicker' in window) {
          try {
             const handle = await (window as any).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                   description: 'PNG Image',
                   accept: { 'image/png': ['.png'] },
                }],
             });
             const writable = await handle.createWritable();
             await writable.write(blob);
             await writable.close();
             return; // Success
          } catch (err: any) {
             if (err.name === 'AbortError') return; // User cancelled
             // Fallback to download on error
          }
       }

       // Fallback: Legacy Direct Download
       const url = URL.createObjectURL(blob);
       const link = document.createElement("a");
       link.download = filename;
       link.href = url;
       link.click();
       URL.revokeObjectURL(url);

    } catch(e: any) { 
       console.error("Export Error:", e);
       showNotification(`Export failed: ${e.message}`, 'error');
    }
    finally { setIsExporting(false); }
  };

  // --- Save / Load Logic ---
  const handleOpenSaveLoad = () => {
    // Auto-generate JSON on open
    const data = grid
      .map((cell, idx) => {
        if (!cell.character) return null;
        return {
          i: idx,
          m: cell.character.mal_id,
          n: cell.character.name,
          img: cell.character.images.jpg.image_url,
          c_img: cell.character.customImageUrl,
          s: cell.character.source
        };
      })
      .filter(Boolean); // Remove nulls to save space
    
    setJsonInput(JSON.stringify(data)); 
    setSaveLoadTab('save');
    setShowSaveLoadModal(true);
    setCopySuccess(false);
  };

  const handleCopyJson = async () => {
      try {
        await navigator.clipboard.writeText(jsonInput);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        showNotification("Failed to copy", 'error');
      }
  };

  const handleDownloadJson = async () => {
      const filename = "waifu100-save.json";
      const blob = new Blob([jsonInput], { type: "application/json" });
      
      // Try Modern File System Access API (Save As Dialog)
      if ('showSaveFilePicker' in window) {
         try {
            const handle = await (window as any).showSaveFilePicker({
               suggestedName: filename,
               types: [{
                  description: 'JSON File',
                  accept: { 'application/json': ['.json'] },
               }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return; // Success
         } catch (err: any) {
            if (err.name === 'AbortError') return; // User cancelled
            // Fallback to direct download on error
         }
      }

      // Fallback: Direct Download
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = filename;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
  };

  const handleLoadJson = () => {
      let data: any[] = [];
      const input = jsonInput.trim();

      // Scavenger Function: Finds balanced {...} objects in 'soup'
      const scavenge = (str: string) => {
          const found: any[] = [];
          let depth = 0;
          let start = -1;
          let inString = false;
          
          for (let i = 0; i < str.length; i++) {
              const char = str[i];
              
              // Handle escaped quotes inside strings
              if (inString) {
                  if (char === '"' && str[i-1] !== '\\') inString = false;
                  continue;
              }
              
              if (char === '"') {
                  inString = true;
                  continue;
              }
              
              if (char === '{') {
                  if (depth === 0) start = i;
                  depth++;
              } else if (char === '}') {
                  depth--;
                  if (depth === 0 && start !== -1) {
                      try {
                          const substring = str.substring(start, i + 1);
                          const item = JSON.parse(substring);
                          // Verify it looks like a character object
                          if (item.i !== undefined || item.character !== undefined || item.mal_id !== undefined || item.n !== undefined) {
                              found.push(item);
                          }
                      } catch (e) { /* Ignore bad chunks */ }
                      start = -1;
                  }
              }
          }
          return found;
      };

      try {
         // 1. Try Standard Parse
         try {
             const parsed = JSON.parse(input);
             data = Array.isArray(parsed) ? parsed : [parsed];
         } catch (e1) {
             // 2. Try Base64 Decode + Parse
             try {
                const decoded = atob(input);
                try {
                    const parsed = JSON.parse(decoded);
                    data = Array.isArray(parsed) ? parsed : [parsed];
                } catch(e3) {
                    // 3. Fallback: Scavenge from Decoded String
                    data = scavenge(decoded);
                }
             } catch (e2) {
                // 4. Fallback: Scavenge from Raw String (maybe it wasn't base64?)
                data = scavenge(input);
             }
         }
         
         if (data.length === 0) throw new Error("No valid data found");
         
         // Create new grid
         const newGrid = Array(100).fill(null).map(() => ({ character: null as Character | null }));
         let loadedCount = 0;

         // Universal Loader (Handles Mixed Formats)
         data.forEach((item: any, index: number) => {
             let gridIndex = -1;
             let charObj: any = null;

             // Detect Format Type per Item
             if (item.character) {
                 // Legacy Format: Implicit Index 0-99 based on order or use explicit index if merging (conceptually)
                 // Legacy arrays usually rely on position.
                 gridIndex = index;
                 charObj = item.character;
             } else if (typeof item.i === 'number') {
                 // Standard Format: Explicit Index
                 gridIndex = item.i;
                 // Map standard fields to temporary char object
                 charObj = {
                     mal_id: item.m,
                     jikan_id: item.m,
                     name: item.n,
                     images: { jpg: { image_url: item.img } },
                     customImageUrl: item.c_img,
                     source: item.s
                 };
             }

             // Validate and Fill
             if (gridIndex >= 0 && gridIndex < 100 && charObj) {
                 newGrid[gridIndex] = {
                     character: {
                         mal_id: charObj.mal_id || Date.now() + index,
                         jikan_id: charObj.jikan_id || charObj.mal_id,
                         name: charObj.name || "Unknown",
                         images: { 
                             jpg: { 
                                 image_url: charObj.images?.jpg?.image_url || charObj.customImageUrl || "" 
                             } 
                         },
                         customImageUrl: charObj.customImageUrl || charObj.images?.jpg?.image_url,
                         source: charObj.source || "Imported"
                     }
                 };
                 loadedCount++;
             }
         });
         
         if (loadedCount === 0) throw new Error("Data found but no valid characters detected");

         setGrid(newGrid);
         setShowSaveLoadModal(false);
         showNotification(`Successfully loaded ${loadedCount} characters!`, 'success');
      } catch(e) {
         console.error(e);
         showNotification("Could not load data. Check clipboard.", 'error');
      }
  };

  // --- Manual Upload ---
  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Check file size (warn if > 5MB before compression)
    if (file.size > 5 * 1024 * 1024) {
       console.warn("Large file uploaded, compressing...");
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
       const img = new Image();
       img.onload = () => {
          // Compress logic
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          // Max dimension 500px (balance between quality and storage size)
          const MAX_DIM = 500;
          if (width > height) {
             if (width > MAX_DIM) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
             }
          } else {
             if (height > MAX_DIM) {
                width *= MAX_DIM / height;
                height = MAX_DIM;
             }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // Export compressed JPEG
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
          
          const customChar: Character = {
             mal_id: Date.now(),
             name: file.name.replace(/\.[^/.]+$/, "") || "Custom Character",
             images: { jpg: { image_url: compressedDataUrl } },
             customImageUrl: compressedDataUrl,
             source: "Uploaded"
          };
          
          setSelectedCharacter(customChar);
          openGallery(customChar); // Show in sidebar
       };
       img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    // Reset input
    e.target.value = "";
  };

  // --- Fallback Search ---
  const handleFallbackSearch = () => {
     const tempChar: Character = {
        mal_id: Date.now(),
        name: searchQuery,
        images: { jpg: { image_url: "" } },
        source: "Web Search",
        customImageUrl: "" 
     };
     setSelectedCharacter(tempChar);
     openGallery(tempChar);
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
                {searchQuery ? (
                   <div className="border border-dashed border-zinc-800 rounded-lg p-4 bg-zinc-900/20">
                      <p className="text-zinc-500 text-sm mb-3">No official character found.</p>
                      <button 
                         onClick={handleFallbackSearch}
                         className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-purple-400 hover:text-purple-300 text-sm font-medium flex items-center justify-center gap-2 mx-auto transition-colors"
                      >
                         <Images className="w-4 h-4"/>
                         Search Web Images for "{searchQuery}"
                      </button>
                   </div>
                ) : (
                   <p className="text-zinc-500 text-sm mb-4">Search for your favorite characters to start.</p>
                )}
             </div>
          ) : (
             <div className="space-y-2">
               {characterResults.map((char, idx) => (
                 <div
                   key={`${char.mal_id}-${idx}`}
                   draggable
                   onDragStart={(e) => handleDragStartFromSearch(e, char)}
                   onDragEnd={handleDragEnd}
                   onClick={() => handleSelectCharacter(char)}
                   className={cn(
                     "group flex items-center gap-3 p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all",
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
             <span className="text-zinc-400">Progress</span>
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
              onClick={handleOpenSaveLoad}
              className="w-full py-2 mb-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-colors text-zinc-300"
           >
              <Save className="w-4 h-4 text-green-400"/>
              Save / Load Progress
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
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
               <h2 className="font-bold text-sm uppercase tracking-wider text-zinc-400">Selected</h2>
               <button
                  onClick={() => setSelectedCharacter(null)}
                  className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-white transition-colors"
                  title="Close"
               >
                  <X className="w-4 h-4"/>
               </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
               <div 
                  draggable
                  onDragStart={(e) => handleDragStartFromSearch(e, selectedCharacter)}
                  onDragEnd={handleDragEnd}
                  className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-zinc-900 mb-4 border border-zinc-800 cursor-grab active:cursor-grabbing hover:border-purple-500 transition-colors"
               >
                  {selectedCharacter.customImageUrl || selectedCharacter.images.jpg.image_url ? (
                      <img 
                         src={selectedCharacter.customImageUrl || selectedCharacter.images.jpg.image_url} 
                         alt={selectedCharacter.name}
                         className="w-full h-full object-cover pointer-events-none"
                      />
                  ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-zinc-700 bg-zinc-900">
                         <ImageIcon className="w-12 h-12 mb-2 opacity-20"/>
                         <span className="text-xs font-medium uppercase tracking-widest opacity-40">No Preview</span>
                      </div>
                  )}
               </div>
               <h3 className="font-bold text-lg text-white mb-1">{selectedCharacter.name}</h3>
               <p className="text-sm text-zinc-500 mb-4">{selectedCharacter.source || "Unknown Source"}</p>
               
               <div className="space-y-2">
                  <button 
                     onClick={() => {
                        const source = ["Uploaded", "URL", "Web Search"].includes(selectedCharacter.source || "") ? "Anime" : selectedCharacter.source;
                        const query = `${selectedCharacter.name} ${source || ""}`;
                        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`, '_blank');
                     }}
                     className="w-full py-2 px-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                     <Search className="w-4 h-4 text-blue-400"/>
                     Search Google Images
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
         
         <div ref={gridRef} className="bg-black p-4 shadow-2xl w-full max-w-[85vh] aspect-square mx-auto transition-all">
             <h2 className="text-2xl font-bold text-center mb-6 tracking-widest uppercase text-zinc-300">#CHALLENGEอายุน้อยร้อยเมน</h2>
             
             {/* Onboarding Hint (shows when grid is mostly empty) */}
             {filledCount < 5 && (
                <div className="mb-4 p-3 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg text-center export-exclude">
                   <div className="flex items-center justify-center gap-2 text-purple-300 text-sm font-medium mb-1">
                      <GripVertical className="w-4 h-4"/>
                      <span>Drag & Drop to Build Your Grid</span>
                   </div>
                   <p className="text-xs text-zinc-500">Search characters on the left, then drag them here. Drag to reorder or drop on red zones to delete.</p>
                </div>
             )}
             
             <div className="grid grid-cols-10 gap-1 bg-zinc-900/50 p-2 rounded-sm border border-zinc-700 w-full">
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
                       <>
                           <img 
                             src={(() => {
                                 const url = cell.character.customImageUrl || cell.character.images.jpg.image_url;
                                 if (url.startsWith('data:') || url.startsWith('blob:')) return url;
                                 return `/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`;
                             })()} 
                             alt={cell.character.name}
                             className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none" 
                             loading="eager"
                           />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-center pb-1 pointer-events-none">
                             <p className="text-[10px] text-white font-bold text-center px-1 truncate w-full shadow-black drop-shadow-md">
                                {cell.character.name}
                             </p>
                          </div>
                       </>
                    ) : ( 
                       <div className="w-full h-full flex items-center justify-center text-zinc-900 font-bold text-xs select-none">
                         {idx + 1}
                       </div>
                    )}
                  </div>
                ))}
             </div>
             <p className="text-center text-zinc-600 text-[10px] mt-4 uppercase tracking-wider export-exclude">Drag to Move • Drag Out to Delete</p>
             
             {/* Credit Footer */}
             <div className="text-center mt-2 export-exclude">
               <a 
                 href="https://x.com/omuricep/status/1511279132487094277" 
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 text-sm font-bold bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
               >
                 <Link className="w-3.5 h-3.5 text-pink-500" />
                 Challenge Credit: #CHALLENGEอายุน้อยร้อยเมน by @omuricep
                 {/* X Logo */}
                 <svg viewBox="0 0 24 24" aria-label="X (formerly Twitter)" className="w-3 h-3 fill-purple-500">
                    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
                 </svg>
               </a>
             </div>
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
                         <div 
                           key={i} 
                           onClick={() => handleApplySuggestion(s)}
                           className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg hover:border-pink-500/50 transition-colors cursor-pointer"
                         >
                           <div className="flex justify-between items-start">
                              <div>
                                 <p className="font-bold text-sm text-zinc-200">{s.name}</p>
                                 <p className="text-xs text-zinc-500">{s.from}</p>
                              </div>
                              <div className="p-1.5 bg-zinc-800 rounded text-purple-400">
                                 <Search className="w-3 h-3"/>
                              </div>
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
                        {/* Custom search input */}
                        <div className="px-2 mb-3">
                           <div className="relative flex gap-1">
                              <input 
                                 className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg py-1.5 px-3 text-xs focus:ring-2 focus:ring-pink-500 outline-none placeholder-zinc-500"
                                 placeholder="Add keywords (e.g., wallpaper, fanart)"
                                 value={gallerySearchQuery}
                                 onChange={e => setGallerySearchQuery(e.target.value)}
                                 onKeyDown={e => e.key === 'Enter' && searchGalleryWithQuery()}
                              />
                              <button
                                 onClick={searchGalleryWithQuery}
                                 disabled={isGalleryLoading}
                                 className="px-3 py-1.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
                              >
                                 <Search className="w-3 h-3"/>
                              </button>
                           </div>
                           <p className="text-[10px] text-zinc-600 mt-1 px-1">
                              Searching: {galleryTargetName} {gallerySearchQuery && `+ "${gallerySearchQuery}"`}
                           </p>
                        </div>
                        {isGalleryLoading ? (
                           <div className="flex justify-center py-10"><Loader2 className="animate-spin text-pink-500"/></div>
                        ) : galleryImages.length > 0 ? (
                           <div className="grid grid-cols-2 gap-2">
                              {galleryImages.map((img, i) => (
                                 <div
                                    key={i}
                                    draggable
                                    onDragStart={(e) => handleDragStartFromGallery(e, img)}
                                    onDragEnd={handleDragEnd}
                                    onClick={() => {
                                        // Create char object for selection
                                        const char: Character = {
                                           mal_id: Date.now() + Math.floor(Math.random() * 10000),
                                           name: galleryTargetName || "Character",
                                           // Use thumbnail first to avoid hotlink/cors issues
                                           images: { jpg: { image_url: img.thumbnail || img.url } },
                                           customImageUrl: img.thumbnail || img.url
                                        };
                                        // Just select, don't re-fetch gallery
                                        setSelectedCharacter(char);
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
    
    {/* Replace Confirmation Modal */}
    {pendingReplace && (
       <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
             <h3 className="text-lg font-bold text-white mb-4 text-center">Replace Character?</h3>
             
             <div className="flex items-center justify-center gap-4 mb-6">
                <div className="text-center">
                   <img src={pendingReplace.oldChar.customImageUrl || pendingReplace.oldChar.images.jpg.image_url} 
                      alt={pendingReplace.oldChar.name}
                      className="w-20 h-24 rounded-lg object-cover mx-auto mb-2 border border-red-500/50"
                   />
                   <p className="text-xs text-zinc-400 truncate w-20">{pendingReplace.oldChar.name}</p>
                </div>
                <span className="text-2xl text-zinc-500">→</span>
                <div className="text-center">
                   <img src={pendingReplace.newChar.customImageUrl || pendingReplace.newChar.images.jpg.image_url}
                      alt={pendingReplace.newChar.name}
                      className="w-20 h-24 rounded-lg object-cover mx-auto mb-2 border border-green-500/50"
                   />
                   <p className="text-xs text-zinc-400 truncate w-20">{pendingReplace.newChar.name}</p>
                </div>
             </div>
             
             <div className="flex gap-3">
                <button 
                   onClick={() => setPendingReplace(null)}
                   className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg font-medium transition-colors"
                >
                   Cancel
                </button>
                <button 
                   onClick={() => {
                      setGrid(prev => {
                         const next = [...prev];
                         next[pendingReplace.index] = { character: pendingReplace.newChar };
                         return next;
                      });
                      setLastDroppedIndex(pendingReplace.index);
                      setTimeout(() => setLastDroppedIndex(null), 300);
                      setPendingReplace(null);
                   }}
                   className="flex-1 py-2 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium hover:opacity-90"
                >
                   Replace
                </button>
             </div>
          </div>
       </div>
    )}

       {/* Save/Load Modal */}
       {showSaveLoadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
             <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl shadow-2xl p-6 relative">
                <button 
                  onClick={() => setShowSaveLoadModal(false)}
                  className="absolute right-4 top-4 p-1 text-zinc-500 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5"/>
                </button>
                
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                   <Save className="w-5 h-5 text-green-500"/>
                   Save / Load Progress
                </h2>
                
                <div className="flex gap-2 mb-4 bg-zinc-950 p-1 rounded-lg">
                   <button 
                      onClick={() => {
                          setSaveLoadTab('save');
                          // Regenerate JSON when switching back to Save tab
                          const data = grid.map((cell, idx) => {
                                if (!cell.character) return null;
                                return {
                                    i: idx,
                                    m: cell.character.mal_id,
                                    n: cell.character.name,
                                    img: cell.character.images.jpg.image_url,
                                    c_img: cell.character.customImageUrl,
                                    s: cell.character.source
                                };
                          }).filter(Boolean);
                          setJsonInput(JSON.stringify(data));
                      }}
                      className={cn("flex-1 py-2 text-sm font-medium rounded-md transition-all", saveLoadTab === 'save' ? "bg-zinc-800 text-white shadow" : "text-zinc-500 hover:text-zinc-300")}
                   >
                      Save (Export)
                   </button>
                   <button 
                      onClick={() => { setSaveLoadTab('load'); setJsonInput(""); }}
                      className={cn("flex-1 py-2 text-sm font-medium rounded-md transition-all", saveLoadTab === 'load' ? "bg-zinc-800 text-white shadow" : "text-zinc-500 hover:text-zinc-300")}
                   >
                      Load (Import)
                   </button>
                </div>
                
                {saveLoadTab === 'save' ? (
                   <div className="space-y-4">
                      <p className="text-sm text-zinc-400">
                         Save this code to continue later. Copy it or download as a file.
                      </p>
                      <div className="relative">
                         <textarea 
                            value={jsonInput}
                            readOnly
                            className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 resize-none focus:ring-1 focus:ring-green-500 outline-none"
                         />
                         <button 
                            onClick={handleCopyJson}
                            className="absolute top-2 right-2 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 hover:text-white transition-all"
                            title="Copy to Clipboard"
                         >
                            {copySuccess ? <Check className="w-4 h-4 text-green-500"/> : <Copy className="w-4 h-4"/>}
                         </button>
                      </div>
                      <button 
                         onClick={handleDownloadJson}
                         className="w-full py-2 bg-green-900/40 hover:bg-green-900/60 text-green-400 border border-green-900 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                      >
                         <FileJson className="w-4 h-4"/>
                         Download .json File
                      </button>
                   </div>
                ) : (
                   <div className="space-y-4">
                      <p className="text-sm text-zinc-400">
                         Paste your save code here, or drag & drop a .json file.
                      </p>
                      <div 
                         onDragOver={(e) => e.preventDefault()}
                         onDrop={(e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.json')) {
                               const reader = new FileReader();
                               reader.onload = (ev) => setJsonInput(ev.target?.result as string || "");
                               reader.readAsText(file);
                            }
                         }}
                         className="relative"
                      >
                         <textarea 
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            placeholder='Paste JSON here...'
                            className="w-full h-64 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-300 resize-none focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
                         />
                      </div>
                      <button 
                         onClick={handleLoadJson}
                         disabled={!jsonInput.trim()}
                         className="w-full py-2 bg-blue-900/40 hover:bg-blue-900/60 text-blue-400 border border-blue-900 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                         <Upload className="w-4 h-4"/>
                         Load Data to Grid
                      </button>
                   </div>
                )}
             </div>
          </div>
       )}

        {/* Toast Notification */}
        {notification && (
           <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
              <div className={cn(
                  "flex items-center gap-3 px-6 py-3 rounded-full shadow-2xl backdrop-blur-md border",
                  notification.type === 'success' ? "bg-green-950/80 border-green-500/50 text-green-200" :
                  notification.type === 'error' ? "bg-red-950/80 border-red-500/50 text-red-200" :
                  "bg-zinc-800/80 border-zinc-700/50 text-zinc-200"
              )}>
                  {notification.type === 'success' && <Check className="w-5 h-5 text-green-500"/>}
                  {notification.type === 'error' && <AlertCircle className="w-5 h-5 text-red-500"/>}
                  {notification.type === 'info' && <Info className="w-5 h-5 text-blue-400"/>}
                  <span className="font-medium text-sm">{notification.message}</span>
              </div>
           </div>
        )}
    </>
  );
}
