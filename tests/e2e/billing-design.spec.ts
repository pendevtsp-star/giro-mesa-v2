import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";

const activeSummary = {
  state: "active",
  access: "full",
  onboarding: null,
  current: {
    source: "subscription",
    plan: {
      id: "plan-essential",
      slug: "essential",
      name: "Essencial",
      includedUnits: 1,
      entitlements: ["atendimento", "financeiro"],
    },
    cycle: "monthly",
    priceCents: 19_900,
    periodStartsAt: "2026-08-01T03:00:00.000Z",
    periodEndsAt: "2026-09-01T03:00:00.000Z",
    renewsAutomatically: true,
    paymentMethod: "credit_card",
  },
  charges: [
    {
      id: "charge-paid",
      amountCents: 19_900,
      status: "paid",
      dueAt: "2026-08-01T03:00:00.000Z",
      paidAt: "2026-08-01T12:00:00.000Z",
      paymentUrl: null,
    },
    {
      id: "charge-next",
      amountCents: 19_900,
      status: "pending",
      dueAt: "2026-09-01T03:00:00.000Z",
      paidAt: null,
      paymentUrl: null,
    },
  ],
  plans: [
    {
      id: "plan-essential",
      slug: "essential",
      name: "Essencial",
      includedUnits: 1,
      entitlements: ["atendimento", "financeiro"],
      monthlyPriceCents: 19_900,
      annualPriceCents: 199_000,
      current: true,
      upgradeEligible: false,
    },
    {
      id: "plan-pro",
      slug: "pro",
      name: "Profissional",
      includedUnits: 3,
      entitlements: ["atendimento", "financeiro", "multiunit"],
      monthlyPriceCents: 29_900,
      annualPriceCents: 299_000,
      current: false,
      upgradeEligible: true,
    },
  ],
  actions: {
    onlinePaymentsEnabled: false,
    canSubscribe: false,
    canRegularize: false,
    canUpgrade: true,
    unavailableReason: "Pagamento online ainda não habilitado.",
  },
  missingSections: [],
};

async function mockSession(
  page: Page,
  role: "owner" | "manager",
  billingSummary: typeof activeSummary = activeSummary,
) {
  await mockCompatibleApi(page);
  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
      if (!localStorage.getItem("giromesa-theme")) localStorage.setItem("giromesa-theme", "light");
    },
    { identityId, organizationId, unitId },
  );

  let billingRequests = 0;
  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session") && request.method() === "GET")
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: {
          id: identityId,
          email: role === "owner" ? "dono@giromesa.test" : "gerente@giromesa.test",
          displayName: role === "owner" ? "Proprietário" : "Gerente",
        },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role,
            unitId: role === "owner" ? null : unitId,
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
            tradeName: "Casa Giro",
            document: "05953016000132",
          },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          roles: [{ role, unitId: role === "owner" ? null : unitId }],
        },
      ]);
    if (path.endsWith(`/organizations/${organizationId}/billing/summary`)) {
      billingRequests += 1;
      return json(billingSummary);
    }
    return json({});
  });
  return () => billingRequests;
}

test("assinatura ativa expõe plano, renovação e cobranças sem overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre 1440 px e 375 px.");
  await mockSession(page, "owner");

  for (const [width, theme] of [
    [1440, "light"],
    [375, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    if (page.url().startsWith("http")) {
      await page.evaluate((nextTheme) => localStorage.setItem("giromesa-theme", nextTheme), theme);
      await page.reload();
    } else {
      await page.goto("http://127.0.0.1:3112/#/billing");
    }

    await expect(
      page.getByRole("heading", { name: "Assinatura e cobrança", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Assinatura ativa", { exact: true })).toBeVisible();
    await expect(page.getByText("Renovação automática", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Essencial", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profissional", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cobranças recentes" })).toBeVisible();
    await expect(page.getByText("Paga", { exact: true })).toBeVisible();
    await expect(page.getByText("Pendente", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fazer upgrade" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fazer upgrade" })).toBeDisabled();
    await expect(
      page.getByText("Pagamento online ainda não habilitado.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: /Abrir menu do perfil/ }).click();
  await expect(page.getByRole("button", { name: /Assinatura e cobrança/ })).toBeVisible();
});

test("ativação informa as pendências reais e direciona para a próxima etapa", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre a apresentação responsiva.");
  await mockSession(page, "owner", {
    ...activeSummary,
    state: "onboarding",
    access: "none",
    onboarding: { missingItems: ["catalog", "cashier", "training"] },
    current: null,
    charges: [],
  });

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("http://127.0.0.1:3112/#/billing");

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "3 etapas pendentes para liberar o período de teste." }),
  ).toBeVisible();
  await expect(page.getByText("Cardápio pronto para operar", { exact: true })).toBeVisible();
  await expect(page.getByText("Caixa e formas de recebimento", { exact: true })).toBeVisible();
  await expect(page.getByText("Treinamento da equipe", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continuar configuração" })).toHaveAttribute(
    "href",
    "#/catalog",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("gerente não acessa a rota nem os atalhos de assinatura", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A autorização independe do viewport.");
  const billingRequests = await mockSession(page, "manager");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:3112/#/billing");

  await expect(page.getByRole("heading", { name: "Visão geral", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Assinatura e cobrança", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Assinatura e cobrança", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /Abrir menu do perfil/ }).click();
  await expect(page.getByRole("button", { name: /Assinatura e cobrança/ })).toHaveCount(0);
  expect(billingRequests()).toBe(0);
});
