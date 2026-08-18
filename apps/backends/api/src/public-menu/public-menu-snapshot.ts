type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function publicMenuItems(
  items: readonly RecordValue[],
  metadata: RecordValue,
): RecordValue[] {
  const categories = new Map(
    (Array.isArray(metadata.categories) ? metadata.categories : []).flatMap((value) => {
      const category = record(value);
      return category && typeof category.id === "string" && typeof category.name === "string"
        ? [[category.id, category.name] as const]
        : [];
    }),
  );
  const groups = new Map(
    (Array.isArray(metadata.modifierGroups) ? metadata.modifierGroups : []).flatMap((value) => {
      const group = record(value);
      return group && typeof group.id === "string" ? [[group.id, group] as const] : [];
    }),
  );
  return items.flatMap((item) => {
    if (typeof item.category === "string") {
      return typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.description === "string" &&
        Number.isInteger(item.priceCents) &&
        typeof item.visual === "string" &&
        typeof item.available === "boolean"
        ? [
            {
              id: item.id,
              category: item.category,
              name: item.name,
              description: item.description,
              priceCents: item.priceCents,
              visual: item.visual,
              available: item.available,
              tags: strings(item.tags),
              ...(Array.isArray(item.modifierGroups)
                ? { modifierGroups: item.modifierGroups }
                : {}),
            },
          ]
        : [];
    }
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    const price = record(item.price);
    const availability = record(item.availability);
    if (!price || !Number.isInteger(price.priceCents)) return [];
    const productMetadata = record(item.metadata);
    const modifierGroups = strings(item.modifierGroupIds).flatMap((groupId) => {
      const group = groups.get(groupId);
      if (!group || typeof group.name !== "string" || !Number.isInteger(group.maximumSelections)) {
        return [];
      }
      const options = (Array.isArray(group.options) ? group.options : []).flatMap((value) => {
        const option = record(value);
        return option &&
          typeof option.id === "string" &&
          typeof option.name === "string" &&
          Number.isInteger(option.priceDeltaCents)
          ? [{ id: option.id, name: option.name, priceCents: option.priceDeltaCents }]
          : [];
      });
      return [
        {
          id: groupId,
          name: group.name,
          required: Number(group.minimumSelections) > 0,
          maxSelections: group.maximumSelections,
          options,
        },
      ];
    });
    return [
      {
        id: item.id,
        category:
          typeof item.categoryId === "string"
            ? (categories.get(item.categoryId) ?? "Cardápio")
            : "Cardápio",
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
        priceCents: price.priceCents,
        ...(Number.isInteger(price.deliveryPriceCents)
          ? { deliveryPriceCents: price.deliveryPriceCents }
          : {}),
        visual: "🍽️",
        ...(typeof item.imageUrl === "string" && /^https?:\/\//.test(item.imageUrl)
          ? { imageUrl: item.imageUrl }
          : {}),
        tags: [
          ...new Set([
            ...strings(productMetadata?.tags),
            ...strings(productMetadata?.dietaryFlags),
          ]),
        ],
        available: availability?.available === true,
        ...(modifierGroups.length > 0 ? { modifierGroups } : {}),
      },
    ];
  });
}
