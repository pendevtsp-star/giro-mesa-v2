import { parsePilotCatalog } from "../../operations.shared";

export type FiscalTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface FiscalProfile {
  legalEntityId: string;
  taxRegime: "simples_nacional" | "simples_excesso" | "lucro_presumido" | "lucro_real";
  crt: string;
  municipalRegistration: string | null;
  cnae: string | null;
  stateCode: string;
  cityCode: string;
  environment: "homologation" | "production";
  provider: "focus" | null;
  series: { nfce: string; nfe: string; nfse: string };
}

export interface FiscalDashboard {
  provider: {
    status:
      | "platform_not_configured"
      | "profile_required"
      | "company_required"
      | "credentials_missing"
      | "ready"
      | "error";
    environment: "homologation" | "production" | null;
    lastSyncAt: string | null;
    nextAction: string;
    registered: boolean;
    certificateValidUntil: string | null;
    environments: { homologation: boolean; production: boolean };
  };
  summary: {
    authorizedCount: number;
    rejectedCount: number;
    pendingCount: number;
    contingencyCount: number;
    totalCents: number;
  };
  pending: Array<{
    id: string;
    title: string;
    detail: string;
    severity: "info" | "warning" | "critical";
  }>;
}

export interface FiscalDocument {
  id: string;
  model: "nfce" | "nfe" | "nfse";
  number: string;
  series: string;
  status: "pending" | "authorized" | "rejected" | "processing" | "canceled" | "contingency";
  recipientName: string | null;
  totalCents: number;
  issuedAt: string;
  accessKey: string | null;
}

export interface FiscalDocumentDetail extends FiscalDocument {
  tabId: string | null;
  orderId: string | null;
  taxCents: number;
  authorizedAt: string | null;
  canceledAt: string | null;
  items: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantityMilli: number;
    unitPriceCents: number;
    totalCents: number;
    taxCents: number;
  }>;
  events: Array<{
    id: string;
    type: string;
    status: string | null;
    code: string | null;
    message: string | null;
    occurredAt: string;
  }>;
  artifacts: Array<{
    kind: "authorization_xml" | "cancellation_xml" | "danfe_pdf";
    sha256: string;
    bytes: number;
    contentType: string;
  }>;
}

export interface FiscalPeriod {
  competence: string;
  status: "open" | "reviewing" | "closed";
  authorizedCount: number;
  canceledCount: number;
  grossTotalCents: number;
  closedAt: string | null;
  blockers: string[];
}

export interface AccountingPackage {
  competence: string;
  status: "pending" | "ready" | "failed";
  generatedAt: string | null;
  files: Array<{ name: string; sizeBytes: number }>;
}

export interface AccountantRequest {
  id: string;
  competence: string;
  title: string;
  detail: string;
  status: "open" | "resolved";
  dueAt: string | null;
  createdAt: string;
  requestedBy: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  targetAudience: "accountant" | "establishment";
  attachments: AccountantAttachment[];
}

export interface AccountantAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export type AccountantRequestFilter = "all" | "open" | "overdue" | "resolved";
export type AccountantAttachmentContentType =
  | "application/pdf"
  | "application/xml"
  | "text/xml"
  | "text/csv"
  | "image/jpeg"
  | "image/png";

export interface FiscalWorkspace {
  profile: FiscalProfile | null;
  taxRevisions: Array<{ productId: string; status: "draft" | "active" | "revoked" }>;
  products: Array<{ id: string; name: string; categoryId: string; categoryName: string }>;
  dashboard: FiscalDashboard;
  documents: FiscalDocument[];
  periods: FiscalPeriod[];
  numberInvalidations: Array<{
    id: string;
    series: string;
    initialNumber: number;
    finalNumber: number;
    justification: string;
    status: "processing" | "invalidated" | "rejected";
    errorMessage: string | null;
    processedAt: string | null;
    createdAt: string;
  }>;
}

export interface AccountantWorkspace {
  periods: FiscalPeriod[];
  accountingPackage: AccountingPackage | null;
  requests: AccountantRequest[];
  pagination: { page: number; pageSize: number; total: number } | null;
}

export class InvalidFiscalPayloadError extends Error {
  constructor() {
    super("Os dados fiscais vieram incompletos. Atualize a página ou contate o suporte.");
    this.name = "InvalidFiscalPayloadError";
  }
}

