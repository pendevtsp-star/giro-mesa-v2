import { createHash } from "node:crypto";
import {
  auditEvents,
  type createDatabase,
  fiscalDocumentArtifacts,
  fiscalDocumentEvents,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalProfiles,
  outboxEvents,
  validateFiscalArtifact,
  writeFiscalArtifact,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, type SecretEnvelope } from "@giromesa/domain";
import { and, eq, sql } from "drizzle-orm";
import type { ClaimedOutboxEvent } from "./outbox.js";

type Database = ReturnType<typeof createDatabase>["db"];
type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Environment = "homologation" | "production";
type FiscalStatus = FocusResult["status"] | "pending";

type FocusResult = {
  status: "processing" | "authorized" | "rejected" | "contingency" | "canceled";
  accessKey: string | null;
  number: number | null;
  series: string | null;
  taxCents: number | null;
  itemTaxCents: number[];
  xmlUrl: string | null;
  pdfUrl: string | null;
  code: string | null;
  message: string | null;
};

type FiscalLine = {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  revisionId: string | null;
  classification: Record<string, unknown> | null;
};

type FiscalPayment = {
  method: "cash" | "credit_card" | "debit_card" | "pix" | "other";
  amountCents: number;
};

export class FiscalDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = code,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "FiscalDeliveryError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cents(value: number) {
  return Number((value / 100).toFixed(2));
}

function paymentCode(method: FiscalPayment["method"]) {
  return { cash: "01", credit_card: "03", debit_card: "04", pix: "17", other: "99" }[method];
}

export function assertFiscalRuntimeEnvironment(
  environment: Environment,
  releaseEnvironment = process.env.FISCAL_RELEASE_ENV,
) {
  if (environment === "production" && releaseEnvironment !== "production") {
    throw new FiscalDeliveryError("FISCAL_PRODUCTION_RELEASE_BLOCKED", false);
  }
}

export function nextFiscalStatus(
  current: FiscalStatus,
  incoming: FocusResult["status"],
): FiscalStatus {
  if (current === "canceled") return "canceled";
  if (current === "authorized" && incoming !== "canceled") return "authorized";
  return incoming;
}

export function buildNfcePayload(input: {
  issuerDocument: string;
  issuedAt: Date;
  buyerPresence: 1 | 4;
  totalCents: number;
  extraCents: number;
  lines: FiscalLine[];
  payments: FiscalPayment[];
}) {
  if (!/^[A-Z0-9]{12}\d{2}$/i.test(input.issuerDocument)) {
    throw new FiscalDeliveryError("FISCAL_ISSUER_DOCUMENT_INVALID", false);
  }
  if (input.lines.length === 0) throw new FiscalDeliveryError("FISCAL_SALE_WITHOUT_ITEMS", false);
  if (input.payments.reduce((sum, item) => sum + item.amountCents, 0) !== input.totalCents) {
    throw new FiscalDeliveryError("FISCAL_PAYMENT_TOTAL_MISMATCH", false);
  }
  const items = input.lines.map((line, index) => {
    const classification = record(line.classification);
    const ncm = text(classification.ncm);
    const cfop = text(classification.cfop);
    const origin = Number(classification.origin);
    const icms = text(classification.csosn) ?? text(classification.cstIcms);
    const pis = text(classification.cstPis);
    const cofins = text(classification.cstCofins);
    const ibsCbs = text(classification.cstIbsCbs);
    const cClassTrib = text(classification.cClassTrib);
    if (Boolean(ibsCbs) !== Boolean(cClassTrib)) {
      throw new FiscalDeliveryError("FISCAL_IBS_CBS_CLASSIFICATION_INCOMPLETE", false);
    }
    if (
      !line.revisionId ||
      !ncm ||
      !cfop ||
      !Number.isInteger(origin) ||
      !icms ||
      !pis ||
      !cofins
    ) {
      throw new FiscalDeliveryError("FISCAL_PRODUCT_CLASSIFICATION_INCOMPLETE", false);
    }
    return {
      numero_item: index + 1,
      codigo_produto: line.sku ?? line.productId,
      descricao: line.productName,
      codigo_ncm: ncm,
      ...(text(classification.cest) ? { codigo_cest: text(classification.cest) } : {}),
      cfop,
      unidade_comercial: "UN",
      quantidade_comercial: line.quantity,
      valor_unitario_comercial: cents(line.unitPriceCents),
      unidade_tributavel: "UN",
      quantidade_tributavel: line.quantity,
      valor_unitario_tributavel: cents(line.unitPriceCents),
      valor_desconto: cents(line.discountCents),
      valor_outras_despesas: index === 0 ? cents(input.extraCents) : 0,
      icms_origem: origin,
      icms_situacao_tributaria: icms,
      pis_situacao_tributaria: pis,
      cofins_situacao_tributaria: cofins,
      ...(ibsCbs ? { ibs_cbs_situacao_tributaria: ibsCbs } : {}),
      ...(cClassTrib ? { ibs_cbs_classificacao_tributaria: cClassTrib } : {}),
    };
  });
  const itemTotal = input.lines.reduce((sum, line) => sum + line.netCents, 0) + input.extraCents;
  if (itemTotal !== input.totalCents) {
    throw new FiscalDeliveryError("FISCAL_ITEM_TOTAL_MISMATCH", false);
  }
  return {
    cnpj_emitente: input.issuerDocument.toUpperCase(),
    natureza_operacao: "VENDA",
    data_emissao: input.issuedAt.toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    local_destino: 1,
    presenca_comprador: input.buyerPresence,
    modalidade_frete: 9,
    items,
    formas_pagamento: input.payments.map((payment) => ({
      forma_pagamento: paymentCode(payment.method),
      valor_pagamento: cents(payment.amountCents),
      ...(payment.method === "other" ? { descricao_pagamento: "Outro" } : {}),
      ...(["credit_card", "debit_card"].includes(payment.method) ? { tipo_integracao: 2 } : {}),
    })),
  };
}

