import { expect, test } from "@playwright/test";

test("recupera o desafio após reload e confirma presença somente com o cookie", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  const confirmations: { body: unknown; tableToken: string | undefined; cookie: string }[] = [];
  let confirmed = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.addCookies([
    {
      name: "giromesa_table_session",
      value: "controlled-unbound-session",
      url: "http://127.0.0.1:3213",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.route("http://127.0.0.1:3213/public/v1/menus/teste/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let status = 200;
    let body: unknown = {};
    if (path.endsWith("table-session")) {
      if (request.method() === "POST") {
        const headers = await request.allHeaders();
        confirmations.push({
          body: request.postDataJSON(),
          tableToken: headers["x-giromesa-table-token"],
          cookie: headers.cookie ?? "",
        });
        confirmed = true;
      }
      status = confirmed ? 200 : 403;
      body = confirmed
        ? {
            status: "active",
            tableLabel: "Mesa 12",
            activeTab: true,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          }
        : {
            code: "PUBLIC_TABLE_PRESENCE_CODE_REQUIRED",
            message: "Solicite à equipe o código da comanda atual.",
            tableLabel: "Mesa 12",
          };
    } else if (path.endsWith("consumption")) {
      body = {
        status: "open",
        tableLabel: "Mesa 12",
        items: [],
        subtotalCents: 0,
        totalCents: 0,
      };
    } else if (path.endsWith("order-options")) {
      body = {
        fulfillment: { pickup: true, delivery: false },
        deliveryZones: [],
        payment: {
          method: "pay_on_fulfillment",
          status: "awaiting_payment",
          label: "Na retirada",
        },
      };
    }
    await route.fulfill({
      status,
      json: body,
      headers: {
        "Access-Control-Allow-Origin": "http://127.0.0.1:3113",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  });

  await page.goto("/m/teste");
  await expect(page.getByLabel("Código de presença")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Código de presença")).toBeVisible();
  await page.getByLabel("Código de presença").fill("123456");
  await page.getByRole("button", { name: "Confirmar presença", exact: true }).click();

  await expect(page.getByText("Comanda ativa", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver consumo", exact: true })).toBeEnabled();
  expect(confirmations).toEqual([
    {
      body: { presenceCode: "123456" },
      tableToken: undefined,
      cookie: expect.stringContaining("giromesa_table_session=controlled-unbound-session"),
    },
  ]);
  expect(pageErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
