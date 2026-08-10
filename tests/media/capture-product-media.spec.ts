import { expect, test } from "@playwright/test";

const output = "apps/site/public/images/product";

test("capture anonymized product flows", async ({ page }) => {
  await page.goto("http://127.0.0.1:3112");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await expect(page.getByRole("navigation")).toBeVisible();

  await page.screenshot({ path: `${output}/dashboard.png`, fullPage: true });

  await page.getByRole("link", { name: /^salão$/i }).click();
  await expect(page.getByRole("heading", { name: /^salão$/i })).toBeVisible();
  await page.evaluate(() => {
    history.replaceState(null, "", location.pathname);
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: `${output}/salon.png`, fullPage: true });

  await page.getByRole("link", { name: /produção/i }).click();
  await expect(page.getByRole("heading", { name: /produção/i })).toBeVisible();
  await page.evaluate(() => {
    history.replaceState(null, "", location.pathname);
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: `${output}/kds.png`, fullPage: true });

  await page.getByRole("link", { name: /estoque/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Estoque$/i })).toBeVisible();
  await page.evaluate(() => {
    history.replaceState(null, "", location.pathname);
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: `${output}/inventory.png`, fullPage: true });
});
