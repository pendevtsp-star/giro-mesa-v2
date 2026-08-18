import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-1";
const unitId = "unit-1";

const initialZone = {
  id: "zone-1",
  organizationId,
  unitId,
  name: "Centro até 5 km",
  feeCents: 700,
  minimumOrderCents: 2_000,
  estimatedDeliveryMinutes: 45,
  geometry: { type: "unit-radius", radiusKm: 5 },
  active: true,
};

const initialOrder = {
  id: "order-1",
  organizationId,
  unitId,
  zoneId: initialZone.id,
  orderRef: "tab-1",
  publicProtocol: "D-100",
  customerName: "Maria Oliveira",
  customerPhone: "11999990000",
  fulfillment: "delivery",
  status: "placed",
  subtotalCents: 4_500,
  deliveryFeeCents: 700,
  totalCents: 5_200,
  paymentMethod: "pay_on_fulfillment",
  paymentStatus: "awaiting_payment",
  address: {
    street: "Rua das Flores",
    number: "42",
    complement: "Apto 12",
    neighborhood: "Vila Mariana",
    city: "São Paulo",
    state: "SP",
    postalCode: "04101000",
    latitude: -23.5891,
    longitude: -46.6342,
  },
  scheduledFor: null,
  promisedAt: "2020-01-01T13:00:00.000Z",
  zoneName: initialZone.name,
  history: [
    {
      id: "history-1",
      fromStatus: null,
      toStatus: "placed",
      occurredAt: "2026-08-16T12:00:00.000Z",
      actorIdentityId: "identity-1",
    },
    {
      id: "history-2",
      fromStatus: "placed",
      toStatus: "confirmed",
      occurredAt: "2026-08-16T12:04:00.000Z",
      actorIdentityId: "identity-1",
    },
  ],
  courierId: null,
  courierReference: null,
  courierStatus: null,
  lastPosition: {
    latitude: -23.5902,
    longitude: -46.6354,
    at: "2026-08-16T12:08:00.000Z",
  },
  notifications: [],
  createdAt: "2026-08-16T12:00:00.000Z",
  updatedAt: "2026-08-16T12:00:00.000Z",
};

const initialCourier = {
  id: "courier-1",
  name: "Carlos Lima",
  reference: "Moto 42",
  phone: "11988887777",
  status: "available",
};

type DeliveryRole = "delivery" | "manager";
type DeliveryCalls = {
  createZone: unknown[];
  updateZone: unknown[];
  transition: unknown[];
  dispatch: unknown[];
  searchQueries: string[];
  createCourier: unknown[];
  assignCourier: unknown[];
  notifications: unknown[];
  addressValidation: unknown[];
};

type DeliveryMockOptions = {
  order?: typeof initialOrder;
  couriers?: Array<typeof initialCourier>;
};

function emptyCalls(): DeliveryCalls {
  return {
    createZone: [],
    updateZone: [],
    transition: [],
    dispatch: [],
    searchQueries: [],
    createCourier: [],
    assignCourier: [],
    notifications: [],
    addressValidation: [],
  };
}

