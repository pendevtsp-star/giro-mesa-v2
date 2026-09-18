import {
  bool,
  InvalidGrowthPayloadError,
  number,
  optionalText,
  type Row,
  record,
  records,
  text,
} from "../../growth.shared";

export interface CrmCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  marketingOptIn: boolean;
  emailMarketingOptIn: boolean;
  whatsappMarketingOptIn: boolean;
  notes: string | null;
  tags: string[];
  createdAt: string | null;
  metrics: {
    visits: number | null;
    totalSpentCents: number | null;
    averageTicketCents: number | null;
    noShows: number | null;
    lastVisitAt: string | null;
  };
}

export interface CrmCustomerPage {
  items: CrmCustomer[];
  total: number;
  limit: number;
  offset: number;
}

export interface CrmTimelineEntry {
  kind: string;
  id: string;
  at: string;
  status: string;
  label: string;
  amountCents: number | null;
  amount: number | null;
}

export interface CrmCustomerHistoryCursor {
  at: string;
  kind: string;
  id: string;
}

export interface CrmCustomerHistoryPage {
  items: CrmTimelineEntry[];
  nextCursor: CrmCustomerHistoryCursor | null;
}

export interface CrmCustomerDetail {
  customer: CrmCustomer;
  consent: {
    email: boolean;
    whatsapp: boolean;
  };
  metrics: CrmCustomer["metrics"];
  loyalty: { balance: number };
  timeline: CrmTimelineEntry[];
}

export interface CrmCoupon {
  id: string;
  code: string;
  type: "fixed" | "percentage";
  value: number;
  active: boolean;
  validUntil: string | null;
  perCustomerLimit: number;
}

export interface CrmSegment {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}

export interface CrmCampaign {
  id: string;
  segmentId: string | null;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  content: string;
  variantBContent: string | null;
  attributionWindowDays: number;
  holdoutPercentage: number;
  queuedAt: string | null;
  sentAt: string | null;
}

export interface CrmCampaignPreview {
  campaignId: string;
  channel: string;
  activeCustomers: number;
  eligibleRecipients: number;
  excludedRecipients: number;
  recipientLimit: number;
  exceedsRecipientLimit: boolean;
  provider: { ready: boolean; unavailableCode: string | null };
}

export interface CrmCampaignDeliveries {
  campaign: CrmCampaign;
  limit: number;
  offset: number;
  total: number;
  nextOffset: number | null;
  counts: Record<string, number>;
  attribution: {
    delivered: number;
    read: number;
    replied: number;
    orders: number;
    coupons: number;
    revenueCents: number;
    costedOrders: number;
    incompleteCostOrders: number;
    costCents: number | null;
    grossMarginCents: number | null;
  };
  experiments: Array<{
    variant: string;
    recipients: number;
    delivered: number;
    read: number;
    replied: number;
    orders: number;
    revenueCents: number;
  }>;
  deliveries: Array<{
    id: string;
    customerId: string;
    customerName: string;
    status: string;
    experimentVariant: string;
    errorCode: string | null;
    sentAt: string | null;
    createdAt: string;
  }>;
}

export interface CrmLoyaltyProgram {
  id: string;
  mode: "points" | "cashback";
  rate: number;
  minimumOrderCents: number;
  expiresAfterDays: number | null;
  active: boolean;
}

export interface CrmEvolutionIntegration {
  status: string;
  configured: boolean;
  ready: boolean;
  connectedNumber: string | null;
  config: {
    quietHoursStart: string;
    quietHoursEnd: string;
    maxMessagesPer30Days: number;
    lastErrorCode: string | null;
  };
}

export interface CrmWhatsappConversation {
  id: string;
  customerId: string | null;
  customerName: string | null;
  phone: string;
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  assignedIdentityId: string | null;
  assignedIdentityName: string | null;
  slaDueAt: string | null;
  firstResponseAt: string | null;
  updatedAt: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
}

export interface CrmCursorPage<T> {
  items: T[];
  nextCursor: { at: string; id: string } | null;
}

export interface CrmWhatsappMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  contentKind: string;
  status: string;
  occurredAt: string;
  mediaMimeType: string | null;
  mediaFileName: string | null;
  mediaSizeBytes: number | null;
  mediaErrorCode: string | null;
}

