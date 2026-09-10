import { expect, test } from "@playwright/test";

test("QR acompanha preparo e entrega, recupera rede e preserva alergia em 375 px", async ({
  page,
}, testInfo) => {
  async function expectCenteredDialog(centerVertically = true) {
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 812 });
      const box = await page.getByRole("dialog").boundingBox();
      if (!box) throw new Error("O diálogo deve estar visível");
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(812);
      if (centerVertically) {
        expect(Math.abs(box.y + box.height / 2 - 406)).toBeLessThanOrEqual(1);
      }
    }
  }
  let status = "draft";
  let failed = false;
  let reads = 0;
  const orderId = "00000000-0000-4000-8000-000000000002";
  let submitted: unknown;
  await page.route("http://127.0.0.1:3213/public/v1/menus/teste/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    let code = 200;
    if (path.endsWith("table-session"))
      body = {
        status: "active",
        tableLabel: "Mesa 12",
        activeTab: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    else if (path.endsWith("consumption"))
      body = { status: "open", tableLabel: "Mesa 12", items: [], subtotalCents: 0, totalCents: 0 };
    else if (path.endsWith("order-options"))
      body = {
        fulfillment: { pickup: true, delivery: false },
        deliveryZones: [],
        payment: { method: "pay_on_fulfillment", status: "awaiting_payment", label: "Na retirada" },
      };
    else if (path.includes("table-orders")) {
      if (route.request().method() === "POST") submitted = route.request().postDataJSON();
      else {
        reads++;
        if (failed) code = 503;
      }
      body = {
        orderId,
        status,
        source: "qr_table",
        items: [{ name: "Prato de teste", quantity: 1, totalCents: 2990, allergyNote: "Amendoim" }],
        totalCents: 2990,
      };
    } else code = 404;
    await route.fulfill({
      status: code,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:3113",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify(body ?? {}),
    });
  });
  await page.goto("/m/teste");
  await page.getByRole("button", { name: /Prato de teste/ }).click();
  await expect(page.getByRole("dialog").locator(".product-hero")).toHaveCount(0);
  await expectCenteredDialog();
  for (const label of ["Alguma observação?", "Alergia alimentar"]) {
    const field = page.getByLabel(label);
    await expect(field).toBeVisible();
    expect((await field.boundingBox())?.width).toBeGreaterThan(220);
  }
  await page.getByLabel("Alergia alimentar").fill("Amendoim");
  await page.getByRole("button", { name: /Adicionar.*29,90/ }).click();
  await page.getByRole("button", { name: /Ver seleção/ }).click();
  await expect(page.getByRole("dialog", { name: "Revisar pedido" })).toContainText("Mesa 12");
  await expectCenteredDialog(false);
  await page.getByRole("button", { name: "Solicitar confirmação" }).click();
  await expect(page.getByRole("heading", { name: "Aguardando confirmação" })).toBeVisible();
  expect(submitted).toMatchObject({ items: [{ allergyNote: "Amendoim" }] });
  await expect(page.getByText("Total solicitado", { exact: true })).toBeVisible();
  for (const [next, label] of [
    ["sent", "Pedido confirmado"],
    ["preparing", "Em preparo"],
    ["ready", "Pedido pronto"],
  ] as const) {
    status = next;
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible({
      timeout: 10000,
    });
  }
  failed = true;
  await expect(page.getByText(/Sem atualização no momento/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Pedido pronto", exact: true })).toBeVisible();
  failed = false;
  status = "served";
  await expect(page.getByRole("heading", { name: "Pedido servido", exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText(/Sem atualização no momento/)).toHaveCount(0);
  await expect(page.getByText("Total confirmado", { exact: true })).toBeVisible();
  const terminalReads = reads;
  await page.clock.install();
  await page.clock.fastForward(10000);
  expect(reads).toBe(terminalReads);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`customer-375-${scheme}.png`),
      animations: "disabled",
    });
  }
  await page.clock.resume();
  failed = true;
  await page.reload();
  await expect(page.getByText(/Ainda estamos consultando seu pedido anterior/)).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Acompanhar pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido servido", exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`customer-1440-${scheme}.png`),
      animations: "disabled",
    });
  }
});
