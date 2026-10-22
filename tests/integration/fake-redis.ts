/** Minimal in-memory stand-in for the ioredis commands this app uses. Never connects anywhere. */
type Z = Map<string, number>;
export class FakeRedis {
  strings = new Map<string, string>();
  hashes = new Map<string, Map<string, string>>();
  zsets = new Map<string, Z>();
  sets = new Map<string, Set<string>>();
  lists = new Map<string, string[]>();
  status = "ready";
  calls: string[] = [];
  reset() { this.strings.clear(); this.hashes.clear(); this.zsets.clear(); this.sets.clear(); this.lists.clear(); this.calls = []; }
  private z(k: string) { let z = this.zsets.get(k); if (!z) this.zsets.set(k, (z = new Map())); return z; }
  private h(k: string) { let h = this.hashes.get(k); if (!h) this.hashes.set(k, (h = new Map())); return h; }
  private sorted(k: string) { return [...(this.zsets.get(k) ?? new Map()).entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([m]) => m); }
  private slice(arr: string[], s: number, e: number) { const n = arr.length; const a = s < 0 ? n + s : s; const b = e < 0 ? n + e : e; return arr.slice(Math.max(0, a), b + 1); }
  on() { return this; }
  async connect() {}
  async quit() { return "OK"; }
  async get(k: string) { this.calls.push(`get ${k}`); return this.strings.get(k) ?? null; }
  async mget(...ks: (string | string[])[]) { return ks.flat().map((k) => this.strings.get(k) ?? null); }
  async set(k: string, v: string | number, ...opts: (string | number)[]) {
    this.calls.push(`set ${k}`);
    if (opts.map(String).map((o) => o.toUpperCase()).includes("NX") && this.strings.has(k)) return null;
    this.strings.set(k, String(v)); return "OK";
  }
  async setex(k: string, _t: number, v: string) { this.strings.set(k, String(v)); return "OK"; }
  async del(...ks: string[]) { let n = 0; for (const k of ks.flat()) { for (const m of [this.strings, this.hashes, this.zsets, this.sets, this.lists]) if (m.delete(k)) n++; } return n; }
  async exists(...ks: string[]) { return ks.flat().filter((k) => this.strings.has(k) || this.hashes.has(k) || this.zsets.has(k)).length; }
  async expire() { return 1; }
  async ttl() { return 100; }
  async incr(k: string) { const v = Number(this.strings.get(k) ?? 0) + 1; this.strings.set(k, String(v)); return v; }
  async incrby(k: string, n: number) { const v = Number(this.strings.get(k) ?? 0) + Number(n); this.strings.set(k, String(v)); return v; }
  async hget(k: string, f: string) { return this.hashes.get(k)?.get(f) ?? null; }
  async hmget(k: string, ...fs: (string | string[])[]) { return fs.flat().map((f) => this.hashes.get(k)?.get(f) ?? null); }
  async hgetall(k: string) { return Object.fromEntries(this.hashes.get(k) ?? []); }
  async hset(k: string, ...a: unknown[]) {
    const h = this.h(k);
    const pairs: [string, string][] = a.length === 1 && typeof a[0] === "object" ? Object.entries(a[0] as object).map(([f, v]) => [f, String(v)]) : [];
    for (let i = 0; i + 1 < a.length; i += 2) pairs.push([String(a[i]), String(a[i + 1])]);
    pairs.forEach(([f, v]) => h.set(f, v)); return pairs.length;
  }
  async hdel(k: string, ...fs: string[]) { let n = 0; fs.flat().forEach((f) => this.hashes.get(k)?.delete(f) && n++); return n; }
  async hincrby(k: string, f: string, by: number) { const h = this.h(k); const v = Number(h.get(f) ?? 0) + Number(by); h.set(f, String(v)); return v; }
  async zadd(k: string, ...a: (string | number)[]) { const z = this.z(k); let n = 0; const args = a.filter((x) => !["NX", "XX", "GT", "LT", "CH"].includes(String(x))); for (let i = 0; i + 1 < args.length; i += 2) { if (!z.has(String(args[i + 1]))) n++; z.set(String(args[i + 1]), Number(args[i])); } return n; }
  async zrem(k: string, ...ms: (string | string[])[]) { let n = 0; ms.flat().forEach((m) => this.zsets.get(k)?.delete(m) && n++); return n; }
  async zcard(k: string) { return this.zsets.get(k)?.size ?? 0; }
  async zscore(k: string, m: string) { const s = this.zsets.get(k)?.get(m); return s === undefined ? null : String(s); }
  async zrange(k: string, s: number, e: number, ...opts: string[]) { const arr = this.sorted(k); return this.slice(opts.includes("REV") ? arr.reverse() : arr, Number(s), Number(e)); }
  async zrevrange(k: string, s: number, e: number) { return this.slice(this.sorted(k).reverse(), Number(s), Number(e)); }
  async sadd(k: string, ...ms: string[]) { let s = this.sets.get(k); if (!s) this.sets.set(k, (s = new Set())); ms.flat().forEach((m) => s!.add(m)); return ms.length; }
  async smembers(k: string) { return [...(this.sets.get(k) ?? [])]; }
  async lpush(k: string, ...vs: string[]) { const l = this.lists.get(k) ?? []; l.unshift(...vs.flat().reverse()); this.lists.set(k, l); return l.length; }
  async rpush(k: string, ...vs: string[]) { const l = this.lists.get(k) ?? []; l.push(...vs.flat()); this.lists.set(k, l); return l.length; }
  async lrange(k: string, s: number, e: number) { return this.slice(this.lists.get(k) ?? [], Number(s), Number(e)); }
  async ltrim() { return "OK"; }
  async scan(_c: string | number, ...a: (string | number)[]) {
    const i = a.findIndex((x) => String(x).toUpperCase() === "MATCH"); const pat = i >= 0 ? String(a[i + 1]) : "*";
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    const keys = [...new Set([...this.strings.keys(), ...this.hashes.keys(), ...this.zsets.keys(), ...this.sets.keys(), ...this.lists.keys()])].filter((k) => re.test(k));
    return ["0", keys];
  }
  async eval() { return 1; }
  multi() { return this.batch(); }
  pipeline() { return this.batch(); }
  private batch() {
    const ops: (() => Promise<unknown>)[] = [];
    const proxy: Record<string, unknown> = new Proxy({}, {
      get: (_t, prop: string) => {
        if (prop === "exec") return async () => { const out: [null, unknown][] = []; for (const op of ops) out.push([null, await op()]); return out; };
        if (prop === "then") return undefined;
        const fn = (this as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop];
        if (typeof fn !== "function") throw new Error(`FakeRedis: unsupported batch command ${prop}`);
        return (...a: unknown[]) => { ops.push(() => fn.apply(this, a)); return proxy; };
      },
    });
    return proxy;
  }
}
