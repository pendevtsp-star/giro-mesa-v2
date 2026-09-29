// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: fixture runs directly against an explicit local QA runtime
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiUrl = (process.env.COUNTER_LIVE_API_URL ?? "http://127.0.0.1:3218").replace(/\/$/, "");
const internalApiKey = process.env.COUNTER_LIVE_INTERNAL_API_KEY;
if (!internalApiKey)
  throw new Error("Defina COUNTER_LIVE_INTERNAL_API_KEY para ativar o trial da fixture.");

let cookie = "";
function idempotencyHeaders() {
  return { "idempotency-key": randomUUID() };
}
async function request(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0] ?? "";
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return payload;
}
function entityId(payload, key) {
  const id = payload?.[key]?.id ?? payload?.id;
  if (typeof id !== "string") throw new Error(`Resposta sem ${key}.id`);
  return id;
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `counter-live-${suffix}@example.test`;
const password = `CounterQa-${randomUUID()}!`;
const registered = await request("/v1/auth/register", {
  method: "POST",
  body: { email, name: "Operador QA Balcão", password, termsAccepted: true },
});
const organization = await request("/v1/organizations", {
  method: "POST",
  body: {
    legalName: `Balcão QA ${suffix}`,
    tradeName: "Balcão QA",
    document: String(Date.now()).padStart(14, "0").slice(-14),
    unitName: "Unidade QA Balcão",
    timezone: "America/Sao_Paulo",
  },
});
const organizationId = entityId(organization, "organization");
const unitId = entityId(organization, "unit");
const pilot = `/v1/organizations/${organizationId}/units/${unitId}/pilot`;
const catalog = `${pilot}/catalog`;
const management = `/v1/organizations/${organizationId}/units/${unitId}/management`;
const growth = `/v1/organizations/${organizationId}/growth`;

await request(`/internal/v1/organizations/${organizationId}/billing/events`, {
  method: "POST",
  headers: { "x-internal-api-key": internalApiKey },
  body: { event: "ACTIVATE_TRIAL" },
});
let floor = await request(`${pilot}/floor`);
const room = await request(`${pilot}/rooms`, {
  method: "POST",
  body: { name: "Área QA Balcão", sortOrder: 0, expectedRevision: floor.floorRevision },
});
floor = await request(`${pilot}/floor`);
await request(`${pilot}/rooms/${entityId(room, "room")}/tables/batch`, {
  method: "POST",
  body: {
    expectedRevision: floor.floorRevision,
    tables: [
      {
        label: "Mesa QA",
        seats: 4,
        width: 122,
        height: 76,
        rotation: 0,
        shape: "rectangle",
      },
    ],
  },
});
floor = await request(`${pilot}/floor`);
await request(`${pilot}/service-sections`, {
  method: "POST",
  body: {
    name: "Praça QA Balcão",
    color: "#176B4D",
    serviceMode: "quick_service",
    tableIds: floor.tables.map((table) => table.id),
    defaultResponsibleIdentityId: registered.identity.id,
  },
});
await request(`${pilot}/shifts/open`, {
  method: "POST",
  body: { label: "Turno QA Balcão", serviceMode: "quick_service", copyPreviousAssignments: true },
});

const cashRegister = await request(`${management}/cash-registers`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: { name: "Caixa QA" },
});
const cashRegisterId = entityId(cashRegister, "cashRegister");
await request(`${management}/cash-shifts`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: { openingCents: 10_000, cashRegisterId },
});

const station = await request(`${catalog}/stations`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: { name: "KDS QA", code: `kds-${suffix}`.slice(0, 40) },
});
const category = await request(`${catalog}/categories`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: { name: "QA", slug: `qa-${suffix}`.slice(0, 80), sortOrder: 0 },
});
const product = await request(`${catalog}/products`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: {
    categoryId: entityId(category, "category"),
    productType: "prepared",
    name: "Item QA Balcão",
    priceCents: 1_500,
    available: true,
    stationIds: [entityId(station, "station")],
    allergenIds: [],
    modifierGroupIds: [],
    recipe: [],
  },
});
const productId = entityId(product, "product");

