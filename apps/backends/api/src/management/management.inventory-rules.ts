import { createHash } from "node:crypto";

export type ParsedNfeLine = {
  lineNumber: number;
  supplierProductCode: string;
  barcode: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string;
  quantity: string;
  unitCostCents: number;
  totalCents: number;
};

export type ParsedNfe = {
  accessKey: string;
  contentHash: string;
  issuerDocument: string;
  issuerName: string;
  recipientDocument: string;
  documentNumber: string;
  series: string;
  model: string;
  issuedAt: string;
  totalCents: number;
  taxTotalCents: number;
  xml: string;
  lines: ParsedNfeLine[];
};

export class NfeParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_XML_BYTES = 5 * 1024 * 1024;

function xmlText(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(source: string, name: string, required = true) {
  const match = source.match(
    new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "i"),
  );
  if (match?.[1] !== undefined) return xmlText(match[1]);
  if (!required) return "";
  throw new NfeParseError("NFE_FIELD_MISSING", `A NF-e não possui o campo obrigatório ${name}.`);
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function hasValidNfeCheckDigit(accessKey: string) {
  const sum = [...accessKey.slice(0, 43)]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * ((index % 8) + 2), 0);
  const candidate = 11 - (sum % 11);
  return Number(accessKey[43]) === (candidate >= 10 ? 0 : candidate);
}

function cents(value: string, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new NfeParseError("NFE_INVALID_NUMBER", `O campo ${field} da NF-e é inválido.`);
  return Math.round(parsed * 100);
}

function quantity(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new NfeParseError("NFE_INVALID_QUANTITY", "A NF-e possui quantidade inválida.");
  return (Math.round(parsed * 1_000) / 1_000).toFixed(3);
}

export function decodeNfeSource(source: string) {
  const trimmed = source.trim();
  if (!trimmed) throw new NfeParseError("NFE_XML_REQUIRED", "Informe o XML da NF-e.");
  let xml = trimmed;
  if (!trimmed.startsWith("<")) {
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed))
      throw new NfeParseError("NFE_XML_INVALID", "O conteúdo não é XML nem base64 válido.");
    xml = Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf8").trim();
  }
  if (!xml.startsWith("<") || !/<(?:[\w-]+:)?NFe\b/i.test(xml))
    throw new NfeParseError("NFE_XML_INVALID", "O conteúdo não é uma NF-e XML válida.");
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
    throw new NfeParseError("NFE_XML_TOO_LARGE", "O XML da NF-e excede 5 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new NfeParseError("NFE_XML_UNSAFE", "DOCTYPE e entidades externas não são aceitos.");
  return xml;
}

