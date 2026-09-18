export interface InventoryShortageConfirmation {
  organizationId: string;
  unitId: string;
  orderId: string;
  products: string[];
}

type ConfirmationHandler = (request: InventoryShortageConfirmation) => Promise<boolean>;
let handler: ConfirmationHandler | undefined;

export function registerInventoryShortageConfirmation(next: ConfirmationHandler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

export function confirmInventoryShortage(request: InventoryShortageConfirmation) {
  return handler?.(request) ?? Promise.resolve(false);
}
