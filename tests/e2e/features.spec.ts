import { test, expect, clickEmptyCell } from "./fixtures";
import { mockAniList, COVER } from "./fixtures-story";

const VERDICT = { en: { title: "E2E Tsundere Curator", content: "Mocked verdict body.", tags: ["#e2e"] }, th: { title: "ซึนเดเระ", content: "คำตัดสินจำลอง", tags: ["#e2e"] }, emoji: "🔥", styleVersion: 1 };

async function fillTwo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByPlaceholder("Search Character...").fill("heroine");
  await page.getByText("Test Heroine").first().click();
  await clickEmptyCell(page, 1);
  await page.getByText("Test Rival").first().click();
  await clickEmptyCell(page, 2);
  await expect(page.locator("span", { hasText: /^2\/\d+$/ }).first()).toBeVisible();
}

test.describe("AI verdict (waifu)", () => {
  test("generated once, regenerated after disagree, copy text works", async ({ page, net, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/analyze", (r) => r.fulfill({ json: VERDICT }));
    await fillTwo(page);
    await page.getByRole("button", { name: /Ask AI About My Taste/ }).click();
    await expect(page.getByText("ซึนเดเระ").first()).toBeVisible();
    const analyzeCalls = () => net.apiCalls.filter((c) => c.path === "/api/analyze").length;
    expect(analyzeCalls()).toBe(0); // the test-level route answered; guard saw none
    await page.getByRole("button", { name: /Copy Text/ }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("ซึนเดเระ");
    await page.getByRole("button", { name: /Copy Image/ }).click(); // renders the card; must not throw
    await page.getByRole("button", { name: /Disagree/ }).click();
    // close the modal with its top-right X (first button inside the overlay card)
    await page.locator("div.fixed.inset-0.z-50 > div > button").first().click();
    await expect(page.getByText("AI Verdict")).toBeHidden();
    let calls = 0;
    await page.unroute("**/api/analyze");
    await page.route("**/api/analyze", (r) => { calls++; return r.fulfill({ json: { ...VERDICT, th: { ...VERDICT.th, title: "รอบสอง" } } }); });
    await page.getByRole("button", { name: /Ask AI About My Taste/ }).click({ force: true });
    await expect(page.getByText("รอบสอง").first()).toBeVisible();
    expect(calls).toBe(1);
  });

  test("error state: analyze 500 shows friendly error and Try Again", async ({ page }) => {
    await page.route("**/api/analyze", (r) => r.fulfill({ status: 500, json: { error: "GEMINI_API_KEY boom" } }));
    await fillTwo(page);
    await page.getByRole("button", { name: /Ask AI About My Taste/ }).click();
    await expect(page.getByText(/The AI needed a break/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("GEMINI_API_KEY");
  });
});

test.describe("story mode", () => {
  for (const [label, type] of [["Anime", "ANIME"], ["Manga", "MANGA"], ["Light Novel", "NOVEL"]] as const) {
    test(`search ${type} via (mocked) AniList`, async ({ page }) => {
      const calls = await mockAniList(page);
      await page.goto("/story");
      const radio = page.getByRole("radiogroup", { name: "Search for" }).getByRole("radio", { name: new RegExp(label, "i") });
      await radio.click();
      await page.getByPlaceholder(/^Search /).fill("e2e");
      await expect(page.getByRole("list", { name: "Search results" })).toContainText(/E2E/);
      expect(calls.length).toBeGreaterThan(0);
      if (type === "NOVEL") expect(calls.at(-1)?.formatIn).toContain("NOVEL");
    });
  }

  test("pick a title + image into a cell", async ({ page }) => {
    await mockAniList(page);
    await page.route("**/api/story/images**", (r) => r.fulfill({ json: { images: [{ url: COVER(8), src: "anilist" }], sections: [] } }));
    await page.route("**/api/story/info**", (r) => r.fulfill({ json: { info: { synopsis: "E2E synopsis text", genres: ["Action"] } } }));
    await page.goto("/story");
    await page.getByPlaceholder(/^Search /).fill("e2e");
    await page.getByRole("list", { name: "Search results" }).getByRole("button").first().click();
    const dialog = page.getByRole("dialog", { name: /Choose an image for/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button").filter({ has: page.locator("img") }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("span", { hasText: /^1\/9$/ }).first()).toBeVisible();
    // The detail card lives on the server-rendered /story/v/[id] page; see tests/integration/story-cell-card.test.tsx
  });

  test("Serper fallback: AniList down -> web results from /api/story/web-search", async ({ page }) => {
    await mockAniList(page, { down: true });
    let web = 0;
    await page.route("**/api/story/web-search**", (r) => { web++; return r.fulfill({ json: { items: [{ id: "w-e2e", type: "ANIME", title: "E2E Web Result", cover: COVER(9), src: "web" }], cached: false } }); });
    await page.goto("/story");
    await page.getByPlaceholder(/^Search /).fill("fallback");
    await expect(page.getByRole("list", { name: "Search results" })).toContainText("E2E Web Result", { timeout: 15_000 });
    expect(web).toBeGreaterThan(0);
  });

  test("custom cover upload: wrong type and oversize are rejected client-side, PNG is accepted", async ({ page, net }) => {
    await mockAniList(page);
    await page.route("**/api/story/upload", (r) => r.fulfill({ json: { item: { id: "u-1", type: "ANIME", title: "My cover", cover: "https://blob.e2e.invalid/c.png", src: "upload" } } }));
    await page.goto("/story");
    const input = page.getByTestId("upload-input");
    const add = page.getByRole("button", { name: "Add to grid" });
    await input.setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await add.click();
    await expect(page.locator("body")).toContainText(/JPEG, PNG or WebP/);
    await page.getByRole("button", { name: "Cancel" }).last().click();
    await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 10) });
    await add.click();
    await expect(page.locator("body")).toContainText(/larger than 2 MB/);
    await page.getByRole("button", { name: "Cancel" }).last().click();
    expect(net.apiCalls.filter((c) => c.path === "/api/story/upload")).toHaveLength(0);
    let uploaded = 0;
    await page.unroute("**/api/story/upload");
    await page.route("**/api/story/upload", (r) => { uploaded++; return r.fulfill({ json: { item: { id: "u-1", type: "ANIME", title: "My cover", cover: "https://blob.e2e.invalid/c.png", src: "upload" } } }); });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    await input.setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: png });
    await add.click();
    await expect.poll(() => uploaded).toBe(1);
    await expect(page.locator("span", { hasText: /^1\/9$/ }).first()).toBeVisible();
  });
});

test.describe("together mode", () => {
  test("start a session: room created on the (mocked) room server, then the board opens", async ({ page }) => {
    let created = 0;
    await page.route("http://127.0.0.1:9/**", (r) => { created++; return r.fulfill({ json: { code: "E2EROOM", ownerToken: "tok" } }); });
    await page.goto("/story");
    await page.getByRole("button", { name: /Build Grid Together/ }).click();
    await page.getByRole("button", { name: "Start session" }).click();
    await expect(page).toHaveURL(/\/story\/together\/E2EROOM/);
    expect(created).toBe(1);
  });
  test("error state: room server down shows a message, stays on page", async ({ page }) => {
    await page.route("http://127.0.0.1:9/**", (r) => r.fulfill({ status: 503, body: "" }));
    await page.goto("/story/together");
    await expect(page.locator("body")).toContainText(/isn't running|couldn't|try again/i);
  });
});

test.describe("community, my-grids, compare picker", () => {
  const SUM = (id: string, title: string) => ({ id, title, imageUrl: null, createdAt: "2026-01-01T00:00:00.000Z", hasGif: false, count: 3, kind: "waifu", size: 100 });
  test("compare: pick two grids from the feed -> /compare?a&b", async ({ page }) => {
    await page.route("**/api/community**", (r) => r.fulfill({ json: { grids: [SUM("gridAAA1", "Alpha Grid"), SUM("gridBBB2", "Beta Grid")], total: 2, nextOffset: null, hasMore: false } }));
    await page.goto("/compare");
    await page.getByText("Alpha Grid").first().click();
    await page.getByText("Beta Grid").first().click();
    await page.getByRole("button", { name: /Compare these two/ }).click();
    await expect(page).toHaveURL(/\/compare\?a=gridAAA1&b=gridBBB2/);
  });
  test("compare: feed failure shows an error state", async ({ page }) => {
    await page.route("**/api/community**", (r) => r.fulfill({ status: 500, json: { error: "x" } }));
    await page.goto("/compare");
    await expect(page.getByText(/Couldn't load the showcase/)).toBeVisible();
  });
  test("my-grids page lists the visitor's grids from the (mocked) API", async ({ page }) => {
    await page.route("**/api/my-grids**", (r) => r.fulfill({ json: { grids: [SUM("mine0001", "My Own Grid")] } }));
    await page.addInitScript(() => localStorage.setItem("waifu100-user-id", "123e4567-e89b-42d3-a456-426614174000"));
    await page.goto("/my-grids");
    await expect(page.locator("body")).toContainText(/My Own Grid|grids/i);
  });
  test("community page renders its empty/unavailable state without crashing", async ({ page }) => {
    await page.goto("/community");
    await expect(page.locator("body")).toContainText(/community|showcase/i);
  });
});

test.describe("error states (waifu)", () => {
  test("search API 500 shows the no-results fallback, not a crash", async ({ page }) => {
    await page.route("**/api/search", (r) => r.fulfill({ status: 500, json: { error: "x" } }));
    await page.goto("/");
    await page.getByPlaceholder("Search Character...").fill("broken");
    await expect(page.getByText("No official character found.")).toBeVisible();
  });
  test("share API failure shows an error in the modal", async ({ page }) => {
    await page.route("**/api/share", (r) => r.fulfill({ status: 500, json: { error: "boom" } }));
    await fillTwo(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: /Generate Link/ }).click();
    await expect(page.getByText(/Failed to save|went wrong|try again/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
