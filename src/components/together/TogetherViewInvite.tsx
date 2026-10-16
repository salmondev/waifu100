"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { TogetherStartConfirm } from "@/components/together/TogetherBoard";
import type { TogetherKind } from "@/lib/together/ops";
import { cn } from "@/lib/utils";

/**
 * Sits with the view page's other actions. Same button, no extra caption.
 * The confirmation explains the room.
 */
export function TogetherViewInvite({ kind, className }: { kind: TogetherKind; className?: string }) {
    const [open, setOpen] = useState(false);
    const [failed, setFailed] = useState(false);
    return (
        <>
            <button
                type="button"
                onClick={() => { setFailed(false); setOpen(true); }}
                className={cn(className)}
            >
                <Users size={18} className="shrink-0" />
                <span className="truncate">Build Grid Together</span>
            </button>
            {failed && <p className="basis-full text-center text-xs text-amber-300 lg:text-left">Couldn't open a together room.</p>}
            <TogetherStartConfirm
                open={open}
                kind={kind}
                onClose={() => setOpen(false)}
                onError={() => setFailed(true)}
            />
        </>
    );
}