async function mockDeliveryApi(
  page: Page,
  role: DeliveryRole,
  calls: DeliveryCalls,
  options: DeliveryMockOptions = {},
) {
  let zones = [{ ...initialZone }];
  let orders = [{ ...(options.order ?? initialOrder) }];
  let couriers = [...(options.couriers ?? [])];

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "GET" && path.endsWith(`/growth/units/${unitId}/delivery-orders`)) {
      calls.searchQueries.push(url.search);
      await route.fulfill({ json: orders });
      return;
    }
    if (method === "GET" && path.endsWith(`/growth/units/${unitId}/delivery-couriers`)) {
      await route.fulfill({ json: couriers });
      return;
    }
    if (method === "GET" && path.endsWith(`/growth/units/${unitId}/delivery-zones`)) {
      await route.fulfill({ json: zones });
      return;
    }
    if (method === "POST" && path.endsWith("/growth/delivery-zones")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.createZone.push(body);
      const created = {
        ...initialZone,
        id: "zone-2",
        name: String(body.name),
        feeCents: Number(body.feeCents),
        minimumOrderCents: Number(body.minimumOrderCents),
        estimatedDeliveryMinutes: Number(body.estimatedDeliveryMinutes),
        geometry: body.geometry,
        active: body.active !== false,
      };
      zones = [...zones, created];
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (method === "POST" && path.endsWith("/growth/delivery-couriers")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.createCourier.push(body);
      const created = {
        ...initialCourier,
        id: "courier-2",
        name: String(body.name),
        reference: String(body.reference),
        phone: typeof body.phone === "string" ? body.phone : null,
      };
      couriers = [...couriers, created];
      await route.fulfill({ status: 201, json: { duplicate: false, courier: created } });
      return;
    }
    if (method === "PATCH" && /\/growth\/delivery-zones\/[^/]+$/.test(path)) {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.updateZone.push(body);
      const id = path.split("/").at(-1);
      zones = zones.map((zone) => (zone.id === id ? { ...zone, ...body } : zone));
      await route.fulfill({ json: zones.find((zone) => zone.id === id) ?? zones[0] });
      return;
    }
    if (method === "PATCH" && /\/growth\/delivery-orders\/[^/]+\/status$/.test(path)) {
      const body = request.postDataJSON() as { status: string };
      calls.transition.push(body);
      orders = orders.map((order) => ({ ...order, status: body.status }));
      await route.fulfill({ json: orders[0] });
      return;
    }
    if (method === "POST" && /\/growth\/delivery-orders\/[^/]+\/assign$/.test(path)) {
      const body = request.postDataJSON() as { courierId: string; idempotencyKey: string };
      calls.assignCourier.push(body);
      const courier = couriers.find((item) => item.id === body.courierId);
      orders = orders.map((order) => ({
        ...order,
        courierId: body.courierId,
        courierReference: courier?.reference ?? null,
        courierStatus: courier?.status ?? null,
      }));
      await route.fulfill({ json: { duplicate: false, order: orders[0] } });
      return;
    }
    if (method === "POST" && /\/growth\/delivery-orders\/[^/]+\/dispatch$/.test(path)) {
      calls.dispatch.push(request.postDataJSON());
      orders = orders.map((order) => ({ ...order, status: "dispatched" }));
      await route.fulfill({
        status: 201,
        json: { dispatch: { id: "dispatch-1", courierReference: "Moto 42", status: "assigned" } },
      });
      return;
    }
    if (method === "POST" && /\/growth\/delivery-orders\/[^/]+\/notifications$/.test(path)) {
      calls.notifications.push(request.postDataJSON());
      const body = request.postDataJSON() as { audience: string; type: string };
      await route.fulfill({
        status: 201,
        json: {
          duplicate: false,
          notification: {
            id: "notification-1",
            audience: body.audience,
            type: body.type,
            status: "pending_provider",
            createdAt: "2026-08-16T12:09:00.000Z",
          },
        },
      });
      return;
    }
    if (method === "POST" && /\/growth\/delivery-zones\/[^/]+\/validate-address$/.test(path)) {
      const body = request.postDataJSON();
      calls.addressValidation.push(body);
      await route.fulfill({
        status: 400,
        json: {
          code: "DELIVERY_ADDRESS_OUTSIDE_ZONE",
          message: "O endereço está fora da zona de entrega.",
          preview: false,
        },
      });
      return;
    }

    const payload =
      path === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-1",
              email: `${role}@giromesa.test`,
              displayName: role === "manager" ? "Rafael Gerente" : "Diego Delivery",
            },
            memberships: [{ membershipId: "membership-1", organizationId, status: "active" }],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-1",
                organization: {
                  id: organizationId,
                  tradeName: "Grupo Aurora",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Matriz real",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role, unitId }],
              },
            ]
          : null;

    if (payload === null) {
      await route.fulfill({ status: 404, json: { message: `Mock ausente para ${path}` } });
      return;
    }
    await route.fulfill({ json: payload });
  });
}

async function openDelivery(
  page: Page,
  role: DeliveryRole,
  calls: DeliveryCalls,
  options: DeliveryMockOptions = {},
) {
  await mockDeliveryApi(page, role, calls, options);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/delivery";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
}

async function forceRealtimeFallback(page: Page) {
  await page.addInitScript(() => {
    class FailingWebSocket extends EventTarget {
      static readonly CLOSED = 3;
      static readonly CONNECTING = 0;
      static readonly CLOSING = 2;
      static readonly OPEN = 1;
      readonly readyState = FailingWebSocket.CONNECTING;

      constructor() {
        super();
        setTimeout(() => this.dispatchEvent(new Event("error")), 0);
      }

      close() {
        this.dispatchEvent(new Event("close"));
      }

      send() {}
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FailingWebSocket,
      writable: true,
    });
  });
}

