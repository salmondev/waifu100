import { cn } from "@/lib/utils";

/** The showcase chip. `md` is the same mark, a step larger, for the view title. */
export function TogetherBadge({ size = "sm" }: { size?: "sm" | "md" }) {
    const large = size === "md";
    return (
        <span
            data-testid="together-badge"
            className={cn(
                "inline-flex items-center rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500 font-bold uppercase tracking-widest text-white shadow-[0_4px_10px_rgba(168,85,247,0.45)]",
                large ? "gap-1.5 px-3 py-1 text-[11px]" : "gap-1 px-2 py-0.5 text-[9px]"
            )}
        >
            <span className={cn("rounded-full bg-white", large ? "h-1.5 w-1.5" : "h-1 w-1")} />
            Together
        </span>
    );
}
