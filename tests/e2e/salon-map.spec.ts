import { expect, test } from "@playwright/test";

async function enterDemoSalon(page: import("@playwright/test").Page) {
  await page.goto(test.info().project.use.baseURL ?? "http://127.0.0.1:3112");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await page.evaluate(() => {
    window.location.hash = "/salon";
  });
}

test("salon map supports search, redundant state and spatial keyboard navigation", async ({
  page,
}) => {
  await enterDemoSalon(page);
  await expect(page.getByRole("heading", { name: /mapa do salão/i })).toBeVisible();
  await expect(page.getByText("Sincronizado", { exact: true })).toBeVisible();
  const first = page.getByRole("button", { name: /mesa 001,/i });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /mesa 002,/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByPlaceholder("Buscar mesa").fill("Mesa 003");
  await expect(page.getByRole("button", { name: /mesa 003,/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /mesa 001,/i })).toHaveCount(0);
});

test("salon map keeps touch controls and detail panel usable on tablet", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterDemoSalon(page);
  await page.getByRole("button", { name: /mesa 003,/i }).click();
  await expect(page.getByRole("complementary", { name: /detalhes da mesa/i })).toContainText(
    /mesa 003/i,
  );
  await expect(page.getByRole("button", { name: /aumentar zoom/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