export interface CrmAutomationRule {
  id: string;
  trigger: "birthday" | "inactive" | "post_visit" | "no_show" | "survey";
  enabled: boolean;
  delayMinutes: number;
  inactiveDays: number | null;
  messageTemplate: string;
}

export interface CrmAutomationExecution {
  id: string;
  trigger: CrmAutomationRule["trigger"];
  customerName: string;
  status: string;
  reason: string | null;
  retryCount: number;
  canRetry: boolean;
  scheduledFor: string;
  executedAt: string | null;
  createdAt: string;
}

export interface CrmQuickReply {
  id: string;
  title: string;
  body: string;
  active: boolean;
}

export interface CrmWhatsappAssignee {
  id: string;
  name: string;
}

function collectionRows(value: unknown): Row[] {
  if (Array.isArray(value)) return records(value);
  const payload = record(value);
  for (const candidate of [payload.items, payload.data, payload.results]) {
    if (Array.isArray(candidate)) return records(candidate);
  }
  if (payload.data !== null && typeof payload.data === "object") {
    const data = record(payload.data);
    if (Array.isArray(data.items)) return records(data.items);
  }
  throw new InvalidGrowthPayloadError();
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : number(value);
}

function customerMetrics(row: Row): CrmCustomer["metrics"] {
  const source =
    row.metrics !== null && typeof row.metrics === "object" ? record(row.metrics) : row;
  return {
    visits: nullableNumber(source.visits),
    totalSpentCents: nullableNumber(source.totalSpendCents ?? source.totalSpentCents),
    averageTicketCents: nullableNumber(source.averageTicketCents),
    noShows: nullableNumber(source.noShows),
    lastVisitAt: optionalText(source.lastVisitAt),
  };
}

function stringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new InvalidGrowthPayloadError();
  return value;
}

function customerRow(row: Row): CrmCustomer {
  return {
    id: text(row.id),
    name: text(row.name),
    email: optionalText(row.email),
    phone: optionalText(row.phone),
    birthDate: optionalText(row.birthDate),
    marketingOptIn: bool(row.marketingOptIn),
    emailMarketingOptIn:
      row.emailMarketingOptIn === undefined
        ? bool(row.marketingOptIn)
        : bool(row.emailMarketingOptIn),
    whatsappMarketingOptIn:
      row.whatsappMarketingOptIn === undefined
        ? bool(row.marketingOptIn)
        : bool(row.whatsappMarketingOptIn),
    notes: optionalText(row.notes),
    tags: stringArray(row.tags),
    createdAt: optionalText(row.createdAt),
    metrics: customerMetrics(row),
  };
}

export function parseCrmCustomers(value: unknown): CrmCustomer[] {
  return collectionRows(value).map(customerRow);
}

export function parseCrmCustomerPage(value: unknown): CrmCustomerPage {
  if (Array.isArray(value)) {
    const items = parseCrmCustomers(value);
    return { items, total: items.length, limit: items.length, offset: 0 };
  }
  const payload = record(value);
  const items = parseCrmCustomers(payload.items ?? payload.data ?? payload.results);
  return {
    items,
    total: payload.total === undefined ? items.length : number(payload.total),
    limit: payload.limit === undefined ? items.length : number(payload.limit),
    offset: payload.offset === undefined ? 0 : number(payload.offset),
  };
}

function timelineEntry(row: Row): CrmTimelineEntry {
  return {
    kind: text(row.kind),
    id: text(row.id),
    at: text(row.at),
    status: text(row.status),
    label: text(row.label),
    amountCents: nullableNumber(row.amountCents),
    amount: nullableNumber(row.amount),
  };
}

export function parseCrmCustomerHistory(value: unknown): CrmCustomerHistoryPage {
  const payload = record(value);
  const cursor = payload.nextCursor === null ? null : record(payload.nextCursor);
  return {
    items: records(payload.items).map(timelineEntry),
    nextCursor: cursor
      ? { at: text(cursor.at), kind: text(cursor.kind), id: text(cursor.id) }
      : null,
  };
}

