import { expect, test } from "@playwright/test";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";
const legalEntityId = "d1111111-1111-4111-8111-111111111111";

test("fiscal mantém a próxima ação legível no desktop e em 375 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A matriz de larguras já cobre mobile.");
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
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/me")) {
      return json({
        identity: { id: identityId, email: "gestao@giromesa.test", displayName: "Gestão" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "manager",
            unitId,
          },
        ],
      });
    }
    if (path.endsWith("/organizations")) {
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
          roles: [{ role: "manager", unitId }],
        },
      ]);
    }
    if (path.endsWith("/fiscal/profile")) {
      return json({
        legalEntityId,
        taxRegime: "simples_nacional",
        crt: "1",
        municipalRegistration: null,
        cnae: "5611201",
        stateCode: "SP",
        cityCode: "3550308",
        environment: "homologation",
        provider: "focus",
        settings: { series: { nfce: "1" } },
      });
    }
    if (path.endsWith("/fiscal/provider")) {
      return json({
        provider: "focus",
        status: "company_required",
        environment: "homologation",
        platformConfigured: true,
        connection: null,
        nextAction: "Valide e cadastre a empresa emitente na Focus NFe.",
      });
    }
    if (path.endsWith("/fiscal/tax-revisions")) return json([]);
    if (path.endsWith("/pilot/catalog")) {
      return json({
        categories: [{ id: "category-1", name: "Pratos", active: true }],
        prices: [],
        availability: [],
        products: [
          {
            id: "e1111111-1111-4111-8111-111111111111",
            categoryId: "category-1",
            name: "Prato executivo",
            active: true,
          },
        ],
      });
    }
    if (path.endsWith("/fiscal/dashboard")) {
      return json({
        profile: { provider: "focus", environment: "homologation" },
        documentsByStatus: { authorized: 8, pending: 1, rejected: 0 },
        pendingDocuments: 1,
        openPeriods: 1,
        openAccountantRequests: 0,
        products: { total: 1, classified: 0, missingClassification: 1 },
      });
    }
    if (path.endsWith("/fiscal/documents"))
      return json({ items: [], pagination: { page: 1, pageSize: 50, total: 0 } });
    if (path.endsWith("/fiscal/periods")) return json([]);
    return json({ items: [], capabilities: {}, alerts: [] });
  });

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://localhost:3102/#/fiscal");
    await expect(page.getByRole("heading", { name: "Ativação fiscal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Empresa emitente" })).toBeVisible();
    expect(
      await page
        .locator("#fiscal-configuration, #fiscal-provider-onboarding, #fiscal-classification")
        .evaluateAll((nodes) => nodes.map((node) => node.id)),
    ).toEqual(["fiscal-configuration", "fiscal-provider-onboarding", "fiscal-classification"]);
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(layout.content, JSON.stringify({ width, ...layout })).toBe(layout.viewport);
    await page.screenshot({ path: testInfo.outputPath(`fiscal-${width}.png`), fullPage: true });
  }
});
