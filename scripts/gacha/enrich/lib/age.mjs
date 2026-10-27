// Age normaliser: free-text age -> a "game age" string the guess feedback can compare
// ("17", "16-18", "1000+"), the same grammar as parseAge() in src/server/gacha/feedback.ts.
// The raw text is always kept. Anything ambiguous is sent to review with a suggestion.

const MAX_AGE = 100_000;
const SUFFIX = /\s*(?:years\s+old|years|yrs)$/;
const SINGLE = /^(\d+)$/;
const APPROX = /^(?:~|approximately|approx\.|about|around|ca\.)\s*(\d+)$/;
const RANGE = /^(\d+)\s*(?:-|~|–|\s+to\s+)\s*(\d+)$/;
const PLUS = /^(\d+)\s*\+$/;

const toInt = (s) => {
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_AGE ? n : null;
};

/**
 * Mirror of feedback.ts parseAge (kept in sync by a test): strict, one value or one range.
 * @param {string | null | undefined} raw
 * @returns {{ lo: number, hi: number } | null}
 */
export function parseAgeStrict(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(SUFFIX, "").trim();
  if (!s) return null;
  let m = SINGLE.exec(s) ?? APPROX.exec(s);
  if (m) {
    const n = toInt(m[1]);
    return n === null ? null : { lo: n, hi: n };
  }
  if ((m = PLUS.exec(s))) {
    const n = toInt(m[1]);
    return n === null ? null : { lo: n, hi: Infinity };
  }
  if ((m = RANGE.exec(s))) {
    const lo = toInt(m[1]);
    const hi = toInt(m[2]);
    return lo === null || hi === null || lo > hi ? null : { lo, hi };
  }
  return null;
}

/** "17", "16-18" or "1000+" for a parsed range. */
export function formatAge(r) {
  if (!r) return null;
  if (r.hi === Infinity) return `${r.lo}+`;
  return r.lo === r.hi ? String(r.lo) : `${r.lo}-${r.hi}`;
}

const UNKNOWN = /^(?:unknown|unkown|\?+|n\/?a|none|-+|—)$/i;
const NON_YEAR_UNIT = /\b(?:days?|weeks?|months?|million|billion|thousand|centur(?:y|ies)|millenni(?:um|a))\b/i;
// one age expression: 17, 16-18, 27- (open), 1000+, 30s
const EXPR = /(\d+)\s*(?:[-–~]\s*(\d+)?|\+|s\b)?/g;

/**
 * @typedef {{ ageGame: string | null, confidence: "high" | "medium" | "low" | null,
 *             review: boolean, reason: string, raw: string | null }} AgeResult
 */

/**
 * Normalises one raw age.
 * - review=false + confidence high: safe to store without a human (one value, maybe with a qualifier).
 * - review=true: a human picks; ageGame is only a suggestion.
 * - ageGame null + review=false: nothing to store ("Unknown", empty).
 * @param {string | null | undefined} rawIn
 * @returns {AgeResult}
 */
export function normaliseAge(rawIn) {
  const raw = typeof rawIn === "string" ? rawIn.trim() : null;
  const out = (ageGame, confidence, review, reason) => ({ ageGame, confidence, review, reason, raw });
  if (!raw) return out(null, null, false, "empty");
  if (UNKNOWN.test(raw)) return out(null, null, false, "unknown");

  const strict = parseAgeStrict(raw);
  if (strict) return out(formatAge(strict), "high", false, "strict");

  if (NON_YEAR_UNIT.test(raw)) return out(null, "low", true, "non-year unit");

  const lower = raw.toLowerCase();
  // "34 or older", "over 30", "at least 20"
  let m = /^(\d+)\s*(?:or older|or more|and up)$/.exec(lower) ?? /^(?:over|older than|at least)\s*(\d+)$/.exec(lower);
  if (m && toInt(m[1]) !== null) return out(`${toInt(m[1])}+`, "medium", true, "open-ended");

  // A decade alone: "30s" -> 30-39
  m = /^(\d+)0'?s$/.exec(lower);
  if (m) {
    const lo = toInt(`${m[1]}0`);
    if (lo !== null) return out(`${lo}-${lo + 9}`, "medium", true, "decade");
  }

  const exprs = [...raw.matchAll(EXPR)];
  // Exactly one age expression followed only by a qualifier: "17 (physically)", "10-11 (Past)", "33 (at death)"
  const head = raw.replace(/\s*\([^)]*\)?\s*$/, "").trim();
  if (exprs.length === 1 && head !== raw) {
    const r = parseAgeStrict(head);
    if (r) return out(formatAge(r), "high", false, "single value with qualifier");
  }

  if (exprs.length >= 1) {
    const first = exprs[0];
    let suggestion = null;
    if (first[0].trim().endsWith("s") && !first[2]) {
      const lo = toInt(first[1]);
      suggestion = lo === null ? null : `${lo}-${lo + 9}`;
    } else if (/[-–~]\s*$/.test(first[0]) || first[0].trim().endsWith("+")) {
      const lo = toInt(first[1]);
      suggestion = lo === null ? null : `${lo}+`;
    } else {
      suggestion = formatAge(parseAgeStrict(first[0].replace(/[-–~]\s*$/, "").trim()));
    }
    const reason = exprs.length > 1 ? "multiple values" : "unrecognised wording";
    return out(suggestion, "low", true, reason);
  }
  return out(null, "low", true, "no number");
}