export function parseNfe(source: string): ParsedNfe {
  const xml = decodeNfeSource(source);
  const info = xml.match(/<(?:[\w-]+:)?infNFe\b[^>]*\bId=["']NFe(\d{44})["'][^>]*>/i);
  const accessKey = info?.[1] ?? digits(tag(xml, "chNFe", false));
  if (accessKey.length !== 44)
    throw new NfeParseError(
      "NFE_ACCESS_KEY_INVALID",
      "A chave de acesso da NF-e deve possuir 44 dígitos.",
    );
  if (!hasValidNfeCheckDigit(accessKey))
    throw new NfeParseError(
      "NFE_ACCESS_KEY_INVALID",
      "O dígito verificador da chave da NF-e é inválido.",
    );

  const issuer = xml.match(/<(?:[\w-]+:)?emit\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?emit>/i)?.[1];
  const recipient = xml.match(/<(?:[\w-]+:)?dest\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?dest>/i)?.[1];
  if (!issuer || !recipient)
    throw new NfeParseError(
      "NFE_PARTY_MISSING",
      "Emitente e destinatário são obrigatórios na NF-e.",
    );
  const issuerDocument = digits(tag(issuer, "CNPJ", false) || tag(issuer, "CPF", false));
  const recipientDocument = digits(tag(recipient, "CNPJ", false) || tag(recipient, "CPF", false));
  if (!issuerDocument || !recipientDocument)
    throw new NfeParseError(
      "NFE_PARTY_DOCUMENT_MISSING",
      "CNPJ/CPF do emitente e destinatário são obrigatórios.",
    );

  const lines: ParsedNfeLine[] = [];
  const det = /<(?:[\w-]+:)?det\b[^>]*\bnItem=["'](\d+)["'][^>]*>([\s\S]*?)<\/(?:[\w-]+:)?det>/gi;
  for (const match of xml.matchAll(det)) {
    const product = match[2] ?? "";
    const rawQuantity = tag(product, "qCom");
    const totalCents = cents(tag(product, "vProd"), "vProd");
    const numericQuantity = Number(rawQuantity);
    lines.push({
      lineNumber: Number(match[1]),
      supplierProductCode: tag(product, "cProd"),
      barcode: (() => {
        const value = tag(product, "cEAN", false);
        return value && value !== "SEM GTIN" ? value : null;
      })(),
      description: tag(product, "xProd"),
      ncm: tag(product, "NCM", false) || null,
      cfop: tag(product, "CFOP", false) || null,
      unit: tag(product, "uCom"),
      quantity: quantity(rawQuantity),
      unitCostCents: Math.round(totalCents / numericQuantity),
      totalCents,
    });
  }
  if (!lines.length) throw new NfeParseError("NFE_LINES_MISSING", "A NF-e não possui produtos.");

  const issued = tag(xml, "dhEmi", false) || tag(xml, "dEmi");
  const issuedAt = issued.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt))
    throw new NfeParseError("NFE_ISSUED_AT_INVALID", "A data de emissão da NF-e é inválida.");
  const ide = xml.match(/<(?:[\w-]+:)?ide\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?ide>/i)?.[1] ?? "";
  const totals =
    xml.match(/<(?:[\w-]+:)?ICMSTot\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?ICMSTot>/i)?.[1] ?? "";
  const documentNumber = tag(ide, "nNF");
  const series = tag(ide, "serie");
  const model = tag(ide, "mod");
  if (
    accessKey.slice(2, 6) !== `${issuedAt.slice(2, 4)}${issuedAt.slice(5, 7)}` ||
    accessKey.slice(6, 20) !== issuerDocument ||
    accessKey.slice(20, 22) !== model.padStart(2, "0") ||
    Number(accessKey.slice(22, 25)) !== Number(series) ||
    Number(accessKey.slice(25, 34)) !== Number(documentNumber)
  )
    throw new NfeParseError(
      "NFE_ACCESS_KEY_CONTENT_MISMATCH",
      "A chave da NF-e diverge de emissão, emitente, modelo, série ou número do XML.",
    );
  return {
    accessKey,
    contentHash: createHash("sha256").update(xml, "utf8").digest("hex"),
    issuerDocument,
    issuerName: tag(issuer, "xNome"),
    recipientDocument,
    documentNumber,
    series,
    model,
    issuedAt,
    totalCents: cents(tag(xml, "vNF"), "vNF"),
    taxTotalCents: totals ? cents(tag(totals, "vTotTrib", false) || "0", "vTotTrib") : 0,
    xml,
    lines,
  };
}

export type NfeMatchCandidate = { id: string; barcode: string | null };
export type NfeAliasCandidate = {
  inventoryItemId: string;
  supplierProductCode: string;
  supplierBarcode: string | null;
};

export function suggestNfeLineMatch(
  line: Pick<ParsedNfeLine, "supplierProductCode" | "barcode">,
  aliases: readonly NfeAliasCandidate[],
  items: readonly NfeMatchCandidate[],
) {
  const byCode = aliases.find(
    (candidate) => candidate.supplierProductCode === line.supplierProductCode,
  );
  if (byCode)
    return { inventoryItemId: byCode.inventoryItemId, matchType: "supplier_alias" as const };
  if (line.barcode) {
    const byAliasBarcode = aliases.find((candidate) => candidate.supplierBarcode === line.barcode);
    if (byAliasBarcode)
      return {
        inventoryItemId: byAliasBarcode.inventoryItemId,
        matchType: "supplier_barcode" as const,
      };
    const byBarcode = items.find((candidate) => candidate.barcode === line.barcode);
    if (byBarcode) return { inventoryItemId: byBarcode.id, matchType: "gtin" as const };
  }
  return { inventoryItemId: null, matchType: "new" as const };
}

export function assertIncidentTransition(current: string, target: "approved" | "rejected") {
  if (current !== "pending") throw new Error("RETURNABLE_INCIDENT_ALREADY_REVIEWED");
  return target;
}

export function assessInventoryRisk(
  input: {
    type: "count" | "loss" | "adjustment";
    previousQuantity: number;
    requestedQuantity: number;
    unitCostCents: number | null;
  },
  limits = { percent: 20, valueCents: 10_000 },
) {
  const delta =
    input.type === "count"
      ? input.requestedQuantity - input.previousQuantity
      : input.type === "loss"
        ? -input.requestedQuantity
        : input.requestedQuantity;
  const percent =
    input.previousQuantity === 0 ? 0 : (Math.abs(delta) / Math.abs(input.previousQuantity)) * 100;
  const valueCents =
    input.unitCostCents === null ? null : Math.round(Math.abs(delta) * input.unitCostCents);
  return {
    delta,
    percent,
    valueCents,
    requiresApproval:
      (Math.abs(delta) >= 1 && percent >= limits.percent) ||
      (valueCents !== null && valueCents >= limits.valueCents),
  };
}

export function replenishmentSuggestion(input: {
  currentQuantity: number;
  minimumQuantity: number;
  reorderQuantity: number;
  purchaseToStockFactor: number;
  leadTimeDays: number;
  consumedLast30Days: number;
  outstandingStockQuantity: number;
}) {
  const dailyConsumption = Math.max(0, input.consumedLast30Days) / 30;
  const targetStock = Math.max(
    input.minimumQuantity,
    input.minimumQuantity + dailyConsumption * input.leadTimeDays,
  );
  const stockNeeded = Math.max(
    0,
    Math.max(
      input.reorderQuantity,
      targetStock - input.currentQuantity - input.outstandingStockQuantity,
    ),
  );
  const purchaseQuantity =
    Math.ceil((stockNeeded / Math.max(input.purchaseToStockFactor, 0.001)) * 1_000) / 1_000;
  return {
    dailyConsumption,
    targetStock,
    stockNeeded,
    purchaseQuantity,
    coverageDays:
      dailyConsumption > 0
        ? Math.max(0, input.currentQuantity + input.outstandingStockQuantity) / dailyConsumption
        : null,
  };
}

export function returnableAging(
  movements: readonly {
    quantityDelta: number;
    occurredAt: Date;
    depositCents?: number | null;
  }[],
  now = new Date(),
) {
  const buckets: Array<{ quantity: number; occurredAt: Date; depositCents: number }> = [];
  for (const movement of [...movements].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    if (movement.quantityDelta > 0) {
      buckets.push({
        quantity: movement.quantityDelta,
        occurredAt: movement.occurredAt,
        depositCents: movement.depositCents ?? 0,
      });
      continue;
    }
    let remaining = -movement.quantityDelta;
    for (const bucket of buckets) {
      const consumed = Math.min(bucket.quantity, remaining);
      bucket.quantity -= consumed;
      remaining -= consumed;
      if (remaining <= 0) break;
    }
  }
  const open = buckets.filter((bucket) => bucket.quantity > 0);
  const oldest = open[0]?.occurredAt ?? null;
  return {
    oldestOutstandingAt: oldest,
    ageDays: oldest ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86_400_000)) : 0,
    depositExposureCents: open.reduce(
      (total, bucket) => total + Math.round(bucket.quantity * bucket.depositCents),
      0,
    ),
  };
}

