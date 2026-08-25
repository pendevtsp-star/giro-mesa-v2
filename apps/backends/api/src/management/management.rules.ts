import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

export type InventoryEventType = "loss" | "count" | "adjustment";

export const COMMISSION_CENTS_MAX = 2_147_483_647;

export function assertCommissionCents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > COMMISSION_CENTS_MAX) {
    throw new BadRequestException({
      code: "COMMISSION_AMOUNT_OUT_OF_RANGE",
      message: `${field} deve estar entre 0 e ${COMMISSION_CENTS_MAX} centavos.`,
    });
  }
}

export function commissionAmountFromBasisPoints(baseCents: number, basisPoints: number) {
  assertCommissionCents(baseCents, "baseCents");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new BadRequestException({
      code: "COMMISSION_RATE_OUT_OF_RANGE",
      message: "basisPoints deve estar entre 0 e 10000.",
    });
  }
  const amountCents = Math.round((baseCents * basisPoints) / 10_000);
  assertCommissionCents(amountCents, "amountCents");
  return amountCents;
}

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

export function normalizeBusinessDocument(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

export function purchaseStockConversion(
  quantity: string | number,
  purchaseToStockFactor: string | number,
  purchaseUnitCostCents: number,
) {
  assertCents(purchaseUnitCostCents, "unitCostCents");
  const purchaseMilli = quantityToMilli(quantity, "quantity");
  const factorMilli = quantityToMilli(purchaseToStockFactor, "purchaseToStockFactor");
  if (purchaseMilli <= 0 || factorMilli <= 0)
    throw new BadRequestException({
      code: "INVALID_PURCHASE_CONVERSION",
      message: "Quantidade e fator de conversão devem ser positivos.",
    });
  const stockMilli = Math.round((purchaseMilli * factorMilli) / 1_000);
  if (stockMilli <= 0)
    throw new BadRequestException({
      code: "PURCHASE_CONVERSION_TOO_SMALL",
      message: "A quantidade convertida é menor que a precisão do estoque.",
    });
  const totalCents = Math.round((purchaseMilli * purchaseUnitCostCents) / 1_000);
  if (totalCents <= 0)
    throw new BadRequestException({
      code: "PURCHASE_LINE_TOTAL_TOO_SMALL",
      message: "O total da linha deve resultar em ao menos um centavo.",
    });
  return {
    purchaseMilli,
    stockMilli,
    purchaseQuantity: milliToQuantity(purchaseMilli),
    stockQuantity: milliToQuantity(stockMilli),
    totalCents,
    stockUnitCostCents: Math.round((totalCents * 1_000) / stockMilli),
  };
}

export function purchaseReconciliation(input: {
  orderedCents: number;
  receivedCents: number;
  invoicedCents: number;
  invoiceLinesCents: number;
  toleranceCents: number;
}) {
  for (const field of [
    "orderedCents",
    "receivedCents",
    "invoicedCents",
    "invoiceLinesCents",
  ] as const)
    assertCents(input[field], field, true);
  assertCents(input.toleranceCents, "toleranceCents", true);
  const differences = {
    receivedVsOrderedCents: input.receivedCents - input.orderedCents,
    invoicedVsReceivedCents: input.invoicedCents - input.receivedCents,
    invoiceHeaderVsLinesCents: input.invoicedCents - input.invoiceLinesCents,
  };
  const matched = Object.values(differences).every(
    (difference) => Math.abs(difference) <= input.toleranceCents,
  );
  return { ...input, ...differences, matched, status: matched ? "matched" : "divergent" } as const;
}

export function purchaseLineReconciliation(
  lines: readonly {
    purchaseOrderItemId: string;
    orderedQuantity: string | number;
    orderedUnitCostCents: number;
    orderedCents: number;
    receivedQuantity: string | number;
    receivedCents: number;
    invoicedQuantity: string | number;
    invoicedUnitCostCents: number;
    invoicedCents: number;
  }[],
  toleranceCents: number,
) {
  assertCents(toleranceCents, "toleranceCents", true);
  const reconciled = lines.map((line) => {
    for (const field of [
      "orderedUnitCostCents",
      "orderedCents",
      "receivedCents",
      "invoicedUnitCostCents",
      "invoicedCents",
    ] as const)
      assertCents(line[field], field, true);
    const quantities = {
      orderedQuantityMilli: quantityToMilli(line.orderedQuantity, "orderedQuantity"),
      receivedQuantityMilli: quantityToMilli(line.receivedQuantity, "receivedQuantity"),
      invoicedQuantityMilli: quantityToMilli(line.invoicedQuantity, "invoicedQuantity"),
    };
    const differences = {
      receivedVsOrderedQuantityMilli:
        quantities.receivedQuantityMilli - quantities.orderedQuantityMilli,
      invoicedVsReceivedQuantityMilli:
        quantities.invoicedQuantityMilli - quantities.receivedQuantityMilli,
      invoicedVsOrderedUnitCostCents: line.invoicedUnitCostCents - line.orderedUnitCostCents,
      receivedVsOrderedCents: line.receivedCents - line.orderedCents,
      invoicedVsReceivedCents: line.invoicedCents - line.receivedCents,
    };
    const matched =
      differences.receivedVsOrderedQuantityMilli === 0 &&
      differences.invoicedVsReceivedQuantityMilli === 0 &&
      Math.abs(differences.invoicedVsOrderedUnitCostCents) <= toleranceCents &&
      Math.abs(differences.receivedVsOrderedCents) <= toleranceCents &&
      Math.abs(differences.invoicedVsReceivedCents) <= toleranceCents;
    return { ...line, ...quantities, ...differences, matched };
  });
  return { lines: reconciled, matched: reconciled.every((line) => line.matched) };
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

export function addMonthsToFinancialDate(value: string, months: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_FINANCIAL_DATE");
  const target = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(Number(match[3]), lastDay)),
  )
    .toISOString()
    .slice(0, 10);
}

