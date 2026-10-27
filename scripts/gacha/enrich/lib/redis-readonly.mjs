// A read-only view of a Redis client: only the commands listed here exist on it.
// Anything else (SET, DEL, EXPIRE, HSET, EVAL, FLUSH*, ...) throws before reaching Redis.
export const READ_ONLY_COMMANDS = Object.freeze(["scan", "get", "type", "hgetall", "strlen", "exists", "dbsize"]);

export function readOnly(client) {
  const view = {};
  for (const cmd of READ_ONLY_COMMANDS) view[cmd] = (...args) => client[cmd](...args);
  view.quit = () => client.quit();
  return new Proxy(Object.freeze(view), {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      throw new Error(`read-only Redis view: "${String(prop)}" is not allowed`);
    },
  });
}

/** Counts only: no keys, ids, names or contents ever leave this function. */
export function tallyCharacterEntry(tally, json) {
  tally.read++;
  let v;
  try { v = JSON.parse(json); } catch { tally.unparseable++; return; }
  const p = v?.profile ?? v;
  if (!p || typeof p !== "object") { tally.unparseable++; return; }
  if (p.unknown === true) tally.unknown++;
  if (!p.series) tally.noSeries++;
  if (!p.image) tally.noImage++;
  if (!p.description) tally.noDescription++;
  const conf = typeof v?.confidence === "string" ? v.confidence : "none";
  tally.confidence[conf] = (tally.confidence[conf] ?? 0) + 1;
  if (v?.researched) tally.researched++;
}

export function tallyShare(tally, json) {
  tally.read++;
  let v;
  try { v = JSON.parse(json); } catch { tally.unparseable++; return; }
  if (Array.isArray(v)) { tally.legacyArray++; tally.noCreatedAt++; return; }
  if (!v?.meta?.createdAt) tally.noCreatedAt++;
}
