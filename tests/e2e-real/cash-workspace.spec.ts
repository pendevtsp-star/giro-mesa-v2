import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApiHealth } from "./api-health-mock";

const organizationId = "org-cash-workspace";
const unitId = "unit-cash-workspace";
const identityId = "identity-cash-workspace";
const mainRegisterId = "register-main";
const barRegisterId = "register-bar";
const mainShiftId = "shift-main";
const barShiftId = "shift-bar";
const reviewShiftId = "shift-review";

const reviewedShift = {
  id: reviewShiftId,
  cashRegisterId: mainRegisterId,
  cashRegisterName: "Caixa principal",
  unitName: "Unidade Centro",
  status: "closed",
  openingCents: 10_000,
  expectedCents: 15_000,
  countedCents: 14_900,
  differenceCents: -100,
  differenceSeverity: "warning",
  openedAt: "2026-09-06T15:00:00.000Z",
  closedAt: "2026-09-06T22:00:00.000Z",
  operatorName: "Operador",
  responsibleName: "Operador",
  closedByName: "Operador",
  reviewedByName: null,
  reviewedAt: null,
  reviewNote: null,
  currentResponsibleIdentityId: identityId,
  tenderBreakdown: [],
};

async function mockCashApi(page: Page) {
  await mockCompatibleApiHealth(page, "cash-workspace-e2e");
  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
    },
    { identityId, organizationId, unitId },
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });

    if (pathname.endsWith("/auth/terminal-session")) {
      await json({ code: "TERMINAL_SESSION_REQUIRED" }, 401);
      return;
    }
    if (pathname.endsWith("/auth/me")) {
      await json({
        identity: { id: identityId, email: "caixa@giromesa.test", displayName: "Operador" },
        memberships: [{ membershipId: "membership-cash", organizationId, status: "active" }],
      });
      return;
    }
    if (pathname.endsWith("/organizations")) {
      await json([
        {
          membershipId: "membership-cash",
          organization: {
            id: organizationId,
            tradeName: "GiroMesa Caixa",
            document: "05953016000132",
          },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          scopes: [{ role: "manager", unitId }],
        },
      ]);
      return;
    }
    if (pathname.endsWith("/cash-shifts/history")) {
      await json({ items: [reviewedShift], nextCursor: null });
      return;
    }
    if (pathname.endsWith("/cash-shifts")) {
      await json({
        settings: {
          movementApprovalThresholdCents: 50_000,
          discrepancyCriticalThresholdCents: 1_000,
          maxShiftMinutes: 720,
        },
        alerts: [],
        operators: [{ identityId, name: "Operador" }],
        approvals: [],
        pendingTransfers: [],
        adjustments: [],
        capabilities: {
          canOpen: true,
          canMove: true,
          canClose: true,
          canReview: true,
          canViewExpected: false,
          canManageRegisters: true,
          canTransfer: true,
          canManageCashSettings: true,
          canManageTerminals: true,
          canApproveCashRequests: true,
          canHandover: true,
        },
        registers: [
          { id: mainRegisterId, name: "Caixa principal", active: true, openShiftId: mainShiftId },
          { id: barRegisterId, name: "Bar", active: true, openShiftId: barShiftId },
        ],
        availableTerminals: [
          {
            installationId: "browser-current",
            label: "Navegador atual",
            cashRegisterId: mainRegisterId,
            status: "online",
            lastSeenAt: "2026-09-10T12:00:00.000Z",
          },
        ],
        shifts: [
          {
            id: mainShiftId,
            cashRegisterId: mainRegisterId,
            cashRegisterName: "Caixa principal",
            status: "open",
            openingCents: 10_000,
            expectedCents: null,
            countedCents: null,
            differenceCents: null,
            openedAt: "2026-09-10T10:00:00.000Z",
            closedAt: null,
            operatorName: "Operador",
            closedByName: null,
            reviewedByName: null,
            reviewedAt: null,
            reviewNote: null,
            currentResponsibleIdentityId: identityId,
            responsibleName: "Operador",
            tenderBreakdown: [],
            differenceSeverity: "none",
          },
          {
            id: barShiftId,
            cashRegisterId: barRegisterId,
            cashRegisterName: "Bar",
            status: "open",
            openingCents: 5_000,
            expectedCents: null,
            countedCents: null,
            differenceCents: null,
            openedAt: "2026-09-10T10:30:00.000Z",
            closedAt: null,
            operatorName: "Operador",
            closedByName: null,
            reviewedByName: null,
            reviewedAt: null,
            reviewNote: null,
            currentResponsibleIdentityId: identityId,
            responsibleName: "Operador",
            tenderBreakdown: [],
            differenceSeverity: "none",
          },
          reviewedShift,
        ],
        entries: [
          {
            id: "entry-main",
            cashShiftId: mainShiftId,
            direction: "in",
            entryType: "pos_payment",
            paymentMethod: "cash",
            affectsDrawer: true,
            amountCents: 5_000,
            description: "Venda do salão",
            actorName: "Operador",
            occurredAt: "2026-09-10T11:00:00.000Z",
          },
          {
            id: "entry-bar",
            cashShiftId: barShiftId,
            direction: "in",
            entryType: "supply",
            paymentMethod: null,
            affectsDrawer: true,
            amountCents: 2_000,
            description: "Troco do bar",
            actorName: "Operador",
            occurredAt: "2026-09-10T11:30:00.000Z",
          },
        ],
        pendingTabs: [],
      });
      return;
    }
    await json({});
  });
}

test("caixa separa turno, extrato, histórico e configurações por tarefa", async ({ page }) => {
  await mockCashApi(page);
  await page.goto("/#/cash");

  const turn = page.getByRole("button", { name: "Turno", exact: true });
  const ledger = page.getByRole("button", { name: "Extrato", exact: true });
  const history = page.getByRole("button", { name: /Histórico/ });
  const settings = page.getByRole("button", { name: "Configurações", exact: true });
  const mainRegister = page.getByRole("button", { name: "Selecionar Caixa principal, aberto" });
  const barRegister = page.getByRole("button", { name: "Selecionar Bar, aberto" });

  await expect(turn).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fechar turno" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extrato do caixa" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Histórico de turnos" })).toHaveCount(0);

  await ledger.click();
  await expect(ledger).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Extrato do caixa" })).toBeVisible();
  await expect(page.locator(".cash-entry").filter({ hasText: "Venda do salão" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toBeHidden();

  await barRegister.click();
  await expect(barRegister).toHaveAttribute("aria-pressed", "true");
  await expect(ledger).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".cash-entry").filter({ hasText: "Troco do bar" })).toBeVisible();
  await expect(page.locator(".cash-entry").filter({ hasText: "Venda do salão" })).toHaveCount(0);

  await turn.click();
  await expect(barRegister).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Bar" })).toBeVisible();
  await mainRegister.click();
  await history.click();
  await expect(history).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Histórico de turnos" })).toBeVisible();
  await expect(page.getByText(/Revisar divergência/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Extrato do caixa" })).toBeHidden();

  await settings.click();
  await expect(settings).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Política e terminais", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Gaveta vinculada")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Histórico de turnos" })).toHaveCount(0);

  await turn.click();
  await expect(page.getByRole("heading", { name: "Fechar turno" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByRole("heading", { name: "Fechar turno" })).toBeVisible();
  await page.getByText("Transferir responsabilidade", { exact: true }).click();
  await expect(page.getByText("Nenhum outro operador está disponível")).toBeVisible();
  await expect(page.getByLabel("Novo responsável")).toHaveCount(0);
});
