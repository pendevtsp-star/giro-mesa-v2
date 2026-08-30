import { expect, test } from "@playwright/test";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: These Playwright journeys run directly, outside Turbo caching.
const siteUrl = process.env.SITE_E2E_URL ?? "http://localhost:3110";

test("landing communicates the trial and exposes the legal map", async ({ page }) => {
  await page.goto(siteUrl);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".hero-actions .button-primary")).toHaveAttribute(
    "href",
    /^\/criar-conta(?:\?|$)/,
  );
  await expect(page.getByRole("link", { name: /termos/i }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: /privacidade/i }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.locator(".hero-grid--text-only")).toHaveCSS(
    "grid-template-columns",
    /^\d+(\.\d+)?px$/,
  );
  await page.locator(".hero-actions a[href*='#produto']").click();
  await expect(page.locator("#produto")).toBeInViewport();
  await expect
    .poll(() => page.locator("#produto").evaluate((element) => element.getBoundingClientRect().top))
    .toBeCloseTo(92, 0);
  const brokenAnchors = await page.locator('a[href*="#"]').evaluateAll((links) =>
    links
      .map((link) => new URL((link as HTMLAnchorElement).href))
      .filter(
        (url) =>
          url.origin === location.origin &&
          url.pathname === location.pathname &&
          url.hash.length > 1 &&
          !document.getElementById(decodeURIComponent(url.hash.slice(1))),
      )
      .map((url) => url.hash),
  );
  expect(brokenAnchors).toEqual([]);
});

test("login supports password visibility and recovery", async ({ page }) => {
  await page.goto(`${siteUrl}/login`);
  const password = page.getByLabel(/senha/i).first();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: /mostrar senha/i }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("link", { name: /esqueci|minha senha|recuperar/i })).toBeVisible();
});

test("login retoma a sessão confiável ao voltar para a janela", async ({ page }) => {
  let authenticated = false;
  await page.route("http://localhost:3200/v1/auth/me", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": siteUrl,
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(authenticated ? { id: "user-e2e" } : { code: "UNAUTHORIZED" }),
    }),
  );

  await page.goto(`${siteUrl}/login`);
  await expect(page.getByLabel(/senha/i).first()).toBeVisible();
  authenticated = true;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await page.waitForURL("http://127.0.0.1:3112/**");
});

test("email links expose complete reset, invitation and opt-out actions", async ({ page }) => {
  const token = "a".repeat(43);
  await page.goto(`${siteUrl}/recuperar-senha?token=${token}`);
  await expect(page.getByRole("heading", { name: /criar nova senha/i })).toBeVisible();
  await expect(page.getByLabel(/confirmar nova senha/i)).toBeVisible();

  await page.goto(`${siteUrl}/aceitar-convite?token=${token}`);
  await expect(page.getByRole("heading", { name: /aceitar convite/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /validar e aceitar/i })).toBeEnabled();

  await page.goto(`${siteUrl}/cancelar-comunicacoes?token=${token}`);
  await expect(page.getByRole("heading", { name: /cancelar comunicações/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /confirmar cancelamento/i })).toBeEnabled();
});

test("account creation requires legal consent before Google or password signup", async ({
  page,
}) => {
  await page.goto(`${siteUrl}/criar-conta`);
  const google = page.getByRole("button", { name: /criar com google/i });
  await expect(google).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(google).toBeEnabled();
  await expect(page.getByRole("link", { name: /termos/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /política de privacidade/i })).toBeVisible();
});

test("contact form posts consent to the internal commercial API", async ({ page }) => {
  let body: Record<string, unknown> | undefined;
  await page.route("**/public/v1/contact", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": siteUrl,
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
      return;
    }
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": siteUrl },
      body: JSON.stringify({ id: "lead-e2e", createdAt: "2026-08-25T12:00:00.000Z" }),
    });
  });
  await page.goto(`${siteUrl}/contato`);
  await page.getByLabel(/nome completo/i).fill("Maria Silva");
  await page.getByLabel(/whatsapp/i).fill("11999999999");
  await page.getByLabel(/e-mail profissional/i).fill("maria@example.com");
  await page.getByLabel(/como podemos ajudar/i).fill("Quero implantar o GiroMesa.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /enviar mensagem/i }).click();
  await expect(page.getByRole("status")).toContainText(/solicitação recebida/i);
  expect(body?.privacyAccepted).toBe(true);
  expect(body).not.toHaveProperty("consent");
});
