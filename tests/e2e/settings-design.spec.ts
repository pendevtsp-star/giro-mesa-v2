import { expect, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

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
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre desktop e 375 px.");
  await mockCompatibleApi(page);
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
    revision: 0,
    organization: {
      id: organizationId,
      legalName: "GiroMesa Alimentação Ltda",
      tradeName: "Casa Giro",
      document: "05953016000132",
      revision: "2026-08-22T12:00:00.000Z",
    },
    unit: { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo" },
    presentation: {
      displayName: "Casa Giro Centro",
      slogan: "Feito na hora",
      logoUrl: "https://cdn.example.test/logo.png",
      logoThumbnailUrl: null,
      coverImageUrl: null,
      primaryColor: "#123456",
      accentColor: "#abcdef",
      notice: null,
      address: "Rua Um, 10",
      addressDetails: null,
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
      publishedVersion: 1,
      publicUrl: "https://menu.example.test/casa-giro",
      hasUnpublishedChanges: false,
      pendingSections: [],
    },
  };
  let copyKey = "";
  let mediaUploads = 0;
  let specializedSummary: "backend79" | "ready" = "backend79";
  let specializedSummaryFailuresRemaining = 0;
  let channelCheckKey = "";
  let channelChecks = ["qr", "cash", "fiscal", "printing", "smartpos", "delivery"].map(
    (channel) => ({
      channel,
      status: "not_tested",
      evidenceReference: null,
      note: null,
      actorIdentityId: null,
      actorDisplayName: null,
      checkedAt: null,
    }),
  );

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
    if (path.endsWith(`/units/${unitId}/settings/specialized-summary`)) {
      if (specializedSummaryFailuresRemaining > 0) {
        specializedSummaryFailuresRemaining -= 1;
        return route.fulfill({ status: 503, json: { message: "Resumo indisponível" } });
      }
      return json({
        catalog: { active: true, publishedVersion: 1 },
        cash: { configured: true },
        people: { timeTrackingConfigured: false },
        kds: { activeStations: 2 },
        fiscal: { configured: true },
        devices: { activeCount: 1 },
        billing: { state: "active" },
        ...(specializedSummary === "ready"
          ? {
              setup: {
                activeProducts: 3,
                activeTables: 5,
                activePeople: 2,
                activePrinters: 1,
                completedService: true,
              },
            }
          : {}),
      });
    }
    if (path.endsWith(`/units/${unitId}/settings/channel-checks`)) {
      if (request.method() === "GET") return json({ checks: channelChecks });
      channelCheckKey = request.headers()["idempotency-key"] ?? "";
      const body = request.postDataJSON();
      const saved = {
        ...body,
        actorIdentityId: identityId,
        actorDisplayName: "Proprietário",
        checkedAt: "2026-09-09T18:00:00.000Z",
      };
      channelChecks = [saved, ...channelChecks.filter((item) => item.channel !== body.channel)];
      return json(saved);
    }
    if (path.endsWith(`/units/${unitId}/settings/history`))
      return json([
        {
          id: "d1111111-1111-4111-8111-111111111111",
          action: "updated",
          actorDisplayName: "Proprietário",
          occurredAt: "2026-08-22T12:00:00.000Z",
          revision: 0,
          changedSections: ["brand"],
        },
      ]);
    if (path.endsWith(`/units/${unitId}/settings`) && request.method() === "PUT") {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(settings.revision);
      settings = {
        ...settings,
        revision: settings.revision + 1,
        unit: { id: unitId, name: body.name, timezone: body.timezone },
        presentation: body.presentation,
        businessHours: body.businessHours,
        publication: {
          ...settings.publication,
          hasUnpublishedChanges: true,
          pendingSections: ["contacts"],
        },
      };
      return json(settings);
    }
    if (path.endsWith("/catalog/media") && request.method() === "POST") {
      mediaUploads += 1;
      return json({
        key: `${"a".repeat(32)}.webp`,
        url: "http://127.0.0.1:3112/icons/giromesa-512.png",
      });
    }
    if (path.endsWith(`/units/${unitId}/settings/copy`)) {
      copyKey = request.headers()["idempotency-key"] ?? "";
      return json({ sourceUnitId: unitId, targetUnitIds: [targetUnitId] });
    }
    if (path.endsWith(`/units/${unitId}/settings/restore`)) {
      settings = { ...settings, revision: settings.revision + 1 };
      return json(settings);
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
      await page.goto("http://127.0.0.1:3112/#/settings?section=setup");
    }
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Organização" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const checklist = document.getElementById("settings-setup")?.getBoundingClientRect();
          const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
          return Boolean(checklist && topbar && checklist.top >= topbar.bottom);
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  }

  await expect(
    page.getByText(
      "O servidor ainda não fornece a conferência inicial. As configurações abaixo continuam disponíveis.",
    ),
  ).toBeVisible();
  await page.getByLabel("Nome interno da unidade").fill("Centro Histórico");
  specializedSummaryFailuresRemaining = 1;
  await page.getByRole("button", { name: "Conferir novamente" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível conferir a preparação");
  await expect(page.getByLabel("Nome interno da unidade")).toHaveValue("Centro Histórico");

  specializedSummary = "ready";
  await page.getByRole("button", { name: "Conferir novamente" }).click();
  await expect(page.getByText("4 de 4 etapas com registro no sistema")).toBeVisible();
  await expect(page.getByText("3 produtos ativos.")).toBeVisible();
  await expect(page.getByText("Cadastro não é homologação")).toBeVisible();
  await expect(page.getByLabel("Nome interno da unidade")).toHaveValue("Centro Histórico");
  await page.getByText("Canais e continuidade", { exact: true }).click();
  const smartPosCheck = page
    .locator(".setup-checklist__extras > li")
    .filter({ hasText: "SmartPOS" });
  await expect(smartPosCheck).toContainText("Não testado");
  await smartPosCheck.getByRole("button", { name: "Registrar teste" }).click();
  const checkDialog = page.getByRole("dialog", { name: "Registrar conferência manual" });
  await checkDialog.getByLabel("Protocolo ou referência da evidência").fill("TESTE-POS-001");
  await checkDialog
    .getByLabel("O que foi testado e próximo passo")
    .fill("Pagamento aprovado e comprovado no extrato do turno.");
  await checkDialog.getByRole("button", { name: "Registrar conferência" }).click();
  await expect(smartPosCheck).toContainText("Teste aprovado");
  await expect(smartPosCheck).toContainText("TESTE-POS-001");
  await expect(smartPosCheck).toContainText("Proprietário");
  expect(channelCheckKey.length).toBeGreaterThanOrEqual(8);
  await page.locator(".setup-checklist").screenshot({
    path: testInfo.outputPath("settings-checklist-375-dark.png"),
  });

  await page.evaluate(() => localStorage.setItem("giromesa-theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("4 de 4 etapas com registro no sistema")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".setup-checklist").screenshot({
    path: testInfo.outputPath("settings-checklist-375-light.png"),
  });

  await page.getByLabel("Nome interno da unidade").fill("Centro Histórico");
  await page.getByLabel("Telefone / WhatsApp").fill("82999999999");
  await expect(page.getByLabel("Telefone / WhatsApp")).toHaveValue("(82) 99999-9999");
  await page.getByRole("button", { name: "Salvar unidade" }).click();
  await expect(page.getByText(/Configurações salvas/)).toBeVisible();
  await expect(page.getByText(/aguardando publicação/i)).toBeVisible();

  await page.getByLabel(/Logo \(JPG/).setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>", "utf8"),
  });
  await expect(page.getByRole("alert")).toContainText("JPG, PNG ou WEBP");

  const coverBase64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível");
    context.fillStyle = "#123456";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  });
  await page.getByLabel(/^Foto de capa do cardápio/).setInputFiles({
    name: "capa.png",
    mimeType: "image/png",
    buffer: Buffer.from(coverBase64, "base64"),
  });
  await expect(page.locator(".settings-brand-preview__cover")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Salvar marca" }).click();
  await expect(page.getByText(/Configurações salvas/)).toBeVisible();
  expect(mediaUploads).toBe(1);
  expect(settings.presentation.coverImageUrl).toBe("http://127.0.0.1:3112/icons/giromesa-512.png");
  await expect(page.locator(".settings-brand-preview__cover")).toHaveAttribute(
    "src",
    settings.presentation.coverImageUrl,
  );

  await page.getByLabel("Unidade Jardins").check();
  await page.getByRole("button", { name: /Copiar marca e horários/ }).click();
  await page.getByRole("button", { name: "Confirmar cópia" }).click();
  await expect(page.getByText(/copiadas para Unidade Jardins/i)).toBeVisible();
  expect(copyKey.length).toBeGreaterThanOrEqual(8);

  await page.getByRole("button", { name: "Restaurar" }).click();
  await page.getByRole("button", { name: "Restaurar como nova revisão" }).click();
  await expect(page.getByText(/restaurada na revisão/i)).toBeVisible();
});
