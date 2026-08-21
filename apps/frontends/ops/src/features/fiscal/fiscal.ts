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
    name: string;
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
    companyId: string | null;
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
  payload: Record<string, unknown>;
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
}

export interface FiscalWorkspace {
  profile: FiscalProfile | null;
  taxRevisions: Array<{ productId: string; status: "draft" | "active" | "revoked" }>;
  products: Array<{ id: string; name: string }>;
  dashboard: FiscalDashboard;
  documents: FiscalDocument[];
  periods: FiscalPeriod[];
}

export interface AccountantWorkspace {
  periods: FiscalPeriod[];
  accountingPackage: AccountingPackage | null;
  requests: AccountantRequest[];
}

export class InvalidFiscalPayloadError extends Error {
  constructor() {
    super("A API retornou dados fiscais incompletos. Atualize a página ou contate o suporte.");
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
      .map((product) => ({ id: product.id, name: product.name })),
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
                title: `${openAccountantRequests} solicitação(ões) do contador aberta(s)`,
                detail: "Consulte o Portal do contador para responder às pendências.",
                severity: "info" as const,
              },
            ]
          : []),
      ],
    },
    documents,
    periods: parsePeriods(payload.periods, documents),
  };
}

function parseProviderStatus(value: unknown): FiscalDashboard["provider"] {
  const provider = record(value);
  const connection = provider.connection === null ? null : record(provider.connection);
  const environments = connection ? record(connection.environments) : {};
  return {
    name: "Focus NFe",
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
    companyId: connection ? optionalText(connection.companyId) : null,
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
  return {
    periods: parsePeriods(payload.periods),
    accountingPackage:
      payload.accountingPackage === null ? null : parseAccountingPackage(payload.accountingPackage),
    requests: collection(payload.requests).map((item) => ({
      id: text(item.id),
      competence: competenceDate(item.competence),
      title: text(item.title),
      detail: text(item.description),
      status: oneOf(item.status, ["open", "resolved"]),
      requestedBy: optionalText(item.requestedBy) ?? "Contabilidade",
      dueAt: optionalText(item.dueDate),
      createdAt: text(item.createdAt),
    })),
  };
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
  const accountingPackage = record(payload.accountingPackage);
  const packagePayload = record(accountingPackage.payload);
  const serialized = JSON.stringify(packagePayload);
  return {
    competence: competenceDate(packageCompetence),
    status: oneOf(payload.status ?? accountingPackage.status, ["pending", "ready", "failed"]),
    generatedAt: optionalText(accountingPackage.generatedAt),
    payload: packagePayload,
    files: [
      {
        name: `pacote-contabil-${competenceDate(packageCompetence)}.json`,
        sizeBytes: new TextEncoder().encode(serialized).byteLength,
      },
    ],
  };
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