export function classifyInventoryAbc(
  rows: readonly { key: string; consumptionValueCents: number }[],
) {
  const ordered = [...rows].sort(
    (left, right) =>
      right.consumptionValueCents - left.consumptionValueCents || left.key.localeCompare(right.key),
  );
  const total = ordered.reduce((sum, row) => sum + Math.max(0, row.consumptionValueCents), 0);
  let cumulative = 0;
  return new Map(
    ordered.map((row) => {
      const shareBefore = total > 0 ? cumulative / total : 1;
      cumulative += Math.max(0, row.consumptionValueCents);
      return [
        row.key,
        total === 0
          ? ("C" as const)
          : shareBefore < 0.8
            ? ("A" as const)
            : shareBefore < 0.95
              ? ("B" as const)
              : ("C" as const),
      ];
    }),
  );
}

export function cycleCountPolicy(input: {
  classification: "A" | "B" | "C";
  inventoryValueCents: number;
  movementCount90Days: number;
  divergencePercent: number;
  expiresWithinDays: number | null;
}) {
  const valueRisk =
    input.inventoryValueCents >= 100_000 ? 35 : input.inventoryValueCents >= 30_000 ? 20 : 8;
  const movementRisk =
    input.movementCount90Days >= 90 ? 30 : input.movementCount90Days >= 30 ? 18 : 6;
  const divergenceRisk = Math.min(25, Math.round(Math.max(0, input.divergencePercent)));
  const expiryRisk =
    input.expiresWithinDays === null
      ? 0
      : input.expiresWithinDays <= 7
        ? 10
        : input.expiresWithinDays <= 30
          ? 5
          : 0;
  const riskScore = Math.min(100, valueRisk + movementRisk + divergenceRisk + expiryRisk);
  const abcFrequency = input.classification === "A" ? 7 : input.classification === "B" ? 14 : 30;
  const riskFrequency = riskScore >= 65 ? 7 : riskScore >= 35 ? 14 : 30;
  return {
    classification: input.classification,
    riskScore,
    frequencyDays: Math.min(abcFrequency, riskFrequency),
  };
}

