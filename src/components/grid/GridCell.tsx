import React, { memo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { GridCell as GridCellType } from '@/types';

interface GridCellProps {
  idx: number;
  cell: GridCellType;
  isSelected: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}

export const GridCell = memo(function GridCell({ idx, cell, isSelected, onClick, children }: GridCellProps) {
    const {setNodeRef: setDropRef, isOver } = useDroppable({
        id: `cell-${idx}`,
        data: { index: idx, type: 'cell' }
    });

    const {attributes, listeners, setNodeRef: setDragRef, isDragging} = useDraggable({
        id: `grid-char-${idx}`,
        data: { index: idx, character: cell.character, type: 'grid' },
        disabled: !cell.character
    });

    return (
        <div 
            ref={setDropRef}
            onClick={onClick}
            className={cn(
                "aspect-square bg-zinc-950 relative group cursor-pointer border border-zinc-800/50 transition-all duration-200",
                isOver && "border-purple-500 bg-purple-500/20 scale-110", 
                isSelected && !cell.character && "animate-pulse ring-1 ring-purple-500/50",
                isDragging && "opacity-50"
            )}
        >
             <div ref={setDragRef} {...listeners} {...attributes} className="w-full h-full touch-none"> 
                {children}
             </div>
        </div>
    );
});
