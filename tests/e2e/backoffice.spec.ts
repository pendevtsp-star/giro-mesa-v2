import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const apiBase = "http://localhost:3200";
const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const actorIdentityId = "c1111111-1111-4111-8111-111111111111";
const otherIdentityId = "d1111111-1111-4111-8111-111111111111";
const now = "2026-08-11T12:00:00.000Z";

type ActionRow = {
  id: string;
  organizationId: string;
  action: "tenant.suspend" | "incident.close";
  targetType: "organization" | "incident";
  targetId: string;
  requestedByIdentityId: string;
  justification: string;
  payload: { expectedState: string; unitId?: string };
  status: "pending" | "executed";
  version: number;
  requestedAt: string;
  expiresAt: string;
  decidedByIdentityId?: string;
  decidedAt?: string;
};

async function installPlatformFixture(
  page: Page,
  options: {
    privileged: boolean;
    withExternalProposal?: boolean;
    projectionDelays?: Partial<Record<string, number>>;
    incidentStatus?: "under_review" | "approved" | "rejected";
    expectedProposal?: {
      action: "tenant.suspend" | "incident.close";
      targetId: string;
      payload: { expectedState: string; unitId?: string };
    };
  },
) {
  const permissions = options.privileged
    ? [
        "platform.read",
        "platform.action.propose",
        "platform.action.approve",
        "platform.action.reject",
        "platform.tenant.suspend",
        "platform.incident.transition",
      ]
    : ["platform.read"];
  let sequence = 1;
  let actions: ActionRow[] = options.withExternalProposal
    ? [
        {
          id: "e1111111-1111-4111-8111-111111111111",
          organizationId,
          action: "tenant.suspend",
          targetType: "organization",
          targetId: organizationId,
          requestedByIdentityId: otherIdentityId,
          justification: "Incidente confirmado pela operação e plano de reversão registrado.",
          payload: { expectedState: "active" },
          status: "pending",
          version: 1,
          requestedAt: now,
          expiresAt: "2026-08-11T12:15:00.000Z",
        },
      ]
    : [];

  await page.route(`${apiBase}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: {
            id: actorIdentityId,
            email: "admin@example.test",
            displayName: "Admin GiroMesa",
          },
          memberships: [],
          platformAdmin: true,
        },
      });
      return;
    }
    if (path === "/v1/organizations") {
      await route.fulfill({ json: [] });
      return;
    }
    if (path === "/v1/platform/overview") {
      await route.fulfill({
        json: {
          counts: { organizations: 12, active: 10, attention: 2 },
          access: {
            permissions,
            stepUp: options.privileged,
            stepUpExpiresAt: options.privileged ? "2026-08-11T12:08:00.000Z" : null,
          },
        },
      });
      return;
    }
    if (path === `/v1/platform/tenants/${organizationId}/context`) {
      await route.fulfill({
        json: {
          organization: {
            id: organizationId,
            name: "Bar Aurora",
            billingState: "active",
            updatedAt: now,
          },
          units: [
            { id: unitId, name: "Unidade Centro", active: true, timezone: "America/Sao_Paulo" },
          ],
          selectedUnitId: url.searchParams.get("unitId"),
        },
      });
      return;
    }
    if (path === "/v1/platform/resources/leads") {
      await route.fulfill({
        json: {
          resource: "leads",
          availability: "available",
          items: [
            {
              id: "f1111111-1111-4111-8111-111111111111",
              displayName: "M***",
              email: "m***@example.test",
              phone: "**********5432",
              businessName: "Bar Horizonte",
              segment: "bar",
              planSlug: "operacao",
              submittedAt: now,
              actionAvailability: "unavailable",
              actionReasonCode: "LEAD_WORKFLOW_NOT_AVAILABLE",
            },
          ],
          nextCursor: null,
        },
      });
      return;
    }
    if (path === "/v1/platform/resources/support") {
      await route.fulfill({
        json: {
          resource: "support",
          availability: "available",
          items: [
            {
              id: "f1111111-1111-4111-8111-111111111112",
              displayName: "R***",
              email: "r***@example.test",
              phone: "**********4321",
              submittedAt: now,
              actionAvailability: "unavailable",
              actionReasonCode: "SUPPORT_WORKFLOW_NOT_AVAILABLE",
            },
          ],
          nextCursor: null,
        },
      });
      return;
    }
    if (path.includes(`/v1/platform/tenants/${organizationId}/resources/`)) {
      const resource = decodeURIComponent(path.split("/").at(-1) ?? "");
      const delay = options.projectionDelays?.[resource] ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (["leads", "support"].includes(resource)) {
        await route.fulfill({
          json: {
            resource,
            availability: "unavailable",
            reasonCode: `${resource.toUpperCase()}_PROJECTION_NOT_WIRED`,
            items: [],
            nextCursor: null,
          },
        });
        return;
      }
      if (resource === "incidents") {
        const incidentStatus = options.incidentStatus ?? "under_review";
        const availableActions =
          incidentStatus === "under_review"
            ? ["incident.approve", "incident.reject"]
            : ["incident.close"];
        await route.fulfill({
          json: {
            resource,
            availability: "available",
            items: [
              {
                id: "f1111111-1111-4111-8111-111111111113",
                organizationId,
                unitId,
                incidentType: "inventory_variance",
                status: incidentStatus,
                neutralSummary: "Diferença neutra confirmada na contagem.",
                amountCents: 1290,
                reporterIdentityId: otherIdentityId,
                approverIdentityId: null,
                occurredAt: now,
                updatedAt: now,
                availableActions,
              },
            ],
            nextCursor: null,
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          resource,
          availability: "available",
          items: [
            {
              id: organizationId,
              name:
                resource === "tenant"
                  ? "Tenant lento"
                  : resource === "plan"
                    ? "Plano atual"
                    : "Bar Aurora",
              billingState: "active",
              updatedAt: now,
              units: [{ id: unitId, name: "Unidade Centro", active: true }],
            },
          ],
          nextCursor: null,
        },
      });
      return;
    }
    if (path === `/v1/platform/tenants/${organizationId}/actions` && request.method() === "GET") {
      await route.fulfill({ json: { items: actions, nextCursor: null } });
      return;
    }
    if (path === `/v1/platform/tenants/${organizationId}/actions` && request.method() === "POST") {
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      const body = request.postDataJSON() as {
        action: "tenant.suspend" | "incident.close";
        targetId: string;
        justification: string;
        payload: { expectedState: string; unitId?: string };
      };
      expect(body).toMatchObject(
        options.expectedProposal ?? {
          action: "tenant.suspend",
          targetId: organizationId,
          payload: { expectedState: "active" },
        },
      );
      const proposal: ActionRow = {
        id: `f1111111-1111-4111-8111-${String(sequence++).padStart(12, "0")}`,
        organizationId,
        action: body.action,
        targetType: body.action.startsWith("incident.") ? "incident" : "organization",
        targetId: body.targetId,
        requestedByIdentityId: actorIdentityId,
        justification: body.justification,
        payload: body.payload,
        status: "pending",
        version: 1,
        requestedAt: now,
        expiresAt: "2026-08-11T12:15:00.000Z",
      };
      actions = [proposal, ...actions];
      await route.fulfill({ status: 201, json: proposal });
      return;
    }
    if (path.endsWith("/approve") && request.method() === "POST") {
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      const proposalId = path.split("/").at(-2);
      actions = actions.map((item) =>
        item.id === proposalId
          ? {
              ...item,
              status: "executed",
              version: 3,
              decidedByIdentityId: actorIdentityId,
              decidedAt: now,
            }
          : item,
      );
      await route.fulfill({ json: actions.find((item) => item.id === proposalId) });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { code: "TEST_ROUTE_NOT_IMPLEMENTED", message: `Sem fixture para ${path}` },
    });
  });
}

async function openTenant(page: Page) {
  await page.goto("http://127.0.0.1:3213/#platform");
  await expect(page.getByRole("heading", { name: "Controle da plataforma" })).toBeVisible();
  await page.getByPlaceholder("UUID da organização").fill(organizationId);
  await page.getByRole("button", { name: "Carregar contexto" }).click();
  await expect(
    page.getByRole("complementary", { name: "Contexto administrativo ativo" }),
  ).toContainText("Bar Aurora");
}

async function waitForStableVisual(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
      ),
    );
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

test("mantém contexto permanente, indisponibilidade verdadeira e leitura acessível", async ({
  page,
}, testInfo) => {
  await installPlatformFixture(page, { privileged: false });
  await openTenant(page);

  await expect(page.getByRole("button", { name: "Criar proposta" })).toBeDisabled();
  const tenantTab = page.getByRole("tab", { name: "Tenant" });
  const planTab = page.getByRole("tab", { name: "Plano" });
  await expect(tenantTab).toHaveAttribute("aria-controls", "platform-panel-tenant");
  await expect(tenantTab).toHaveAttribute("tabindex", "0");
  await expect(planTab).toHaveAttribute("tabindex", "-1");
  await tenantTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(planTab).toBeFocused();
  await expect(planTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Plano" });
  await expect(panel).toHaveAttribute("aria-labelledby", "platform-tab-plan");
  await expect(panel).toHaveAttribute("id", "platform-panel-plan");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Auditoria" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tenantTab).toBeFocused();
  await page.getByRole("tab", { name: "Incidentes" }).click();
  await expect(page.getByText("Diferença neutra confirmada na contagem.")).toBeVisible();
  await page.getByRole("tab", { name: "Leads" }).click();
  await expect(page.getByText("Bar Horizonte")).toBeVisible();
  await expect(page.getByText("Acompanhamento de lead ainda não disponível")).toBeVisible();
  await page.getByRole("tab", { name: "Suporte" }).click();
  await expect(page.getByText("Atendimento de suporte ainda não disponível")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include(".app-shell").analyze();
  expect(accessibility.violations).toEqual([]);
  await waitForStableVisual(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const shell = await page.locator(".app-shell").boundingBox();
  const commandbar = await page.locator(".platform-commandbar").boundingBox();
  expect(shell?.y).toBeGreaterThanOrEqual(0);
  expect(commandbar?.y).toBeGreaterThanOrEqual(0);
  expect(commandbar?.y).toBeLessThan(page.viewportSize()?.height ?? 0);
  await page.screenshot({
    fullPage: true,
    path: `.superpowers/screenshots/wave2-backoffice-${testInfo.project.name}.png`,
  });
});

test("abre filas globais sem tenant e prepara ação pela projeção do incidente", async ({
  page,
}) => {
  await installPlatformFixture(page, { privileged: true });
  await page.goto("http://127.0.0.1:3213/#platform");

  await expect(page.getByRole("heading", { name: "Filas globais sanitizadas" })).toBeVisible();
  await page.getByRole("tab", { name: "Leads" }).click();
  await expect(page.getByText("Bar Horizonte")).toBeVisible();
  await page.getByRole("tab", { name: "Suporte" }).click();
  await expect(page.getByText("Atendimento de suporte ainda não disponível")).toBeVisible();

  await openTenant(page);
  await page.getByRole("tab", { name: "Incidentes" }).click();
  const incident = page.getByRole("article").filter({
    hasText: "Diferença neutra confirmada na contagem.",
  });
  await incident.getByRole("button", { name: "Preparar aprovação" }).click();
  await expect(page.getByRole("combobox", { name: "Ação", exact: true })).toHaveValue(
    "incident.approve",
  );
  await expect(page.getByRole("textbox", { name: "Alvo", exact: true })).toHaveValue(
    "f1111111-1111-4111-8111-111111111113",
  );
  await expect(page.getByLabel("Unidade")).toHaveValue(unitId);
});

test("executa somente aprovação alheia e impede autoaprovação", async ({ page }) => {
  await installPlatformFixture(page, { privileged: true, withExternalProposal: true });
  await openTenant(page);

  const external = page.getByRole("article").filter({
    hasText: "Incidente confirmado pela operação e plano de reversão registrado.",
  });
  await external.getByRole("button", { name: "Aprovar e executar" }).click();
  await expect(external.getByText("Executada", { exact: true })).toBeVisible();

  await page
    .getByLabel("Justificativa auditável")
    .fill("Solicitação confirmada no incidente e com recuperação documentada.");
  await page.getByText("Confirmo o tenant, o alvo e o impacto acima.").click();
  await page.getByRole("button", { name: "Criar proposta" }).click();

  const own = page.getByRole("article").filter({
    hasText: "Solicitação confirmada no incidente e com recuperação documentada.",
  });
  await expect(own.getByText("Aguardando aprovação")).toBeVisible();
  await expect(own.getByRole("button", { name: "Aprovar e executar" })).toBeDisabled();
});

test("encerra incidente rejeitado usando o estado projetado, sem presumir aprovação", async ({
  page,
}) => {
  const incidentId = "f1111111-1111-4111-8111-111111111113";
  await installPlatformFixture(page, {
    privileged: true,
    incidentStatus: "rejected",
    expectedProposal: {
      action: "incident.close",
      targetId: incidentId,
      payload: { expectedState: "rejected", unitId },
    },
  });
  await openTenant(page);

  await page.getByLabel("Unidade").selectOption(unitId);
  await page.getByRole("combobox", { name: "Ação", exact: true }).selectOption("incident.close");
  await expect(page.getByRole("tabpanel", { name: "Incidentes" })).toContainText("Rejeitado");
  await page.getByRole("textbox", { name: "Alvo", exact: true }).fill(incidentId);
  await page
    .getByLabel("Justificativa auditável")
    .fill("Incidente rejeitado confirmado e encerramento auditável solicitado.");
  await page.getByText("Confirmo o tenant, o alvo e o impacto acima.").click();
  await expect(page.getByRole("button", { name: "Criar proposta" })).toBeEnabled();
  await page.getByRole("button", { name: "Criar proposta" }).click();
  await expect(page.getByText("Aguardando aprovação", { exact: true })).toBeVisible();
});

test("mantem somente a projection da selecao mais recente", async ({ page }) => {
  await installPlatformFixture(page, {
    privileged: false,
    projectionDelays: { tenant: 300 },
  });
  await openTenant(page);

  await page.getByRole("tab", { name: "Plano" }).click();
  const panel = page.getByRole("tabpanel", { name: "Plano" });
  await expect(panel).toContainText("Plano atual");
  await page.waitForTimeout(400);
  await expect(panel).toContainText("Plano atual");
  await expect(panel).not.toContainText("Tenant lento");
});
