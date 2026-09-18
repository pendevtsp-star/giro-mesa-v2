import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { registerInventoryShortageConfirmation } from "./inventory-shortage-confirmation";
import { parsePilotCatalog } from "./operations.shared";

afterEach(() => vi.unstubAllGlobals());

const shortage = () =>
  new Response(
    JSON.stringify({
      code: "INVENTORY_SHORTAGE_CONFIRMATION_REQUIRED",
      products: [{ id: "dish", name: "Prato do dia" }],
    }),
    { status: 409 },
  );

describe("confirmação de estoque no envio", () => {
  it("somente reenvia após confirmação e conserva a chave idempotente", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(shortage())
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn().mockResolvedValue(true);
    const unregister = registerInventoryShortageConfirmation(confirm);
    try {
      await api.pilot.sendOrder("org", "unit", "order", "same-key");
      expect(confirm).toHaveBeenCalledWith({
        organizationId: "org",
        unitId: "unit",
        orderId: "order",
        products: ["Prato do dia"],
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const requests = fetchMock.mock.calls.map((call) => call[1] as RequestInit);
      expect(requests.map((request) => request.headers)).toEqual(
        Array(2).fill({
          accept: "application/json",
          "content-type": "application/json",
          "idempotency-key": "same-key",
        }),
      );
      expect(requests.map((request) => JSON.parse(String(request.body)))).toEqual([
        { acknowledgeInventoryShortage: false },
        { acknowledgeInventoryShortage: true },
      ]);
    } finally {
      unregister();
    }
  });

  it("mantém o pedido sem envio ao voltar ou quando não existe sessão para confirmar", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => shortage());
    vi.stubGlobal("fetch", fetchMock);
    const unregister = registerInventoryShortageConfirmation(async () => false);
    try {
      await expect(api.pilot.sendOrder("org", "unit", "order", "key")).rejects.toMatchObject({
        code: "INVENTORY_SHORTAGE_NOT_CONFIRMED",
        retryable: false,
      });
    } finally {
      unregister();
    }
    await expect(api.pilot.sendOrder("org", "unit", "order", "key-2")).rejects.toMatchObject({
      code: "INVENTORY_SHORTAGE_NOT_CONFIRMED",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não transforma erro de permissão em confirmação de estoque", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 })),
    );
    const confirm = vi.fn();
    const unregister = registerInventoryShortageConfirmation(confirm);
    try {
      await expect(api.pilot.sendOrder("org", "unit", "order", "key")).rejects.toMatchObject({
        status: 403,
      });
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });
});

it("separa saldo físico do limite diário e mantém produto sem ficha disponível", () => {
  const payload = {
    capabilities: { canManage: true },
    categories: [],
    products: [{ id: "beer", categoryId: "drinks", name: "Cerveja", active: true }],
    prices: [{ productId: "beer", priceCents: 1000, costCents: 400 }],
    availability: [{ productId: "beer", available: true, dailyStock: 50, soldToday: 2 }],
    inventoryProducts: [
      { productId: "beer", physicalQuantity: 24, availableQuantity: 21, componentCount: 0 },
    ],
  };
  const product = parsePilotCatalog(payload).products[0];
  expect(product).toMatchObject({
    available: true,
    recipe: [],
    currentStockUnits: 24,
    dailyStockRemaining: 48,
    inventory: { availableQuantity: 21 },
  });
  const waiter = parsePilotCatalog({ ...payload, capabilities: { canManage: false } }).products[0];
  expect(waiter).toMatchObject({
    available: true,
    costCents: null,
    currentStockUnits: null,
    recipe: [],
  });
  expect(waiter?.inventory).toBeUndefined();
  expect(parsePilotCatalog({ ...payload, capabilities: undefined }).canManage).toBe(false);
});
