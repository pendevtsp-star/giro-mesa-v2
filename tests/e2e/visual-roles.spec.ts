import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

type DemoProfile = "owner" | "manager" | "cashier" | "waiter" | "kitchen";

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function openProfile(page: Page, profile: DemoProfile) {
  await page.goto("http://127.0.0.1:3112");
  await page.getByLabel(/perfil demonstrativo/i).selectOption(profile);
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-profile", profile);
}

async function expectAccessibleRoleSurface(page: Page) {
  const panel = page.getByRole("region", { name: /contexto do perfil/i });
  await expect(panel).toBeVisible();
  const primaryAction = panel.getByRole("link");
  if ((await primaryAction.count()) > 0) {
    await expect(primaryAction).toHaveAttribute("href", /^#\//);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await waitForStableLayout(page);
}

test.describe("@visual-role desktop owner", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test("prioriza supervisão e ícones reais", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await openProfile(page, "owner");
    await expect(page.locator("nav svg").first()).toBeVisible();
    await expectAccessibleRoleSurface(page);
    await page.screenshot({ path: testInfo.outputPath("owner-desktop.png"), fullPage: true });
  });
});

test.describe("@visual-role tablet manager", () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 1366 } });
  test("mantém a gestão legível com navegação recolhida", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await openProfile(page, "manager");
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.locator("nav svg").first()).toBeVisible();
    await page
      .getByRole("button", { name: /fechar menu/i })
      .first()
      .click();
    await expectAccessibleRoleSurface(page);
    await page.screenshot({ path: testInfo.outputPath("manager-tablet.png"), fullPage: true });
  });
});

test.describe("@visual-role POS cashier", () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });
  test("mantém recebimentos acionáveis em tela de terminal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await openProfile(page, "cashier");
    await expectAccessibleRoleSurface(page);
    await page.screenshot({ path: testInfo.outputPath("cashier-pos.png"), fullPage: true });
  });
});

test.describe("@visual-role mobile waiter", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
  test("mantém mesas e chamados acessíveis sem overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await openProfile(page, "waiter");
    await expectAccessibleRoleSurface(page);
    await page.screenshot({ path: testInfo.outputPath("waiter-mobile.png"), fullPage: true });
  });
});

test.describe("@visual-role KDS", () => {
  test.use({ hasTouch: true, viewport: { width: 1440, height: 900 } });
  test("abre a fila de produção com densidade e sem pseudo-ícones", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop");
    await openProfile(page, "kitchen");
    await page
      .getByRole("region", { name: /contexto do perfil/i })
      .getByRole("link")
      .click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-route", "kds");
    await expect(page.getByRole("heading", { name: "Produção", level: 1 })).toBeVisible();
    await expectAccessibleRoleSurface(page);
    await page.screenshot({ path: testInfo.outputPath("kitchen-kds.png"), fullPage: true });
  });
});
