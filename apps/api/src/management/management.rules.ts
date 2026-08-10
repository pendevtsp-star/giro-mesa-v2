import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

export type InventoryEventType = "loss" | "count" | "adjustment";

function assertCents(value: number, field: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new BadRequestException({
      code: "INVALID_MONEY_AMOUNT",
      message: `${field} deve ser informado em centavos inteiros${allowZero ? " e não negativos" : " e positivos"}.`,
    });
  }
}

export function quantityToMilli(value: string | number, field = "quantity") {
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(\.\d{1,3})?$/.test(normalized)) {
    throw new BadRequestException({
      code: "INVALID_QUANTITY",
      message: `${field} deve ter no máximo três casas decimais.`,
    });
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const milli = Number(whole) * 1_000 + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(milli)) {
    throw new BadRequestException({
      code: "INVALID_QUANTITY",
      message: `${field} excede o limite seguro.`,
    });
  }
  return negative ? -milli : milli;
}

export function milliToQuantity(value: number) {
  if (!Number.isSafeInteger(value)) throw new Error("Quantidade interna inválida.");
  const negative = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${negative}${Math.floor(absolute / 1_000)}.${String(absolute % 1_000).padStart(3, "0")}`;
}

export function inventoryChange(
  current: string | number,
  type: InventoryEventType,
  entered: string | number,
  allowNegative: boolean,
) {
  const previousMilli = quantityToMilli(current, "currentQuantity");
  const enteredMilli = quantityToMilli(entered);
  let deltaMilli: number;
  if (type === "loss") {
    if (enteredMilli <= 0)
      throw new BadRequestException({
        code: "INVALID_LOSS",
        message: "A perda deve ser positiva.",
      });
    deltaMilli = -enteredMilli;
  } else if (type === "count") {
    if (enteredMilli < 0)
      throw new BadRequestException({
        code: "INVALID_COUNT",
        message: "A contagem não pode ser negativa.",
      });
    deltaMilli = enteredMilli - previousMilli;
  } else {
    if (enteredMilli === 0)
      throw new BadRequestException({
        code: "INVALID_ADJUSTMENT",
        message: "O ajuste não pode ser zero.",
      });
    deltaMilli = enteredMilli;
  }
  if (deltaMilli === 0)
    throw new ConflictException({
      code: "NO_INVENTORY_CHANGE",
      message: "O evento não altera o estoque.",
    });
  const resultingMilli = previousMilli + deltaMilli;
  if (!allowNegative && resultingMilli < 0) {
    throw new ConflictException({
      code: "NEGATIVE_STOCK_BLOCKED",
      message: "A operação deixaria o estoque negativo.",
    });
  }
  return {
    previousQuantity: milliToQuantity(previousMilli),
    quantityDelta: milliToQuantity(deltaMilli),
    resultingQuantity: milliToQuantity(resultingMilli),
  };
}

export function settlement(totalCents: number, settledCents: number, deltaCents: number) {
  assertCents(totalCents, "totalCents");
  assertCents(settledCents, "settledCents", true);
  assertCents(deltaCents, "amountCents");
  const next = settledCents + deltaCents;
  if (next > totalCents) {
    throw new ConflictException({
      code: "PAYMENT_EXCEEDS_BALANCE",
      message: "O pagamento excede o saldo em aberto.",
    });
  }
  return { settledCents: next, status: next === totalCents ? "settled" : "partial" } as const;
}

export function cashConference(input: {
  openingCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  cashReceiptsCents: number;
  countedCents: number;
}) {
  assertCents(input.openingCents, "openingCents", true);
  assertCents(input.suppliesCents, "suppliesCents", true);
  assertCents(input.withdrawalsCents, "withdrawalsCents", true);
  assertCents(input.cashReceiptsCents, "cashReceiptsCents", true);
  assertCents(input.countedCents, "countedCents", true);
  const expectedCents =
    input.openingCents + input.suppliesCents - input.withdrawalsCents + input.cashReceiptsCents;
  return { expectedCents, differenceCents: input.countedCents - expectedCents };
}

export function profitabilityCoverage(
  lines: readonly { revenueCents: number; costCents: number | null }[],
) {
  const revenueCents = lines.reduce((sum, line) => sum + line.revenueCents, 0);
  const coveredRevenueCents = lines.reduce(
    (sum, line) => sum + (line.costCents === null ? 0 : line.revenueCents),
    0,
  );
  const missingCostLines = lines.filter((line) => line.costCents === null).length;
  const coverage =
    lines.length === 0 || missingCostLines === lines.length
      ? "unavailable"
      : missingCostLines > 0
        ? "partial"
        : "complete";
  if (coverage !== "complete") {
    return {
      coverage,
      revenueCents,
      coveredRevenueCents,
      missingCostLines,
      cmvCents: null,
      grossMarginCents: null,
    };
  }
  const cmvCents = lines.reduce((sum, line) => sum + (line.costCents ?? 0), 0);
  return {
    coverage,
    revenueCents,
    coveredRevenueCents,
    missingCostLines,
    cmvCents,
    grossMarginCents: revenueCents - cmvCents,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function managementRequestHash(operation: string, payload: unknown) {
  return createHash("sha256")
    .update(`${operation}:${canonicalJson(payload)}`)
    .digest("hex");
}

export function managementReplay<T extends Record<string, unknown>>(
  existing: { payloadHash: string; response: Record<string, unknown> | null } | undefined,
  payloadHash: string,
) {
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) {
    throw new ConflictException({
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
      message: "A chave já foi usada com outro conteúdo.",
    });
  }
  if (!existing.response) {
    throw new ConflictException({
      code: "IDEMPOTENCY_INCOMPLETE",
      message: "A operação anterior ainda não possui resposta persistida.",
    });
  }
  return { ...(existing.response as T), idempotentReplay: true };
}

export function assertManagementScope(
  expected: { organizationId: string; unitId: string },
  actual: { organizationId: string; unitId: string },
) {
  if (expected.organizationId !== actual.organizationId || expected.unitId !== actual.unitId) {
    throw new ConflictException({
      code: "MANAGEMENT_SCOPE_MISMATCH",
      message: "O recurso não pertence à organização e unidade informadas.",
    });
  }
}

export function purchaseReceiptPlan(
  items: readonly {
    id: string;
    quantity: string | number;
    receivedQuantity: string | number;
    unitCostCents: number;
  }[],
  lines: readonly { purchaseOrderItemId: string; quantity: string | number }[],
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const updates = lines.map((line) => {
    if (seen.has(line.purchaseOrderItemId)) {
      throw new BadRequestException({
        code: "DUPLICATE_RECEIPT_LINE",
        message: "Cada item do pedido deve aparecer uma vez por recebimento.",
      });
    }
    seen.add(line.purchaseOrderItemId);
    const item = byId.get(line.purchaseOrderItemId);
    if (!item)
      throw new NotFoundException({
        code: "PURCHASE_ORDER_ITEM_NOT_FOUND",
        message: "Item não pertence ao pedido desta unidade.",
      });
    const quantityMilli = quantityToMilli(line.quantity);
    if (quantityMilli <= 0)
      throw new BadRequestException({
        code: "INVALID_QUANTITY",
        message: "A quantidade recebida deve ser positiva.",
      });
    const nextReceivedMilli = quantityToMilli(item.receivedQuantity) + quantityMilli;
    if (nextReceivedMilli > quantityToMilli(item.quantity)) {
      throw new ConflictException({
        code: "RECEIPT_EXCEEDS_ORDER",
        message: "O recebimento excede a quantidade comprada.",
      });
    }
    return {
      purchaseOrderItemId: item.id,
      quantityMilli,
      nextReceivedQuantity: milliToQuantity(nextReceivedMilli),
      totalCents: Math.round((quantityMilli * item.unitCostCents) / 1_000),
    };
  });
  return { updates, totalCents: updates.reduce((sum, update) => sum + update.totalCents, 0) };
}