export function parseFiscalWorkspace(value: unknown): FiscalWorkspace {
  const payload = record(value);
  const dashboard = record(payload.dashboard);
  const statuses = record(dashboard.documentsByStatus);
  const products = record(dashboard.products);
  const documents = parseDocuments(payload.documents);
  const catalog = parsePilotCatalog(payload.catalog);
  const categories = new Map(catalog.categories.map((category) => [category.id, category.name]));
  const authorizedCount = optionalCount(statuses.authorized);
  const rejectedCount = optionalCount(statuses.rejected);
  const pendingCount = count(dashboard.pendingDocuments);
  const contingencyCount = optionalCount(statuses.contingency);
  const missingClassification = count(products.missingClassification);
  const openAccountantRequests = count(dashboard.openAccountantRequests);
  const provider = parseProviderStatus(payload.provider);
  return {
    profile: payload.profile === null ? null : parseFiscalProfile(payload.profile),
    taxRevisions: collection(payload.taxRevisions).map((item) => ({
      productId: text(item.productId),
      status: oneOf(item.status, ["draft", "active", "revoked"]),
    })),
    products: catalog.products
      .filter((product) => product.active)
      .map((product) => ({
        id: product.id,
        name: product.name,
        categoryId: product.categoryId,
        categoryName: categories.get(product.categoryId) ?? "Sem categoria",
      })),
    dashboard: {
      provider,
      summary: {
        authorizedCount,
        rejectedCount,
        pendingCount,
        contingencyCount,
        totalCents: documents
          .filter((item) => item.status === "authorized")
          .reduce((sum, item) => sum + item.totalCents, 0),
      },
      pending: [
        ...(rejectedCount
          ? [
              {
                id: "rejected",
                title: `${rejectedCount} documento(s) rejeitado(s)`,
                detail: "Consulte os documentos e corrija a causa antes do fechamento.",
                severity: "critical" as const,
              },
            ]
          : []),
        ...(pendingCount
          ? [
              {
                id: "pending",
                title: `${pendingCount} documento(s) em processamento ou contingência`,
                detail: "Aguarde autorização ou trate a pendência antes de fechar.",
                severity: "warning" as const,
              },
            ]
          : []),
        ...(missingClassification
          ? [
              {
                id: "classification",
                title: `${missingClassification} produto(s) sem classificação fiscal ativa`,
                detail: "Complete a classificação tributária antes da próxima emissão.",
                severity: "warning" as const,
              },
            ]
          : []),
        ...(openAccountantRequests
          ? [
              {
                id: "accountant",
                title: accountantOpenRequestTitle(openAccountantRequests),
                detail: "Consulte o Portal do contador para responder às pendências.",
                severity: "info" as const,
              },
            ]
          : []),
      ],
    },
    documents,
    periods: parsePeriods(payload.periods, documents),
    numberInvalidations: (payload.numberInvalidations === undefined
      ? []
      : collection(payload.numberInvalidations)
    ).map((item) => ({
      id: text(item.id),
      series: text(item.series),
      initialNumber: count(item.initialNumber),
      finalNumber: count(item.finalNumber),
      justification: text(item.justification),
      status: oneOf(item.status, ["processing", "invalidated", "rejected"]),
      errorMessage: optionalText(item.errorMessage),
      processedAt: optionalText(item.processedAt),
      createdAt: text(item.createdAt),
    })),
  };
}

export function parseFiscalDocumentDetail(value: unknown): FiscalDocumentDetail {
  const item = record(value);
  const [document] = parseDocuments([item]);
  if (!document) throw new InvalidFiscalPayloadError();
  return {
    ...document,
    tabId: optionalText(item.tabId),
    orderId: optionalText(item.orderId),
    taxCents: count(item.taxCents),
    authorizedAt: optionalText(item.authorizedAt),
    canceledAt: optionalText(item.canceledAt),
    items: collection(item.items).map((row) => ({
      id: text(row.id),
      lineNumber: count(row.lineNumber),
      description: text(row.description),
      quantityMilli: count(row.quantityMilli),
      unitPriceCents: count(row.unitPriceCents),
      totalCents: count(row.totalCents),
      taxCents: count(row.taxCents),
    })),
    events: collection(item.events).map((row) => ({
      id: text(row.id),
      type: text(row.type),
      status: optionalText(row.status),
      code: optionalText(row.code),
      message: optionalText(row.message),
      occurredAt: text(row.occurredAt),
    })),
    artifacts: (item.artifacts === undefined ? [] : collection(item.artifacts)).map((row) => ({
      kind: oneOf(row.kind, ["authorization_xml", "cancellation_xml", "danfe_pdf"]),
      sha256: text(row.sha256),
      bytes: count(row.bytes),
      contentType: text(row.contentType),
    })),
  };
}

