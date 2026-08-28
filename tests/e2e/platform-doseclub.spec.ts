import { expect, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";

test("backoffice mostra a prontidão DoseClub sem overflow em 375 px", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A largura mobile é validada no próprio cenário.");
  await mockCompatibleApi(page);
  await page.route(/\/v1\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session"))
      return route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: {
          id: "c1111111-1111-4111-8111-111111111111",
          email: "admin@giromesa.com.br",
          displayName: "Admin GiroMesa",
        },
        memberships: [],
        platformAdmin: true,
      });
    if (path.endsWith("/organizations")) return json([]);
    if (path.endsWith(`/platform/tenants/${organizationId}`))
      return json({
        organization: {
          id: organizationId,
          tradeName: "Restaurante Piloto",
          legalName: "Restaurante Piloto Ltda",
          document: "**********0132",
          billingState: "trial_active",
          billingStateChangedAt: "2026-08-27T12:00:00.000Z",
          createdAt: "2026-08-27T12:00:00.000Z",
        },
        units: [{ id: unitId, name: "Matriz", active: true }],
        onboarding: { activatedAt: "2026-08-27T12:00:00.000Z", missingItems: [] },
        trial: {
          trial: {
            startsAt: "2026-08-27T12:00:00.000Z",
            endsAt: "2027-02-27T12:00:00.000Z",
          },
          plan: { slug: "piloto", entitlements: ["doseclub.subscription"] },
        },
        billing: null,
        hubs: [],
        fiscal: [],
        incidents: [],
        timeline: [],
        doseClub: {
          providerEnabled: true,
          entitled: true,
          connections: [
            {
              id: "d1111111-1111-4111-8111-111111111111",
              unitId,
              unitName: "Matriz",
              status: "active",
              managed: true,
              provisioningStatus: "waiting_product_mappings",
              healthCheckedAt: "2026-08-27T12:05:00.000Z",
              updatedAt: "2026-08-27T12:05:00.000Z",
            },
          ],
        },
      });
    if (path.endsWith("/platform/overview"))
      return json({
        counts: { organizations: 1, units: 1, activeTrials: 1 },
        health: { pendingJobs: 0, failedJobs: 0, staleHubs: 0, failedIntegrations: 0 },
        trialFunnel: { applications: 1, activations: 1, conversionPercent: 100 },
        recentTrialApplications: [],
        recentContacts: [],
        recentOrganizations: [],
        fiscalIntegrations: [],
        access: {
          role: "admin",
          capabilities: ["tenants:read", "billing:read", "billing:write"],
          mfaEnforced: true,
        },
        sources: [],
      });
    if (path.endsWith("/platform/tenants"))
      return json({
        items: [
          {
            id: organizationId,
            name: "Restaurante Piloto",
            legalName: "Restaurante Piloto Ltda",
            document: "**********0132",
            billingState: "trial_active",
            billingStateChangedAt: "2026-08-27T12:00:00.000Z",
            unitCount: 1,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
        ],
        nextCursor: null,
        partialSources: [],
      });
    if (path.endsWith("/platform/incidents"))
      return json({ items: [], nextCursor: null, partialSources: [] });
    return route.fulfill({ status: 404, json: { code: "UNHANDLED_E2E_ROUTE", path } });
  });

  await page.goto("http://127.0.0.1:3112/#/platform");
  await expect(page.getByRole("heading", { level: 1, name: "Central de controle" })).toBeVisible();
  await page.getByRole("button", { name: /Restaurante Piloto/ }).click();
  await expect(page.getByRole("heading", { level: 3, name: "DoseClub" })).toBeVisible();
  await expect(page.getByText("Mapeamentos pendentes", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("heading", { level: 3, name: "DoseClub" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
