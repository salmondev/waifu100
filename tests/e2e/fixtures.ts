import { test as base, expect, type Page, type Route } from "@playwright/test";

// 1x1 transparent PNG used for every image request.
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export const CHARACTERS = [
  { id: 9001, jikan_id: 9001, name: "Test Heroine", images: { jpg: { image_url: "https://img.e2e.invalid/heroine.jpg" } }, source: "E2E Anime" },
  { id: 9002, jikan_id: 9002, name: "Test Rival", images: { jpg: { image_url: "https://img.e2e.invalid/rival.jpg" } }, source: "E2E Anime" },
];

type Handler = (route: Route, url: URL) => unknown;

/** Default mock answers for every /api route the UI calls. Never hits the server. */
export const DEFAULT_API: Record<string, Handler> = {
  "/api/search": () => ({ characters: CHARACTERS }),
  "/api/gallery": () => ({ images: [], results: [] }),
  "/api/serper-images": () => ({ images: [] }),
  "/api/suggest": () => ({ suggestions: [] }),
  "/api/community": () => ({ grids: [], items: [], hasMore: false, total: 0 }),
  "/api/my-grids": () => ({ grids: [] }),
  "/api/share": () => ({ id: "e2eShare01", success: true }),
  "/api/upload": () => ({ url: "https://blob.e2e.invalid/thumb.png" }),
  "/api/analyze": () => ({ verdict: "E2E mocked verdict", analysis: "E2E mocked verdict" }),
  "/api/story/resolve": () => ({ titles: [] }),
  "/api/story/web-search": () => ({ titles: [], results: [] }),
  "/api/story/info": () => ({}),
  "/api/story/images": () => ({ images: [] }),
};

export type MockState = { apiCalls: { method: string; path: string; body: string | null }[]; blockedExternal: string[] };

export async function installNetworkGuard(page: Page, overrides: Record<string, Handler> = {}): Promise<MockState> {
  const state: MockState = { apiCalls: [], blockedExternal: [] };
  const api = { ...DEFAULT_API, ...overrides };
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (local && url.pathname.startsWith("/api/")) {
      state.apiCalls.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() });
      if (url.pathname.startsWith("/api/img")) {
        return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      }
      const key = Object.keys(api)
        .sort((a, b) => b.length - a.length)
        .find((k) => url.pathname === k || url.pathname.startsWith(k + "/"));
      const body = key ? await api[key](route, url) : {};
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body ?? {}) });
    }
    if (local) return route.continue();
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    // Anything off-box is never allowed to reach the network.
    state.blockedExternal.push(url.origin + url.pathname);
    if (req.resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (req.resourceType() === "font" || req.resourceType() === "stylesheet") return route.fulfill({ status: 200, body: "" });
    return route.abort("blockedbyclient");
  });
  // WebSockets (together mode) are mocked dead.
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  return state;
}

// `auto: true` is a SAFETY requirement: the guard must run in every test, even
// ones that never mention `net`, or the real server routes would be called.
export const test = base.extend<{ net: MockState }>({
  net: [async ({ page }, provide) => {
    const state = await installNetworkGuard(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await provide(state);
    expect(errors, `uncaught page errors: ${errors.join("\n")}`).toEqual([]);
  }, { auto: true }],
});

/** Grid cells carry dnd-kit's aria-disabled while empty, so click them with force. */
export async function clickEmptyCell(page: Page, position = 1) {
  await page.getByText(String(position), { exact: true }).first().click({ force: true });
}
export { expect };
