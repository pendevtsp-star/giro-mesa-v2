import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SITE_URL = "http://localhost:3110";
const ISOLATED_LOCAL_LCP_BUDGET_MS = 2_500;

test.describe("landing comercial", () => {
  test("mantém hierarquia direta e carrossel operável por teclado", async ({ page }) => {
    await page.goto(SITE_URL);

    await expect(page.locator(".hero .eyebrow")).toHaveCount(0);
    await expect(page.locator("#produto .section-heading .eyebrow")).toHaveCount(0);
    await expect(page.locator("main .eyebrow")).not.toHaveCount(0);

    const carousel = page.locator('[aria-roledescription="carrossel"]');
    const title = carousel.locator("[data-slide-title]");
    await expect(title).toHaveText("Visão operacional");
    await carousel.getByRole("button", { name: "Próximo slide" }).click();
    await expect(title).toHaveText("Salão");
    await carousel.getByRole("button", { name: "Próximo slide" }).focus();
    await carousel.getByRole("button", { name: "Próximo slide" }).press("ArrowLeft");
    await expect(title).toHaveText("Visão operacional");

    const pause = carousel.getByRole("button", { name: "Pausar carrossel" });
    await pause.click();
    await expect(carousel.getByRole("button", { name: "Retomar carrossel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("movimento reduzido bloqueia autoplay sem bloquear navegação manual", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SITE_URL);

    const carousel = page.locator('[aria-roledescription="carrossel"]');
    await expect(
      carousel.getByRole("button", { name: "Avanço automático desativado pelo sistema" }),
    ).toBeDisabled();
    await expect(carousel).toContainText("Movimento reduzido");
    await carousel.getByRole("button", { name: "Próximo slide" }).click();
    await expect(carousel.locator("[data-slide-title]")).toHaveText("Salão");
  });

  test("preserva canais de WhatsApp e e-mail sem inventar configuração", async ({ page }) => {
    await page.goto(SITE_URL);

    await expect(page.locator("a.whatsapp")).toBeVisible();
    const email = page.getByRole("link", { name: /contato por e-mail|@/i });
    await expect(email).toBeVisible();
    expect(await email.getAttribute("href")).toMatch(/^(?:mailto:|\/contato$)/);
  });

  test("não introduz violações axe sérias na landing", async ({ page }) => {
    await page.goto(SITE_URL);
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.filter(({ impact }) => impact === "serious" || impact === "critical"),
    ).toEqual([]);
  });

  test("precarrega a imagem principal e respeita o budget local de LCP", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.config.workers > 1, "A medição de LCP exige worker isolado.");
    await page.goto(SITE_URL);
    await page.addInitScript(() => {
      const state = window as typeof window & { __giromesaLcp?: number };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.__giromesaLcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.reload();

    await expect(page.locator('link[rel="preload"][as="image"]')).not.toHaveCount(0);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as typeof window & { __giromesaLcp?: number }).__giromesaLcp ?? 0,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
    const lcp = await page.evaluate(
      () => (window as typeof window & { __giromesaLcp?: number }).__giromesaLcp ?? Infinity,
    );
    expect(lcp).toBeLessThan(ISOLATED_LOCAL_LCP_BUDGET_MS);
  });
});
