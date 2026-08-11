import { expect, test } from "@playwright/test";

async function enterDemoKds(page: import("@playwright/test").Page) {
  await page.goto(test.info().project.use.baseURL ?? "http://127.0.0.1:3212");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await page.evaluate(() => {
    window.location.hash = "/kds";
  });
}

test("KDS exposes redundant priority, SLA, station filters and short undo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemoKds(page);
  await expect(page.getByRole("heading", { name: /fila por estação/i })).toBeVisible();
  await expect(page.getByText("Dispositivo online", { exact: true })).toBeVisible();
  await expect(page.getByText("PRIORIDADE", { exact: true })).toBeVisible();
  await expect(page.getByText(/sla estourado/i)).toBeVisible();

  await page.getByRole("button", { name: /^Bar 1$/ }).click();
  await expect(page.getByText("Mesa 01", { exact: true })).toBeVisible();
  await expect(page.getByText("Mesa 03", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /iniciar preparo/i }).click();
  await expect(page.getByText("Avanço agendado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.getByRole("button", { name: /iniciar preparo/i })).toBeVisible();
});

test("KDS keeps touch actions legible without horizontal overflow on tablet", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterDemoKds(page);
  const action = page.getByRole("button", { name: /marcar pronto/i }).first();
  await expect(action).toBeVisible();
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("KDS visual QA stays operational across desktop, tablet, POS and wall display", async ({
  page,
}) => {
  const layouts = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "pos", width: 1280, height: 800 },
    { name: "kds-wall", width: 1920, height: 1080 },
  ];
  await enterDemoKds(page);
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.waitForTimeout(250);
    await expect(page.getByRole("heading", { name: /fila por estação/i })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      fullPage: true,
      path: test.info().outputPath(`kds-${layout.name}.png`),
    });
  }
});
