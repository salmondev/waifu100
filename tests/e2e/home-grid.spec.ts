import { test, expect, clickEmptyCell } from "./fixtures";

test.describe("home / search / grid build", () => {
  test("home loads with the builder shell", async ({ page, net }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Waifu100/i);
    await expect(page.getByPlaceholder("Search Character...")).toBeVisible();
    await expect(page.getByText("Progress", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Share/ }).first()).toBeVisible();
    expect(net.apiCalls.filter((c) => c.path.startsWith("/api/search"))).toHaveLength(0);
  });

  test("search shows mocked characters and posts the query", async ({ page, net }) => {
    await page.goto("/");
    await page.getByPlaceholder("Search Character...").fill("heroine");
    await expect(page.getByText("Test Heroine").first()).toBeVisible();
    await expect(page.getByText("Test Rival").first()).toBeVisible();
    const call = net.apiCalls.find((c) => c.path === "/api/search");
    expect(call?.method).toBe("POST");
    expect(JSON.parse(call!.body!)).toEqual({ characterName: "heroine" });
  });

  test("selecting a result and clicking a cell fills the grid", async ({ page }) => {
    await page.goto("/");
    const progress = page.locator("span", { hasText: /^\d+\/\d+$/ }).first();
    const before = await progress.textContent();
    expect(before).toMatch(/^0\//);
    await page.getByPlaceholder("Search Character...").fill("heroine");
    await page.getByText("Test Heroine").first().click();
    // empty cells render their 1-based position
    await clickEmptyCell(page);
    await expect(progress).toHaveText(/^1\//);
  });
});
