import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  campaignDeliveries,
  couponRedemptions,
  crmAutomationExecutions,
  crmAutomationRules,
  crmQuickReplies,
  customerConsents,
  deliveryOrders,
  growthCustomers,
  inventoryTransfers,
  loyaltyLedger,
  marketingCampaigns,
  posTabCustomerLinks,
  publicApiKeys,
  reservations,
  waitlistEntries,
  webhookEndpoints,
  whatsappConversations,
  whatsappMessages,
} from "@giromesa/db";

describe("growth persistence contract", () => {
  it("keeps tenant scope on every representative growth aggregate", () => {
    for (const table of [
      growthCustomers,
      posTabCustomerLinks,
      customerConsents,
      loyaltyLedger,
      couponRedemptions,
      reservations,
      waitlistEntries,
      deliveryOrders,
      inventoryTransfers,
      publicApiKeys,
      webhookEndpoints,
      whatsappConversations,
      whatsappMessages,
      crmAutomationRules,
      crmAutomationExecutions,
      crmQuickReplies,
    ])
      assert.ok(table.organizationId);
  });

  it("persists append-only consent and signed loyalty ledger entries", () => {
    assert.ok(customerConsents.occurredAt);
    assert.equal("updatedAt" in customerConsents, false);
    assert.ok(loyaltyLedger.amount);
    assert.ok(loyaltyLedger.reversalOfId);
  });

  it("keeps channel consent and operational customer links explicit", () => {
    assert.ok(growthCustomers.emailMarketingOptIn);
    assert.ok(growthCustomers.whatsappMarketingOptIn);
    assert.ok(growthCustomers.mergedIntoCustomerId);
    assert.ok(posTabCustomerLinks.tabId);
    assert.ok(posTabCustomerLinks.customerId);
  });

  it("stores fingerprints for strict idempotency", () => {
    for (const table of [
      loyaltyLedger,
      couponRedemptions,
      reservations,
      waitlistEntries,
      deliveryOrders,
      inventoryTransfers,
    ])
      assert.ok(table.requestFingerprint);
  });

  it("does not define clear-text API or webhook secret columns", () => {
    assert.ok(publicApiKeys.keyHash);
    assert.equal("key" in publicApiKeys, false);
    assert.equal("signingSecret" in webhookEndpoints, false);
  });

  it("persists WhatsApp idempotency, receipts and automation executions", () => {
    assert.ok(whatsappMessages.idempotencyKey);
    assert.ok(whatsappMessages.providerReference);
    assert.ok(whatsappMessages.deliveredAt);
    assert.ok(whatsappMessages.readAt);
    assert.ok(whatsappConversations.unreadCount);
    assert.ok(whatsappConversations.assignedIdentityId);
    assert.ok(whatsappConversations.priority);
    assert.ok(whatsappConversations.slaDueAt);
    assert.ok(whatsappMessages.mediaStorageKey);
    assert.ok(whatsappMessages.mediaSha256);
    assert.ok(crmAutomationExecutions.eventKey);
    assert.ok(crmAutomationExecutions.messageId);
    assert.ok(crmAutomationExecutions.retryCount);
    assert.ok(crmQuickReplies.body);
    assert.ok(marketingCampaigns.attributionWindowDays);
    assert.ok(marketingCampaigns.holdoutPercentage);
    assert.ok(campaignDeliveries.experimentVariant);
  });
});