export function financialInstallmentSchedule(
  competenceDate: string,
  dueDate: string,
  installments = 1,
  intervalMonths = 1,
) {
  return Array.from({ length: installments }, (_, index) => ({
    installmentNumber: index + 1,
    competenceDate: addMonthsToFinancialDate(competenceDate, index * intervalMonths),
    dueDate: addMonthsToFinancialDate(dueDate, index * intervalMonths),
  }));
}

export function cashConference(input: {
  openingCents: number;
  drawerInCents: number;
  drawerOutCents: number;
  countedCents: number;
}) {
  assertCents(input.openingCents, "openingCents", true);
  assertCents(input.drawerInCents, "drawerInCents", true);
  assertCents(input.drawerOutCents, "drawerOutCents", true);
  assertCents(input.countedCents, "countedCents", true);
  const expectedCents = input.openingCents + input.drawerInCents - input.drawerOutCents;
  return { expectedCents, differenceCents: input.countedCents - expectedCents };
}

export function assertCashDrawerDebit(expectedCents: number, debitCents: number) {
  assertCents(expectedCents, "expectedCents", true);
  assertCents(debitCents, "amountCents");
  if (debitCents > expectedCents)
    throw new ConflictException({
      code: "CASH_DRAWER_INSUFFICIENT",
      message: "O valor excede o saldo físico esperado no caixa.",
    });
}

export function cashTransferLockOrder(fromCashShiftId: string, toCashShiftId: string) {
  if (fromCashShiftId === toCashShiftId)
    throw new ConflictException({
      code: "CASH_TRANSFER_SAME_REGISTER",
      message: "Origem e destino devem ser caixas diferentes.",
    });
  return [fromCashShiftId, toCashShiftId].sort() as [string, string];
}

export type CashTenderMethod =
  | "cash"
  | "pix"
  | "credit_card"
  | "debit_card"
  | "bank_transfer"
  | "other";

export function cashTenderConference(
  expectedByMethod: ReadonlyMap<CashTenderMethod, number>,
  observations: readonly {
    method: CashTenderMethod;
    observedCents: number;
    source: "manual" | "smartpos";
  }[],
) {
  const observedByMethod = new Map(observations.map((count) => [count.method, count]));
  const requiredMethods = new Set<CashTenderMethod>(["cash"]);
  for (const [method, expectedCents] of expectedByMethod) {
    assertCents(expectedCents, "expectedCents", true);
    if (expectedCents > 0) requiredMethods.add(method);
  }
  const missing = [...requiredMethods].filter((method) => !observedByMethod.has(method));
  if (missing.length > 0)
    throw new BadRequestException({
      code: "CASH_TENDER_COUNTS_INCOMPLETE",
      message: "Informe a conferência de todas as formas de pagamento esperadas.",
      details: { missingMethods: missing },
    });

  return observations
    .map((observation) => {
      assertCents(observation.observedCents, "observedCents", true);
      const expectedCents = expectedByMethod.get(observation.method) ?? 0;
      return {
        method: observation.method,
        expectedCents,
        observedCents: observation.observedCents,
        differenceCents: observation.observedCents - expectedCents,
        source: observation.source,
      };
    })
    .sort((left, right) => left.method.localeCompare(right.method));
}