export function parseCrmCustomerDetail(value: unknown): CrmCustomerDetail | null {
  if (value === null) return null;
  const payload = record(value);
  const consent = record(payload.consent);
  const loyalty = record(payload.loyalty);
  const metricValues = record(payload.metrics);
  return {
    customer: customerRow(record(payload.customer)),
    consent: { email: bool(consent.email), whatsapp: bool(consent.whatsapp) },
    metrics: customerMetrics(metricValues),
    loyalty: { balance: number(loyalty.balance) },
    timeline: records(payload.timeline).map(timelineEntry),
  };
}

export function parseCrmCoupons(value: unknown): CrmCoupon[] {
  return collectionRows(value).map((row) => {
    const type = text(row.type);
    if (type !== "fixed" && type !== "percentage") throw new InvalidGrowthPayloadError();
    return {
      id: text(row.id),
      code: text(row.code),
      type,
      value: number(row.value),
      active: bool(row.active),
      validUntil: optionalText(row.validUntil),
      perCustomerLimit: number(row.perCustomerLimit),
    };
  });
}

export function parseCrmSegments(value: unknown): CrmSegment[] {
  return collectionRows(value).map((row) => {
    const filters = record(row.filters);
    return {
      id: text(row.id),
      name: text(row.name),
      kind: text(filters.kind),
      active: bool(row.active),
    };
  });
}

export function parseCrmCampaign(value: unknown): CrmCampaign {
  const row = record(value);
  if (row.channel !== "email" && row.channel !== "whatsapp") throw new InvalidGrowthPayloadError();
  return {
    id: text(row.id),
    segmentId: optionalText(row.segmentId),
    name: text(row.name),
    channel: text(row.channel),
    status: text(row.status),
    subject: optionalText(row.subject),
    content: text(row.content),
    variantBContent: optionalText(row.variantBContent),
    attributionWindowDays: number(row.attributionWindowDays),
    holdoutPercentage: number(row.holdoutPercentage),
    queuedAt: optionalText(row.queuedAt),
    sentAt: optionalText(row.sentAt),
  };
}

export function parseCrmCampaigns(value: unknown): CrmCampaign[] {
  return collectionRows(value).map(parseCrmCampaign);
}

export function parseCrmLoyaltyProgram(value: unknown): CrmLoyaltyProgram | null {
  if (value === null) return null;
  const row = record(value);
  const mode = text(row.mode);
  const rate = number(row.rate);
  const minimumOrderCents = number(row.minimumOrderCents);
  const expiresAfterDays = row.expiresAfterDays === null ? null : number(row.expiresAfterDays);
  if (
    (mode !== "points" && mode !== "cashback") ||
    rate <= 0 ||
    rate > 10_000 ||
    !Number.isSafeInteger(minimumOrderCents) ||
    minimumOrderCents < 0 ||
    (expiresAfterDays !== null &&
      (!Number.isInteger(expiresAfterDays) || expiresAfterDays < 1 || expiresAfterDays > 3650))
  )
    throw new InvalidGrowthPayloadError();
  return {
    id: text(row.id),
    mode,
    rate,
    minimumOrderCents,
    expiresAfterDays,
    active: bool(row.active),
  };
}

export function parseCrmCampaignPreview(value: unknown): CrmCampaignPreview {
  const payload = record(value);
  const provider = record(payload.provider);
  return {
    campaignId: text(payload.campaignId),
    channel: text(payload.channel),
    activeCustomers: number(payload.activeCustomers),
    eligibleRecipients: number(payload.eligibleRecipients),
    excludedRecipients: number(payload.excludedRecipients),
    recipientLimit: number(payload.recipientLimit),
    exceedsRecipientLimit: bool(payload.exceedsRecipientLimit),
    provider: {
      ready: bool(provider.ready),
      unavailableCode: optionalText(provider.unavailableCode),
    },
  };
}

