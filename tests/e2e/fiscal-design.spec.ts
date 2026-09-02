import { expect, test } from "@playwright/test";
import { compatibleApiHealth, mockCompatibleApi } from "./ops-release";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";
const legalEntityId = "d1111111-1111-4111-8111-111111111111";
const documentId = "f1111111-1111-4111-8111-111111111111";

test("fiscal mantém a próxima ação legível no desktop e em 375 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A matriz de larguras já cobre mobile.");
  await mockCompatibleApi(page);
  await page.route(/\/health$/, (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...compatibleApiHealth,
        buildSha: "e2e",
      },
    }),
  );
  let accountantResolved = false;
  let attachmentUploaded = false;
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
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
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
        openAccountantRequests: 1,
        products: { total: 1, classified: 0, missingClassification: 1 },
      });
    }
    if (path.endsWith(`/fiscal/documents/${documentId}`))
      return json({
        id: documentId,
        tabId: "a3333333-3333-4333-8333-333333333333",
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
    if (
      path.endsWith("/fiscal/accountant/requests/r1111111-1111-4111-8111-111111111111/resolve") &&
      route.request().method() === "POST"
    ) {
      accountantResolved = true;
      return json({ status: "resolved" });
    }
    if (
      path.endsWith(
        "/fiscal/accountant/requests/r1111111-1111-4111-8111-111111111111/attachments",
      ) &&
      route.request().method() === "POST"
    ) {
      attachmentUploaded = true;
      return json({
        attachment: {
          id: "a4444444-4444-4444-8444-444444444444",
          fileName: "compras.xml",
          contentType: "application/xml",
          sizeBytes: 12,
          createdAt: "2026-08-18T11:00:00Z",
        },
        replayed: false,
      });
    }
    if (path.endsWith("/fiscal/accountant/requests")) {
      const overdue = requestUrl.searchParams.get("overdue") === "true";
      const status = requestUrl.searchParams.get("status");
      const targetAudience = requestUrl.searchParams.get("targetAudience");
      const items = [
        {
          id: "r1111111-1111-4111-8111-111111111111",
          competence: "2026-08",
          title:
            "Conferência dos documentos de compras interestaduais com descrição operacional extensa",
          description:
            "Precisamos confirmar os XMLs das compras interestaduais antes do fechamento mensal sem expor chaves internas do sistema.",
          status: accountantResolved ? "resolved" : "open",
          targetAudience: "establishment",
          dueDate: "2026-08-20",
          createdAt: "2026-08-17T12:00:00Z",
          createdByName: "Ana Contadora",
          resolution: accountantResolved ? "Documentos conferidos e fechamento liberado." : null,
          resolvedAt: accountantResolved ? "2026-08-18T12:00:00Z" : null,
          resolvedByName: accountantResolved ? "Bruno Gestor" : null,
          attachments: attachmentUploaded
            ? [
                {
                  id: "a4444444-4444-4444-8444-444444444444",
                  fileName: "compras.xml",
                  contentType: "application/xml",
                  sizeBytes: 12,
                  createdAt: "2026-08-18T11:00:00Z",
                },
              ]
            : [],
        },
        {
          id: "r2222222-2222-4222-8222-222222222222",
          competence: "2026-07",
          title: "Balancete disponível",
          description: "O contador precisa confirmar o recebimento.",
          status: "open",
          targetAudience: "accountant",
          dueDate: "2026-08-29",
          createdAt: "2026-08-18T12:00:00Z",
          createdByName: "Bruno Gestor",
          attachments: [],
        },
      ].filter(
        (item) =>
          (!overdue || (item.status === "open" && item.dueDate < "2026-08-24")) &&
          (!status || item.status === status) &&
          (!targetAudience || item.targetAudience === targetAudience),
      );
      return json({
        items,
        pagination: {
          page: Number(requestUrl.searchParams.get("page") ?? 1),
          pageSize: 25,
          total: overdue || status || targetAudience ? items.length : 32,
        },
      });
    }
    return json({ items: [], capabilities: {}, alerts: [] });
  });

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/#/fiscal");
    await expect(page.getByRole("heading", { name: "Preparação para emitir" })).toBeVisible({
      timeout: 15_000,
    });
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
    await expect(page.getByRole("button", { name: "Revisar classificação" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir venda no balcão" })).toBeVisible();
    if (width === 1440) {
      await page.getByRole("button", { name: "Abrir venda no balcão" }).click();
      await expect(page).toHaveURL(
        /#\/counter\?tab=a3333333-3333-4333-8333-333333333333&origem=fiscal$/,
      );
      await expect(page.getByText("Não foi possível carregar esta área")).toBeVisible();
      await page.goto("http://127.0.0.1:3112/#/fiscal?secao=documents");
      await expect(page.getByRole("heading", { name: "Notas fiscais" })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Fechar" }).click();
    }

    await page.getByRole("button", { name: /Fechamento/ }).click();
    await expect(page).toHaveURL(/#\/fiscal\?secao=closing$/);
    await expect(page.getByRole("heading", { name: "Fechamento mensal" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Notas fiscais" })).toBeVisible();

    await page.goto("http://127.0.0.1:3112/#/fiscal?secao=overview");
    await expect(page.getByText("1 solicitação do contador aberta")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir no Portal" })).toBeVisible();
    if (width === 1440) {
      await page.getByRole("button", { name: "Abrir no Portal" }).click();
      await expect(page).toHaveURL(
        /#\/accountant\?status=open&page=1&targetAudience=establishment$/,
      );
      await expect(page.getByRole("heading", { name: "Competência", exact: true })).toBeVisible();
      await page.goto("http://127.0.0.1:3112/#/fiscal?secao=overview");
    }
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
    await expect(page.getByText("Ana Contadora", { exact: false })).toBeVisible();
    if (width === 1440) {
      await expect(page.getByText("32 solicitações", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Vencidas" }).click();
      await expect(page).toHaveURL(/#\/accountant\?status=overdue&page=1$/);
      await expect(page.getByText("1 solicitação", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Todas" }).click();
      await page.getByText("Anexos").first().click();
      await page
        .getByLabel("Adicionar anexo")
        .first()
        .setInputFiles({
          name: "compras.xml",
          mimeType: "application/xml",
          buffer: Buffer.from("<compras />"),
        });
      await expect(page.getByText("Anexo enviado com segurança.")).toBeVisible();
      await expect(page.getByText("compras.xml")).toBeVisible();
      await expect(page.getByText("Aguardando contador")).toBeVisible();
      await expect(page.getByRole("button", { name: "Responder e resolver" })).toHaveCount(1);
      await page.getByRole("button", { name: "Responder e resolver" }).click();
      await page.getByLabel("Resposta").fill("Documentos conferidos e fechamento liberado.");
      await page.getByRole("button", { name: "Registrar resposta" }).click();
      await expect(page.getByText("Resposta registrada e solicitação resolvida.")).toBeVisible();
      await expect(page.getByText("Documentos conferidos e fechamento liberado.")).toBeVisible();
      await expect(page.getByText("Resolvida", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("Bruno Gestor", { exact: false }).first()).toBeVisible();
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    }
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
