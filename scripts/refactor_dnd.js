const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/app/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

console.log(`Reading ${filePath}, size: ${content.length}`);

// --- Helper for Regex Replacement ---
function safeReplace(name, regex, replacement) {
    if (!regex.test(content)) {
        console.error(`[FAIL] ${name} pattern not found!`);
        return;
    }
    const newContent = content.replace(regex, replacement);
    if (newContent === content) {
         console.error(`[FAIL] ${name} replacement didn't change anything (unexpected).`);
    } else {
         content = newContent;
         console.log(`[SUCCESS] ${name}`);
    }
}

// 1. Sidebar Item Replacement
// Content to match:
// <div
//   key={`${char.mal_id}-${idx}`}
//   draggable
//   onDragStart={(e) => handleDragStartFromSearch(e, char)}
//   onDragEnd={handleDragEnd}
//   onClick={() => handleSelectCharacter(char)}
//   className={cn(
//     ...
//   )}
// >

const sidebarItemRegex = /<div\s+key=\{\`\$\{char\.mal_id\}-\$\{idx\}\`\}\s+draggable\s+onDragStart=\{\(e\) => handleDragStartFromSearch\(e, char\)\}\s+onDragEnd=\{handleDragEnd\}\s+onClick=\{\(\) => handleSelectCharacter\(char\)\}\s+className=\{cn\(([\s\S]*?)\)\}\s+>([\s\S]*?)<\/div>/g;

// Replacement:
// <DraggableSidebarItem key={`${char.mal_id}-${idx}`} char={char} onClick={() => handleSelectCharacter(char)}>
//    <div className={cn($1)}>
//       $2
//    </div>
// </DraggableSidebarItem>

safeReplace('Sidebar Item', sidebarItemRegex, (match, classNameArgs, innerContent) => {
    return `<DraggableSidebarItem
                    key={\`\${char.mal_id}-\${idx}\`}
                    char={char}
                    onClick={() => handleSelectCharacter(char)}
                  >
                     <div className={cn(${classNameArgs})}>${innerContent}</div>
                  </DraggableSidebarItem>`;
});


// 2. Selected Character Preview Replacement
// <div 
//    draggable
//    onDragStart={(e) => handleDragStartFromSearch(e, selectedCharacter)}
//    onDragEnd={handleDragEnd}
//    className="aspect-[3/4] w-full rounded-lg overflow-hidden bg-zinc-900 mb-4 border border-zinc-800 cursor-grab active:cursor-grabbing hover:border-purple-500 transition-colors"
// >

const selectedPreviewRegex = /<div\s+draggable\s+onDragStart=\{\(e\) => handleDragStartFromSearch\(e, selectedCharacter\)\}\s+onDragEnd=\{handleDragEnd\}\s+className="([^"]*)"\s+>([\s\S]*?)<\/div>/;

safeReplace('Selected Preview', selectedPreviewRegex, (match, className, innerContent) => {
    return `<DraggableSidebarItem
                   char={selectedCharacter}
                   onClick={() => {}}
                >
                   <div className="${className}">
                      ${innerContent}
                   </div>
                </DraggableSidebarItem>`;
});


// 3. Main Grid Replacement
// This is the hardest one.
// <div 
//   key={idx}
//   draggable={!!cell.character}
//   onDragStart={(e) => cell.character && handleDragStartFromGrid(e, idx, cell.character)}
//   onDragOver={(e) => handleDragOver(e, idx)}
//   onDrop={(e) => handleDrop(e, idx)}
//   onDragEnd={handleDragEnd}
//   onClick={...}
//   className={cn(...)}
// >
// ...
// </div>

const gridCellRegex = /<div\s+key=\{idx\}\s+draggable=\{!!cell\.character\}\s+onDragStart=\{\(e\) => cell\.character && handleDragStartFromGrid\(e, idx, cell\.character\)\}\s+onDragOver=\{\(e\) => handleDragOver\(e, idx\)\}\s+onDrop=\{\(e\) => handleDrop\(e, idx\)\}\s+onDragEnd=\{handleDragEnd\}\s+onClick=\{\(\) => \{\s+if \(selectedCharacter\) \{\s+handleCellClick\(idx\);\s+\} else if\(cell\.character\) \{\s+openGallery\(cell\.character\);\s+\}\s+\}\}\s+className=\{cn\(([\s\S]*?)\)\}\s+>([\s\S]*?)<\/div>/g;

// Note: The onClick body might have subtle whitespace diffs.
// I'll define the specific onClick body regex part loosely:
// onClick=\{[\s\S]*?\}\s+

const looseGridRegex = /<div\s+key=\{idx\}\s+draggable=\{!!cell\.character\}\s+onDragStart=\{[\s\S]*?\}\s+onDragOver=\{[\s\S]*?\}\s+onDrop=\{[\s\S]*?\}\s+onDragEnd=\{handleDragEnd\}\s+onClick=\{[\s\S]*?\}\s+className=\{cn\(([\s\S]*?)\)\}\s+>([\s\S]*?)<\/div>/g;

safeReplace('Grid Cell', looseGridRegex, (match, classNameArgs, innerContent) => {
    return `<DndGridCell
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
                       ${innerContent}
                     </DndGridCell>`;
});


// 4. Trash Zones
// Desktop Trash
// <div 
//    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
//    onDrop={(e) => { ... }}
//    className="hidden lg:flex ..."
// >
//    <Trash2 ... />
// </div>

// Searching for "hidden lg:flex" trash zone.
const trashDesktopRegex = /<div\s+onDragOver=\{[\s\S]*?\}\s+onDrop=\{[\s\S]*?\}\s+className="hidden lg:flex([^"]*)"\s+>([\s\S]*?)<\/div>/;

safeReplace('Desktop Trash', trashDesktopRegex, (match, classNameRest, innerContent) => {
    return `<TrashZone className="hidden lg:flex${classNameRest}">
               ${innerContent}
            </TrashZone>`;
});

// Mobile Trash
// <div 
//    className={cn(
//       "lg:hidden fixed bottom-0 ...",
//       ...
//    )}
//    onDragOver={...}
//    onDrop={...}
// >
//    <Trash2 ... />
//    ...
// </div>

// This one might be tricky because of `cn` usage.
// I'll search for `lg:hidden fixed bottom-0` inside `className`.
// And `onDragOver`/`onDrop`.

// Actually, I removed the `onDragOver` debug code recently.
// It is now:
// onDragOver={(e) => { ... }}
// onDrop={...}

const trashMobileRegex = /<div\s+className=\{cn\(\s+"lg:hidden fixed bottom-0([\s\S]*?)\)\}\s+onDragOver=\{[\s\S]*?\}\s+onDrop=\{[\s\S]*?\}\s+>([\s\S]*?)<\/div>/;

safeReplace('Mobile Trash', trashMobileRegex, (match, classNameArgs, innerContent) => {
    return `<TrashZone className={cn("lg:hidden fixed bottom-0${classNameArgs})}>
               ${innerContent}
            </TrashZone>`;
});


fs.writeFileSync(filePath, content);
console.log("Write complete.");
