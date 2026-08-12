import { expect, test } from "@playwright/test";

const apps = [
  { name: "Site", origin: "http://localhost:3110" },
  { name: "Customer", origin: "http://localhost:3111" },
  { name: "Ops", origin: "http://127.0.0.1:3112" },
] as const;

for (const app of apps) {
  test(`${app.name} publica manifest e service worker versionados`, async ({ page, request }) => {
    await page.goto(app.origin);
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();

    const manifest = await request.get(new URL(manifestHref ?? "", app.origin).toString());
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).icons.length).toBeGreaterThanOrEqual(2);

    const worker = await request.get(`${app.origin}/sw.js`);
    expect(worker.ok()).toBe(true);
    expect(worker.headers()["cache-control"]).toContain("no-store");
  });
}

test("Ops limita no-store aos artefatos de atualização", async ({ request }) => {
  const document = await request.get("http://127.0.0.1:3112/");
  expect(document.ok()).toBe(true);
  expect(document.headers()["cache-control"] ?? "").not.toContain("no-store");
});

test("as três camadas anunciam perda e retorno de conectividade", async ({ page }) => {
  for (const origin of apps.map((app) => app.origin)) {
    await page.goto(origin);
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.dispatchEvent(new Event("offline"));
          return (
            document.querySelector('[role="status"][aria-label*="Conectividade"]')?.textContent ??
            ""
          );
        }),
      )
      .toMatch(/offline/i);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
});