export function parseCrmCampaignDeliveries(value: unknown): CrmCampaignDeliveries {
  const payload = record(value);
  const counts = record(payload.counts);
  const attribution = record(payload.attribution);
  const orders = number(attribution.orders);
  const costedOrders =
    attribution.costedOrders === undefined ? 0 : number(attribution.costedOrders);
  const incompleteCostOrders =
    attribution.incompleteCostOrders === undefined
      ? orders
      : number(attribution.incompleteCostOrders);
  const limit = number(payload.limit);
  const offset = number(payload.offset);
  const total = number(payload.total);
  const nextOffset = payload.nextOffset === null ? null : number(payload.nextOffset);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    (nextOffset !== null &&
      (!Number.isSafeInteger(nextOffset) || nextOffset <= offset || nextOffset >= total))
  ) {
    throw new InvalidGrowthPayloadError();
  }
  return {
    campaign: parseCrmCampaign(payload.campaign),
    limit,
    offset,
    total,
    nextOffset,
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, number(value)])),
    attribution: {
      delivered: number(attribution.delivered),
      read: number(attribution.read),
      replied: number(attribution.replied),
      orders,
      coupons: number(attribution.coupons),
      revenueCents: number(attribution.revenueCents),
      costedOrders,
      incompleteCostOrders,
      costCents: nullableNumber(attribution.costCents),
      grossMarginCents: nullableNumber(attribution.grossMarginCents),
    },
    experiments: (payload.experiments === undefined ? [] : records(payload.experiments)).map(
      (row) => ({
        variant: text(row.variant),
        recipients: number(row.recipients),
        delivered: number(row.delivered),
        read: number(row.read),
        replied: number(row.replied),
        orders: number(row.orders),
        revenueCents: number(row.revenueCents),
      }),
    ),
    deliveries: records(payload.deliveries).map((row) => ({
      id: text(row.id),
      customerId: text(row.customerId),
      customerName: text(row.customerName),
      status: text(row.status),
      experimentVariant: row.experimentVariant === undefined ? "a" : text(row.experimentVariant),
      errorCode: optionalText(row.errorCode),
      sentAt: optionalText(row.sentAt),
      createdAt: text(row.createdAt),
    })),
  };
}

export function parseCrmCampaignReview(
  campaignId: string,
  previewValue: unknown,
  deliveriesValue: unknown,
) {
  const preview = parseCrmCampaignPreview(previewValue);
  const deliveries = parseCrmCampaignDeliveries(deliveriesValue);
  if (
    preview.campaignId !== campaignId ||
    deliveries.campaign.id !== campaignId ||
    preview.channel !== deliveries.campaign.channel
  ) {
    throw new InvalidGrowthPayloadError();
  }
  return { preview, deliveries };
}

export function parseCrmEvolutionIntegration(value: unknown): CrmEvolutionIntegration {
  const payload = record(value);
  const config = payload.config && typeof payload.config === "object" ? record(payload.config) : {};
  return {
    status: text(payload.status),
    configured: bool(payload.configured),
    ready: payload.ready === undefined ? payload.status === "ready" : bool(payload.ready),
    connectedNumber: optionalText(payload.connectedNumber ?? config.connectedNumber),
    config: {
      quietHoursStart: optionalText(config.quietHoursStart) ?? "21:00",
      quietHoursEnd: optionalText(config.quietHoursEnd) ?? "08:00",
      maxMessagesPer30Days:
        config.maxMessagesPer30Days === undefined ? 4 : number(config.maxMessagesPer30Days),
      lastErrorCode: optionalText(config.lastErrorCode),
    },
  };
}

export function parseCrmEvolutionQr(value: unknown): {
  ready: boolean;
  state: string;
  qrDataUrl: string | null;
} {
  const payload = record(value);
  return {
    ready: bool(payload.ready),
    state: text(payload.state),
    qrDataUrl: optionalText(payload.qrDataUrl),
  };
}

function parseCursor(value: unknown): { at: string; id: string } | null {
  if (value === null || value === undefined) return null;
  const cursor = record(value);
  return { at: text(cursor.at), id: text(cursor.id) };
}

export function parseCrmWhatsappConversation(value: unknown): CrmWhatsappConversation {
  const row = record(value);
  return {
    id: text(row.id),
    customerId: optionalText(row.customerId),
    customerName: optionalText(row.customerName),
    phone: text(row.phone),
    status: text(row.status),
    priority: text(row.priority) as CrmWhatsappConversation["priority"],
    assignedIdentityId: optionalText(row.assignedIdentityId),
    assignedIdentityName: optionalText(row.assignedIdentityName),
    slaDueAt: optionalText(row.slaDueAt),
    firstResponseAt: optionalText(row.firstResponseAt),
    updatedAt: text(row.updatedAt),
    unreadCount: number(row.unreadCount),
    lastMessageAt: optionalText(row.lastMessageAt),
    lastInboundAt: optionalText(row.lastInboundAt),
    lastOutboundAt: optionalText(row.lastOutboundAt),
  };
}