export function fiscalRejectionGuidance(code: string | null, message: string | null): string {
  const reason = `${code ?? ""} ${message ?? ""}`.toLocaleLowerCase("pt-BR");
  if (/inscri[cç][aã]o|cadastro|ie\b/.test(reason)) {
    return "Revise a inscrição estadual e o cadastro fiscal da empresa.";
  }
  if (/ncm|cest|cfop|classifica[cç][aã]o/.test(reason)) {
    return "Revise a classificação fiscal dos produtos desta nota.";
  }
  if (/certificado|csc/.test(reason)) {
    return "Atualize o certificado A1 ou o CSC antes de tentar novamente.";
  }
  if (/duplic|j[aá] existe/.test(reason)) {
    return "A nota pode já ter sido enviada. Atualize a situação antes de tentar novamente.";
  }
  if (/timeout|tempo limite|processando/.test(reason)) {
    return "A autorização ainda pode estar em andamento. Aguarde e atualize a situação.";
  }
  return "Revise os dados da nota e, depois da correção, atualize a situação.";
}

function parseProviderStatus(value: unknown): FiscalDashboard["provider"] {
  const provider = record(value);
  const connection = provider.connection === null ? null : record(provider.connection);
  const environments = connection ? record(connection.environments) : {};
  return {
    status: oneOf(provider.status, [
      "platform_not_configured",
      "profile_required",
      "company_required",
      "credentials_missing",
      "ready",
      "error",
    ]),
    environment:
      provider.environment === null
        ? null
        : oneOf(provider.environment, ["homologation", "production"]),
    lastSyncAt: connection ? optionalText(connection.lastCheckedAt) : null,
    nextAction: text(provider.nextAction),
    registered: connection?.registered === true,
    certificateValidUntil: connection ? optionalText(connection.certificateValidUntil) : null,
    environments: {
      homologation: environments.homologation === true,
      production: environments.production === true,
    },
  };
}

function parseFiscalProfile(value: unknown): FiscalProfile {
  const profile = record(value);
  const settings = record(profile.settings);
  const series = settings.series === undefined ? {} : record(settings.series);
  return {
    legalEntityId: text(profile.legalEntityId),
    taxRegime: oneOf(profile.taxRegime, [
      "simples_nacional",
      "simples_excesso",
      "lucro_presumido",
      "lucro_real",
    ]),
    crt: text(profile.crt),
    municipalRegistration: optionalText(profile.municipalRegistration),
    cnae: optionalText(profile.cnae),
    stateCode: draftText(profile.stateCode),
    cityCode: draftText(profile.cityCode),
    environment: oneOf(profile.environment, ["homologation", "production"]),
    provider: profile.provider === null ? null : oneOf(profile.provider, ["focus"]),
    series: {
      nfce: optionalText(series.nfce) ?? "",
      nfe: optionalText(series.nfe) ?? "",
      nfse: optionalText(series.nfse) ?? "",
    },
  };
}

export function parseAccountantWorkspace(value: unknown): AccountantWorkspace {
  const payload = record(value);
  const requests = collection(payload.requests).map(parseAccountantRequest);
  return {
    periods: parsePeriods(payload.periods),
    accountingPackage:
      payload.accountingPackage === null ? null : parseAccountingPackage(payload.accountingPackage),
    requests,
    pagination: Array.isArray(payload.requests)
      ? null
      : parseAccountantPagination(record(payload.requests).pagination),
  };
}

function parseAccountantPagination(value: unknown): AccountantWorkspace["pagination"] {
  if (value === undefined) return null;
  const pagination = record(value);
  const page = count(pagination.page);
  const pageSize = count(pagination.pageSize);
  if (page < 1 || pageSize < 1) throw new InvalidFiscalPayloadError();
  return { page, pageSize, total: count(pagination.total) };
}

function parseDocuments(value: unknown): FiscalDocument[] {
  return collection(value).map((item) => ({
    id: text(item.id),
    model: oneOf(item.model, ["nfce", "nfe", "nfse"]),
    number: nullableNumberLabel(item.number),
    series: optionalText(item.series) ?? "—",
    status: oneOf(item.status, [
      "pending",
      "authorized",
      "rejected",
      "processing",
      "canceled",
      "contingency",
    ]),
    recipientName: optionalText(item.customerDocument),
    totalCents: count(item.totalCents),
    issuedAt: text(item.issuedAt),
    accessKey: optionalText(item.accessKey),
  }));
}

