import type { StoredStoryCell } from "@/lib/share-schema";
import { USER_TYPED_SOURCES } from "@/lib/text-policy";

interface NamedCharacter {
    name?: string;
    source?: string;
}

/** Labels the visitor actually typed, for one share write. Catalog names are left out. */
export function userTextsForShare(
    customTitle: string | null,
    kind: "waifu" | "story",
    storyCells: StoredStoryCell[] | null,
    waifuCells: ({ character?: NamedCharacter } | null)[] | null
): string[] {
    const out: string[] = [];
    if (customTitle?.trim()) out.push(customTitle.trim());
    if (kind === "story") {
        for (const cell of storyCells ?? []) {
            if (cell.src === "upload" && cell.n?.trim()) out.push(cell.n.trim());
        }
    } else {
        for (const cell of waifuCells ?? []) {
            const name = cell?.character?.name?.trim();
            const source = cell?.character?.source;
            if (name && source && USER_TYPED_SOURCES.has(source)) out.push(name);
        }
    }
    return out;
}
