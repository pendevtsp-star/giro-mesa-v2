import { expect, test } from "@playwright/test";

const widths = [375, 640, 900, 1180, 1440];
// biome-ignore lint/suspicious/noUndeclaredEnvVars: These Playwright journeys run directly, outside Turbo caching.
const siteUrl = process.env.SITE_E2E_URL ?? "http://localhost:3110";

test("site comercial não cria overflow nos breakpoints suportados", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A matriz de larguras já inclui mobile.");

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(siteUrl);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      gutters: Array.from(document.querySelectorAll(".container")).map((element) => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: window.innerWidth - bounds.right };
      }),
    }));
    expect(layout.document, JSON.stringify(layout)).toBe(layout.viewport);
    for (const gutter of layout.gutters) {
      expect(gutter.left).toBeGreaterThanOrEqual(16);
      expect(gutter.right).toBeGreaterThanOrEqual(16);
    }
    await expect(page.getByRole("link", { name: "Entrar", exact: true })).toBeVisible();

    if (width <= 960) {
      const menu = page.locator(".mobile-nav");
      const toggle = menu.locator("summary");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(menu).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(toggle).toBeFocused();
      await toggle.click();
      await menu.getByRole("link", { name: "Planos", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(page).toHaveURL(/#planos$/);
      await expect(page.locator("#planos")).toBeInViewport();
    }
  }
});
