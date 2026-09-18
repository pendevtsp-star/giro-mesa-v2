import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  campaignDeliveries,
  crmAutomationExecutions,
  crmAutomationRules,
  growthCustomers,
  growthIntegrations,
  identities,
  loyaltyLedger,
  loyaltyPrograms,
  memberships,
  organizations,
  outboxEvents,
  roleBindings,
  units,
  whatsappConversations,
  whatsappMessages,
} from "@giromesa/db";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { GrowthService } from "./growth.service.js";

const hasCode = (code: string) => (error: unknown) =>
  (error as { getResponse(): { code: string } }).getResponse().code === code;

it("keeps CRM campaign scope, retry safety, loyalty and complete history persisted", async (context) => {
  const databaseUrl = process.env.GROWTH_DATABASE_URL;
  if (!databaseUrl) return context.skip("GROWTH_DATABASE_URL not configured");
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    WHATSAPP_PROVIDER_ENABLED: process.env.WHATSAPP_PROVIDER_ENABLED,
    OUTBOX_ENCRYPTION_KEY: process.env.OUTBOX_ENCRYPTION_KEY,
  };
  process.env.DATABASE_URL = databaseUrl;
  process.env.WHATSAPP_PROVIDER_ENABLED = "true";
  process.env.OUTBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const database = new DatabaseService();
  try {
    const growth = new GrowthService(database, new ScopeService(database));
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values(
        ["CRM safety", "CRM foreign"].map((name) => ({
          legalName: name,
          tradeName: name,
          document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        })),
      )
      .returning();
    assert.ok(organization && foreignOrganization);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "CRM A" },
        { organizationId: organization.id, name: "CRM B" },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [owner, manager, organizationManager, foreignOwner] = await database.db
      .insert(identities)
      .values(
        ["Owner", "Manager", "Organization manager", "Foreign"].map((displayName) => ({
          displayName,
          email: `crm-safety-${randomUUID()}@example.test`,
        })),
      )
      .returning();
    assert.ok(owner && manager && organizationManager && foreignOwner);
    const memberRows = await database.db
      .insert(memberships)
      .values(
        [owner, manager, organizationManager, foreignOwner].map((identity) => ({
          identityId: identity.id,
          organizationId:
            identity.id === foreignOwner.id ? foreignOrganization.id : organization.id,
          status: "active" as const,
        })),
      )
      .returning();
    const [ownerMember, managerMember, organizationManagerMember, foreignMember] = memberRows;
    assert.ok(ownerMember && managerMember && organizationManagerMember && foreignMember);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMember.id, role: "owner" },
      { membershipId: managerMember.id, role: "manager", unitId: unitA.id },
      { membershipId: managerMember.id, role: "waiter", unitId: unitB.id },
      { membershipId: organizationManagerMember.id, role: "manager" },
      { membershipId: foreignMember.id, role: "owner" },
    ]);
    const campaignInput = {
      name: "Oferta salva",
      channel: "whatsapp" as const,
      content: "Conteúdo persistido da campanha",
      attributionWindowDays: 7,
      holdoutPercentage: 0,
    };
    const ownCampaign = await growth.createCampaign(manager.id, organization.id, {
      ...campaignInput,
      unitId: unitA.id,
    });
    const otherCampaign = await growth.createCampaign(owner.id, organization.id, {
      ...campaignInput,
      unitId: unitB.id,
    });
    const allCampaign = await growth.createCampaign(owner.id, organization.id, campaignInput);
    await assert.rejects(
      () => growth.createCampaign(manager.id, organization.id, campaignInput),
      hasCode("UNIT_ACCESS_DENIED"),
    );
    await assert.rejects(
      () =>
        growth.createCampaign(manager.id, organization.id, { ...campaignInput, unitId: unitB.id }),
      hasCode("UNIT_ACCESS_DENIED"),
    );
    assert.deepEqual(
      (await growth.listCampaigns(manager.id, organization.id)).map((row) => row.id),
      [ownCampaign.id],
    );
    assert.equal((await growth.listCampaigns(organizationManager.id, organization.id)).length, 3);
    for (const campaign of [otherCampaign, allCampaign]) {
      for (const action of [
        () => growth.previewCampaign(manager.id, organization.id, campaign.id),
        () => growth.campaignDeliverySummary(manager.id, organization.id, campaign.id),
        () => growth.queueCampaign(manager.id, organization.id, campaign.id),
        () =>
          growth.cancelCampaign(manager.id, organization.id, campaign.id, {
            reason: "Teste escopo",
          }),
      ])
        await assert.rejects(action, hasCode("CAMPAIGN_NOT_FOUND"));
    }
    await assert.rejects(
      () => growth.listCampaigns(foreignOwner.id, organization.id),
      hasCode("INSUFFICIENT_ROLE"),
    );
    assert.equal(
      (await growth.campaignDeliverySummary(owner.id, organization.id, otherCampaign.id)).campaign
        .content,
      campaignInput.content,
    );
    assert.equal(
      (
        await growth.cancelCampaign(manager.id, organization.id, ownCampaign.id, {
          reason: "Teste permitido",
        })
      ).campaign?.status,
      "canceled",
    );

    const customerA = await growth.createCustomer(owner.id, organization.id, {
      name: "Cliente A",
      defaultUnitId: unitA.id,
      phone: "+5511999991001",
      tags: [],
    });
    const customerB = await growth.createCustomer(owner.id, organization.id, {
      name: "Cliente B",
      defaultUnitId: unitB.id,
      phone: "+5511999991002",
      tags: [],
    });
    for (const customer of [customerA, customerB])
      await growth.recordConsent(owner.id, organization.id, customer.id, {
        decision: "granted",
        purpose: "marketing",
        channel: "whatsapp",
        source: "integration-test",
        legalBasis: "consent",
        policyVersion: "2026-09",
      });
    await database.db.insert(growthIntegrations).values({
      organizationId: organization.id,
      unitId: unitA.id,
      provider: "evolution_go",
      status: "ready",
    });
    assert.equal(
      (await growth.previewCampaign(owner.id, organization.id, allCampaign.id)).provider.ready,
      false,
    );
    assert.equal(
      (await growth.queueCampaign(owner.id, organization.id, allCampaign.id)).status,
      "blocked",
    );
    await database.db.insert(growthIntegrations).values({
      organizationId: organization.id,
      unitId: unitB.id,
      provider: "evolution_go",
      status: "ready",
    });
    assert.equal(
      (await growth.previewCampaign(owner.id, organization.id, allCampaign.id)).provider.ready,
      true,
    );
    await database.db
      .update(growthCustomers)
      .set({ defaultUnitId: null })
      .where(eq(growthCustomers.id, customerB.id));
    assert.equal(
      (await growth.previewCampaign(owner.id, organization.id, allCampaign.id)).provider.ready,
      false,
    );
    await database.db
      .update(growthCustomers)
      .set({ defaultUnitId: unitB.id })
      .where(eq(growthCustomers.id, customerB.id));
    assert.equal(
      (await growth.queueCampaign(owner.id, organization.id, allCampaign.id)).queuedRecipients,
      2,
    );
    const firstDelivery = await growth.campaignDeliverySummary(
      owner.id,
      organization.id,
      allCampaign.id,
      { limit: 1, offset: 0 },
    );
    const secondDelivery = await growth.campaignDeliverySummary(
      owner.id,
      organization.id,
      allCampaign.id,
      { limit: 1, offset: 1 },
    );
    assert.equal(firstDelivery.total, 2);
    assert.equal(firstDelivery.nextOffset, 1);
    assert.equal(secondDelivery.nextOffset, null);
    assert.equal(secondDelivery.campaign.content, campaignInput.content);
    assert.notEqual(firstDelivery.deliveries[0]?.id, secondDelivery.deliveries[0]?.id);
    assert.deepEqual(firstDelivery.counts, secondDelivery.counts);

    const [rule] = await database.db
      .insert(crmAutomationRules)
      .values({
        organizationId: organization.id,
        unitId: unitA.id,
        trigger: "birthday",
        enabled: true,
        messageTemplate: "Olá, {nome}",
      })
      .returning();
    assert.ok(rule);
    const executions = await database.db
      .insert(crmAutomationExecutions)
      .values(
        ["WHATSAPP_DELIVERY_UNCERTAIN", null, "WHATSAPP_MEDIA_UNAVAILABLE"].map((reason) => ({
          organizationId: organization.id,
          unitId: unitA.id,
          ruleId: rule.id,
          customerId: customerA.id,
          eventKey: randomUUID(),
          status: "failed" as const,
          reason,
          scheduledFor: new Date(),
        })),
      )
      .returning();
    const [uncertain, missingReason, safe] = executions;
    assert.ok(uncertain && missingReason && safe);
    for (const execution of [uncertain, missingReason])
      await assert.rejects(
        () => growth.retryCrmAutomationExecution(owner.id, organization.id, execution.id),
        hasCode("CRM_AUTOMATION_DELIVERY_UNCERTAIN"),
      );
    const executionPage = await growth.listCrmAutomationExecutions(owner.id, organization.id, {
      unitId: unitA.id,
      limit: 30,
    });
    assert.equal(executionPage.items.find((row) => row.id === safe.id)?.canRetry, true);
    assert.equal(executionPage.items.find((row) => row.id === uncertain.id)?.canRetry, false);
    const retries = await Promise.allSettled([
      growth.retryCrmAutomationExecution(owner.id, organization.id, safe.id),
      growth.retryCrmAutomationExecution(owner.id, organization.id, safe.id),
    ]);
    assert.equal(retries.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = retries.find((result) => result.status === "rejected");
    assert.ok(
      rejected?.status === "rejected" &&
        hasCode("CRM_AUTOMATION_EXECUTION_NOT_RETRYABLE")(rejected.reason),
    );
    const [retried] = await database.db
      .select()
      .from(crmAutomationExecutions)
      .where(eq(crmAutomationExecutions.id, safe.id));
    assert.equal(retried?.retryCount, 1);
    const retryMessages = await database.db
      .select()
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.organizationId, organization.id),
          eq(whatsappMessages.customerId, customerA.id),
        ),
      );
    assert.equal(retryMessages.length, 1);
    const queuedEvents = await database.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          sql`${outboxEvents.payload}->>'organizationId' = ${organization.id}`,
          eq(outboxEvents.topic, "growth.whatsapp_message_requested"),
        ),
      );
    assert.equal(queuedEvents.length, 1);

    const programInput = { mode: "points" as const, rate: 1, minimumOrderCents: 0, active: true };
    const activeProgram = await growth.configureLoyaltyProgram(
      owner.id,
      organization.id,
      programInput,
    );
    await growth.configureLoyaltyProgram(owner.id, organization.id, {
      ...programInput,
      active: false,
    });
    assert.equal((await growth.loyaltyProgram(owner.id, organization.id))?.active, false);
    assert.equal(
      (
        await database.db
          .select()
          .from(loyaltyPrograms)
          .where(
            and(
              eq(loyaltyPrograms.organizationId, organization.id),
              eq(loyaltyPrograms.active, true),
            ),
          )
      ).length,
      0,
    );
    await assert.rejects(
      () =>
        growth.earnLoyalty(owner.id, organization.id, {
          unitId: unitA.id,
          customerId: customerA.id,
          commandId: randomUUID(),
          idempotencyKey: randomUUID(),
        }),
      hasCode("LOYALTY_PROGRAM_INACTIVE"),
    );

    const historyCustomer = await growth.createCustomer(owner.id, organization.id, {
      name: "Histórico completo",
      defaultUnitId: unitA.id,
      phone: "+5511999991003",
      tags: [],
    });
    const [conversation] = await database.db
      .insert(whatsappConversations)
      .values({
        organizationId: organization.id,
        unitId: unitA.id,
        customerId: historyCustomer.id,
        phone: "5511999991003",
      })
      .returning();
    assert.ok(conversation);
    const historyMessages = await database.db
      .insert(whatsappMessages)
      .values(
        Array.from({ length: 126 }, (_, index) => ({
          organizationId: organization.id,
          unitId: unitA.id,
          conversationId: conversation.id,
          customerId: historyCustomer.id,
          direction: "inbound" as const,
          body: `Mensagem ${index}`,
          status: "received" as const,
          idempotencyKey: randomUUID(),
        })),
      )
      .returning();
    await database.db.execute(
      sql`update growth_whatsapp_messages set occurred_at = '2026-09-01T12:00:00.123456Z'::timestamptz where conversation_id = ${conversation.id}`,
    );
    await database.db.execute(
      sql`update growth_whatsapp_messages set occurred_at = '2026-09-01T12:00:00.123455Z'::timestamptz where id = ${historyMessages[0]?.id}`,
    );
    const ledger = await database.db
      .insert(loyaltyLedger)
      .values(
        [1, 2].map((amount) => ({
          organizationId: organization.id,
          unitId: unitA.id,
          customerId: historyCustomer.id,
          programId: activeProgram.id,
          type: "adjustment" as const,
          amount,
          idempotencyKey: randomUUID(),
          requestFingerprint: "f".repeat(64),
        })),
      )
      .returning();
    await database.db.execute(
      sql`update growth_loyalty_ledger set created_at = '2026-09-01T12:00:00.123456Z'::timestamptz where customer_id = ${historyCustomer.id}`,
    );
    const events: Array<{ id: string; kind: string; at: string }> = [];
    let cursor: {
      at: string;
      kind:
        | "service"
        | "reservation"
        | "waitlist"
        | "delivery"
        | "campaign"
        | "coupon"
        | "whatsapp"
        | "loyalty";
      id: string;
    } | null = null;
    do {
      const page = await growth.customerHistory(owner.id, organization.id, historyCustomer.id, {
        limit: 7,
        ...(cursor ? { cursorAt: cursor.at, cursorKind: cursor.kind, cursorId: cursor.id } : {}),
      });
      events.push(...page.items);
      cursor = page.nextCursor;
      assert.ok(events.length <= 128, "history cursor must make progress");
    } while (cursor);
    assert.equal(events.length, 128);
    assert.equal(new Set(events.map((event) => `${event.kind}:${event.id}`)).size, 128);
    assert.equal(events.at(-1)?.at, "2026-09-01T12:00:00.123455Z");
    assert.ok(
      ledger.every((entry) =>
        events.some((event) => event.kind === "loyalty" && event.id === entry.id),
      ),
    );
    await assert.rejects(
      () => growth.customerHistory(foreignOwner.id, organization.id, historyCustomer.id),
      hasCode("INSUFFICIENT_ROLE"),
    );
    await assert.rejects(
      () => growth.customerHistory(foreignOwner.id, foreignOrganization.id, historyCustomer.id),
      hasCode("CUSTOMER_NOT_FOUND"),
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(campaignDeliveries)
          .where(eq(campaignDeliveries.campaignId, allCampaign.id))
      ).length,
      2,
    );
  } finally {
    await database.onModuleDestroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
