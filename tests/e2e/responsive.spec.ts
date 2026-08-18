import { expect, test } from "@playwright/test";

const widths = [375, 640, 900, 1180, 1440];

test("site comercial não cria overflow nos breakpoints suportados", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A matriz de larguras já inclui mobile.");

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3110");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(layout.document, JSON.stringify(layout)).toBe(layout.viewport);
  }
});