export function forecastInventoryDemand(input: {
  dailyUsage: readonly { date: string; quantity: number }[];
  horizonDays: number;
  currentQuantity: number;
  reservedQuantity: number;
  outstandingPurchaseQuantity: number;
  from?: Date;
}) {
  const fallback =
    input.dailyUsage.reduce((total, row) => total + Math.max(0, row.quantity), 0) /
    Math.max(1, input.dailyUsage.length);
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => {
    const matching = input.dailyUsage.filter(
      (row) => new Date(`${row.date}T00:00:00.000Z`).getUTCDay() === weekday,
    );
    return matching.length
      ? matching.reduce((total, row) => total + Math.max(0, row.quantity), 0) / matching.length
      : fallback;
  });
  const from = input.from ?? new Date();
  let forecastQuantity = 0;
  for (let offset = 0; offset < Math.max(1, input.horizonDays); offset += 1) {
    const day = new Date(from);
    day.setUTCDate(day.getUTCDate() + offset);
    forecastQuantity += byWeekday[day.getUTCDay()] ?? fallback;
  }
  const availableQuantity = Math.max(0, input.currentQuantity - input.reservedQuantity);
  const netRequiredQuantity = Math.max(
    0,
    forecastQuantity - availableQuantity - input.outstandingPurchaseQuantity,
  );
  return {
    averageDailyUsage: fallback,
    weekdayAverage: byWeekday,
    forecastQuantity,
    availableQuantity,
    netRequiredQuantity,
    coverageDays: fallback > 0 ? availableQuantity / fallback : null,
  };
}

export function supplierPerformance(input: {
  orderedQuantity: number;
  receivedQuantity: number;
  completedOrders: number;
  onTimeOrders: number;
  invoices: number;
  divergentInvoices: number;
  previousAverageCostCents: number | null;
  currentAverageCostCents: number | null;
}) {
  return {
    fillRatePercent:
      input.orderedQuantity > 0
        ? Math.min(100, (input.receivedQuantity / input.orderedQuantity) * 100)
        : null,
    onTimePercent:
      input.completedOrders > 0 ? (input.onTimeOrders / input.completedOrders) * 100 : null,
    invoiceDivergencePercent:
      input.invoices > 0 ? (input.divergentInvoices / input.invoices) * 100 : null,
    priceVariationPercent:
      input.previousAverageCostCents && input.currentAverageCostCents !== null
        ? ((input.currentAverageCostCents - input.previousAverageCostCents) /
            input.previousAverageCostCents) *
          100
        : null,
  };
}