export function parseFocusDocument(value: unknown): FocusResult {
  const result = record(value);
  const raw = (text(result.status) ?? "").toLowerCase();
  const status = raw.includes("cancel")
    ? "canceled"
    : raw.includes("autoriz")
      ? "authorized"
      : raw.includes("process")
        ? "processing"
        : raw.includes("conting")
          ? "contingency"
          : "rejected";
  const integer = (candidate: unknown) => {
    const parsed = Number(candidate);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const tax = Number(String(result.valor_total_tributos ?? "").replace(",", "."));
  const requested = record(result.requisicao_nota_fiscal);
  const rawItems = Array.isArray(result.items)
    ? result.items
    : Array.isArray(requested.items)
      ? requested.items
      : [];
  const itemTaxCents = rawItems.map((item) => {
    const parsed = Number(String(record(item).valor_total_tributos ?? "").replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
  });
  return {
    status,
    accessKey: text(result.chave_nfe),
    number: integer(result.numero),
    series: text(result.serie),
    taxCents: Number.isFinite(tax) && tax >= 0 ? Math.round(tax * 100) : null,
    itemTaxCents,
    xmlUrl: text(result.caminho_xml_nota_fiscal) ?? text(result.caminho_xml_cancelamento),
    pdfUrl: text(result.caminho_danfe) ?? text(result.caminho_danfe_url),
    code: text(result.codigo),
    message: text(result.mensagem),
  };
}

async function focusJson(input: {
  path: string;
  environment: Environment;
  token: string;
  method?: "GET" | "POST";
  body?: unknown;
}) {
  assertFiscalRuntimeEnvironment(input.environment);
  const base =
    input.environment === "production"
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br";
  let response: Response;
  try {
    response = await fetch(`${base}${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${input.token}:`).toString("base64")}`,
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new FiscalDeliveryError("FOCUS_UNAVAILABLE", true);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024)
    throw new FiscalDeliveryError("FOCUS_RESPONSE_TOO_LARGE", false);
  let payload: unknown = {};
  try {
    payload = bytes.length ? JSON.parse(bytes.toString("utf8")) : {};
  } catch {
    throw new FiscalDeliveryError("FOCUS_RESPONSE_INVALID", response.status >= 500);
  }
  if (!response.ok) {
    const error = record(payload);
    const code = text(error.codigo) ?? `FOCUS_HTTP_${response.status}`;
    const message = text(error.mensagem) ?? code;
    throw new FiscalDeliveryError(
      code,
      response.status === 429 || response.status >= 500,
      message,
      response.status,
    );
  }
  return payload;
}

function decryptFocusToken(
  settings: unknown,
  environment: Environment,
  organizationId: string,
  unitId: string,
) {
  assertFiscalRuntimeEnvironment(environment);
  const connection = record(record(settings).focus);
  const envelope = record(
    environment === "production" ? connection.tokenProduction : connection.tokenHomologation,
  );
  if (
    connection.status !== "ready" ||
    record(connection.enabled).nfce !== true ||
    !text(envelope.encryptedSecret) ||
    !text(envelope.iv) ||
    !text(envelope.authTag)
  ) {
    return null;
  }
  return decryptSecret(
    envelope as unknown as SecretEnvelope,
    encryptionKey(
      process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY,
      "FISCAL_CREDENTIALS_ENCRYPTION_KEY",
    ),
    `focus:${organizationId}:${unitId}:${environment}`,
  );
}

async function lockOpenFiscalPeriod(
  tx: DatabaseTransaction,
  organizationId: string,
  unitId: string,
  competence: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`fiscal-period:${organizationId}:${unitId}:${competence}`}, 0))`,
  );
  const [period] = await tx.execute<{ status: string }>(sql`
    select status
    from fiscal_periods
    where organization_id = ${organizationId}
      and unit_id = ${unitId}
      and competence = ${competence}::date
    limit 1
  `);
  if (period?.status === "closed") {
    throw new FiscalDeliveryError("FISCAL_PERIOD_CLOSED", false);
  }
}

async function rejectDocument(
  db: Database,
  documentId: string,
  organizationId: string,
  unitId: string,
  code: string,
  message: string,
) {
  await db.transaction(async (tx) => {
    const [current] = await tx.execute<{ competence: string }>(sql`
      select to_char(date_trunc('month', documents.issued_at at time zone units.timezone), 'YYYY-MM-DD') as competence
      from fiscal_documents documents
      inner join units
        on units.organization_id = documents.organization_id and units.id = documents.unit_id
      where documents.id = ${documentId}
      limit 1
    `);
    if (!current) throw new FiscalDeliveryError("FISCAL_DOCUMENT_NOT_FOUND", false);
    await lockOpenFiscalPeriod(tx, organizationId, unitId, current.competence);
    await tx
      .update(fiscalDocuments)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(fiscalDocuments.id, documentId),
          sql`${fiscalDocuments.status} not in ('authorized', 'canceled')`,
        ),
      );
    await tx
      .insert(fiscalDocumentEvents)
      .values({
        organizationId,
        unitId,
        documentId,
        providerEventId: `internal:${documentId}:${code}`,
        type: "fiscal.document.validation_failed",
        status: "rejected",
        code: code.slice(0, 40),
        message,
        payload: {},
      })
      .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      action: "fiscal.document.validation_failed",
      entityType: "fiscal_document",
      entityId: documentId,
      metadata: { code },
    });
  });
}

