import { test, expect } from "./fixtures";

test.describe("story mode", () => {
  test("story builder loads and searches via mocked resolve", async ({ page, net }) => {
    await page.route("**/api/story/resolve**", (r) =>
      r.fulfill({ json: { titles: [{ id: "e2e-1", title: "E2E Story Title", type: "anime", image: "https://img.e2e.invalid/s.jpg", cover: "https://img.e2e.invalid/s.jpg" }] } }),
    );
    await page.goto("/story");
    await expect(page).toHaveTitle(/Story100/);
    const search = page.getByPlaceholder(/^Search /);
    await expect(search).toBeVisible();
    await search.fill("e2e");
    await expect
      .poll(() => net.apiCalls.some((c) => c.path.startsWith("/api/story/")) || net.blockedExternal.length > 0, { timeout: 10_000 })
      .toBe(true);
    await expect(page.getByPlaceholder(/Name your grid/)).toBeVisible();
  });

  test("story compare page renders", async ({ page }) => {
    await page.goto("/story/compare");
    await expect(page.locator("body")).toContainText(/compare/i);
  });
});

test.describe("compare", () => {
  test("compare picker renders with mocked community feed", async ({ page, net }) => {
    await page.goto("/compare");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByPlaceholder("Search loaded grids by name...")).toBeVisible();
    await expect.poll(() => net.apiCalls.some((c) => c.path.startsWith("/api/community"))).toBe(true);
  });
});
