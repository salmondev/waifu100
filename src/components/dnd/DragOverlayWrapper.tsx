import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { Character } from '@/types';

interface DragOverlayWrapperProps {
    activeDragData: { character?: Character; index?: number | null; type?: string } | null;
}

export function DragOverlayWrapper({ activeDragData }: DragOverlayWrapperProps) {
    return (
        <DragOverlay dropAnimation={null}>
            {activeDragData?.character && (
            <div className="w-24 h-32 rounded-lg overflow-hidden border-2 border-purple-500 shadow-2xl bg-zinc-900 pointer-events-none cursor-grabbing opacity-70 scale-110 rotate-3">
                <img 
                    src={activeDragData.character.customImageUrl || activeDragData.character.images.jpg.image_url} 
                    alt={activeDragData.character.name || "Dragged character"}
                    className="w-full h-full object-cover"
                />
            </div>
            )}
        </DragOverlay>
    );
}
