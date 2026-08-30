import type {
  ApiCapability,
  ApiError,
  ApiHealthResponse,
  ApiOperations,
  BillingCheckoutInput,
  CopyUnitSettingsInput,
  EstablishmentSettings,
  EstablishmentSettingsHistoryEntry,
  EstablishmentSpecializedSettingsSummary,
  LoginInput,
  OperationalCommandInput,
  OperationalPushConfig,
  OperationalPushSubscription,
  PrintDocumentPayloadV2,
  RestoreEstablishmentSettingsInput,
  SelfServiceOrganizationInput,
  UpdateOrganizationSettingsInput,
  UpdateUnitSettingsInput,
} from "@giromesa/contracts";
import { apiHealthResponseSchema } from "@giromesa/contracts";

type AccountantPackageResponse =
  ApiOperations["FiscalController_accountantPackage[1]"]["responses"][200]["content"]["application/json"];
type AccountantRequestsResponse =
  ApiOperations["FiscalController_accountantRequests[1]"]["responses"][200]["content"]["application/json"];
type AccountantRequestMutationResponse =
  ApiOperations["FiscalController_createAccountantRequest[1]"]["responses"][201]["content"]["application/json"];
type AccountantRequestResolutionResponse =
  ApiOperations["FiscalController_resolveAccountantRequest[1]"]["responses"][201]["content"]["application/json"];
type AccountantAttachmentMutationResponse =
  ApiOperations["FiscalController_createAccountantAttachment[1]"]["responses"][201]["content"]["application/json"];

export const OPS_REQUIRED_SCHEMA_VERSION = 73;
export const OPS_REQUIRED_API_CAPABILITIES = [
  "table_qr_lifecycle_v1",
  "table_qr_metrics_v1",
  "table_qr_presence_code_v1",
  "ops_background_notifications_v1",
  "table_qr_brand_upload_v1",
  "ops_web_push_v1",
  "public_menu_cover_image_v1",
  "platform_backoffice_v1",
  "platform_commercial_site_v1",
] satisfies ApiCapability[];

export function apiCompatibilityError(value: unknown): string | null {
  const parsed = apiHealthResponseSchema.safeParse(value);
  if (!parsed.success) {
    return "A API em execução é anterior a esta versão do GiroMesa. Atualize e reinicie a API.";
  }
  const missing = OPS_REQUIRED_API_CAPABILITIES.filter(
    (capability) => !parsed.data.capabilities.includes(capability),
  );
  if (parsed.data.schemaVersion < OPS_REQUIRED_SCHEMA_VERSION || missing.length > 0) {
    return `Versão incompatível: frontend exige schema ${OPS_REQUIRED_SCHEMA_VERSION} e a API ${parsed.data.buildSha} oferece ${parsed.data.schemaVersion}. Atualize a API e execute as migrations.`;
  }
  return null;
}

export interface FocusCompanyOnboardingBody {
  tradeName: string;
  stateRegistration: string;
  email: string;
  phone: string;
  street: string;
  number: number;
  complement?: string;
  district: string;
  city: string;
  postalCode: string;
  accountantDocument?: string;
  certificateBase64: string;
  certificatePassword: string;
  enableNfce: boolean;
  enableNfe: boolean;
  enableNfse: boolean;
  cscProduction?: string;
  cscProductionId?: string;
  cscHomologation?: string;
  cscHomologationId?: string;
}

export type LoginResponse =
  | {
      mfaRequired: true;
      challengeToken: string;
      expiresAt?: string;
    }
  | {
      mfaRequired?: false;
      identity?: { id: string; email: string; displayName: string };
    };

export type MfaChallengeProof =
  | { challengeToken: string; code: string }
  | { challengeToken: string; recoveryCode: string };

export interface CommandResponse {
  duplicate: boolean;
  command: { id: string; type: string; occurredAt: string };
}

export type PrintDocumentType = "partial_statement" | "payment_statement" | "final_receipt";
export type PrintJobStatus = "queued" | "printing" | "confirmation_required" | "printed" | "failed";

