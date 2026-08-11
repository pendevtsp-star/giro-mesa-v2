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
  action: "tenant.suspend";
  targetType: "organization";
  targetId: string;
  requestedByIdentityId: string;
  justification: string;
  payload: { expectedState: string };
  status: "pending" | "executed";
  version: number;
  requestedAt: string;
  expiresAt: string;
  decidedByIdentityId?: string;
  decidedAt?: string;
};

async function installPlatformFixture(
  page: Page,
  options: { privileged: boolean; withExternalProposal?: boolean },
) {
  const permissions = options.privileged
    ? [
        "platform.read",
        "platform.action.propose",
        "platform.action.approve",
        "platform.action.reject",
        "platform.tenant.suspend",
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
    if (path.includes(`/v1/platform/tenants/${organizationId}/resources/`)) {
      const resource = decodeURIComponent(path.split("/").at(-1) ?? "");
      if (["incidents", "leads", "support"].includes(resource)) {
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
      await route.fulfill({
        json: {
          resource,
          availability: "available",
          items: [
            {
              id: organizationId,
              name: "Bar Aurora",
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
        action: "tenant.suspend";
        targetId: string;
        justification: string;
        payload: { expectedState: string };
      };
      expect(body).toMatchObject({
        action: "tenant.suspend",
        targetId: organizationId,
        payload: { expectedState: "active" },
      });
      const proposal: ActionRow = {
        id: `f1111111-1111-4111-8111-${String(sequence++).padStart(12, "0")}`,
        organizationId,
        action: body.action,
        targetType: "organization",
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
  await page.goto("/#platform");
  await expect(page.getByRole("heading", { name: "Controle da plataforma" })).toBeVisible();
  await page.getByPlaceholder("UUID da organização").fill(organizationId);
  await page.getByRole("button", { name: "Carregar contexto" }).click();
  await expect(
    page.getByRole("complementary", { name: "Contexto administrativo ativo" }),
  ).toContainText("Bar Aurora");
}

test("mantém contexto permanente, indisponibilidade verdadeira e leitura acessível", async ({
  page,
}, testInfo) => {
  await installPlatformFixture(page, { privileged: false });
  await openTenant(page);

  await expect(page.getByRole("button", { name: "Criar proposta" })).toBeDisabled();
  await page.getByRole("tab", { name: "Incidentes" }).click();
  await expect(page.getByText("Fonte ainda não conectada nesta base")).toBeVisible();
  await expect(page.getByText("Nenhum dado ou sucesso foi simulado.")).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include(".platform-workspace").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    fullPage: true,
    path: `.superpowers/screenshots/wave2-backoffice-${testInfo.project.name}.png`,
  });
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
