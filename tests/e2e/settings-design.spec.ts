import { expect, test } from "@playwright/test";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const targetUnitId = "b2222222-2222-4222-8222-222222222222";
const identityId = "c1111111-1111-4111-8111-111111111111";

const closedWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  mode: "closed",
}));

test("configurações salvam, copiam e permanecem acessíveis em dark/375 px", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre desktop e 375 px.");
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

  let settings = {
    organization: {
      id: organizationId,
      legalName: "GiroMesa Alimentação Ltda",
      tradeName: "Casa Giro",
      document: "05953016000132",
    },
    unit: { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo" },
    presentation: {
      displayName: "Casa Giro Centro",
      slogan: "Feito na hora",
      logoUrl: "https://cdn.example.test/logo.png",
      primaryColor: "#123456",
      accentColor: "#abcdef",
      notice: null,
      address: "Rua Um, 10",
      phone: "11999999999",
      instagram: "@casagiro",
      openingHours: "Seg a dom: fechado",
      serviceTaxNotice: null,
      corkageFeeNotice: null,
      wifi: { ssid: "Casa Giro", password: "segredo" },
    },
    businessHours: { weekly: closedWeek, exceptions: [] },
    publication: {
      active: true,
      publishedAt: "2026-08-22T12:00:00.000Z",
      hasUnpublishedChanges: false,
    },
  };
  let copyKey = "";

  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session") && request.method() === "GET")
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    if (path.endsWith("/auth/me"))
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
    if (path.endsWith("/organizations"))
      return json([
        {
          membershipId: "membership-1",
          status: "active",
          organization: {
            id: organizationId,
            tradeName: "Casa Giro",
            document: "05953016000132",
          },
          units: [
            {
              id: unitId,
              name: "Unidade Centro",
              timezone: "America/Sao_Paulo",
              active: true,
              branding: { displayName: "Casa Giro Centro", logoUrl: settings.presentation.logoUrl },
            },
            {
              id: targetUnitId,
              name: "Unidade Jardins",
              timezone: "America/Sao_Paulo",
              active: true,
              branding: { displayName: "Casa Giro Jardins", logoUrl: null },
            },
          ],
          roles: [{ role: "owner", unitId: null }],
        },
      ]);
    if (path.endsWith(`/units/${unitId}/settings`) && request.method() === "GET")
      return json(settings);
    if (path.endsWith(`/units/${unitId}/settings`) && request.method() === "PUT") {
      const body = request.postDataJSON();
      settings = {
        ...settings,
        unit: { id: unitId, name: body.name, timezone: body.timezone },
        presentation: body.presentation,
        businessHours: body.businessHours,
        publication: { ...settings.publication, hasUnpublishedChanges: true },
      };
      return json(settings);
    }
    if (path.endsWith(`/units/${unitId}/settings/copy`)) {
      copyKey = request.headers()["idempotency-key"] ?? "";
      return json({ sourceUnitId: unitId, targetUnitIds: [targetUnitId] });
    }
    return json({});
  });

  for (const [width, theme] of [
    [1440, "light"],
    [375, "dark"],
  ] as const) {
    if (page.url().startsWith("http")) {
      await page.evaluate((nextTheme) => localStorage.setItem("giromesa-theme", nextTheme), theme);
      await page.reload();
    } else {
      await page.goto("http://127.0.0.1:3112/#/settings");
    }
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Organização" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  }

  await page.getByLabel("Nome interno da unidade").fill("Centro Histórico");
  await page.getByRole("button", { name: "Salvar unidade" }).click();
  await expect(page.getByText(/Configurações salvas/)).toBeVisible();
  await expect(page.getByText(/aguardando publicação/i)).toBeVisible();

  await page.getByLabel(/Logo \(JPG/).setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>", "utf8"),
  });
  await expect(page.getByRole("alert")).toContainText("JPG, PNG ou WEBP");

  await page.getByLabel("Unidade Jardins").check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Copiar marca e horários/ }).click();
  await expect(page.getByText(/copiadas para Unidade Jardins/i)).toBeVisible();
  expect(copyKey.length).toBeGreaterThanOrEqual(8);
});
