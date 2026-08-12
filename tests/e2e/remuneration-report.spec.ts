import { expect, test } from "@playwright/test";

test("remuneration report separates categories and never fabricates demo values", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3112");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  const menuButton = page.getByRole("button", { name: "Abrir menu", exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
  await page.getByRole("link", { name: /remuneração/i }).click();
  await expect(page.getByRole("heading", { name: /relatório de remuneração/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /taxa de serviço/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^comissão$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /participação nos resultados/i })).toBeVisible();
  await expect(page.getByText(/nenhum valor financeiro foi fabricado/i)).toBeVisible();
});
