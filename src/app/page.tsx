"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Download, X, Trash2, Loader2, Sparkles, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, ImageIcon, Images, Lightbulb, GripVertical, Upload, Link, Save, FileJson, Copy, Check, AlertCircle, Info, Menu, Share2, Pencil, CheckSquare, MousePointer2, ArrowRight } from "lucide-react";
import { toBlob } from "html-to-image";
import { MouseSensor, TouchSensor, useSensor, useSensors, DndContext, DragStartEvent, DragEndEvent, pointerWithin } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { Character, GridCell, ImageResult, AnalysisResult, VerdictFeedback } from "@/types";
import { GridCell as GridComponent } from "@/components/grid/GridCell";
import { DraggableSidebarItem } from "@/components/sidebar/DraggableSidebarItem";
import { DragOverlayWrapper } from "@/components/dnd/DragOverlayWrapper";
import { TrashZone } from "@/components/dnd/TrashZone";
import { ShareModal } from "@/components/share/ShareModal";

import { AnalysisModal } from "@/components/analysis/AnalysisModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

// --- Types ---
interface Notification {
  message: string;
  type: 'success' | 'error' | 'info';
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
  // --- Sensors ---
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 10 }, // Require 10px movement before drag starts
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 15 }, // Faster activation for mobile
    })
  );

  const [_activeId, setActiveId] = useState<string | null>(null);
  const [activeDragData, setActiveDragData] = useState<{ character?: Character; index?: number | null; type?: string } | null>(null);
  // --- State: Grid ---
  const [grid, setGrid] = useState<GridCell[]>(() =>
    Array(100).fill(null).map(() => ({ character: null }))
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false); // Default closed to satisfy mobile requirement
  const [mounted, setMounted] = useState(false);
  const [showNameHint, setShowNameHint] = useState(false);

  useEffect(() => {
      setMounted(true);
      // Auto-open gallery on desktop
      if (window.innerWidth >= 1024) {
          setShowRightPanel(true);
      }
  }, []);

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

  // --- State: Right Panel (Gallery & Suggestions) ---
  
  // First visit: show Community tab, otherwise Suggestions
  const [activeTab, setActiveTab] = useState<'suggestions' | 'gallery' | 'community'>(() => {
      if (typeof window !== 'undefined') {
          const hasVisited = localStorage.getItem('waifu100-has-visited');
          if (!hasVisited) {
              localStorage.setItem('waifu100-has-visited', 'true');
              return 'community';
          }
      }
      return 'suggestions';
  });

  // AI Suggestion Hint (shown when user places 5th character)
  const [showAISuggestionHint, setShowAISuggestionHint] = useState(false);
  
  // Community Feed State
  const [communityGrids, setCommunityGrids] = useState<{id: string; title: string; imageUrl: string | null; createdAt: string}[]>([]);
  const [isCommunityLoading, setIsCommunityLoading] = useState(false);
  
  // Gallery State
  const [galleryImages, setGalleryImages] = useState<ImageResult[]>([]);
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [galleryTargetName, setGalleryTargetName] = useState<string>("");
  const [gallerySearchQuery, setGallerySearchQuery] = useState<string>(""); // Custom search keywords
  
  // --- State: Meta ---
  const [currentTitle, setCurrentTitle] = useState("My 100 Favorite Characters");

  // Suggestions State
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  // --- State: Drag & Drop ---
  const [_draggedCharacter, setDraggedCharacter] = useState<Character | null>(null);
  const [draggedFromIndex, setDraggedFromIndex] = useState<number | null>(null);
  const [_dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [_lastDroppedIndex, setLastDroppedIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const [isExporting, setIsExporting] = useState(false);
  const [showSaveLoadModal, setShowSaveLoadModal] = useState(false);
  const [saveLoadTab, setSaveLoadTab] = useState<'save' | 'load'>('save');
  const [jsonInput, setJsonInput] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  // Reverted format toggle to ensure stability
  const gridRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);

  // --- File Picker Load Logic ---
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (ev) => {
          setJsonInput(ev.target?.result as string || "");
      };
      reader.readAsText(file);
      // Reset
      e.target.value = "";
  };
  
