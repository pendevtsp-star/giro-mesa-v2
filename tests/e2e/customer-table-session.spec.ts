import { expect, test } from "@playwright/test";

test("customer table actions stay bound to the physical-session surface", async ({ page }) => {
  await page.goto("http://localhost:3111/m/demo/servicos");
  await expect(page.getByRole("heading", { name: /atendimento e parcial/i })).toBeVisible();
  await page.getByRole("button", { name: /chamar garçom/i }).click();
  await expect(page.getByRole("status").last()).toContainText(/chamado encaminhado/i);
  await page.getByRole("button", { name: /ver parcial/i }).click();
  await expect(page.getByRole("heading", { name: /parcial deste atendimento/i })).toBeVisible();
  await expect(page.getByText(/consumo demonstrativo/i)).toBeVisible();
  await expect(page.getByText(/r\$\s*136,70/i).first()).toBeVisible();
});
