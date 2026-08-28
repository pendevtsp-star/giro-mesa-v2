import { expect, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const invitationId = "a1111111-1111-4111-8111-111111111111";

test("admin convida a equipe no backoffice sem overflow em 375 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A largura mobile é validada no próprio cenário.");
  await mockCompatibleApi(page);
  let invited = false;
  await page.route(/\/v1\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
        counts: { organizations: 0, units: 0, activeTrials: 0 },
        health: { pendingJobs: 0, failedJobs: 0, staleHubs: 0, failedIntegrations: 0 },
        trialFunnel: { applications: 0, activations: 0, conversionPercent: 0 },
        recentTrialApplications: [],
        recentContacts: [],
        recentOrganizations: [],
        fiscalIntegrations: [],
        access: {
          role: "admin",
          capabilities: ["tenants:read", "team:manage"],
          mfaEnforced: true,
        },
        sources: [],
      });
    if (path.endsWith("/platform/tenants"))
      return json({ items: [], nextCursor: null, partialSources: [] });
    if (path.endsWith("/platform/incidents"))
      return json({ items: [], nextCursor: null, partialSources: [] });
    if (path.endsWith("/platform/team") && request.method() === "GET")
      return json({
        members: [],
        invitations: invited
          ? [
              {
                id: invitationId,
                email: "dev@giromesa.com.br",
                role: "engineering",
                status: "pending",
                createdAt: "2026-08-27T12:00:00.000Z",
                expiresAt: "2026-09-03T12:00:00.000Z",
              },
            ]
          : [],
      });
    if (path.endsWith("/platform/team/invitations") && request.method() === "POST") {
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.postDataJSON()).toEqual({
        email: "dev@giromesa.com.br",
        role: "engineering",
        reason: "Apoio técnico durante o piloto",
        reauth: { mfaCode: "123456" },
      });
      invited = true;
      return json({ id: invitationId, expiresAt: "2026-09-03T12:00:00.000Z", replayed: false });
    }
    return route.fulfill({ status: 404, json: { code: "UNHANDLED_E2E_ROUTE", path } });
  });

  await page.goto("http://127.0.0.1:3112/#/platform");
  await page.getByRole("button", { name: "Equipe interna" }).click();
  await expect(page.getByRole("heading", { name: "Equipe de desenvolvimento" })).toBeVisible();
  await page.getByLabel("E-mail corporativo").fill("dev@giromesa.com.br");
  await page.getByRole("combobox", { name: "Perfil", exact: true }).selectOption("engineering");
  await page.getByLabel("Motivo auditável").first().fill("Apoio técnico durante o piloto");
  await page.getByLabel("Seu código MFA atual").first().fill("123456");
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByText("Convite enviado. Ele expira em sete dias.")).toBeVisible();
  await expect(page.getByText("dev@giromesa.com.br")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("convidado aceita o acesso ao backoffice com token fora da query string", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "O cenário de aceite é independente do projeto mobile.",
  );
  const token = "a".repeat(43);
  await page.route("http://localhost:3200/v1/platform/invitations/accept", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({ status: 201, json: { role: "engineering", mfaRequired: true } });
  });

  await page.goto(`http://localhost:3110/aceitar-convite#platform=${token}`);
  expect(new URL(page.url()).search).toBe("");
  await page.getByRole("button", { name: "Validar e aceitar convite" }).click();
  await expect(
    page.getByText("Convite aceito. Seu acesso ao backoffice já está disponível."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir backoffice" })).toBeVisible();
});

test("aceite direciona para ativação de MFA sem expor o token na query", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "O cenário é independente do projeto mobile.");
  const token = "b".repeat(43);
  await page.route("http://localhost:3200/v1/platform/invitations/accept", (route) =>
    route.fulfill({
      status: 400,
      json: { code: "PLATFORM_INVITATION_MFA_REQUIRED" },
    }),
  );

  await page.goto(`http://localhost:3110/aceitar-convite#platform=${token}`);
  await page.getByRole("button", { name: "Validar e aceitar convite" }).click();
  const link = page.getByRole("link", { name: "Ativar MFA para continuar" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `/seguranca#returnTo=${encodeURIComponent(`/aceitar-convite#platform=${token}`)}`,
  );
});

test("login local preserva o convite no fragmento e nunca o envia em URL HTTP", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "O cenário é independente do projeto mobile.");
  const token = "c".repeat(43);
  const requestedUrls: string[] = [];
  let acceptCalls = 0;
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.route("http://localhost:3200/v1/platform/invitations/accept", (route) => {
    acceptCalls += 1;
    return route.fulfill(
      acceptCalls === 1
        ? { status: 401, json: { code: "AUTH_REQUIRED" } }
        : { status: 201, json: { role: "engineering", mfaRequired: true } },
    );
  });
  await page.route("http://localhost:3200/v1/auth/login", (route) =>
    route.fulfill({ status: 200, json: { mfaRequired: false } }),
  );

  await page.goto(`http://localhost:3110/aceitar-convite#platform=${token}`);
  await page.getByRole("button", { name: "Validar e aceitar convite" }).click();
  const expectedReturn = `/aceitar-convite#platform=${token}`;
  await expect(page.getByRole("link", { name: "Entrar para continuar" })).toHaveAttribute(
    "href",
    `/login#returnTo=${encodeURIComponent(expectedReturn)}`,
  );
  await expect(page.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
    "href",
    `/criar-conta#returnTo=${encodeURIComponent(expectedReturn)}`,
  );
  await page.getByRole("link", { name: "Entrar para continuar" }).click();
  expect(new URL(page.url()).search).toBe("");
  await page.getByLabel("E-mail").fill("dev@giromesa.com.br");
  await page.locator('input[name="password"]').fill("senha-segura-para-o-piloto");
  await page.getByRole("button", { name: /^Entrar/ }).click();
  await page.getByRole("button", { name: "Validar e aceitar convite" }).click();
  await expect(page.getByRole("button", { name: "Abrir backoffice" })).toBeVisible();
  expect(requestedUrls.some((url) => url.includes(token))).toBe(false);
});
