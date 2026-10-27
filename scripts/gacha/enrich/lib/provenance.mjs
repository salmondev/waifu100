// Provenance rules shared by every enrichment script, the merge and the generator.
// Every stored value is { value, source, url, confidence, fetchedAt, raw?, note?, reviewedAt? }.

/** Where a value came from. */
export const SOURCES = Object.freeze([
  "anilist-normalised", // AniList's own age text, normalised by lib/age.mjs
  "anilist-desc", // a labelled field (__Age:__, __Birthday:__) in the AniList description
  "anilist-pronouns", // gender guessed from pronouns in the AniList description (review only)
  "derived-cover", // computed from the AniList cover image (no AI)
  "jikan", // MyAnimeList via the Jikan API
  "serper", // web search snippet (review only)
  "agent", // agent research (review only)
]);

/** Sources whose values are never merged without a human approving them in review.json. */
export const REVIEW_ONLY_SOURCES = Object.freeze(["anilist-pronouns", "serper", "agent"]);

export const CONFIDENCE = Object.freeze(["high", "medium", "low"]);

/** Fields the sidecar may carry, per kind. */
export const FIELDS = Object.freeze({
  character: Object.freeze(["ageGame", "birthMonth", "gender", "va", "occupation"]),
  anime: Object.freeze(["coverColor"]),
});

const GENDERS = ["Male", "Female", "Non-binary"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const AGE_GAME = /^(\d+)(?:-(\d+)|\+)?$/;

/** Checks one field's value shape. Returns an error string or null. */
export function checkFieldValue(kind, field, value) {
  switch (`${kind}.${field}`) {
    case "character.ageGame": {
      const m = typeof value === "string" ? AGE_GAME.exec(value) : null;
      if (!m) return "ageGame must look like 17, 16-18 or 1000+";
      if (m[2] !== undefined && Number(m[2]) < Number(m[1])) return "ageGame range is reversed";
      return null;
    }
    case "character.birthMonth":
      return Number.isInteger(value) && value >= 1 && value <= 12 ? null : "birthMonth must be 1-12";
    case "character.gender":
      return GENDERS.includes(value) ? null : `gender must be one of ${GENDERS.join(", ")}`;
    case "character.va":
      return value && typeof value === "object" && typeof value.name === "string" && value.name
        ? null
        : "va must be { id, name, nameNative }";
    case "character.occupation":
      return typeof value === "string" && value.trim() && value.length <= 60 ? null : "occupation must be 1-60 chars";
    case "anime.coverColor":
      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? null : "coverColor must be #rrggbb";
    default:
      return `unknown field ${kind}.${field}`;
  }
}

/** Checks a stored value's provenance and shape. Returns a list of errors (empty when valid). */
export function checkValue(kind, field, v) {
  const errors = [];
  if (!v || typeof v !== "object") return ["value must be an object with provenance"];
  if (!SOURCES.includes(v.source)) errors.push(`source must be one of ${SOURCES.join(", ")}`);
  if (typeof v.url !== "string" || !/^https:\/\/\S+$/.test(v.url)) errors.push("url must be an https URL");
  if (!CONFIDENCE.includes(v.confidence)) errors.push(`confidence must be one of ${CONFIDENCE.join(", ")}`);
  if (typeof v.fetchedAt !== "string" || !ISO.test(v.fetchedAt)) errors.push("fetchedAt must be an ISO UTC timestamp");
  if (v.raw !== undefined && v.raw !== null && typeof v.raw !== "string") errors.push("raw must be a string");
  const shape = checkFieldValue(kind, field, v.value);
  if (shape) errors.push(shape);
  return errors;
}

/** True when the value may go straight into enrichment.json (no human review). */
export function autoMergeable(v) {
  return v.confidence === "high" && !REVIEW_ONLY_SOURCES.includes(v.source);
}

export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** A candidate as written by the fetch scripts: { kind, id, field, value: StoredValue, context? }. */
export function candidate(kind, id, field, stored, context) {
  return context ? { kind, id: Number(id), field, value: stored, context } : { kind, id: Number(id), field, value: stored };
}
