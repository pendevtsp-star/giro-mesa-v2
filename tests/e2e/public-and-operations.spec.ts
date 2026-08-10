import { expect, test } from "@playwright/test";

test("landing communicates the trial and exposes the legal map", async ({ page }) => {
  await page.goto("http://localhost:3110");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /testar 14 dias/i }).first()).toHaveAttribute(
    "href",
    "/teste-gratis",
  );
  await expect(page.getByRole("link", { name: /termos/i }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: /privacidade/i }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("login supports password visibility and recovery", async ({ page }) => {
  await page.goto("http://localhost:3110/login");
  const password = page.getByLabel(/senha/i).first();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: /mostrar senha/i }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("link", { name: /esqueci|minha senha|recuperar/i })).toBeVisible();
});

test("email links expose complete reset, invitation and opt-out actions", async ({ page }) => {
  const token = "a".repeat(43);
  await page.goto(`http://localhost:3110/recuperar-senha?token=${token}`);
  await expect(page.getByRole("heading", { name: /criar nova senha/i })).toBeVisible();
  await expect(page.getByLabel(/confirmar nova senha/i)).toBeVisible();

  await page.goto(`http://localhost:3110/aceitar-convite?token=${token}`);
  await expect(page.getByRole("heading", { name: /aceitar convite/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /validar e aceitar/i })).toBeEnabled();

  await page.goto(`http://localhost:3110/cancelar-comunicacoes?token=${token}`);
  await expect(page.getByRole("heading", { name: /cancelar comunicações/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /confirmar cancelamento/i })).toBeEnabled();
});

test("account creation requires legal consent before Google or password signup", async ({
  page,
}) => {
  await page.goto("http://localhost:3110/criar-conta");
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
          "Access-Control-Allow-Origin": "http://localhost:3110",
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
      headers: { "Access-Control-Allow-Origin": "http://localhost:3110" },
      body: "{}",
    });
  });
  await page.goto("http://localhost:3110/contato");
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

test("public QR remains transparent about demo and provides table actions", async ({ page }) => {
  await page.goto("http://localhost:3111/m/demo");
  await expect(page.getByText(/cardápio com dados demonstrativos/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /cardápio/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /chamar garçom/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /pedir a conta/i })).toBeVisible();
  await page.getByRole("button", { name: /bruschetta da casa/i }).click();
  await page.getByRole("button", { name: /^adicionar/i }).click();
  await page.getByRole("button", { name: /ver seleção/i }).click({ force: true });
  await expect(page.getByRole("heading", { name: /como você quer receber/i })).toBeVisible();
  await expect(page.getByText(/pagamento na retirada/i)).toBeVisible();
  await expect(page.getByText(/não solicitará cartão nem pix/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /demonstrar envio do pedido/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("operational shell enters a role-scoped dashboard", async ({ page }) => {
  await page.goto("http://127.0.0.1:3112");
  await expect(page.getByRole("heading", { name: /entrar na operação/i })).toBeVisible();
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await expect(page.getByRole("heading", { name: /onde você vai trabalhar/i })).toBeVisible();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
