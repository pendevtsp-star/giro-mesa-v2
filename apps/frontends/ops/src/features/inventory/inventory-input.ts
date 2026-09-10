/** Normalize the operator's decimal separator before sending a quantity to the API. */
export function inventoryQuantity(value: string): string {
  return value.trim().replace(",", ".");
}

export function validInventoryQuantity(value: string, allowZero = false): boolean {
  const normalized = inventoryQuantity(value);
  return (
    /^\d{1,12}(?:\.\d{1,3})?$/.test(normalized) &&
    (allowZero ? Number(normalized) >= 0 : Number(normalized) > 0)
  );
}
