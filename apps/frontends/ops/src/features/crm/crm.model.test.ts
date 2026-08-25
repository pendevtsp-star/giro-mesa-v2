import { describe, expect, it } from "vitest";
import {
  filterCrmCustomers,
  parseCrmAutomations,
  parseCrmCampaignPreview,
  parseCrmCustomerDetail,
  parseCrmCustomerPage,
  parseCrmCustomers,
  parseCrmEvolutionIntegration,
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
    expect(
      parseCrmCampaignPreview({
        campaignId: "campaign-1",
        channel: "email",
        activeCustomers: 10,
        eligibleRecipients: 8,
        excludedRecipients: 2,
        recipientLimit: 500,
        exceedsRecipientLimit: false,
        provider: { ready: true, unavailableCode: null },
      }).eligibleRecipients,
    ).toBe(8);
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
