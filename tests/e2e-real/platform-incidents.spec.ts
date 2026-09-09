import { expect, test } from "@playwright/test";
import { mockCompatibleApi } from "../e2e/ops-release";

test("backoffice filtra incidentes no servidor e mantém impacto legível em 375 px", async ({
  page,
}, testInfo) => {
  await mockCompatibleApi(page);
  const incidentRequests: URL[] = [];
  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session"))
      return route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: {
          id: "b1111111-1111-4111-8111-111111111111",
          email: "admin@giromesa.com.br",
          displayName: "Admin GiroMesa",
        },
        memberships: [],
        platformAdmin: true,
      });
    if (path.endsWith("/organizations")) return json([]);
    if (path.endsWith("/platform/overview"))
      return json({
        counts: { organizations: 1, units: 1, activeTrials: 0 },
        health: { pendingJobs: 1, failedJobs: 1, staleHubs: 0, failedIntegrations: 0 },
        trialFunnel: { applications: 0, activations: 0, conversionPercent: 0 },
        recentTrialApplications: [],
        recentContacts: [],
        recentOrganizations: [],
        fiscalIntegrations: [],
        access: {
          role: "admin",
          capabilities: ["tenants:read", "incidents:write", "outbox:retry"],
          mfaEnforced: true,
        },
        sources: [],
      });
    if (path.endsWith("/platform/tenants"))
      return json({ items: [], nextCursor: null, partialSources: [] });
    if (path.endsWith("/platform/incidents")) {
      incidentRequests.push(url);
      return json({
        items: [
          {
            fingerprint: "outbox:evt-1",
            source: "outbox",
            sourceId: "evt-1",
            organizationId: "org-1",
            organizationName: "Casa Teste UI",
            unitId: "unit-1",
            unitName: "Unidade Teste UI",
            severity: "critical",
            title: "Pedido sem projeção",
            detail: { topic: "order.created", attempts: 3 },
            occurredAt: "2026-09-09T12:00:00.000Z",
            state: "open",
            claimedByIdentityId: null,
            claimedAt: null,
            snoozedUntil: null,
            resolvedAt: null,
            reason: null,
            ageMinutes: 270,
            impact: "orders",
            criterion: "tópico order.created",
          },
        ],
        nextCursor: null,
        partialSources: [],
      });
    }
    return route.fulfill({ status: 404, json: { code: "UNHANDLED_E2E_ROUTE", path } });
  });

  const baseUrl = String(testInfo.project.use.baseURL ?? "http://127.0.0.1:3112");
  await page.goto(`${baseUrl}/#/platform`);
  await expect(page.getByRole("heading", { name: "Incidentes" })).toBeVisible();
  await expect(page.getByText("Impacto: Pedidos · critério: tópico order.created")).toBeVisible();
  await page.getByLabel("Severidade do incidente", { exact: true }).selectOption("critical");
  await page.getByLabel("Origem do incidente", { exact: true }).selectOption("outbox");
  await page.getByLabel("Idade do incidente", { exact: true }).selectOption("over_240");
  await page.getByLabel("Impacto do incidente", { exact: true }).selectOption("orders");
  await expect
    .poll(() => incidentRequests.at(-1)?.searchParams.toString())
    .toContain("severity=critical&source=outbox&impact=orders&minAgeMinutes=241");

  await page.getByRole("button", { name: "Pilotos com problemas" }).click();
  await expect
    .poll(() => incidentRequests.at(-1)?.searchParams.toString())
    .toContain("status=active&activePilotOnly=true");
  await page.getByRole("button", { name: "Salvar filtros atuais" }).click();
  await expect(
    page.getByText("Visão salva neste navegador para este administrador."),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const key = "gm:platform:incident-view:b1111111-1111-4111-8111-111111111111";
      return JSON.parse(localStorage.getItem(key) ?? "null");
    }),
  ).toEqual({
    status: "active",
    severity: "all",
    source: "all",
    impact: "all",
    age: "all",
    activePilotOnly: true,
  });
  await page.getByLabel("Escopo do incidente", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Aplicar visão salva" }).click();
  await expect(page.getByLabel("Escopo do incidente", { exact: true })).toHaveValue(
    "active_pilots",
  );

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Críticos agora" })).toBeVisible();
  await expect(page.getByText("Visão salva neste navegador", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
