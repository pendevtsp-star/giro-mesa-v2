import { expect, type Locator, type Page, test } from "@playwright/test";
import { createLiveSalonFixture, responseJson } from "./fixtures/live-salon";

const apiUrl = "http://127.0.0.1:3217";
const internalApiKey = "unified-e2e-internal-key";

type RelatedTab = {
  id: string;
  tableId: string | null;
  label: string | null;
  status: "open" | "closed";
  remainingCents: number;
};

type TabDetail = {
  tab: RelatedTab;
  relatedTabs: RelatedTab[];
  printJobs: Array<{
    id: string;
    tabId: string;
    documentType: string;
    status: string;
    payload: { context?: { label?: string; tableLabel?: string } };
  }>;
  service: { openTabCount: number };
};

async function noHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.document, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport);
}

async function payCurrentAccount(dialog: Locator) {
  const form = dialog.locator("form.cashier-payment-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Forma de pagamento").selectOption("pix");
  await form.getByRole("button", { name: /Confirmar R\$/ }).click();
  await expect(form).toBeHidden();
}

test("separa duas contas na mesma mesa, imprime sem falso positivo e encerra somente no final", async ({
  page,
}) => {
  const fixture = await createLiveSalonFixture(page.request, apiUrl, internalApiKey);
  await page.addInitScript(({ identityId, organizationId, unitId }) => {
    localStorage.setItem(
      "giromesa_operational_scope_v1",
      JSON.stringify({ identityId, organizationId, unitId }),
    );
    localStorage.setItem("giromesa.ops.device-id", "00000000-0000-4000-8000-000000000183");
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => {
        const target = window as Window & { __gmPrintCalls?: number };
        target.__gmPrintCalls = (target.__gmPrintCalls ?? 0) + 1;
      },
    });
  }, fixture);

  await page.goto("/#/salon");
  await expect(page.getByRole("heading", { name: "Mesas e comandas" })).toBeVisible();
  const openOperation = page.getByRole("button", { name: "Abrir operação" });
  if (await openOperation.isVisible()) await openOperation.click();

  await page.locator(".real-table").filter({ hasText: fixture.tableLabel }).click();
  const dialog = page.getByRole("dialog", { name: fixture.tableLabel });
  await dialog.getByRole("button", { name: /Abrir .*pedir/ }).click();
  await expect(dialog.getByRole("button", { name: "Conta e pagamento" })).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("button", { name: "Adicionar Brownie E2E", exact: true }).click();
  await dialog.getByRole("button", { name: "Adicionar Brownie E2E", exact: true }).click();
  await dialog.getByRole("button", { name: "Enviar pedido (2)" }).click();
  await expect(dialog.getByText(/Pedido enviado/)).toBeVisible();

  await dialog.getByRole("button", { name: "Conta e pagamento" }).click();
  await dialog.getByRole("button", { name: "Separar consumo", exact: true }).click();
  const split = dialog.getByRole("form", { name: "Separar consumo" });
  await split.getByLabel("Quantidade de Brownie E2E a separar").fill("1");
  await split.getByLabel("Nome da nova comanda").fill("Conta B");
  await split.getByRole("button", { name: "Confirmar separação de 1 item(ns)" }).click();

  await expect
    .poll(async () => {
      const floor = await responseJson<{ openTabs: Array<{ id: string; label: string | null }> }>(
        await page.request.get(`${fixture.pilotUrl}/floor`),
      );
      const target = floor.openTabs.find((tab) => tab.label === "Conta B");
      return target
        ? responseJson<TabDetail>(await page.request.get(`${fixture.pilotUrl}/tabs/${target.id}`))
        : null;
    })
    .not.toBeNull();

  const floorAfterSplit = await responseJson<{
    openTabs: Array<{ id: string; label: string | null }>;
    tables: Array<{ id: string; status: string }>;
  }>(await page.request.get(`${fixture.pilotUrl}/floor`));
  const targetTab = floorAfterSplit.openTabs.find((tab) => tab.label === "Conta B");
  expect(targetTab).toBeTruthy();
  const detailAfterSplit = await responseJson<TabDetail>(
    await page.request.get(`${fixture.pilotUrl}/tabs/${targetTab?.id}`),
  );
  expect(detailAfterSplit.relatedTabs).toHaveLength(2);
  expect(new Set(detailAfterSplit.relatedTabs.map((tab) => tab.tableId))).toEqual(
    new Set([fixture.tableId]),
  );
  expect(
    detailAfterSplit.relatedTabs.map((tab) => tab.remainingCents).sort((a, b) => a - b),
  ).toEqual([1_500, 1_500]);

  const accounts = dialog.getByRole("region", { name: "Comandas deste atendimento" });
  await expect(accounts).toContainText(`${fixture.tableLabel} · 2 comandas`);
  await expect(accounts).toContainText("Conta B");
  const printQueue = dialog.getByRole("status", { name: "Fila de impressão" });
  await expect(printQueue).toContainText("Pré-conta · Conta B");
  await printQueue.getByRole("button", { name: "Imprimir agora" }).click();
  await expect(dialog.getByText(/cancelar o diálogo não confirma a impressão/)).toBeVisible();

  await accounts
    .locator("article")
    .filter({ hasText: "Principal" })
    .getByRole("button", { name: /^Principal R\$/ })
    .click();
  await expect(printQueue).toContainText("Pré-conta · Principal");
  await printQueue.getByRole("button", { name: "Imprimir agora" }).click();
  await expect(dialog.getByText(/cancelar o diálogo não confirma a impressão/)).toBeVisible();
  await expect(printQueue).toContainText("Saída enviada; confirme o papel");
  expect(
    await page.evaluate(() => (window as Window & { __gmPrintCalls?: number }).__gmPrintCalls),
  ).toBe(2);

  const persisted = await responseJson<TabDetail>(
    await page.request.get(`${fixture.pilotUrl}/tabs/${targetTab?.id}`),
  );
  const statements = persisted.printJobs.filter((job) => job.documentType === "partial_statement");
  expect(statements).toHaveLength(2);
  expect(statements.every((job) => job.status === "confirmation_required")).toBe(true);
  expect(new Set(statements.map((job) => job.payload.context?.label))).toEqual(
    new Set(["Principal", "Conta B"]),
  );
  expect(new Set(statements.map((job) => job.payload.context?.tableLabel))).toEqual(
    new Set([fixture.tableLabel]),
  );
  await expect(dialog.getByRole("button", { name: "Reimprimir última via" })).toHaveCount(0);

  const statementIds = statements.map((job) => job.id).sort();
  await dialog.getByRole("button", { name: "Imprimir pré-conta", exact: true }).click();
  await expect(
    dialog.getByText("Confira a via anterior na fila antes de imprimir novamente."),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const guarded = await responseJson<TabDetail>(
        await page.request.get(`${fixture.pilotUrl}/tabs/${targetTab?.id}`),
      );
      return guarded.printJobs
        .filter((job) => job.documentType === "partial_statement")
        .map((job) => job.id)
        .sort();
    })
    .toEqual(statementIds);
  expect(
    await page.evaluate(() => (window as Window & { __gmPrintCalls?: number }).__gmPrintCalls),
  ).toBe(2);

  await page.reload();
  await expect(page.getByRole("dialog", { name: fixture.tableLabel })).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("giromesa-theme", value);
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
      { width: 360, height: 760 },
    ]) {
      await page.setViewportSize(viewport);
      await noHorizontalOverflow(page);
      await expect(page.getByRole("region", { name: "Comandas deste atendimento" })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  const restoredAccounts = dialog.getByRole("region", { name: "Comandas deste atendimento" });
  await restoredAccounts
    .locator("article")
    .filter({ hasText: "Principal" })
    .getByRole("button", { name: "Receber Principal" })
    .click();
  await payCurrentAccount(dialog);
  await restoredAccounts
    .locator("article")
    .filter({ hasText: "Principal" })
    .getByRole("button", { name: "Finalizar Principal" })
    .click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Encerrar sem imprimir" }).click();

  await expect
    .poll(async () => {
      const floor = await responseJson<{ tables: Array<{ id: string; status: string }> }>(
        await page.request.get(`${fixture.pilotUrl}/floor`),
      );
      return floor.tables.find((table) => table.id === fixture.tableId)?.status;
    })
    .toBe("occupied");
  const afterFirstClose = await responseJson<TabDetail>(
    await page.request.get(`${fixture.pilotUrl}/tabs/${targetTab?.id}`),
  );
  expect(afterFirstClose.service.openTabCount).toBe(1);
  expect(afterFirstClose.relatedTabs.map((tab) => tab.status).sort()).toEqual(["closed", "open"]);

  const remainingAccount = dialog
    .getByRole("region", { name: "Comandas deste atendimento" })
    .locator("article")
    .filter({ hasText: "Conta B" });
  await remainingAccount.getByRole("button", { name: "Receber Conta B" }).click();
  await payCurrentAccount(dialog);
  await remainingAccount.getByRole("button", { name: "Finalizar Conta B" }).click();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "Encerrar sem imprimir" }).click();

  await expect
    .poll(async () => {
      const floor = await responseJson<{ tables: Array<{ id: string; status: string }> }>(
        await page.request.get(`${fixture.pilotUrl}/floor`),
      );
      return floor.tables.find((table) => table.id === fixture.tableId)?.status;
    })
    .toBe("needs_cleaning");
  const afterFinalClose = await responseJson<TabDetail>(
    await page.request.get(`${fixture.pilotUrl}/tabs/${targetTab?.id}`),
  );
  expect(afterFinalClose.service.openTabCount).toBe(0);
  expect(afterFinalClose.relatedTabs.every((tab) => tab.status === "closed")).toBe(true);
  await expect(dialog.getByRole("heading", { name: "Mesa aguardando limpeza" })).toBeVisible();
});