async function forceRealtimeEvent(page: Page) {
  await page.addInitScript(() => {
    class EventWebSocket extends EventTarget {
      static readonly CLOSED = 3;
      static readonly CONNECTING = 0;
      static readonly CLOSING = 2;
      static readonly OPEN = 1;
      readyState = EventWebSocket.CONNECTING;

      constructor() {
        super();
        setTimeout(() => {
          this.readyState = EventWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      close() {
        this.readyState = EventWebSocket.CLOSED;
        this.dispatchEvent(new Event("close"));
      }

      send(value: string) {
        const message = JSON.parse(value) as { type?: string };
        if (message.type !== "subscribe") return;
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "subscribed",
                organizationId: "org-1",
                unitId: "unit-1",
              }),
            }),
          );
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                type: "event",
                topic: "growth.delivery_courier_position_changed",
                aggregateType: "delivery_order",
                aggregateId: "order-1",
                createdAt: "2026-08-16T12:08:00.000Z",
                payload: { latitude: -23.5902, longitude: -46.6354 },
              }),
            }),
          );
        }, 10);
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: EventWebSocket,
      writable: true,
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 6)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBe(dimensions.viewport);
}

test("operador visualiza pedidos, abre detalhes e avança uma transição", async ({ page }) => {
  const calls = emptyCalls();
  await openDelivery(page, "delivery", calls);

  const orderButton = page.getByRole("button", { name: "Abrir pedido D-100" }).first();
  await expect(orderButton).toBeVisible();
  await expect(page.getByText("Maria Oliveira").first()).toBeVisible();
  await expect(page.getByText("Sincronizado", { exact: false })).toBeVisible();
  await expect(page.getByText("Atrasado", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /nova zona|configurar zonas|editar zona|desativar/i }),
  ).toHaveCount(0);

  await orderButton.click();
  const details = page.getByRole("dialog");
  await expect(details).toBeVisible();
  await expect(details).toContainText("Rua das Flores");
  await expect(details).toContainText("Vila Mariana");
  await expect(details).toContainText("CEP 04101000");
  await expect(details).toContainText("Prometido para");
  await expect(details).toContainText("Histórico");
  await expect(details).toContainText("placed");
  await expect(details).toContainText("Última posição");
  await details.getByRole("button", { name: "Solicitar atualização operacional" }).click();
  await expect.poll(() => calls.notifications.length).toBe(1);
  expect(calls.notifications[0]).toMatchObject({
    audience: "operations",
    type: "status_update",
    idempotencyKey: expect.any(String),
  });
  await expect(page.getByRole("status").filter({ hasText: "pendente do provedor" })).toBeVisible();

  await details.getByRole("button", { name: "Fechar" }).click();
  await page.getByPlaceholder("Protocolo, cliente ou telefone").fill("Maria");
  await expect
    .poll(() =>
      calls.searchQueries.some((query) => new URLSearchParams(query).get("query") === "Maria"),
    )
    .toBe(true);
  await orderButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page
    .getByRole("dialog")
    .getByRole("button", { name: /confirmar|aceitar|avançar/i })
    .click();
  await expect.poll(() => calls.transition.length).toBe(1);
  expect(calls.transition[0]).toEqual({ status: "confirmed" });
  await expect(details).toBeHidden();
  await expect(page.getByText("Pedido D-100 atualizado.")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("gerente cria, edita e desativa zona de entrega", async ({ page }) => {
  const calls = emptyCalls();
  await openDelivery(page, "manager", calls);

  await expect(page.getByText("Entregadores")).toBeVisible();
  await expect(page.getByText("Nenhum entregador cadastrado nesta unidade.")).toBeVisible();
  await page.getByRole("button", { name: "Cadastrar entregador" }).click();
  await page.getByLabel("Nome").fill("Carlos Lima");
  await page.getByLabel("Referência operacional").fill("Moto 42");
  await page.getByLabel("Telefone (opcional)").fill("11988887777");
  await page.getByRole("button", { name: "Cadastrar entregador" }).last().click();
  await expect.poll(() => calls.createCourier.length).toBe(1);
  expect(calls.createCourier[0]).toMatchObject({
    unitId,
    name: "Carlos Lima",
    reference: "Moto 42",
    phone: "11988887777",
    idempotencyKey: expect.any(String),
  });
  await expect(page.getByText("Carlos Lima · Moto 42")).toBeVisible();

  await page.getByRole("button", { name: "Zonas" }).click();
  await page
    .getByText(/nova zona/i)
    .first()
    .click();
  await page.getByLabel(/região declarada|nome da zona/i).fill("Centro expandido");
  await page.getByLabel(/taxa/i).fill("9,90");
  await page.getByLabel(/pedido mínimo/i).fill("30,00");
  await page.getByLabel(/previsão de entrega/i).fill("55");
  await page.getByRole("button", { name: /criar zona|salvar zona/i }).click();
  await expect.poll(() => calls.createZone.length).toBe(1);
  expect(calls.createZone[0]).toMatchObject({
    name: "Centro expandido",
    feeCents: 990,
    minimumOrderCents: 3_000,
    estimatedDeliveryMinutes: 55,
    active: true,
  });
  expect(calls.createZone[0]).not.toHaveProperty("radiusKm");
  await expect(page.getByText("Centro expandido")).toBeVisible();

  await page
    .getByRole("button", { name: /editar zona|editar/i })
    .last()
    .click();
  await page.getByLabel(/região declarada|nome da zona/i).fill("Centro revisado");
  await page.getByLabel(/previsão de entrega/i).fill("60");
  await page.getByRole("button", { name: /salvar|atualizar/i }).click();
  await expect.poll(() => calls.updateZone.length).toBe(1);
  expect(calls.updateZone[0]).toMatchObject({
    name: "Centro revisado",
    estimatedDeliveryMinutes: 60,
  });
  await expect(page.getByText("Centro revisado")).toBeVisible();
  await expect(page.getByText("60 min", { exact: true })).toBeVisible();

  await page
    .getByRole("button", { name: /desativar|inativar/i })
    .last()
    .click();
  const deactivationDialog = page.getByRole("dialog");
  const deactivationConfirmation = deactivationDialog.getByRole("button", {
    name: /desativar|inativar|confirmar/i,
  });
  if (await deactivationConfirmation.count()) await deactivationConfirmation.click();
  await expect.poll(() => calls.updateZone.length).toBe(2);
  expect(calls.updateZone[1]).toMatchObject({ active: false });

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("Delivery mantém atualização periódica quando o realtime não conecta", async ({ page }) => {
  await forceRealtimeFallback(page);
  await openDelivery(page, "delivery", emptyCalls());
  await expect(
    page.getByRole("button", { name: /Conectividade: Atualização periódica/i }),
  ).toBeVisible();
  await expect(page.getByText("Sincronizado", { exact: false })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("operador atribui entregador e exibe notificação confirmada", async ({ page }) => {
  const calls = emptyCalls();
  await openDelivery(page, "delivery", calls, {
    order: { ...initialOrder, status: "ready", promisedAt: "2099-01-01T13:00:00.000Z" },
    couriers: [initialCourier],
  });

  await page.getByRole("button", { name: "Abrir pedido D-100" }).first().click();
  const details = page.getByRole("dialog");
  await details.getByLabel("Entregador disponível").selectOption(initialCourier.id);
  await details.getByRole("button", { name: "Atribuir e despachar" }).click();

  await expect.poll(() => calls.assignCourier.length).toBe(1);
  expect(calls.assignCourier[0]).toMatchObject({
    courierId: initialCourier.id,
    idempotencyKey: expect.any(String),
  });
  await expect.poll(() => calls.transition.length).toBe(1);
  expect(calls.transition[0]).toEqual({ status: "dispatched" });
  expect(calls.dispatch).toHaveLength(0);
  await expect(
    page.getByRole("status").filter({ hasText: "Pedido D-100 despachado." }),
  ).toBeVisible();
  expect(calls.assignCourier[0]).toMatchObject({
    courierId: initialCourier.id,
    idempotencyKey: expect.any(String),
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("Delivery renderiza evento realtime e rejeita endereço fora da zona", async ({ page }) => {
  const calls = emptyCalls();
  await forceRealtimeEvent(page);
  await openDelivery(page, "delivery", calls);

  const orderButton = page.getByRole("button", { name: "Abrir pedido D-100" }).first();
  await expect(page.getByText("Atualizações recentes")).toBeVisible();
  await expect(page.getByText("Nova posição do entregador")).toBeVisible();
  await orderButton.click();
  await expect(page.getByRole("dialog")).toContainText("Histórico");

  const validation = await page.evaluate(async () => {
    const response = await fetch(
      "/v1/organizations/org-1/growth/delivery-zones/zone-1/validate-address",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          street: "Rua distante",
          number: "900",
          city: "São Paulo",
          state: "SP",
          postalCode: "01001000",
          latitude: -23.5505,
          longitude: -46.6333,
        }),
      },
    );
    return {
      body: (await response.json()) as { preview?: boolean; code?: string },
      status: response.status,
    };
  });
  expect(validation.status === 400 || validation.body.preview === false).toBe(true);
  expect(validation.body.code).toBe("DELIVERY_ADDRESS_OUTSIDE_ZONE");
  expect(calls.addressValidation[0]).toMatchObject({ street: "Rua distante" });

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});
