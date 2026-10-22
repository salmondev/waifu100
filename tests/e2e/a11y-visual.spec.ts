import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";

const PAGES = ["/", "/story", "/compare", "/community"];

// Baseline of critical violations that already exist in the app (Oct 2026).
// The gate fails on any NEW critical violation; shrink this list as they get fixed.
const KNOWN_CRITICAL: Record<string, string[]> = {
  "/": ["button-name"],
  "/community": ["aria-required-children"],
};

for (const path of PAGES) {
  test(`a11y: no critical axe violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    const critical = results.violations.filter((v) => v.impact === "critical");
    test.info().annotations.push({ type: "axe-serious", description: results.violations.filter((v) => v.impact === "serious").map((v) => v.id).join(",") || "none" });
    const known = KNOWN_CRITICAL[path] ?? [];
    const fresh = critical.filter((v) => !known.includes(v.id));
    expect(fresh.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });

  test(`visual smoke: ${path} renders non-blank`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const shot = await page.screenshot({ fullPage: false });
    await test.info().attach(`screenshot${path.replace(/\//g, "_") || "_home"}.png`, { body: shot, contentType: "image/png" });
    expect(shot.byteLength).toBeGreaterThan(5_000);
    const textLen = (await page.locator("body").innerText()).trim().length;
    expect(textLen).toBeGreaterThan(20);
  });
}