function parsePeriods(value: unknown, documents: FiscalDocument[] = []): FiscalPeriod[] {
  return collection(value).map((item) => {
    const periodCompetence = competenceDate(item.competence);
    const periodDocuments = documents.filter((document) =>
      document.issuedAt.startsWith(periodCompetence),
    );
    return {
      competence: periodCompetence,
      status: oneOf(item.status, ["open", "reviewing", "closed"]),
      authorizedCount:
        item.authorizedCount === undefined
          ? periodDocuments.filter((document) => document.status === "authorized").length
          : count(item.authorizedCount),
      canceledCount:
        item.canceledCount === undefined
          ? periodDocuments.filter((document) => document.status === "canceled").length
          : count(item.canceledCount),
      grossTotalCents:
        item.grossTotalCents === undefined
          ? periodDocuments
              .filter((document) => document.status === "authorized")
              .reduce((sum, document) => sum + document.totalCents, 0)
          : count(item.grossTotalCents),
      closedAt: optionalText(item.closedAt),
      blockers: parsePeriodBlockers(item.blockers, documents, periodCompetence),
    };
  });
}

function parsePeriodBlockers(
  value: unknown,
  documents: FiscalDocument[],
  competence: string,
): string[] {
  if (value === undefined) return pendingBlockers(documents, competence);
  if (Array.isArray(value)) return stringList(value);

  const blockers = record(value);
  const total = count(blockers.count);
  const rejected = count(blockers.rejectedCount);
  if (rejected > total) throw new InvalidFiscalPayloadError();

  return [
    ...(rejected ? [`${rejected} documento(s) rejeitado(s)`] : []),
    ...(total > rejected ? [`${total - rejected} documento(s) pendente(s)`] : []),
  ];
}

function parseAccountingPackage(value: unknown): AccountingPackage | null {
  const payload = record(value);
  if (payload.status === "unavailable") return null;
  const packageCompetence = payload.competence ?? record(payload.period).competence;
  const accountingPackage =
    payload.accountingPackage === undefined ? payload : record(payload.accountingPackage);
  const competence = competenceDate(packageCompetence);
  const packageStatus = payload.status ?? accountingPackage.status;
  return {
    competence,
    status:
      packageStatus === "available"
        ? "ready"
        : oneOf(packageStatus, ["pending", "ready", "failed"]),
    generatedAt: optionalText(accountingPackage.generatedAt ?? payload.closedAt),
    files: parseAccountingPackageFiles(accountingPackage.files, competence),
  };
}

function parseAccountingPackageFiles(
  value: unknown,
  competence: string,
): AccountingPackage["files"] {
  if (value === undefined) return [{ name: `pacote-contabil-${competence}.zip`, sizeBytes: 0 }];
  if (!Array.isArray(value)) throw new InvalidFiscalPayloadError();
  return value.map((item) => {
    if (typeof item === "string") return { name: text(item), sizeBytes: 0 };
    const file = record(item);
    return {
      name: text(file.name),
      sizeBytes: file.sizeBytes === undefined ? 0 : count(file.sizeBytes),
    };
  });
}

function parseAccountantRequest(item: Record<string, unknown>): AccountantRequest {
  return {
    id: text(item.id),
    competence: competenceDate(item.competence),
    title: text(item.title),
    detail: text(item.description ?? item.detail),
    status: oneOf(item.status, ["open", "resolved"]),
    dueAt: optionalText(item.dueDate ?? item.dueAt),
    createdAt: text(item.createdAt),
    requestedBy: optionalText(item.createdByName ?? item.requestedBy),
    resolution: optionalText(item.resolution),
    resolvedAt: optionalText(item.resolvedAt),
    resolvedBy: optionalText(item.resolvedByName ?? item.resolvedBy),
    targetAudience:
      item.targetAudience === undefined
        ? "accountant"
        : oneOf(item.targetAudience, ["accountant", "establishment"]),
    attachments:
      item.attachments === undefined
        ? []
        : collection(item.attachments).map((attachment) => ({
            id: text(attachment.id),
            fileName: text(attachment.fileName ?? attachment.name),
            contentType: text(attachment.contentType ?? attachment.mimeType),
            sizeBytes: count(attachment.sizeBytes ?? attachment.bytes),
            createdAt: text(attachment.createdAt),
          })),
  };
}

