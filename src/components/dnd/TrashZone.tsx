import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';

interface TrashZoneProps {
    id: string;
    className?: string;
    children: React.ReactNode;
}

export function TrashZone({ id, className, children }: TrashZoneProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: id,
        data: { type: 'trash' }
    });
    
    return (
        <div ref={setNodeRef} className={cn(className, isOver && "scale-110 bg-red-900/40 border-red-400")}>
            {children}
        </div>
    )
}
