import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const GACHA_DIR = path.join(ROOT, "src/server/gacha");
export const CATALOG_FILE = path.join(GACHA_DIR, "catalog.json");
export const ENRICHMENT_FILE = path.join(GACHA_DIR, "enrichment.json");
export const REVIEW_FILE = path.join(GACHA_DIR, "review.json");
export const OUT_DIR = path.join(ROOT, "scripts/gacha/enrich/out");
export const CACHE_DIR = path.join(ROOT, "scripts/gacha/enrich/.cache");

export async function readJson(file, fallback) {
  if (!existsSync(file)) {
    if (fallback !== undefined) return structuredClone(fallback);
    throw new Error(`missing ${path.relative(ROOT, file)}`);
  }
  return JSON.parse(await readFile(file, "utf8"));
}

/** Atomic write (tmp + rename), pretty JSON with a trailing newline. */
export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
  await rename(tmp, file);
}

export const rel = (file) => path.relative(ROOT, file);
