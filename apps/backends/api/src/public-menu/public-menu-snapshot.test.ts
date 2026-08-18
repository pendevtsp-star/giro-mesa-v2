import assert from "node:assert/strict";
import { it } from "node:test";
import { publicMenuItems } from "./public-menu-snapshot.js";

it("projects the stored catalog snapshot to the stable public contract without internal fields", () => {
  const [item] = publicMenuItems(
    [
      {
        id: "product",
        organizationId: "private",
        categoryId: "category",
        name: "Executivo",
        description: null,
        imageUrl: "https://api.example/public/v1/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
        metadata: { tags: ["Destaque"], secret: "private" },
        price: { priceCents: 2_500, deliveryPriceCents: 3_000, costCents: 900 },
        availability: { available: true },
        modifierGroupIds: ["group"],
      },
    ],
    {
      categories: [{ id: "category", name: "Pratos" }],
      modifierGroups: [
        {
          id: "group",
          name: "Ponto",
          minimumSelections: 1,
          maximumSelections: 1,
          options: [{ id: "option", name: "Ao ponto", priceDeltaCents: 0 }],
        },
      ],
    },
  );
  assert.deepEqual(item, {
    id: "product",
    category: "Pratos",
    name: "Executivo",
    description: "",
    priceCents: 2_500,
    deliveryPriceCents: 3_000,
    visual: "🍽️",
    imageUrl: "https://api.example/public/v1/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
    tags: ["Destaque"],
    available: true,
    modifierGroups: [
      {
        id: "group",
        name: "Ponto",
        required: true,
        maxSelections: 1,
        options: [{ id: "option", name: "Ao ponto", priceCents: 0 }],
      },
    ],
  });
  assert.equal("organizationId" in (item ?? {}), false);
  assert.equal("costCents" in (item ?? {}), false);
});
