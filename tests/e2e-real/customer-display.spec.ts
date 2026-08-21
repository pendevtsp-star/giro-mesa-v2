import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const tabId = "33333333-3333-4333-8333-333333333333";

test("visor do cliente acompanha a conta sem expor a operação", async ({ page }) => {
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const payload =
      pathname === "/v1/auth/me"
        ? {
            identity: {
              id: "44444444-4444-4444-8444-444444444444",
              email: "caixa@giromesa.test",
              displayName: "Caixa",
            },
            memberships: [
              {
                membershipId: "55555555-5555-4555-8555-555555555555",
                organizationId,
                status: "active",
              },
            ],
            platformAdmin: false,
          }
        : pathname === "/v1/organizations"
          ? [
              {
                membershipId: "55555555-5555-4555-8555-555555555555",
                organization: {
                  id: organizationId,
                  tradeName: "GiroMesa Centro",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Unidade Centro",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: "cashier", unitId }],
              },
            ]
          : pathname.endsWith(`/tabs/${tabId}`)
            ? {
                tab: {
                  id: tabId,
                  tableId: null,
                  operationalShiftId: null,
                  shiftSectionId: null,
                  label: "Comanda 42",
                  displayNumber: 42,
                  fulfillmentType: "pickup",
                  customerName: "Ana",
                  customerPhone: "(00) 00000-0000",
                  readyNotificationConsent: false,
                  serviceNotes: "não deve aparecer",
                  deliveryAddress: null,
                  promisedAt: null,
                  readyNotifiedAt: null,
                  responsibleIdentityId: null,
                  guestCount: 1,
                  version: 2,
                  status: "open",
                  serviceChargeBasisPoints: 0,
                  tipCents: 0,
                  subtotalCents: 9300,
                  discountCents: 0,
                  serviceChargeCents: 0,
                  totalCents: 9300,
                },
                orders: [],
                items: [
                  {
                    id: "66666666-6666-4666-8666-666666666666",
                    orderId: "77777777-7777-4777-8777-777777777777",
                    orderStatus: "preparing",
                    productName: "Salada Giro",
                    quantity: 1,
                    grossCents: 2900,
                    discountCents: 0,
                    netCents: 2900,
                    status: "sent",
                    seatNumber: null,
                    course: "main",
                    allergyNote: null,
                    notes: null,
                  },
                  {
                    id: "88888888-8888-4888-8888-888888888888",
                    orderId: "77777777-7777-4777-8777-777777777777",
                    orderStatus: "ready",
                    productName: "Croquete de Costela",
                    quantity: 2,
                    grossCents: 6400,
                    discountCents: 0,
                    netCents: 6400,
                    status: "sent",
                    seatNumber: null,
                    course: "starter",
                    allergyNote: null,
                    notes: null,
                  },
                ],
                payments: [
                  {
                    id: "99999999-9999-4999-8999-999999999999",
                    method: "pix",
                    amountCents: 1900,
                    reference: "referencia-interna",
                    createdAt: "2026-08-20T20:00:00.000Z",
                  },
                ],
                events: [],
                presence: [],
              }
            : pathname.includes("/terminal-profiles/")
              ? null
              : pathname.endsWith("/people/capabilities")
                ? { canView: true }
                : [];

    await route.fulfill({ json: payload });
  });

  await page.goto(`/#/counter?display=${tabId}`);
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Comanda 42" })).toBeVisible();
  await expect(page.getByText("Salada Giro")).toBeVisible();
  await expect(page.getByText("R$ 74,00")).toBeVisible();
  await expect(page.getByText("referencia-interna")).toHaveCount(0);
  await expect(page.getByText("não deve aparecer")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(0);

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
