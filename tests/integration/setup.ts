/**
 * Integration harness: route handlers and server functions run in-process with
 * every external dependency replaced. Nothing here can reach the shared
 * Redis/Blob/Gemini/Serper/Vertex:
 *  - @/lib/redis -> FakeRedis (memory)
 *  - @vercel/blob -> recorded fakes
 *  - @google/generative-ai -> `gemini` mock
 *  - global fetch -> throws for any non-localhost URL (recorded in `outside`)
 */
import { afterEach, beforeEach, expect, vi } from "vitest";
import { FakeRedis } from "./fake-redis";

export const redis = new FakeRedis();
export const outside: string[] = [];
export const blob = {
  put: vi.fn(async (path: string) => ({ url: `https://blob.e2e.invalid/${path}`, pathname: path })),
  del: vi.fn(async () => undefined),
  list: vi.fn(async () => ({ blobs: [], hasMore: false })),
  head: vi.fn(async () => null),
};
export const gemini = { generateContent: vi.fn(async (...args: unknown[]): Promise<{ response: Promise<{ text: () => string }> }> => ({ response: Promise.resolve({ text: () => (args.length ? "{}" : "{}") }) })) };

vi.mock("@/lib/redis", async (orig) => ({
  ...(await orig<typeof import("@/lib/redis")>()),
  getRedis: async () => redis,
  withRedis: async (fn: (r: unknown) => unknown) => fn(redis),
}));
vi.mock("@vercel/blob", () => ({ put: (...a: [string]) => blob.put(...a), del: () => blob.del(), list: () => blob.list(), head: () => blob.head() }));
vi.mock("@google/generative-ai", () => {
  class GoogleGenerativeAI { getGenerativeModel() { return { generateContent: (p: unknown) => gemini.generateContent(p) }; } }
  return { GoogleGenerativeAI, HarmCategory: {}, HarmBlockThreshold: {}, SchemaType: {} };
});

const realFetch = globalThis.fetch;
const guardFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url, "http://localhost").hostname;
  if (host === "localhost" || host === "127.0.0.1") return realFetch(input, init);
  outside.push(url);
  throw new Error(`outside call blocked in tests: ${url}`);
});

beforeEach(() => {
  redis.reset();
  outside.length = 0;
  blob.put.mockClear();
  gemini.generateContent.mockClear();
  globalThis.fetch = guardFetch as unknown as typeof fetch;
  vi.stubEnv("REDIS_URL", "redis://fake.invalid:6379");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_e2e_dummy");
  vi.stubEnv("GEMINI_API_KEY", "e2e-dummy-gemini");
  vi.stubEnv("SERPER_API_KEY", "");
  vi.stubEnv("ADMIN_TOKEN", "test-admin-token");
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  vi.stubEnv("VERTEX_PROJECT_ID", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

/** Tests that are expected to make zero outside calls end with this. */
export function expectNoOutsideCalls() { expect(outside, `outside calls attempted: ${outside.join(", ")}`).toEqual([]); }
