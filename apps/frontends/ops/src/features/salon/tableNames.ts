export const MAX_TABLE_BATCH = 30;

export function buildSequentialTableNames(prefix: string, start: number, quantity: number) {
  const cleanPrefix = prefix.trim();
  if (
    !cleanPrefix ||
    !Number.isInteger(start) ||
    start < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_TABLE_BATCH
  ) {
    return [];
  }

  const width = Math.max(2, String(start + quantity - 1).length);
  const names = Array.from(
    { length: quantity },
    (_, index) => `${cleanPrefix} ${String(start + index).padStart(width, "0")}`,
  );
  return names.every((name) => name.length <= 60) ? names : [];
}
