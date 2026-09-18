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

async function mockDashboardApi(page: Page, profile: (typeof profiles)[number], extended = false) {
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "dashboard-e2e",
        schemaVersion: 84,
        database: "up",
        integrations: {},
        capabilities: [
          "table_qr_lifecycle_v1",
          "table_qr_metrics_v1",
          "table_qr_presence_code_v1",
          "ops_background_notifications_v1",
          "table_qr_brand_upload_v1",
          "ops_web_push_v1",
          "public_menu_cover_image_v1",
          "platform_backoffice_v1",
          "platform_commercial_site_v1",
          "edge_hub_pairing_v1",
        ],
      },
    }),
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (pathname === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
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
                  {
                    id: "operationalShift",
                    status: "fresh",
                    checkedAt: "2026-08-16T22:30:00.000Z",
                  },
                  { id: "cash", status: "fresh", checkedAt: "2026-08-16T22:29:00.000Z" },
                ],
                activity: [
                  ...[
                    ["Pedido pronto para servir", "Mesa 4", "2026-08-16T22:28:00.000Z"],
                    ["Comanda atualizada", "Mesa 12", "2026-08-16T22:24:00.000Z"],
                    ["Estoque crítico identificado", "Cerveja pilsen", "2026-08-16T22:19:00.000Z"],
                    ["Entrega saiu para rota", "Pedido #842", "2026-08-16T22:14:00.000Z"],
                    ["Reserva confirmada", "Grupo de 6 pessoas", "2026-08-16T22:08:00.000Z"],
                    [
                      "Fechamento parcial registrado",
                      "Caixa principal",
                      "2026-08-16T22:03:00.000Z",
                    ],
                  ].map(([label, detail, occurredAt], index) => ({
                    id: `activity-${index + 1}`,
                    label,
                    detail,
                    occurredAt,
                    route: profile.route,
                  })),
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
                        {
                          unitId: "unit-norte",
                          name: "Unidade Norte",
                          salesCents: 98000,
                          marginCents: 39200,
                          alerts: 0,
                          tone: "success",
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
                metrics: [
                  [
                    "pending-approvals",
                    "Aprovações pendentes",
                    "2",
                    "Aguardando decisão",
                    "warning",
                  ],
                  ["occupancy", "Ocupação", "80%", "8 de 10 mesa(s)", "info"],
                  ["open-tabs", "Comandas abertas", "3", "R$ 80,00", "neutral"],
                  ["late-kds", "Pedidos atrasados", "1", "Acima de 15 minutos", "danger"],
                ].map(([id, label, value, detail, tone]) => ({
                  id,
                  label,
                  value,
                  detail,
                  tone,
                  route:
                    profile.profileId === "manager"
                      ? ({
                          "pending-approvals": "counter",
                          occupancy: "salon",
                          "open-tabs": "counter",
                          "late-kds": "kds",
                        }[id] ?? profile.route)
                      : profile.route,
                  source: "operations",
                  comparison: { label: "vs. período anterior", value: "+10%", tone: "success" },
                  goal: { label: "Dentro da meta", tone: "success" },
                })),
                priorities: [
                  ...(extended
                    ? Array.from({ length: 6 }, (_, index) => ({
                        id: `extra-${index}`,
                        title: `Pendência adicional ${index + 1}`,
                        detail: "Conferir no módulo responsável",
                        tone: "warning",
                        route: profile.route,
                        actionLabel: "Conferir",
                        source: "operations",
                        occurrenceKey: String(index).repeat(64),
                        status: index < 3 ? "claimed" : "open",
                        assignedTo:
                          index < 3
                            ? {
                                id: index === 1 ? "other-person" : "identity-dashboard",
                                name: index === 1 ? "Outra pessoa" : "Usuário Gerente",
                                isMe: index !== 1,
                              }
                            : null,
                      }))
                    : []),
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
                    id: "open-tabs",
                    label: "Comandas abertas",
                    value: "3",
                    route: "counter",
                    source: "operations",
                  },
                  {
                    id: "kds-preparing",
                    label: "Em preparo",
                    value: "3",
                    route: "kds",
                    source: "operations",
                  },
                  {
                    id: "kds-ready",
                    label: "Prontos para servir",
                    value: "1",
                    route: "kds",
                    source: "operations",
                  },
                  {
                    id: "received",
                    label: "Recebido no turno",
                    value: "R$ 100,00",
                    route: "cash",
                    source: "operations",
                  },
                  {
                    id: "active-team",
                    label: "Equipe ativa",
                    value: "6",
                    route: "people",
                    source: "operations",
                  },
                ],
                quickActions: ["owner", "manager"].includes(profile.profileId)
                  ? [
                      { id: "new-tab", label: "Abrir comanda", route: "counter" },
                      { id: "salon", label: "Mesas", route: "salon" },
                      { id: "kds", label: "Produção", route: "kds" },
                      { id: "cash", label: "Caixa", route: "cash" },
                      ...(profile.profileId === "owner"
                        ? [
                            { id: "reports", label: "Relatórios", route: "reports" },
                            { id: "finance", label: "Financeiro", route: "finance" },
                          ]
                        : [{ id: "people", label: "Equipe", route: "people" }]),
                    ]
                  : [{ id: "quick-orders", label: "Acompanhar pedidos", route: profile.route }],
              }
            : null;

    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${pathname}` } }
        : { json: payload },
    );
  });
}

test("back office cadastra e pesquisa tenant, trata incidentes e explicita dados parciais", async ({
  page,
}) => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const eventId = "22222222-2222-4222-8222-222222222222";
  let failOverview = false;
  let tenantCreateAttempts = 0;
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "platform-e2e",
        schemaVersion: 84,
        capabilities: [
          "table_qr_lifecycle_v1",
          "table_qr_metrics_v1",
          "table_qr_presence_code_v1",
          "ops_background_notifications_v1",
          "table_qr_brand_upload_v1",
          "ops_web_push_v1",
          "public_menu_cover_image_v1",
          "platform_backoffice_v1",
          "platform_commercial_site_v1",
          "edge_hub_pairing_v1",
        ],
        database: "up",
        integrations: {},
      },
    }),
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
      return;
    }
    if (pathname === "/v1/platform/overview" && failOverview) {
      await route.fulfill({ status: 503, json: { message: "Fonte temporariamente indisponível" } });
      return;
    }
    if (request.method() !== "GET") {
      if (pathname === "/v1/platform/tenants") {
        tenantCreateAttempts += 1;
        if (tenantCreateAttempts === 1) {
          await route.fulfill({
            status: 503,
            json: { message: "Resposta perdida; tente novamente." },
          });
          return;
        }
        await route.fulfill({
          status: 201,
          json: {
            organization: { id: tenantId, tradeName: "Casa Centro", billingState: "onboarding" },
            unit: { id: "unit-1", name: "Matriz" },
            owner: { identityId: "owner-1", email: "owner@casacentro.test" },
            replayed: false,
          },
        });
        return;
      }
      if (pathname.endsWith("/pii-access")) {
        await route.fulfill({
          json: {
            organization: { document: "05953016000132" },
            legalEntities: [],
            members: [{ email: "owner@casacentro.test" }],
          },
        });
        return;
      }
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const incident = {
      fingerprint: `outbox:${eventId}:3`,
      source: "outbox",
      sourceId: eventId,
      organizationId: tenantId,
      organizationName: "Casa Centro",
      unitId: null,
      unitName: null,
      severity: "critical",
      title: "Falha em job assíncrono",
      detail: { topic: "billing.sync", attempts: 3, errorCode: "PROVIDER_TIMEOUT" },
      occurredAt: "2026-08-25T14:00:00.000Z",
      state: "open",
      claimedByIdentityId: null,
      claimedAt: null,
      snoozedUntil: null,
      resolvedAt: null,
      reason: null,
      ageMinutes: 30,
      impact: "billing",
      criterion: "tópico billing.sync",
    };
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
                generatedAt: "2026-08-25T14:30:00.000Z",
                sources: [
                  { key: "overview", status: "ok", checkedAt: "2026-08-25T14:30:00.000Z" },
                  {
                    key: "metrics",
                    status: "unavailable",
                    checkedAt: "2026-08-25T14:30:00.000Z",
                    error: "UNAVAILABLE",
                  },
                ],
                access: {
                  role: "admin",
                  capabilities: [
                    "tenants:read",
                    "tenants:write",
                    "billing:read",
                    "fiscal:read",
                    "incidents:write",
                    "outbox:retry",
                    "pii:read",
                  ],
                  mfaEnforced: true,
                },
                recentTrialApplications: [],
                recentContacts: [],
                fiscalIntegrations: [],
                recentOrganizations: [],
              }
            : pathname === "/v1/platform/tenants"
              ? {
                  items: [
                    {
                      id: tenantId,
                      name: "Casa Centro",
                      legalName: "Casa Centro Alimentos Ltda.",
                      document: "**********0132",
                      billingState: "active",
                      billingStateChangedAt: "2026-08-01T12:00:00.000Z",
                      unitCount: 2,
                      createdAt: "2026-07-01T12:00:00.000Z",
                      updatedAt: "2026-08-25T14:00:00.000Z",
                    },
                  ],
                  nextCursor: null,
                  total: 1,
                  page: 1,
                  limit: 20,
                  pages: 1,
                }
              : pathname === `/v1/platform/tenants/${tenantId}`
                ? {
                    organization: {
                      id: tenantId,
                      tradeName: "Casa Centro",
                      legalName: "Casa Centro Alimentos Ltda.",
                      document: "**********0132",
                      billingState: "active",
                      billingStateChangedAt: "2026-08-01T12:00:00.000Z",
                      createdAt: "2026-07-01T12:00:00.000Z",
                    },
                    units: [
                      { id: "unit-1", name: "Centro", active: true },
                      { id: "unit-2", name: "Norte", active: true },
                    ],
                    onboarding: {
                      activatedAt: null,
                      missingItems: ["Configurar fiscal"],
                      updatedAt: "2026-08-25T13:00:00.000Z",
                    },
                    billing: {
                      subscriptions: [
                        { state: "active", provider: "asaas", plan: { slug: "pro" } },
                      ],
                      charges: [],
                    },
                    hubs: [
                      {
                        hubId: "hub-1",
                        unitName: "Centro",
                        stale: false,
                        version: "2.4.0",
                        lastSeenAt: "2026-08-25T14:29:00.000Z",
                      },
                    ],
                    fiscal: [],
                    incidents: [incident],
                    timeline: [
                      {
                        id: "audit-1",
                        action: "platform.tenant.created",
                        entityType: "organization",
                        entityId: tenantId,
                        metadata: {},
                        occurredAt: "2026-07-01T12:00:00.000Z",
                        actor: "Equipe GiroMesa",
                        actorEmail: "e***@giromesa.test",
                      },
                    ],
                  }
                : pathname === "/v1/platform/incidents"
                  ? { items: [incident], nextCursor: null, generatedAt: "2026-08-25T14:30:00.000Z" }
                  : null;
    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${pathname}` } }
        : { json: payload },
    );
  });

  await page.goto("/#/platform");
  await expect(page.getByRole("heading", { level: 1, name: "Central de controle" })).toBeVisible();
  await expect(page.getByText("MFA obrigatório")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Dados parciais" })).toContainText(
    "metrics",
  );

  const firstTenantCreateRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/v1/platform/tenants",
  );
  await page.getByRole("button", { name: "Cadastrar cliente piloto" }).click();
  const tenantDialog = page.getByRole("dialog", { name: "Cliente piloto" });
  await tenantDialog.getByLabel("Razão social").fill("Casa Centro Alimentos Ltda.");
  await tenantDialog.getByLabel("Nome fantasia").fill("Casa Centro");
  await tenantDialog.getByLabel("CNPJ").fill("05.953.016/0001-32");
  await tenantDialog.getByLabel("Primeira unidade").fill("Matriz");
  await tenantDialog.getByLabel("E-mail do responsável").fill("owner@casacentro.test");
  await tenantDialog.getByLabel("Motivo do cadastro").fill("Cliente aprovado para o piloto");
  await tenantDialog.getByRole("checkbox").check();
  await tenantDialog.getByRole("button", { name: "Cadastrar cliente" }).click();
  const failedTenantCreation = await firstTenantCreateRequest;
  await expect(tenantDialog.getByRole("alert")).toContainText("Tente novamente");
  const replayTenantCreateRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === "/v1/platform/tenants",
  );
  await tenantDialog.getByRole("button", { name: "Cadastrar cliente" }).click();
  const tenantCreation = await replayTenantCreateRequest;
  expect(tenantCreation.postDataJSON()).toMatchObject({
    document: "05953016000132",
    ownerEmail: "owner@casacentro.test",
    timezone: "America/Sao_Paulo",
  });
  expect(tenantCreation.headers()["idempotency-key"]).toBeTruthy();
  expect(tenantCreation.headers()["idempotency-key"]).toBe(
    failedTenantCreation.headers()["idempotency-key"],
  );
  await expect(page.getByText(/foram cadastradas/)).toBeVisible();

  const tenantSearch = page
    .getByRole("search")
    .filter({ has: page.getByLabel("Nome, CNPJ, e-mail ou ID") });
  const tenantRequest = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("search") === "Casa Centro",
  );
  await tenantSearch.getByLabel("Nome, CNPJ, e-mail ou ID").fill("Casa Centro");
  await tenantSearch.getByRole("button", { name: "Buscar" }).click();
  await tenantRequest;
  await page.getByRole("button", { name: /Casa Centro/ }).click();
  await expect(page.getByRole("heading", { name: "Cobrança do assinante" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Linha do tempo" })).toBeVisible();

  const piiRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith(`/tenants/${tenantId}/pii-access`),
  );
  await page.getByRole("button", { name: "Revelar dados" }).click();
  const piiDialog = page.getByRole("dialog", { name: "Revelar dados do tenant" });
  await piiDialog.getByLabel("Motivo do acesso").fill("Chamado interno GM-42");
  await piiDialog.getByRole("checkbox").check();
  await piiDialog.getByRole("button", { name: "Revelar dados" }).click();
  expect((await piiRequest).postDataJSON()).toEqual({ reason: "Chamado interno GM-42" });
  await expect(page.getByText("owner@casacentro.test")).toBeVisible();

  const incidentRequest = page.waitForRequest(
    (request) => request.method() === "PATCH" && request.url().includes("/platform/incidents/"),
  );
  await page.getByRole("button", { name: "Assumir" }).click();
  const incidentDialog = page.getByRole("dialog", { name: "Assumir incidente" });
  await incidentDialog.getByLabel("Motivo").fill("Investigando timeout do provedor");
  await incidentDialog.getByRole("checkbox").check();
  await incidentDialog.getByRole("button", { name: "Confirmar" }).click();
  const incidentAction = await incidentRequest;
  expect(incidentAction.postDataJSON()).toMatchObject({ action: "claim" });
  expect(incidentAction.headers()["idempotency-key"]).toBeTruthy();

  const retryRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`/outbox/${eventId}/retry`),
  );
  await page.getByRole("button", { name: "Reprocessar" }).click();
  const retryDialog = page.getByRole("dialog", { name: "Reprocessar evento" });
  await retryDialog.getByLabel("Motivo").fill("Provedor recuperado e conferido");
  await retryDialog.getByRole("checkbox").check();
  await retryDialog.getByRole("button", { name: "Confirmar" }).click();
  expect((await retryRequest).headers()["idempotency-key"]).toBeTruthy();

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  failOverview = true;
  await page.getByRole("button", { name: "Atualizar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Dados desatualizados" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("prioridades mostram a fila completa e filtram responsáveis em claro, escuro e celular", async ({
  page,
}, testInfo) => {
  await mockDashboardApi(page, profiles[1], true);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.locator(".dashboard-priority")).toHaveCount(5);
  await expect(page.getByRole("link", { name: "Preparar a unidade" })).toHaveAttribute(
    "href",
    "#/settings?section=setup",
  );
  await expect(page.getByText("8 pendências", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ver todas as 8 pendências" }).click();
  await expect(page.locator(".dashboard-priority")).toHaveCount(8);
  await expect(page.locator(".dashboard-priority").first()).toContainText("Prioridade urgente");
  const filters = page.getByRole("group", { name: "Filtrar prioridades por responsável" });
  await filters.getByRole("button", { name: "Comigo 2" }).click();
  await expect(page.locator(".dashboard-priority")).toHaveCount(2);
  await expect(filters.getByRole("button", { name: "Comigo 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await filters.getByRole("button", { name: "Sem responsável 5" }).click();
  await expect(page.locator(".dashboard-priority")).toHaveCount(5);
  await filters.getByRole("button", { name: "Todas 8" }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(filters).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .include(".dashboard-priorities")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page
        .locator(".dashboard-priorities")
        .screenshot({ path: testInfo.outputPath(`priorities-${theme}-${width}.png`) });
    }
  }
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
  const firstPriority = page.locator(".dashboard-priority").first();
  await firstPriority.locator("summary", { hasText: "Mais ações" }).click();
  await firstPriority.getByRole("button", { name: "Assumir" }).click();
  const claim = await claimRequest;
  expect(claim.postDataJSON()).toMatchObject({ action: "claim", occurrenceKey: "b".repeat(64) });
  expect(claim.headers()["idempotency-key"]).toBeTruthy();

  await page.getByText("Personalizar visão").click();
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

test("topbar mantém o relógio alinhado à virada do minuto e à retomada da aba", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-08-21T20:30:42.000Z") });
  await mockDashboardApi(page, profiles[1]);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  const clock = page.locator(".topbar-clock__time");
  await expect(clock).toHaveText("17:30");
  await page.clock.runFor(18_100);
  await expect(clock).toHaveText("17:31");

  await page.clock.setSystemTime(new Date("2026-08-21T20:45:15.000Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(clock).toHaveText("17:45");
});

test("passagem de turno preserva ciência após falha e mostra todas as pendências em 375 px", async ({
  page,
}, testInfo) => {
  await mockDashboardApi(page, profiles[0]);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const snapshot = {
    capturedAt: "2026-09-09T18:00:00.000Z",
    tabs: [{ id, number: 123 }],
    orders: [{ id, tabId: id, status: "ready" }],
    calls: [{ id, tableId: id, tabId: id }],
    prints: [{ id, tabId: id, status: "confirmation_required" }],
    cash: [{ id, cashRegisterId: id }],
  };
  let receipt: { acknowledgedAt: string; acknowledgedBy: string } | null = null;
  const keys: string[] = [];
  await page.route("**/pilot/shift-handover", (route) =>
    route.fulfill({
      json: {
        current: snapshot,
        lastHandover: {
          id,
          shiftId: id,
          closedAt: snapshot.capturedAt,
          closedBy: "Gestora anterior",
          snapshot,
          receipt,
        },
      },
    }),
  );
  await page.route("**/pilot/shift-handover/*/acknowledge", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    if (keys.length === 1)
      return route.fulfill({ status: 503, json: { message: "Resposta indisponível" } });
    receipt = { acknowledgedAt: "2026-09-09T18:10:00.000Z", acknowledgedBy: "Gestora atual" };
    await route.fulfill({ json: { ok: true } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByText("Pré-fechamento e passagem de turno", { exact: true }).click();
  await page.getByText("Conferir pendências registradas", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Comanda 123" })).toHaveAttribute(
    "href",
    `#/counter?tab=${id}`,
  );
  await expect(page.getByRole("link", { name: "Impressão aaaaaaaa a conferir" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Divergência no fechamento aaaaaaaa" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar minha ciência" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Não foi possível confirmar a ciência" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar minha ciência" }).click();
  await expect(page.getByText(/Ciência de Gestora atual/)).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe("");
  expect(keys[1]).toBe(keys[0]);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`handover-375-${theme}.png`),
      fullPage: true,
    });
  }
});

for (const profile of profiles) {
  test(`visão geral real orienta o perfil ${profile.profileId}`, async ({ page }, testInfo) => {
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
    await expect(
      page.locator(`a.dashboard-metric[href="#/${profile.route}"]`).first(),
    ).toBeVisible();
    if (profile.profileId === "owner") {
      await expect(page.locator(".dashboard-multiunit")).toBeVisible();
    } else {
      await expect(page.locator(".dashboard-multiunit")).toHaveCount(0);
    }

    if (profile.profileId === "owner") {
      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (value) => document.documentElement.setAttribute("data-theme", value),
            theme,
          );
          await page.locator(".dashboard-multiunit").screenshot({
            path: testInfo.outputPath(`dashboard-units-${theme}-${width}.png`),
            animations: "disabled",
          });
        }
      }
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.getByRole("button", { name: "Ir para módulo" })).toBeVisible();
    await expect(page.locator(".topbar-clock__time")).toBeVisible();
    await expect(page.locator(".topbar-clock__date")).toBeHidden();
    await expect(page.locator(".sync-pill__text")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const mobileActions = page.locator(".mobile-bottom-nav :is(a, button)");
    const mobileActionCount = await mobileActions.count();
    expect(mobileActionCount).toBeGreaterThanOrEqual(3);
    expect(mobileActionCount).toBeLessThanOrEqual(4);
    await expect(page.locator('.mobile-bottom-nav a[href="#/dashboard"]')).toBeVisible();
  });
}

test("visão geral compacta atalhos, fontes e atividade sem perder os gates do perfil", async ({
  page,
}, testInfo) => {
  await mockDashboardApi(page, profiles[1]);
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  const shortcuts = page.locator(".dashboard-quick-actions");
  await expect(page.getByRole("heading", { name: "Atalhos" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Movimento do turno" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atividade recente" })).toBeVisible();
  await expect(shortcuts.getByRole("link", { name: "Abrir comanda" })).toHaveAttribute(
    "href",
    "#/counter?action=new",
  );
  expect(
    await shortcuts.evaluate((element) =>
      [".dashboard-metrics", ".dashboard-priorities"].every((selector) => {
        const target = document.querySelector(selector);
        return Boolean(
          target && element.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ),
  ).toBe(true);
  await expect(page.locator(".dashboard-multiunit")).toHaveCount(0);

  const freshness = page.locator(".dashboard-freshness");
  await expect(freshness.getByRole("status")).toContainText("Dados atualizados às");
  await expect(page.locator(".dashboard-source-list")).toBeHidden();
  await freshness.locator("summary").click();
  await expect(page.locator(".dashboard-source-list")).toBeVisible();

  const activity = page.locator(".dashboard-activity__list > *");
  await expect(activity).toHaveCount(4);
  await page.getByRole("button", { name: /Ver mais/ }).click();
  await expect(activity).toHaveCount(6);

  await freshness.locator("summary").click();
  await page.getByRole("button", { name: "Ver menos" }).click();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  for (const [theme, width] of [
    ["light", 1440],
    ["dark", 1440],
    ["dark", 375],
  ] as const) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-compact-${theme}-${width}.png`),
      animations: "disabled",
    });
  }
});

test("visão geral diferencia dados parciais de operação sem pendências", async ({ page }) => {
  const profile = profiles[1];
  let holdAutomaticRefresh = false;
  let signalAutomaticRefresh = () => undefined;
  let releaseAutomaticRefresh = () => undefined;
  const automaticRefreshStarted = new Promise<void>((resolve) => {
    signalAutomaticRefresh = resolve;
  });
  const automaticRefreshReleased = new Promise<void>((resolve) => {
    releaseAutomaticRefresh = resolve;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboardApi(page, profile);
  await page.route("**/management/overview", async (route) => {
    const url = new URL(route.request().url());
    if (holdAutomaticRefresh && !url.searchParams.has("source")) {
      signalAutomaticRefresh();
      await automaticRefreshReleased;
      await route.fulfill({ status: 503, json: { message: "Falha temporária" } });
      return;
    }
    await route.fulfill({
      json: {
        profileId: "manager",
        generatedAt: "2026-08-16T22:30:00.000Z",
        activeShift: null,
        unavailableSources: ["delivery", "inventory", "multiunit", "reservations"],
        sources: [
          { id: "operations", status: "fresh", checkedAt: "2026-08-16T22:30:00.000Z" },
          { id: "delivery", status: "unavailable", checkedAt: "2026-08-16T22:30:00.000Z" },
          { id: "inventory", status: "unavailable", checkedAt: "2026-08-16T22:30:00.000Z" },
          { id: "multiunit", status: "unavailable", checkedAt: "2026-08-16T22:30:00.000Z" },
          {
            id: "reservations",
            status: "unavailable",
            checkedAt: "2026-08-16T22:30:00.000Z",
          },
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
        metrics: [
          {
            id: "sales",
            label: "Vendas no turno",
            value: "R$ 1.248,50",
            detail: "última resposta válida",
            tone: "success",
            route: "salon",
            source: "operations",
            comparison: { label: "vs. período anterior", value: "+10%", tone: "success" },
            goal: { label: "Dentro da meta", tone: "success" },
          },
        ],
        priorities: [],
        pulse: [],
        quickActions: [],
      },
    });
  });
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  const partialAlert = page.getByRole("alert").filter({ hasText: "4 áreas sem atualização" });
  await expect(partialAlert).toContainText("4 áreas sem atualização");
  expect((await partialAlert.boundingBox())?.height).toBeLessThanOrEqual(160);
  const prioritiesHeading = page.getByRole("heading", { name: "Faça agora" });
  await expect(prioritiesHeading).toBeVisible();
  expect((await prioritiesHeading.boundingBox())?.y).toBeLessThan(700);
  await expect(page.getByText("Sem prioridades confirmadas")).toBeVisible();
  await expect(page.getByText("Vendas no turno", { exact: true })).toBeVisible();
  await expect(page.getByText("Tudo em dia")).toHaveCount(0);

  const refreshAll = page.locator(".dashboard-data-status > button");
  await expect(refreshAll).toHaveCount(1);
  const refreshRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/management/overview") && !url.searchParams.has("source");
  });
  await refreshAll.click();
  await refreshRequest;

  holdAutomaticRefresh = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await automaticRefreshStarted;
  await expect(refreshAll).toBeEnabled();
  await expect(refreshAll).toHaveText("Tentar novamente");
  await expect(page.getByText("Atualizando dados", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sem prioridades confirmadas")).toBeVisible();
  releaseAutomaticRefresh();
  await expect(page.getByText("Dados desatualizados", { exact: true })).toBeVisible();
  await expect(page.getByText("Sem prioridades confirmadas")).toBeVisible();
  await expect(page.getByText("Vendas no turno", { exact: true })).toBeVisible();

  const sourceRetries = page
    .locator(".dashboard-freshness")
    .getByRole("button", { name: /^Tentar / });
  await expect(sourceRetries).toHaveCount(0);
  await page.locator(".dashboard-freshness > summary").click();
  await expect(sourceRetries).toHaveCount(4);
  const retry = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/management/overview") &&
      url.searchParams.get("source") === "inventory"
    );
  });
  await page.getByRole("button", { name: "Tentar estoque" }).click();
  await retry;

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
