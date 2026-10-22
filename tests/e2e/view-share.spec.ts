import { test, expect, CHARACTERS, clickEmptyCell } from "./fixtures";
import { encodeGrid } from "../../src/lib/share";

function sampleHash() {
  const grid = Array.from({ length: 100 }, () => ({ character: null as unknown }));
  CHARACTERS.forEach((c, i) => {
    grid[i] = { character: { mal_id: c.id, name: c.name, images: c.images, source: c.source } };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return encodeGrid(grid as any);
}

test.describe("view", () => {
  test("/view?g= renders an encoded grid", async ({ page }) => {
    await page.goto(`/view?g=${sampleHash()}`);
    await expect(page).toHaveTitle(/Test Heroine/);
    await expect(page.getByText("Test Heroine").first()).toBeVisible();
  });

  test("/view without a hash redirects home", async ({ page }) => {
    await page.goto("/view");
    await expect(page).toHaveURL(/\/$/);
  });

  test("/view/[id] for an unknown share (store unreachable) redirects home", async ({ page }) => {
    await page.goto("/view/e2e-does-not-exist");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("share / export", () => {
  test("share modal posts a mocked share and shows the link", async ({ page, net }) => {
    await page.goto("/");
    await page.getByPlaceholder("Search Character...").fill("heroine");
    await page.getByText("Test Heroine").first().click();
    await clickEmptyCell(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByText("Share Your Grid")).toBeVisible();
    await page.getByPlaceholder("e.g. My Anime Harem").fill("E2E Grid");
    await page.getByRole("button", { name: /Generate Link/ }).click();
    await expect(page.getByText("Your clean link is ready!")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\/view\/e2eShare01/)).toBeVisible();
    const post = net.apiCalls.find((c) => c.path === "/api/share" && c.method === "POST");
    expect(post, "share POST was mocked").toBeTruthy();
    expect(JSON.parse(post!.body!).customTitle).toBe("E2E Grid");
  });

  test("Save as .png produces a download", async ({ page }) => {
    // Force the legacy <a download> path instead of the native Save dialog.
    await page.addInitScript(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
    await page.goto("/");
    await page.getByPlaceholder("Search Character...").fill("heroine");
    await page.getByText("Test Heroine").first().click();
    await clickEmptyCell(page);
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /Save as \.png/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
  });
});
