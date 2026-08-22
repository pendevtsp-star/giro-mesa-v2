import { expect, test } from "@playwright/test";

test("login operacional mantém campos legíveis e associados", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A própria jornada cobre desktop e mobile.");
  await page.route(/\/v1\/auth\/terminal-session$/, (route) =>
    route.fulfill({ status: 401, json: { message: "Terminal ausente" } }),
  );
  await page.route(/\/v1\/auth\/me$/, (route) =>
    route.fulfill({ status: 401, json: { message: "Sessão ausente" } }),
  );
  await page.route(/\/v1\/organizations$/, (route) => route.fulfill({ status: 200, json: [] }));

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3112/");
    await expect(page.getByRole("heading", { name: "Entrar na operação" })).toBeVisible();

    const email = page.getByLabel("E-mail");
    const password = page.getByRole("textbox", { name: "Senha", exact: true });
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(page.locator("label button")).toHaveCount(0);

    const fieldWidth = await email
      .locator("..")
      .evaluate((field) => field.getBoundingClientRect().width);
    const inputWidth = await email.evaluate((input) => input.getBoundingClientRect().width);
    expect(inputWidth).toBeGreaterThanOrEqual(fieldWidth - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`ops-login-${width}.png`), fullPage: true });
  }
});
