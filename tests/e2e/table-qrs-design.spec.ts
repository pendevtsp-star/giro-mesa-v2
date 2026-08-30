import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";

async function mockTableQrSession(page: Page, publicMenuPublished = true) {
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

  await mockCompatibleApi(page);

  await page.route(/\/v1\//, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session") && request.method() === "GET") {
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    }
    if (path.endsWith("/auth/me")) {
      return json({
        identity: { id: identityId, email: "dono@giromesa.test", displayName: "Proprietário" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "owner",
            unitId: null,
          },
        ],
      });
    }
    if (path.endsWith("/organizations")) {
      return json([
        {
          membershipId: "membership-1",
          status: "active",
          organization: { id: organizationId, tradeName: "Casa Giro", document: "05953016000132" },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          roles: [{ role: "owner", unitId: null }],
        },
      ]);
    }
    if (path.endsWith("/pilot/catalog/tables/qr/lifecycle")) {
      if (!publicMenuPublished) {
        return route.fulfill({
          status: 404,
          json: { code: "PUBLIC_MENU_NOT_FOUND" },
        });
      }
      return json({
        settings: {
          revision: 3,
          displayName: "Casa Giro",
          headline: "Atendimento direto na sua mesa",
          instructions: "Escaneie para ver o cardápio e pedir atendimento.",
          logoUrl: null,
          primaryColor: "#047857",
          wifiNotice: "Rede disponível no caixa",
          serviceChargeNotice: "Serviço opcional de 10%",
          template: "classic",
          presenceProtection: "daily_code",
          updatedAt: "2026-08-24T18:00:00.000Z",
        },
        generalBranding: {
          logoUrl: "https://cdn.example.test/logo.png",
          logoThumbnailUrl: null,
        },
        presence: { mode: "daily_code", code: "123456" },
        tables: [
          {
            tableId: "d1111111-1111-4111-8111-111111111111",
            label: "Mesa 2",
            tokenVersion: 2,
            url: "https://menu.example.test/m/casa-giro#mesa=token.signature",
            scanCount: 18,
            lastScannedAt: "2026-08-24T18:05:00.000Z",
          },
          {
            tableId: "d2222222-2222-4222-8222-222222222222",
            label: "Mesa 10",
            tokenVersion: 1,
            url: "https://menu.example.test/m/casa-giro#mesa=token.signature",
            scanCount: 4,
            lastScannedAt: null,
          },
        ],
        batches: [
          {
            id: "e1111111-1111-4111-8111-111111111111",
            format: "a4_4",
            output: "pdf",
            template: "classic",
            status: "printed",
            menuSlug: "casa-giro",
            includeWifi: false,
            settingsRevision: 3,
            settings: {
              displayName: "Casa Giro",
              headline: "Atendimento direto na sua mesa",
              instructions: "Escaneie para ver o cardápio e pedir atendimento.",
              logoUrl: null,
              primaryColor: "#047857",
              wifiNotice: null,
              serviceChargeNotice: "Serviço opcional de 10%",
              template: "classic",
              presenceProtection: "daily_code",
            },
            tables: [
              {
                tableId: "d1111111-1111-4111-8111-111111111111",
                label: "Mesa 2",
                tokenVersion: 2,
                currentVersion: 2,
                isCurrent: true,
                url: "https://menu.example.test/m/casa-giro#mesa=token.signature",
              },
            ],
            createdByIdentityId: identityId,
            createdByLabel: "Proprietário",
            generatedAt: "2026-08-24T18:00:00.000Z",
            printedByIdentityId: identityId,
            printedByLabel: "Proprietário",
            printedAt: "2026-08-24T18:05:00.000Z",
          },
        ],
        rotations: [],
      });
    }
    return json({});
  });
}

test("QR das mesas orienta publicar o cardápio quando ele ainda não existe", async ({ page }) => {
  await mockTableQrSession(page, false);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("http://127.0.0.1:3112/#/table-qrs");

  await expect(page.getByText("Publique o cardápio antes de gerar os QR")).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir Cardápio" })).toHaveAttribute(
    "href",
    "#/catalog",
  );
  await expect(page.getByText(/versão atual da API/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("QR das mesas permanece operacional em desktop e 375 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre os dois viewports diretamente.");
  await mockTableQrSession(page);

  for (const [width, theme] of [
    [1440, "light"],
    [375, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    if (page.url().startsWith("http")) {
      await page.evaluate((nextTheme) => localStorage.setItem("giromesa-theme", nextTheme), theme);
      await page.reload();
    } else {
      await page.goto("http://127.0.0.1:3112/#/table-qrs");
    }

    await expect(page.getByRole("heading", { name: "QR das mesas", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mesas", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prévia", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personalização das placas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gerar lote" })).toBeVisible();
    await expect(page.getByText("Mesa 2", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("22 leituras confirmadas", { exact: true })).toBeVisible();
    await expect(page.getByText("Código de presença de hoje", { exact: true })).toBeVisible();
    await expect(page.getByText("123456", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar logo geral" })).toBeVisible();
    await expect(page.getByLabel("Enviar logo")).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp",
    );
    await expect(page.locator(".table-qrs-plate__qr")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
