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

async function mockCashApi(
  page: Page,
  options: {
    registers?: "empty" | "closed" | "inactive";
    canOpen?: boolean;
    reviewResponsibleIdentityId?: string;
  } = {},
) {
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
          canOpen: options.canOpen ?? true,
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
          {
            ...reviewedShift,
            currentResponsibleIdentityId: options.reviewResponsibleIdentityId ?? identityId,
          },
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
        ...(options.registers
          ? {
              registers:
                options.registers === "empty"
                  ? []
                  : [
                      {
                        id: mainRegisterId,
                        name: "Caixa principal",
                        active: options.registers !== "inactive",
                        openShiftId: null,
                      },
                    ],
              shifts: [],
              entries: [],
            }
          : {}),
      });
      return;
    }
    await json({});
  });
}

for (const canOpen of [true, false]) {
  test(`caixa sem gavetas orienta cadastro sem alegar falta de permissão (canOpen=${canOpen})`, async ({
    page,
  }) => {
    await mockCashApi(page, { registers: "empty", canOpen });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/#/cash");
    await expect(page.getByText("Cadastre uma gaveta para começar", { exact: true })).toBeVisible();
    await expect(page.getByText(/Abra "Gavetas" no topo/)).toBeVisible();
    await expect(page.getByText(/permissão para abrir turnos nesta gaveta/)).toHaveCount(0);
    await expect(page.getByText(/Defina o fundo de troco/)).toHaveCount(0);
    await expect(page.getByText("Disponível para Abertura", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir turno", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Gavetas", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Gavetas da unidade" })).toBeVisible();
    await expect(page.getByText("Nenhuma gaveta cadastrada", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Adicionar gaveta" }).click();
    await expect(page.getByLabel("Nome da gaveta")).toBeVisible();
  });
}

test("caixa distingue gaveta inativa de falta de permissão para abrir turno", async ({ page }) => {
  await mockCashApi(page, { registers: "inactive", canOpen: true });
  await page.goto("/#/cash");
  await expect(
    page.getByText("Esta gaveta está inativa. Selecione uma gaveta ativa para abrir o turno."),
  ).toBeVisible();
  await expect(page.getByText(/permissão para abrir turnos nesta gaveta/)).toHaveCount(0);
  await expect(page.getByText("Disponível para Abertura", { exact: true })).toHaveCount(0);
});

test("caixa mantém aviso de permissão quando uma gaveta existe e o perfil não pode abrir", async ({
  page,
}) => {
  await mockCashApi(page, { registers: "closed", canOpen: false });
  await page.goto("/#/cash");
  await expect(page.getByRole("heading", { name: "Abrir caixa — Caixa principal" })).toBeVisible();
  await expect(page.getByText(/permissão para abrir turnos nesta gaveta/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir turno", exact: true })).toHaveCount(0);
});

test("caixa separa turno, extrato, histórico e configurações por tarefa", async ({ page }) => {
  await mockCashApi(page);
  await page.goto("/#/cash");

  const turn = page.getByRole("button", { name: "Turno", exact: true });
  const ledger = page.getByRole("button", { name: "Extrato", exact: true });
  const history = page.getByRole("button", { name: /Histórico/ });
  const settings = page.getByRole("button", { name: "Configurações", exact: true });
  const registerPicker = page.getByRole("combobox", { name: "Gaveta em uso" });

  await expect(turn).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Fechar caixa" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Extrato do caixa" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Histórico de turnos" })).toHaveCount(0);

  await ledger.click();
  await expect(ledger).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Extrato do caixa" })).toBeVisible();
  await expect(page.locator(".cash-entry").filter({ hasText: "Venda do salão" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toBeHidden();

  await registerPicker.selectOption(barRegisterId);
  await expect(registerPicker).toHaveValue(barRegisterId);
  await expect(ledger).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".cash-entry").filter({ hasText: "Troco do bar" })).toBeVisible();
  await expect(page.locator(".cash-entry").filter({ hasText: "Venda do salão" })).toHaveCount(0);

  await turn.click();
  await expect(registerPicker).toHaveValue(barRegisterId);
  await expect(page.getByRole("heading", { name: "Bar" })).toBeVisible();
  await registerPicker.selectOption(mainRegisterId);
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
  await expect(page.getByRole("dialog", { name: "Fechar caixa" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fechar caixa" }).click();
  await expect(page.getByRole("dialog", { name: "Fechar caixa" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Fechar caixa" })).toBeFocused();
  await page.getByText("Transferir responsabilidade", { exact: true }).click();
  await expect(page.getByText("Nenhum outro operador está disponível")).toBeVisible();
  await expect(page.getByLabel("Novo responsável")).toHaveCount(0);
});

for (const width of [375, 1440]) {
  test(`caixa abre ações em uma única janela e preserva a contagem (${width}px)`, async ({
    page,
  }) => {
    await mockCashApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/cash");
    await expect(page.getByRole("heading", { name: "Contas e caixa", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Gaveta em uso" })).toBeVisible();
    await expect(page.locator(".cash-register-grid")).toBeHidden();

    for (const [action, title] of [
      ["Sangria", "Sangria"],
      ["Suprimento", "Suprimento"],
      ["Transferir", "Transferir entre gavetas"],
    ]) {
      const trigger = page.getByRole("button", { name: action, exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(trigger).toBeFocused();
    }

    await page.getByRole("button", { name: "Fechar caixa", exact: true }).click();
    const closing = page.getByRole("dialog", { name: "Fechar caixa", exact: true });
    await closing.getByLabel("Dinheiro contado", { exact: true }).fill("150,00");
    await closing.getByRole("button", { name: "Revisar contagem" }).click();
    await expect(closing.getByRole("button", { name: "Confirmar fechamento" })).toBeVisible();
    await closing.getByRole("button", { name: "Corrigir valores" }).click();
    await expect(closing.getByLabel("Dinheiro contado", { exact: true })).toHaveValue("150,00");
    await closing.getByRole("button", { name: "Contar cédulas e moedas" }).click();
    await closing.getByRole("spinbutton", { name: "Cédula R$ 100", exact: false }).fill("2");
    await expect(closing.locator(".cash-denomination-total-bar")).toContainText("200,00");
    await closing.getByRole("button", { name: "Zerar contagem" }).click();
    await expect(closing.locator(".cash-denomination-total-bar")).toContainText("0,00");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Fechar caixa", exact: true })).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("erro de movimento permanece no modal com os campos preenchidos e valores em centavos", async ({
  page,
}) => {
  await mockCashApi(page);
  let payload: unknown;
  await page.route("**/cash-shifts/*/movements", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 409, json: { message: "Movimento recusado para conferência." } });
  });
  await page.goto("/#/cash");
  await page.getByRole("button", { name: "Suprimento", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Suprimento", exact: true });
  await dialog.getByLabel("Valor (R$)", { exact: true }).fill("12,50");
  await dialog.getByLabel("Motivo", { exact: true }).fill("Reforço de troco");
  await dialog.getByRole("button", { name: "Registrar suprimento" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Valor (R$)", { exact: true })).toHaveValue("12,50");
  await expect(dialog.getByLabel("Motivo", { exact: true })).toHaveValue("Reforço de troco");
  expect(payload).toEqual({ type: "supply", amountCents: 1250, reason: "Reforço de troco" });
});

test("detalhes e comprovante do histórico compartilham a mesma janela", async ({ page }) => {
  await mockCashApi(page);
  await page.route(`**/cash-shifts/${reviewShiftId}/detail`, (route) =>
    route.fulfill({
      json: {
        shift: reviewedShift,
        entries: [],
        adjustments: [],
        tenderCounts: [],
        responsibilities: [],
      },
    }),
  );
  await page.goto("/#/cash");
  await page.getByRole("button", { name: /Histórico/ }).click();
  await page.getByRole("button", { name: "Detalhes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Turno · Caixa principal" })).toBeVisible();
  await page.getByRole("button", { name: "Reimprimir comprovante" }).click();
  await expect(
    page.getByRole("dialog", { name: "Comprovante de fechamento", exact: true }),
  ).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await page.getByRole("button", { name: "Voltar ao turno" }).click();
  await expect(page.getByRole("dialog", { name: "Turno · Caixa principal" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Detalhes", exact: true })).toBeFocused();
});

test("resultado do fechamento não acompanha a troca de gaveta", async ({ page }) => {
  await mockCashApi(page);
  await page.route(`**/cash-shifts/${mainShiftId}/close`, (route) =>
    route.fulfill({
      status: 201,
      json: {
        ...reviewedShift,
        cashShiftId: mainShiftId,
        countedCents: 15_000,
        differenceCents: 0,
        differenceSeverity: "none",
        reviewRequired: false,
        breakdown: [],
        tenderBreakdown: [],
      },
    }),
  );
  await page.goto("/#/cash");
  await page.getByRole("button", { name: "Fechar caixa", exact: true }).click();
  const closing = page.getByRole("dialog", { name: "Fechar caixa", exact: true });
  await closing.getByLabel("Dinheiro contado", { exact: true }).fill("150,00");
  await closing.getByRole("button", { name: "Revisar contagem" }).click();
  await closing.getByRole("button", { name: "Confirmar fechamento" }).click();
  await expect(page.getByRole("heading", { name: "Resultado da conferência" })).toBeVisible();
  await page.getByRole("combobox", { name: "Gaveta em uso" }).selectOption(barRegisterId);
  await expect(page.getByRole("heading", { name: "Resultado da conferência" })).toHaveCount(0);
  await expect(page.getByText("Fechamento concluído", { exact: true })).toHaveCount(0);
});

test("responsável pelo turno recebe orientação sem ação de autorevisão", async ({ page }) => {
  await mockCashApi(page);
  await page.goto("/#/cash");
  await page.getByRole("button", { name: /Histórico/ }).click();
  await page.locator(".cash-review summary").click();
  await expect(page.getByText(/Outro gestor deve revisar este turno/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir revisão" })).toHaveCount(0);
});

test("rejeição de duplo controle orienta outro gestor e impede repetir a revisão", async ({
  page,
}) => {
  await mockCashApi(page, { reviewResponsibleIdentityId: "other-operator" });
  await page.route(`**/cash-shifts/${reviewShiftId}/review`, (route) =>
    route.fulfill({
      status: 403,
      json: {
        code: "CASH_SHIFT_REVIEW_DUAL_CONTROL_REQUIRED",
        message: "A revisão deve ser feita por outro gestor.",
      },
    }),
  );
  await page.goto("/#/cash");
  await page.getByRole("button", { name: /Histórico/ }).click();
  await page.locator(".cash-review summary").click();
  await page.getByLabel("Justificativa da revisão").fill("Conferência do turno");
  await page.getByRole("button", { name: "Concluir revisão" }).click();
  await expect(page.getByText(/Outro gestor deve revisar este turno/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Concluir revisão" })).toHaveCount(0);
  await expect(page.getByText(/Seu perfil não possui permissão/)).toHaveCount(0);
});
