import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-dashboard";
const unitId = "unit-dashboard";

const profiles = [
  { role: "owner", profileId: "owner", route: "finance", roleLabel: "Proprietária" },
  { role: "manager", profileId: "manager", route: "salon", roleLabel: "Gerente" },
  { role: "waiter", profileId: "waiter", route: "salon", roleLabel: "Garçom" },
  { role: "cashier", profileId: "cashier", route: "cash", roleLabel: "Caixa" },
  { role: "kds", profileId: "kitchen", route: "kds", roleLabel: "Cozinha / KDS" },
  { role: "inventory", profileId: "inventory", route: "inventory", roleLabel: "Estoque e compras" },
  { role: "finance", profileId: "finance", route: "finance", roleLabel: "Financeiro" },
  { role: "delivery", profileId: "delivery", route: "delivery", roleLabel: "Delivery" },
] as const;

async function mockDashboardApi(page: Page, profile: (typeof profiles)[number]) {
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const payload =
      pathname === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-dashboard",
              email: `${profile.role}@giromesa.test`,
              displayName: `Usuário ${profile.roleLabel}`,
            },
            memberships: [
              { membershipId: "membership-dashboard", organizationId, status: "active" },
            ],
            platformAdmin: false,
          }
        : pathname === "/v1/organizations"
          ? [
              {
                membershipId: "membership-dashboard",
                organization: {
                  id: organizationId,
                  tradeName: "GiroMesa Dashboard",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Unidade Centro",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: profile.role, unitId }],
              },
            ]
          : pathname.endsWith("/management/overview")
            ? {
                profileId: profile.profileId,
                generatedAt: "2026-08-16T22:30:00.000Z",
                activeShift: ["inventory", "finance"].includes(profile.profileId)
                  ? null
                  : { label: "Turno da noite", startsAt: "2026-08-16T21:00:00.000Z" },
                unavailableSources: [],
                sources: [
                  { id: "operations", status: "fresh", checkedAt: "2026-08-16T22:30:00.000Z" },
                ],
                activity: [
                  {
                    id: "activity-1",
                    label: "Pedido atualizado",
                    detail: "Mesa 4",
                    occurredAt: "2026-08-16T22:20:00.000Z",
                    route: profile.route,
                  },
                ],
                multiunit:
                  profile.profileId === "owner"
                    ? [
                        {
                          unitId,
                          name: "Unidade Centro",
                          salesCents: 120000,
                          marginCents: 48000,
                          alerts: 1,
                          tone: "warning",
                        },
                      ]
                    : [],
                preferences: {
                  alertsEnabled: true,
                  minimumTone: "warning",
                  digestMinutes: 15,
                  thresholds: {
                    kdsDelayMinutes: 15,
                    stockCoverageDays: 3,
                    deliveryRiskMinutes: 15,
                    salesGoalCents: 100000,
                    maxKdsDelayed: 2,
                    maxStockouts: 0,
                    maxDeliveryDelayed: 0,
                    maxReconciliations: 0,
                  },
                },
                lastVisitedAt: "2026-08-16T22:00:00.000Z",
                partialSource: null,
                metrics: [1, 2, 3, 4].map((index) => ({
                  id: `metric-${index}`,
                  label: `Indicador ${index}`,
                  value: String(index),
                  detail: `Detalhe ${index}`,
                  tone: index === 1 ? "warning" : "neutral",
                  route: profile.route,
                  source: "operations",
                  comparison: { label: "vs. período anterior", value: "+10%", tone: "success" },
                  goal: { label: "Dentro da meta", tone: "success" },
                })),
                priorities: [
                  {
                    id: "later",
                    title: "Prioridade informativa",
                    detail: "Pode aguardar",
                    tone: "info",
                    route: profile.route,
                    actionLabel: "Consultar",
                    source: "operations",
                    occurrenceKey: "a".repeat(64),
                    status: "open",
                    assignedTo: null,
                  },
                  {
                    id: "urgent",
                    title: "Prioridade urgente",
                    detail: "Exige ação agora",
                    tone: "danger",
                    route: profile.route,
                    actionLabel: "Resolver",
                    source: "operations",
                    occurrenceKey: "b".repeat(64),
                    status: "open",
                    assignedTo: null,
                  },
                ],
                pulse: [
                  {
                    id: "pulse",
                    label: "Atividade",
                    value: "2",
                    route: profile.route,
                    source: "operations",
                  },
                ],
                quickActions: [{ id: "quick", label: "Abrir módulo", route: profile.route }],
              }
            : null;

    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${pathname}` } }
        : { json: payload },
    );
  });
}

test("admin da plataforma enxerga saúde de tenants, jobs e ativações", async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const payload =
      pathname === "/v1/auth/me"
        ? {
            identity: { id: "platform-admin", email: "admin@giromesa.test", displayName: "Admin" },
            memberships: [],
            platformAdmin: true,
          }
        : pathname === "/v1/organizations"
          ? []
          : pathname === "/v1/platform/overview"
            ? {
                counts: { organizations: 12, units: 19, activeTrials: 4 },
                health: { pendingJobs: 5, failedJobs: 1, staleHubs: 2, failedIntegrations: 1 },
                trialFunnel: { applications: 10, activations: 4, conversionPercent: 40 },
                recentTrialApplications: [],
                recentContacts: [],
                recentOrganizations: [
                  {
                    id: "org-risk",
                    name: "Restaurante em atenção",
                    billingState: "active",
                    createdAt: "2026-08-16T22:30:00.000Z",
                    unitCount: 2,
                    staleHubs: 1,
                    failedIntegrations: 1,
                    issues: 2,
                    tone: "danger",
                  },
                ],
              }
            : null;
    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${pathname}` } }
        : { json: payload },
    );
  });

  await page.goto("/#/platform");
  await expect(page.getByRole("heading", { level: 1, name: "Plataforma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Integrações e processamento" })).toBeVisible();
  await expect(page.getByText("40%")).toBeVisible();
  await expect(page.getByText("Restaurante em atenção")).toBeVisible();
  await expect(page.getByText("2 alerta(s)")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("prioridades e preferências usam mutações auditáveis", async ({ page }) => {
  await mockDashboardApi(page, profiles[1]);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.locator(".dashboard-priority").first()).toContainText("Prioridade urgente");

  const claimRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/priorities/urgent/actions"),
  );
  await page
    .locator(".dashboard-priority")
    .first()
    .getByRole("button", { name: "Assumir" })
    .click();
  const claim = await claimRequest;
  expect(claim.postDataJSON()).toMatchObject({ action: "claim", occurrenceKey: "b".repeat(64) });
  expect(claim.headers()["idempotency-key"]).toBeTruthy();

  await page.getByText("Configurar metas e alertas").click();
  const preferencesRequest = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/management/overview/preferences"),
  );
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  const preferences = await preferencesRequest;
  expect(preferences.postDataJSON()).toMatchObject({ alertsEnabled: true, digestMinutes: 15 });
  expect(preferences.headers()["idempotency-key"]).toBeTruthy();
  await expect(page.getByRole("status").filter({ hasText: "Preferências salvas." })).toBeVisible();
});

