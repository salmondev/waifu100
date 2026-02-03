import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { Character } from '@/types';

interface DraggableSidebarItemProps {
    char: Character;
    onClick?: () => void;
    children: React.ReactNode;
}

export function DraggableSidebarItem({ char, onClick, children }: DraggableSidebarItemProps) {
    const {attributes, listeners, setNodeRef, isDragging} = useDraggable({
        id: `sidebar-${char.mal_id}`,
        data: { character: char, type: 'sidebar' }
    });
    
    return (
        <div ref={setNodeRef} {...listeners} {...attributes} onClick={onClick} className={cn("touch-none", isDragging ? "opacity-30" : "opacity-100")}>
            {children}
        </div>
    );
}
