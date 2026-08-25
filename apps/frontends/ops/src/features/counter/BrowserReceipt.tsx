import type { PrintDocumentPayloadV2 } from "@giromesa/contracts";
import type { PrintDocumentType } from "../../api";
import { formatMoney } from "../../rules";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(row) : [];
}

function text(...values: unknown[]) {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value.trim() : null;
}

function integer(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function nullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function safeLogoUrl(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  return /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(candidate)
    ? candidate
    : null;
}

/**
 * Keeps the browser fallback tolerant to stale/partial queued jobs while returning the
 * canonical shared v2 contract consumed by the Edge formatter.
 */
export function normalizeBrowserReceiptPayload(payload: unknown): PrintDocumentPayloadV2 {
  const source = row(payload);
  const establishment = row(source.establishment);
  const context = row(source.context);
  const totals = row(source.totals);
  const split = row(source.split);
  const hasSplit = Object.keys(split).length > 0;

  return {
    schemaVersion: 2,
    generatedAt: text(source.generatedAt) ?? new Date(0).toISOString(),
    establishment: {
      displayName:
        text(establishment.displayName, establishment.tradeName, establishment.name) ?? "GIROMESA",
      legalName:
        text(establishment.legalName, establishment.displayName, establishment.tradeName) ??
        "GIROMESA",
      document: text(establishment.document, establishment.cnpj),
      address: text(establishment.address),
      phone: text(establishment.phone),
      openingHours: text(establishment.openingHours),
      timezone: text(establishment.timezone) ?? "America/Sao_Paulo",
      logoUrl: safeLogoUrl(establishment.logoUrl),
    },
    context: {
      tabId: text(context.tabId) ?? "unknown",
      label: text(context.label, context.tableLabel) ?? "Comanda",
      displayNumber: nullableInteger(context.displayNumber),
      tableLabel: text(context.tableLabel),
      areaName: text(context.areaName),
      squareName: text(context.squareName),
      waiterDisplayName: text(context.waiterDisplayName, context.waiterName),
      fulfillmentType: text(context.fulfillmentType) ?? "dine_in",
      guestCount: Math.max(0, integer(context.guestCount)),
      status: text(context.status) ?? "open",
      openedAt: text(context.openedAt) ?? new Date(0).toISOString(),
      closedAt: text(context.closedAt),
      durationMinutes: Math.max(0, integer(context.durationMinutes)),
    },
    totals: {
      subtotalCents: integer(totals.subtotalCents),
      discountCents: integer(totals.discountCents),
      serviceChargeCents: integer(totals.serviceChargeCents),
      serviceChargeBasisPoints: integer(totals.serviceChargeBasisPoints),
      serviceChargeOptional: totals.serviceChargeOptional === true,
      suggestedTotalCents: integer(totals.suggestedTotalCents),
      serviceTaxNotice: text(totals.serviceTaxNotice),
      tipCents: integer(totals.tipCents),
      totalCents: integer(totals.totalCents),
      grossPaidCents: integer(totals.grossPaidCents),
      reversedCents: integer(totals.reversedCents),
      paidCents: integer(totals.paidCents),
      remainingCents: integer(totals.remainingCents),
    },
    items: rows(source.items).map((item, index) => ({
      id: text(item.id) ?? `item-${index + 1}`,
      orderId: text(item.orderId) ?? "unknown",
      productName: text(item.productName, item.name) ?? "Item",
      quantity: Math.max(1, integer(item.quantity, 1)),
      unitPriceCents: integer(item.unitPriceCents),
      modifiersCents: integer(item.modifiersCents),
      grossCents: integer(item.grossCents),
      discountCents: integer(item.discountCents),
      netCents: integer(item.netCents),
      status: text(item.status) ?? "active",
      seatNumber: nullableInteger(item.seatNumber),
      course: text(item.course),
      modifiers: rows(item.modifiers).flatMap((modifier) => {
        const name = text(modifier.name, modifier.label);
        return name
          ? [
              {
                name,
                quantity: Math.max(1, integer(modifier.quantity, 1)),
                unitDeltaCents: integer(modifier.unitDeltaCents),
                totalDeltaCents: integer(modifier.totalDeltaCents),
              },
            ]
          : [];
      }),
    })),
    payments: rows(source.payments).flatMap((payment, index) => {
      const amountCents = integer(payment.amountCents);
      return amountCents > 0
        ? [
            {
              id: text(payment.id) ?? `payment-${index + 1}`,
              method: text(payment.method) ?? "other",
              amountCents,
              financialStatus: "posted" as const,
              createdAt: text(payment.createdAt) ?? new Date(0).toISOString(),
            },
          ]
        : [];
    }),
    ...(hasSplit
      ? {
          split: {
            splitId: text(split.splitId) ?? "unknown",
            partNumber: Math.max(1, integer(split.partNumber, 1)),
            partCount: Math.max(1, integer(split.partCount, 1)),
            amountCents: integer(split.amountCents),
            balanceSnapshotCents: integer(split.balanceSnapshotCents),
            method: text(split.method) ?? "equal_people",
          },
        }
      : {}),
  };
}

const documentLabels: Record<PrintDocumentType, string> = {
  partial_statement: "EXTRATO PARCIAL",
  payment_statement: "EXTRATO DE PAGAMENTOS",
  final_receipt: "COMPROVANTE FINAL",
};

const fulfillmentLabels: Record<string, string> = {
  dine_in: "Consumo no local",
  pickup: "Retirada",
  delivery: "Entrega",
};

const paymentLabels: Record<string, string> = {
  cash: "Dinheiro",
  credit_card: "Crédito",
  debit_card: "Débito",
  pix: "Pix",
  other: "Outro",
};

const splitLabels: Record<string, string> = {
  equal_people: "Partes iguais por pessoa",
  fixed_amount: "Valor fixo por parte",
};

function localDateTime(value: string, timezone: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString("pt-BR", {
        timeZone: timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function AmountRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="receipt-print-row">
      <span>{label}</span>
      <strong>{formatMoney(cents)}</strong>
    </div>
  );
}

export function BrowserReceipt({
  payload,
  documentType,
}: {
  payload: unknown;
  documentType: PrintDocumentType;
}) {
  const receipt = normalizeBrowserReceiptPayload(payload);
  const printedAt = localDateTime(receipt.generatedAt, receipt.establishment.timezone);
  const openedAt = localDateTime(receipt.context.openedAt, receipt.establishment.timezone);
  return (
    <article className="receipt-print-only" data-schema-version={receipt.schemaVersion}>
      <header className="receipt-print-brand">
        {receipt.establishment.logoUrl && <img alt="" src={receipt.establishment.logoUrl} />}
        <div>
          <strong>{receipt.establishment.displayName}</strong>
          <span>{receipt.establishment.legalName}</span>
          {receipt.establishment.document && <span>CNPJ: {receipt.establishment.document}</span>}
          {receipt.establishment.address && <span>END: {receipt.establishment.address}</span>}
          {receipt.establishment.phone && <span>TEL: {receipt.establishment.phone}</span>}
          {receipt.establishment.openingHours && (
            <span>HORÁRIO: {receipt.establishment.openingHours}</span>
          )}
        </div>
      </header>
      <h1>{documentLabels[documentType]}</h1>
      <hr />
      <h2>{receipt.context.label}</h2>
      <div className="receipt-print-context">
        <span>
          {fulfillmentLabels[receipt.context.fulfillmentType] ?? receipt.context.fulfillmentType}
          {receipt.context.guestCount > 0 ? ` · ${receipt.context.guestCount} pessoa(s)` : ""}
        </span>
        {receipt.context.areaName && <span>ÁREA: {receipt.context.areaName}</span>}
        {receipt.context.squareName && <span>PRAÇA: {receipt.context.squareName}</span>}
        {receipt.context.waiterDisplayName && (
          <span>ATENDENTE: {receipt.context.waiterDisplayName}</span>
        )}
        {openedAt && <span>INÍCIO: {openedAt}</span>}
        <span>TEMPO DE CONSUMO: {receipt.context.durationMinutes} min</span>
        {printedAt && <span>IMPRESSO: {printedAt}</span>}
      </div>
      <hr />
      {documentType !== "payment_statement" && (
        <section className="receipt-print-items" aria-label="Itens">
          {receipt.items
            .filter((item) => item.status !== "canceled")
            .map((item) => (
              <div className="receipt-print-item" key={item.id}>
                <div className="receipt-print-row">
                  <span>
                    {item.quantity}× {item.productName}
                  </span>
                  <strong>{formatMoney(item.netCents)}</strong>
                </div>
                {item.seatNumber !== null && <small>Pessoa {item.seatNumber}</small>}
                {item.modifiers.map((modifier) => (
                  <div
                    className="receipt-print-row receipt-print-modifier"
                    key={`${item.id}-${modifier.name}-${modifier.quantity}`}
                  >
                    <span>
                      + {modifier.quantity > 1 ? `${modifier.quantity}× ` : ""}
                      {modifier.name}
                    </span>
                    {modifier.totalDeltaCents !== 0 && (
                      <span>{formatMoney(modifier.totalDeltaCents)}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          <hr />
          <AmountRow cents={receipt.totals.subtotalCents} label="Subtotal" />
          {receipt.totals.discountCents !== 0 && (
            <AmountRow cents={receipt.totals.discountCents} label="Descontos" />
          )}
          {receipt.totals.serviceChargeCents !== 0 && (
            <AmountRow
              cents={receipt.totals.serviceChargeCents}
              label={receipt.totals.serviceChargeOptional ? "Serviço opcional" : "Serviço"}
            />
          )}
          {receipt.totals.tipCents !== 0 && (
            <AmountRow cents={receipt.totals.tipCents} label="Gorjeta" />
          )}
          {receipt.totals.serviceChargeOptional && receipt.totals.serviceChargeCents > 0 ? (
            <AmountRow cents={receipt.totals.suggestedTotalCents} label="TOTAL SUGERIDO" />
          ) : (
            <AmountRow cents={receipt.totals.totalCents} label="TOTAL" />
          )}
          {receipt.totals.serviceTaxNotice && <small>{receipt.totals.serviceTaxNotice}</small>}
        </section>
      )}
      {receipt.split && (
        <section className="receipt-print-split" aria-label="Divisão da conta">
          <hr />
          <strong>DIVISÃO DA CONTA</strong>
          <span>{splitLabels[receipt.split.method] ?? receipt.split.method}</span>
          <span>
            PARTE {receipt.split.partNumber} DE {receipt.split.partCount}
          </span>
          <AmountRow cents={receipt.split.amountCents} label="VALOR DESTA PARTE" />
        </section>
      )}
      {(documentType !== "partial_statement" || receipt.payments.length > 0) && (
        <section className="receipt-print-payments" aria-label="Pagamentos">
          <hr />
          <strong>PAGAMENTOS</strong>
          {receipt.payments.length ? (
            receipt.payments.map((payment) => (
              <AmountRow
                cents={payment.amountCents}
                key={payment.id}
                label={paymentLabels[payment.method] ?? payment.method}
              />
            ))
          ) : (
            <span>Nenhum pagamento registrado</span>
          )}
        </section>
      )}
      <hr />
      <AmountRow cents={receipt.totals.paidCents} label="Pago" />
      <AmountRow cents={receipt.totals.remainingCents} label="Saldo" />
      <footer className="receipt-print-footer">
        <strong>NÃO É DOCUMENTO FISCAL</strong>
        {documentType === "final_receipt" && <strong>ATENDIMENTO ENCERRADO</strong>}
      </footer>
    </article>
  );
}
