import { expect, test } from "@playwright/test";

const organizationId = "org-terminal";
const unitId = "unit-terminal";

test("terminal compartilhado troca o operador por PIN e volta bloqueado", async ({ page }) => {
  let terminalActive = false;
  let actorActive = false;

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
    actorEpoch: actorActive ? 2 : 1,
    lockedUntil: null,
    operators: [
      {
        membershipId: "membership-waiter",
        identityId: "identity-waiter",
        displayName: "Bruno Lima",
        roles: ["waiter"],
      },
    ],
    actor: actorActive
      ? {
          membershipId: "membership-waiter",
          identityId: "identity-waiter",
          displayName: "Bruno Lima",
          roles: ["waiter"],
        }
      : null,
  });

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

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
      expect(request.postDataJSON()).toEqual({ membershipId: "membership-waiter", pin: "123456" });
      actorActive = true;
      await route.fulfill({ json: terminalView() });
      return;
    }
    if (path === "/v1/auth/terminal-session/lock" && method === "POST") {
      actorActive = false;
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
  await page.getByRole("checkbox", { name: /terminal compartilhado/i }).check();
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { name: "Quem vai operar agora?" })).toBeVisible();
  await page.getByLabel("PIN de 6 dígitos").fill("123456");
  await page.getByRole("button", { name: "Entrar na operação" }).click();

  await page.getByRole("button", { name: "Abrir menu do perfil de Bruno Lima" }).click();
  await expect(page.getByRole("button", { name: "Trocar colaborador" })).toBeVisible();
  await expect(page.locator('a[href="#/people"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Trocar colaborador" }).click();

  await expect(page.getByRole("heading", { name: "Quem vai operar agora?" })).toBeVisible();
});