const zone = await request(`${growth}/delivery-zones`, {
  method: "POST",
  body: {
    unitId,
    name: "Zona QA",
    feeCents: 700,
    minimumOrderCents: 1_000,
    estimatedDeliveryMinutes: 35,
    geometry: { type: "Polygon", coordinates: [] },
    active: true,
  },
});
const zoneId = entityId(zone, "zone");
const couriers = await Promise.all(
  ["Moto QA 01", "Moto QA 02"].map((name, index) =>
    request(`${growth}/delivery-couriers`, {
      method: "POST",
      body: {
        unitId,
        name,
        reference: `QA-MOTO-${index + 1}`,
        phone: `+55119999900${index + 1}`,
        idempotencyKey: randomUUID(),
      },
    }),
  ),
);

const customer = await request(`${growth}/operational-customers`, {
  method: "POST",
  body: {
    unitId,
    name: "Cliente QA Delivery",
    phone: "+5511988880000",
    defaultDeliveryAddress: {
      street: "Rua QA",
      number: "10",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      postalCode: "01001-000",
      reference: "Portão QA",
    },
    idempotencyKey: randomUUID(),
  },
});
const customerId = entityId(customer, "customer");

async function openOrderTab(body) {
  const opened = await request(`${pilot}/tabs/open`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body,
  });
  const tabId = entityId(opened, "tab");
  const order = await request(`${pilot}/tabs/${tabId}/orders`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body: { items: [{ productId, quantity: 1, modifierOptionIds: [] }] },
  });
  return { tabId, orderId: entityId(order, "order") };
}

async function prepareAndReadyKds(orderId) {
  const snapshot = await request(
    `${pilot}/kds?stationId=${encodeURIComponent(entityId(station, "station"))}`,
  );
  const tickets = snapshot?.tickets?.filter((ticket) => ticket.order?.id === orderId) ?? [];
  if (tickets.length === 0)
    throw new Error(`Nenhum ticket KDS foi gerado para o pedido ${orderId}.`);
  for (const ticket of tickets) {
    if (ticket.status === "pending") {
      await request(`${pilot}/kds/${ticket.id}/state`, {
        method: "POST",
        headers: idempotencyHeaders(),
        body: { state: "preparing" },
      });
    }
    const current = ticket.status === "pending" ? "preparing" : ticket.status;
    if (current === "preparing") {
      await request(`${pilot}/kds/${ticket.id}/state`, {
        method: "POST",
        headers: idempotencyHeaders(),
        body: { state: "ready" },
      });
    }
  }
}

const pickup = await openOrderTab({
  label: "Retirada QA",
  fulfillmentType: "pickup",
  customerName: "Cliente Retirada QA",
  customerPhone: "+5511977770000",
  guestCount: 1,
});
const pickupDelivery = await request(`${growth}/delivery-orders`, {
  method: "POST",
  body: { unitId, orderRef: pickup.tabId, fulfillment: "pickup", idempotencyKey: randomUUID() },
});
const pickupDeliveryId = entityId(pickupDelivery, "order");
await request(`${pilot}/orders/${pickup.orderId}/send`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: {},
});
await prepareAndReadyKds(pickup.orderId);
const address = {
  street: "Rua QA",
  number: "10",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  postalCode: "01001-000",
  reference: "Portão QA",
};
const deliveryTab = await openOrderTab({
  label: "Delivery QA",
  fulfillmentType: "delivery",
  customerId,
  customerName: "Cliente QA Delivery",
  customerPhone: "+5511988880000",
  deliveryAddress: "Rua QA, 10 · Centro · São Paulo/SP",
  deliveryAddressDetails: address,
  deliveryZoneId: zoneId,
  guestCount: 1,
});
const delivery = await request(`${growth}/delivery-orders`, {
  method: "POST",
  body: {
    unitId,
    orderRef: deliveryTab.tabId,
    zoneId,
    fulfillment: "delivery",
    address,
    idempotencyKey: randomUUID(),
  },
});
const deliveryId = entityId(delivery, "order");
await request(`${pilot}/orders/${deliveryTab.orderId}/send`, {
  method: "POST",
  headers: idempotencyHeaders(),
  body: {},
});
await prepareAndReadyKds(deliveryTab.orderId);
const deliveryLookup = await request(
  `${growth}/units/${unitId}/delivery-orders?orderRef=${encodeURIComponent(deliveryTab.tabId)}&limit=1`,
);
if (!Array.isArray(deliveryLookup) || deliveryLookup[0]?.id !== deliveryId)
  throw new Error("A entrega criada não foi recuperada pela comanda.");

