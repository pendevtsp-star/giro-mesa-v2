import { describe, expect, it } from "vitest";
import {
  filterCrmCustomers,
  parseCrmAutomationExecutions,
  parseCrmAutomations,
  parseCrmCampaign,
  parseCrmCampaignDeliveries,
  parseCrmCampaignPreview,
  parseCrmCampaignReview,
  parseCrmCustomerDetail,
  parseCrmCustomerHistory,
  parseCrmCustomerPage,
  parseCrmCustomers,
  parseCrmEvolutionIntegration,
  parseCrmLoyaltyProgram,
  parseCrmWhatsappInbox,
  parseCrmWhatsappMessages,
} from "./crm.model";

const customer = {
  id: "customer-1",
  name: "José da Silva",
  email: "jose@example.com",
  phone: "+55 11 99999-0000",
  marketingOptIn: true,
};
const campaign = {
  id: "campaign-1",
  name: "Campanha salva",
  channel: "email",
  status: "draft",
  subject: "Assunto salvo",
  content: "Mensagem A salva",
  variantBContent: "Mensagem B salva",
  attributionWindowDays: 14,
  holdoutPercentage: 10,
};
const campaignSummary = {
  campaign,
  limit: 20,
  offset: 0,
  total: 0,
  nextOffset: null,
  counts: {},
  attribution: {
    delivered: 1,
    read: 1,
    replied: 0,
    orders: 1,
    coupons: 0,
    revenueCents: 500,
    costedOrders: 1,
    incompleteCostOrders: 0,
    costCents: 200,
    grossMarginCents: 300,
  },
  experiments: [],
  deliveries: [],
};
const campaignPreview = {
  campaignId: "campaign-1",
  channel: "email",
  activeCustomers: 10,
  eligibleRecipients: 8,
  excludedRecipients: 2,
  recipientLimit: 500,
  exceedsRecipientLimit: false,
  provider: { ready: true, unavailableCode: null },
};

