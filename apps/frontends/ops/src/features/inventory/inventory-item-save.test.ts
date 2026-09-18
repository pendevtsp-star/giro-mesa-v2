import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import type { ProductReturnableConfiguration } from "../../management.shared";
import {
  type InventoryItemSaveState,
  replaceInventoryReturnableMapping,
  saveInventoryItem,
} from "./inventory-item-save";

const configurations: ProductReturnableConfiguration[] = [
  {
    id: "a",
    productId: "beer",
    containerInventoryItemId: "bottle-a",
    quantityPerUnit: 1,
    depositCents: 200,
    active: true,
  },
  {
    id: "crate",
    productId: "beer",
    containerInventoryItemId: "crate",
    quantityPerUnit: 0.05,
    depositCents: 500,
    active: true,
  },
  {
    id: "other",
    productId: "soda",
    containerInventoryItemId: "soda-bottle",
    quantityPerUnit: 1,
    depositCents: 100,
    active: true,
  },
  {
    id: "inactive",
    productId: "beer",
    containerInventoryItemId: "old-bottle",
    quantityPerUnit: 1,
    depositCents: 100,
    active: false,
  },
];
const next = { containerInventoryItemId: "bottle-b", quantityPerUnit: "1", depositCents: 300 };

afterEach(() => vi.restoreAllMocks());

describe("salvar revenda com vasilhame", () => {
  it("substitui o vasilhame principal e preserva apenas os demais vínculos ativos do produto", () => {
    expect(replaceInventoryReturnableMapping(configurations, "beer", "bottle-a", next)).toEqual({
      status: "returnable",
      mappings: [
        { containerInventoryItemId: "crate", quantityPerUnit: "0.05", depositCents: 500 },
        next,
      ],
    });
    expect(
      replaceInventoryReturnableMapping(configurations, "beer", "bottle-a", null).mappings,
    ).toEqual([{ containerInventoryItemId: "crate", quantityPerUnit: "0.05", depositCents: 500 }]);
    expect(replaceInventoryReturnableMapping(configurations, "soda", "soda-bottle", null)).toEqual({
      status: "non_returnable",
      mappings: [],
    });
  });

  it("mantém o ID salvo e conclui um retry sem criar outro item após falha do vínculo", async () => {
    vi.spyOn(api.management, "returnables").mockResolvedValue({ configurations: [] });
    const create = vi
      .spyOn(api.management, "createInventoryItem")
      .mockResolvedValue({ id: "stock-1" });
    const update = vi
      .spyOn(api.management, "updateInventoryItem")
      .mockResolvedValue({ id: "stock-1" });
    const configure = vi
      .spyOn(api.management, "configureReturnableProduct")
      .mockRejectedValueOnce(new Error("Conexão interrompida."))
      .mockResolvedValue({});
    const state: InventoryItemSaveState = {
      itemId: null,
      productId: null,
      containerId: null,
      createKey: "create-one",
    };
    const scope = { organizationId: "org", unitId: "unit" };
    const body = {
      kind: "resale",
      name: "Cerveja",
      productId: "beer",
      returnableContainerItemId: "bottle-b",
      returnableQuantityPerUnit: "1",
      returnableDepositCents: 300,
    };

    await expect(saveInventoryItem(scope, body, state)).rejects.toThrow(
      "O item de estoque foi salvo",
    );
    expect(state.itemId).toBe("stock-1");
    await saveInventoryItem(scope, body, state);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("org", "unit", "stock-1", {
      kind: "resale",
      name: "Cerveja",
      productId: "beer",
    });
    expect(configure).toHaveBeenLastCalledWith("org", "unit", "beer", {
      status: "returnable",
      mappings: [next],
    });
    expect(state.containerId).toBe("bottle-b");
  });
});