export interface PosPrintJob {
  id: string;
  tabId: string;
  documentType: PrintDocumentType;
  status: PrintJobStatus;
  copies: number;
  attempts: number;
  terminalId: string | null;
  printerId: string | null;
  payload: PrintDocumentPayloadV2;
  reason: string | null;
  reprintOfJobId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoseClubEligibleProduct {
  externalProductId: string;
  name: string;
  brand: string | null;
}

export interface DoseClubEligibleMembership {
  externalClubId: string;
  status: "active";
  offer: {
    externalOfferId: string;
    name: string;
    type: "individual" | "combo_pool";
  };
  remainingDoses: number;
  reservedDoses: number;
  availableDoses: number;
  doseMl: number;
  eligibleProducts: DoseClubEligibleProduct[];
}

export interface DoseClubMembershipsResponse {
  memberships: DoseClubEligibleMembership[];
}

export type ProductionPrintMode = "disabled" | "kds_only" | "printer_only" | "both";
export type ProductionPrintJobStatus =
  | "queued"
  | "printing"
  | "confirmation_required"
  | "printed"
  | "failed";
export type ProductionPrintResolutionOutcome = "printed" | "failed";

export interface ProductionPrintJob {
  id: string;
  documentType: "kds_ticket";
  status: ProductionPrintJobStatus;
  copies: number;
  attempts: number;
  printerId: string | null;
  stationId: string | null;
  stationName?: string | null;
  kdsTicketId: string | null;
  reason: string | null;
  reprintOfJobId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionPrintingStation {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  deliveryMode: ProductionPrintMode;
  copies: number;
  printerId: string | null;
  readiness: {
    ready: boolean;
    kdsConfigured: boolean;
    printerConfigured: boolean;
    hubOnline: boolean;
    issues: string[];
  };
}

export type ProductionPrintingPolicy = Pick<
  ProductionPrintingStation,
  "deliveryMode" | "copies" | "printerId"
>;

export type ProductionPrinterApplyStatus = "pending" | "applied" | "error";
export type ProductionPrinterLastStatus =
  | "unknown"
  | "pending"
  | "online"
  | "error"
  | "confirmation_required";
export type ProductionPrinterDocumentType = PrintDocumentType | "kds_ticket";

export interface ProductionPrinterInput {
  hubId: string;
  label: string;
  host: string;
  port: number;
  paperWidthMm: 58 | 80;
  charactersPerLine: number;
  codeTable: number;
  cut: boolean;
  supportsRasterGraphics: boolean;
  isDefault: boolean;
  documentTypes: ProductionPrinterDocumentType[];
  fallbackPrinterId?: string | null;
  active?: boolean;
}

export interface ProductionPrinter extends ProductionPrinterInput {
  id: string;
  stationIds?: string[];
  revision: number;
  appliedRevision: number | null;
  applyStatus: ProductionPrinterApplyStatus;
  pendingCommandId: string | null;
  lastAppliedAt: string | null;
  lastTestAt: string | null;
  lastStatus: ProductionPrinterLastStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionPrinterHub {
  id: string;
  label: string;
  lastSeenAt: string | null;
  online: boolean;
}

export type TerminalProfileMode =
  | "waiter_mobile"
  | "reception"
  | "cashier"
  | "kds"
  | "expedition"
  | "shared";
export type TerminalProfileRoute =
  | "dashboard"
  | "reservations"
  | "salon"
  | "counter"
  | "cash"
  | "kds";
export type TerminalQuickAction =
  | "open_tab"
  | "new_order"
  | "receive"
  | "waitlist"
  | "print"
  | "search";
export type TerminalPaymentMode = "disabled" | "cashier" | "homologated_pos";
export interface TerminalProfile {
  organizationId: string;
  unitId: string;
  installationId: string;
  label: string;
  mode: TerminalProfileMode;
  defaultRoute: TerminalProfileRoute;
  printerId: string | null;
  stationId: string | null;
  cashRegisterId: string | null;
  compact: boolean;
  quickActions: TerminalQuickAction[];
  paymentMode: TerminalPaymentMode;
  createdAt: string;
  updatedAt: string;
  updatedByIdentityId: string;
}
export type TerminalProfileInput = Pick<
  TerminalProfile,
  | "label"
  | "mode"
  | "defaultRoute"
  | "printerId"
  | "stationId"
  | "cashRegisterId"
  | "compact"
  | "quickActions"
  | "paymentMode"
>;

export interface CatalogProductAggregateInput {
  categoryId: string;
  sku?: string;
  ean?: string;
  sortOrder?: number;
  name: string;
  description?: string;
  imageUrl?: string;
  estimatedPrepTimeMinutes?: number;
  productType?: "prepared" | "resale";
  priceCents: number;
  deliveryPriceCents?: number | null;
  costCents?: number | null;
  available: boolean;
  stationIds: string[];
  stationRouting?: Array<{ stationId: string; stage: number }>;
  availabilitySchedule?: {
    windows: Array<{ dayOfWeek: number; start: string; end: string }>;
  } | null;
  dailyStock?: number | null;
  autoDeductStock?: boolean;
  tags?: string[];
  suggestedProductIds?: string[];
  allergenIds: string[];
  modifierGroupIds: string[];
  recipe: Array<{
    ingredientName: string;
    quantityMilli: number;
    unit: string;
    lossBasisPoints: number;
  }>;
  sizes?: Array<{
    code: string;
    name: string;
    priceCents: number;
  }>;
  spiciness?: number | null;
  dietaryFlags?: string[];
  pairing?: string | null;
  fiscal?: {
    ncm?: string;
    cfop?: string;
    cest?: string;
    origin?: number;
  };
  translations?: Record<string, { name: string; description?: string }>;
}

export interface CatalogPromotionInput {
  name: string;
  discountType: "percentage" | "fixed_price";
  discountValue: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  categoryIds: string[];
  productIds: string[];
  comboIds: string[];
  channels: Array<"salon" | "delivery" | "qr" | "pickup">;
  active: boolean;
}

export interface CatalogBrandingInput {
  displayName: string;
  slogan?: string | null;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  notice?: string | null;
  address?: string | null;
  phone?: string | null;
  instagram?: string | null;
  openingHours?: string | null;
  serviceTaxNotice?: string | null;
  corkageFeeNotice?: string | null;
  wifi?: { ssid: string; password: string } | null;
}

export interface CatalogImportRow extends Omit<CatalogProductAggregateInput, "categoryId"> {
  productId?: string;
  categoryId?: string;
  categoryName?: string;
}

export interface CatalogPublication {
  slug: string;
  active: boolean;
  publishedAt: string | null;
  version: number;
  url: string;
}

export interface CatalogTableQr {
  tableId: string;
  label: string;
  tokenVersion: number;
  url: string;
}

export type TableQrVisualTemplate = "classic" | "compact" | "minimal";
export type TableQrPrintFormat = "a4_2" | "a4_4" | "a4_6" | "a5" | "table_tent" | "sticker";
export type TableQrOutput = "print" | "svg" | "png" | "pdf";

export interface TableQrSettings {
  revision: number;
  displayName: string;
  headline: string;
  instructions: string;
  logoUrl: string | null;
  primaryColor: string;
  wifiNotice: string | null;
  serviceChargeNotice: string | null;
  template: TableQrVisualTemplate;
  presenceProtection: "session_only" | "daily_code";
  updatedAt: string | null;
}

export type UpdateTableQrSettingsInput = Omit<TableQrSettings, "revision" | "updatedAt"> & {
  expectedRevision: number;
};

export interface TableQrBatchTable {
  tableId: string;
  label: string;
  tokenVersion: number;
  currentVersion: number | null;
  isCurrent: boolean;
  url: string | null;
}

export interface TableQrPrintBatch {
  id: string;
  format: TableQrPrintFormat;
  output: TableQrOutput;
  template: TableQrVisualTemplate;
  menuSlug: string;
  includeWifi: boolean;
  status: "generated" | "printed";
  settingsRevision: number;
  settings: Omit<TableQrSettings, "revision" | "updatedAt">;
  tables: TableQrBatchTable[];
  createdByIdentityId: string;
  createdByLabel: string;
  generatedAt: string;
  printedByIdentityId: string | null;
  printedByLabel: string | null;
  printedAt: string | null;
  idempotentReplay?: boolean;
}

export interface TableQrLifecycle {
  settings: TableQrSettings;
  generalBranding: { logoUrl: string | null; logoThumbnailUrl: string | null };
  presence: {
    mode: "session_only" | "daily_code";
    code: string | null;
  };
  tables: Array<CatalogTableQr & { scanCount: number; lastScannedAt: string | null }>;
  batches: TableQrPrintBatch[];
  rotations: Array<{
    id: string;
    tableId: string;
    tokenVersion: number;
    actorIdentityId: string | null;
    actorLabel: string | null;
    occurredAt: string;
  }>;
}

export interface TableQrTestResult {
  valid: boolean;
  slug: string | null;
  displayName: string | null;
  unitName: string | null;
  tableId: string | null;
  tableLabel: string | null;
  tokenVersion: number | null;
  expiresAt: string | null;
  reason: "invalid_url" | "invalid_signature" | "table_not_found" | "rotated" | null;
}

export interface CatalogBcgProduct {
  productId: string;
  name: string;
  quantity: number;
  revenueCents: number;
  costCents: number;
  marginCents: number;
  quadrant: "star" | "volume" | "opportunity" | "dog";
}

export interface PurchaseListFilters {
  page?: number;
  pageSize?: number;
  status?: string;
  supplierId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface FinanceFilters {
  direction?: "all" | "payable" | "receivable";
  status?: "all" | "open" | "partial" | "settled" | "canceled" | "overdue" | "due_soon";
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface FinanceEntryInput {
  description: string;
  amountCents: number;
  competenceDate: string;
  dueDate: string;
  category?: string;
  costCenter?: string;
  documentNumber?: string;
  notes?: string;
  attachments?: Array<{ name: string; url: string; mimeType?: string }>;
  recurrence?: { installments: number; intervalMonths: number };
}

export interface FinancePaymentInput {
  amountCents: number;
  method: string;
  reference?: string;
  cashRegisterId?: string;
  occurredAt?: string;
  approvalRequestId?: string;
}

export interface SupplierInput {
  name: string;
  document?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export interface PurchaseOrderLineInput {
  inventoryItemId: string;
  quantity: string;
  unitCostCents: number;
  taxCents?: number;
  discountCents?: number;
  notes?: string;
}

export interface PurchaseOrderInput {
  supplierId: string;
  expectedAt?: string;
  items: PurchaseOrderLineInput[];
}

export interface PurchaseTransitionInput {
  reason: string;
  version: number;
}

export interface PurchaseReceiptLineInput {
  purchaseOrderItemId: string;
  locationId: string;
  quantity: string;
  batchCode?: string;
  expiresAt?: string;
  unitCostCents?: number;
}

export interface PurchaseInvoiceInput {
  documentNumber: string;
  accessKey?: string;
  series?: string;
  model?: string;
  taxTotalCents?: number;
  xmlContent?: string;
  issuedAt: string;
  competenceDate: string;
  dueDate: string;
  totalCents: number;
  toleranceCents?: number;
  confirmIfMatched?: boolean;
  lines: Array<{
    purchaseOrderItemId: string;
    quantity: string;
    unitCostCents: number;
  }>;
}

type PrintTarget = { terminalId?: string; printerId?: string };

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function referenceSuffix(requestId?: string) {
  return requestId ? ` Referência: ${requestId}.` : "";
}

export function operationalApiErrorMessage(
  status: number,
  bodyMessage: unknown,
  requestId?: string,
  retryAfterSeconds?: number,
) {
  const backendMessage = typeof bodyMessage === "string" ? bodyMessage.trim() : "";
  const technical = /^(?:Cannot\s+(?:GET|POST|PUT|PATCH|DELETE)\s+\/|[A-Z_]{3,}:)/i.test(
    backendMessage,
  );
  const message =
    status === 401
      ? "Sua sessão expirou. Entre novamente."
      : status === 403
        ? "Seu perfil não possui permissão para esta operação."
        : status === 404
          ? "Este recurso não está disponível na versão atual da API."
          : status === 429
            ? `Muitas solicitações em sequência. Aguarde${Number.isFinite(retryAfterSeconds) ? ` ${retryAfterSeconds} segundos` : " alguns segundos"} e tente novamente.`
            : status >= 500
              ? "O servidor não conseguiu concluir a consulta. Tente novamente em instantes."
              : backendMessage && !technical
                ? backendMessage
                : `Não foi possível concluir a operação (${status}).`;
  return `${message}${referenceSuffix(requestId)}`;
}

const baseUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3200").replace(/\/$/, "");

export function configuredApiBaseUrl() {
  return baseUrl;
}

export function resolveSecurityUrl(
  rawSiteUrl = import.meta.env.VITE_SITE_URL ?? "http://localhost:3100",
): string | null {
  try {
    const url = new URL(rawSiteUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/seguranca`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      signal: init.signal ?? controller.signal,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await safeJson<ApiError>(response);
      const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
      const requestId = response.headers.get("x-request-id")?.trim() || undefined;
      throw new ApiClientError(
        operationalApiErrorMessage(response.status, body?.message, requestId, retryAfterSeconds),
        response.status,
        body?.code ?? "API_REQUEST_FAILED",
        response.status >= 500 || response.status === 429,
        requestId,
        body && typeof body === "object" ? (body as unknown as Record<string, unknown>) : undefined,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    throw new ApiClientError(
      timedOut ? "A API demorou mais que o esperado." : "Não foi possível alcançar a API.",
      0,
      timedOut ? "API_TIMEOUT" : "API_UNREACHABLE",
      true,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export const apiRequest = request;

async function requestDownload(
  path: string,
): Promise<{ blob: Blob; filename: string | null; sha256: string | null }> {
  const payload = await request<{
    filename: string;
    content: string;
    contentEncoding?: "utf8" | "base64";
    mimeType?: string;
    sha256?: string | null;
  }>(path);
  const content =
    payload.contentEncoding === "base64"
      ? Uint8Array.from(atob(payload.content), (character) => character.charCodeAt(0))
      : payload.content;
  return {
    blob: new Blob([content], { type: payload.mimeType ?? "text/csv;charset=utf-8" }),
    filename: payload.filename,
    sha256: payload.sha256 ?? null,
  };
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function parseLoginResponse(value: unknown): LoginResponse {
  if (typeof value !== "object" || value === null) {
    throw new ApiClientError("Resposta de login inválida.", 502, "INVALID_LOGIN_RESPONSE", false);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.mfaRequired === true) {
    if (typeof candidate.challengeToken !== "string" || candidate.challengeToken.length < 32) {
      throw new ApiClientError("Desafio MFA inválido.", 502, "INVALID_MFA_CHALLENGE", false);
    }
    return {
      mfaRequired: true,
      challengeToken: candidate.challengeToken,
      expiresAt: typeof candidate.expiresAt === "string" ? candidate.expiresAt : undefined,
    };
  }
  return { mfaRequired: false };
}

function managementPath(organizationId: string, unitId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/management/${resource}`;
}

function managementListPath(
  organizationId: string,
  unitId: string,
  resource: string,
  filters: object = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const path = managementPath(organizationId, unitId, resource);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

function pilotPath(organizationId: string, unitId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/pilot/${resource}`;
}

function growthPath(organizationId: string, resource: string): string {
  return `/v1/organizations/${encodeURIComponent(organizationId)}/growth/${resource}`;
}

function fiscalPath(organizationId: string, unitId: string, resource: string): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/fiscal/${resource}`;
}

async function idempotentRequest<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "idempotency-key": idempotencyKey },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function managementCommand<T>(
  organizationId: string,
  unitId: string,
  resource: string,
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<T> {
  return idempotentRequest<T>(
    managementPath(organizationId, unitId, resource),
    "POST",
    body,
    idempotencyKey,
  );
}

export const api = {
  baseUrl,
  health: () => request<ApiHealthResponse>("/health"),
  assertCompatibility: async () => {
    const health = await request<unknown>("/health");
    const incompatibility = apiCompatibilityError(health);
    if (incompatibility) {
      throw new ApiClientError(incompatibility, 426, "API_VERSION_INCOMPATIBLE", false);
    }
    return apiHealthResponseSchema.parse(health);
  },
  login: async (input: LoginInput) =>
    parseLoginResponse(
      await request<unknown>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) }),
    ),
  verifyMfaChallenge: (proof: MfaChallengeProof) =>
    request<unknown>("/v1/auth/mfa/challenge/verify", {
      method: "POST",
      body: JSON.stringify(proof),
    }),
  requestPasswordReset: (email: string) =>
    request<{ accepted: true }>("/v1/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
  me: () => request<unknown>("/v1/auth/me"),
  organizations: () => request<unknown[]>("/v1/organizations"),
  createSelfServiceOrganization: (body: SelfServiceOrganizationInput) =>
    request<unknown>("/v1/organizations/self-service", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  settings: {
    get: (organizationId: string, unitId: string) =>
      request<EstablishmentSettings>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/settings`,
      ),
    updateOrganization: (organizationId: string, body: UpdateOrganizationSettingsInput) =>
      request<EstablishmentSettings["organization"]>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/settings`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    updateUnit: (organizationId: string, unitId: string, body: UpdateUnitSettingsInput) =>
      request<EstablishmentSettings>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/settings`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
    copy: (
      organizationId: string,
      sourceUnitId: string,
      body: CopyUnitSettingsInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{
        sourceUnitId: string;
        targetUnitIds: string[];
        idempotentReplay: boolean;
      }>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(sourceUnitId)}/settings/copy`,
        "POST",
        body,
        idempotencyKey,
      ),
    specializedSummary: (organizationId: string, unitId: string) =>
      request<EstablishmentSpecializedSettingsSummary>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/settings/specialized-summary`,
      ),
    history: (organizationId: string, unitId: string) =>
      request<EstablishmentSettingsHistoryEntry[]>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/settings/history`,
      ),
    restore: (
      organizationId: string,
      unitId: string,
      body: RestoreEstablishmentSettingsInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<EstablishmentSettings>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/settings/restore`,
        "POST",
        body,
        idempotencyKey,
      ),
  },
  fiscal: {
    profile: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "profile")),
    updateProfile: (
      organizationId: string,
      unitId: string,
      body: {
        legalEntityId: string;
        taxRegime: "simples_nacional" | "simples_excesso" | "lucro_presumido" | "lucro_real";
        crt: string;
        municipalRegistration?: string;
        cnae?: string;
        stateCode: string;
        cityCode: string;
        environment: "homologation" | "production";
        provider: "focus" | null;
        series: { nfce?: string; nfe?: string; nfse?: string };
      },
    ) =>
      request<unknown>(fiscalPath(organizationId, unitId, "profile"), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    provider: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "provider")),
    validateProvider: (organizationId: string, unitId: string, body: FocusCompanyOnboardingBody) =>
      request<unknown>(fiscalPath(organizationId, unitId, "provider/validate"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    activateProvider: (organizationId: string, unitId: string, body: FocusCompanyOnboardingBody) =>
      idempotentRequest<unknown>(
        fiscalPath(organizationId, unitId, "provider/activate"),
        "POST",
        body,
      ),
    checkProvider: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "provider/check"), {
        method: "POST",
      }),
    taxRevisions: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "tax-revisions")),
    createTaxRevision: (
      organizationId: string,
      unitId: string,
      body: {
        productId: string;
        status: "active";
        effectiveFrom: string;
        classification: {
          ncm: string;
          cfop: string;
          origin: number;
          csosn?: string;
          cstIcms?: string;
          cstPis: string;
          cstCofins: string;
          cstIbsCbs?: string;
          cClassTrib?: string;
        };
      },
    ) =>
      request<unknown>(fiscalPath(organizationId, unitId, "tax-revisions"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createTaxRevisionsBulk: (
      organizationId: string,
      unitId: string,
      body: {
        productIds: string[];
        status: "draft" | "active";
        effectiveFrom: string;
        classification: {
          ncm: string;
          cfop: string;
          origin: number;
          csosn?: string;
          cstIcms?: string;
          cstPis: string;
          cstCofins: string;
          cstIbsCbs?: string;
          cClassTrib?: string;
        };
      },
    ) =>
      request<unknown>(fiscalPath(organizationId, unitId, "tax-revisions/bulk"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    importTaxRevisions: (
      organizationId: string,
      unitId: string,
      body: {
        rows: Array<{
          productId: string;
          status: "active";
          effectiveFrom: string;
          classification: {
            ncm: string;
            cfop: string;
            origin: number;
            csosn?: string;
            cstIcms?: string;
            cstPis: string;
            cstCofins: string;
            cstIbsCbs?: string;
            cClassTrib?: string;
          };
        }>;
      },
    ) =>
      request<unknown>(fiscalPath(organizationId, unitId, "tax-revisions/import"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    dashboard: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "dashboard")),
    documents: (
      organizationId: string,
      unitId: string,
      filters?: {
        status?: string;
        model?: string;
        from?: string;
        to?: string;
        search?: string;
        page?: number;
      },
    ) => {
      const query = new URLSearchParams();
      if (filters?.status) query.set("status", filters.status);
      if (filters?.model) query.set("model", filters.model);
      if (filters?.from) query.set("from", filters.from);
      if (filters?.to) query.set("to", filters.to);
      if (filters?.search) query.set("search", filters.search);
      if (filters?.page) query.set("page", String(filters.page));
      query.set("pageSize", "50");
      const path = fiscalPath(organizationId, unitId, "documents");
      return request<unknown>(`${path}?${query}`);
    },
    document: (organizationId: string, unitId: string, documentId: string) =>
      request<unknown>(
        fiscalPath(organizationId, unitId, `documents/${encodeURIComponent(documentId)}`),
      ),
    documentArtifact: (
      organizationId: string,
      unitId: string,
      documentId: string,
      kind: "authorization_xml" | "cancellation_xml" | "danfe_pdf",
    ) =>
      requestDownload(
        fiscalPath(
          organizationId,
          unitId,
          `documents/${encodeURIComponent(documentId)}/artifacts/${kind}`,
        ),
      ),
    reconcileDocument: (organizationId: string, unitId: string, documentId: string) =>
      request<unknown>(
        fiscalPath(organizationId, unitId, `documents/${encodeURIComponent(documentId)}/reconcile`),
        { method: "POST" },
      ),
    cancelDocument: (
      organizationId: string,
      unitId: string,
      documentId: string,
      justification: string,
    ) =>
      request<unknown>(
        fiscalPath(organizationId, unitId, `documents/${encodeURIComponent(documentId)}/cancel`),
        { method: "POST", body: JSON.stringify({ justification }) },
      ),
    periods: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "periods")),
    closePeriod: (organizationId: string, unitId: string, competence: string) =>
      idempotentRequest<unknown>(
        fiscalPath(organizationId, unitId, `periods/${encodeURIComponent(competence)}/close`),
        "POST",
      ),
    reopenPeriod: (organizationId: string, unitId: string, competence: string, reason: string) =>
      idempotentRequest<unknown>(
        fiscalPath(organizationId, unitId, `periods/${encodeURIComponent(competence)}/reopen`),
        "POST",
        { reason },
      ),
    accountingPackage: (organizationId: string, unitId: string, competence: string) => {
      const path = fiscalPath(organizationId, unitId, "accountant/package");
      return request<AccountantPackageResponse>(`${path}?${new URLSearchParams({ competence })}`);
    },
    accountingPackageContent: (organizationId: string, unitId: string, competence: string) => {
      const path = fiscalPath(organizationId, unitId, "accountant/package/content");
      return requestDownload(`${path}?${new URLSearchParams({ competence })}`);
    },
    numberInvalidations: (organizationId: string, unitId: string) =>
      request<unknown>(fiscalPath(organizationId, unitId, "number-invalidations")),
    invalidateNumbers: (
      organizationId: string,
      unitId: string,
      body: {
        series: string;
        initialNumber: number;
        finalNumber: number;
        justification: string;
      },
    ) =>
      idempotentRequest<unknown>(
        fiscalPath(organizationId, unitId, "number-invalidations"),
        "POST",
        body,
      ),
    numberInvalidationArtifact: (organizationId: string, unitId: string, invalidationId: string) =>
      requestDownload(
        fiscalPath(
          organizationId,
          unitId,
          `number-invalidations/${encodeURIComponent(invalidationId)}/artifact`,
        ),
      ),
    accountantRequests: (
      organizationId: string,
      unitId: string,
      filters: {
        competence?: string;
        status?: "open" | "resolved";
        targetAudience?: "accountant" | "establishment";
        overdue?: boolean;
        page?: number;
        pageSize?: number;
      } = {},
    ) => {
      const path = fiscalPath(organizationId, unitId, "accountant/requests");
      const query = new URLSearchParams({
        page: String(filters.page ?? 1),
        pageSize: String(filters.pageSize ?? 25),
      });
      if (filters.competence) query.set("competence", filters.competence);
      if (filters.status) query.set("status", filters.status);
      if (filters.targetAudience) query.set("targetAudience", filters.targetAudience);
      if (filters.overdue !== undefined) query.set("overdue", String(filters.overdue));
      return request<AccountantRequestsResponse>(`${path}?${query}`);
    },
    createAccountantRequest: (
      organizationId: string,
      unitId: string,
      body: {
        competence: string;
        title: string;
        description: string;
        dueDate?: string;
      },
    ) =>
      idempotentRequest<AccountantRequestMutationResponse>(
        fiscalPath(organizationId, unitId, "accountant/requests"),
        "POST",
        body,
      ),
    resolveAccountantRequest: (
      organizationId: string,
      unitId: string,
      requestId: string,
      body: { resolution: string },
    ) =>
      request<AccountantRequestResolutionResponse>(
        fiscalPath(
          organizationId,
          unitId,
          `accountant/requests/${encodeURIComponent(requestId)}/resolve`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    createAttachment: (
      organizationId: string,
      unitId: string,
      requestId: string,
      body: { fileName: string; contentType: string; contentBase64: string },
    ) =>
      request<AccountantAttachmentMutationResponse>(
        fiscalPath(
          organizationId,
          unitId,
          `accountant/requests/${encodeURIComponent(requestId)}/attachments`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    downloadAttachment: (
      organizationId: string,
      unitId: string,
      requestId: string,
      attachmentId: string,
    ) =>
      requestDownload(
        fiscalPath(
          organizationId,
          unitId,
          `accountant/requests/${encodeURIComponent(requestId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
        ),
      ),
  },
  platform: {
    overview: () => request<unknown>("/v1/platform/overview"),
    team: () => request<unknown>("/v1/platform/team"),
    inviteTeamMember: (
      body: {
        email: string;
        role: "viewer" | "support" | "finance" | "fiscal" | "engineering";
        reason: string;
        reauth: { mfaCode: string };
      },
      idempotencyKey?: string,
    ) => idempotentRequest<unknown>("/v1/platform/team/invitations", "POST", body, idempotencyKey),
    cancelTeamInvitation: (
      invitationId: string,
      body: { reason: string; reauth: { mfaCode: string } },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        `/v1/platform/team/invitations/${encodeURIComponent(invitationId)}`,
        "DELETE",
        body,
        idempotencyKey,
      ),
    revokeTeamMember: (
      identityId: string,
      body: { reason: string; reauth: { mfaCode: string } },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        `/v1/platform/team/members/${encodeURIComponent(identityId)}`,
        "DELETE",
        body,
        idempotencyKey,
      ),
    tenants: (
      filters: {
        search?: string;
        status?:
          | "draft"
          | "onboarding"
          | "trial_active"
          | "active"
          | "grace"
          | "restricted"
          | "suspended"
          | "canceled";
        cursor?: string;
        limit?: number;
      } = {},
    ) => {
      const query = new URLSearchParams();
      if (filters.search) query.set("search", filters.search);
      if (filters.status) query.set("status", filters.status);
      if (filters.cursor) query.set("cursor", filters.cursor);
      if (filters.limit !== undefined) query.set("limit", String(filters.limit));
      const suffix = query.size ? `?${query}` : "";
      return request<unknown>(`/v1/platform/tenants${suffix}`);
    },
    tenant: (organizationId: string) =>
      request<unknown>(`/v1/platform/tenants/${encodeURIComponent(organizationId)}`),
    createTenant: (
      body: {
        legalName: string;
        tradeName: string;
        document: string;
        unitName: string;
        timezone: string;
        ownerEmail: string;
        reason: string;
      },
      idempotencyKey?: string,
    ) => idempotentRequest<unknown>("/v1/platform/tenants", "POST", body, idempotencyKey),
    grantPilotAccess: (organizationId: string, body: { reason: string }, idempotencyKey?: string) =>
      idempotentRequest<unknown>(
        `/v1/platform/tenants/${encodeURIComponent(organizationId)}/pilot-access`,
        "POST",
        body,
        idempotencyKey,
      ),
    revealTenantPii: (organizationId: string, reason: string) =>
      request<unknown>(`/v1/platform/tenants/${encodeURIComponent(organizationId)}/pii-access`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    incidents: (
      filters: {
        search?: string;
        status?: "active" | "all" | "open" | "claimed" | "snoozed" | "resolved";
        severity?: "critical" | "high" | "medium" | "low";
        assignee?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) => {
      const query = new URLSearchParams();
      if (filters.search) query.set("search", filters.search);
      if (filters.status) query.set("status", filters.status);
      if (filters.severity) query.set("severity", filters.severity);
      if (filters.assignee) query.set("assignee", filters.assignee);
      if (filters.cursor) query.set("cursor", filters.cursor);
      if (filters.limit !== undefined) query.set("limit", String(filters.limit));
      const suffix = query.size ? `?${query}` : "";
      return request<unknown>(`/v1/platform/incidents${suffix}`);
    },
    updateIncident: (
      incidentId: string,
      body: {
        action: "claim" | "snooze" | "resolve";
        reason: string;
        snoozedUntil?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        `/v1/platform/incidents/${encodeURIComponent(incidentId)}`,
        "PATCH",
        body,
        idempotencyKey,
      ),
    retryOutbox: (eventId: string, body: { reason: string }, idempotencyKey?: string) =>
      idempotentRequest<unknown>(
        `/v1/platform/outbox/${encodeURIComponent(eventId)}/retry`,
        "POST",
        body,
        idempotencyKey,
      ),
    commercialOverview: () => request<unknown>("/v1/platform/commercial/overview"),
    createCommercialDraft: (body: { reason: string; sourceVersionId?: string }) =>
      idempotentRequest<unknown>("/v1/platform/commercial/drafts", "POST", body),
    updateCommercialDraft: (
      draftId: string,
      body: {
        reason: string;
        plans: unknown[];
        landing: unknown;
        seo: unknown;
        promotions: unknown[];
        experiments: unknown[];
      },
    ) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/drafts/${encodeURIComponent(draftId)}`,
        "PUT",
        body,
      ),
    commercialDraftPreview: (draftId: string) =>
      request<unknown>(`/v1/platform/commercial/versions/${encodeURIComponent(draftId)}/preview`),
    approveCommercialDraft: (draftId: string, reason: string) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/versions/${encodeURIComponent(draftId)}/approve`,
        "POST",
        { reason },
      ),
    publishCommercialDraft: (draftId: string, body: { reason: string; publishAt?: string }) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/versions/${encodeURIComponent(draftId)}/publish`,
        "POST",
        body,
      ),
    rollbackCommercialPublication: (versionId: string, reason: string) =>
      idempotentRequest<unknown>("/v1/platform/commercial/rollback", "POST", {
        reason,
        versionId,
      }),
    uploadCommercialMedia: (body: {
      fileName: string;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      base64: string;
      alt: string;
      reason: string;
    }) => idempotentRequest<unknown>("/v1/platform/commercial/media", "POST", body),
    deleteCommercialMedia: (mediaId: string, reason: string) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/media/${encodeURIComponent(mediaId)}`,
        "DELETE",
        { reason },
      ),
    commercialLeads: (
      filters: {
        search?: string;
        type?: string;
        stage?: string;
        assignedToIdentityId?: string;
        campaignSlug?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "") query.set(key, String(value));
      }
      return request<unknown>(`/v1/platform/commercial/leads${query.size ? `?${query}` : ""}`);
    },
    commercialMetrics: () => request<unknown>("/v1/platform/commercial/metrics"),
    updateCommercialLead: (
      sourceType: "trial" | "contact",
      sourceId: string,
      body: {
        reason: string;
        stage: "new" | "qualified" | "contacted" | "converted" | "lost";
        assignedToIdentityId?: string | null;
        organizationId?: string | null;
        notes?: string | null;
        lastContactAt?: string | null;
      },
    ) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/leads/${sourceType}/${encodeURIComponent(sourceId)}`,
        "PATCH",
        body,
      ),
    createCommercialCampaign: (body: Record<string, unknown>) =>
      idempotentRequest<unknown>("/v1/platform/commercial/campaigns", "POST", body),
    updateCommercialCampaign: (campaignId: string, body: Record<string, unknown>) =>
      idempotentRequest<unknown>(
        `/v1/platform/commercial/campaigns/${encodeURIComponent(campaignId)}`,
        "PUT",
        body,
      ),
  },
  billing: {
    summary: (organizationId: string) =>
      request<unknown>(`/v1/organizations/${encodeURIComponent(organizationId)}/billing/summary`),
    createUpgradeQuote: (organizationId: string, targetPlanSlug: string) =>
      idempotentRequest<unknown>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/billing/upgrade-quotes`,
        "POST",
        { targetPlanSlug },
      ),
    createCheckout: (organizationId: string, body: BillingCheckoutInput) =>
      idempotentRequest<unknown>(
        `/v1/organizations/${encodeURIComponent(organizationId)}/billing/checkouts`,
        "POST",
        body,
      ),
  },
  management: {
    overview: (organizationId: string, unitId: string, source?: string) =>
      request<unknown>(managementListPath(organizationId, unitId, "overview", { source })),
    overviewPriorityAction: (
      organizationId: string,
      unitId: string,
      priorityId: string,
      body: {
        occurrenceKey: string;
        action: "claim" | "snooze" | "resolve";
        snoozeMinutes?: number;
      },
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `overview/priorities/${encodeURIComponent(priorityId)}/actions`,
        body,
      ),
    updateOverviewPreferences: (
      organizationId: string,
      unitId: string,
      body: {
        alertsEnabled: boolean;
        minimumTone: "info" | "warning" | "danger";
        digestMinutes: number;
        thresholds: Record<string, number>;
      },
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "overview/preferences"),
        "PUT",
        body,
      ),
    markOverviewVisited: (organizationId: string, unitId: string) =>
      managementCommand<unknown>(organizationId, unitId, "overview/visit"),
    inventory: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory")),
    inventoryControls: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory/controls")),
    configureInventorySectorPolicy: (
      organizationId: string,
      unitId: string,
      locationId: string,
      body: {
        blindCountRequired: boolean;
        requireDistinctCountReviewer: boolean;
        scanRequired: boolean;
        offlineAllowed: boolean;
        temperatureMinimumCelsius: number | null;
        temperatureMaximumCelsius: number | null;
      },
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/controls/sectors/${encodeURIComponent(locationId)}`,
        ),
        "PUT",
        body,
      ),
    startBlindInventoryCount: (
      organizationId: string,
      unitId: string,
      body: {
        locationId: string;
        shiftReference?: string;
        reason: string;
        scheduleIds?: string[];
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/controls/counts",
        body,
        idempotencyKey,
      ),
    submitBlindInventoryCount: (
      organizationId: string,
      unitId: string,
      sessionId: string,
      body: {
        lines: Array<{ lineId: string; countedQuantity: string }>;
        capturedAt?: string;
        offline?: boolean;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/counts/${encodeURIComponent(sessionId)}/submit`,
        body,
        idempotencyKey,
      ),
    reviewBlindInventoryCount: (
      organizationId: string,
      unitId: string,
      sessionId: string,
      body: { decision: "approved" | "rejected"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/counts/${encodeURIComponent(sessionId)}/review`,
        body,
        idempotencyKey,
      ),
    recordInventoryTemperature: (
      organizationId: string,
      unitId: string,
      body: {
        locationId: string;
        celsius: number;
        source: "manual" | "sensor" | "import";
        occurredAt?: string;
        note?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/controls/temperatures",
        body,
        idempotencyKey,
      ),
    holdInventoryLot: (
      organizationId: string,
      unitId: string,
      lotId: string,
      body: { reason: string; evidence?: string[] },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/lots/${encodeURIComponent(lotId)}/holds`,
        body,
        idempotencyKey,
      ),
    releaseInventoryLot: (
      organizationId: string,
      unitId: string,
      lotId: string,
      holdId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/lots/${encodeURIComponent(lotId)}/holds/${encodeURIComponent(holdId)}/release`,
        body,
        idempotencyKey,
      ),
    chargeReturnableDeposit: (
      organizationId: string,
      unitId: string,
      body: { orderId: string; dueDate: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/controls/returnables/deposits",
        body,
        idempotencyKey,
      ),
    cancelReturnableDepositCharge: (
      organizationId: string,
      unitId: string,
      chargeId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/returnables/deposits/${encodeURIComponent(chargeId)}/cancel`,
        body,
        idempotencyKey,
      ),
    reconcileReturnableDepositCharge: (
      organizationId: string,
      unitId: string,
      chargeId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/controls/returnables/deposits/${encodeURIComponent(chargeId)}/reconcile`,
        body,
        idempotencyKey,
      ),
    createInventoryReservation: (
      organizationId: string,
      unitId: string,
      body: {
        inventoryItemId: string;
        locationId: string;
        quantity: string;
        sourceType: "order" | "scheduled_order" | "event" | "manual";
        sourceId: string;
        reason: string;
        expiresAt?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/reservations",
        body,
        idempotencyKey,
      ),
    resolveInventoryReservation: (
      organizationId: string,
      unitId: string,
      reservationId: string,
      body: { decision: "consumed" | "released" | "canceled"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/reservations/${encodeURIComponent(reservationId)}/resolve`,
        body,
        idempotencyKey,
      ),
    generateCycleCountPlan: (organizationId: string, unitId: string, idempotencyKey?: string) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/cycle-count-plan/generate",
        {},
        idempotencyKey,
      ),
    createProductionBatch: (
      organizationId: string,
      unitId: string,
      body: {
        outputInventoryItemId: string;
        outputLocationId: string;
        batchCode: string;
        plannedQuantity: string;
        expiresAt?: string;
        notes?: string;
        inputs: Array<{
          inventoryItemId: string;
          locationId: string;
          lotId?: string;
          plannedQuantity: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/production-batches",
        body,
        idempotencyKey,
      ),
    completeProductionBatch: (
      organizationId: string,
      unitId: string,
      batchId: string,
      body: {
        actualQuantity: string;
        expiresAt?: string;
        inputs: Array<{ inputId: string; actualQuantity: string }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/production-batches/${encodeURIComponent(batchId)}/complete`,
        body,
        idempotencyKey,
      ),
    cancelProductionBatch: (
      organizationId: string,
      unitId: string,
      batchId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/production-batches/${encodeURIComponent(batchId)}/cancel`,
        body,
        idempotencyKey,
      ),
    createInterunitTransfer: (
      organizationId: string,
      unitId: string,
      body: {
        destinationUnitId: string;
        reason: string;
        lines: Array<{
          sourceInventoryItemId: string;
          destinationInventoryItemId: string;
          sourceLocationId: string;
          destinationLocationId: string;
          sourceLotId?: string;
          quantity: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/interunit-transfers",
        body,
        idempotencyKey,
      ),
    receiveInterunitTransfer: (
      organizationId: string,
      unitId: string,
      transferId: string,
      body: { note: string; lines: Array<{ lineId: string; quantity: string }> },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/interunit-transfers/${encodeURIComponent(transferId)}/receive`,
        body,
        idempotencyKey,
      ),
    cancelInterunitTransfer: (
      organizationId: string,
      unitId: string,
      transferId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/interunit-transfers/${encodeURIComponent(transferId)}/cancel`,
        body,
        idempotencyKey,
      ),
    closeInventoryPeriod: (
      organizationId: string,
      unitId: string,
      body: { period: string; locationId?: string; shiftReference?: string; notes?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/closings",
        body,
        idempotencyKey,
      ),
    returnables: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory/returnables")),
    returnablePolicy: (organizationId: string, unitId: string) =>
      request<unknown>(
        managementPath(organizationId, unitId, "inventory/controls/returnables/policy"),
      ),
    updateReturnablePolicy: (
      organizationId: string,
      unitId: string,
      body: {
        depositMode: "disabled" | "manual";
        defaultDueDays: number;
        returnableClosePolicy: "ignore" | "warn" | "block";
      },
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "inventory/controls/returnables/policy"),
        "PATCH",
        body,
      ),
    configureReturnable: (
      organizationId: string,
      unitId: string,
      body: {
        productId: string;
        containerInventoryItemId: string;
        quantityPerUnit: string;
        depositCents: number;
        active: boolean;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/configurations",
        body,
        idempotencyKey,
      ),
    classifyReturnableProduct: (
      organizationId: string,
      unitId: string,
      productId: string,
      body: { status: "returnable" | "non_returnable" },
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/returnables/products/${encodeURIComponent(productId)}/classification`,
        ),
        "PUT",
        body,
      ),
    confirmReturnableCustody: (
      organizationId: string,
      unitId: string,
      body: {
        issueMovementId?: string;
        containerInventoryItemId: string;
        locationId: string;
        quantity: string;
        orderId?: string;
        note?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/custody/confirm",
        body,
        idempotencyKey,
      ),
    confirmReturnableCustodyBulk: (
      organizationId: string,
      unitId: string,
      body: {
        lines: Array<{
          issueMovementId: string;
          locationId: string;
          quantity: string;
          note?: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/custody/confirm-bulk",
        body,
        idempotencyKey,
      ),
    handoffReturnableCustody: (
      organizationId: string,
      unitId: string,
      body: {
        issueMovementIds: string[];
        toIdentityId: string;
        toShiftReference?: string;
        note: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/custody/handoffs",
        body,
        idempotencyKey,
      ),
    createReturnableIncident: (
      organizationId: string,
      unitId: string,
      body: {
        movementId?: string;
        containerInventoryItemId: string;
        locationId?: string;
        orderId?: string;
        type: "breakage" | "loss" | "suspected_theft" | "recording_error" | "other";
        quantity: string;
        note: string;
        evidence?: string[];
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/incidents",
        body,
        idempotencyKey,
      ),
    reviewReturnableIncident: (
      organizationId: string,
      unitId: string,
      incidentId: string,
      body: { decision: "approved" | "rejected"; reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/returnables/incidents/${encodeURIComponent(incidentId)}/review`,
        body,
        idempotencyKey,
      ),
    exchangeReturnablesWithSupplier: (
      organizationId: string,
      unitId: string,
      body: {
        containerInventoryItemId: string;
        locationId: string;
        supplierId: string;
        quantity: string;
        note: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/returnables/supplier-exchanges",
        body,
        idempotencyKey,
      ),
    resolveReturnableSupplierExchange: (
      organizationId: string,
      unitId: string,
      exchangeId: string,
      body: { decision: "received" | "canceled"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/returnables/supplier-exchanges/${encodeURIComponent(exchangeId)}/resolve`,
        body,
        idempotencyKey,
      ),
    recipes: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory/recipes")),
    configureRecipe: (
      organizationId: string,
      unitId: string,
      body: {
        productId: string;
        components: Array<{
          inventoryItemId: string;
          locationId: string;
          quantityMilli: number;
          lossBasisPoints: number;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "inventory/recipes", body, idempotencyKey),
    purchases: (organizationId: string, unitId: string, filters: PurchaseListFilters = {}) =>
      request<unknown>(managementListPath(organizationId, unitId, "purchases", filters)),
    importNfe: (
      organizationId: string,
      unitId: string,
      body: { xml: string; supplierId?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "purchases/nfe-imports",
        body,
        idempotencyKey,
      ),
    reviewNfeImport: (
      organizationId: string,
      unitId: string,
      importId: string,
      body: {
        supplierId?: string;
        lines: Array<{
          lineId: string;
          status: "matched" | "new" | "ignored";
          inventoryItemId?: string;
          newItem?: {
            name: string;
            kind: "ingredient" | "prepared" | "resale" | "reusable" | "returnable_container";
            productId?: string;
            unit: string;
            sku?: string;
            barcode?: string;
            purchaseUnit?: string;
            purchaseToStockFactor: string;
          };
        }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `purchases/nfe-imports/${encodeURIComponent(importId)}/review`,
        ),
        "PUT",
        body,
        idempotencyKey,
      ),
    confirmNfeImport: (
      organizationId: string,
      unitId: string,
      importId: string,
      body: {
        locationId: string;
        purchaseOrderId?: string;
        dueDate: string;
        receivedAt?: string;
        acceptTotalDivergence?: boolean;
        divergenceReason?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/nfe-imports/${encodeURIComponent(importId)}/confirm`,
        body,
        idempotencyKey,
      ),
    suppliers: (
      organizationId: string,
      unitId: string,
      filters: Pick<PurchaseListFilters, "page" | "pageSize" | "search"> & {
        active?: boolean;
      } = {},
    ) => request<unknown>(managementListPath(organizationId, unitId, "suppliers", filters)),
    finance: (organizationId: string, unitId: string, filters: FinanceFilters = {}) =>
      request<unknown>(managementListPath(organizationId, unitId, "finance", filters)),
    financeSettings: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "finance/settings")),
    exportFinance: (
      organizationId: string,
      unitId: string,
      filters: Omit<FinanceFilters, "page" | "pageSize"> & { format: "csv" | "pdf" },
    ) => request<unknown>(managementListPath(organizationId, unitId, "finance/export", filters)),
    reports: (
      organizationId: string,
      unitId: string,
      query: {
        from: string;
        to: string;
        comparisonMode: "previous_period" | "previous_year" | "none";
        family?: string;
        minimumComparableOperatingDays?: number;
      },
      signal?: AbortSignal,
    ) => request<unknown>(managementListPath(organizationId, unitId, "reports", query), { signal }),
    reportDrillDown: (
      organizationId: string,
      unitId: string,
      query: {
        from: string;
        to: string;
        dimension:
          | "metric"
          | "product"
          | "category"
          | "channel"
          | "payment_method"
          | "exception"
          | "inventory"
          | "purchase"
          | "operation"
          | "labor"
          | "reconciliation"
          | "forecast";
        key: string;
        cursor?: string;
        limit?: string;
      },
    ) =>
      request<unknown>(
        `${managementPath(organizationId, unitId, "reports/drill-down")}?${new URLSearchParams(query)}`,
      ),
    reportBudgets: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "reports/budgets")),
    updateReportBudget: (
      organizationId: string,
      unitId: string,
      month: string,
      body: { metric: string; targetCents: number; version?: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `reports/budgets/${encodeURIComponent(month)}`),
        "PUT",
        body,
        idempotencyKey,
      ),
    reportExports: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "reports/exports")),
    createReportExport: (
      organizationId: string,
      unitId: string,
      body: {
        from: string;
        to: string;
        comparisonMode: "previous_period" | "previous_year" | "none";
        family:
          | "overview"
          | "sales"
          | "exceptions"
          | "inventory"
          | "purchasing"
          | "operations"
          | "profitability"
          | "multiunit"
          | "quality"
          | "labor"
          | "reconciliation"
          | "forecast";
        format: "csv" | "pdf" | "xlsx";
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/exports"),
        "POST",
        body,
        idempotencyKey,
      ),
    reportExportContent: (organizationId: string, unitId: string, exportId: string) =>
      requestDownload(
        managementPath(
          organizationId,
          unitId,
          `reports/exports/${encodeURIComponent(exportId)}/content`,
        ),
      ),
    reportViews: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "reports/views")),
    createReportView: (
      organizationId: string,
      unitId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/views"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateReportView: (
      organizationId: string,
      unitId: string,
      viewId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `reports/views/${encodeURIComponent(viewId)}`),
        "PATCH",
        body,
        idempotencyKey,
      ),
    deleteReportView: (
      organizationId: string,
      unitId: string,
      viewId: string,
      version: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<void>(
        `${managementPath(
          organizationId,
          unitId,
          `reports/views/${encodeURIComponent(viewId)}`,
        )}?${new URLSearchParams({ version: String(version) })}`,
        "DELETE",
        undefined,
        idempotencyKey,
      ),
    reportAlerts: (organizationId: string, unitId: string, status?: string) =>
      request<unknown>(managementListPath(organizationId, unitId, "reports/alerts", { status })),
    evaluateReportAlerts: (
      organizationId: string,
      unitId: string,
      body: { from: string; to: string; comparisonMode: string; dueInDays?: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/alerts/evaluate"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateReportAlert: (
      organizationId: string,
      unitId: string,
      alertId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `reports/alerts/${encodeURIComponent(alertId)}`),
        "PATCH",
        body,
        idempotencyKey,
      ),
    backfillReportCosts: (
      organizationId: string,
      unitId: string,
      body: {
        from: string;
        to: string;
        comparisonMode: string;
        allowEstimated: boolean;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/costs/backfill"),
        "POST",
        body,
        idempotencyKey,
      ),
    previewReportCosts: (
      organizationId: string,
      unitId: string,
      body: {
        from: string;
        to: string;
        comparisonMode: string;
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "reports/costs/backfill/preview"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    closeReportReconciliation: (
      organizationId: string,
      unitId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/reconciliation/closure"),
        "POST",
        body,
        idempotencyKey,
      ),
    reportSchedules: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "reports/schedules")),
    createReportSchedule: (
      organizationId: string,
      unitId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "reports/schedules"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateReportSchedule: (
      organizationId: string,
      unitId: string,
      scheduleId: string,
      body: Record<string, unknown>,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `reports/schedules/${encodeURIComponent(scheduleId)}`,
        ),
        "PATCH",
        body,
        idempotencyKey,
      ),
    deleteReportSchedule: (
      organizationId: string,
      unitId: string,
      scheduleId: string,
      version: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<void>(
        `${managementPath(
          organizationId,
          unitId,
          `reports/schedules/${encodeURIComponent(scheduleId)}`,
        )}?${new URLSearchParams({ version: String(version) })}`,
        "DELETE",
        undefined,
        idempotencyKey,
      ),
    cashShifts: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "cash-shifts")),
    cashShiftHistory: (
      organizationId: string,
      unitId: string,
      query: {
        cursor?: string;
        limit?: number;
        from?: string;
        to?: string;
        cashRegisterId?: string;
        operatorIdentityId?: string;
        status?: string;
      },
    ) => request<unknown>(managementListPath(organizationId, unitId, "cash-shifts/history", query)),
    cashShiftDetail: (organizationId: string, unitId: string, cashShiftId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `cash-shifts/${encodeURIComponent(cashShiftId)}/detail`,
        ),
      ),
    exportCashShiftHistory: (
      organizationId: string,
      unitId: string,
      query: {
        format: "csv" | "pdf";
        from?: string;
        to?: string;
        cashRegisterId?: string;
        operatorIdentityId?: string;
        status?: string;
      },
    ) => requestDownload(managementListPath(organizationId, unitId, "cash-shifts/export", query)),
    waiterSettlements: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "waiter-settlements")),
    waiterSettlementLossCandidates: (organizationId: string, unitId: string, query: string) =>
      request<unknown>(
        managementListPath(
          organizationId,
          unitId,
          "waiter-settlements/operational-losses/candidates",
          { query },
        ),
      ),
    updateWaiterSettlementSettings: (
      organizationId: string,
      unitId: string,
      body: {
        serviceChargeEnabled: boolean;
        defaultServiceChargeBasisPoints: number;
        serviceChargeApplication: "manual" | "suggest_dine_in";
        attributionMode: "final_responsible" | "order_creator";
        transferMode: "move_to_final" | "preserve_origin";
        serviceBase: "gross" | "net_after_discounts";
        eligibleTabs: "closed" | "fully_paid";
        serviceDistribution: "individual_sales" | "equal_pool";
        serviceTeamShareBasisPoints: number;
        partnershipBase: "gross" | "net" | "received" | "net_excluding_service";
        tierApplication: "all_revenue" | "progressive";
        discountTreatment: "deduct" | "ignore";
        cancellationTreatment: "exclude" | "deduct";
        refundTreatment: "deduct" | "informational";
        periodMode: "calendar_month" | "custom";
        customPeriodStartDay: number;
        aggregateAcrossUnits: boolean;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "waiter-settlements/settings"),
        "PUT",
        body,
        idempotencyKey,
      ),
    updateWaiterPartnershipPlan: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        effectiveFrom: string;
        tiers: Array<{
          minimumCents: number;
          maximumCents: number | null;
          rewardType: "percentage" | "fixed";
          rewardValue: number;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "waiter-settlements/partnership-plan"),
        "PUT",
        body,
        idempotencyKey,
      ),
    createWaiterOperationalLoss: (
      organizationId: string,
      unitId: string,
      body: {
        tabId: string;
        type: "unpaid_tab" | "refund" | "chargeback" | "other";
        reason: string;
        amountCents?: number;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "waiter-settlements/operational-losses",
        body,
        idempotencyKey,
      ),
    decideWaiterOperationalLoss: (
      organizationId: string,
      unitId: string,
      lossId: string,
      body: { action: "approve" | "reject" | "reverse"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `waiter-settlements/losses/${encodeURIComponent(lossId)}/decision`,
        body,
        idempotencyKey,
      ),
    previewWaiterSettlement: (
      organizationId: string,
      unitId: string,
      body: { from: string; to: string; operationalShiftId?: string },
    ) =>
      request<unknown>(
        managementPath(organizationId, unitId, "waiter-settlements/settlements/preview"),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    createWaiterSettlement: (
      organizationId: string,
      unitId: string,
      body: { from: string; to: string; operationalShiftId?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "waiter-settlements/settlements",
        body,
        idempotencyKey,
      ),
    transitionWaiterSettlement: (
      organizationId: string,
      unitId: string,
      settlementId: string,
      body: { action: "approve" | "pay" | "cancel"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `waiter-settlements/settlements/${encodeURIComponent(settlementId)}/transition`,
        body,
        idempotencyKey,
      ),
    waiterSettlementExport: (organizationId: string, unitId: string, settlementId: string) =>
      requestDownload(
        `${managementPath(
          organizationId,
          unitId,
          `waiter-settlements/settlements/${encodeURIComponent(settlementId)}/export`,
        )}?format=csv`,
      ),
    people: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "people")),
    peopleDirectory: (
      organizationId: string,
      unitId: string,
      query: {
        q?: string;
        status?: "all" | "active" | "inactive" | "unlinked" | "on_shift";
        role?: string;
        page: number;
        pageSize: number;
      },
    ) =>
      request<unknown>(
        `${managementPath(organizationId, unitId, "people/directory")}?${new URLSearchParams(
          Object.entries(query)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => [key, String(value)]),
        )}`,
      ),
    peopleCapabilities: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "people/capabilities")),
    personTimeline: (
      organizationId: string,
      unitId: string,
      personId: string,
      period: { from: string; to: string; comparisonMode?: "none" },
    ) =>
      request<unknown>(
        `${managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/timeline`,
        )}?${new URLSearchParams({ ...period, comparisonMode: period.comparisonMode ?? "none" })}`,
      ),
    peopleOperationalIndicators: (
      organizationId: string,
      unitId: string,
      period: { from: string; to: string; comparisonMode?: "none" },
    ) =>
      request<unknown>(
        `${managementPath(organizationId, unitId, "people/indicators/operational")}?${new URLSearchParams({ ...period, comparisonMode: period.comparisonMode ?? "none" })}`,
      ),
    peopleSelf: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "people/self")),
    updateTimeTrackingSettings: (
      organizationId: string,
      unitId: string,
      body: {
        mode: "off" | "all" | "selected";
        geofenceEnabled: boolean;
        locationLabel?: string;
        locationAddress?: string;
        latitude?: number;
        longitude?: number;
        radiusMeters: number;
        accuracyToleranceMeters: number;
        maxLocationAccuracyMeters: number;
        lowAccuracyPolicy: "block" | "flag";
        additionalLocations: Array<{
          id?: string;
          label: string;
          address?: string;
          latitude: number;
          longitude: number;
          radiusMeters: number;
          accuracyToleranceMeters: number;
        }>;
        managerCanView: boolean;
        financeCanView: boolean;
        antiFraudEnabled: boolean;
        offlineEnabled: boolean;
        offlineMaxDelayMinutes: number;
        offlineRequiresJustification: boolean;
        notificationsEnabled: boolean;
        emailAlertsEnabled: boolean;
        managerAlertOnAnomaly: boolean;
        locationRetentionDays: number;
        locationChangeReason?: string;
        lateToleranceMinutes: number;
        minimumBreakMinutes: number;
        maxOvertimeMinutes: number;
        longShiftAlertMinutes: number;
        reminderBeforeShiftMinutes: number;
        reminderAfterShiftMinutes: number;
        selectedPersonIds: string[];
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people/time-tracking/settings"), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    timeTrackingSettingsHistory: (organizationId: string, unitId: string) =>
      request<unknown>(
        managementPath(organizationId, unitId, "people/time-tracking/settings/history"),
      ),
    timeTrackingLocationAnomalies: (
      organizationId: string,
      unitId: string,
      period: { from: string; to: string },
    ) =>
      request<unknown>(
        `${managementPath(organizationId, unitId, "people/time-tracking/location-anomalies")}?${new URLSearchParams({ ...period, comparisonMode: "none" })}`,
      ),
    timeTrackingReport: (
      organizationId: string,
      unitId: string,
      period: { from: string; to: string },
    ) =>
      request<unknown>(
        `${managementPath(organizationId, unitId, "people/time-tracking/report")}?${new URLSearchParams(period)}`,
      ),
    closeTimeTrackingPeriod: (
      organizationId: string,
      unitId: string,
      body: { from: string; to: string; reason?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/time-tracking/closures",
        body,
        idempotencyKey,
      ),
    reopenTimeTrackingPeriod: (
      organizationId: string,
      unitId: string,
      closureId: string,
      body: { reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `people/time-tracking/closures/${encodeURIComponent(closureId)}/reopen`,
        body,
        idempotencyKey,
      ),
    createStockLocation: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        code: string;
        barcode?: string;
        kind?: "warehouse" | "cooler" | "freezer" | "bar" | "kitchen" | "returnables" | "other";
        responsibleIdentityId?: string | null;
        requireDistinctTransferReceiver?: boolean;
        transferSlaMinutes?: number;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/locations",
        body,
        idempotencyKey,
      ),
    updateStockLocation: (
      organizationId: string,
      unitId: string,
      locationId: string,
      body: {
        name?: string;
        code?: string;
        barcode?: string | null;
        kind?: "warehouse" | "cooler" | "freezer" | "bar" | "kitchen" | "returnables" | "other";
        responsibleIdentityId?: string | null;
        requireDistinctTransferReceiver?: boolean;
        transferSlaMinutes?: number;
        active?: boolean;
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/locations/${encodeURIComponent(locationId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveStockLocation: (organizationId: string, unitId: string, locationId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/locations/${encodeURIComponent(locationId)}`,
        ),
        { method: "DELETE" },
      ),
    createInventoryItem: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        sku?: string;
        barcode?: string;
        productId?: string;
        preferredSupplierId?: string;
        unit: string;
        purchaseUnit?: string;
        purchaseToStockFactor: string;
        minimumQuantity: string;
        reorderQuantity: string;
        leadTimeDays: number;
        allowNegative: boolean;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "inventory/items", body, idempotencyKey),
    updateInventoryItem: (
      organizationId: string,
      unitId: string,
      inventoryItemId: string,
      body: Record<string, unknown>,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/items/${encodeURIComponent(inventoryItemId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveInventoryItem: (organizationId: string, unitId: string, inventoryItemId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `inventory/items/${encodeURIComponent(inventoryItemId)}`,
        ),
        { method: "DELETE" },
      ),
    createInventoryEvent: (
      organizationId: string,
      unitId: string,
      body: {
        type: "loss" | "count" | "adjustment";
        reason: string;
        lines: Array<{
          locationId: string;
          inventoryItemId: string;
          lotId?: string;
          quantity: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "inventory/events", body, idempotencyKey),
    reviewInventoryEvent: (
      organizationId: string,
      unitId: string,
      requestId: string,
      body: { decision: "approved" | "rejected"; reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/events/reviews/${encodeURIComponent(requestId)}`,
        body,
        idempotencyKey,
      ),
    transferInventory: (
      organizationId: string,
      unitId: string,
      body: {
        inventoryItemId: string;
        sourceLocationId: string;
        destinationLocationId: string;
        quantity: string;
        reason: string;
        lotId?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/transfers",
        body,
        idempotencyKey,
      ),
    transferInventoryBatch: (
      organizationId: string,
      unitId: string,
      body: {
        sourceLocationId: string;
        destinationLocationId: string;
        reason: string;
        lines: Array<{ inventoryItemId: string; quantity: string; lotId?: string }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/transfers/batches",
        body,
        idempotencyKey,
      ),
    configureInventoryIssueRoute: (
      organizationId: string,
      unitId: string,
      body: { productId: string; stationId?: string; locationId: string; active: boolean },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "inventory/issue-routes",
        body,
        idempotencyKey,
      ),
    configureStockLocationItemSetting: (
      organizationId: string,
      unitId: string,
      body: {
        locationId: string;
        inventoryItemId: string;
        minimumQuantity: string;
        targetQuantity: string;
        transferUnitLabel?: string;
        unitsPerTransferUnit: string;
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "inventory/location-item-settings"), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    resolveInventoryTransfer: (
      organizationId: string,
      unitId: string,
      transferId: string,
      body: {
        decision: "received" | "canceled";
        quantityReceived?: string;
        quantityDivergent?: string;
        divergenceReason?: string;
        evidence?: string[];
        note: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `inventory/transfers/${encodeURIComponent(transferId)}/resolve`,
        body,
        idempotencyKey,
      ),
    createInventoryAsset: (
      organizationId: string,
      unitId: string,
      body: {
        inventoryItemId: string;
        locationId: string;
        assetTag: string;
        status: "in_use" | "maintenance" | "damaged" | "retired";
        condition: "good" | "fair" | "poor" | "unusable";
        acquiredAt?: string;
        lastMaintenanceAt?: string;
        notes?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "inventory/assets", body, idempotencyKey),
    updateInventoryAsset: (
      organizationId: string,
      unitId: string,
      assetId: string,
      body: Record<string, unknown>,
    ) =>
      request<unknown>(
        managementPath(organizationId, unitId, `inventory/assets/${encodeURIComponent(assetId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    createInventoryLot: (
      organizationId: string,
      unitId: string,
      body: {
        inventoryItemId: string;
        locationId: string;
        batchCode: string;
        expiresAt?: string;
        quantity: string;
        unitCostCents?: number;
      },
      idempotencyKey?: string,
    ) => managementCommand<unknown>(organizationId, unitId, "inventory/lots", body, idempotencyKey),
    updateInventoryLot: (
      organizationId: string,
      unitId: string,
      lotId: string,
      body: { batchCode?: string; expiresAt?: string | null; active?: boolean },
    ) =>
      request<unknown>(
        managementPath(organizationId, unitId, `inventory/lots/${encodeURIComponent(lotId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    createSupplier: (
      organizationId: string,
      unitId: string,
      body: SupplierInput,
      idempotencyKey?: string,
    ) => managementCommand<unknown>(organizationId, unitId, "suppliers", body, idempotencyKey),
    updateSupplier: (
      organizationId: string,
      unitId: string,
      supplierId: string,
      body: Partial<SupplierInput> & { active?: boolean; version: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `suppliers/${encodeURIComponent(supplierId)}`),
        "PUT",
        body,
        idempotencyKey,
      ),
    archiveSupplier: (
      organizationId: string,
      unitId: string,
      supplierId: string,
      body: { version: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `suppliers/${encodeURIComponent(supplierId)}`),
        "DELETE",
        body,
        idempotencyKey,
      ),
    createPurchase: (
      organizationId: string,
      unitId: string,
      body: PurchaseOrderInput,
      idempotencyKey?: string,
    ) => managementCommand<unknown>(organizationId, unitId, "purchases", body, idempotencyKey),
    updatePurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: Partial<PurchaseOrderInput> & { version: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, `purchases/${encodeURIComponent(purchaseOrderId)}`),
        "PUT",
        body,
        idempotencyKey,
      ),
    cancelPurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: PurchaseTransitionInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/cancel`,
        body,
        idempotencyKey,
      ),
    reversePurchaseReceipt: (
      organizationId: string,
      unitId: string,
      receiptId: string,
      body: PurchaseTransitionInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/receipts/${encodeURIComponent(receiptId)}/reverse`,
        body,
        idempotencyKey,
      ),
    rejectPurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: PurchaseTransitionInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/reject`,
        body,
        idempotencyKey,
      ),
    receivePurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: {
        receivedAt?: string;
        competenceDate?: string;
        dueDate?: string;
        lines: PurchaseReceiptLineInput[];
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/receipts`,
        body,
        idempotencyKey,
      ),
    createPurchaseInvoice: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: PurchaseInvoiceInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/invoices`,
        body,
        idempotencyKey,
      ),
    reconcilePurchaseInvoice: (
      organizationId: string,
      unitId: string,
      invoiceId: string,
      body: { toleranceCents?: number; version: number },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/invoices/${encodeURIComponent(invoiceId)}/reconcile`,
        body,
        idempotencyKey,
      ),
    confirmPurchaseInvoice: (
      organizationId: string,
      unitId: string,
      invoiceId: string,
      body: {
        toleranceCents?: number;
        acceptDivergence: boolean;
        reason?: string;
        version: number;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/invoices/${encodeURIComponent(invoiceId)}/confirm`,
        body,
        idempotencyKey,
      ),
    cancelPurchaseInvoice: (
      organizationId: string,
      unitId: string,
      invoiceId: string,
      body: PurchaseTransitionInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/invoices/${encodeURIComponent(invoiceId)}/cancel`,
        body,
        idempotencyKey,
      ),
    createPerson: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        employmentCode?: string;
        roleLabel: string;
        hiredAt?: string;
        identityId?: string;
        access?: {
          email: string;
          role: string;
          reauth?: { currentPassword?: string; mfaCode?: string };
        };
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    invitePersonAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      body: {
        email: string;
        role: string;
        reauth?: { currentPassword?: string; mfaCode?: string };
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/invite`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    resendPersonAccess: (organizationId: string, unitId: string, personId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/resend`,
        ),
        { method: "POST", body: JSON.stringify({}) },
      ),
    cancelPersonAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      reason: string,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/cancel`,
        ),
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    updatePersonAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      body: {
        role: string;
        reason: string;
        reauth?: { currentPassword?: string; mfaCode?: string };
      },
    ) =>
      request<unknown>(
        managementPath(organizationId, unitId, `people/${encodeURIComponent(personId)}/access`),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    suspendPersonAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      reason: string,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/suspend`,
        ),
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    reactivatePersonAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      body: {
        role?: string;
        reason: string;
        reauth?: { currentPassword?: string; mfaCode?: string };
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/reactivate`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    peopleAccessCenter: (organizationId: string, unitId: string) =>
      request<unknown>(managementPath(organizationId, unitId, "people/access-center")),
    revokeManagedTerminal: (
      organizationId: string,
      unitId: string,
      terminalSessionId: string,
      reason: string,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/terminals/${encodeURIComponent(terminalSessionId)}/revoke`,
        ),
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    personAccessOverview: (organizationId: string, unitId: string, personId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access-overview`,
        ),
      ),
    personOffboardingPreflight: (organizationId: string, unitId: string, personId: string) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/offboarding-preflight`,
        ),
      ),
    assignPersonUnitAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      body: {
        unitId: string;
        role: string;
        reason: string;
        reauth?: { currentPassword?: string; mfaCode?: string };
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/units`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    removePersonUnitAccess: (
      organizationId: string,
      unitId: string,
      personId: string,
      targetUnitId: string,
      body: {
        reason: string;
        reauth?: { currentPassword?: string; mfaCode?: string };
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/access/units/${encodeURIComponent(targetUnitId)}`,
        ),
        { method: "DELETE", body: JSON.stringify(body) },
      ),
    updatePerson: (
      organizationId: string,
      unitId: string,
      personId: string,
      body: {
        identityId?: string | null;
        name?: string;
        employmentCode?: string | null;
        roleLabel?: string;
        hourlyRateCents?: number | null;
        hiredAt?: string | null;
        expectedUpdatedAt?: string;
      },
    ) =>
      request<unknown>(
        managementPath(organizationId, unitId, `people/${encodeURIComponent(personId)}`),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    changePersonStatus: (
      organizationId: string,
      unitId: string,
      personId: string,
      active: boolean,
      reason: string,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/${encodeURIComponent(personId)}/${active ? "reactivate" : "inactivate"}`,
        ),
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    createSchedule: (
      organizationId: string,
      unitId: string,
      body: {
        personId: string;
        startsAt: string;
        endsAt: string;
        breakMinutes: number;
        notes?: string;
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people/schedules"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updatePeopleSchedule: (
      organizationId: string,
      unitId: string,
      scheduleId: string,
      body: {
        startsAt?: string;
        endsAt?: string;
        breakMinutes?: number;
        notes?: string | null;
        expectedUpdatedAt?: string;
      },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/schedules/${encodeURIComponent(scheduleId)}`,
        ),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    cancelPeopleSchedule: (
      organizationId: string,
      unitId: string,
      scheduleId: string,
      reason: string,
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/schedules/${encodeURIComponent(scheduleId)}/cancel`,
        ),
        { method: "POST", body: JSON.stringify({ reason }) },
      ),
    previewPeopleSchedulesBatch: (
      organizationId: string,
      unitId: string,
      body: {
        schedules: Array<{
          personId: string;
          startsAt: string;
          endsAt: string;
          breakMinutes: number;
          notes?: string;
        }>;
      },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people/schedules/batch/preview"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createPeopleSchedulesBatch: (
      organizationId: string,
      unitId: string,
      body: {
        schedules: Array<{
          personId: string;
          startsAt: string;
          endsAt: string;
          breakMinutes: number;
          notes?: string;
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/schedules/batch",
        body,
        idempotencyKey,
      ),
    createCommissionRule: (
      organizationId: string,
      unitId: string,
      body: { name: string; basisPoints: number },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people/commission-rules"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createCommission: (
      organizationId: string,
      unitId: string,
      body: {
        personId: string;
        ruleId?: string;
        sourceOrderId?: string;
        baseCents: number;
        amountCents?: number;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/commissions",
        body,
        idempotencyKey,
      ),
    transitionCommission: (
      organizationId: string,
      unitId: string,
      commissionId: string,
      body: { action: "approve" | "reject" | "pay" | "cancel"; note: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `people/commissions/${encodeURIComponent(commissionId)}/transition`,
        body,
        idempotencyKey,
      ),
    updateTimeTrackingAssignmentsBatch: (
      organizationId: string,
      unitId: string,
      body: { personIds: string[]; enabled: boolean },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/time-tracking/assignments/batch",
        body,
        idempotencyKey,
      ),
    exportPeople: (
      organizationId: string,
      unitId: string,
      body: { personIds: string[]; format: "csv" | "json" },
    ) =>
      request<unknown>(managementPath(organizationId, unitId, "people/export"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createTimeEntry: (
      organizationId: string,
      unitId: string,
      body: {
        personId: string;
        clockedInAt: string;
        clockedOutAt?: string;
        source: "manual" | "terminal";
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/time-entries",
        body,
        idempotencyKey,
      ),
    selfClockIn: (
      organizationId: string,
      unitId: string,
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt?: string;
        deviceId?: string;
        sessionId?: string;
        offline?: boolean;
        offlineJustification?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/self/clock-in",
        location,
        idempotencyKey,
      ),
    selfStartBreak: (
      organizationId: string,
      unitId: string,
      body: {
        type: "meal" | "temporary";
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt?: string;
        deviceId?: string;
        sessionId?: string;
        offline?: boolean;
        offlineJustification?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/self/breaks",
        body,
        idempotencyKey,
      ),
    selfCompleteBreak: (
      organizationId: string,
      unitId: string,
      breakId: string,
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt?: string;
        deviceId?: string;
        sessionId?: string;
        offline?: boolean;
        offlineJustification?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `people/self/breaks/${encodeURIComponent(breakId)}/complete`,
        location,
        idempotencyKey,
      ),
    selfClockOut: (
      organizationId: string,
      unitId: string,
      location: {
        latitude: number;
        longitude: number;
        accuracyMeters?: number;
        capturedAt?: string;
        deviceId?: string;
        sessionId?: string;
        offline?: boolean;
        offlineJustification?: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/self/clock-out",
        location,
        idempotencyKey,
      ),
    requestTimeCorrection: (
      organizationId: string,
      unitId: string,
      body: {
        timeEntryId: string;
        clockedInAt: string;
        clockedOutAt?: string;
        reason: string;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "people/self/time-corrections",
        body,
        idempotencyKey,
      ),
    decideTimeCorrection: (
      organizationId: string,
      unitId: string,
      correctionId: string,
      body: { decision: "approve" | "reject"; reviewNote?: string },
    ) =>
      request<unknown>(
        managementPath(
          organizationId,
          unitId,
          `people/time-corrections/${encodeURIComponent(correctionId)}/decision`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    createPayable: (
      organizationId: string,
      unitId: string,
      body: FinanceEntryInput & { supplierId?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "finance/payables", body, idempotencyKey),
    payPayable: (
      organizationId: string,
      unitId: string,
      payableId: string,
      body: FinancePaymentInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `finance/payables/${encodeURIComponent(payableId)}/payments`,
        body,
        idempotencyKey,
      ),
    createReceivable: (
      organizationId: string,
      unitId: string,
      body: FinanceEntryInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "finance/receivables",
        { ...body, lines: [] },
        idempotencyKey,
      ),
    receiveReceivable: (
      organizationId: string,
      unitId: string,
      receivableId: string,
      body: FinancePaymentInput,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `finance/receivables/${encodeURIComponent(receivableId)}/payments`,
        body,
        idempotencyKey,
      ),
    updateFinanceEntry: (
      organizationId: string,
      unitId: string,
      direction: "payable" | "receivable",
      entryId: string,
      body: Partial<FinanceEntryInput> & { version: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `finance/${direction === "payable" ? "payables" : "receivables"}/${encodeURIComponent(entryId)}`,
        ),
        "PATCH",
        body,
        idempotencyKey,
      ),
    cancelFinanceEntry: (
      organizationId: string,
      unitId: string,
      direction: "payable" | "receivable",
      entryId: string,
      body: { version: number; reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `finance/${direction === "payable" ? "payables" : "receivables"}/${encodeURIComponent(entryId)}/cancel`,
        body,
        idempotencyKey,
      ),
    reverseFinancePayment: (
      organizationId: string,
      unitId: string,
      direction: "payable" | "receivable",
      paymentId: string,
      body: { reason: string; cashRegisterId?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `finance/${direction === "payable" ? "payables" : "receivables"}/payments/${encodeURIComponent(paymentId)}/reverse`,
        body,
        idempotencyKey,
      ),
    requestFinanceApproval: (
      organizationId: string,
      unitId: string,
      body: FinancePaymentInput & { direction: "payable" | "receivable"; entryId: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "finance/approvals", body, idempotencyKey),
    decideFinanceApproval: (
      organizationId: string,
      unitId: string,
      approvalRequestId: string,
      body: { decision: "approve" | "reject"; note?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `finance/approvals/${encodeURIComponent(approvalRequestId)}/decision`,
        body,
        idempotencyKey,
      ),
    updateFinanceSettings: (
      organizationId: string,
      unitId: string,
      body: {
        paymentApprovalThresholdCents: number | null;
        requireDistinctApprover: boolean;
        dueSoonDays: number;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "finance/settings"),
        "PUT",
        body,
        idempotencyKey,
      ),
    importFinanceReconciliation: (
      organizationId: string,
      unitId: string,
      body: unknown,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(organizationId, unitId, "reconciliations", body, idempotencyKey),
    resolveFinanceReconciliation: (
      organizationId: string,
      unitId: string,
      reconciliationEntryId: string,
      body: {
        paymentDirection: "payable" | "receivable";
        paymentId: string;
        note: string;
        version: number;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `reconciliations/${encodeURIComponent(reconciliationEntryId)}/resolve`,
        body,
        idempotencyKey,
      ),
    approvePurchase: (
      organizationId: string,
      unitId: string,
      purchaseOrderId: string,
      body: { version: number },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `purchases/${encodeURIComponent(purchaseOrderId)}/approve`,
        body,
        idempotencyKey,
      ),
    openCashShift: (
      organizationId: string,
      unitId: string,
      openingCents: number,
      idempotencyKey?: string,
      cashRegisterId?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "cash-shifts",
        { openingCents, cashRegisterId },
        idempotencyKey,
      ),
    createCashRegister: (
      organizationId: string,
      unitId: string,
      name: string,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        "cash-registers",
        { name },
        idempotencyKey,
      ),
    updateCashRegister: (
      organizationId: string,
      unitId: string,
      cashRegisterId: string,
      body: { name?: string; active?: boolean },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `cash-registers/${encodeURIComponent(cashRegisterId)}`,
        ),
        "PATCH",
        body,
        idempotencyKey,
      ),
    transferCash: (
      organizationId: string,
      unitId: string,
      body: {
        fromCashShiftId: string;
        toCashShiftId: string;
        amountCents: number;
        reason: string;
      },
      idempotencyKey?: string,
    ) => managementCommand<unknown>(organizationId, unitId, "cash-transfers", body, idempotencyKey),
    decideCashTransfer: (
      organizationId: string,
      unitId: string,
      cashTransferId: string,
      body: { decision: "accept" | "reject"; note?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-transfers/${encodeURIComponent(cashTransferId)}/decision`,
        body,
        idempotencyKey,
      ),
    addCashMovement: (
      organizationId: string,
      unitId: string,
      cashShiftId: string,
      body: { type: "supply" | "withdrawal"; amountCents: number; reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-shifts/${encodeURIComponent(cashShiftId)}/movements`,
        body,
        idempotencyKey,
      ),
    updateCashSettings: (
      organizationId: string,
      unitId: string,
      body: {
        movementApprovalThresholdCents: number;
        discrepancyCriticalThresholdCents: number;
        maxShiftMinutes: number;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(organizationId, unitId, "cash-settings"),
        "PUT",
        body,
        idempotencyKey,
      ),
    bindCashTerminal: (
      organizationId: string,
      unitId: string,
      installationId: string,
      cashRegisterId: string | null,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        managementPath(
          organizationId,
          unitId,
          `cash-terminals/${encodeURIComponent(installationId)}`,
        ),
        "PATCH",
        { cashRegisterId },
        idempotencyKey,
      ),
    decideCashApproval: (
      organizationId: string,
      unitId: string,
      approvalId: string,
      body: { decision: "approve" | "reject"; note?: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-approvals/${encodeURIComponent(approvalId)}/decision`,
        body,
        idempotencyKey,
      ),
    handoverCashShift: (
      organizationId: string,
      unitId: string,
      cashShiftId: string,
      body: { toIdentityId: string; reason: string },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-shifts/${encodeURIComponent(cashShiftId)}/handover`,
        body,
        idempotencyKey,
      ),
    closeCashShift: (
      organizationId: string,
      unitId: string,
      cashShiftId: string,
      body: {
        countedCents: number;
        closeReason?: string;
        tenderCounts?: Array<{
          method: string;
          observedCents: number;
          source: "manual" | "smartpos";
        }>;
      },
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-shifts/${encodeURIComponent(cashShiftId)}/close`,
        body,
        idempotencyKey,
      ),
    reviewCashShift: (
      organizationId: string,
      unitId: string,
      cashShiftId: string,
      note: string,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `cash-shifts/${encodeURIComponent(cashShiftId)}/review`,
        { note },
        idempotencyKey,
      ),
    clockOut: (
      organizationId: string,
      unitId: string,
      timeEntryId: string,
      clockedOutAt: string,
      idempotencyKey?: string,
    ) =>
      managementCommand<unknown>(
        organizationId,
        unitId,
        `people/time-entries/${encodeURIComponent(timeEntryId)}/clock-out`,
        { clockedOutAt },
        idempotencyKey,
      ),
  },
  integrations: {
    doseClubMemberships: (
      organizationId: string,
      unitId: string,
      tabId: string,
      productId?: string,
    ) => {
      const query = new URLSearchParams();
      if (productId) query.set("productId", productId);
      const search = query.size ? `?${query.toString()}` : "";
      return request<DoseClubMembershipsResponse>(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/integrations/doseclub/tabs/${encodeURIComponent(tabId)}/memberships${search}`,
      );
    },
  },
  pilot: {
    catalog: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog")),
    floor: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "floor")),
    tableQrPresence: (organizationId: string, unitId: string) =>
      request<{ mode: "session_only" | "daily_code"; code: string | null }>(
        pilotPath(organizationId, unitId, "tables/qr/presence"),
      ),
    operationalPushConfig: (organizationId: string, unitId: string, installationId: string) =>
      request<OperationalPushConfig>(
        pilotPath(
          organizationId,
          unitId,
          `push/subscriptions/${encodeURIComponent(installationId)}`,
        ),
      ),
    upsertOperationalPushSubscription: (
      organizationId: string,
      unitId: string,
      installationId: string,
      body: OperationalPushSubscription,
    ) =>
      request<OperationalPushConfig>(
        pilotPath(
          organizationId,
          unitId,
          `push/subscriptions/${encodeURIComponent(installationId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    removeOperationalPushSubscription: (
      organizationId: string,
      unitId: string,
      installationId: string,
    ) =>
      request<void>(
        pilotPath(
          organizationId,
          unitId,
          `push/subscriptions/${encodeURIComponent(installationId)}`,
        ),
        { method: "DELETE" },
      ),
    updateFloorLayout: (
      organizationId: string,
      unitId: string,
      body: {
        expectedRevision: number;
        tables: Array<{
          tableId: string;
          roomId: string;
          label: string;
          seats: number;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          shape: "round" | "square" | "rectangle";
        }>;
        rooms: Array<{
          roomId: string;
          points: Array<{ x: number; y: number }>;
        }>;
        layoutElements: Array<{
          id: string;
          roomId: string;
          kind: "label" | "barrier";
          label?: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
        }>;
      },
    ) =>
      request<{ revision: number }>(pilotPath(organizationId, unitId, "floor/layout"), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    tabs: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "tabs")),
    counterQueue: (
      organizationId: string,
      unitId: string,
      filters: {
        stage: "all" | "new" | "production" | "ready" | "waiting" | "delivered" | "late";
        channel: "all" | "pickup" | "dine_in" | "delivery";
        query: string;
        page: number;
        limit: number;
      },
    ) =>
      request<unknown>(
        `${pilotPath(organizationId, unitId, "counter-queue")}?${new URLSearchParams({
          stage: filters.stage,
          channel: filters.channel,
          query: filters.query,
          page: String(filters.page),
          limit: String(filters.limit),
        })}`,
      ),
    tab: (organizationId: string, unitId: string, tabId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}`)),
    kds: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "kds")),
    productionPrintingStations: (organizationId: string, unitId: string) =>
      request<{ stations: ProductionPrintingStation[] }>(
        pilotPath(organizationId, unitId, "production-printing/stations"),
      ),
    productionPrinters: (organizationId: string, unitId: string) =>
      request<{ printers: ProductionPrinter[]; hubs: ProductionPrinterHub[] }>(
        pilotPath(organizationId, unitId, "production-printers"),
      ),
    createProductionPrinter: (
      organizationId: string,
      unitId: string,
      body: ProductionPrinterInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printer: ProductionPrinter }>(
        pilotPath(organizationId, unitId, "production-printers"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateProductionPrinter: (
      organizationId: string,
      unitId: string,
      printerId: string,
      body: ProductionPrinterInput & { revision: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printer: ProductionPrinter }>(
        pilotPath(organizationId, unitId, `production-printers/${encodeURIComponent(printerId)}`),
        "PUT",
        body,
        idempotencyKey,
      ),
    archiveProductionPrinter: (
      organizationId: string,
      unitId: string,
      printerId: string,
      revision: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printer: ProductionPrinter }>(
        pilotPath(organizationId, unitId, `production-printers/${encodeURIComponent(printerId)}`),
        "DELETE",
        { revision },
        idempotencyKey,
      ),
    testProductionPrinter: (
      organizationId: string,
      unitId: string,
      printerId: string,
      revision: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{
        commandId: string;
        printerId: string;
        revision: number;
        state: "pending";
      }>(
        pilotPath(
          organizationId,
          unitId,
          `production-printers/${encodeURIComponent(printerId)}/test`,
        ),
        "POST",
        { revision },
        idempotencyKey,
      ),
    updateProductionPrintingStationPolicy: (
      organizationId: string,
      unitId: string,
      stationId: string,
      body: ProductionPrintingPolicy,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ station: ProductionPrintingStation }>(
        pilotPath(
          organizationId,
          unitId,
          `production-printing/stations/${encodeURIComponent(stationId)}/policy`,
        ),
        "PUT",
        body,
        idempotencyKey,
      ),
    createKdsPrintJob: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      body: { copies?: number; printerId?: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: ProductionPrintJob; idempotentReplay?: boolean }>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/print-jobs`),
        "POST",
        body,
        idempotencyKey,
      ),
    productionPrintJobs: (
      organizationId: string,
      unitId: string,
      query: {
        status?: ProductionPrintJobStatus;
        stationId?: string;
        kdsTicketId?: string;
        limit?: number;
      } = {},
    ) => {
      const params = new URLSearchParams({ documentType: "kds_ticket" });
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      return request<ProductionPrintJob[]>(
        pilotPath(organizationId, unitId, `print-jobs?${params.toString()}`),
      );
    },
    reprintProductionPrintJob: (
      organizationId: string,
      unitId: string,
      printJobId: string,
      body: { reason: string; copies?: number; printerId?: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: ProductionPrintJob }>(
        pilotPath(organizationId, unitId, `print-jobs/${encodeURIComponent(printJobId)}/reprint`),
        "POST",
        body,
        idempotencyKey,
      ),
    resolveUnknownProductionPrintJob: (
      organizationId: string,
      unitId: string,
      printJobId: string,
      body: { outcome: ProductionPrintResolutionOutcome; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: ProductionPrintJob; idempotentReplay?: boolean }>(
        pilotPath(
          organizationId,
          unitId,
          `production-print-jobs/${encodeURIComponent(printJobId)}/resolve-unknown`,
        ),
        "POST",
        body,
        idempotencyKey,
      ),
    kdsProductAvailability: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "kds/products/availability")),
    kdsTerminalProfile: (organizationId: string, unitId: string, installationId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `kds/terminals/${encodeURIComponent(installationId)}`),
      ),
    terminalProfile: (organizationId: string, unitId: string, installationId: string) =>
      request<TerminalProfile | null>(
        pilotPath(
          organizationId,
          unitId,
          `terminal-profiles/${encodeURIComponent(installationId)}`,
        ),
      ),
    createCategory: (
      organizationId: string,
      unitId: string,
      body: { name: string; slug: string; sortOrder?: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/categories"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateCategory: (
      organizationId: string,
      unitId: string,
      categoryId: string,
      body: {
        name?: string;
        description?: string | null;
        channels?: Array<"salon" | "delivery" | "qr" | "pickup">;
        schedule?: {
          windows: Array<{ dayOfWeek: number; start: string; end: string }>;
        } | null;
        defaultStationId?: string | null;
      },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/categories/${encodeURIComponent(categoryId)}`),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    reorderCategories: (
      organizationId: string,
      unitId: string,
      items: Array<{ id: string; sortOrder: number }>,
    ) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog/categories/reorder"), {
        method: "PUT",
        body: JSON.stringify({ items }),
      }),
    setCategoryAvailability: (
      organizationId: string,
      unitId: string,
      categoryId: string,
      available: boolean,
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/categories/${encodeURIComponent(categoryId)}/availability`,
        ),
        { method: "PUT", body: JSON.stringify({ available }) },
      ),
    archiveCategory: (organizationId: string, unitId: string, categoryId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/categories/${encodeURIComponent(categoryId)}`),
        {
          method: "DELETE",
        },
      ),
    createStation: (
      organizationId: string,
      unitId: string,
      body: { name: string; code: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/stations"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateStation: (
      organizationId: string,
      unitId: string,
      stationId: string,
      body: { name?: string; code?: string },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/stations/${encodeURIComponent(stationId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveStation: (organizationId: string, unitId: string, stationId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/stations/${encodeURIComponent(stationId)}`),
        { method: "DELETE" },
      ),
    createProduct: (
      organizationId: string,
      unitId: string,
      body: CatalogProductAggregateInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/products"),
        "POST",
        body,
        idempotencyKey,
      ),
    createAllergen: (
      organizationId: string,
      unitId: string,
      body: { code: string; name: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/allergens"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateAllergen: (
      organizationId: string,
      unitId: string,
      allergenId: string,
      body: { code?: string; name?: string },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/allergens/${encodeURIComponent(allergenId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveAllergen: (organizationId: string, unitId: string, allergenId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/allergens/${encodeURIComponent(allergenId)}`),
        { method: "DELETE" },
      ),
    createModifierGroup: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        minimumSelections: number;
        maximumSelections: number;
        options: Array<{ name: string; priceDeltaCents: number; sortOrder?: number }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/modifier-groups"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateModifierGroup: (
      organizationId: string,
      unitId: string,
      groupId: string,
      body: {
        name?: string;
        minimumSelections?: number;
        maximumSelections?: number;
        options?: Array<{
          id?: string;
          name: string;
          priceDeltaCents: number;
          active?: boolean;
          sortOrder?: number;
        }>;
      },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/modifier-groups/${encodeURIComponent(groupId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    createModifierOption: (
      organizationId: string,
      unitId: string,
      groupId: string,
      body: { name: string; priceDeltaCents: number; sortOrder: number; active: boolean },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/modifier-groups/${encodeURIComponent(groupId)}/options`,
        ),
        "POST",
        body,
        idempotencyKey,
      ),
    archiveModifierGroup: (organizationId: string, unitId: string, groupId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/modifier-groups/${encodeURIComponent(groupId)}`),
        { method: "DELETE" },
      ),
    updateModifierOption: (
      organizationId: string,
      unitId: string,
      optionId: string,
      body: { name?: string; priceDeltaCents?: number; active?: boolean },
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/modifier-options/${encodeURIComponent(optionId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveModifierOption: (organizationId: string, unitId: string, optionId: string) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/modifier-options/${encodeURIComponent(optionId)}`,
        ),
        { method: "DELETE" },
      ),
    createCombo: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        description?: string;
        priceCents: number;
        active?: boolean;
        items: Array<{ productId: string; quantity: number }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/combos"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateCombo: (
      organizationId: string,
      unitId: string,
      comboId: string,
      body: {
        name?: string;
        description?: string | null;
        priceCents?: number;
        active?: boolean;
        items?: Array<{ productId: string; quantity: number }>;
      },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/combos/${encodeURIComponent(comboId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveCombo: (organizationId: string, unitId: string, comboId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/combos/${encodeURIComponent(comboId)}`),
        { method: "DELETE" },
      ),
    updateProduct: (
      organizationId: string,
      unitId: string,
      productId: string,
      body: {
        categoryId?: string;
        name?: string;
        description?: string | null;
        imageUrl?: string | null;
        estimatedPrepTimeMinutes?: number | null;
      },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/products/${encodeURIComponent(productId)}`),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    updateProductAggregate: (
      organizationId: string,
      unitId: string,
      productId: string,
      body: CatalogProductAggregateInput,
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/products/${encodeURIComponent(productId)}/aggregate`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    reorderProducts: (
      organizationId: string,
      unitId: string,
      items: Array<{ id: string; sortOrder: number }>,
    ) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog/products/reorder"), {
        method: "PUT",
        body: JSON.stringify({ items }),
      }),
    archiveProduct: (organizationId: string, unitId: string, productId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/products/${encodeURIComponent(productId)}`),
        {
          method: "DELETE",
        },
      ),
    updateProductUnitConfig: (
      organizationId: string,
      unitId: string,
      productId: string,
      body: {
        priceCents: number;
        available: boolean;
        stationIds: string[];
        stationRouting?: Array<{ stationId: string; stage: number }>;
        deliveryPriceCents?: number | null;
        costCents?: number | null;
        dailyStock?: number | null;
        autoDeductStock?: boolean;
        availabilitySchedule?: {
          windows: Array<{ dayOfWeek: number; start: string; end: string }>;
        } | null;
      },
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/products/${encodeURIComponent(productId)}/unit-config`,
        ),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    bulkAdjustPrices: (
      organizationId: string,
      unitId: string,
      body: {
        productIds: string[];
        categoryIds: string[];
        channel: "salon" | "delivery" | "both";
        mode: "percentage" | "fixed";
        value: number;
        reason: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/prices/bulk"),
        "POST",
        body,
        idempotencyKey,
      ),
    createPromotion: (
      organizationId: string,
      unitId: string,
      body: CatalogPromotionInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/promotions"),
        "POST",
        body,
        idempotencyKey,
      ),
    updatePromotion: (
      organizationId: string,
      unitId: string,
      promotionId: string,
      body: Partial<CatalogPromotionInput>,
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/promotions/${encodeURIComponent(promotionId)}`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archivePromotion: (organizationId: string, unitId: string, promotionId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `catalog/promotions/${encodeURIComponent(promotionId)}`),
        { method: "DELETE" },
      ),
    branding: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog/branding")),
    updateBranding: (organizationId: string, unitId: string, body: CatalogBrandingInput) =>
      request<unknown>(pilotPath(organizationId, unitId, "catalog/branding"), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    importCatalog: (
      organizationId: string,
      unitId: string,
      body: { rows: CatalogImportRow[]; dryRun: boolean },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "catalog/import"),
        "POST",
        body,
        idempotencyKey,
      ),
    catalogBcg: (organizationId: string, unitId: string, from?: string, to?: string) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request<{ from: string; to: string; products: CatalogBcgProduct[] }>(
        `${pilotPath(organizationId, unitId, "catalog/analytics/bcg")}${query}`,
      );
    },
    catalogPublication: (organizationId: string, unitId: string) =>
      request<CatalogPublication | null>(pilotPath(organizationId, unitId, "catalog/publication")),
    updateCatalogPublication: (
      organizationId: string,
      unitId: string,
      body: { slug: string; active: boolean },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<CatalogPublication>(
        pilotPath(organizationId, unitId, "catalog/publication"),
        "PUT",
        body,
        idempotencyKey,
      ),
    catalogTableQrs: (organizationId: string, unitId: string) =>
      request<CatalogTableQr[]>(pilotPath(organizationId, unitId, "catalog/tables/qr")),
    tableQrSettings: (organizationId: string, unitId: string) =>
      request<TableQrSettings>(pilotPath(organizationId, unitId, "catalog/tables/qr/settings")),
    updateTableQrSettings: (
      organizationId: string,
      unitId: string,
      body: UpdateTableQrSettingsInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<TableQrSettings>(
        pilotPath(organizationId, unitId, "catalog/tables/qr/settings"),
        "PUT",
        body,
        idempotencyKey,
      ),
    tableQrLifecycle: (organizationId: string, unitId: string) =>
      request<TableQrLifecycle>(pilotPath(organizationId, unitId, "catalog/tables/qr/lifecycle")),
    testTableQr: (organizationId: string, unitId: string, url: string) =>
      request<TableQrTestResult>(pilotPath(organizationId, unitId, "catalog/tables/qr/test"), {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    createTableQrPrintBatch: (
      organizationId: string,
      unitId: string,
      body: {
        format: TableQrPrintFormat;
        includeWifi: boolean;
        output: TableQrOutput;
        template?: TableQrVisualTemplate;
        tableIds: string[];
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<TableQrPrintBatch>(
        pilotPath(organizationId, unitId, "catalog/tables/qr/print-batches"),
        "POST",
        body,
        idempotencyKey,
      ),
    markTableQrPrintBatchPrinted: (
      organizationId: string,
      unitId: string,
      batchId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<TableQrPrintBatch>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/tables/qr/print-batches/${encodeURIComponent(batchId)}/printed`,
        ),
        "POST",
        {},
        idempotencyKey,
      ),
    rotateCatalogTableQr: (
      organizationId: string,
      unitId: string,
      tableId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<CatalogTableQr>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/tables/${encodeURIComponent(tableId)}/qr/rotate`,
        ),
        "POST",
        undefined,
        idempotencyKey,
      ),
    uploadCatalogMedia: (
      organizationId: string,
      unitId: string,
      body: {
        fileName: string;
        mimeType: "image/jpeg" | "image/png" | "image/webp";
        base64: string;
      },
    ) =>
      request<{ key: string; url: string }>(pilotPath(organizationId, unitId, "catalog/media"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    deleteCatalogMedia: (organizationId: string, unitId: string, key: string) =>
      request<void>(pilotPath(organizationId, unitId, `catalog/media/${encodeURIComponent(key)}`), {
        method: "DELETE",
      }),
    setProductDailyStock: (
      organizationId: string,
      unitId: string,
      productId: string,
      body: { remaining: number; autoDeductStock?: boolean },
    ) =>
      request<{
        productId: string;
        remaining: number;
        stockDate: string;
        autoDeductStock: boolean;
      }>(
        pilotPath(
          organizationId,
          unitId,
          `catalog/products/${encodeURIComponent(productId)}/daily-stock`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    createRoom: (
      organizationId: string,
      unitId: string,
      body: { name: string; sortOrder: number; expectedRevision: number },
    ) =>
      request<{ floorRevision: number }>(pilotPath(organizationId, unitId, "rooms"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateRoom: (
      organizationId: string,
      unitId: string,
      roomId: string,
      body: { name: string; sortOrder: number; expectedRevision: number },
    ) =>
      request<{ floorRevision: number }>(
        pilotPath(organizationId, unitId, `rooms/${encodeURIComponent(roomId)}`),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    archiveRoom: (
      organizationId: string,
      unitId: string,
      roomId: string,
      expectedRevision: number,
    ) =>
      request<{ floorRevision: number }>(
        `${pilotPath(organizationId, unitId, `rooms/${encodeURIComponent(roomId)}`)}?expectedRevision=${expectedRevision}`,
        { method: "DELETE" },
      ),
    createTable: (
      organizationId: string,
      unitId: string,
      roomId: string,
      body: {
        label: string;
        seats: number;
        width: number;
        height: number;
        rotation: number;
        shape: "round" | "square" | "rectangle";
        expectedRevision: number;
      },
    ) =>
      request<{ floorRevision: number }>(
        pilotPath(organizationId, unitId, `rooms/${encodeURIComponent(roomId)}/tables`),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    updateTable: (
      organizationId: string,
      unitId: string,
      tableId: string,
      body: {
        roomId: string;
        label: string;
        seats: number;
        width: number;
        height: number;
        rotation: number;
        shape: "round" | "square" | "rectangle";
        expectedRevision: number;
      },
    ) =>
      request<{ floorRevision: number }>(
        pilotPath(organizationId, unitId, `tables/${encodeURIComponent(tableId)}`),
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      ),
    archiveTable: (
      organizationId: string,
      unitId: string,
      tableId: string,
      expectedRevision: number,
    ) =>
      request<{ floorRevision: number }>(
        `${pilotPath(organizationId, unitId, `tables/${encodeURIComponent(tableId)}`)}?expectedRevision=${expectedRevision}`,
        { method: "DELETE" },
      ),
    updateTableTurnover: (
      organizationId: string,
      unitId: string,
      tableId: string,
      status: "cleaning" | "available",
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `tables/${encodeURIComponent(tableId)}/turnover`),
        { method: "PUT", body: JSON.stringify({ status }) },
      ),
    createTables: (
      organizationId: string,
      unitId: string,
      roomId: string,
      body: {
        expectedRevision: number;
        tables: Array<{
          label: string;
          seats: number;
          width: number;
          height: number;
          rotation: number;
          shape: "round" | "square" | "rectangle";
        }>;
      },
    ) =>
      request<{ tables: unknown[]; floorRevision: number }>(
        pilotPath(organizationId, unitId, `rooms/${encodeURIComponent(roomId)}/tables/batch`),
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),
    createServiceSection: (
      organizationId: string,
      unitId: string,
      body: {
        name: string;
        color: string;
        serviceMode: "full_service" | "quick_service" | "bar" | "hybrid";
        tableIds: string[];
        defaultResponsibleIdentityId?: string | null;
      },
    ) =>
      request<unknown>(pilotPath(organizationId, unitId, "service-sections"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateServiceSection: (
      organizationId: string,
      unitId: string,
      serviceSectionId: string,
      body: {
        name: string;
        color: string;
        serviceMode: "full_service" | "quick_service" | "bar" | "hybrid";
        tableIds: string[];
        defaultResponsibleIdentityId?: string | null;
      },
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `service-sections/${encodeURIComponent(serviceSectionId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    archiveServiceSection: (organizationId: string, unitId: string, serviceSectionId: string) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `service-sections/${encodeURIComponent(serviceSectionId)}`,
        ),
        { method: "DELETE" },
      ),
    openOperationalShift: (
      organizationId: string,
      unitId: string,
      body: {
        label?: string;
        serviceMode: "full_service" | "quick_service" | "bar" | "hybrid";
        copyPreviousAssignments: boolean;
      },
    ) =>
      request<unknown>(pilotPath(organizationId, unitId, "shifts/open"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateShiftSectionAssignment: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      shiftSectionId: string,
      body: {
        tableIds: string[];
        primaryIdentityId: string | null;
        supportIdentityIds: string[];
      },
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `shifts/${encodeURIComponent(shiftId)}/sections/${encodeURIComponent(shiftSectionId)}`,
        ),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    updateShiftSections: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      body: {
        expectedRevision: number;
        assignments: Array<{
          shiftSectionId: string;
          tableIds: string[];
          primaryIdentityId: string | null;
          supportIdentityIds: string[];
        }>;
      },
    ) =>
      request<{ revision: number }>(
        pilotPath(organizationId, unitId, `shifts/${encodeURIComponent(shiftId)}/sections`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    updateShiftSectionCoverage: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      shiftSectionId: string,
      active: boolean,
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `shifts/${encodeURIComponent(shiftId)}/sections/${encodeURIComponent(shiftSectionId)}/coverage`,
        ),
        { method: "PUT", body: JSON.stringify({ active }) },
      ),
    transferShiftTable: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      tableId: string,
      body: {
        targetShiftSectionId: string;
        durationMinutes: number;
        transferOpenTab: boolean;
        reasonCode: "service_rebalance" | "staff_coverage" | "operational_reorganization" | "other";
        reasonNote?: string;
      },
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `shifts/${encodeURIComponent(shiftId)}/tables/${encodeURIComponent(tableId)}/transfer`,
        ),
        { method: "POST", body: JSON.stringify(body) },
      ),
    endShiftTableTransfer: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      tableId: string,
    ) =>
      request<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `shifts/${encodeURIComponent(shiftId)}/tables/${encodeURIComponent(tableId)}/transfer`,
        ),
        { method: "DELETE" },
      ),
    closeOperationalShift: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      body: {
        acknowledgeOpenTabs: boolean;
        returnableDecision?: "acknowledge";
        handoverIdentityId?: string | null;
        handoverAssignments?: Array<{
          sourceResponsibleIdentityId: string | null;
          targetResponsibleIdentityId: string;
        }>;
        reason?: string;
      },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `shifts/${encodeURIComponent(shiftId)}/close`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    updateShiftLayout: (
      organizationId: string,
      unitId: string,
      shiftId: string,
      body: {
        expectedRevision: number;
        tables: Array<{
          tableId: string;
          roomId: string;
          x: number;
          y: number;
          rotation: number;
        }>;
      },
    ) =>
      request<{ revision: number }>(
        pilotPath(organizationId, unitId, `shifts/${encodeURIComponent(shiftId)}/layout`),
        { method: "PUT", body: JSON.stringify(body) },
      ),
    openTab: (
      organizationId: string,
      unitId: string,
      body: {
        tableId?: string;
        label?: string;
        guestCount: number;
        fulfillmentType?: "dine_in" | "pickup" | "delivery";
        customerId?: string;
        customerName?: string;
        customerPhone?: string;
        readyNotificationConsent?: boolean;
        serviceNotes?: string;
        deliveryAddress?: string;
        promisedAt?: string;
        responsibleIdentityId?: string;
        reservationId?: string;
        waitlistEntryId?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "tabs/open"),
        "POST",
        body,
        idempotencyKey,
      ),
    updateTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        expectedVersion: number;
        label?: string | null;
        fulfillmentType?: "dine_in" | "pickup" | "delivery";
        customerName?: string | null;
        customerPhone?: string | null;
        readyNotificationConsent?: boolean;
        serviceNotes?: string | null;
        deliveryAddress?: string | null;
        promisedAt?: string | null;
        guestCount?: number;
        responsibleIdentityId?: string | null;
      },
    ) =>
      request<unknown>(pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}`), {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    claimTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: { expectedVersion: number; responsibleIdentityId: string; reason: string },
    ) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/claim`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    touchPresence: (organizationId: string, unitId: string, tabId: string) =>
      request<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/presence`),
        { method: "PUT" },
      ),
    createOrder: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        items: Array<{
          productId: string;
          quantity: number;
          modifierOptionIds: string[];
          notes?: string;
          seatNumber?: number;
          course?: "anytime" | "starter" | "main" | "dessert";
          allergyNote?: string;
          doseClub?: { externalClubId: string };
        }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/orders`),
        "POST",
        body,
        idempotencyKey,
      ),
    moveItems: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: { targetTabId: string; items: Array<{ orderItemId: string; quantity: number }> },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/items/move`),
        "POST",
        body,
        idempotencyKey,
      ),
    recordPayment: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        method: "cash" | "credit_card" | "debit_card" | "pix" | "other";
        amountCents: number;
        reference?: string;
        cashRegisterId?: string;
        installationId?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/payments`),
        "POST",
        body,
        idempotencyKey,
      ),
    closeTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        printRequested: boolean;
        printOptions?: PrintTarget & { copies?: number };
        returnableDecision?: "acknowledge";
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ tab: unknown; paidCents: number; printJob: PosPrintJob | null }>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/close`),
        "POST",
        body,
        idempotencyKey,
      ),
    createPrintJob: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: PrintTarget & {
        documentType: PrintDocumentType;
        copies?: number;
        reason?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: PosPrintJob; idempotentReplay?: boolean }>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/print-jobs`),
        "POST",
        body,
        idempotencyKey,
      ),
    createPrintSplit: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: PrintTarget & {
        method: "equal_people" | "fixed_amount";
        partCount: number;
        fixedAmountCents?: number;
        documentType?: "partial_statement" | "payment_statement";
        copies?: number;
        serviceCallId?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{
        split: { id: string; partCount: number; balanceSnapshotCents: number };
        parts: Array<{ id: string; partNumber: number; amountCents: number }>;
        printJobs: PosPrintJob[];
      }>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/print-splits`),
        "POST",
        body,
        idempotencyKey,
      ),
    printJobs: (
      organizationId: string,
      unitId: string,
      query: PrintTarget & {
        tabId?: string;
        status?: PrintJobStatus;
        limit?: number;
      } = {},
    ) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const suffix = params.size ? `?${params.toString()}` : "";
      return request<PosPrintJob[]>(pilotPath(organizationId, unitId, `print-jobs${suffix}`));
    },
    updatePrintJobStatus: (
      organizationId: string,
      unitId: string,
      printJobId: string,
      body: PrintTarget & { status: Exclude<PrintJobStatus, "queued">; error?: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: PosPrintJob }>(
        pilotPath(organizationId, unitId, `print-jobs/${encodeURIComponent(printJobId)}/status`),
        "PUT",
        body,
        idempotencyKey,
      ),
    retryPrintJob: (
      organizationId: string,
      unitId: string,
      printJobId: string,
      body: PrintTarget = {},
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: PosPrintJob }>(
        pilotPath(organizationId, unitId, `print-jobs/${encodeURIComponent(printJobId)}/retry`),
        "POST",
        body,
        idempotencyKey,
      ),
    reprintJob: (
      organizationId: string,
      unitId: string,
      printJobId: string,
      body: PrintTarget & { reason: string; copies?: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{ printJob: PosPrintJob }>(
        pilotPath(organizationId, unitId, `print-jobs/${encodeURIComponent(printJobId)}/reprint`),
        "POST",
        body,
        idempotencyKey,
      ),
    reopenTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: { pin: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/reopen`),
        "POST",
        body,
        idempotencyKey,
      ),
    requestApproval: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        itemId: string;
        action: "discount" | "cancel";
        discountCents?: number;
        reason: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/approval-requests`),
        "POST",
        body,
        idempotencyKey,
      ),
    approvalRequests: (organizationId: string, unitId: string) =>
      request<unknown>(pilotPath(organizationId, unitId, "approval-requests?status=pending")),
    decideApproval: (
      organizationId: string,
      unitId: string,
      requestId: string,
      decision: "approve" | "reject",
      body: { pin: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `approval-requests/${encodeURIComponent(requestId)}/${decision}`,
        ),
        "POST",
        body,
        idempotencyKey,
      ),
    notifyReady: (organizationId: string, unitId: string, tabId: string, idempotencyKey?: string) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/notify-ready`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    createServiceCall: (
      organizationId: string,
      unitId: string,
      tableId: string,
      body: {
        kind: "assistance" | "bill" | "water" | "other";
        tabId?: string;
        slaMinutes?: number;
        installationId?: string;
        terminalId?: string;
        printerId?: string;
        copies?: number;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{
        call: unknown;
        duplicate: boolean;
        printJob: PosPrintJob | null;
        deliveryRoute: "local" | "cashier";
      }>(
        pilotPath(organizationId, unitId, `tables/${encodeURIComponent(tableId)}/calls`),
        "POST",
        body,
        idempotencyKey,
      ),
    acknowledgeServiceCall: (
      organizationId: string,
      unitId: string,
      callId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `calls/${encodeURIComponent(callId)}/acknowledge`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    resolveServiceCall: (
      organizationId: string,
      unitId: string,
      callId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `calls/${encodeURIComponent(callId)}/resolve`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    sendOrder: (organizationId: string, unitId: string, orderId: string, idempotencyKey?: string) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `orders/${encodeURIComponent(orderId)}/send`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    rejectTableQrOrder: (
      organizationId: string,
      unitId: string,
      orderId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `orders/${encodeURIComponent(orderId)}/reject`),
        "POST",
        { reason },
        idempotencyKey,
      ),
    transferTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: { tableId: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/transfer`),
        "POST",
        body,
        idempotencyKey,
      ),
    mergeTabs: (
      organizationId: string,
      unitId: string,
      body: {
        targetTabId: string;
        sourceTabIds: string[];
        reasonCode:
          | "large_party"
          | "sit_together"
          | "accessibility"
          | "operational_reorganization"
          | "other";
        reasonNote?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "tabs/merge"),
        "POST",
        body,
        idempotencyKey,
      ),
    groupTables: (
      organizationId: string,
      unitId: string,
      body: {
        tableIds: string[];
        anchorTableId: string;
        mode: "physical_only" | "single_tab";
        targetTabId?: string;
        responsibleIdentityId?: string;
        reasonCode:
          | "large_party"
          | "sit_together"
          | "accessibility"
          | "operational_reorganization"
          | "other";
        reasonNote?: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "table-groups"),
        "POST",
        body,
        idempotencyKey,
      ),
    detachTableGroup: (
      organizationId: string,
      unitId: string,
      groupId: string,
      tableId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `table-groups/${encodeURIComponent(groupId)}/detach`),
        "POST",
        { tableId },
        idempotencyKey,
      ),
    dissolveTableGroup: (
      organizationId: string,
      unitId: string,
      groupId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `table-groups/${encodeURIComponent(groupId)}/dissolve`),
        "POST",
        undefined,
        idempotencyKey,
      ),
    splitTab: (
      organizationId: string,
      unitId: string,
      tabId: string,
      body: {
        tableId?: string;
        label?: string;
        items: Array<{ orderItemId: string; quantity: number }>;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<{
        sourceTabId: string;
        targetTabId: string;
        movedItemIds: string[];
        printableTabIds: string[];
        printJobs: PosPrintJob[];
      }>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/split`),
        "POST",
        body,
        idempotencyKey,
      ),
    serviceCharge: (
      organizationId: string,
      unitId: string,
      tabId: string,
      basisPoints: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/service-charge`),
        "PUT",
        { basisPoints },
        idempotencyKey,
      ),
    tip: (
      organizationId: string,
      unitId: string,
      tabId: string,
      tipCents: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `tabs/${encodeURIComponent(tabId)}/tip`),
        "PUT",
        { tipCents },
        idempotencyKey,
      ),
    discountItem: (
      organizationId: string,
      unitId: string,
      itemId: string,
      body: {
        discountCents: number;
        approval: { approverMembershipId: string; pin: string; reason: string };
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `items/${encodeURIComponent(itemId)}/discount`),
        "POST",
        body,
        idempotencyKey,
      ),
    cancelItem: (
      organizationId: string,
      unitId: string,
      itemId: string,
      approval: { approverMembershipId: string; pin: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `items/${encodeURIComponent(itemId)}/cancel`),
        "POST",
        { approval },
        idempotencyKey,
      ),
    transitionKds: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      state: "preparing" | "ready",
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/state`),
        "POST",
        { state },
        idempotencyKey,
      ),
    claimKdsTicket: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      installationId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/claim`),
        "POST",
        { installationId, leaseSeconds: 120 },
        idempotencyKey,
      ),
    releaseKdsTicketClaim: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      installationId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/claim/release`),
        "POST",
        { installationId, leaseSeconds: 120 },
        idempotencyKey,
      ),
    acknowledgeKdsChange: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      changeId: string,
      revision: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/changes/${encodeURIComponent(changeId)}/acknowledge`,
        ),
        "POST",
        { revision },
        idempotencyKey,
      ),
    transitionKdsItem: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      state: "preparing" | "ready",
      quantity?: number,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/state`,
        ),
        "POST",
        { state, ...(quantity === undefined ? {} : { quantity }) },
        idempotencyKey,
      ),
    refireKdsItem: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/refire`,
        ),
        "POST",
        { reason },
        idempotencyKey,
      ),
    recallKds: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/recall`),
        "POST",
        { reason },
        idempotencyKey,
      ),
    setKdsPriority: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      priority: number,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/priority`),
        "PUT",
        { priority, reason },
        idempotencyKey,
      ),
    setKdsOrderPriority: (
      organizationId: string,
      unitId: string,
      orderId: string,
      priority: number,
      reason: string,
      idempotencyKey?: string,
      installationId?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/orders/${encodeURIComponent(orderId)}/priority`),
        "PUT",
        { priority, reason, ...(installationId ? { installationId } : {}) },
        idempotencyKey,
      ),
    setKdsCourseState: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      course: "anytime" | "starter" | "main" | "dessert",
      state: "held" | "fired",
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/course`),
        "POST",
        { course, state },
        idempotencyKey,
      ),
    handoffKds: (
      organizationId: string,
      unitId: string,
      orderId: string,
      target: "expedition" | "runner" | "served",
      reason?: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/orders/${encodeURIComponent(orderId)}/handoff`),
        "POST",
        { target, ...(reason ? { reason } : {}) },
        idempotencyKey,
      ),
    claimKdsRunner: (
      organizationId: string,
      unitId: string,
      orderId: string,
      reason?: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/orders/${encodeURIComponent(orderId)}/runner/claim`),
        "POST",
        { ...(reason ? { reason } : {}) },
        idempotencyKey,
      ),
    setKdsProductAvailability: (
      organizationId: string,
      unitId: string,
      productId: string,
      available: boolean,
      reason: string,
      idempotencyKey?: string,
      options: { resetAt?: string | null; dailyStock?: number | null } = {},
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/products/${encodeURIComponent(productId)}/availability`,
        ),
        "PUT",
        { available, reason, ...options },
        idempotencyKey,
      ),
    updateKdsTerminalProfile: (
      organizationId: string,
      unitId: string,
      installationId: string,
      body: {
        mode: "station" | "pass";
        stationId: string | null;
        label: string;
        soundEnabled: boolean;
        fullscreenPreferred: boolean;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/terminals/${encodeURIComponent(installationId)}`),
        "PUT",
        body,
        idempotencyKey,
      ),
    updateTerminalProfile: (
      organizationId: string,
      unitId: string,
      installationId: string,
      body: TerminalProfileInput,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<TerminalProfile>(
        pilotPath(
          organizationId,
          unitId,
          `terminal-profiles/${encodeURIComponent(installationId)}`,
        ),
        "PUT",
        body,
        idempotencyKey,
      ),
    cancelKdsTicket: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      approval: { approverMembershipId: string; pin: string; reason: string },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/${encodeURIComponent(ticketId)}/cancel`),
        "POST",
        { approval },
        idempotencyKey,
      ),
    blockKdsItem: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      body: {
        code: "missing_ingredient" | "equipment_issue" | "quality_check" | "dependency" | "other";
        reason: string;
      },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/block`,
        ),
        "POST",
        body,
        idempotencyKey,
      ),
    unblockKdsItem: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/unblock`,
        ),
        "POST",
        { reason },
        idempotencyKey,
      ),
    acknowledgeKdsAttention: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      noteId: "allergy" | "notes",
      revision: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/attention/acknowledge`,
        ),
        "POST",
        { noteId, revision },
        idempotencyKey,
      ),
    rerouteKdsItem: (
      organizationId: string,
      unitId: string,
      ticketId: string,
      itemId: string,
      stationId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(
          organizationId,
          unitId,
          `kds/${encodeURIComponent(ticketId)}/items/${encodeURIComponent(itemId)}/reroute`,
        ),
        "POST",
        { stationId, reason },
        idempotencyKey,
      ),
    createKdsBatch: (
      organizationId: string,
      unitId: string,
      body: { stationId: string; productId?: string; maxAssignments: number },
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, "kds/batches"),
        "POST",
        body,
        idempotencyKey,
      ),
    completeKdsBatch: (
      organizationId: string,
      unitId: string,
      batchId: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/batches/${encodeURIComponent(batchId)}/complete`),
        "POST",
        {},
        idempotencyKey,
      ),
    cancelKdsBatch: (
      organizationId: string,
      unitId: string,
      batchId: string,
      reason: string,
      idempotencyKey?: string,
    ) =>
      idempotentRequest<unknown>(
        pilotPath(organizationId, unitId, `kds/batches/${encodeURIComponent(batchId)}/cancel`),
        "POST",
        { reason },
        idempotencyKey,
      ),
    kdsAnalytics: (
      organizationId: string,
      unitId: string,
      filters: { stationId?: string; windowHours: number },
    ) => {
      const query = new URLSearchParams({ windowHours: String(filters.windowHours) });
      if (filters.stationId) query.set("stationId", filters.stationId);
      return request<unknown>(
        `${pilotPath(organizationId, unitId, "kds/analytics")}?${query.toString()}`,
      );
    },
  },
  growth: {
    customers: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "customers")),
    customerPage: (
      organizationId: string,
      filters?: { q?: string; unitId?: string; limit?: number; offset?: number },
    ) => {
      const query = new URLSearchParams();
      if (filters?.q) query.set("q", filters.q);
      if (filters?.unitId) query.set("unitId", filters.unitId);
      if (filters?.limit !== undefined) query.set("limit", String(filters.limit));
      if (filters?.offset !== undefined) query.set("offset", String(filters.offset));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<unknown>(growthPath(organizationId, `customers/page${suffix}`));
    },
    customerDetail: (organizationId: string, customerId: string) =>
      request<unknown>(growthPath(organizationId, `customers/${encodeURIComponent(customerId)}`)),
    createCustomer: (
      organizationId: string,
      body: {
        defaultUnitId?: string;
        name: string;
        email?: string;
        phone?: string;
        birthDate?: string;
        notes?: string | null;
        tags?: string[];
      },
    ) =>
      request<unknown>(growthPath(organizationId, "customers"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateCustomer: (
      organizationId: string,
      customerId: string,
      body: {
        defaultUnitId?: string | null;
        name?: string;
        email?: string | null;
        phone?: string | null;
        birthDate?: string | null;
        notes?: string | null;
        tags?: string[];
      },
    ) =>
      request<unknown>(growthPath(organizationId, `customers/${encodeURIComponent(customerId)}`), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    archiveCustomer: (organizationId: string, customerId: string, body: { reason: string }) =>
      request<unknown>(
        growthPath(organizationId, `customers/${encodeURIComponent(customerId)}/archive`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    mergeCustomer: (
      organizationId: string,
      customerId: string,
      body: { sourceCustomerId: string; reason: string },
    ) =>
      request<unknown>(
        growthPath(organizationId, `customers/${encodeURIComponent(customerId)}/merge`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    recordConsent: (
      organizationId: string,
      customerId: string,
      body: {
        decision: "granted" | "withdrawn";
        purpose: "marketing";
        channel: "email" | "whatsapp" | "all";
        source: string;
        legalBasis: "consent" | "legitimate_interest";
        policyVersion: string;
      },
    ) =>
      request<unknown>(
        growthPath(organizationId, `customers/${encodeURIComponent(customerId)}/consents`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    loyaltyBalance: (organizationId: string, customerId: string) =>
      request<unknown>(
        growthPath(organizationId, `loyalty/customers/${encodeURIComponent(customerId)}/balance`),
      ),
    loyaltyProgram: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "loyalty/programs/current")),
    createLoyaltyProgram: (
      organizationId: string,
      body: {
        mode: "points" | "cashback";
        rate: number;
        minimumOrderCents: number;
        expiresAfterDays?: number;
        active: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "loyalty/programs"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    coupons: (organizationId: string) => request<unknown>(growthPath(organizationId, "coupons")),
    createCoupon: (
      organizationId: string,
      body: {
        unitId?: string;
        code: string;
        type: "fixed" | "percentage";
        value: number;
        minimumOrderCents: number;
        channels: string[];
        unitIds: string[];
        perCustomerLimit: number;
        active: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "coupons"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateCoupon: (
      organizationId: string,
      couponId: string,
      body: {
        code?: string;
        type?: "fixed" | "percentage";
        value?: number;
        minimumOrderCents?: number;
        maximumDiscountCents?: number | null;
        validFrom?: string;
        validUntil?: string | null;
        channels?: string[];
        unitIds?: string[];
        perCustomerLimit?: number;
        active?: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, `coupons/${encodeURIComponent(couponId)}`), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    segments: (organizationId: string) => request<unknown>(growthPath(organizationId, "segments")),
    createSegment: (
      organizationId: string,
      body: {
        name: string;
        filters:
          | { kind: "all" }
          | { kind: "marketing_opt_in" }
          | { kind: "birthday_month"; month: number }
          | { kind: "inactive_days"; days: number }
          | { kind: "minimum_visits"; visits: number }
          | { kind: "minimum_spend_cents"; amountCents: number }
          | { kind: "no_show_count"; count: number };
        active: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "segments"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    campaigns: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "campaigns")),
    createCampaign: (
      organizationId: string,
      body: {
        unitId?: string;
        segmentId?: string;
        name: string;
        channel: "email" | "whatsapp";
        subject?: string;
        content: string;
        variantBContent?: string;
        attributionWindowDays?: number;
        holdoutPercentage?: number;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "campaigns"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    campaignPreview: (organizationId: string, campaignId: string) =>
      request<unknown>(
        growthPath(organizationId, `campaigns/${encodeURIComponent(campaignId)}/preview`),
      ),
    campaignDeliveries: (organizationId: string, campaignId: string) =>
      request<unknown>(
        growthPath(organizationId, `campaigns/${encodeURIComponent(campaignId)}/deliveries`),
      ),
    queueCampaign: (organizationId: string, campaignId: string) =>
      request<unknown>(
        growthPath(organizationId, `campaigns/${encodeURIComponent(campaignId)}/queue`),
        { method: "POST" },
      ),
    cancelCampaign: (organizationId: string, campaignId: string, body: { reason: string }) =>
      request<unknown>(
        growthPath(organizationId, `campaigns/${encodeURIComponent(campaignId)}/cancel`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    evolutionIntegration: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `integrations/evolution-go?unitId=${encodeURIComponent(unitId)}`,
        ),
      ),
    configureEvolution: (
      organizationId: string,
      body: {
        unitId: string;
        enabled: boolean;
        quietHoursStart: string;
        quietHoursEnd: string;
        maxMessagesPer30Days: number;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "integrations/evolution-go"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    evolutionStatus: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `integrations/evolution-go/status?unitId=${encodeURIComponent(unitId)}`,
        ),
      ),
    evolutionQr: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `integrations/evolution-go/qr?unitId=${encodeURIComponent(unitId)}`,
        ),
      ),
    evolutionAction: (organizationId: string, unitId: string, action: "reconnect" | "logout") =>
      request<unknown>(growthPath(organizationId, `integrations/evolution-go/${action}`), {
        method: "POST",
        body: JSON.stringify({ unitId }),
      }),
    whatsappInbox: (
      organizationId: string,
      unitId: string,
      filters: {
        cursorAt?: string;
        cursorId?: string;
        status?: "open" | "pending" | "closed";
        priority?: "low" | "normal" | "high" | "urgent";
        assignedTo?: "me" | "unassigned" | "any";
        search?: string;
      } = {},
    ) => {
      const query = new URLSearchParams({ unitId });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      return request<unknown>(
        growthPath(organizationId, `whatsapp/conversations?${query.toString()}`),
      );
    },
    whatsappMessages: (
      organizationId: string,
      conversationId: string,
      cursor?: { at: string; id: string },
    ) => {
      const query = new URLSearchParams();
      if (cursor) {
        query.set("beforeAt", cursor.at);
        query.set("beforeId", cursor.id);
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return request<unknown>(
        growthPath(
          organizationId,
          `whatsapp/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
        ),
      );
    },
    updateWhatsappConversation: (
      organizationId: string,
      conversationId: string,
      body: {
        status?: "open" | "pending" | "closed";
        priority?: "low" | "normal" | "high" | "urgent";
        assignedIdentityId?: string | null;
        slaMinutes?: number | null;
        expectedUpdatedAt: string;
      },
    ) =>
      request<unknown>(
        growthPath(organizationId, `whatsapp/conversations/${encodeURIComponent(conversationId)}`),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    whatsappAssignees: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `whatsapp/assignees?unitId=${encodeURIComponent(unitId)}`),
      ),
    whatsappMessageMedia: (organizationId: string, conversationId: string, messageId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `whatsapp/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/media`,
        ),
      ),
    markWhatsappRead: (organizationId: string, conversationId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `whatsapp/conversations/${encodeURIComponent(conversationId)}/read`,
        ),
        { method: "POST" },
      ),
    sendWhatsappMessage: (
      organizationId: string,
      body: {
        unitId: string;
        conversationId?: string;
        customerId?: string;
        phone?: string;
        body?: string;
        media?: { fileName: string; mimeType: string; base64: string };
        idempotencyKey: string;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "whatsapp/messages"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    crmAutomations: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `crm/automations?unitId=${encodeURIComponent(unitId)}`),
      ),
    upsertCrmAutomation: (
      organizationId: string,
      body: {
        unitId: string;
        trigger: "birthday" | "inactive" | "post_visit" | "no_show" | "survey";
        enabled: boolean;
        delayMinutes: number;
        inactiveDays?: number | null;
        messageTemplate: string;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "crm/automations"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    crmAutomationExecutions: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `crm/automation-executions?unitId=${encodeURIComponent(unitId)}`,
        ),
      ),
    retryCrmAutomationExecution: (organizationId: string, executionId: string) =>
      request<unknown>(
        growthPath(
          organizationId,
          `crm/automation-executions/${encodeURIComponent(executionId)}/retry`,
        ),
        { method: "POST" },
      ),
    testCrmAutomation: (
      organizationId: string,
      ruleId: string,
      body: { unitId: string; phone: string },
    ) =>
      request<unknown>(
        growthPath(organizationId, `crm/automations/${encodeURIComponent(ruleId)}/test`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    crmQuickReplies: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `crm/quick-replies?unitId=${encodeURIComponent(unitId)}`),
      ),
    upsertCrmQuickReply: (
      organizationId: string,
      body: { id?: string; unitId: string; title: string; body: string; active: boolean },
    ) =>
      request<unknown>(growthPath(organizationId, "crm/quick-replies"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    deleteCrmQuickReply: (organizationId: string, replyId: string) =>
      request<unknown>(
        growthPath(organizationId, `crm/quick-replies/${encodeURIComponent(replyId)}`),
        { method: "DELETE" },
      ),
    reservations: (
      organizationId: string,
      unitId: string,
      filters?: {
        scope?: "active" | "history" | "all";
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
      },
    ) => {
      const query = new URLSearchParams();
      if (filters?.scope) query.set("scope", filters.scope);
      if (filters?.from) query.set("from", filters.from);
      if (filters?.to) query.set("to", filters.to);
      if (filters?.limit !== undefined) query.set("limit", String(filters.limit));
      if (filters?.offset !== undefined) query.set("offset", String(filters.offset));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/reservations${suffix}`),
      );
    },
    waitlist: (
      organizationId: string,
      unitId: string,
      filters?: { scope?: "active" | "history" | "all"; limit?: number; offset?: number },
    ) => {
      const query = new URLSearchParams();
      if (filters?.scope) query.set("scope", filters.scope);
      if (filters?.limit !== undefined) query.set("limit", String(filters.limit));
      if (filters?.offset !== undefined) query.set("offset", String(filters.offset));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/waitlist${suffix}`),
      );
    },
    deliveryZones: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/delivery-zones`),
      ),
    deliveryCouriers: (organizationId: string, unitId: string) =>
      request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/delivery-couriers`),
      ),
    createDeliveryCourier: (
      organizationId: string,
      body: {
        unitId: string;
        name: string;
        reference: string;
        phone?: string;
        idempotencyKey: string;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "delivery-couriers"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    deliveryOrders: (
      organizationId: string,
      unitId: string,
      filters?: {
        status?: string;
        query?: string;
        scheduled?: boolean;
        sla?: "overdue";
        updatedSince?: string;
        limit?: number;
      },
    ) => {
      const query = new URLSearchParams();
      if (filters?.status) query.set("status", filters.status);
      if (filters?.query) query.set("query", filters.query);
      if (filters?.scheduled !== undefined) query.set("scheduled", String(filters.scheduled));
      if (filters?.sla) query.set("sla", filters.sla);
      if (filters?.updatedSince) query.set("updatedSince", filters.updatedSince);
      if (filters?.limit !== undefined) query.set("limit", String(filters.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : "";
      return request<unknown>(
        growthPath(organizationId, `units/${encodeURIComponent(unitId)}/delivery-orders${suffix}`),
      );
    },
    createReservation: (
      organizationId: string,
      body: {
        unitId: string;
        customerId?: string;
        guestName: string;
        guestPhone?: string;
        partySize: number;
        scheduledAt: string;
        durationMinutes: number;
        notes?: string;
        idempotencyKey: string;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "reservations"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createWaitlistEntry: (
      organizationId: string,
      body: {
        unitId: string;
        customerId?: string;
        guestName: string;
        guestPhone?: string;
        partySize: number;
        quotedWaitMinutes?: number;
        idempotencyKey: string;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "waitlist"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    createDeliveryZone: (
      organizationId: string,
      body: {
        unitId: string;
        name: string;
        feeCents: number;
        minimumOrderCents: number;
        estimatedDeliveryMinutes: number;
        geometry: Record<string, unknown>;
        active: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, "delivery-zones"), {
        method: "POST",
        body: JSON.stringify(body),
      }),
    updateDeliveryZone: (
      organizationId: string,
      zoneId: string,
      body: {
        name?: string;
        feeCents?: number;
        minimumOrderCents?: number;
        estimatedDeliveryMinutes?: number;
        geometry?: Record<string, unknown>;
        active?: boolean;
      },
    ) =>
      request<unknown>(growthPath(organizationId, `delivery-zones/${encodeURIComponent(zoneId)}`), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    transitionDelivery: (
      organizationId: string,
      orderId: string,
      status:
        | "placed"
        | "confirmed"
        | "preparing"
        | "ready"
        | "dispatched"
        | "completed"
        | "canceled",
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-orders/${encodeURIComponent(orderId)}/status`),
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
    dispatchDelivery: (
      organizationId: string,
      orderId: string,
      body: { courierReference: string; idempotencyKey: string },
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-orders/${encodeURIComponent(orderId)}/dispatch`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    assignDeliveryCourier: (
      organizationId: string,
      orderId: string,
      body: { courierId: string; idempotencyKey: string },
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-orders/${encodeURIComponent(orderId)}/assign`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    updateDeliveryCourierStatus: (
      organizationId: string,
      courierId: string,
      body: { status: "available" | "offline"; idempotencyKey: string },
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-couriers/${encodeURIComponent(courierId)}/status`),
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    validateDeliveryZoneAddress: (
      organizationId: string,
      zoneId: string,
      address: Record<string, unknown>,
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-zones/${encodeURIComponent(zoneId)}/validate-address`),
        { method: "POST", body: JSON.stringify(address) },
      ),
    requestDeliveryNotification: (
      organizationId: string,
      orderId: string,
      body: {
        audience: "operations" | "customer";
        type: "status_update" | "courier_assigned" | "courier_arriving";
        idempotencyKey: string;
      },
    ) =>
      request<unknown>(
        growthPath(organizationId, `delivery-orders/${encodeURIComponent(orderId)}/notifications`),
        { method: "POST", body: JSON.stringify(body) },
      ),
    multiunitSummary: (organizationId: string) =>
      request<unknown>(growthPath(organizationId, "multiunit/summary")),
    transitionReservation: (
      organizationId: string,
      reservationId: string,
      status: "confirmed" | "seated" | "completed" | "canceled" | "no_show",
    ) =>
      request<unknown>(
        growthPath(organizationId, `reservations/${encodeURIComponent(reservationId)}/status`),
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
    transitionWaitlist: (
      organizationId: string,
      entryId: string,
      status: "notified" | "seated" | "left" | "canceled" | "no_show",
    ) =>
      request<unknown>(
        growthPath(organizationId, `waitlist/${encodeURIComponent(entryId)}/status`),
        { method: "PATCH", body: JSON.stringify({ status }) },
      ),
  },
  command: (organizationId: string, unitId: string, command: OperationalCommandInput) =>
    request<CommandResponse>(
      `/v1/organizations/${encodeURIComponent(organizationId)}/units/${encodeURIComponent(unitId)}/commands`,
      { method: "POST", body: JSON.stringify(command) },
    ),
};
