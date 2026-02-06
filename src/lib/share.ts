import LZString from 'lz-string';
import { Character, GridCell } from '@/types';

// Minified interface for URL storage
interface MinifiedChar {
  i: number;          // Index
  m: number;          // MAL ID (or pseudo ID)
  n: string;          // Name
  img: string;        // Image URL
  s?: string;         // Source (Anime/Game)
}

/**
 * Encodes the grid into a compressed URL-safe string.
 * Filters out characters with large base64 images to prevent URL overflow.
 */
export function encodeGrid(grid: GridCell[]): string {
  const minified: MinifiedChar[] = grid
    .map((cell, index) => {
      if (!cell.character) return null;

      const char = cell.character;
      
      // Determine image URL
      const imgUrl = char.images?.jpg?.image_url || char.customImageUrl || "";

      // Skip invalid images or large base64 blobs
      if (!imgUrl || imgUrl.startsWith("data:")) {
        // If it's a base64 custom image, we currently skip it for sharing
        // (Future: potentially upload to a temp host, but out of scope for now)
        if (imgUrl.startsWith("data:")) {
            // console.warn("Skipping base64 image for share:", char.name);
            return null; 
        }
      }

      return {
        i: index,
        m: char.mal_id,
        n: char.name,
        img: imgUrl,
        s: char.source
      } as MinifiedChar;
    })
    .filter((c): c is MinifiedChar => c !== null);

  if (minified.length === 0) return "";

  const json = JSON.stringify(minified);
  return LZString.compressToEncodedURIComponent(json);
}

/**
 * Decodes a compressed hash back into a GridCell array.
 */
export function decodeGrid(hash: string): GridCell[] {
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash);
    if (!json) return [];

    const minified: MinifiedChar[] = JSON.parse(json);
    
    // Reconstruct Grid
    const newGrid: GridCell[] = Array(100).fill(null).map(() => ({ character: null }));

    minified.forEach(m => {
      if (m.i >= 0 && m.i < 100) {
        newGrid[m.i] = {
          character: {
            mal_id: m.m,
            name: m.n,
            images: {
              jpg: { image_url: m.img }
            },
            source: m.s || "Shared",
            // We use the same field for consistency, though 'customImageUrl' logic 
            // in main app usually handles overrides.
            // For shared view, we trust 'img' is the display url.
          }
        };
      }
    });

    return newGrid;
  } catch (e) {
    console.error("Failed to decode grid:", e);
    return [];
  }
}

/**
 * Generates a shareable URL for the current grid
 */
export function generateShareUrl(grid: GridCell[]): string {
    const hash = encodeGrid(grid);
    if (!hash) return "";
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/view?g=${hash}`;
}
