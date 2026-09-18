import { api } from "../../api";
import {
  type ManagementScope,
  type ProductReturnableConfiguration,
  parseReturnables,
  record,
  requiredString,
} from "../../management.shared";

export interface InventoryItemSaveState {
  itemId: string | null;
  productId: string | null;
  containerId: string | null;
  createKey: string;
}

type Mapping = Parameters<typeof api.management.configureReturnableProduct>[3]["mappings"][number];

export function replaceInventoryReturnableMapping(
  configurations: ProductReturnableConfiguration[],
  productId: string,
  previousContainerId: string | null,
  next: Mapping | null,
): Parameters<typeof api.management.configureReturnableProduct>[3] {
  const mappings = configurations
    .filter(
      (mapping) =>
        mapping.active &&
        mapping.productId === productId &&
        mapping.containerInventoryItemId !== previousContainerId &&
        mapping.containerInventoryItemId !== next?.containerInventoryItemId,
    )
    .map(({ containerInventoryItemId, quantityPerUnit, depositCents }) => ({
      containerInventoryItemId,
      quantityPerUnit: String(quantityPerUnit),
      depositCents,
    }));
  if (next) mappings.push(next);
  return { status: mappings.length ? "returnable" : "non_returnable", mappings };
}

export async function saveInventoryItem(
  scope: Pick<ManagementScope, "organizationId" | "unitId">,
  body: Record<string, unknown>,
  state: InventoryItemSaveState,
) {
  const {
    returnableContainerItemId,
    returnableQuantityPerUnit,
    returnableDepositCents,
    ...itemBody
  } = body;
  const productId =
    itemBody.kind === "resale" && typeof itemBody.productId === "string"
      ? itemBody.productId || null
      : null;
  const next =
    productId && typeof returnableContainerItemId === "string" && returnableContainerItemId
      ? {
          containerInventoryItemId: returnableContainerItemId,
          quantityPerUnit:
            typeof returnableQuantityPerUnit === "string" ? returnableQuantityPerUnit : "1",
          depositCents: typeof returnableDepositCents === "number" ? returnableDepositCents : 0,
        }
      : null;
  const { organizationId, unitId } = scope;
  const configurations =
    next || state.containerId
      ? parseReturnables(await api.management.returnables(organizationId, unitId)).configurations
      : [];
  if (state.itemId) {
    await api.management.updateInventoryItem(organizationId, unitId, state.itemId, itemBody);
  } else {
    const saved = await api.management.createInventoryItem(
      organizationId,
      unitId,
      itemBody as Parameters<typeof api.management.createInventoryItem>[2],
      state.createKey,
    );
    state.itemId = requiredString(record(saved).id);
  }
  try {
    if (state.productId && state.containerId && state.productId !== productId) {
      await api.management.configureReturnableProduct(
        organizationId,
        unitId,
        state.productId,
        replaceInventoryReturnableMapping(configurations, state.productId, state.containerId, null),
      );
      state.productId = null;
      state.containerId = null;
    }
    if (productId && (next || state.containerId)) {
      await api.management.configureReturnableProduct(
        organizationId,
        unitId,
        productId,
        replaceInventoryReturnableMapping(configurations, productId, state.containerId, next),
      );
    }
    state.productId = productId;
    state.containerId = next?.containerInventoryItemId ?? null;
  } catch (error) {
    throw new Error(
      `O item de estoque foi salvo, mas o vínculo de vasilhame não foi concluído. Tente salvar novamente para concluir no mesmo item. ${error instanceof Error ? error.message : ""}`,
    );
  }
}