export function cashDifferenceSeverity(
  tenderBreakdown: readonly { differenceCents: number }[],
  criticalThresholdCents: number,
) {
  assertCents(criticalThresholdCents, "criticalThresholdCents", true);
  const greatestDifference = tenderBreakdown.reduce(
    (greatest, tender) => Math.max(greatest, Math.abs(tender.differenceCents)),
    0,
  );
  if (greatestDifference === 0) return "none" as const;
  return greatestDifference >= criticalThresholdCents
    ? ("critical" as const)
    : ("warning" as const);
}

export function requiresCashApproval(role: string, amountCents: number, thresholdCents: number) {
  assertCents(amountCents, "amountCents");
  assertCents(thresholdCents, "movementApprovalThresholdCents", true);
  return role === "cashier" && amountCents > thresholdCents;
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

const REPORT_DAY_MS = 86_400_000;

export type ReportComparisonMode = "previous_period" | "previous_year" | "none";

function previousYearDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC((year ?? 0) - 1, (month ?? 1) - 1, day ?? 1));
  if (candidate.getUTCMonth() !== (month ?? 1) - 1) return null;
  return candidate.toISOString().slice(0, 10);
}

function previousYearBoundary(value: string) {
  const exact = previousYearDate(value);
  if (exact) return exact;
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC((year ?? 0) - 1, month ?? 1, 0)).toISOString().slice(0, 10);
}

export function reportPeriodContext(
  period: { from: string; to: string },
  comparisonMode: ReportComparisonMode = "previous_period",
) {
  const from = Date.parse(`${period.from}T00:00:00.000Z`);
  const to = Date.parse(`${period.to}T00:00:00.000Z`);
  const days = Math.round((to - from) / REPORT_DAY_MS) + 1;
  const previousTo = from - REPORT_DAY_MS;
  const previousFrom = previousTo - (days - 1) * REPORT_DAY_MS;
  const isoDate = (value: number) => new Date(value).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, index) => isoDate(from + index * REPORT_DAY_MS));
  if (comparisonMode === "none") {
    return { dates, previousDates: dates.map(() => null), previousPeriod: null };
  }
  if (comparisonMode === "previous_year") {
    return {
      dates,
      previousDates: dates.map(previousYearDate),
      previousPeriod: {
        from: previousYearBoundary(period.from),
        to: previousYearBoundary(period.to),
      },
    };
  }
  return {
    dates,
    previousDates: Array.from({ length: days }, (_, index) =>
      isoDate(previousFrom + index * REPORT_DAY_MS),
    ),
    previousPeriod: { from: isoDate(previousFrom), to: isoDate(previousTo) },
  };
}

export function reportPercentageChange(current: number, previous: number) {
  return previous === 0 ? null : Math.round(((current - previous) * 10_000) / previous) / 100;
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

export type PersonAccessRole =
  | "owner"
  | "manager"
  | "waiter"
  | "cashier"
  | "receptionist"
  | "busser"
  | "kds"
  | "delivery"
  | "inventory"
  | "finance"
  | "accountant";

const MANAGER_GRANTABLE_PERSON_ROLES: readonly PersonAccessRole[] = [
  "waiter",
  "cashier",
  "receptionist",
  "busser",
  "kds",
  "delivery",
];

export function canGrantPersonAccessRole(
  actorRole: "owner" | "manager",
  targetRole: PersonAccessRole,
) {
  if (targetRole === "owner") return false;
  return actorRole === "owner" || MANAGER_GRANTABLE_PERSON_ROLES.includes(targetRole);
}

export function personAccessPublicStatus(
  status: "pending" | "active" | "suspended" | "canceled" | "terminated",
  expiresAt: Date | null,
  now = new Date(),
): "none" | "pending" | "expired" | "active" | "suspended" {
  if (status === "active" || status === "suspended") return status;
  if (status !== "pending") return "none";
  return expiresAt && expiresAt <= now ? "expired" : "pending";
}
