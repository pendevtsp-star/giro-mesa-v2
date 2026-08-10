import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function expectWcagAa(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("commercial landing and login meet WCAG AA", async ({ page }) => {
  await page.goto("http://localhost:3110");
  await expectWcagAa(page);
  await page.goto("http://localhost:3110/login");
  await expectWcagAa(page);
  await page.goto("http://localhost:3110/criar-conta");
  await expectWcagAa(page);
});

test("public menu meets WCAG AA", async ({ page }) => {
  await page.goto("http://localhost:3111/m/demo");
  await expectWcagAa(page);
});

test("operational login and dashboard meet WCAG AA", async ({ page }) => {
  await page.goto("http://127.0.0.1:3112");
  await expectWcagAa(page);
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expectWcagAa(page);
});
