import type {
  InventoryItem,
  ProductReturnableConfiguration,
  ReturnableClassificationStatus,
} from "../../management.shared";

export type CatalogReturnableStatus = "returnable" | "non_returnable" | "";

export interface CatalogReturnableMappingDraft {
  key: string;
  containerInventoryItemId: string;
  quantityPerUnit: string;
  deposit: string;
}

export interface CatalogReturnablePayload {
  status: Exclude<CatalogReturnableStatus, "">;
  mappings: Array<{
    containerInventoryItemId: string;
    quantityPerUnit: string;
    depositCents: number;
  }>;
}

export function activeReturnableContainers<T extends Pick<InventoryItem, "active" | "kind">>(
  items: T[],
) {
  return items.filter((item) => item.active && item.kind === "returnable_container");
}

export function readCatalogReturnableDraft(
  productId: string,
  classifications: ReturnableClassificationStatus[],
  configurations: ProductReturnableConfiguration[],
): { status: CatalogReturnableStatus; mappings: CatalogReturnableMappingDraft[] } {
  const activeMappings = configurations.filter(
    (configuration) => configuration.productId === productId && configuration.active,
  );
  const classification = classifications.find((entry) => entry.productId === productId);
  return {
    status:
      classification?.classification === "returnable" || activeMappings.length
        ? "returnable"
        : classification?.classification === "non_returnable"
          ? "non_returnable"
          : "",
    mappings: activeMappings.map((mapping) => ({
      key: mapping.id,
      containerInventoryItemId: mapping.containerInventoryItemId,
      quantityPerUnit: String(mapping.quantityPerUnit),
      deposit: (mapping.depositCents / 100).toFixed(2).replace(".", ","),
    })),
  };
}

function decimal(value: string) {
  const normalized = value.trim().replace(",", ".");
  return normalized && Number.isFinite(Number(normalized)) ? Number(normalized) : Number.NaN;
}

export function buildCatalogReturnablePayload(
  status: CatalogReturnableStatus,
  mappings: CatalogReturnableMappingDraft[],
): { payload?: CatalogReturnablePayload; error?: string } {
  if (!status) return { error: "Defina se o produto usa embalagem retornável." };
  if (status === "non_returnable") return { payload: { status, mappings: [] } };
  if (!mappings.length) return { error: "Adicione ao menos uma embalagem retornável." };

  const containerIds = mappings.map((mapping) => mapping.containerInventoryItemId);
  if (containerIds.some((id) => !id)) return { error: "Selecione a embalagem de cada vínculo." };
  if (new Set(containerIds).size !== containerIds.length)
    return { error: "A mesma embalagem não pode aparecer em mais de um vínculo." };

  const payloadMappings = mappings.map((mapping) => {
    const quantity = decimal(mapping.quantityPerUnit);
    const deposit = decimal(mapping.deposit);
    const normalizedQuantity = Number.isFinite(quantity)
      ? Math.round(quantity * 1_000) / 1_000
      : Number.NaN;
    return {
      containerInventoryItemId: mapping.containerInventoryItemId,
      quantityPerUnit: Number.isFinite(normalizedQuantity) ? String(normalizedQuantity) : "",
      depositCents: Number.isFinite(deposit) ? Math.round(deposit * 100) : -1,
    };
  });
  if (payloadMappings.some((mapping) => Number(mapping.quantityPerUnit) <= 0))
    return { error: "Informe uma quantidade maior que zero em cada vínculo." };
  if (payloadMappings.some((mapping) => mapping.depositCents < 0))
    return { error: "A caução deve ser zero ou um valor positivo." };

  return { payload: { status, mappings: payloadMappings } };
}
