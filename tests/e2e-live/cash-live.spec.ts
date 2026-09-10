import { expect, test } from "@playwright/test";

const apiUrl = "http://127.0.0.1:3215";

test("abre, movimenta e fecha um caixa pela UI com API e PostgreSQL reais", async ({ page }) => {
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `cash-live-${suffix}@example.test`;
  const password = "cash-live-password-2026";

  const registration = await page.request.post(`${apiUrl}/v1/auth/register`, {
    data: { email, name: "Cash Live Owner", password, termsAccepted: true },
  });
  expect(registration.ok()).toBe(true);
  const identityId = ((await registration.json()) as { identity: { id: string } }).identity.id;

  const organization = await page.request.post(`${apiUrl}/v1/organizations`, {
    data: {
      legalName: `Cash Live ${suffix}`,
      tradeName: "Cash Live",
      document: `E2E${Date.now().toString().slice(-9)}00`,
      unitName: "Unidade E2E",
      timezone: "America/Sao_Paulo",
    },
  });
  expect(organization.ok()).toBe(true);
  const created = (await organization.json()) as {
    organization: { id: string };
    unit: { id: string };
  };
  const organizationId = created.organization.id;

  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
    },
    { identityId, organizationId, unitId: created.unit.id },
  );
  await page.goto("/#/cash");
  await expect(page.getByRole("heading", { name: "Contas e caixa" })).toBeVisible();

  await page.getByRole("button", { name: "Adicionar gaveta" }).click();
  await page.getByLabel("Nome da gaveta").fill("Caixa E2E");
  await page.getByRole("button", { name: "Salvar gaveta" }).click();
  await expect(page.getByRole("button", { name: "Selecionar Caixa E2E, fechado" })).toBeVisible();
  await page.getByLabel("Ações da gaveta Caixa E2E").click();
  await page.getByRole("button", { name: "Renomear" }).click();
  await page.getByLabel("Novo nome").fill("Caixa E2E principal");
  await page.getByRole("button", { name: "Salvar nome" }).click();
  await expect(
    page.getByRole("button", { name: "Selecionar Caixa E2E principal, fechado" }),
  ).toBeVisible();

  await page.getByLabel("Fundo de troco inicial (R$)").fill("100,00");
  await page.getByRole("button", { name: "Abrir turno" }).click();
  await expect(page.getByText("Caixa aberto com sucesso.", { exact: true })).toBeVisible();
  await page.getByLabel("Ações da gaveta Caixa E2E principal").click();
  await expect(page.getByRole("button", { name: "Desativar" })).toBeDisabled();
  await expect(page.getByText("Feche o caixa para desativar.")).toBeVisible();

  await page.getByRole("button", { name: "Suprimento", exact: true }).click();
  await page.getByLabel("Valor (R$)").fill("10,00");
  await page.getByLabel("Motivo auditável").fill("Reforço E2E");
  await page.getByRole("button", { name: "Registrar Suprimento" }).click();
  await expect(page.getByText("Suprimento registrado.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("R$ 110,00", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  await page.getByLabel("Dinheiro contado").fill("110,00");
  await page.getByRole("button", { name: "Revisar Contagem e Fechar Caixa" }).click();
  await page.getByRole("button", { name: "Confirmar fechamento" }).click();
  await expect(page.getByRole("heading", { name: "Resultado da conferência" })).toBeVisible();
  await expect(page.getByText("Sem diferença", { exact: true })).toBeVisible();
});
