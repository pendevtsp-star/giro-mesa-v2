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
  const legacyTab = row(source.tab);
  const totals = row(source.totals);
  const split = row(source.split);
  const hasSplit = Object.keys(split).length > 0;
  const delivery = row(source.delivery);
  const address = row(delivery.address);
  const courier = row(delivery.courier);

  return {
    schemaVersion: 2,
    generatedAt: text(source.generatedAt) ?? "",
    establishment: {
      displayName:
        text(
          establishment.displayName,
          establishment.tradeName,
          establishment.name,
          source.establishmentName,
        ) ?? "GIROMESA",
      legalName: text(establishment.legalName) ?? "",
      document: text(establishment.document, establishment.cnpj),
      address: text(establishment.address),
      phone: text(establishment.phone),
      openingHours: text(establishment.openingHours),
      timezone: text(establishment.timezone) ?? "America/Sao_Paulo",
      logoUrl: safeLogoUrl(establishment.logoUrl),
    },
    context: {
      tabId: text(context.tabId, legacyTab.id) ?? "unknown",
      label: text(context.label, context.tableLabel, legacyTab.label) ?? "Comanda",
      displayNumber: nullableInteger(context.displayNumber),
      tableLabel: text(context.tableLabel),
      areaName: text(context.areaName),
      squareName: text(context.squareName),
      waiterDisplayName: text(context.waiterDisplayName, context.waiterName),
      fulfillmentType: text(context.fulfillmentType, legacyTab.fulfillmentType) ?? "",
      guestCount: Math.max(0, integer(context.guestCount ?? legacyTab.guestCount)),
      status: text(context.status, legacyTab.status) ?? "",
      openedAt: text(context.openedAt, legacyTab.openedAt) ?? "",
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
      deliveryFeeCents: integer(totals.deliveryFeeCents),
    },
    items: rows(source.items).map((item, index) => ({
      id: text(item.id) ?? `item-${index + 1}`,
      orderId: text(item.orderId) ?? "unknown",
      productName: text(item.productName, item.name) ?? "Item",
      quantity: Math.max(1, integer(item.quantity, 1)),
      unitPriceCents: integer(item.unitPriceCents),
      modifiersCents: integer(item.modifiersCents),
      grossCents:
        nullableInteger(item.grossCents) ?? integer(item.netCents) + integer(item.discountCents),
      discountCents: integer(item.discountCents),
      netCents: integer(item.netCents),
      status: text(item.status) ?? "active",
      seatNumber: nullableInteger(item.seatNumber),
      course: text(item.course),
      notes: text(item.notes),
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
      const reversedCents = Math.max(0, integer(payment.reversedCents));
      const amountCents =
        nullableInteger(payment.netAmountCents) ??
        Math.max(0, integer(payment.amountCents) - reversedCents);
      const receivedCents = payment.receivedCents;
      const changeCents = payment.changeCents;
      const cashExchange =
        payment.method === "cash" &&
        typeof receivedCents === "number" &&
        Number.isSafeInteger(receivedCents) &&
        receivedCents > 0 &&
        typeof changeCents === "number" &&
        Number.isSafeInteger(changeCents) &&
        changeCents >= 0 &&
        receivedCents - changeCents === amountCents + reversedCents
          ? { receivedCents, changeCents }
          : {};
      return amountCents > 0 || reversedCents > 0
        ? [
            {
              id: text(payment.id) ?? `payment-${index + 1}`,
              method: text(payment.method) ?? "other",
              amountCents,
              netAmountCents: amountCents,
              reversedCents,
              ...cashExchange,
              financialStatus: "posted" as const,
              createdAt: text(payment.createdAt) ?? new Date(0).toISOString(),
            },
          ]
        : [];
    }),
    print: { isReprint: row(source.print).isReprint === true },
    ...(Object.keys(delivery).length > 0
      ? {
          delivery: {
            orderId: text(delivery.orderId) ?? "unknown",
            status: text(delivery.status) ?? "",
            customerName: text(delivery.customerName),
            customerPhone: text(delivery.customerPhone),
            address: {
              street: text(address.street) ?? "",
              number: text(address.number) ?? "",
              complement: text(address.complement) ?? undefined,
              reference: text(address.reference) ?? undefined,
              neighborhood: text(address.neighborhood) ?? "",
              city: text(address.city) ?? "",
              state: text(address.state) ?? "",
              postalCode: text(address.postalCode) ?? "",
            },
            notes: text(delivery.notes),
            promisedAt: text(delivery.promisedAt),
            courier:
              Object.keys(courier).length > 0
                ? {
                    name: text(courier.name) ?? "",
                    reference: text(courier.reference) ?? "",
                    phone: text(courier.phone),
                  }
                : null,
          },
        }
      : {}),
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
  partial_statement: "PRÉ-CONTA",
  payment_statement: "EXTRATO DE PAGAMENTOS",
  final_receipt: "COMPROVANTE FINAL",
  delivery_slip: "VIA DE ENTREGA",
};

const fulfillmentLabels: Record<string, string> = {
  dine_in: "Consumo no local",
  pickup: "Retirada",
  takeaway: "Retirada",
  counter: "Balcão",
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

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  placed: "Recebido",
  confirmed: "Confirmado",
  completed: "Entregue",
  queued: "Pendente",
  in_progress: "Em preparo",
  served: "Entregue",
  open: "Aberto",
  closed: "Encerrado",
  pending: "Pendente",
  accepted: "Aceito",
  preparing: "Em preparo",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  dispatched: "Saiu para entrega",
  delivered: "Entregue",
  canceled: "Cancelado",
  delivery_failed: "Entrega não concluída",
  returned: "Devolvido",
};

function localDateTime(value: string, timezone: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return parsed.toLocaleString("pt-BR", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
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
  const delivery = documentType === "delivery_slip" ? receipt.delivery : undefined;
  const promisedAt = delivery?.promisedAt
    ? localDateTime(delivery.promisedAt, receipt.establishment.timezone)
    : null;
  return (
    <article
      className="receipt-print-only"
      data-document-type={documentType}
      data-schema-version={receipt.schemaVersion}
    >
      <header className="receipt-print-brand">
        {receipt.establishment.logoUrl && (
          <img
            alt=""
            src={receipt.establishment.logoUrl}
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
        <div>
          <strong>{receipt.establishment.displayName}</strong>
          {receipt.establishment.legalName &&
            receipt.establishment.legalName.toLocaleLowerCase() !==
              receipt.establishment.displayName.toLocaleLowerCase() && (
              <span>{receipt.establishment.legalName}</span>
            )}
          {receipt.establishment.document && <span>CNPJ: {receipt.establishment.document}</span>}
          {receipt.establishment.address && <span>END: {receipt.establishment.address}</span>}
          {receipt.establishment.phone && <span>TEL: {receipt.establishment.phone}</span>}
          {receipt.establishment.openingHours && (
            <span>HORÁRIO: {receipt.establishment.openingHours}</span>
          )}
        </div>
      </header>
      {receipt.print?.isReprint && (
        <p className="receipt-print-reprint">
          <strong>SEGUNDA VIA</strong>
        </p>
      )}
      <h1>{documentLabels[documentType]}</h1>
      <hr />
      <h2>{receipt.context.label}</h2>
      {receipt.context.tableLabel && receipt.context.tableLabel !== receipt.context.label && (
        <h2>{receipt.context.tableLabel}</h2>
      )}
      {receipt.context.displayNumber !== null && (
        <p>
          <strong>PEDIDO {receipt.context.displayNumber}</strong>
        </p>
      )}
      <div className="receipt-print-context">
        <span>
          {fulfillmentLabels[receipt.context.fulfillmentType] ?? receipt.context.fulfillmentType}
          {receipt.context.guestCount > 0 ? ` · ${receipt.context.guestCount} pessoa(s)` : ""}
        </span>
        {receipt.context.status && (
          <span>STATUS: {statusLabels[receipt.context.status] ?? receipt.context.status}</span>
        )}
        {receipt.context.areaName && <span>ÁREA: {receipt.context.areaName}</span>}
        {receipt.context.squareName && <span>PRAÇA: {receipt.context.squareName}</span>}
        {receipt.context.waiterDisplayName && (
          <span>ATENDENTE: {receipt.context.waiterDisplayName}</span>
        )}
        {openedAt && <span>INÍCIO: {openedAt}</span>}
        {documentType !== "delivery_slip" && receipt.context.durationMinutes > 0 && (
          <span>TEMPO DE CONSUMO: {receipt.context.durationMinutes} min</span>
        )}
        {printedAt && <span>IMPRESSO: {printedAt}</span>}
      </div>
      {delivery && (
        <section className="receipt-print-context" aria-label="Dados da entrega">
          <hr />
          {delivery.status && (
            <strong>ENTREGA: {statusLabels[delivery.status] ?? delivery.status}</strong>
          )}
          {delivery.customerName && <strong>CLIENTE: {delivery.customerName}</strong>}
          {delivery.customerPhone && <span>TEL: {delivery.customerPhone}</span>}
          {delivery.address.street && <span>RUA: {delivery.address.street}</span>}
          {delivery.address.number && <span>NÚMERO: {delivery.address.number}</span>}
          {delivery.address.complement && <span>COMPLEMENTO: {delivery.address.complement}</span>}
          {delivery.address.neighborhood && <span>BAIRRO: {delivery.address.neighborhood}</span>}
          {(delivery.address.city || delivery.address.state) && (
            <span>
              {[delivery.address.city, delivery.address.state].filter(Boolean).join(" / ")}
            </span>
          )}
          {delivery.address.postalCode && <span>CEP: {delivery.address.postalCode}</span>}
          {delivery.address.reference && <span>REFERÊNCIA: {delivery.address.reference}</span>}
          {delivery.courier?.name && <span>ENTREGADOR: {delivery.courier.name}</span>}
          {delivery.courier?.phone && <span>CONTATO: {delivery.courier.phone}</span>}
          {delivery.notes && <strong>OBS: {delivery.notes}</strong>}
          {promisedAt && <span>PREVISÃO: {promisedAt}</span>}
        </section>
      )}
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
                  <strong>{formatMoney(item.grossCents)}</strong>
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
                {documentType === "delivery_slip" && item.notes && <small>OBS: {item.notes}</small>}
              </div>
            ))}
          <hr />
          <AmountRow cents={receipt.totals.subtotalCents} label="Subtotal" />
          {receipt.totals.discountCents !== 0 && (
            <AmountRow cents={-receipt.totals.discountCents} label="Descontos" />
          )}
          {!!receipt.totals.deliveryFeeCents && (
            <AmountRow cents={receipt.totals.deliveryFeeCents} label="Taxa de entrega" />
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
          {documentType === "partial_statement" &&
          receipt.totals.serviceChargeOptional &&
          receipt.totals.serviceChargeCents > 0 ? (
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
              <div key={payment.id}>
                <AmountRow
                  cents={payment.amountCents}
                  label={`${paymentLabels[payment.method] ?? payment.method}${payment.reversedCents ? " (líquido)" : ""}`}
                />
                {!!payment.reversedCents && (
                  <AmountRow cents={payment.reversedCents} label="Estornado" />
                )}
                {payment.receivedCents != null && payment.changeCents != null && (
                  <>
                    {!!payment.reversedCents && <small>Recebimento original</small>}
                    <AmountRow cents={payment.receivedCents} label="Recebido em dinheiro" />
                    <AmountRow cents={payment.changeCents} label="Troco" />
                  </>
                )}
              </div>
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