async function persistResult(
  db: Database,
  document: { id: string; organizationId: string; unitId: string; providerReference: string },
  result: FocusResult,
) {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [scope] = await tx.execute<{
      competence: string;
    }>(sql`
      select to_char(date_trunc('month', documents.issued_at at time zone units.timezone), 'YYYY-MM-DD') as competence
      from fiscal_documents documents
      inner join units
        on units.organization_id = documents.organization_id and units.id = documents.unit_id
      where documents.id = ${document.id}
      limit 1
    `);
    if (!scope) throw new FiscalDeliveryError("FISCAL_DOCUMENT_NOT_FOUND", false);
    await lockOpenFiscalPeriod(tx, document.organizationId, document.unitId, scope.competence);
    const [current] = await tx.execute<{
      status: FiscalStatus;
      access_key: string | null;
      number: number | null;
      series: string | null;
      tax_cents: number;
      authorized_at: Date | null;
      canceled_at: Date | null;
    }>(sql`
      select documents.status,
             documents.access_key, documents.number, documents.series, documents.tax_cents,
             documents.authorized_at, documents.canceled_at
      from fiscal_documents documents
      where documents.id = ${document.id}
      limit 1
      for update
    `);
    if (!current) throw new FiscalDeliveryError("FISCAL_DOCUMENT_NOT_FOUND", false);
    const appliedStatus = nextFiscalStatus(current.status, result.status);
    const accepted = appliedStatus === result.status;
    await tx
      .update(fiscalDocuments)
      .set({
        status: appliedStatus,
        accessKey: accepted ? (result.accessKey ?? current.access_key) : current.access_key,
        number: accepted ? (result.number ?? current.number) : current.number,
        series: accepted ? (result.series ?? current.series) : current.series,
        taxCents: accepted ? (result.taxCents ?? current.tax_cents) : current.tax_cents,
        authorizedAt:
          appliedStatus === "authorized" || appliedStatus === "canceled"
            ? (current.authorized_at ?? (result.status === "authorized" ? now : null))
            : current.authorized_at,
        canceledAt:
          appliedStatus === "canceled" ? (current.canceled_at ?? now) : current.canceled_at,
        updatedAt: now,
      })
      .where(eq(fiscalDocuments.id, document.id));
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(result))
      .digest("hex")
      .slice(0, 32);
    await tx
      .insert(fiscalDocumentEvents)
      .values({
        organizationId: document.organizationId,
        unitId: document.unitId,
        documentId: document.id,
        providerEventId: `focus:${document.id}:${fingerprint}`,
        type: "fiscal.document.provider_result",
        status: appliedStatus,
        code: result.code,
        message: result.message,
        payload: { observedStatus: result.status, appliedStatus },
        occurredAt: now,
      })
      .onConflictDoNothing();
    for (const [index, itemTaxCents] of (accepted ? result.itemTaxCents : []).entries()) {
      await tx
        .update(fiscalDocumentItems)
        .set({ taxCents: itemTaxCents })
        .where(
          and(
            eq(fiscalDocumentItems.documentId, document.id),
            eq(fiscalDocumentItems.lineNumber, index + 1),
          ),
        );
    }
    if (accepted && (result.status === "processing" || result.status === "contingency")) {
      await tx.insert(outboxEvents).values({
        topic: "fiscal.document.reconcile_requested",
        aggregateType: "fiscal_document",
        aggregateId: document.id,
        payload: { organizationId: document.organizationId, unitId: document.unitId },
        availableAt: new Date(now.valueOf() + 30_000),
      });
    }
    if (accepted && (result.status === "authorized" || result.status === "canceled")) {
      await tx.insert(outboxEvents).values({
        topic: "fiscal.document.artifacts_requested",
        aggregateType: "fiscal_document",
        aggregateId: document.id,
        payload: {
          organizationId: document.organizationId,
          unitId: document.unitId,
          xmlUrl: result.xmlUrl,
          pdfUrl: result.pdfUrl,
          status: result.status,
        },
      });
    }
  });
}

