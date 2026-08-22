import { expect, test } from "@playwright/test";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";
const legalEntityId = "d1111111-1111-4111-8111-111111111111";
const documentId = "f1111111-1111-4111-8111-111111111111";

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
    if (path.endsWith("/auth/terminal-session"))
      return route.fulfill({ status: 401, json: { message: "Terminal ausente" } });
    if (path.endsWith("/auth/me")) {
      return json({
        identity: { id: identityId, email: "gestao@giromesa.test", displayName: "Gestão" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "owner",
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
          roles: [{ role: "owner", unitId }],
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
        documentsByStatus: { authorized: 8, pending: 0, rejected: 1 },
        pendingDocuments: 0,
        openPeriods: 1,
        openAccountantRequests: 0,
        products: { total: 1, classified: 0, missingClassification: 1 },
      });
    }
    if (path.endsWith(`/fiscal/documents/${documentId}`))
      return json({
        id: documentId,
        orderId: "a2222222-2222-4222-8222-222222222222",
        model: "nfce",
        number: 42,
        series: "1",
        status: "rejected",
        customerDocument: null,
        totalCents: 3500,
        taxCents: 420,
        issuedAt: "2026-08-21T15:00:00.000Z",
        authorizedAt: null,
        canceledAt: null,
        accessKey: null,
        items: [
          {
            id: "item-1",
            lineNumber: 1,
            description: "Prato executivo",
            quantityMilli: 1000,
            unitPriceCents: 3500,
            totalCents: 3500,
            taxCents: 420,
          },
        ],
        events: [
          {
            id: "event-1",
            type: "fiscal.document.issue_result",
            status: "rejected",
            code: "NCM_INVALIDO",
            message: "NCM inválido",
            occurredAt: "2026-08-21T15:01:00.000Z",
          },
        ],
      });
    if (path.endsWith("/fiscal/documents"))
      return json({
        items: [
          {
            id: documentId,
            model: "nfce",
            number: 42,
            series: "1",
            status: "rejected",
            customerDocument: null,
            totalCents: 3500,
            issuedAt: "2026-08-21T15:00:00.000Z",
            accessKey: null,
          },
        ],
        pagination: { page: 1, pageSize: 50, total: 1 },
      });
    if (path.endsWith("/fiscal/periods")) return json([]);
    if (path.endsWith("/fiscal/accountant/package")) return route.fulfill({ status: 404 });
    if (path.endsWith("/fiscal/accountant/requests")) return json([]);
    return json({ items: [], capabilities: {}, alerts: [] });
  });

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/#/fiscal");
    await expect(page.getByRole("heading", { name: "Preparação para emitir" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Resumo/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: /Cadastro fiscal/ }).click();
    await expect(page).toHaveURL(/#\/fiscal\?secao=setup$/);
    await expect(page.getByRole("heading", { name: "Dados tributários" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dados fiscais da empresa" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Focus NFe");
    await expect(page.locator("body")).not.toContainText("FOCUS_NFE_PRIMARY_TOKEN");
    await expect(page.locator("body")).not.toContainText("Token de homologação");

    await page.getByRole("button", { name: /Produtos/ }).click();
    await expect(page).toHaveURL(/#\/fiscal\?secao=products$/);
    await expect(page.getByRole("heading", { name: "Classificação dos produtos" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Prato executivo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar modelo CSV" })).toBeVisible();

    await page.getByRole("button", { name: /Notas fiscais/ }).click();
    await expect(page).toHaveURL(/#\/fiscal\?secao=documents$/);
    await expect(page.getByRole("heading", { name: "Notas fiscais" })).toBeVisible();
    await page.getByRole("button", { name: "Ver detalhes" }).click();
    await expect(page.getByRole("dialog", { name: "Nota fiscal 42" })).toBeVisible();
    await expect(
      page.getByText("Revise a classificação fiscal dos produtos desta nota."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fechar" }).click();

    await page.getByRole("button", { name: /Fechamento/ }).click();
    await expect(page).toHaveURL(/#\/fiscal\?secao=closing$/);
    await expect(page.getByRole("heading", { name: "Fechamento mensal" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Notas fiscais" })).toBeVisible();

    await page.goto("http://127.0.0.1:3112/#/fiscal?secao=overview");
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      sidebarRight: document.querySelector(".sidebar")?.getBoundingClientRect().right ?? 0,
      headingLeft: document.querySelector(".page-heading")?.getBoundingClientRect().left ?? 0,
    }));
    expect(layout.content, JSON.stringify({ width, ...layout })).toBe(layout.viewport);
    expect(layout.scrollX).toBe(0);
    if (width === 1440) expect(layout.headingLeft).toBeGreaterThanOrEqual(layout.sidebarRight);
    await page.screenshot({ path: testInfo.outputPath(`fiscal-${width}.png`), fullPage: true });
  }

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/#/accountant");
    await expect(page.getByRole("heading", { name: "Competência", exact: true })).toBeVisible();
    await expect(page.locator(".accountant-toolbar")).toHaveCSS(
      "flex-direction",
      width === 1440 ? "row" : "column",
    );
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      scrollX: window.scrollX,
      sidebarRight: document.querySelector(".sidebar")?.getBoundingClientRect().right ?? 0,
      headingLeft: document.querySelector(".page-heading")?.getBoundingClientRect().left ?? 0,
    }));
    expect(layout.content, JSON.stringify({ width, ...layout })).toBe(layout.viewport);
    expect(layout.scrollX).toBe(0);
    if (width === 1440) expect(layout.headingLeft).toBeGreaterThanOrEqual(layout.sidebarRight);
    await page.screenshot({ path: testInfo.outputPath(`accountant-${width}.png`), fullPage: true });
  }
});
