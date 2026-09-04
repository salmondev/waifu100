import { GridCell, Character } from "@/types";

/**
 * Deciding whether two grids contain "the same character".
 *
 * `mal_id` cannot answer that. Only characters picked out of Jikan carry a real
 * one; anything added through image search or an upload gets a locally minted
 * pseudo id (`990000 + index`, or `Date.now()`), which is unique per browser
 * session. Two people who both picked Frieren by image search have two ids that
 * will never match, and - worse - two different characters added at the same
 * grid position on two different days can collide on `990000 + i`. So the id is
 * ignored entirely here and the name is the identity.
 *
 * Names are messy in predictable ways, which is what the normalisation below is
 * for: casing, full-width characters, punctuation and diacritics, a trailing
 * "(Vocaloid)" style qualifier, and above all Japanese name order - one person
 * types "Eru Chitanda", the next types "Chitanda Eru".
 */

/**
 * Collapses a display name to comparable tokens.
 *
 * Order of operations matters: bracketed qualifiers go first (so their contents
 * never become tokens), diacritics before punctuation (so "Ōkami" and "Okami"
 * land on the same letters), and everything that is not a letter or digit
 * becomes a separator - which also handles "・" between Japanese name parts.
 */
export function normalizeName(raw: string): string[] {
    if (!raw) return [];

    const cleaned = raw
        .normalize("NFKC")
        .toLowerCase()
        // "Miku Hatsune (Vocaloid)" and "Rem [Re:Zero]" are the same person as
        // the bare name; the qualifier is where the grid came from, not who it is.
        .replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ")
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

    return cleaned ? cleaned.split(" ").filter(Boolean) : [];
}

/**
 * The key two characters must share to count as one person.
 *
 * Tokens are sorted, which is the whole trick for name order: "chitanda eru"
 * and "eru chitanda" both key as "chitanda eru". The cost is that two genuinely
 * different characters whose names are anagrams of each other would merge -
 * which has no realistic example, unlike the name-order problem, which happens
 * constantly.
 *
 * Deliberately NOT done: partial matching ("Miku" against "Hatsune Miku"). It
 * would look clever on that one example and wrong everywhere else, because
 * mononyms like "Sakura", "Rem" or "Asuka" belong to a dozen characters each.
 * A missed match reads as "we don't share that one"; a false match reads as the
 * feature being broken.
 */
export function matchKey(name: string): string {
    return normalizeName(name).sort().join(" ");
}

/** One character as the compare page needs it: who, which picture, whose grid. */
export interface CompareCharacter {
    key: string;
    name: string;
    image: string | null;
    source: string | null;
    /** Cell index in its own grid, for the A1-J10 label. */
    index: number;
}

export interface ComparePair {
    key: string;
    /** The A-side spelling wins the display, so one grid reads consistently. */
    name: string;
    a: CompareCharacter;
    b: CompareCharacter;
}

export interface CompareResult {
    shared: ComparePair[];
    /** In A's grid only - "you have, they don't" when A is the visitor. */
    onlyA: CompareCharacter[];
    onlyB: CompareCharacter[];
    countA: number;
    countB: number;
    /** 0-100, Dice: twice the overlap over the two totals. */
    similarity: number;
}

function cellImage(character: Character): string | null {
    return character.customImageUrl || character.images?.jpg?.image_url || null;
}

/**
 * Indexes one grid by match key, keeping the first spelling of any duplicate.
 *
 * Duplicates are real: the same character can sit in two cells (a second art
 * style, a mistake), and counting them twice would let a grid be "more similar"
 * to another than a full match, which is nonsense.
 */
function indexGrid(grid: GridCell[]): Map<string, CompareCharacter> {
    const byKey = new Map<string, CompareCharacter>();

    grid.forEach((cell, index) => {
        const character = cell?.character;
        if (!character?.name) return;

        const key = matchKey(character.name);
        if (!key || byKey.has(key)) return;

        byKey.set(key, {
            key,
            name: character.name,
            image: cellImage(character),
            source: character.source || null,
            index,
        });
    });

    return byKey;
}

/**
 * Similarity as Dice's coefficient: `2 * shared / (countA + countB)`.
 *
 * Two full 100-cell grids sharing 40 characters read as 40%, which is what
 * anyone would guess the number means. Jaccard (shared over union) would call
 * the same pair 25% and feel punishing, and "shared over the smaller grid"
 * would let a half-empty grid claim 100% against a full one.
 */
export function compareGrids(gridA: GridCell[], gridB: GridCell[]): CompareResult {
    const a = indexGrid(gridA);
    const b = indexGrid(gridB);

    const shared: ComparePair[] = [];
    const onlyA: CompareCharacter[] = [];

    for (const [key, charA] of a) {
        const charB = b.get(key);
        if (charB) {
            shared.push({ key, name: charA.name, a: charA, b: charB });
        } else {
            onlyA.push(charA);
        }
    }

    const onlyB = [...b.values()].filter((char) => !a.has(char.key));

    // Grid order, so a scan down either list feels like reading the grid.
    shared.sort((x, y) => x.a.index - y.a.index);
    onlyA.sort((x, y) => x.index - y.index);
    onlyB.sort((x, y) => x.index - y.index);

    const countA = a.size;
    const countB = b.size;
    const total = countA + countB;
    const similarity = total === 0 ? 0 : Math.round((200 * shared.length) / total);

    return { shared, onlyA, onlyB, countA, countB, similarity };
}
