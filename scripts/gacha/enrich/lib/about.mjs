// Labelled facts in free text (MAL "about", AniList descriptions, search snippets).
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Month 1-12 from "March 3", "3 March", "Mar. 3rd" etc. Numeric dates are ambiguous (3/4) and ignored. */
export function monthFromText(s) {
  if (!s) return null;
  const words = String(s).toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = new Set();
  for (const w of words) {
    if (w.length < 3) continue;
    const i = MONTHS.indexOf(w.slice(0, 3));
    if (i >= 0 && ("january february march april may june july august september october november december".split(" ")[i].startsWith(w) || w.length === 3)) hits.add(i + 1);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/**
 * "Label: value" lines. Returns the first value per lower-case label.
 * Handles MAL ("Age: 17"), AniList (__Age:__ 17 / **Age:** 17) and inline "Age: 17;" in snippets.
 */
export function labelledFields(text) {
  const out = new Map();
  if (!text) return out;
  const clean = String(text)
    .replace(/~![\s\S]*?!~/g, " ") // AniList spoilers
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/(?:__|\*\*)/g, "");
  for (const line of clean.split(/\n|(?<=[.;])\s+(?=[A-Z][A-Za-z ]{1,20}:)/)) {
    const m = /^\s*([A-Za-z][A-Za-z ()/]{0,30}?)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/\s*\(.*\)\s*/g, "").trim();
    if (!out.has(key)) out.set(key, m[2].replace(/[;,.\s]+$/, "").slice(0, 80));
  }
  return out;
}

export const pickLabel = (fields, labels) => {
  for (const l of labels) if (fields.has(l)) return fields.get(l);
  return null;
};

export const AGE_LABELS = ["age"];
export const BIRTHDAY_LABELS = ["birthday", "birthdate", "birth date", "date of birth", "born", "birth"];
export const OCCUPATION_LABELS = ["occupation", "position", "affiliation", "rank", "title"];

/**
 * Gender guessed from pronoun counts. Review-only by policy (never auto-merged).
 * @returns {{ value: "Male" | "Female", confidence: "medium" | "low", he: number, she: number } | null}
 */
export function genderFromPronouns(text) {
  const s = ` ${String(text ?? "").replace(/~![\s\S]*?!~/g, " ").toLowerCase()} `;
  const she = (s.match(/\b(she|her|hers|herself)\b/g) ?? []).length;
  const he = (s.match(/\b(he|him|his|himself)\b/g) ?? []).length;
  if (she >= 3 && she > 3 * he) return { value: "Female", confidence: she >= 6 && he === 0 ? "medium" : "low", he, she };
  if (he >= 3 && he > 3 * she) return { value: "Male", confidence: he >= 6 && she === 0 ? "medium" : "low", he, she };
  return null;
}
