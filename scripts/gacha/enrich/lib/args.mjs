// Tiny argv helper (no deps).
export function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const eq = a.indexOf("=");
    if (eq > 0) { opts[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && VALUE_OPTS.has(a.slice(2))) { opts[a.slice(2)] = next; i++; }
    else flags.add(a.slice(2));
  }
  return { flags, opts, rest };
}
const VALUE_OPTS = new Set(["max", "out", "cache", "catalog", "enrichment", "review", "fields", "anime", "after", "sample", "max-keys", "ledger"]);

export function intOpt(opts, name, fallback) {
  if (opts[name] === undefined) return fallback;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
}
