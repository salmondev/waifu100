const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/app/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

console.log(`Fixing Syntax in ${filePath}`);

// 1. Fix Sidebar
const sidebarStartMarker = '{characterResults.map((char, idx) => (';
const sidebarEndMarker = '))}';

const sidebarStartIdx = content.indexOf(sidebarStartMarker);
if (sidebarStartIdx !== -1) {
    const sidebarEndIdx = content.indexOf(sidebarEndMarker, sidebarStartIdx);
    if (sidebarEndIdx !== -1) {
        const cleanSidebar = `{characterResults.map((char, idx) => (
                  <DraggableSidebarItem
                    key={\`\${char.mal_id}-\${idx}\`}
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
                `;
        
        const before = content.substring(0, sidebarStartIdx);
        const after = content.substring(sidebarEndIdx);
        content = before + cleanSidebar + after;
        console.log("Fixed Sidebar");
    }
}

// 2. Fix Grid
const gridStartMarker = '{grid.map((cell, idx) => (';
const gridStartIdx = content.indexOf(gridStartMarker);

if (gridStartIdx !== -1) {
    const gridEndIdx = content.indexOf('))}', gridStartIdx);
    if (gridEndIdx !== -1) {
         const cleanGrid = `{grid.map((cell, idx) => (
                   <DndGridCell
                     key={idx}
                     idx={idx}
                     cell={cell}
                     isSelected={selectedCharacter?.customImageUrl === cell.character?.customImageUrl}
                     onClick={() => { 
                         if (selectedCharacter) {
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
                                  return \`/_next/image?url=\${encodeURIComponent(url)}&w=384&q=75\`;
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
                   </DndGridCell>
                 `;
        
        const before = content.substring(0, gridStartIdx);
        const after = content.substring(gridEndIdx);
        content = before + cleanGrid + after;
        console.log("Fixed Grid");
    }
}

// 3. Fix Trash Zones (Desktop)
// Left Zone
const leftTrashRegex = /<div\s+className="absolute left-0([\s\S]*?)z-30"\s+onDragOver=\{([\s\S]*?)\}\s+onDrop=\{([\s\S]*?)\}\s+>\s+<Trash2([\s\S]*?)\/>\s+<\/div>/;

if (leftTrashRegex.test(content)) {
    content = content.replace(leftTrashRegex, (match, classRest, dragOver, drop, trashIcon) => {
        return `<TrashZone id="trash-left" className="absolute left-0${classRest}z-30">
               <Trash2${trashIcon}/>
            </TrashZone>`;
    });
    console.log("Fixed Left Trash");
} else {
    console.log("Left Trash Regex matching failed (could be already fixed or logic mismatch)");
}

// Right Zone
const rightTrashRegex = /<div\s+className="absolute right-0([\s\S]*?)z-30"\s+onDragOver=\{([\s\S]*?)\}\s+onDrop=\{([\s\S]*?)\}\s+>\s+<Trash2([\s\S]*?)\/>\s+<\/div>/;

if (rightTrashRegex.test(content)) {
    content = content.replace(rightTrashRegex, (match, classRest, dragOver, drop, trashIcon) => {
        return `<TrashZone id="trash-right" className="absolute right-0${classRest}z-30">
               <Trash2${trashIcon}/>
            </TrashZone>`;
    });
    console.log("Fixed Right Trash");
} else {
    console.log("Right Trash Regex matching failed");
}

// 4. Fix Gallery Images
const galleryStartMarker = '{galleryImages.map((img, i) => (';
const galleryStartIdx = content.indexOf(galleryStartMarker);

if (galleryStartIdx !== -1) {
    const galleryEndIdx = content.indexOf('))}', galleryStartIdx);
    if (galleryEndIdx !== -1) {
         const cleanGallery = `{galleryImages.map((img, i) => {
                                  const char = {
                                     mal_id: 990000 + i,
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
                               })}`;
        
        const before = content.substring(0, galleryStartIdx);
        const after = content.substring(galleryEndIdx); // '))}' included?
        // Wait, '))}' is length 3. Logic above for Grid used start of '))}'.
        // Grid logic: `const after = content.substring(gridEndIdx);`
        // `cleanGrid` ended with just BEFORE `))}`? 
        // No, `cleanGrid` was `{grid.map...` so it ends with `}`?
        // Let's check logic:
        // `const cleanGrid = \`{grid.map... ... </DndGridCell>\`;`
        // It didn't include `))}`.
        // `after` starts at `))}`.
        // So `before + cleanGrid + after` results in `... </DndGridCell>))}`.
        // My `cleanGallery` variable ABOVE includes `))}` inside it!
        // So I should substring `after` starting from `galleryEndIdx + 3`.
        
        const afterAdjusted = content.substring(galleryEndIdx + 3);
        content = before + cleanGallery + afterAdjusted;
        console.log("Fixed Gallery");
    }
}

// 5. Restore Mobile Trash
// Insert before: {showUrlModal &&
const urlModalMarker = '{showUrlModal &&';
const urlModalIdx = content.indexOf(urlModalMarker);

if (urlModalIdx !== -1) {
    // Check if trash exists nearby? (No, assuming not found).
    if (!content.includes('id="trash-mobile"')) {
        const mobileTrash = `
          {/* Mobile Trash Zone */}
          {isDragging && (
             <TrashZone id="trash-mobile" className="lg:hidden fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-red-950/95 via-red-900/80 to-transparent z-50 flex flex-col items-center justify-end pb-8 border-t border-red-500/30">
                 <div className="w-16 h-1 bg-red-500/30 rounded-full mb-4"/>
                 <Trash2 className="w-8 h-8 text-red-400 animate-bounce"/>
                 <p className="text-red-200 text-xs font-bold mt-2 uppercase tracking-widest">Drop to Remove</p>
             </TrashZone>
          )}
        `;
        
        const before = content.substring(0, urlModalIdx);
        const after = content.substring(urlModalIdx);
        content = before + mobileTrash + after;
        console.log("Restored Mobile Trash");
    }
} else {
    console.log("URL Modal marker not found");
}

// 6. Fix Selected Preview Nesting
// We found that regex replacement often misplaced the closing tag inside the inner text div.
// Pattern: </DraggableSidebarItem> following by )} and </div>
const brokenPreviewRegex = /<\/DraggableSidebarItem>\s+\)\}\s+<\/div>/;

if (brokenPreviewRegex.test(content)) {
    content = content.replace(brokenPreviewRegex, `  )}
               </div>
            </DraggableSidebarItem>`);
    console.log("Fixed Selected Preview Nesting");
} else {
    console.log("Selected Preview Nesting not found (possibly already fixed)");
}

fs.writeFileSync(filePath, content);