async function transitionDelivery(orderId, status) {
  return request(`${growth}/delivery-orders/${orderId}/status`, {
    method: "PATCH",
    body: { status },
  });
}
// The KDS transitions above already advance the delivery projection to ready.
await transitionDelivery(pickupDeliveryId, "completed");

const courierId = entityId(couriers[0], "courier");
await request(`${growth}/delivery-orders/${deliveryId}/assign`, {
  method: "POST",
  body: { courierId, idempotencyKey: randomUUID() },
});
await request(`${growth}/delivery-orders/${deliveryId}/dispatch`, {
  method: "POST",
  body: {
    courierReference: "QA-MOTO-1",
    coverageOverrideReason: "Cobertura QA confirmada no endereço.",
    idempotencyKey: randomUUID(),
  },
});
await transitionDelivery(deliveryId, "completed");

const [pickupDetail, deliveryDetail] = await Promise.all([
  request(`${pilot}/tabs/${pickup.tabId}`),
  request(`${pilot}/tabs/${deliveryTab.tabId}`),
]);
if (deliveryDetail.tab?.deliveryFeeCents !== 700 || deliveryDetail.tab?.totalCents !== 2_200)
  throw new Error("A taxa de entrega não foi incluída no total da comanda.");
if (deliveryDetail.tab?.deliveryAddressDetails?.reference !== "Portão QA")
  throw new Error("O endereço estruturado não chegou ao snapshot de recibo da comanda.");
await Promise.all([
  request(`${pilot}/tabs/${pickup.tabId}/payments`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body: { method: "cash", amountCents: pickupDetail.tab.totalCents, cashRegisterId },
  }),
  request(`${pilot}/tabs/${deliveryTab.tabId}/payments`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body: { method: "cash", amountCents: deliveryDetail.tab.totalCents, cashRegisterId },
  }),
]);
await Promise.all([
  request(`${pilot}/tabs/${pickup.tabId}/close`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body: { printRequested: false },
  }),
  request(`${pilot}/tabs/${deliveryTab.tabId}/close`, {
    method: "POST",
    headers: idempotencyHeaders(),
    body: { printRequested: false },
  }),
]);
const browserDelivery = await openOrderTab({
  label: "Delivery QA navegador",
  fulfillmentType: "delivery",
  customerId,
  customerName: "Cliente QA Delivery",
  customerPhone: "+5511988880000",
  deliveryAddress: "Rua QA, 10 · Centro · São Paulo/SP",
  deliveryAddressDetails: address,
  deliveryZoneId: zoneId,
  guestCount: 1,
});

const fixturePath = join(tmpdir(), `giromesa-counter-live-${suffix}.json`);
await writeFile(
  fixturePath,
  JSON.stringify(
    {
      apiUrl,
      email,
      password,
      identityId: registered.identity.id,
      organizationId,
      unitId,
      cashRegisterId,
      stationId: entityId(station, "station"),
      productId,
      zoneId,
      courierIds: couriers.map((courier) => entityId(courier, "courier")),
      customerId,
      pickupTabId: pickup.tabId,
      deliveryTabId: deliveryTab.tabId,
      deliveryId,
      browserDeliveryTabId: browserDelivery.tabId,
    },
    null,
    2,
  ),
  "utf8",
);
console.log(`Fixture QA criada em ${fixturePath}`);
