// Merge rules: candidates (from the fetch scripts) + approved review items -> enrichment.json.
// - A field AniList already has is never overwritten (the catalog is the AniList truth).
// - A field the sidecar already has is kept (first approved value wins; edit by hand to change it).
// - Every value needs full provenance (source, https url, confidence, fetchedAt) or it is rejected.
// - Only high-confidence values from non-review-only sources merge on their own; everything else
//   goes to review.json and merges only after a human sets "status": "approved".
import { FIELDS, autoMergeable, checkValue, nowIso } from "./provenance.mjs";
import { parseAgeStrict } from "./age.mjs";

export const EMPTY_ENRICHMENT = Object.freeze({ version: 1, characters: {}, anime: {} });
export const EMPTY_REVIEW = Object.freeze({ version: 1, items: [] });

const clone = (x) => JSON.parse(JSON.stringify(x));
export const reviewKey = (kind, id, field) => `${kind}:${id}:${field}`;

/**
 * What the catalog (AniList) already has, per kind/id/field.
 * @param {any} catalog parsed catalog.json
 */
export function indexCatalog(catalog) {
  const characters = new Map();
  const anime = new Map();
  for (const a of catalog?.anime ?? []) {
    anime.set(a.id, a);
    for (const c of a.characters ?? []) if (!characters.has(c.id)) characters.set(c.id, { ...c, card: true, animeId: a.id });
    for (const r of a.roster ?? []) {
      const prev = characters.get(r.id);
      // a card character's catalog row carries occupation; the roster row carries the rest
      characters.set(r.id, prev ? { ...r, ...prev } : { ...r, animeId: a.id });
    }
  }
  return { characters, anime };
}

/** True when AniList (the catalog) already has a usable value for this field. */
export function anilistHas(index, kind, id, field) {
  if (kind === "anime") {
    const a = index.anime.get(id);
    return Boolean(a && a[field] && !(a.enriched ?? []).includes(field));
  }
  const c = index.characters.get(id);
  if (!c) return false;
  if ((c.enriched ?? []).includes(field)) return false; // filled from the sidecar, not AniList
  switch (field) {
    case "ageGame":
      return parseAgeStrict(c.age) !== null;
    case "gender":
      return c.gender !== null && c.gender !== undefined; // "other" is AniList's value too: kept
    case "va":
      return Boolean(c.va);
    default:
      return c[field] !== null && c[field] !== undefined;
  }
}

/**
 * @param {{ catalog: any, enrichment?: any, review?: any, candidates?: any[], now?: string }} input
 */
export function mergeCandidates({ catalog, enrichment = EMPTY_ENRICHMENT, review = EMPTY_REVIEW, candidates = [], now = nowIso() }) {
  const index = indexCatalog(catalog);
  const enr = clone(enrichment);
  enr.characters ??= {};
  enr.anime ??= {};
  const rev = clone(review);
  rev.items ??= [];
  const report = { merged: [], toReview: [], approvedMerged: [], skipped: [], rejected: [] };
  const bucket = (kind) => (kind === "anime" ? enr.anime : enr.characters);
  const has = (kind, id, field) => Boolean(bucket(kind)[id]?.[field]);
  const put = (kind, id, field, value) => {
    const b = bucket(kind);
    b[id] = { ...(b[id] ?? {}), [field]: value };
  };

  /** null when the candidate may proceed; else the reason it is skipped/rejected. */
  const gate = (c) => {
    if (!FIELDS[c.kind]?.includes(c.field)) return { reject: `unknown field ${c.kind}.${c.field}` };
    if (!Number.isInteger(c.id) || c.id <= 0) return { reject: "id must be a positive integer" };
    const errors = checkValue(c.kind, c.field, c.value);
    if (errors.length) return { reject: errors.join("; ") };
    if (c.kind === "character" && !index.characters.has(c.id)) return { skip: "not in catalog" };
    if (c.kind === "anime" && !index.anime.has(c.id)) return { skip: "not in catalog" };
    if (anilistHas(index, c.kind, c.id, c.field)) return { skip: "anilist has a value" };
    if (has(c.kind, c.id, c.field)) return { skip: "already enriched" };
    return null;
  };

  // 1. review items a human approved
  for (const item of rev.items) {
    if (item.status !== "approved") continue;
    const c = { kind: item.kind, id: item.id, field: item.field, value: item.candidate };
    const g = gate(c);
    if (g?.reject) { report.rejected.push({ key: item.key, reason: g.reject }); continue; }
    if (g?.skip) { item.status = "superseded"; item.note = g.skip; report.skipped.push({ key: item.key, reason: g.skip }); continue; }
    put(c.kind, c.id, c.field, { ...c.value, reviewedAt: item.reviewedAt ?? now });
    item.status = "merged";
    item.mergedAt = now;
    report.approvedMerged.push(item.key);
  }

  // 2. new candidates
  const reviewIndex = new Map(rev.items.map((it) => [it.key, it]));
  for (const c of candidates) {
    const key = reviewKey(c.kind, c.id, c.field);
    const g = gate(c);
    if (g?.reject) { report.rejected.push({ key, reason: g.reject }); continue; }
    if (g?.skip) { report.skipped.push({ key, reason: g.skip }); continue; }
    if (autoMergeable(c.value)) {
      put(c.kind, c.id, c.field, c.value);
      report.merged.push(key);
      continue;
    }
    const existing = reviewIndex.get(key);
    const sameValue = existing && JSON.stringify(existing.candidate.value) === JSON.stringify(c.value.value) && existing.candidate.source === c.value.source;
    if (existing && (sameValue || existing.status === "rejected" || existing.status === "approved")) {
      report.skipped.push({ key, reason: `already in review (${existing.status})` });
      continue;
    }
    const item = {
      key,
      kind: c.kind,
      id: c.id,
      field: c.field,
      status: "pending",
      reason: c.value.source && !autoMergeable({ ...c.value, confidence: "high" }) ? `review-only source (${c.value.source})` : `${c.value.confidence} confidence`,
      candidate: c.value,
      ...(c.context ? { context: c.context } : {}),
      addedAt: now,
    };
    if (existing) {
      // a different suggestion for a pending item: keep both, newest first
      item.alternatives = [existing.candidate, ...(existing.alternatives ?? [])];
      rev.items[rev.items.indexOf(existing)] = item;
    } else rev.items.push(item);
    reviewIndex.set(key, item);
    report.toReview.push(key);
  }

  rev.items.sort((a, b) => (a.kind + a.field).localeCompare(b.kind + b.field) || a.id - b.id);
  return { enrichment: sortEnrichment(enr), review: rev, report };
}

function sortEnrichment(e) {
  const sortObj = (o) => Object.fromEntries(Object.keys(o).sort((a, b) => Number(a) - Number(b)).map((k) => [k, Object.fromEntries(Object.entries(o[k]).sort(([x], [y]) => x.localeCompare(y)))]));
  return { ...e, characters: sortObj(e.characters), anime: sortObj(e.anime) };
}
