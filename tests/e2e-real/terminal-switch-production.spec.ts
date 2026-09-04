import { expect, test } from "@playwright/test";

const organizationId = "org-terminal";
const unitId = "unit-terminal";

test("terminal compartilhado troca o operador por PIN e volta bloqueado", async ({ page }) => {
  let terminalActive = false;
  let activeMembershipId: string | null = null;

  const operators = [
    {
      membershipId: "membership-waiter",
      identityId: "identity-waiter",
      displayName: "Bruno Lima",
      roles: ["waiter"],
    },
    {
      membershipId: "membership-cashier",
      identityId: "identity-cashier",
      displayName: "Carla Souza",
      roles: ["cashier"],
    },
  ];

  const terminalView = () => ({
    id: "terminal-session-1",
    organization: {
      id: organizationId,
      name: "GiroMesa Terminal",
      document: "12345678000199",
    },
    unit: {
      id: unitId,
      name: "Unidade Centro",
      timezone: "America/Sao_Paulo",
    },
    deviceId: "device-browser-1",
    expiresAt: "2026-08-22T12:00:00.000Z",
    idleTimeoutSeconds: 300,
    actorEpoch: activeMembershipId ? 2 : 1,
    lockedUntil: null,
    operators,
    actor: operators.find((operator) => operator.membershipId === activeMembershipId) ?? null,
  });

  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "terminal-switch-e2e",
        schemaVersion: 77,
        database: "up",
        integrations: {},
        capabilities: [
          "table_qr_lifecycle_v1",
          "table_qr_metrics_v1",
          "table_qr_presence_code_v1",
          "ops_background_notifications_v1",
          "table_qr_brand_upload_v1",
          "ops_web_push_v1",
          "public_menu_cover_image_v1",
          "platform_backoffice_v1",
          "platform_commercial_site_v1",
          "edge_hub_pairing_v1",
        ],
      },
    }),
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/v1/auth/terminal-pin" && method === "PUT") {
      expect(request.postDataJSON()).toEqual({
        membershipId: "membership-owner",
        currentPassword: "senha-atual",
        pin: "654321",
      });
      await route.fulfill({ json: { configured: true } });
      return;
    }
    if (path === "/v1/auth/terminal-session" && method === "GET") {
      await route.fulfill(
        terminalActive
          ? { json: terminalView() }
          : { status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } },
      );
      return;
    }
    if (path === "/v1/auth/terminal-session" && method === "POST") {
      expect(request.postDataJSON()).toEqual({
        organizationId,
        unitId,
        deviceId: expect.any(String),
      });
      terminalActive = true;
      await route.fulfill({ json: terminalView() });
      return;
    }
    if (path === "/v1/auth/terminal-session/unlock" && method === "POST") {
      const body = request.postDataJSON() as { membershipId: string; pin: string };
      expect(body.pin).toBe("123456");
      activeMembershipId = body.membershipId;
      await route.fulfill({ json: terminalView() });
      return;
    }
    if (path === "/v1/auth/terminal-session/lock" && method === "POST") {
      activeMembershipId = null;
      await route.fulfill({ json: terminalView() });
      return;
    }
    if (path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: {
            id: "identity-owner",
            email: "owner@giromesa.test",
            displayName: "Ana Martins",
          },
          memberships: [{ membershipId: "membership-owner", organizationId, status: "active" }],
          platformAdmin: false,
        },
      });
      return;
    }
    if (path === "/v1/organizations") {
      await route.fulfill({
        json: [
          {
            membershipId: "membership-owner",
            organization: {
              id: organizationId,
              tradeName: "GiroMesa Terminal",
              document: "12345678000199",
            },
            units: [
              {
                id: unitId,
                name: "Unidade Centro",
                timezone: "America/Sao_Paulo",
                active: true,
              },
            ],
            scopes: [{ role: "owner", unitId }],
          },
        ],
      });
      return;
    }

    await route.fulfill({ status: 404, json: { code: "NOT_MOCKED" } });
  });

  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { name: "Onde você vai trabalhar?" })).toBeVisible();

  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByRole("button", { name: "Abrir menu do perfil de Ana Martins" }).click();
  await page.getByRole("button", { name: /Meu PIN de terminal/ }).click();
  const pinDialog = page.getByRole("dialog", { name: "Meu PIN de terminal" });
  await pinDialog.getByLabel("Senha atual").fill("senha-atual");
  await pinDialog.getByLabel("Novo PIN de 6 dígitos").fill("654321");
  await pinDialog.getByLabel("Confirme o novo PIN").fill("654320");
  await expect(pinDialog.getByRole("button", { name: "Salvar meu PIN" })).toBeDisabled();
  await pinDialog.getByLabel("Confirme o novo PIN").fill("654321");
  await pinDialog.getByRole("button", { name: "Salvar meu PIN" }).click();
  await expect(pinDialog.getByText(/PIN configurado/)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.evaluate(() => localStorage.removeItem("giromesa_operational_scope_v1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Onde você vai trabalhar?" })).toBeVisible();
  await page.getByRole("checkbox", { name: /terminal compartilhado/i }).check();
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { name: "Quem vai operar agora?" })).toBeVisible();
  await page.getByLabel("Colaborador").selectOption("membership-waiter");
  await page.getByLabel("PIN de 6 dígitos").fill("123456");
  await page.getByRole("button", { name: "Entrar na operação" }).click();

  await page.getByRole("button", { name: "Abrir menu do perfil de Bruno Lima" }).click();
  await expect(page.getByRole("button", { name: "Trocar colaborador" })).toBeVisible();
  await expect(page.locator('a[href="#/people"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Trocar colaborador" }).click();

  await expect(page.getByRole("heading", { name: "Quem vai operar agora?" })).toBeVisible();
  await page.getByLabel("Colaborador").selectOption("membership-cashier");
  await page.getByLabel("PIN de 6 dígitos").fill("123456");
  await page.getByRole("button", { name: "Entrar na operação" }).click();
  await expect(
    page.getByRole("button", { name: "Abrir menu do perfil de Carla Souza" }),
  ).toBeVisible();
});