for (const profile of profiles) {
  test(`visão geral real orienta o perfil ${profile.profileId}`, async ({ page }) => {
    await mockDashboardApi(page, profile);
    await page.goto("/#/dashboard");
    await page.getByRole("button", { name: "Abrir operação" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Visão geral" })).toBeVisible();
    await expect(
      page.locator(".dashboard-context").getByText(profile.roleLabel, { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".dashboard-metric")).toHaveCount(4);
    await expect(page.locator(".dashboard-priority strong").first()).toHaveText(
      "Prioridade urgente",
    );
    await expect(page.locator(`a[href="#/${profile.route}"]`).first()).toBeVisible();

    if (profile.profileId === "owner") {
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".sync-pill__text")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.locator(".mobile-bottom-nav :is(a, button)")).toHaveCount(
      ["kitchen", "inventory", "waiter", "cashier"].includes(profile.profileId) ? 3 : 4,
    );
  });
}

test("visão geral diferencia dados parciais de operação sem pendências", async ({ page }) => {
  const profile = profiles[1];
  await mockDashboardApi(page, profile);
  await page.route("**/management/overview", (route) =>
    route.fulfill({
      json: {
        profileId: "manager",
        generatedAt: "2026-08-16T22:30:00.000Z",
        activeShift: null,
        unavailableSources: ["operations"],
        sources: [
          { id: "operations", status: "unavailable", checkedAt: "2026-08-16T22:30:00.000Z" },
        ],
        activity: [],
        multiunit: [],
        preferences: {
          alertsEnabled: true,
          minimumTone: "warning",
          digestMinutes: 15,
          thresholds: {
            kdsDelayMinutes: 15,
            stockCoverageDays: 3,
            deliveryRiskMinutes: 15,
            salesGoalCents: 100000,
            maxKdsDelayed: 2,
            maxStockouts: 0,
            maxDeliveryDelayed: 0,
            maxReconciliations: 0,
          },
        },
        lastVisitedAt: null,
        partialSource: null,
        metrics: [],
        priorities: [],
        pulse: [],
        quickActions: [],
      },
    }),
  );
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByText("Dados parcialmente atualizados")).toBeVisible();
  await expect(page.getByText("Sem prioridades confirmadas")).toBeVisible();
  await expect(page.getByText("Tudo em dia")).toHaveCount(0);
  const retry = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/management/overview") &&
      url.searchParams.get("source") === "operations"
    );
  });
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await retry;
});