describe("CRM customer collection", () => {
  it("accepts current arrays and future paged payloads", () => {
    expect(parseCrmCustomers([customer])).toEqual(parseCrmCustomers({ items: [customer] }));
    expect(parseCrmCustomers({ data: { items: [customer] } })).toHaveLength(1);
    expect(parseCrmCustomerPage({ items: [customer], total: 31, limit: 30, offset: 0 }).total).toBe(
      31,
    );
  });

  it("searches name, email and phone without accent sensitivity", () => {
    const rows = parseCrmCustomers([customer]);
    expect(filterCrmCustomers(rows, "jose")).toHaveLength(1);
    expect(filterCrmCustomers(rows, "99999-0000")).toHaveLength(1);
    expect(filterCrmCustomers(rows, "inexistente")).toHaveLength(0);
  });

  it("parses persisted 360 metrics, timeline and campaign eligibility", () => {
    const detail = parseCrmCustomerDetail({
      customer,
      consent: { email: true, whatsapp: false },
      metrics: {
        visits: 2,
        totalSpendCents: 5000,
        averageTicketCents: 2500,
        noShows: 1,
        lastVisitAt: null,
      },
      loyalty: { balance: 12 },
      timeline: [
        {
          kind: "service",
          id: "tab-1",
          at: "2026-08-25T12:00:00.000Z",
          status: "closed",
          label: "dine_in",
          amountCents: 5000,
        },
      ],
    });
    expect(detail?.metrics.totalSpentCents).toBe(5000);
    expect(detail?.timeline).toHaveLength(1);
    expect(parseCrmCampaignPreview(campaignPreview).eligibleRecipients).toBe(8);
    expect(parseCrmCampaignDeliveries(campaignSummary).attribution).toMatchObject({
      costCents: 200,
      grossMarginCents: 300,
    });
  });

  it("requires the persisted message and matching campaign review responses", () => {
    expect(
      parseCrmCampaignReview("campaign-1", campaignPreview, campaignSummary).deliveries.campaign,
    ).toMatchObject({
      content: "Mensagem A salva",
      variantBContent: "Mensagem B salva",
      attributionWindowDays: 14,
    });
    expect(() => parseCrmCampaign({ ...campaign, content: undefined })).toThrow();
    expect(() => parseCrmCampaign({ ...campaign, attributionWindowDays: undefined })).toThrow();
    expect(() => parseCrmCampaignReview("campaign-2", campaignPreview, campaignSummary)).toThrow();
    expect(() =>
      parseCrmCampaignReview(
        "campaign-1",
        { ...campaignPreview, channel: "whatsapp" },
        campaignSummary,
      ),
    ).toThrow();
    expect(() =>
      parseCrmCampaignReview("campaign-1", campaignPreview, {
        ...campaignSummary,
        campaign: { ...campaign, id: "campaign-2" },
      }),
    ).toThrow();
  });

  it("preserves pagination and rejects an absent or regressing delivery cursor", () => {
    expect(
      parseCrmCampaignDeliveries({
        ...campaignSummary,
        offset: 20,
        total: 45,
        nextOffset: 40,
        counts: { sent: 45 },
      }),
    ).toMatchObject({ offset: 20, total: 45, nextOffset: 40, counts: { sent: 45 } });
    expect(() =>
      parseCrmCampaignDeliveries({ ...campaignSummary, nextOffset: undefined }),
    ).toThrow();
    expect(() =>
      parseCrmCampaignDeliveries({ ...campaignSummary, offset: 20, total: 45, nextOffset: 20 }),
    ).toThrow();
  });

  it("preserves inactive loyalty settings and distinguishes no program from invalid data", () => {
    const program = {
      id: "loyalty-1",
      mode: "cashback",
      rate: "2.75",
      minimumOrderCents: 3590,
      expiresAfterDays: 120,
      active: false,
    };
    expect(parseCrmLoyaltyProgram(program)).toEqual({ ...program, rate: 2.75 });
    expect(parseCrmLoyaltyProgram({ ...program, expiresAfterDays: null })).toMatchObject({
      expiresAfterDays: null,
      active: false,
    });
    expect(parseCrmLoyaltyProgram(null)).toBeNull();
    expect(() => parseCrmLoyaltyProgram(undefined)).toThrow();
    expect(() => parseCrmLoyaltyProgram({ ...program, rate: "invalid" })).toThrow();
    expect(() => parseCrmLoyaltyProgram({ ...program, expiresAfterDays: undefined })).toThrow();
    expect(() => parseCrmLoyaltyProgram({ ...program, active: undefined })).toThrow();
  });

  it("preserves microseconds in the history cursor and rejects malformed cursors", () => {
    const entry = {
      kind: "service",
      id: "tab-1",
      at: "2026-09-17T14:30:00.123456Z",
      status: "closed",
      label: "dine_in",
      amountCents: 1000,
    };
    const cursor = { at: entry.at, kind: entry.kind, id: entry.id };
    expect(parseCrmCustomerHistory({ items: [entry], nextCursor: cursor })).toEqual({
      items: [{ ...entry, amount: null }],
      nextCursor: cursor,
    });
    expect(parseCrmCustomerHistory({ items: [], nextCursor: null }).nextCursor).toBeNull();
    expect(() =>
      parseCrmCustomerHistory({ items: [], nextCursor: { ...cursor, id: undefined } }),
    ).toThrow();
  });

  it("keeps automation retries disabled unless the backend explicitly authorizes them", () => {
    const execution = {
      id: "execution-1",
      trigger: "birthday",
      customerName: "José",
      status: "failed",
      retryCount: 0,
      scheduledFor: "2026-09-17T12:00:00Z",
      createdAt: "2026-09-17T12:00:00Z",
    };
    expect(
      parseCrmAutomationExecutions({ items: [execution], summary: {} }).items[0]?.canRetry,
    ).toBe(false);
    expect(
      parseCrmAutomationExecutions({ items: [{ ...execution, canRetry: true }], summary: {} })
        .items[0]?.canRetry,
    ).toBe(true);
    expect(() =>
      parseCrmAutomationExecutions({ items: [{ ...execution, canRetry: "true" }], summary: {} }),
    ).toThrow();
  });

  it("parses Evolution status, inbox, messages and automation rules", () => {
    expect(
      parseCrmEvolutionIntegration({
        status: "ready",
        configured: true,
        ready: true,
        connectedNumber: "5511999990000",
        config: { maxMessagesPer30Days: 4 },
      }).ready,
    ).toBe(true);
    expect(
      parseCrmWhatsappInbox([
        {
          id: "conversation-1",
          customerId: "customer-1",
          customerName: "José",
          phone: "5511999990000",
          status: "open",
          priority: "normal",
          assignedIdentityId: null,
          assignedIdentityName: null,
          slaDueAt: null,
          firstResponseAt: null,
          updatedAt: "2026-08-25T12:00:00.000Z",
          unreadCount: 1,
          lastMessageAt: null,
        },
      ]).items,
    ).toHaveLength(1);
    expect(
      parseCrmWhatsappMessages([
        {
          id: "message-1",
          direction: "inbound",
          body: "Olá",
          contentKind: "text",
          status: "received",
          occurredAt: "2026-08-25T12:00:00.000Z",
        },
      ]).items[0]?.direction,
    ).toBe("inbound");
    expect(
      parseCrmAutomations([
        {
          id: "automation-1",
          trigger: "birthday",
          enabled: true,
          delayMinutes: 0,
          inactiveDays: null,
          messageTemplate: "Parabéns, {nome}",
        },
      ])[0]?.trigger,
    ).toBe("birthday");
  });
});