export function accountantOpenRequestTitle(count: number): string {
  return count === 1
    ? "1 solicitação do contador aberta"
    : `${count} solicitações do contador abertas`;
}

export function accountantRequestStatusLabel(request: AccountantRequest): string {
  if (request.status === "resolved") return "Resolvida";
  return request.targetAudience === "accountant" ? "Aguardando contador" : "Aguardando empresa";
}

export function canResolveAccountantRequest(
  request: AccountantRequest,
  audience: "accountant" | "establishment",
): boolean {
  return request.status === "open" && request.targetAudience === audience;
}

export function accountantRequestViewFromHash(hash: string): {
  filter: AccountantRequestFilter;
  page: number;
  targetAudience?: "accountant" | "establishment";
} {
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  const status = params.get("status");
  const filter: AccountantRequestFilter =
    status === "open" || status === "overdue" || status === "resolved" ? status : "all";
  const parsedPage = Number(params.get("page"));
  const targetAudience = params.get("targetAudience");
  return {
    filter,
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    ...(targetAudience === "accountant" || targetAudience === "establishment"
      ? { targetAudience }
      : {}),
  };
}

export function accountantRequestHref(
  filter: AccountantRequestFilter,
  page: number,
  targetAudience?: "accountant" | "establishment",
): string {
  return `#/accountant?${new URLSearchParams({
    status: filter,
    page: String(Math.max(1, page)),
    ...(targetAudience ? { targetAudience } : {}),
  })}`;
}

export function validateAccountantAttachment(file: {
  name: string;
  type: string;
  size: number;
}):
  | { valid: true; contentType: AccountantAttachmentContentType }
  | { valid: false; message: string } {
  if (
    !file.name ||
    file.name.length > 180 ||
    [...file.name].some(
      (character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character),
    )
  ) {
    return { valid: false, message: "Use um nome de arquivo válido com até 180 caracteres." };
  }
  if (file.size < 1 || file.size > 3 * 1024 * 1024) {
    return { valid: false, message: "O anexo deve ter até 3 MB." };
  }
  const byExtension = file.name.toLowerCase().endsWith(".xml")
    ? "application/xml"
    : file.name.toLowerCase().endsWith(".csv")
      ? "text/csv"
      : null;
  const contentType = (file.type || byExtension) as AccountantAttachmentContentType | null;
  if (
    !contentType ||
    ![
      "application/pdf",
      "application/xml",
      "text/xml",
      "text/csv",
      "image/jpeg",
      "image/png",
    ].includes(contentType)
  ) {
    return { valid: false, message: "Envie PDF, XML, CSV, JPG ou PNG." };
  }
  return { valid: true, contentType };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidFiscalPayloadError();
  return value as Record<string, unknown>;
}

function collection(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : record(value).items;
  if (!Array.isArray(items)) throw new InvalidFiscalPayloadError();
  return items.map(record);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidFiscalPayloadError();
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value);
}

function draftText(value: unknown): string {
  if (typeof value !== "string") throw new InvalidFiscalPayloadError();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidFiscalPayloadError();
  }
  return value;
}

function optionalCount(value: unknown): number {
  return value === undefined ? 0 : count(value);
}

function competence(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new InvalidFiscalPayloadError();
  return result;
}

function competenceDate(value: unknown): string {
  const result = text(value).slice(0, 7);
  return competence(result);
}

function nullableNumberLabel(value: unknown): string {
  if (value === null || value === undefined) return "Sem número";
  return String(count(value));
}

function pendingBlockers(documents: FiscalDocument[], competenceValue: string): string[] {
  const pending = documents.filter(
    (document) =>
      document.issuedAt.startsWith(competenceValue) &&
      ["pending", "processing", "contingency"].includes(document.status),
  ).length;
  return pending ? [`${pending} documento(s) ainda pendente(s)`] : [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new InvalidFiscalPayloadError();
  return value.map(text);
}

function oneOf<const T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new InvalidFiscalPayloadError();
  return value as T;
}

export function fiscalTone(value: string): FiscalTone {
  if (["online", "authorized", "closed", "ready", "resolved"].includes(value)) return "success";
  if (["degraded", "processing", "reviewing", "generating", "info"].includes(value)) return "info";
  if (["rejected", "offline", "failed", "critical", "error"].includes(value)) return "danger";
  if (
    [
      "pending",
      "open",
      "contingency",
      "warning",
      "platform_not_configured",
      "profile_required",
      "company_required",
      "credentials_missing",
    ].includes(value)
  )
    return "warning";
  return "neutral";
}
