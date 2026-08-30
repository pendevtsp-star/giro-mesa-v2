import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const organizationId = "a7111111-1111-4111-8111-111111111111";
const unitId = "b7111111-1111-4111-8111-111111111111";
const identityId = "c7111111-1111-4111-8111-111111111111";

async function mockFinance(page: Page) {
  await mockCompatibleApi(page);
  await page.addInitScript(
    (scope) => localStorage.setItem("giromesa_operational_scope_v1", JSON.stringify(scope)),
    { organizationId, unitId, identityId },
  );
  await page.route(/\/v1\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session"))
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: { id: identityId, email: "dono@giromesa.test", displayName: "Proprietário" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "owner",
            unitId: null,
          },
        ],
      });
    if (path.endsWith("/organizations"))
      return json([
        {
          membershipId: "membership-1",
          status: "active",
          organization: { id: organizationId, tradeName: "Casa Giro", document: "05953016000132" },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          roles: [{ role: "owner", unitId: null }],
        },
      ]);
    if (path.endsWith("/management/cash-shifts"))
      return json({
        settings: {
          movementApprovalThresholdCents: 50_000,
          discrepancyCriticalThresholdCents: 1_000,
          maxShiftMinutes: 720,
        },
        alerts: [],
        operators: [],
        approvals: [],
        pendingTransfers: [],
        adjustments: [],
        capabilities: {
          canOpen: true,
          canMove: true,
          canClose: true,
          canReview: true,
          canViewExpected: true,
          canManageRegisters: true,
          canTransfer: true,
          canManageCashSettings: true,
          canManageTerminals: true,
          canApproveCashRequests: true,
          canHandover: true,
        },
        registers: [
          {
            id: "d7111111-1111-4111-8111-111111111111",
            name: "Caixa principal",
            active: true,
            openShiftId: "e7111111-1111-4111-8111-111111111111",
          },
        ],
        availableTerminals: [],
        shifts: [],
        entries: [],
        pendingTabs: [],
      });
    if (path.endsWith("/management/finance"))
      return json({
        entries: [
          {
            id: "f7111111-1111-4111-8111-111111111111",
            direction: "payable",
            description: "Aluguel",
            status: "partially_paid",
            amountCents: 250000,
            settledCents: 100000,
            paidCents: 100000,
            competenceDate: "2026-08-01",
            dueDate: "2026-08-10",
            category: "Estrutura",
            costCenter: "Loja",
            documentNumber: "ALU-08",
            notes: null,
            supplierName: "Imobiliária",
            installmentNumber: 1,
            installmentCount: 1,
            attachments: [],
            version: 2,
          },
          {
            id: "f7222222-2222-4222-8222-222222222222",
            direction: "receivable",
            description: "Evento corporativo",
            status: "open",
            amountCents: 420000,
            settledCents: 0,
            receivedCents: 0,
            competenceDate: "2026-08-20",
            dueDate: "2026-08-28",
            category: "Eventos",
            costCenter: null,
            documentNumber: "EV-42",
            notes: null,
            supplierName: null,
            installmentNumber: 1,
            installmentCount: 2,
            attachments: [],
            version: 1,
          },
        ],
        payables: [],
        receivables: [],
        payablePayments: [
          {
            id: "a7222222-2222-4222-8222-222222222222",
            payableId: "f7111111-1111-4111-8111-111111111111",
            amountCents: 100000,
            method: "pix",
            reference: "PIX-08",
            status: "posted",
            paidAt: "2026-08-05T12:00:00.000Z",
            reversalReason: null,
          },
        ],
        receivablePayments: [],
        reconciliationImports: [],
        reconciliationEntries: [
          {
            id: "a7333333-3333-4333-8333-333333333333",
            externalKey: "BANK-1",
            paymentDirection: "receivable",
            paymentId: null,
            grossCents: 420000,
            feeCents: 0,
            netCents: 420000,
            status: "unmatched",
            resolutionNote: null,
            version: 1,
          },
        ],
        approvals: [],
        settings: {
          paymentApprovalThresholdCents: 200000,
          requireDistinctApprover: true,
          dueSoonDays: 7,
        },
        summary: {
          payableCents: 150000,
          receivableCents: 420000,
          projectedBalanceCents: 270000,
          overdueCount: 1,
          dueTodayCount: 0,
          dueSoonCount: 1,
          unresolvedReconciliations: 1,
        },
        projection: [
          { date: "2026-08-28", payableCents: 0, receivableCents: 420000, balanceCents: 420000 },
        ],
        pagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 },
        capabilities: {
          canManage: true,
          canConfigure: true,
          canApprove: true,
          canOperateCash: true,
        },
      });
    return json({});
  });
}

test("financeiro mantém agenda e ações legíveis no desktop e em 375 px", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre 1440 px e 375 px.");
  await mockFinance(page);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/#/finance");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Financeiro" })).toBeVisible();
    await expect(page.getByText("Saldo projetado", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Agenda", exact: true }).click();
    await expect(page.getByRole("button", { name: "Registrar lançamento" })).toBeVisible();
    await expect(page.getByLabel("Categoria", { exact: true })).toBeHidden();
    await page.getByText("Mais informações", { exact: true }).click();
    await expect(page.getByLabel("Categoria", { exact: true })).toBeVisible();
    await page.getByText("Mais informações", { exact: true }).click();
    await page.getByRole("button", { name: /Aluguel/ }).click();
    await expect(page.getByText("Registrar liquidação", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /Conciliação/ }).click();
    await expect(page.getByText("Sem conexão bancária", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("navegação para outro módulo não preserva a rolagem do financeiro", async ({ page }) => {
  await mockFinance(page);
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto("http://127.0.0.1:3112/#/finance");
  await expect(page.getByRole("heading", { name: "Financeiro" })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.location.hash = "#/dashboard";
  });

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
