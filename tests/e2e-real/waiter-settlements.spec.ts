import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApiHealth } from "./api-health-mock";

const organizationId = "00000000-0000-4000-8000-000000000001";
const unitId = "00000000-0000-4000-8000-000000000002";

const configuration = {
  attributionMode: "final_responsible",
  transferMode: "move_to_final",
  serviceBase: "net_after_discounts",
  eligibleTabs: "fully_paid",
  serviceDistribution: "individual_sales",
  serviceTeamShareBasisPoints: 10_000,
  partnershipBase: "net_excluding_service",
  tierApplication: "all_revenue",
  discountTreatment: "deduct",
  cancellationTreatment: "exclude",
  refundTreatment: "informational",
  periodMode: "calendar_month",
  customPeriodStartDay: 1,
  aggregateAcrossUnits: false,
};

const capabilities = {
  canRead: true,
  canConfigure: true,
  canRecordLoss: true,
  canReviewLoss: true,
  canGenerate: true,
  canApprove: true,
  canPay: true,
  canCancel: true,
  canExport: true,
};

function settlement(status = "preview") {
  return {
    id: status === "preview" ? null : "00000000-0000-4000-8000-000000000010",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-20",
    status,
    unassignedGrossCents: 0,
    operationalLossCents: 8_000,
    createdAt: status === "preview" ? null : "2026-08-20T15:00:00.000Z",
    lines: [
      {
        personId: "00000000-0000-4000-8000-000000000020",
        personIdentityId: "00000000-0000-4000-8000-000000000021",
        personName: "Ana Souza",
        roleLabel: "Garçom",
        eligibleForPayment: true,
        tabCount: 12,
        orderCount: 35,
        grossSalesCents: 125_000,
        discountCents: 5_000,
        canceledCents: 5_000,
        receivedCents: 132_000,
        serviceChargeCents: 12_000,
        tipCents: 0,
        serviceShareCents: 12_000,
        partnershipBaseCents: 120_000,
        partnershipCents: 2_400,
        operationalLossCents: 8_000,
        payableCents: 14_400,
      },
    ],
  };
}

async function mockApi(page: Page) {
  await mockCompatibleApiHealth(page, "waiter-settlements-e2e");
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === "GET" && path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
      return;
    }
    if (path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: { id: "identity-1", email: "finance@example.test", displayName: "Financeiro" },
          memberships: [{ membershipId: "membership-1", organizationId, status: "active" }],
          platformAdmin: false,
        },
      });
      return;
    }
    if (path === "/v1/organizations") {
      await route.fulfill({
        json: [
          {
            membershipId: "membership-1",
            organization: { id: organizationId, tradeName: "Restaurante teste", document: "1" },
            units: [{ id: unitId, name: "Matriz", timezone: "America/Sao_Paulo", active: true }],
            scopes: [{ role: "finance", unitId }],
          },
        ],
      });
      return;
    }
    if (path.endsWith("/management/waiter-settlements/settlements/preview")) {
      await route.fulfill({ json: settlement() });
      return;
    }
    if (path.endsWith("/management/waiter-settlements")) {
      await route.fulfill({
        json: {
          configuration,
          partnershipPlan: null,
          operationalShifts: [
            {
              id: "00000000-0000-4000-8000-000000000030",
              label: "Jantar",
              status: "closed",
              startsAt: "2026-08-19T18:00:00.000Z",
              closedAt: "2026-08-20T02:00:00.000Z",
            },
          ],
          operationalLosses: [],
          settlements: [settlement("closed")],
          capabilities,
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { message: `Mock ausente para ${path}` } });
  });
}

test("fechamento da equipe funciona sem overflow no celular e no desktop", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/waiter-settlements");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Fechamento da equipe" })).toBeVisible();
  await expect(page.getByText("Ana Souza").first()).toBeVisible();
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await expect(page.getByText("Prévia — ainda não registrada")).toBeVisible();
  await expect(page.getByText("R$ 144,00").first()).toBeVisible();
  await page.getByText("Ver valores detalhados", { exact: true }).first().click();
  const details = page.getByRole("region", { name: "Valores detalhados do fechamento" }).first();
  await expect(details.getByRole("row").nth(1).getByRole("cell").nth(4)).toHaveText("R$ 1.200,00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("button", { name: "Perdas" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
});

test("filtros e erro de recálculo invalidam a prévia antes de gerar fechamento", async ({
  page,
}) => {
  await mockApi(page);
  let failPreview = false;
  let created: unknown = null;
  await page.route("**/v1/**/waiter-settlements/settlements/preview", async (route) => {
    if (failPreview) {
      await route.fulfill({ status: 503, json: { message: "Falha ao recalcular a apuração" } });
      return;
    }
    const input = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...settlement(),
        periodFrom: input.from,
        periodTo: input.to,
        operationalShiftId: input.operationalShiftId ?? null,
      },
    });
  });
  await page.route("**/v1/**/waiter-settlements/settlements", async (route) => {
    created = route.request().postDataJSON();
    await route.fulfill({ json: settlement("closed") });
  });
  await page.goto("/#/waiter-settlements");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  const calculate = page.getByRole("button", { name: "Pré-visualizar" });
  const generate = page.getByRole("button", { name: "Gerar fechamento" });
  await page.getByLabel("Data inicial").fill("2026-08-01");
  await page.getByLabel("Data final").fill("2026-08-20");
  await calculate.click();
  await expect(generate).toBeEnabled();
  await page.getByLabel("Data inicial").fill("2026-08-02");
  await expect(generate).toHaveCount(0);
  await calculate.click();
  await expect(generate).toBeEnabled();
  await page.getByLabel("Data final").fill("2026-08-21");
  await expect(generate).toHaveCount(0);
  await calculate.click();
  await expect(generate).toBeEnabled();
  await page.getByLabel("Turno (opcional)").selectOption("00000000-0000-4000-8000-000000000030");
  await expect(generate).toHaveCount(0);
  await calculate.click();
  await expect(generate).toBeEnabled();
  failPreview = true;
  await calculate.click();
  await expect(
    page.getByText("O servidor não conseguiu concluir a consulta. Tente novamente em instantes."),
  ).toBeVisible();
  await expect(generate).toHaveCount(0);
  expect(created).toBeNull();
  failPreview = false;
  await calculate.click();
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByText("Fechamento gerado e registrado para conferência.")).toBeVisible();
  expect(created).toEqual({
    from: "2026-08-02",
    to: "2026-08-21",
    operationalShiftId: "00000000-0000-4000-8000-000000000030",
  });
});

test("resposta atrasada não restaura prévia de filtros abandonados", async ({ page }) => {
  await mockApi(page);
  let releaseResponse!: () => void;
  const delayedResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/v1/**/waiter-settlements/settlements/preview", async (route) => {
    await delayedResponse;
    await route.fulfill({ json: settlement() });
  });
  await page.goto("/#/waiter-settlements");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  const requestStarted = page.waitForRequest((request) =>
    request.url().endsWith("/settlements/preview"),
  );
  await page.getByRole("button", { name: "Pré-visualizar" }).click();
  await requestStarted;
  await page.getByLabel("Data inicial").fill("2026-08-01");
  releaseResponse();
  await expect(page.getByRole("button", { name: "Pré-visualizar" })).toBeEnabled();
  await expect(page.getByText("Prévia — ainda não registrada")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar fechamento" })).toHaveCount(0);
});
