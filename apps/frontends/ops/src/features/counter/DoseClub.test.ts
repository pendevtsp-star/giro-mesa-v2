import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import {
  type DraftCartItem,
  draftItemsToOrderItems,
  incrementDraftItem,
  parseDoseClubMemberships,
  parseStoredCart,
} from "./CounterWorkspace";

const membershipResponse = {
  memberships: [
    {
      externalClubId: "club-1",
      status: "active",
      offer: {
        externalOfferId: "offer-1",
        name: "Seleção da casa",
        type: "combo_pool",
      },
      remainingDoses: 8,
      reservedDoses: 2,
      availableDoses: 6,
      doseMl: 30,
      eligibleProducts: [{ externalProductId: "product-1", name: "Whisky A", brand: "Marca A" }],
    },
  ],
};

const clubSnapshot: NonNullable<DraftCartItem["doseClubSnapshot"]> = {
  externalOfferId: "offer-1",
  offerName: "Seleção da casa",
  offerType: "combo_pool",
  externalProductId: "product-1",
  availableDoses: 3,
  doseMl: 30,
};

const clubItem: DraftCartItem = {
  id: "draft-1",
  productId: "product-1",
  name: "Whisky A",
  quantity: 2,
  modifierOptionIds: [],
  course: "anytime",
  doseClub: { externalClubId: "club-1" },
  doseClubSnapshot: clubSnapshot,
};

afterEach(() => vi.unstubAllGlobals());

describe("consumo operacional Dose Club", () => {
  it("valida a projeção de memberships antes de exibi-la", () => {
    expect(parseDoseClubMemberships(membershipResponse)).toEqual(membershipResponse.memberships);
    expect(() =>
      parseDoseClubMemberships({
        memberships: [{ ...membershipResponse.memberships[0], availableDoses: -1 }],
      }),
    ).toThrow("formato inesperado");
  });

  it("restaura somente snapshots completos e respeita o saldo agregado", () => {
    const secondItem = {
      ...clubItem,
      id: "draft-2",
      productId: "product-2",
      name: "Whisky B",
      quantity: 2,
      doseClubSnapshot: {
        ...clubSnapshot,
        externalProductId: "product-2",
      },
    };
    expect(parseStoredCart(JSON.stringify([clubItem]))).toEqual([clubItem]);
    expect(parseStoredCart(JSON.stringify([clubItem, secondItem]))).toEqual([clubItem]);
    expect(parseStoredCart(JSON.stringify([{ ...clubItem, doseClubSnapshot: undefined }]))).toEqual(
      [],
    );
  });

  it("limita o stepper pelo snapshot e remove metadados visuais do envio", () => {
    const items = [
      clubItem,
      {
        ...clubItem,
        id: "draft-2",
        productId: "product-2",
        name: "Whisky B",
        quantity: 1,
        doseClubSnapshot: {
          ...clubSnapshot,
          externalProductId: "product-2",
        },
      },
    ];
    expect(incrementDraftItem(items, clubItem.id)).toBe(items);
    const [submitted] = draftItemsToOrderItems([clubItem]);
    expect(submitted).toEqual({
      productId: "product-1",
      quantity: 2,
      modifierOptionIds: [],
      course: "anytime",
      doseClub: { externalClubId: "club-1" },
    });
    expect(submitted).not.toHaveProperty("doseClubSnapshot");
    expect(submitted).not.toHaveProperty("name");
    expect(submitted).not.toHaveProperty("id");
  });

  it("consulta a rota tenant-scoped e codifica o filtro opcional", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(membershipResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.integrations.doseClubMemberships("org / 1", "unit#1", "tab?1", "product/1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "/api/v1/organizations/org%20%2F%201/units/unit%231/integrations/doseclub/tabs/tab%3F1/memberships?productId=product%2F1",
    );
    expect(init).toMatchObject({ credentials: "include" });
    expect(init.method).toBeUndefined();
  });
});
