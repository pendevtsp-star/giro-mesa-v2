import { expect, test } from "@playwright/test";

for (const mode of ["pickup", "delivery", "table"] as const) {
  test(`${mode}: confirma total atualizado, preserva retry e invalida revisão ao editar`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const requests: { expectedTotalCents: number; key: string; quantity: number }[] = [];
    const orderId = "00000000-0000-4000-8000-000000000002";
    let transportFailure = mode !== "table";
    await page.route("http://127.0.0.1:3213/public/v1/menus/teste/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let body: unknown = {};
      let status = 200;
      if (path.endsWith("table-session")) {
        status = mode === "table" ? 200 : 401;
        body = {
          status: "active",
          tableLabel: "Mesa 12",
          activeTab: true,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
      } else if (path.endsWith("order-options")) {
        body = {
          fulfillment: { pickup: true, delivery: true },
          deliveryZones: [
            { name: "Centro", feeCents: 700, minimumOrderCents: 0, estimatedDeliveryMinutes: 30 },
          ],
          payment: {
            method: "pay_on_fulfillment",
            status: "awaiting_payment",
            label: "Na entrega",
          },
        };
      } else if (path.endsWith("consumption")) {
        body = {
          status: "open",
          tableLabel: "Mesa 12",
          items: [],
          subtotalCents: 0,
          totalCents: 0,
        };
      } else if (request.method() === "POST" && /\/(?:table-orders|orders)$/.test(path)) {
        const input = request.postDataJSON();
        const quantity = input.items[0].quantity;
        requests.push({
          expectedTotalCents: input.expectedTotalCents,
          quantity,
          key: request.headers()["idempotency-key"] ?? "",
        });
        const subtotalCents = quantity * 3_300;
        const deliveryFeeCents = mode === "delivery" ? 900 : 0;
        const totalCents = subtotalCents + deliveryFeeCents;
        if (input.expectedTotalCents !== totalCents) {
          status = 409;
          body = {
            code: "PUBLIC_ORDER_PRICE_CHANGED",
            subtotalCents,
            deliveryFeeCents,
            totalCents,
          };
        } else if (transportFailure) {
          transportFailure = false;
          await route.abort("failed");
          return;
        } else if (mode === "table") {
          body = {
            orderId,
            status: "draft",
            source: "qr_table",
            totalCents,
            items: [{ name: "Prato de teste", quantity, totalCents }],
          };
        } else {
          body = {
            protocol: "GM-20260918-ABCDEF1234",
            status: "placed",
            fulfillment: mode,
            payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
            subtotalCents,
            deliveryFeeCents,
            totalCents,
            addressValidationStatus: "unchecked",
          };
        }
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: {
          "Access-Control-Allow-Origin": "http://localhost:3113",
          "Access-Control-Allow-Credentials": "true",
        },
      });
    });
    await page.goto("/m/teste");
    await page.getByRole("button", { name: /Prato de teste/ }).click();
    await page.getByRole("button", { name: /Adicionar.*29,90/ }).click();
    await page.getByRole("button", { name: /Ver seleção/ }).click();
    const dialog = page.getByRole("dialog", { name: "Revisar pedido" });
    if (mode !== "table") {
      await page.getByLabel("Nome", { exact: true }).fill("Ana Cliente");
      await page.getByLabel("Celular", { exact: true }).fill("11999999999");
      if (mode === "delivery") {
        await page.getByLabel("Entrega própria").check();
        for (const [name, value] of Object.entries({
          street: "Rua Um",
          number: "10",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
          postalCode: "01001000",
        })) {
          await page.locator(`input[name="${name}"]`).fill(value);
        }
      }
      await page.locator('input[name="privacyAccepted"]').check();
    }
    await page
      .getByRole("button", {
        name: mode === "table" ? "Solicitar confirmação" : "Confirmar pedido",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("O pedido ainda não foi enviado");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.expectedTotalCents).toBe(mode === "delivery" ? 3690 : 2990);
    await expect(page.getByRole("button", { name: /Confirmar novo total de/ })).toContainText(
      mode === "delivery" ? "42,00" : "33,00",
    );
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    if (mode === "table") {
      await page.getByRole("button", { name: "Adicionar uma unidade de Prato de teste" }).click();
      await expect(page.getByRole("button", { name: /Confirmar novo total de/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Solicitar confirmação", exact: true }).click();
      await expect(page.getByRole("button", { name: /Confirmar novo total de/ })).toContainText(
        "66,00",
      );
      expect(requests[1]?.expectedTotalCents).toBe(5980);
      expect(requests[1]?.key).not.toBe(requests[0]?.key);
    }
    await page.getByRole("button", { name: /Confirmar novo total de/ }).click();
    if (mode !== "table") {
      await expect(
        dialog.getByRole("alert").filter({ hasText: "O pedido não foi confirmado" }),
      ).toBeVisible();
      await page.getByRole("button", { name: /Confirmar novo total de/ }).click();
      await expect(page.getByRole("heading", { name: "GM-20260918-ABCDEF1234" })).toBeVisible();
      expect(requests).toHaveLength(3);
      expect(requests[1]?.key).not.toBe(requests[0]?.key);
      expect(requests[2]).toEqual(requests[1]);
    } else {
      await expect(page.getByRole("heading", { name: "Aguardando confirmação" })).toBeVisible();
      expect(requests[2]?.expectedTotalCents).toBe(6600);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
