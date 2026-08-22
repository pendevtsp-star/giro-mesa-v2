import { expect, test } from "@playwright/test";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";
const shiftId = "d1111111-1111-4111-8111-111111111111";
const registerId = "a2222222-2222-4222-8222-222222222222";
const barRegisterId = "a3333333-3333-4333-8333-333333333333";
const barShiftId = "d2222222-2222-4222-8222-222222222222";

test("caixa mantém contagem cega e fechamento legível em 375 px", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "desktop", "A própria jornada cobre desktop e 375 px.");
  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
    },
    { identityId, organizationId, unitId },
  );
  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session") && request.method() === "GET")
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: { id: identityId, email: "caixa@giromesa.test", displayName: "Operador" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "cashier",
            unitId,
          },
        ],
      });
    if (path.endsWith("/organizations"))
      return json([
        {
          membershipId: "membership-1",
          status: "active",
          organization: {
            id: organizationId,
            tradeName: "GiroMesa QA",
            document: "05953016000132",
          },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          roles: [{ role: "cashier", unitId }],
        },
      ]);
    if (path.endsWith(`/cash-shifts/${shiftId}/close`) && request.method() === "POST")
      return json({
        cashShiftId: shiftId,
        status: "closed",
        expectedCents: 15_000,
        countedCents: 14_900,
        differenceCents: -100,
        drawerInCents: 5_000,
        drawerOutCents: 0,
        breakdown: [
          { method: "cash", amountCents: 5_000 },
          { method: "pix", amountCents: 7_000 },
        ],
        reviewRequired: true,
        differenceSeverity: "warning",
        tenderBreakdown: [
          {
            method: "cash",
            expectedCents: 15_000,
            observedCents: 14_900,
            differenceCents: -100,
            source: "manual",
          },
        ],
      });
    if (path.endsWith("/cash-shifts/history")) return json({ items: [], nextCursor: null });
    if (path.endsWith("/cash-shifts"))
      return json({
        settings: {
          movementApprovalThresholdCents: 50_000,
          discrepancyCriticalThresholdCents: 1_000,
          maxShiftMinutes: 720,
        },
        alerts: [],
        operators: [{ identityId, name: "Operador" }],
        approvals: [],
        adjustments: [],
        capabilities: {
          canOpen: true,
          canMove: true,
          canClose: true,
          canReview: false,
          canViewExpected: false,
          canManageRegisters: false,
          canTransfer: true,
          canManageCashSettings: false,
          canManageTerminals: false,
          canApproveCashRequests: false,
          canHandover: false,
        },
        registers: [
          { id: registerId, name: "Caixa principal", active: true, openShiftId: shiftId },
          { id: barRegisterId, name: "Bar", active: true, openShiftId: barShiftId },
        ],
        availableTerminals: [],
        shifts: [
          {
            id: shiftId,
            cashRegisterId: registerId,
            cashRegisterName: "Caixa principal",
            status: "open",
            openingCents: 10_000,
            expectedCents: null,
            countedCents: null,
            differenceCents: null,
            openedAt: "2026-08-21T15:00:00.000Z",
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
            openedAt: "2026-08-21T15:30:00.000Z",
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
        ],
        entries: [
          {
            id: "e1111111-1111-4111-8111-111111111111",
            cashShiftId: shiftId,
            direction: "in",
            entryType: "pos_payment",
            paymentMethod: "cash",
            affectsDrawer: true,
            amountCents: 5_000,
            description: null,
            actorName: "Operador",
            occurredAt: "2026-08-21T16:00:00.000Z",
          },
        ],
        pendingTabs: [
          {
            id: "f1111111-1111-4111-8111-111111111111",
            label: "Mesa 7",
            totalCents: 8_000,
            paidCents: 3_000,
            remainingCents: 5_000,
          },
        ],
      });
    return json({});
  });

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/#/cash");
    await expect(page.getByRole("heading", { name: "Contas e caixa" })).toBeVisible();
    await expect(page.getByText("Contagem cega", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Caixa principal · aberto" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bar · aberto" })).toBeVisible();
    await expect(page.getByText("2 gavetas em operação", { exact: true })).toBeVisible();
    await expect(page.getByText("1 comanda(s) com saldo pendente")).toBeVisible();

    const countedInput = page.getByLabel("Dinheiro contado");
    if (!(await countedInput.isVisible()))
      await page.getByText("Fechar caixa", { exact: true }).click();
    await countedInput.fill("149,00");
    await page.getByRole("button", { name: "Revisar contagem" }).click();
    await expect(
      page.getByText("Após fechar, o esperado e a diferença serão revelados."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirmar fechamento" }).click();
    await expect(page.getByRole("heading", { name: "Resultado da conferência" })).toBeVisible();
    await expect(page.getByText("Revisão necessária", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