// ... (Adding this block requires carefully targeting the file. 
// I will split this into two replacements to be safe.
// First: Add Ref and Handler. Second: Update UI.)

  
  // --- State: URL Modal ---
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlNameInput, setUrlNameInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  
  // --- State: Name Editing ---
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameInput, setEditNameInput] = useState("");
  
  // --- State: Share Modal ---
  const [showShareModal, setShowShareModal] = useState(false);
  
  // --- State: Clear Grid Confirmation ---
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  // --- State: Save/Load UI ---
  const [isDragOver, setIsDragOver] = useState(false);
  
  // --- State: Gallery Hint ---
  const [showGalleryHint, setShowGalleryHint] = useState(false);
  const [galleryUsageCount, setGalleryUsageCount] = useState(0);
  const [hasShownGalleryHint, setHasShownGalleryHint] = useState(false); 

  // --- State: Search Hint ---
  const [showSearchHint, setShowSearchHint] = useState(false);
  const [hasShownSearchHint, setHasShownSearchHint] = useState(false);

  // --- State: AI Hint ---
  const [hasShownAIHint, setHasShownAIHint] = useState(false);

  useEffect(() => {
      const count = parseInt(localStorage.getItem('waifu100-gallery-usage-count') || '0', 10);
      setGalleryUsageCount(count);
  }, []);
  

  
  // --- State: Analysis Modal ---
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [verdict, setVerdict] = useState<AnalysisResult | null>(null);
  const [verdictFeedback, setVerdictFeedback] = useState<VerdictFeedback>(null);
  
  // --- State: Multi-Select ---
  const [selectionMode, setSelectionMode] = useState<'none' | 'grid'>('none');
  const [selectedGridIndices, setSelectedGridIndices] = useState<Set<number>>(new Set());
  
  // --- State: Drag-to-Select ---
  const isSelectionDragging = useRef(false);
  const selectionDragAction = useRef<'add' | 'remove'>('add');

  // --- State: Replace Confirmation ---
  const [pendingReplace, setPendingReplace] = useState<{index: number, newChar: Character, oldChar: Character} | null>(null);

  // --- Handlers: Multi-Select ---
  const toggleGridSelection = (index: number) => {
      const next = new Set(selectedGridIndices);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setSelectedGridIndices(next);
  };
  
  // Drag Select Handlers
  const handleGridMouseDown = (index: number) => {
      if (selectionMode !== 'grid') return;
      
      isSelectionDragging.current = true;
      const isSelected = selectedGridIndices.has(index);
      selectionDragAction.current = isSelected ? 'remove' : 'add';
      
      // Apply immediate action
      const next = new Set(selectedGridIndices);
      if (selectionDragAction.current === 'add') next.add(index);
      else next.delete(index);
      setSelectedGridIndices(next);
  };

  const handleGridMouseEnter = (index: number) => {
      if (selectionMode !== 'grid' || !isSelectionDragging.current) return;
      
      const next = new Set(selectedGridIndices);
      if (selectionDragAction.current === 'add') next.add(index);
      else next.delete(index);
      setSelectedGridIndices(next);
  };
  
  const handleGlobalMouseUp = () => {
      isSelectionDragging.current = false;
  };

  // Effect to handle global mouse up
  useEffect(() => {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  const handleBulkDelete = () => {
      setGrid(prev => prev.map((cell, i) => 
          selectedGridIndices.has(i) ? { character: null } : cell
      ));
      showNotification(`Deleted ${selectedGridIndices.size} items`, 'success');
      setSelectedGridIndices(new Set());
      setSelectionMode('none');
  };

  const handleBulkFill = () => {
      if (!selectedCharacter) {
          showNotification("Select a character from the sidebar (Gallery/Suggestions) first!", "error");
          return;
      }
      
      setGrid(prev => prev.map((cell, i) => 
          selectedGridIndices.has(i) ? { character: selectedCharacter } : cell
      ));
      
      showNotification(`Filled ${selectedGridIndices.size} items with ${selectedCharacter.name}`, 'success');
      setSelectedGridIndices(new Set());
      setSelectionMode('none');
      setSelectedCharacter(null); // Optional: clear selection after fill? Maybe keep it for repeated use? 
      // User likely wants to clear to see result fully, or keep to fill more? 
      // Let's clear for now to match "done" state.
  };

  // --- Persistence ---
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { 
         const parsed = JSON.parse(saved);
         if (Array.isArray(parsed)) {
            setGrid(parsed);
         } else if (parsed.grid) {
            setGrid(parsed.grid);
            if (parsed.verdict) setVerdict(parsed.verdict);
            if (parsed.verdictFeedback) setVerdictFeedback(parsed.verdictFeedback);
         }
      } catch (e) { console.error(e); }
    }
  }, []);

  // Track if we've already shown the storage warning this session
  const storageWarningShown = useRef(false);

  useEffect(() => {
    try {
      // Save grid + verdict + feedback
      // We use a wrapper object if verdict exists, otherwise fallback to array for backward compat?
      // Actually, let's just save the wrapper object. Load logic handles migration.
      const data = {
         grid,
         verdict,
         verdictFeedback
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      storageWarningShown.current = false; // Reset if save succeeds
    } catch (e: unknown) {
      const error = e as { name?: string; message?: string };
      if ((error.name === 'QuotaExceededError' || error.message?.includes('exceeded the quota')) 
          && !storageWarningShown.current) {
         storageWarningShown.current = true;
         showNotification("Storage nearly full. Your changes are saved in memory.", 'info');
         console.warn("Storage Quota Exceeded - changes saved in memory only");
      }
    }
  }, [grid, showNotification]);

  // --- Community Feed Logic (Manual Refresh Only) ---
  const fetchCommunity = useCallback(async () => {
      setIsCommunityLoading(true);
      try {
          const res = await fetch('/api/community');
          if (res.ok) {
              const data = await res.json();
              setCommunityGrids(data.grids || []);
          }
      } catch (e) {
          console.error("Failed to fetch community feed", e);
      } finally {
          setIsCommunityLoading(false);
      }
  }, []);

  // Auto-fetch community when tab is opened (first time or cached is empty)
  useEffect(() => {
      if (activeTab === 'community' && communityGrids.length === 0) {
          fetchCommunity();
      }
  }, [activeTab, communityGrids.length, fetchCommunity]);

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
           const mapped: Character[] = (data.characters || []).map((c: { id: number; jikan_id?: number; name: string; images: { jpg: { image_url: string } }; source?: string }) => ({
              mal_id: c.id, 
              jikan_id: c.jikan_id,
              name: c.name,
              images: c.images,
              source: c.source
           }));
           setCharacterResults(mapped);

           // Show Search Hint if results found, no character selected, and user hasn't seen it this session
           if (mapped.length > 0 && !selectedCharacter && !hasShownSearchHint) {
               setShowSearchHint(true);
               setHasShownSearchHint(true);
           }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    };
    doSearch();
  }, [debouncedQuery, searchQuery, selectedCharacter, hasShownSearchHint]);

  // --- Gallery Logic ---
  const openGallery = useCallback(async (char: Character, customQuery?: string) => {
    setShowRightPanel(true);
    setActiveTab('gallery');
    setGalleryTargetName(char.name);
    setGalleryImages([]);
    
    setIsGalleryLoading(true);
    setSelectedCharacter(char);

    // Increment usage count
    const newCount = galleryUsageCount + 1;
    setGalleryUsageCount(newCount);
    localStorage.setItem('waifu100-gallery-usage-count', newCount.toString());

    // FIX: Skip search for Manual Uploads / URLs
    if (char.source === "Uploaded" || char.source === "URL" || char.source === "Web Search") {
        setGalleryImages([]);
        setIsGalleryLoading(false);
        return;
    }

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
      setIsMobileSidebarOpen(true); // Switch to search view so user sees results
  };

  // --- Selection Logic ---
  const handleSelectCharacter = (char: Character) => {
    setShowSearchHint(false); // Hide hint on selection
    // Fix: Always hide name hint when switching characters
    setShowNameHint(false);
    
    setSelectedCharacter(char);
    openGallery(char); // Auto-find more images
    setIsMobileSidebarOpen(false); // Close search sidebar to show Gallery (Right Panel)
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
  // --- Drag & Drop Handlers (dnd-kit) ---
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setActiveId(active.id as string);
    setDraggedCharacter(active.data.current?.character || null);
    setDraggedFromIndex(active.data.current?.index ?? null);
    setIsDragging(true);
    setShowSearchHint(false); // Hide hint on drag start

    // Set activeDragData for DragOverlay to render the dragged item
    setActiveDragData({
        character: active.data.current?.character,
        index: active.data.current?.index ?? null,
        type: active.data.current?.type
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    
    // Reset States
    setActiveId(null);
    setActiveDragData(null);
    setDraggedCharacter(null);
    setDraggedFromIndex(null);
    setDragOverIndex(null);
    setIsDragging(false);

    if (!over) return;

    const sourceData = active.data.current;
    const targetData = over.data.current;

    // 1. Drop on Trash
    if (targetData?.type === 'trash') {
        if (sourceData?.index !== undefined && sourceData.index !== null) {
             setGrid(prev => {
                const next = [...prev];
                next[sourceData.index] = { character: null };
                return next;
             });
        }
        return;
    }

    // 2. Drop on Grid Cell
    if (targetData?.type === 'cell') {
         const targetIndex = targetData.index;
         const sourceIndex = sourceData?.index;
         const char = sourceData?.character;

         if (!char) return;

         // Move Logic (Swap)
         if (sourceIndex !== undefined && sourceIndex !== null) {
             // Don't do anything if dropped on same cell
             if (sourceIndex === targetIndex) return;

             setGrid(prev => {
                const next = [...prev];
                const targetChar = next[targetIndex].character;
                next[targetIndex] = { character: char };
                next[sourceIndex] = { character: targetChar }; // Swap
                return next;
             });
         } else {
             // New Item Logic (from Sidebar/Gallery)
             const existingChar = grid[targetIndex].character;
             if (existingChar) {
                 setPendingReplace({ index: targetIndex, newChar: char, oldChar: existingChar });
             } else {
                 setGrid(prev => {
                    const next = [...prev];
                    next[targetIndex] = { character: char };
                    return next;
                 });
             }
         }
         
         // Hint Logic: AI hint takes priority over Gallery hint
         // UPDATED: Trigger on first drag of session (removed currentCount check)
         const shouldShowAIHint = !hasShownAIHint;
         
         if (shouldShowAIHint) {
             // Trigger AI Suggestion Hint when user first drops an item (Once per session)
             setHasShownAIHint(true);
             setTimeout(() => {
                 setShowAISuggestionHint(true);
             }, 500);
         } else if (sourceData?.type === 'sidebar' && !hasShownGalleryHint) {
             // Trigger Gallery Hint only if NOT showing AI hint (Once per session)
             setHasShownGalleryHint(true);
             setShowGalleryHint(true);
             // Auto-hide after 10 seconds if not interacted with
             setTimeout(() => {
                 setShowGalleryHint(false);
             }, 10000);
         }
         
         setLastDroppedIndex(targetIndex);
         setTimeout(() => setLastDroppedIndex(null), 300);
    }
  };

  // --- Export ---
  // --- Export ---
  // --- Export ---
  // --- Export Helper ---
  const getGridBlob = async (_filename: string) => {
    if (!gridRef.current) return null;
    
    // Options for high-quality export
    const options = { 
        quality: 0.95, 
        pixelRatio: 2, 
        backgroundColor: "#000",
        includeQueryParams: true, // CRITICAL: Treat each Next.js optimized URL as unique
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

    // 1. Force Styles for Export
    const nodes = gridRef.current.querySelectorAll('.grid');
    nodes.forEach(n => {
        const el = n as HTMLElement;
        el.style.width = '950px';
        el.style.height = '950px';
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
    
    gridRef.current.style.width = '1080px';
    gridRef.current.style.height = '1080px';
    gridRef.current.style.maxWidth = 'none';
    gridRef.current.style.maxHeight = 'none';
    gridRef.current.style.aspectRatio = 'unset';
    gridRef.current.style.padding = '0';
    gridRef.current.style.margin = '0';
    
    const cells = gridRef.current.querySelectorAll('.grid > div');
    cells.forEach((c, idx) => {
        const el = c as HTMLElement;
        el.style.width = '95px';
        el.style.height = '95px';
        el.style.border = 'none';
        el.style.borderRadius = '0';
        el.style.minWidth = '95px';
        el.style.minHeight = '95px';
        
        if (!grid[idx]?.character) {
            el.style.backgroundImage = 'none';
            el.style.backgroundColor = '#000000';
            el.setAttribute('data-export-empty', 'true');
            
            // Aggressively remove ghost images and clear backgrounds
            const imgs = el.querySelectorAll('img');
            imgs.forEach(img => img.remove());
            
            // Clear background images on all descendants to prevent ghosting
            const descendants = el.querySelectorAll('*');
            descendants.forEach(d => {
                (d as HTMLElement).style.backgroundImage = 'none';
            });
        }
    });

    try {
        // Generate Blob - wrapped in try-catch as external images may cause CORS issues
        return await toBlob(gridRef.current, options);
    } catch (e) {
        console.error("Grid capture failed:", e);
        return null; // Return null on failure, share will proceed without thumbnail
    } finally {
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
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
       const now = new Date();
       const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
       const filename = `waifu100-challenge-${timestamp}.png`;
       const blob = await getGridBlob(filename);
       
       if (!blob) throw new Error("Blob generation failed");

       // Try Modern File System Access API (Save As Dialog)
       if ('showSaveFilePicker' in window) {
          try {
             const handle = await (window as unknown as { showSaveFilePicker: (options: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                   description: 'PNG Image',
                   accept: { 'image/png': ['.png'] },
                }],
             });
             const writable = await handle.createWritable();
             await writable.write(blob);
             await writable.close();
             return; 
          } catch (err: unknown) {
             const error = err as { name?: string };
             if (error.name === 'AbortError') return; 
          }
       }

       // Fallback: Legacy Direct Download
       const url = URL.createObjectURL(blob);
       const link = document.createElement("a");
       link.download = filename;
       link.href = url;
       link.click();
       URL.revokeObjectURL(url);

    } catch(e: unknown) { 
       console.error("Export Error:", e);
       const errMsg = e instanceof Error ? e.message : String(e);
       showNotification(`Export failed: ${errMsg}`, 'error');
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
    
    // Create export object
    const exportData = {
        grid: data,
        verdict,
        verdictFeedback,
        title: currentTitle
    };

    setJsonInput(JSON.stringify(exportData)); 
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
      const now = new Date();
      // Format: YYYY-MM-DD_HH-mm-ss
      const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
      const filename = `waifu100-save-${timestamp}.json`;
      const blob = new Blob([jsonInput], { type: "application/json" });
      
      // Try Modern File System Access API (Save As Dialog)
      if ('showSaveFilePicker' in window) {
         try {
            const handle = await (window as unknown as { showSaveFilePicker: (options: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
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
         } catch (err: unknown) {
            const error = err as { name?: string };
            if (error.name === 'AbortError') return; // User cancelled
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any[] = [];
      const input = jsonInput.trim();

      // Scavenger Function: Finds balanced {...} objects in 'soup'
      const scavenge = (str: string) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
             // Handle new object format vs legacy array
             if (!Array.isArray(parsed) && parsed.grid && Array.isArray(parsed.grid)) {
                 data = parsed.grid;
                 if (parsed.verdict) setVerdict(parsed.verdict);
                 if (parsed.verdictFeedback) setVerdictFeedback(parsed.verdictFeedback);
                 // We don't overwrite title here because step 5 handles it below if we didn't extract it here?
                 // Actually step 5 logic re-parses input. Let's just set it here if available and rely on step 5 as fallback or redundancy.
                 if (parsed.title) setCurrentTitle(parsed.title);
             } else {
                 data = Array.isArray(parsed) ? parsed : [parsed];
             }
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
         
         // 5. Extract Title if available (User Request)
         // We re-parse the input safely to check for metadata object structure
         // (Variable 'parsed' was not available in this scope previously)
         try {
             const rawObj = JSON.parse(input);
             if (!Array.isArray(rawObj) && typeof rawObj === 'object') {
                 if (rawObj.title && typeof rawObj.title === 'string') {
                     setCurrentTitle(rawObj.title);
                 } else if (rawObj.meta?.title && typeof rawObj.meta.title === 'string') {
                     setCurrentTitle(rawObj.meta.title);
                 }
             }
         } catch (e) { /* Ignore title extraction errors */ }

         // Create new grid
         const newGrid = Array(100).fill(null).map(() => ({ character: null as Character | null }));
         let loadedCount = 0;

         // Universal Loader (Handles Mixed Formats)
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         data.forEach((item: any, index: number) => {
             let gridIndex = -1;
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // Trigger hint - persists until user edits
          setShowNameHint(true);
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
        name: urlNameInput.trim() || "Custom Character",
        images: { jpg: { image_url: url } },
        customImageUrl: url,
        source: "URL"
      };
      setSelectedCharacter(customChar);
      openGallery(customChar); // Open sidebar but skip search
      setShowUrlModal(false);
      setUrlInput("");
      setUrlNameInput("");
      // Trigger hint - persists until user edits
      setShowNameHint(true);
    } catch {
      setUrlError("Could not load image. Check URL or CORS.");
    } finally {
      setIsValidatingUrl(false);
    }
  };

  const filledCount = grid.filter(c => c.character).length;

  if (!mounted) return null;

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={pointerWithin} // Use pointer for aiming at cursor/finger location
      onDragStart={handleDragStart} 
      onDragEnd={handleDragEnd}
      // autoScroll is enabled by default in dnd-kit
    >
    <div className="min-h-screen bg-black flex flex-col lg:flex-row text-white font-sans h-screen overflow-hidden">
      
      {/* Mobile Sidebar Backdrop */}
      {isMobileSidebarOpen && (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Mobile Burger Menu - Fixed Positioning */}
      <button 
        onClick={() => setIsMobileSidebarOpen(true)}
        className="lg:hidden fixed top-4 left-4 p-2 bg-zinc-800/80 backdrop-blur rounded-lg text-zinc-300 hover:text-white z-50 border border-zinc-700 shadow-xl"
      >
        <Menu className="w-5 h-5"/>
      </button>

      {/* 1. LEFT SIDEBAR: Character Discovery */}
      <aside className={cn(
          "fixed inset-y-0 left-0 z-50 w-80 bg-zinc-950 border-r border-zinc-800 flex flex-col shadow-xl shrink-0 transition-transform duration-300 lg:static lg:translate-x-0",
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
          <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
            Waifu100
          </h1>
          <button onClick={() => setIsMobileSidebarOpen(false)} className="lg:hidden p-1 text-zinc-400 hover:text-white">
            <X className="w-6 h-6"/>
          </button>
        </div>
        <div className="px-4 pb-2 relative">
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
                         Search Web Images for &quot;{searchQuery}&quot;
                      </button>
                   </div>
                ) : (
                   <p className="text-zinc-500 text-sm mb-4">Search for your favorite characters to start.</p>
                )}
             </div>
          ) : (
             <div className="space-y-2">
               {characterResults.map((char, idx) => (
                  <DraggableSidebarItem
                    key={`${char.mal_id}-${idx}`}
                    char={char}
                    onClick={() => handleSelectCharacter(char)}
                  >
                     <div className={cn(
                       "group flex items-center gap-3 p-2 rounded-lg cursor-grab active:cursor-grabbing border transition-all w-full",
                       selectedCharacter?.mal_id === char.mal_id ? "bg-purple-900/20 border-purple-500" : "bg-zinc-900/50 border-transparent hover:bg-zinc-800"
                     )}>
                       <img src={char.images.jpg.image_url} alt={char.name} className="w-16 h-20 rounded-lg object-cover bg-zinc-800 shrink-0 pointer-events-none select-none"/>
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
                  </DraggableSidebarItem>
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
              onClick={() => {
                  if (verdictFeedback) {
                      setVerdict(null); // Force re-analyze
                      setVerdictFeedback(null); // Reset feedback
                  }
                  setShowAnalysisModal(true);
              }}
              disabled={filledCount < 2}
              className="w-full py-2 mb-2 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 text-yellow-500 border border-yellow-600/30 hover:bg-yellow-600/30 rounded-lg font-medium flex justify-center items-center gap-2 text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
           >
              <Sparkles className="w-4 h-4 group-hover:rotate-12 transition-transform"/>
              Ask AI About My Taste
           </button>

           <div className="flex gap-2 mt-2">
                <button 
                  onClick={() => setShowShareModal(true)}
                  className="hidden sm:flex items-center justify-center gap-2 px-3 py-1.5 bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 rounded-lg transition-colors border border-sky-500/30 text-sm font-medium flex-1"
                >
                    <Share2 size={16} />
                    <span>Share</span>
                </button>

                <button 
                  onClick={handleExport}
                  disabled={isExporting}
                  className="hidden sm:flex items-center justify-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors border border-purple-600/30 text-sm font-medium flex-1"
                >           {isExporting ? <Loader2 className="animate-spin w-4 h-4"/> : <Download className="w-4 h-4"/>}
             Save as .png
           </button>
           </div>

           {/* Clear Grid Button */}
           <button 
              onClick={() => setShowClearConfirm(true)}
              disabled={filledCount === 0}
              className="w-full mt-2 py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 text-red-400 hover:text-red-300 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
           >
              <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform"/>
              Clear Grid
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
               <DraggableSidebarItem
                   char={selectedCharacter}
                   onClick={() => {}}
                >
                   <div className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-zinc-900 mb-4 border border-zinc-800 cursor-grab active:cursor-grabbing hover:border-purple-500 transition-colors">
                      
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
            </DraggableSidebarItem>
               <div className="mb-1 min-h-[32px] flex items-center relative">
                   {showNameHint && 
                    (selectedCharacter.source === "Uploaded" || selectedCharacter.source === "URL") && (
                       <div className="absolute top-full left-24 mt-2 z-50 animate-in fade-in slide-in-from-top-2 duration-300 pointer-events-none">
                           <div className="bg-white text-zinc-900 text-[10px] font-bold px-3 py-1.5 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.5)] flex items-center gap-1.5 whitespace-nowrap border border-zinc-200 relative">
                               <Pencil className="w-3 h-3 text-purple-600 fill-purple-600/10"/>
                               <span>Tap to edit</span>
                               {/* Top Arrow - shifted to match new position */}
                               <div className="absolute -top-1 left-2 w-2.5 h-2.5 bg-white rotate-45 transform border-t border-l border-zinc-200"></div>
                           </div>
                       </div>
                   )}
                   {isEditingName ? (
                       <div className="flex gap-2 w-full animate-in fade-in duration-200">
                           <input 
                               className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-white focus:ring-2 focus:ring-purple-500 outline-none"
                               value={editNameInput}
                               onChange={(e) => setEditNameInput(e.target.value)}
                               autoFocus
                               onKeyDown={(e) => {
                                   if (e.key === 'Enter') {
                                       const newName = editNameInput.trim() || selectedCharacter.name;
                                       const updatedChar = { ...selectedCharacter, name: newName };
                                       setSelectedCharacter(updatedChar);
                                       setGrid(prev => prev.map(cell => {
                                           if (cell.character && cell.character.customImageUrl === selectedCharacter.customImageUrl) {
                                               return { ...cell, character: { ...cell.character, name: newName } };
                                           }
                                           return cell;
                                       }));
                                       setIsEditingName(false);
                                   } else if (e.key === 'Escape') {
                                       setIsEditingName(false);
                                   }
                               }}
                           />
                           <button 
                               onClick={() => {
                                   const newName = editNameInput.trim() || selectedCharacter.name;
                                   const updatedChar = { ...selectedCharacter, name: newName };
                                   setSelectedCharacter(updatedChar);
                                   setGrid(prev => prev.map(cell => {
                                       if (cell.character && cell.character.customImageUrl === selectedCharacter.customImageUrl) {
                                           return { ...cell, character: { ...cell.character, name: newName } };
                                       }
                                       return cell;
                                   }));
                                   setIsEditingName(false);
                               }}
                               className="p-1.5 bg-green-900/30 text-green-400 rounded hover:bg-green-900/50"
                           >
                               <Check className="w-4 h-4"/>
                           </button>
                           <button 
                               onClick={() => setIsEditingName(false)}
                               className="p-1.5 bg-zinc-800 text-zinc-400 rounded hover:bg-zinc-700"
                           >
                               <X className="w-4 h-4"/>
                           </button>
                       </div>
                   ) : (
                       <div className="flex items-center gap-2 group w-full">
                           <h3 
                               className={cn(
                                   "font-bold text-lg text-white truncate flex-1 transition-colors",
                                   (selectedCharacter.source === "Uploaded" || selectedCharacter.source === "URL" || selectedCharacter.source === "Custom Character" || selectedCharacter.source === "Web Search") 
                                       ? "cursor-pointer hover:text-purple-400" 
                                       : ""
                               )}
                               title={selectedCharacter.name}
                               onClick={() => {
                                   if (selectedCharacter.source === "Uploaded" || selectedCharacter.source === "URL" || selectedCharacter.source === "Custom Character" || selectedCharacter.source === "Web Search") {
                                       setIsEditingName(true);
                                       setEditNameInput(selectedCharacter.name);
                                       setShowNameHint(false); // Hide hint on interaction
                                   }
                               }}
                           >
                               {selectedCharacter.name}
                           </h3>
                           {(selectedCharacter.source === "Uploaded" || selectedCharacter.source === "URL" || selectedCharacter.source === "Custom Character" || selectedCharacter.source === "Web Search") && (
                               <button 
                                   onClick={() => {
                                       setIsEditingName(true);
                                       setEditNameInput(selectedCharacter.name);
                                   }}
                                   className="p-1.5 bg-zinc-800/50 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-all ml-2"
                                   title="Edit Name"
                               >
                                   <Pencil className="w-4 h-4"/>
                               </button>
                           )}
                       </div>
                   )}
               </div>
               <p className="text-sm text-zinc-500 mb-4">{selectedCharacter.source || "Unknown Source"}</p>
               
               <div className="space-y-2">
                  {!["Uploaded", "URL", "Custom", "Web Search", "Custom Character"].includes(selectedCharacter.source || "") && (
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
                  )}
                   <p className="text-xs text-zinc-600 text-center">Drag image to a cell or click a cell</p>
                </div>
            </div>
         </aside>
      )}

      {/* SEARCH HINT (Desktop Only) */}
      {/* Positioned relative to the viewport or flex container, adjusting left to match sidebar width */}
      {showSearchHint && !selectedCharacter && (
          <div className="hidden lg:flex fixed left-80 top-24 z-50 animate-in slide-in-from-left-2 fade-in duration-300 ml-1">
            <div className="flex items-center">
                {/* Triangle pointer */}
                <div className="w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[12px] border-r-pink-600"></div>
                
                <div className="bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg shadow-xl p-4 w-60 text-white relative">
                  <h4 className="font-bold text-sm mb-1 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-yellow-300 animate-pulse"/>
                      Found them!
                  </h4>
                  <p className="text-xs text-pink-100 leading-snug">
                      Drag characters directly to the grid, or click them to see more images.
                  </p>
                  <button 
                      onClick={() => setShowSearchHint(false)}
                      className="absolute top-2 right-2 text-pink-200 hover:text-white"
                  >
                      <X className="w-3 h-3"/>
                  </button>
                </div>
            </div>
          </div>
      )}

      {/* 2. MAIN GRID AREA */}
       <main className="flex-1 bg-black flex flex-col lg:flex-row lg:items-center justify-center p-1 lg:p-8 overflow-auto h-full relative">
         
         {/* Left Delete Zone */}
         {isDragging && draggedFromIndex !== null && (
            <TrashZone id="trash-left" className="hidden lg:flex absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-red-900/80 to-transparent border-r-2 border-dashed border-red-500 items-center justify-start pl-4 z-30">
               <Trash2 className="w-8 h-8 text-red-400 animate-pulse"/>
            </TrashZone>
         )}
         
         {/* Right Delete Zone */}
         {isDragging && draggedFromIndex !== null && (
            <TrashZone id="trash-right" className="hidden lg:flex absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-red-900/80 to-transparent border-l-2 border-dashed border-red-500 items-center justify-end pr-4 z-30">
               <Trash2 className="w-8 h-8 text-red-400 animate-pulse"/>
            </TrashZone>
         )}
         
          <div ref={gridRef} className="bg-black p-1 lg:p-3 shadow-2xl w-full lg:max-w-[calc(100vh-12rem)] mx-auto transition-all pt-12 pb-40 lg:pt-3 lg:pb-3">
             <div className="relative flex items-center justify-center mb-3 px-2">
                 <h2 className="text-xl font-bold tracking-widest uppercase text-zinc-300">#CHALLENGEอายุน้อยร้อยเมน</h2>
                 <button
                    onClick={() => {
                        if (selectionMode === 'grid') {
                            setSelectionMode('none');
                            setSelectedGridIndices(new Set());
                        } else {
                            setSelectionMode('grid');
                             // Clear other modes if any (now only grid mode exists, so just set it)
                        }
                    }}
                    className={cn(
                        "export-exclude absolute right-2 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                        selectionMode === 'grid' 
                            ? "bg-red-900/30 text-red-400 border-red-500/50" 
                            : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                    )}
                 >
                    {selectionMode === 'grid' ? <X size={14} /> : <CheckSquare size={14} />}
                    {selectionMode === 'grid' ? "Cancel" : "Select"}
                 </button>
             </div>
             
             {/* Onboarding Hint */}
             <div className="mb-2 p-2 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg text-center export-exclude">
                <div className="flex items-center justify-center gap-2 text-purple-300 text-sm font-medium mb-1">
                   <GripVertical className="w-4 h-4"/>
                   <span>Drag & Drop to Build Your Grid</span>
                </div>
                <p className="text-[10px] text-zinc-500">Search characters on the left, then drag them here. Drag to reorder or drop on red zones to delete.</p>
             </div>
             
             <div className="grid grid-cols-10 gap-1 bg-zinc-900/50 p-1.5 rounded-sm border border-zinc-700 w-full"
                  onMouseLeave={() => { isSelectionDragging.current = false; }}
             >
                {grid.map((cell, idx) => (
                   <GridComponent
                     key={idx}
                     idx={idx}
                     cell={cell}
                     isSelected={selectedCharacter?.customImageUrl === cell.character?.customImageUrl}
                     isMultiSelected={selectedGridIndices.has(idx)}
                     disableDrag={selectionMode === 'grid'}
                     onMouseDown={(e) => {
                         // Stop propagation to prevent drag-drop interference if needed?
                         // Actually dnd-kit might grab it. We might need to handle event bubbling.
                         // But for now let's just trigger our logic.
                         if (selectionMode === 'grid') {
                            handleGridMouseDown(idx);
                         }
                     }}
                     onMouseEnter={() => {
                         if (selectionMode === 'grid') {
                            handleGridMouseEnter(idx);
                         }
                     }}
                     onClick={() => { 
                         if (selectionMode === 'grid') {
                             // Handled by MouseDown mostly, but click can trigger if not dragging.
                             // toggleGridSelection(idx); 
                         } else if (selectedCharacter) {
                             handleCellClick(idx);
                         } else if(cell.character) { 
                             openGallery(cell.character); 
                         }
                     }}
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
                   </GridComponent>
                 ))}
             </div>
             <p className="text-center text-zinc-600 text-[10px] mt-2 uppercase tracking-wider export-exclude">Drag to Move • Drag Out to Delete</p>
             
             {/* Credit Footer */}
             <div className="text-center mt-1 export-exclude">
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
        <ShareModal 
        isOpen={showShareModal} 
        onClose={() => setShowShareModal(false)} 
        grid={grid}
        onCapture={getGridBlob}
        initialTitle={currentTitle}
        onTitleUpdate={setCurrentTitle}
        verdict={verdict}
        verdictFeedback={verdictFeedback}
        onVerdictGenerate={(v) => {
            setVerdict(v);
            // Also save to localStorage immediately to persist the auto-generated verdict
            const data = {
                grid,
                verdict: v,
                verdictFeedback
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }}
      />

      <ConfirmModal 
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
            // Reset Grid
            setGrid(Array(100).fill(null).map(() => ({ character: null })));
            // Reset Meta
            setCurrentTitle("My 100 Favorite Characters");
            setSelectedCharacter(null);
            // Reset AI
            setVerdict(null);
            setVerdictFeedback(null);
            
            // Reset Gallery Usage Count (User Request)
            setGalleryUsageCount(0);
            localStorage.setItem('waifu100-gallery-usage-count', '0');
            
            showNotification("Grid cleared successfully!", 'success');
        }}
        title="Clear Entire Grid?"
        message="Are you sure you want to delete all characters? This action cannot be undone unless you have a save file."
        confirmText="Clear Everything"
        variant="danger"
      />
      <AnalysisModal 
        isOpen={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        grid={grid}
        result={verdict}
        onResult={setVerdict}
        feedback={verdictFeedback}
        onFeedback={setVerdictFeedback}
      />
    </main>
      {/* 3. RIGHT SIDEBAR: Suggestions & Gallery */}
      <aside className={cn(
        "bg-zinc-950 border-t lg:border-t-0 border-l border-zinc-800 flex flex-col lg:h-screen z-20 shadow-xl shrink-0 transition-all duration-300",
        showRightPanel ? "h-[50vh] w-full lg:w-80" : "h-14 w-full lg:w-12"
      )}>
         
         {/* Toggle / Header */}
         <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-2 bg-zinc-900/50">
             {showRightPanel ? (
                <>
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
                   <button 
                     onClick={() => setActiveTab('community')} 
                     className={cn("flex-1 text-xs py-1.5 rounded-md font-medium transition-colors", activeTab === 'community' ? "bg-indigo-900/30 text-indigo-200 shadow-sm" : "text-zinc-500 hover:text-zinc-300")}
                   >
                     Community
                   </button>
                </div>


                </>
            ) : (
                <div className="flex lg:flex-col items-center justify-center lg:justify-start w-full gap-4 pt-0 lg:pt-4 h-full lg:h-auto">
                   <button onClick={() => setShowRightPanel(true)} title="Expand">
                        <ChevronLeft className="hidden lg:block text-zinc-500"/>
                        <ChevronUp className="lg:hidden text-zinc-500"/>
                   </button>
                </div>
            )}
            
            {showRightPanel && (
              <button onClick={() => setShowRightPanel(false)} className="p-2 hover:bg-zinc-800 rounded text-zinc-500">
                <ChevronRight className="hidden lg:block w-4 h-4"/>
                <ChevronDown className="lg:hidden w-4 h-4"/>
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
                            <p className="text-xs text-zinc-500 mt-2 italic border-t border-zinc-800/50 pt-2">&quot;{s.reason}&quot;</p>
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
                              {galleryImages.map((img, i) => {
                                  // Stable ID generation for gallery items if possible, or use index combined with query
                                  // Using index + timestamp is risky if list changes, but for static list it's ok.
                                  // Better: use img.url as unique key.
                                  const tempId = 990000 + i; 
                                  const char: Character = {
                                     mal_id: tempId,
                                     name: galleryTargetName || "Character",
                                     images: { jpg: { image_url: img.thumbnail || img.url } },
                                     customImageUrl: img.thumbnail || img.url,
                                     source: img.source
                                  };
                                  
                                  return (
                                     <DraggableSidebarItem
                                        key={i}
                                        char={char}
                                        onClick={() => {
                                            const selection = { ...char, mal_id: Date.now() };
                                            setSelectedCharacter(selection);
                                        }}
                                     >
                                      <div className={cn(
                                         "aspect-square relative group rounded-lg overflow-hidden border border-zinc-800 cursor-pointer hover:border-pink-500 transition-all bg-zinc-900 w-full",
                                         selectedCharacter?.customImageUrl === img.url && "ring-2 ring-pink-500 border-transparent"
                                      )}>
                                         <img src={img.thumbnail} className="w-full h-full object-cover pointer-events-none select-none"/>
                                         <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                                            <span className="text-[9px] text-white bg-black/50 px-1 rounded">{img.source}</span>
                                         </div>
                                      </div>
                                     </DraggableSidebarItem>
                                  );
                               })}
                           </div>
                        ) : (
                           <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                              <p className="text-zinc-500 text-sm font-medium mb-1">No images found.</p>
                              <p className="text-zinc-700 text-xs">Try the &quot;Usage Suggestions&quot; tab to find similar characters!</p>
                           </div>
                        )}
                      </>
                   )}
                </div>
             )}


         
             {/* TAB: COMMUNITY */}
             {activeTab === 'community' && (
                <div className="p-4">
                   <div className="text-center mb-6 relative">
                      <button
                          onClick={fetchCommunity}
                          disabled={isCommunityLoading}
                          className="absolute right-0 top-0 p-1.5 text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 rounded-lg transition-all"
                          title="Refresh Feed"
                      >
                          <Loader2 className={cn("w-4 h-4", isCommunityLoading && "animate-spin")}/>
                      </button>
                      <Share2 className="w-8 h-8 text-indigo-500 mx-auto mb-2"/>
                      <h3 className="font-bold text-lg text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-blue-500">Community Grids</h3>
                      <p className="text-xs text-zinc-500">Discover what others are building</p>
                   </div>

                   {isCommunityLoading && communityGrids.length === 0 ? (
                      <div className="flex items-center justify-center py-10">
                         <Loader2 className="w-6 h-6 animate-spin text-indigo-500"/>
                      </div>
                   ) : communityGrids.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                         {communityGrids.map((grid) => (
                            <a 
                               key={grid.id} 
                               href={`/view/${grid.id}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-indigo-500/50 transition-all group"
                            >
                               <div className="aspect-square bg-zinc-950 relative">
                                   {grid.imageUrl ? (
                                       <img src={grid.imageUrl} alt={grid.title} className="w-full h-full object-cover"/>
                                   ) : (
                                       <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                           <span className="text-xs">No Preview</span>
                                       </div>
                                   )}
                                   <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                       <span className="text-xs font-bold text-white bg-indigo-600 px-2 py-1 rounded-full">View</span>
                                   </div>
                               </div>
                               <div className="p-2">
                                   <h4 className="text-xs font-medium text-zinc-300 truncate">{grid.title || "Untitled Grid"}</h4>
                                   <p className="text-[10px] text-zinc-500">{new Date(grid.createdAt).toLocaleDateString()}</p>
                               </div>
                            </a>
                         ))}
                      </div>
                   ) : (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                         <p className="text-zinc-500 text-sm font-medium mb-1">No grids yet.</p>
                         <button onClick={fetchCommunity} className="text-indigo-400 text-xs hover:underline">Click to refresh</button>
                      </div>
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
                      <div className="flex justify-between items-center text-sm text-zinc-400">
                          <span>Paste code or load file:</span>
                          <button 
                             onClick={() => loadRef.current?.click()}
                             className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 px-2 py-1 bg-blue-900/20 rounded hover:bg-blue-900/30 transition-colors"
                          >
                             <FileJson className="w-3 h-3"/>
                             Browse .json
                          </button>
                      </div>
                      
                      {/* Hidden Load Input */}
                      <input 
                          type="file"
                          ref={loadRef}
                          accept=".json"
                          onChange={handleFilePick}
                          className="hidden"
                      />

                      <div 
                         onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragOver(true);
                         }}
                         onDragLeave={() => setIsDragOver(false)}
                         onDrop={(e) => {
                            e.preventDefault();
                            setIsDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.json')) {
                               const reader = new FileReader();
                               reader.onload = (ev) => setJsonInput(ev.target?.result as string || "");
                               reader.readAsText(file);
                            }
                         }}
                         className={cn(
                            "relative rounded-lg transition-all duration-300 border-2 border-dashed group h-64",
                            isDragOver ? "border-green-500 bg-green-900/10" : "border-zinc-700 bg-zinc-950 hover:border-zinc-600"
                         )}
                      >
                         <textarea 
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            className="absolute inset-0 w-full h-full bg-transparent p-4 text-xs font-mono text-zinc-300 resize-none focus:outline-none z-10"
                            placeholder="Paste JSON here..."
                         />
                         
                         {!jsonInput && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 pointer-events-none z-0">
                               <FileJson className={cn("w-10 h-10 mb-3 transition-colors", isDragOver ? "text-green-500" : "text-zinc-600 group-hover:text-zinc-500")} />
                               <p className="font-medium text-sm">Paste JSON or Drag JSON file to here</p>
                            </div>
                         )}
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

        
        {/* Gallery Hint Popup */}
        {showGalleryHint && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-5 fade-in duration-500">
               <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                  <div className="relative flex items-center gap-4 px-6 py-4 bg-zinc-900 rounded-lg leading-none">
                     <div className="p-2 bg-zinc-800 rounded-full text-pink-500 animate-bounce">
                        <Lightbulb className="w-5 h-5" />
                     </div>
                     <div className="text-left">
                        <h4 className="text-zinc-100 font-bold text-sm mb-1">Did you know?</h4>
                        <p className="text-zinc-400 text-xs">Click any character on the grid to change their image!</p>
                     </div>
                     <button 
                        onClick={() => {
                           setShowGalleryHint(false);
                           localStorage.setItem('waifu100-gallery-hint-dismissed', 'true');
                        }}
                        className="p-1 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors ml-2"
                     >
                        <X className="w-4 h-4" />
                     </button>
                  </div>
               </div>
            </div>
        )}

        {/* AI Suggestion Hint Popup (shown after 5 characters) */}
        {showAISuggestionHint && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-5 fade-in duration-500">
               <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200 animate-tilt"></div>
                  <div className="relative flex items-center gap-4 px-6 py-4 bg-zinc-900 rounded-lg leading-none">
                     <div className="p-2 bg-zinc-800 rounded-full text-purple-500 animate-pulse">
                        <Sparkles className="w-5 h-5" />
                     </div>
                     <div className="text-left">
                        <h4 className="text-zinc-100 font-bold text-sm mb-1">Looking for more characters?</h4>
                        <p className="text-zinc-400 text-xs">Try the <span className="text-purple-400 font-medium">AI Suggestions</span> tab!</p>
                     </div>
                     <button 
                        onClick={() => {
                           setShowAISuggestionHint(false);
                           setActiveTab('suggestions');
                        }}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded-lg transition-colors"
                     >
                        Try it
                     </button>
                     <button 
                        onClick={() => {
                           setShowAISuggestionHint(false);
                        }}
                        className="p-1 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
                     >
                        <X className="w-4 h-4" />
                     </button>
                  </div>
               </div>
            </div>
        )}
         {/* Multi-Select Floating Bar (Grid) */}
         {selectionMode === 'grid' && (
             <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
                <div className="flex items-center gap-3 px-6 py-3 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-full shadow-2xl">
                    <span className="text-sm font-bold text-white px-2 border-r border-zinc-700">
                        {selectedGridIndices.size} Selected
                    </span>
                    <button 
                        onClick={handleBulkFill}
                        disabled={selectedGridIndices.size === 0 || !selectedCharacter}
                        className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-full text-xs font-bold transition-colors text-white"
                        title={!selectedCharacter ? "Select a character first" : `Fill with ${selectedCharacter.name}`}
                    >
                        <ArrowRight size={14} />
                        Fill {selectedCharacter ? "Selected" : "(Select Char)"}
                    </button>
                    <button 
                        onClick={handleBulkDelete}
                        disabled={selectedGridIndices.size === 0}
                        className="flex items-center gap-2 px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-full text-xs font-bold transition-colors text-white"
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>
                    <button 
                        onClick={() => {
                            setSelectionMode('none');
                            setSelectedGridIndices(new Set());
                        }}
                        className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-500 hover:text-white transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
             </div>
         )}



         <DragOverlayWrapper activeDragData={activeDragData} />
       </DndContext>
  );
}

// --- Helper Components ---