async function issueClosedTab(db: Database, event: ClaimedOutboxEvent) {
  const organizationId = text(event.payload.organizationId);
  const unitId = text(event.payload.unitId);
  const tabId = text(event.payload.tabId);
  if (
    !organizationId ||
    !unitId ||
    !tabId ||
    !uuid.test(organizationId) ||
    !uuid.test(unitId) ||
    !uuid.test(tabId)
  ) {
    throw new FiscalDeliveryError("FISCAL_EVENT_INVALID", false);
  }
  const [profile] = await db.execute<{
    environment: Environment;
    provider: string | null;
    settings: unknown;
    issuer_document: string;
  }>(sql`
    select profiles.environment, profiles.provider, profiles.settings,
           entities.document as issuer_document
    from fiscal_profiles profiles
    inner join legal_entities entities
      on entities.organization_id = profiles.organization_id and entities.id = profiles.legal_entity_id
    where profiles.organization_id = ${organizationId} and profiles.unit_id = ${unitId}
    limit 1
  `);
  if (profile?.provider !== "focus") {
    throw new FiscalDeliveryError("FOCUS_PROFILE_NOT_READY", true);
  }
  const token = decryptFocusToken(profile.settings, profile.environment, organizationId, unitId);
  if (!token) throw new FiscalDeliveryError("FOCUS_COMPANY_TOKEN_MISSING", true);

  const idempotencyKey = `nfce:tab:${tabId}`;
  let [document] = await db.execute<{
    id: string;
    organization_id: string;
    unit_id: string;
    provider_reference: string;
    status: string;
    snapshot: Record<string, unknown>;
  }>(sql`
    select id, organization_id, unit_id, provider_reference, status, snapshot
    from fiscal_documents
    where organization_id = ${organizationId} and unit_id = ${unitId} and idempotency_key = ${idempotencyKey}
    limit 1
  `);
  if (!document) {
    const [tab] = await db.execute<{
      id: string;
      status: string;
      total_cents: number;
      subtotal_cents: number;
      discount_cents: number;
      service_charge_cents: number;
      tip_cents: number;
      fulfillment_type: string;
      closed_at: Date;
      competence: string;
    }>(sql`
      select id, status, total_cents, subtotal_cents, discount_cents, service_charge_cents,
             tip_cents, fulfillment_type, closed_at,
             to_char(date_trunc('month', closed_at at time zone (
               select timezone from units
               where organization_id = ${organizationId} and id = ${unitId}
             )), 'YYYY-MM-DD') as competence
      from pos_tabs
      where organization_id = ${organizationId} and unit_id = ${unitId} and id = ${tabId}
      limit 1
    `);
    if (tab?.status !== "closed" || !tab.closed_at)
      throw new FiscalDeliveryError("FISCAL_TAB_NOT_CLOSED", true);
    const rows = await db.execute<{
      id: string;
      product_id: string;
      product_name: string;
      sku: string | null;
      quantity: number;
      unit_price_cents: number;
      gross_cents: number;
      discount_cents: number;
      net_cents: number;
      revision_id: string | null;
      classification: Record<string, unknown> | null;
    }>(sql`
      select items.id, items.product_id, items.product_name, products.sku, items.quantity,
             items.unit_price_cents,
             items.gross_cents, items.discount_cents, items.net_cents,
             revision.id as revision_id, revision.classification
      from pos_order_items items
      inner join pos_orders orders
        on orders.organization_id = items.organization_id
       and orders.unit_id = items.unit_id
       and orders.id = items.order_id
      inner join pos_products products
        on products.organization_id = items.organization_id and products.id = items.product_id
      left join lateral (
        select revisions.id, revisions.classification
        from product_tax_revisions revisions
        where revisions.organization_id = items.organization_id
          and revisions.unit_id = items.unit_id
          and revisions.product_id = items.product_id
          and revisions.status = 'active'
          and revisions.effective_from <= (${tab.closed_at}::timestamptz at time zone 'UTC')::date
          and (revisions.effective_until is null or revisions.effective_until >= (${tab.closed_at}::timestamptz at time zone 'UTC')::date)
        order by revisions.version desc
        limit 1
      ) revision on true
      where orders.organization_id = ${organizationId}
        and orders.unit_id = ${unitId}
        and orders.tab_id = ${tabId}
        and items.status <> 'canceled'
      order by orders.created_at, items.created_at, items.id
    `);
    const payments = await db.execute<{
      method: FiscalPayment["method"];
      amount_cents: number;
    }>(sql`
      select payments.method,
             payments.amount_cents - coalesce(sum(reversals.amount_cents) filter (where reversals.status = 'approved'), 0)::int as amount_cents
      from pos_tab_payments payments
      left join pos_payment_reversals reversals
        on reversals.organization_id = payments.organization_id
       and reversals.unit_id = payments.unit_id
       and reversals.payment_id = payments.id
      where payments.organization_id = ${organizationId}
        and payments.unit_id = ${unitId}
        and payments.tab_id = ${tabId}
      group by payments.id, payments.method, payments.amount_cents
      having payments.amount_cents - coalesce(sum(reversals.amount_cents) filter (where reversals.status = 'approved'), 0)::int > 0
      order by payments.created_at, payments.id
    `);
    const lines: FiscalLine[] = [...rows].map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      quantity: row.quantity,
      unitPriceCents: Number(row.gross_cents) / Number(row.quantity),
      grossCents: Number(row.gross_cents),
      discountCents: Number(row.discount_cents),
      netCents: Number(row.net_cents),
      revisionId: row.revision_id,
      classification: row.classification,
    }));
    const fiscalPayments: FiscalPayment[] = [...payments].map((payment) => ({
      method: payment.method,
      amountCents: Number(payment.amount_cents),
    }));
    const operationalLossCents = Number(event.payload.operationalLossCents ?? 0);
    let payload: ReturnType<typeof buildNfcePayload>;
    try {
      if (operationalLossCents > 0)
        throw new FiscalDeliveryError("FISCAL_OPERATIONAL_LOSS_REQUIRES_REVIEW", false);
      payload = buildNfcePayload({
        issuerDocument: profile.issuer_document,
        issuedAt: new Date(),
        buyerPresence: tab.fulfillment_type === "delivery" ? 4 : 1,
        totalCents: Number(tab.total_cents),
        extraCents: Number(tab.service_charge_cents) + Number(tab.tip_cents),
        lines,
        payments: fiscalPayments,
      });
    } catch (error) {
      if (!(error instanceof FiscalDeliveryError)) throw error;
      const [created] = await db.transaction(async (tx) => {
        await lockOpenFiscalPeriod(tx, organizationId, unitId, tab.competence);
        return tx
          .insert(fiscalDocuments)
          .values({
            organizationId,
            unitId,
            tabId,
            model: "nfce",
            environment: profile.environment,
            status: "rejected",
            idempotencyKey,
            totalCents: Number(tab.total_cents),
            snapshot: { source: "pos.tab.closed", validationCode: error.code },
            issuedAt: new Date(tab.closed_at),
          })
          .onConflictDoNothing()
          .returning({ id: fiscalDocuments.id });
      });
      if (created)
        await rejectDocument(db, created.id, organizationId, unitId, error.code, error.message);
      return;
    }
    document = await db.transaction(async (tx) => {
      await lockOpenFiscalPeriod(tx, organizationId, unitId, tab.competence);
      const [created] = await tx
        .insert(fiscalDocuments)
        .values({
          organizationId,
          unitId,
          tabId,
          model: "nfce",
          environment: profile.environment,
          status: "pending",
          idempotencyKey,
          totalCents: Number(tab.total_cents),
          snapshot: { source: "pos.tab.closed", payload },
          issuedAt: new Date(tab.closed_at),
        })
        .onConflictDoNothing()
        .returning();
      const current =
        created ??
        (
          await tx
            .select()
            .from(fiscalDocuments)
            .where(
              and(
                eq(fiscalDocuments.organizationId, organizationId),
                eq(fiscalDocuments.unitId, unitId),
                eq(fiscalDocuments.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (!current) throw new FiscalDeliveryError("FISCAL_DOCUMENT_CREATE_FAILED", true);
      const reference = current.providerReference ?? `gm-${current.id}`;
      if (!current.providerReference) {
        await tx
          .update(fiscalDocuments)
          .set({ providerReference: reference })
          .where(eq(fiscalDocuments.id, current.id));
      }
      if (created) {
        await tx.insert(fiscalDocumentItems).values(
          lines.map((line, index) => ({
            organizationId,
            unitId,
            documentId: current.id,
            productId: line.productId,
            taxRevisionId: line.revisionId,
            lineNumber: index + 1,
            description: line.productName,
            quantityMilli: line.quantity * 1_000,
            unitPriceCents: Math.round(line.unitPriceCents),
            totalCents: line.netCents,
            taxSnapshot: line.classification ?? {},
          })),
        );
        await tx.insert(fiscalDocumentEvents).values({
          organizationId,
          unitId,
          documentId: current.id,
          providerEventId: `internal:${current.id}:queued`,
          type: "fiscal.document.issue_queued",
          status: "pending",
          payload: {},
        });
      }
      return {
        id: current.id,
        organization_id: organizationId,
        unit_id: unitId,
        provider_reference: reference,
        status: current.status,
        snapshot: created?.snapshot ?? current.snapshot,
      };
    });
  }
  if (["authorized", "canceled", "rejected"].includes(document.status)) return;
  const payload = record(document.snapshot).payload;
  if (!payload) throw new FiscalDeliveryError("FISCAL_SNAPSHOT_INVALID", false);
  let result: FocusResult;
  try {
    result = parseFocusDocument(
      await focusJson({
        path: `/v2/nfce?${new URLSearchParams({ ref: document.provider_reference, completa: "1" })}`,
        environment: profile.environment,
        token,
        method: "POST",
        body: payload,
      }),
    );
  } catch (error) {
    if (error instanceof FiscalDeliveryError && !error.retryable && error.httpStatus !== 404) {
      try {
        result = parseFocusDocument(
          await focusJson({
            path: `/v2/nfce/${encodeURIComponent(document.provider_reference)}?completa=1`,
            environment: profile.environment,
            token,
          }),
        );
        await persistResult(
          db,
          {
            id: document.id,
            organizationId,
            unitId,
            providerReference: document.provider_reference,
          },
          result,
        );
        return;
      } catch {
        // The initial provider rejection is the authoritative business result.
      }
    }
    if (error instanceof FiscalDeliveryError && !error.retryable) {
      await rejectDocument(db, document.id, organizationId, unitId, error.code, error.message);
      return;
    }
    throw error;
  }
  await persistResult(
    db,
    {
      id: document.id,
      organizationId,
      unitId,
      providerReference: document.provider_reference,
    },
    result,
  );
}

async function reconcileDocument(db: Database, event: ClaimedOutboxEvent) {
  if (!uuid.test(event.aggregate_id)) throw new FiscalDeliveryError("FISCAL_EVENT_INVALID", false);
  const [row] = await db.execute<{
    id: string;
    organization_id: string;
    unit_id: string;
    provider_reference: string | null;
    status: string;
    environment: Environment;
    settings: unknown;
  }>(sql`
    select documents.id, documents.organization_id, documents.unit_id, documents.provider_reference,
           documents.status, profiles.environment, profiles.settings
    from fiscal_documents documents
    inner join fiscal_profiles profiles
      on profiles.organization_id = documents.organization_id and profiles.unit_id = documents.unit_id
    where documents.id = ${event.aggregate_id}
    limit 1
  `);
  if (!row?.provider_reference || ["authorized", "canceled", "rejected"].includes(row.status))
    return;
  const token = decryptFocusToken(row.settings, row.environment, row.organization_id, row.unit_id);
  if (!token) throw new FiscalDeliveryError("FOCUS_COMPANY_TOKEN_MISSING", true);
  const result = parseFocusDocument(
    await focusJson({
      path: `/v2/nfce/${encodeURIComponent(row.provider_reference)}?completa=1`,
      environment: row.environment,
      token,
    }),
  );
  await persistResult(
    db,
    {
      id: row.id,
      organizationId: row.organization_id,
      unitId: row.unit_id,
      providerReference: row.provider_reference,
    },
    result,
  );
  if (result.status === "processing" || result.status === "contingency") {
    throw new FiscalDeliveryError("FOCUS_DOCUMENT_STILL_PROCESSING", true);
  }
}

async function downloadArtifact(url: string, environment: Environment, token: string) {
  let parsed: URL;
  try {
    parsed = new URL(
      url,
      environment === "production"
        ? "https://api.focusnfe.com.br"
        : "https://homologacao.focusnfe.com.br",
    );
  } catch {
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_URL_INVALID", false);
  }
  if (
    parsed.protocol !== "https:" ||
    !["api.focusnfe.com.br", "homologacao.focusnfe.com.br"].includes(parsed.hostname)
  ) {
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_URL_INVALID", false);
  }
  let response: Response;
  try {
    response = await fetch(parsed, {
      headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_UNAVAILABLE", true);
  }
  if (!response.ok)
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_UNAVAILABLE", response.status >= 500);
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > 15 * 1024 * 1024)
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_TOO_LARGE", false);
  return content;
}

async function persistArtifacts(db: Database, event: ClaimedOutboxEvent) {
  const organizationId = text(event.payload.organizationId);
  const unitId = text(event.payload.unitId);
  if (!organizationId || !unitId || !uuid.test(event.aggregate_id))
    throw new FiscalDeliveryError("FISCAL_EVENT_INVALID", false);
  const [document] = await db
    .select({ environment: fiscalDocuments.environment, settings: fiscalProfiles.settings })
    .from(fiscalDocuments)
    .innerJoin(
      fiscalProfiles,
      and(
        eq(fiscalProfiles.organizationId, fiscalDocuments.organizationId),
        eq(fiscalProfiles.unitId, fiscalDocuments.unitId),
      ),
    )
    .where(
      and(
        eq(fiscalDocuments.organizationId, organizationId),
        eq(fiscalDocuments.unitId, unitId),
        eq(fiscalDocuments.id, event.aggregate_id),
      ),
    )
    .limit(1);
  if (!document) throw new FiscalDeliveryError("FISCAL_DOCUMENT_NOT_FOUND", false);
  const token = decryptFocusToken(document.settings, document.environment, organizationId, unitId);
  if (!token) throw new FiscalDeliveryError("FOCUS_CREDENTIAL_NOT_READY", false);
  const status = event.payload.status === "canceled" ? "canceled" : "authorized";
  const candidates = [
    text(event.payload.xmlUrl)
      ? {
          kind:
            status === "canceled" ? ("cancellation_xml" as const) : ("authorization_xml" as const),
          url: text(event.payload.xmlUrl) as string,
          extension: "xml" as const,
          contentType: "application/xml",
        }
      : null,
    status === "authorized" && text(event.payload.pdfUrl)
      ? {
          kind: "danfe_pdf" as const,
          url: text(event.payload.pdfUrl) as string,
          extension: "pdf" as const,
          contentType: "application/pdf",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (candidates.length === 0) {
    throw new FiscalDeliveryError("FISCAL_ARTIFACT_URL_MISSING", true);
  }
  for (const artifact of candidates) {
    const content = await downloadArtifact(artifact.url, document.environment, token);
    validateFiscalArtifact(artifact.kind, content);
    const stored = await writeFiscalArtifact({
      root: process.env.MEDIA_ROOT,
      organizationId,
      unitId,
      namespace: "documents",
      entityId: event.aggregate_id,
      name: artifact.kind,
      extension: artifact.extension,
      content,
    });
    await db.transaction(async (tx) => {
      await tx
        .insert(fiscalDocumentArtifacts)
        .values({
          organizationId,
          unitId,
          documentId: event.aggregate_id,
          kind: artifact.kind,
          storageKey: stored.storageKey,
          sha256: stored.sha256,
          bytes: stored.bytes,
          contentType: artifact.contentType,
        })
        .onConflictDoUpdate({
          target: [fiscalDocumentArtifacts.documentId, fiscalDocumentArtifacts.kind],
          set: {
            storageKey: stored.storageKey,
            sha256: stored.sha256,
            bytes: stored.bytes,
            contentType: artifact.contentType,
          },
        });
      if (artifact.kind === "authorization_xml") {
        await tx
          .update(fiscalDocuments)
          .set({
            xmlStorageKey: stored.storageKey,
            xmlSha256: stored.sha256,
            updatedAt: new Date(),
          })
          .where(eq(fiscalDocuments.id, event.aggregate_id));
      }
    });
  }
}

export async function processFiscalEvent(db: Database, event: ClaimedOutboxEvent) {
  if (event.topic === "pos.tab.closed") return issueClosedTab(db, event);
  if (event.topic === "fiscal.document.reconcile_requested") return reconcileDocument(db, event);
  if (event.topic === "fiscal.document.artifacts_requested") return persistArtifacts(db, event);
}