export function parseCrmWhatsappInbox(value: unknown): CrmCursorPage<CrmWhatsappConversation> {
  const payload = Array.isArray(value) ? { items: value, nextCursor: null } : record(value);
  return {
    items: collectionRows(payload.items).map(parseCrmWhatsappConversation),
    nextCursor: parseCursor(payload.nextCursor),
  };
}

export function parseCrmWhatsappMedia(value: unknown): {
  mimeType: string;
  fileName: string;
  base64: string;
} {
  const payload = record(value);
  return {
    mimeType: text(payload.mimeType),
    fileName: text(payload.fileName),
    base64: text(payload.base64),
  };
}

export function parseCrmWhatsappMessages(value: unknown): CrmCursorPage<CrmWhatsappMessage> {
  const payload = Array.isArray(value) ? { items: value, nextCursor: null } : record(value);
  return {
    items: collectionRows(payload.items).map((row) => {
      const direction = text(row.direction);
      if (direction !== "inbound" && direction !== "outbound")
        throw new InvalidGrowthPayloadError();
      return {
        id: text(row.id),
        direction,
        body: text(row.body),
        contentKind: text(row.contentKind),
        status: text(row.status),
        occurredAt: text(row.occurredAt),
        mediaMimeType: optionalText(row.mediaMimeType),
        mediaFileName: optionalText(row.mediaFileName),
        mediaSizeBytes: nullableNumber(row.mediaSizeBytes),
        mediaErrorCode: optionalText(row.mediaErrorCode),
      };
    }),
    nextCursor: parseCursor(payload.nextCursor),
  };
}

export function parseCrmAutomations(value: unknown): CrmAutomationRule[] {
  return collectionRows(value).map((row) => {
    const trigger = text(row.trigger);
    if (!["birthday", "inactive", "post_visit", "no_show", "survey"].includes(trigger))
      throw new InvalidGrowthPayloadError();
    return {
      id: text(row.id),
      trigger: trigger as CrmAutomationRule["trigger"],
      enabled: bool(row.enabled),
      delayMinutes: number(row.delayMinutes),
      inactiveDays: nullableNumber(row.inactiveDays),
      messageTemplate: text(row.messageTemplate),
    };
  });
}

export function parseCrmAutomationExecutions(value: unknown): {
  items: CrmAutomationExecution[];
  summary: Record<string, number>;
} {
  const payload = record(value);
  return {
    items: collectionRows(payload.items).map((row) => ({
      id: text(row.id),
      trigger: text(row.trigger) as CrmAutomationRule["trigger"],
      customerName: text(row.customerName),
      status: text(row.status),
      reason: optionalText(row.reason),
      retryCount: number(row.retryCount),
      canRetry: row.canRetry === undefined ? false : bool(row.canRetry),
      scheduledFor: text(row.scheduledFor),
      executedAt: optionalText(row.executedAt),
      createdAt: text(row.createdAt),
    })),
    summary: Object.fromEntries(
      Object.entries(record(payload.summary)).map(([key, value]) => [key, number(value)]),
    ),
  };
}

export function parseCrmQuickReplies(value: unknown): CrmQuickReply[] {
  return collectionRows(value).map((row) => ({
    id: text(row.id),
    title: text(row.title),
    body: text(row.body),
    active: bool(row.active),
  }));
}

export function parseCrmWhatsappAssignees(value: unknown): CrmWhatsappAssignee[] {
  return collectionRows(value).map((row) => ({ id: text(row.id), name: text(row.name) }));
}

function searchable(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function filterCrmCustomers(customers: CrmCustomer[], query: string): CrmCustomer[] {
  const needle = searchable(query.trim());
  if (!needle) return customers;
  return customers.filter((customer) =>
    searchable([customer.name, customer.email, customer.phone].filter(Boolean).join(" ")).includes(
      needle,
    ),
  );
}
