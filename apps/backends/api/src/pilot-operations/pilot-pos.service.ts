import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  ManualKdsTicketPrintInput,
  OperationalCapability,
  OperationalPushSubscription,
  PaymentAttemptStatus,
  PrintDocumentPayloadV2,
} from "@giromesa/contracts";
import {
  auditEvents,
  type Database,
  deviceEnrollments,
  doseClubRedemptions,
  fiscalDocuments,
  growthCustomers,
  identities,
  loyaltyLedger,
  loyaltyPrograms,
  managementCashAdjustments,
  managementCashEntries,
  managementCashRegisters,
  managementCashRegisterTerminals,
  managementCashShifts,
  managementInventoryIssueRoutes,
  managementInventoryItems,
  managementInventoryReservations,
  managementOperationalLosses,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReturnableCustodyHandoffs,
  managementReturnableCustodyMovements,
  managementReturnablePolicies,
  managementSettlementSettings,
  managementStockBalances,
  managementStockLocations,
  memberships,
  organizations,
  outboxEvents,
  posCatalogBranding,
  posCatalogPromotions,
  posDiningRooms,
  posDiningTableGroupMembers,
  posDiningTableGroups,
  posDiningTables,
  posFloorElements,
  posFloorLayouts,
  posIdempotencyReceipts,
  posKdsAttentionAcknowledgements,
  posKdsBatchAssignments,
  posKdsBatches,
  posKdsItemChanges,
  posKdsTerminalProfiles,
  posKdsTicketItems,
  posKdsTickets,
  posManagerPins,
  posModifierGroups,
  posModifierOptions,
  posOperationApprovals,
  posOperationalPushSubscriptions,
  posOperationalShifts,
  posOrderItemModifiers,
  posOrderItems,
  posOrders,
  posPaymentAttemptResults,
  posPaymentAttempts,
  posPaymentReconciliations,
  posPaymentReversalResults,
  posPaymentReversals,
  posPaymentTerminalCertifications,
  posPrintJobs,
  posPrintSplitParts,
  posPrintSplits,
  posProductAvailability,
  posProductionStations,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posRecipeComponents,
  posServiceCalls,
  posServiceSections,
  posServiceSectionTables,
  posShiftSectionStaff,
  posShiftSections,
  posShiftSectionTables,
  posShiftTableLayouts,
  posShiftTableTransfers,
  posTabCustomerLinks,
  posTabEvents,
  posTableQrSettings,
  posTabPayments,
  posTabPresence,
  posTabs,
  posTerminalProfiles,
  reservations,
  roleBindings,
  units,
  waitlistEntries,
} from "@giromesa/db";
import {
  billingAccess,
  encryptionKey,
  encryptSecret,
  floorPlacementConflicts,
  hasPermission,
  SYSTEM_ROLES,
  type SystemRole,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { tablePresenceCode } from "../common/table-presence-code.js";
import { DatabaseService } from "../database/database.module.js";
import { DoseClubIntegrationService } from "../doseclub-integration/doseclub-integration.service.js";
import { loyaltyEarn } from "../growth/growth.rules.js";
import { normalizeStoredBranding } from "../organizations/establishment-settings.service.js";
import { ScopeService } from "../organizations/scope.service.js";
import { bestPromotion, localCalendar } from "../public-menu/public-order-rules.js";
import { tableAccessSecret } from "../public-menu/table-access-token.js";
import {
  allocatePrintSplitAmounts,
  approvalExpiresAt,
  assertKdsOrderHandoff,
  assertKdsTransition,
  assertPaymentDeviceTransition,
  assertPrintJobTransition,
  assertTabCanClose,
  assertTenantScope,
  initialKdsCourseDispatch,
  isApprovalActive,
  isWithinAvailability,
  itemAmounts,
  kdsAttentionRevision,
  kdsCapacityRecommendation,
  kdsPartialState,
  normalizeKdsAttentionText,
  paymentAttemptExpiresAt,
  projectKdsAvailability,
  replayResult,
  requestHash,
  shouldAlertKdsCancellation,
  suggestedServiceChargeBasisPoints,
  summarizeKdsDurations,
  tabTotals,
} from "./pilot-rules.js";
import type {
  ApprovalDecisionInput,
  ApprovalRequestInput,
  CancelItemInput,
  ClaimTabInput,
  CloseOperationalShiftInput,
  CloseTabInput,
  CounterQueueQueryInput,
  DetachTableGroupInput,
  DiscountInput,
  FloorLayoutInput,
  KdsAnalyticsQueryInput,
  KdsAttentionAcknowledgeInput,
  KdsBatchCancelInput,
  KdsBatchCompleteInput,
  KdsBatchCreateInput,
  KdsBlockInput,
  KdsCancelInput,
  KdsChangeAcknowledgeInput,
  KdsCourseStateInput,
  KdsItemStateInput,
  KdsOrderHandoffInput,
  KdsOrderPriorityInput,
  KdsPriorityInput,
  KdsProductAvailabilityInput,
  KdsRecallInput,
  KdsRefireInput,
  KdsRerouteInput,
  KdsRunnerClaimInput,
  KdsStateInput,
  KdsTerminalProfileInput,
  KdsTicketClaimInput,
  KdsUnblockInput,
  ManagerPinInput,
  MergeTabsInput,
  MoveItemsInput,
  OpenOperationalShiftInput,
  OpenTabInput,
  OrderInput,
  PaymentAttemptCreateInput,
  PaymentDeviceResultInput,
  PaymentInput,
  PaymentReversalCreateInput,
  PaymentTerminalConfigurationInput,
  PrintJobInput,
  PrintJobQueryInput,
  PrintJobStatusInput,
  PrintSplitInput,
  ReopenTabInput,
  ReprintJobInput,
  RetryPrintJobInput,
  RoomInput,
  ServiceCallInput,
  ServiceChargeInput,
  ServiceSectionInput,
  ShiftLayoutInput,
  ShiftSectionAssignmentInput,
  ShiftSectionCoverageInput,
  ShiftSectionsBatchAssignmentInput,
  SplitTabInput,
  TableBatchInput,
  TableEditInput,
  TableGroupInput,
  TableInput,
  TableTurnoverInput,
  TemporaryTableTransferInput,
  TerminalProfileInput,
  TipInput,
  TransferTabInput,
  UpdateTabInput,
} from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";
import { ProductionPrintingService } from "./production-printing.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;
type CounterQueueStage = "new" | "production" | "ready" | "waiting" | "delivered" | "late";
type CounterQueueRow = typeof posTabs.$inferSelect & { queueStage: CounterQueueStage };
type OpenReturnableCustody = {
  issueMovementId: string;
  tabId: string;
  containerInventoryItemId: string;
  containerName: string;
  openQuantity: string;
  currentResponsibleIdentityId: string | null;
};

function returnableQuantityToMilli(value: string) {
  const negative = value.startsWith("-");
  const normalized = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const milli = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
  return negative ? -milli : milli;
}

function returnableMilliToQuantity(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const quantity = `${absolute / 1_000n}.${String(absolute % 1_000n).padStart(3, "0")}`;
  return negative ? `-${quantity}` : quantity;
}
export type PaymentDeviceSignature = {
  credentialId?: string;
  timestamp?: string;
  nonce?: string;
  signature?: string;
  method: string;
  path: string;
  body?: unknown;
};

@Injectable()
export class PilotPosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly smartPos: PilotSmartPosService = new PilotSmartPosService(database, scope),
    private readonly productionPrinting?: ProductionPrintingService,
    private readonly doseClub?: DoseClubIntegrationService,
  ) {}

  private async requireAccess(identityId: string, organizationId: string, unitId: string) {
    return this.scope.requireUnitAccess(identityId, organizationId, unitId);
  }

  private operationalPushPublicKey() {
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
    let encryptionConfigured = false;
    try {
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY");
      encryptionConfigured = true;
    } catch {
      encryptionConfigured = false;
    }
    const configured =
      /^[A-Za-z0-9_-]{87}$/.test(publicKey) &&
      /^[A-Za-z0-9_-]{43}$/.test(process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "") &&
      /^mailto:.+@.+|^https:\/\/.+/.test(process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "") &&
      encryptionConfigured;
    return configured ? publicKey : null;
  }

  private assertOperationalPushEndpoint(endpoint: string) {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    const allowedSuffixes = [
      "googleapis.com",
      "push.services.mozilla.com",
      "push.apple.com",
      "notify.windows.com",
    ];
    if (
      url.protocol !== "https:" ||
      (url.port !== "" && url.port !== "443") ||
      isIP(host) !== 0 ||
      !allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    ) {
      throw new BadRequestException({
        code: "WEB_PUSH_ENDPOINT_INVALID",
        message: "O navegador informou um provedor de notificações não reconhecido.",
      });
    }
  }

  async operationalPushConfig(
    identityId: string,
    sessionId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const publicKey = this.operationalPushPublicKey();
    const [subscription] = await this.database.db
      .select({ installationId: posOperationalPushSubscriptions.installationId })
      .from(posOperationalPushSubscriptions)
      .where(
        and(
          eq(posOperationalPushSubscriptions.installationId, installationId),
          eq(posOperationalPushSubscriptions.organizationId, organizationId),
          eq(posOperationalPushSubscriptions.unitId, unitId),
          eq(posOperationalPushSubscriptions.identityId, identityId),
          eq(posOperationalPushSubscriptions.sessionId, sessionId),
          eq(posOperationalPushSubscriptions.enabled, true),
        ),
      )
      .limit(1);
    return { configured: publicKey !== null, publicKey, active: Boolean(subscription) };
  }

  async upsertOperationalPushSubscription(
    identityId: string,
    sessionId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
    input: OperationalPushSubscription,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    if (!this.operationalPushPublicKey()) {
      throw new HttpException(
        {
          code: "WEB_PUSH_NOT_CONFIGURED",
          message: "As notificações externas ainda não foram configuradas nesta instalação.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.assertOperationalPushEndpoint(input.endpoint);
    const expiresAt = input.expirationTime ? new Date(input.expirationTime) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException({
        code: "WEB_PUSH_SUBSCRIPTION_EXPIRED",
        message: "A assinatura do navegador já expirou. Ative as notificações novamente.",
      });
    }
    let envelope: ReturnType<typeof encryptSecret>;
    try {
      envelope = encryptSecret(
        JSON.stringify(input),
        encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
        `web-push:${installationId}`,
      );
    } catch {
      throw new HttpException(
        {
          code: "WEB_PUSH_ENCRYPTION_UNAVAILABLE",
          message: "As notificações externas estão temporariamente indisponíveis.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const endpointHash = createHash("sha256").update(input.endpoint).digest("hex");
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`web-push:${endpointHash}`}))`);
      await tx
        .delete(posOperationalPushSubscriptions)
        .where(
          and(
            eq(posOperationalPushSubscriptions.endpointHash, endpointHash),
            ne(posOperationalPushSubscriptions.installationId, installationId),
          ),
        );
      await tx
        .insert(posOperationalPushSubscriptions)
        .values({
          installationId,
          organizationId,
          unitId,
          identityId,
          sessionId,
          endpointHash,
          encryptedSubscription: envelope.encryptedSecret,
          encryptionIv: envelope.iv,
          encryptionAuthTag: envelope.authTag,
          subscriptionExpiresAt: expiresAt,
          enabled: true,
          lastFailedAt: null,
          lastFailureCode: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: posOperationalPushSubscriptions.installationId,
          set: {
            organizationId,
            unitId,
            identityId,
            sessionId,
            endpointHash,
            encryptedSubscription: envelope.encryptedSecret,
            encryptionIv: envelope.iv,
            encryptionAuthTag: envelope.authTag,
            subscriptionExpiresAt: expiresAt,
            enabled: true,
            lastFailedAt: null,
            lastFailureCode: null,
            updatedAt: new Date(),
          },
        });
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "pos.operational_push.subscribed",
        entityType: "push_installation",
        entityId: installationId,
        metadata: { unitId },
      });
    });
    return { configured: true, publicKey: this.operationalPushPublicKey(), active: true };
  }

  async removeOperationalPushSubscription(
    identityId: string,
    sessionId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    await this.database.db.transaction(async (tx) => {
      const removed = await tx
        .delete(posOperationalPushSubscriptions)
        .where(
          and(
            eq(posOperationalPushSubscriptions.installationId, installationId),
            eq(posOperationalPushSubscriptions.organizationId, organizationId),
            eq(posOperationalPushSubscriptions.unitId, unitId),
            eq(posOperationalPushSubscriptions.identityId, identityId),
            eq(posOperationalPushSubscriptions.sessionId, sessionId),
          ),
        )
        .returning({ installationId: posOperationalPushSubscriptions.installationId });
      if (removed.length > 0) {
        await tx.insert(auditEvents).values({
          organizationId,
          actorIdentityId: identityId,
          action: "pos.operational_push.unsubscribed",
          entityType: "push_installation",
          entityId: installationId,
          metadata: { unitId },
        });
      }
    });
  }

  private async publicServiceIdentity(organizationId: string) {
    const email = `public-orders+${organizationId}@system.giromesa.invalid`;
    await this.database.db
      .insert(identities)
      .values({
        email,
        displayName: "Canal público de pedidos",
        kind: "service",
        emailVerifiedAt: new Date(),
      })
      .onConflictDoNothing();
    const [identity] = await this.database.db
      .select({ id: identities.id, kind: identities.kind })
      .from(identities)
      .where(eq(identities.email, email))
      .limit(1);
    if (identity?.kind !== "service") {
      throw new Error("PUBLIC_ORDER_SERVICE_IDENTITY_UNAVAILABLE");
    }
    return identity.id;
  }

  private async tableBelongsToTab(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tableId: string,
    tab: { id: string; tableId: string | null },
  ) {
    const [table] = await tx
      .select({ id: posDiningTables.id })
      .from(posDiningTables)
      .where(
        and(
          eq(posDiningTables.organizationId, organizationId),
          eq(posDiningTables.unitId, unitId),
          eq(posDiningTables.id, tableId),
          eq(posDiningTables.active, true),
        ),
      )
      .limit(1);
    if (!table) return false;
    if (tab.tableId === tableId) return true;
    const [group] = await tx
      .select({ id: posDiningTableGroups.id })
      .from(posDiningTableGroupMembers)
      .innerJoin(
        posDiningTableGroups,
        and(
          eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
          eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
          eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
        ),
      )
      .where(
        and(
          eq(posDiningTableGroupMembers.organizationId, organizationId),
          eq(posDiningTableGroupMembers.unitId, unitId),
          eq(posDiningTableGroupMembers.tableId, tableId),
          eq(posDiningTableGroups.primaryTabId, tab.id),
          eq(posDiningTableGroups.mode, "single_tab"),
          isNull(posDiningTableGroups.dissolvedAt),
        ),
      )
      .limit(1);
    return Boolean(group);
  }

  private assertPromisedAtNotPast(promisedAt: string | null | undefined) {
    if (promisedAt && new Date(promisedAt).getTime() < Date.now() - 60_000) {
      throw new BadRequestException({
        code: "PROMISED_AT_IN_PAST",
        message: "Informe um prazo futuro.",
      });
    }
  }

  private async createPosPayment(
    tx: Transaction,
    input: typeof posTabPayments.$inferInsert,
    routing: { cashRegisterId?: string; installationId?: string } = {},
  ) {
    if (routing.cashRegisterId && !routing.installationId) {
      const [cashRegister] = await tx
        .select({ id: managementCashRegisters.id })
        .from(managementCashRegisters)
        .where(
          and(
            eq(managementCashRegisters.organizationId, input.organizationId),
            eq(managementCashRegisters.unitId, input.unitId),
            eq(managementCashRegisters.id, routing.cashRegisterId),
            eq(managementCashRegisters.active, true),
          ),
        )
        .for("update")
        .limit(1);
      if (!cashRegister) {
        throw new ConflictException({
          code: "CASH_REGISTER_NOT_FOUND",
          message: "A gaveta informada não está ativa nesta unidade.",
        });
      }
    }
    let cashRegisterId = routing.installationId ? undefined : routing.cashRegisterId;
    if (routing.installationId) {
      const [binding] = await tx
        .select({ cashRegisterId: managementCashRegisterTerminals.cashRegisterId })
        .from(managementCashRegisterTerminals)
        .where(
          and(
            eq(managementCashRegisterTerminals.organizationId, input.organizationId),
            eq(managementCashRegisterTerminals.unitId, input.unitId),
            eq(managementCashRegisterTerminals.installationId, routing.installationId),
          ),
        )
        .for("update")
        .limit(1);
      cashRegisterId = binding?.cashRegisterId;
    }
    let cashShift: { id: string } | undefined;
    if (cashRegisterId) {
      [cashShift] = await tx
        .select({ id: managementCashShifts.id })
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, input.organizationId),
            eq(managementCashShifts.unitId, input.unitId),
            eq(managementCashShifts.cashRegisterId, cashRegisterId),
            eq(managementCashShifts.status, "open"),
          ),
        )
        .for("update")
        .limit(1);
    } else {
      const openShifts = await tx
        .select({ id: managementCashShifts.id })
        .from(managementCashShifts)
        .where(
          and(
            eq(managementCashShifts.organizationId, input.organizationId),
            eq(managementCashShifts.unitId, input.unitId),
            eq(managementCashShifts.status, "open"),
          ),
        )
        .orderBy(asc(managementCashShifts.id))
        .for("update")
        .limit(2);
      if (openShifts.length > 1) {
        throw new ConflictException({
          code: routing.installationId
            ? "CASH_REGISTER_BINDING_REQUIRED"
            : "CASH_REGISTER_REQUIRED",
          message: routing.installationId
            ? "Vincule o terminal a uma gaveta antes de receber pagamentos."
            : "Informe a gaveta que deve receber o pagamento.",
        });
      }
      [cashShift] = openShifts;
    }
    if (!cashShift && input.method === "cash") {
      throw new ConflictException({
        code: "CASH_SHIFT_REQUIRED",
        message: "Abra o caixa da unidade antes de registrar um pagamento em dinheiro.",
      });
    }
    const [payment] = await tx.insert(posTabPayments).values(input).returning();
    if (!payment) throw new Error("Payment insert did not return a row");
    if (cashShift) {
      await tx.insert(managementCashEntries).values({
        organizationId: payment.organizationId,
        unitId: payment.unitId,
        cashShiftId: cashShift.id,
        direction: "in",
        entryType: "pos_payment",
        paymentMethod: payment.method,
        affectsDrawer: payment.method === "cash",
        amountCents: payment.amountCents,
        sourceType: "pos_tab_payment",
        sourceId: payment.id,
        actorIdentityId: payment.createdByIdentityId,
        occurredAt: payment.createdAt,
      });
    }
    return payment;
  }

  private async recordApprovedPaymentReversalAccounting(
    tx: Transaction,
    input: {
      organizationId: string;
      unitId: string;
      reversalId: string;
      paymentId: string;
      installationId: string;
      actorIdentityId: string;
      paymentMethod: typeof posTabPayments.$inferSelect.method;
      amountCents: number;
      occurredAt: Date;
    },
  ) {
    const [originalEntry] = await tx
      .select({
        cashShiftId: managementCashEntries.cashShiftId,
        paymentMethod: managementCashEntries.paymentMethod,
        affectsDrawer: managementCashEntries.affectsDrawer,
      })
      .from(managementCashEntries)
      .where(
        and(
          eq(managementCashEntries.organizationId, input.organizationId),
          eq(managementCashEntries.unitId, input.unitId),
          eq(managementCashEntries.sourceType, "pos_tab_payment"),
          eq(managementCashEntries.sourceId, input.paymentId),
        ),
      )
      .limit(1);

    const [originalShift] = originalEntry
      ? await tx
          .select({
            id: managementCashShifts.id,
            cashRegisterId: managementCashShifts.cashRegisterId,
            status: managementCashShifts.status,
          })
          .from(managementCashShifts)
          .where(
            and(
              eq(managementCashShifts.organizationId, input.organizationId),
              eq(managementCashShifts.unitId, input.unitId),
              eq(managementCashShifts.id, originalEntry.cashShiftId),
            ),
          )
          .for("update")
          .limit(1)
      : [];
    const paymentMethod = originalEntry?.paymentMethod ?? input.paymentMethod;
    const affectsDrawer = originalEntry?.affectsDrawer ?? input.paymentMethod === "cash";

    if (originalShift?.status === "open") {
      const [inserted] = await tx
        .insert(managementCashEntries)
        .values({
          organizationId: input.organizationId,
          unitId: input.unitId,
          cashShiftId: originalShift.id,
          direction: "out",
          entryType: "reversal",
          paymentMethod,
          affectsDrawer,
          amountCents: input.amountCents,
          sourceType: "payment_reversal",
          sourceId: input.reversalId,
          actorIdentityId: input.actorIdentityId,
          description: "Estorno aprovado de pagamento POS.",
          occurredAt: input.occurredAt,
        })
        .onConflictDoNothing()
        .returning({ id: managementCashEntries.id });
      const [existing] = inserted
        ? [inserted]
        : await tx
            .select({ id: managementCashEntries.id })
            .from(managementCashEntries)
            .where(
              and(
                eq(managementCashEntries.organizationId, input.organizationId),
                eq(managementCashEntries.unitId, input.unitId),
                eq(managementCashEntries.sourceType, "payment_reversal"),
                eq(managementCashEntries.sourceId, input.reversalId),
              ),
            )
            .limit(1);
      return {
        cashEntryId: existing?.id ?? null,
        cashAdjustmentId: null,
        cashRegisterId: originalShift.cashRegisterId,
        originalCashShiftId: originalShift.id,
      };
    }

    let cashRegisterId = originalShift?.cashRegisterId ?? null;
    if (!cashRegisterId) {
      const [binding] = await tx
        .select({ cashRegisterId: managementCashRegisterTerminals.cashRegisterId })
        .from(managementCashRegisterTerminals)
        .where(
          and(
            eq(managementCashRegisterTerminals.organizationId, input.organizationId),
            eq(managementCashRegisterTerminals.unitId, input.unitId),
            eq(managementCashRegisterTerminals.installationId, input.installationId),
          ),
        )
        .for("update")
        .limit(1);
      cashRegisterId = binding?.cashRegisterId ?? null;
    }
    const [inserted] = await tx
      .insert(managementCashAdjustments)
      .values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        cashRegisterId,
        originalCashShiftId: originalShift?.id ?? null,
        direction: "out",
        entryType: "reversal",
        paymentMethod,
        affectsDrawer,
        amountCents: input.amountCents,
        sourceType: "payment_reversal",
        sourceId: input.reversalId,
        actorIdentityId: input.actorIdentityId,
        description: originalShift
          ? "Estorno aprovado após o fechamento do turno de caixa."
          : "Estorno aprovado sem lançamento em turno de caixa.",
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: managementCashAdjustments.id });
    const [existing] = inserted
      ? [inserted]
      : await tx
          .select({ id: managementCashAdjustments.id })
          .from(managementCashAdjustments)
          .where(
            and(
              eq(managementCashAdjustments.organizationId, input.organizationId),
              eq(managementCashAdjustments.unitId, input.unitId),
              eq(managementCashAdjustments.sourceType, "payment_reversal"),
              eq(managementCashAdjustments.sourceId, input.reversalId),
            ),
          )
          .limit(1);
    return {
      cashEntryId: null,
      cashAdjustmentId: existing?.id ?? null,
      cashRegisterId,
      originalCashShiftId: originalShift?.id ?? null,
    };
  }

  private async requireScopedRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    allowed: readonly SystemRole[],
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, SYSTEM_ROLES);
    if (
      !rows.some(
        (row) =>
          allowed.some((allowedRole) => allowedRole === row.role) &&
          (row.unitId === null || row.unitId === unitId),
      )
    ) {
      throw new ForbiddenException({
        code: "POS_ROLE_DENIED",
        message: "Ação não autorizada nesta unidade.",
      });
    }
    return rows;
  }

  private async requireScopedCapability(
    identityId: string,
    organizationId: string,
    unitId: string,
    capability: OperationalCapability,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, SYSTEM_ROLES);
    if (
      !rows.some(
        (row) =>
          (row.unitId === null || row.unitId === unitId) &&
          hasPermission(row.role as SystemRole, capability),
      )
    ) {
      throw new ForbiddenException({
        code: "POS_CAPABILITY_DENIED",
        message: "Ação operacional não autorizada nesta unidade.",
        capability,
      });
    }
    return rows;
  }

  private async requireManagerMembership(
    identityId: string,
    organizationId: string,
    unitId: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [membership] = await this.database.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(roleBindings.role, ["owner", "manager"]),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!membership) throw new ForbiddenException({ code: "POS_MANAGER_REQUIRED" });
    return membership;
  }

  private async verifyManagerPin(
    identityId: string,
    organizationId: string,
    unitId: string,
    pin: string,
  ) {
    const membership = await this.requireManagerMembership(identityId, organizationId, unitId);
    const [managerPin] = await this.database.db
      .select({ pinHash: posManagerPins.pinHash })
      .from(posManagerPins)
      .where(
        and(
          eq(posManagerPins.membershipId, membership.id),
          eq(posManagerPins.organizationId, organizationId),
          eq(posManagerPins.active, true),
        ),
      )
      .limit(1);
    if (!managerPin || !(await argon2.verify(managerPin.pinHash, pin))) {
      throw new ForbiddenException({
        code: "INVALID_MANAGER_APPROVAL",
        message: "Código gerencial inválido.",
      });
    }
    return membership;
  }

  private async requireOperationalIdentity(
    organizationId: string,
    unitId: string,
    responsibleIdentityId: string,
  ) {
    const [responsible] = await this.database.db
      .select({ id: identities.id, displayName: identities.displayName })
      .from(memberships)
      .innerJoin(identities, eq(identities.id, memberships.identityId))
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, responsibleIdentityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
          inArray(roleBindings.role, ["owner", "manager", "waiter", "cashier"]),
        ),
      )
      .limit(1);
    if (!responsible) {
      throw new ConflictException({
        code: "RESPONSIBLE_OUT_OF_SCOPE",
        message: "O responsável não está ativo nesta unidade.",
      });
    }
    return responsible;
  }

  private async requireOperationalBilling(organizationId: string) {
    const [organization] = await this.database.db
      .select({
        state: organizations.billingState,
        operationalClosureUntil: organizations.operationalClosureUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();
    if (
      billingAccess(organization.state, new Date(), organization.operationalClosureUntil) !== "full"
    ) {
      throw new HttpException(
        {
          code: "OPERATION_RESTRICTED",
          message: "Novas operações estão bloqueadas pela situação comercial da conta.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private async restoreShiftTransferSnapshots(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    transfers: Array<{
      id: string;
      tabId: string | null;
      previousShiftSectionId: string | null;
      previousResponsibleIdentityId: string | null;
      targetShiftSectionId: string;
      appliedResponsibleIdentityId: string | null;
      appliedTabVersion: number | null;
    }>,
  ) {
    const restoredTabIds: string[] = [];
    const preservedTabIds: string[] = [];
    for (const transfer of transfers) {
      if (!transfer.tabId || transfer.appliedTabVersion === null) continue;
      const [tab] = await tx
        .select({
          id: posTabs.id,
          status: posTabs.status,
          shiftSectionId: posTabs.shiftSectionId,
          responsibleIdentityId: posTabs.responsibleIdentityId,
          version: posTabs.version,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, transfer.tabId),
          ),
        )
        .for("update")
        .limit(1);
      const unchangedSinceTransfer =
        tab?.status === "open" &&
        tab.shiftSectionId === transfer.targetShiftSectionId &&
        tab.responsibleIdentityId === transfer.appliedResponsibleIdentityId &&
        tab.version === transfer.appliedTabVersion;
      if (!tab || !unchangedSinceTransfer) {
        preservedTabIds.push(transfer.tabId);
        continue;
      }
      const [restored] = await tx
        .update(posTabs)
        .set({
          shiftSectionId: transfer.previousShiftSectionId,
          responsibleIdentityId: transfer.previousResponsibleIdentityId,
          version: tab.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, tab.id),
            eq(posTabs.version, tab.version),
          ),
        )
        .returning({ id: posTabs.id });
      if (!restored) {
        preservedTabIds.push(transfer.tabId);
        continue;
      }
      restoredTabIds.push(tab.id);
      await this.recordEvent(
        tx,
        actorIdentityId,
        organizationId,
        unitId,
        tab.id,
        "tab.handover_restored",
        {
          transferId: transfer.id,
          shiftSectionId: transfer.previousShiftSectionId,
          responsibleIdentityId: transfer.previousResponsibleIdentityId,
        },
      );
    }
    return { restoredTabIds, preservedTabIds };
  }

  private async reconcileExpiredShiftTableTransfers(
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-expired-transfer:${organizationId}:${unitId}`}))`,
      );
      const expired = await tx
        .select({
          id: posShiftTableTransfers.id,
          tabId: posShiftTableTransfers.tabId,
          previousShiftSectionId: posShiftTableTransfers.previousShiftSectionId,
          previousResponsibleIdentityId: posShiftTableTransfers.previousResponsibleIdentityId,
          targetShiftSectionId: posShiftTableTransfers.targetShiftSectionId,
          appliedResponsibleIdentityId: posShiftTableTransfers.appliedResponsibleIdentityId,
          appliedTabVersion: posShiftTableTransfers.appliedTabVersion,
        })
        .from(posShiftTableTransfers)
        .where(
          and(
            eq(posShiftTableTransfers.organizationId, organizationId),
            eq(posShiftTableTransfers.unitId, unitId),
            isNull(posShiftTableTransfers.endedAt),
            lte(posShiftTableTransfers.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!expired.length) return { restoredTabIds: [], preservedTabIds: [] };
      const outcome = await this.restoreShiftTransferSnapshots(
        tx,
        actorIdentityId,
        organizationId,
        unitId,
        expired,
      );
      const endedAt = new Date();
      await tx
        .update(posShiftTableTransfers)
        .set({ endedAt, endedByIdentityId: actorIdentityId })
        .where(
          inArray(
            posShiftTableTransfers.id,
            expired.map(({ id }) => id),
          ),
        );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId,
        action: "pos.shift_table.transfer_expired",
        entityType: "unit",
        entityId: unitId,
        metadata: { transferIds: expired.map(({ id }) => id), ...outcome },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_table.transfer_expired",
        aggregateType: "unit",
        aggregateId: unitId,
        payload: { organizationId, unitId, ...outcome },
      });
      return outcome;
    });
  }

  private async requireTabOperationalAccess(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabIds: string[],
  ) {
    const roles = await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    const scopedRoles = roles.filter((row) => row.unitId === null || row.unitId === unitId);
    if (scopedRoles.some((row) => ["owner", "manager", "cashier"].includes(row.role))) return;
    const uniqueTabIds = [...new Set(tabIds)];
    const tabs = await this.database.db
      .select({
        id: posTabs.id,
        tableId: posTabs.tableId,
        operationalShiftId: posTabs.operationalShiftId,
        shiftSectionId: posTabs.shiftSectionId,
        responsibleIdentityId: posTabs.responsibleIdentityId,
      })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          inArray(posTabs.id, uniqueTabIds),
        ),
      );
    if (tabs.length !== uniqueTabIds.length) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const activeStaff = await this.database.db
      .select({
        shiftId: posShiftSectionStaff.shiftId,
        shiftSectionId: posShiftSectionStaff.shiftSectionId,
      })
      .from(posShiftSectionStaff)
      .innerJoin(
        posOperationalShifts,
        and(
          eq(posOperationalShifts.organizationId, posShiftSectionStaff.organizationId),
          eq(posOperationalShifts.unitId, posShiftSectionStaff.unitId),
          eq(posOperationalShifts.id, posShiftSectionStaff.shiftId),
        ),
      )
      .where(
        and(
          eq(posShiftSectionStaff.organizationId, organizationId),
          eq(posShiftSectionStaff.unitId, unitId),
          eq(posShiftSectionStaff.identityId, identityId),
          eq(posOperationalShifts.status, "active"),
        ),
      );
    const staffKeys = new Set(activeStaff.map((row) => `${row.shiftId}:${row.shiftSectionId}`));
    const tableIds = tabs.flatMap((tab) => (tab.tableId ? [tab.tableId] : []));
    const coordinatedTableIds = tableIds.length
      ? new Set(
          (
            await this.database.db
              .select({ tableId: posDiningTableGroupMembers.tableId })
              .from(posDiningTableGroupMembers)
              .innerJoin(
                posDiningTableGroups,
                and(
                  eq(
                    posDiningTableGroups.organizationId,
                    posDiningTableGroupMembers.organizationId,
                  ),
                  eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
                  eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
                ),
              )
              .where(
                and(
                  eq(posDiningTableGroupMembers.organizationId, organizationId),
                  eq(posDiningTableGroupMembers.unitId, unitId),
                  inArray(posDiningTableGroupMembers.tableId, tableIds),
                  eq(posDiningTableGroups.responsibleIdentityId, identityId),
                  isNull(posDiningTableGroups.dissolvedAt),
                ),
              )
          ).map(({ tableId }) => tableId),
        )
      : new Set<string>();
    const deniedTabIds = tabs
      .filter(
        (tab) =>
          tab.responsibleIdentityId !== identityId &&
          !(tab.tableId && coordinatedTableIds.has(tab.tableId)) &&
          !(
            tab.operationalShiftId &&
            tab.shiftSectionId &&
            staffKeys.has(`${tab.operationalShiftId}:${tab.shiftSectionId}`)
          ),
      )
      .map(({ id }) => id);
    if (deniedTabIds.length) {
      throw new ForbiddenException({
        code: "TAB_OUTSIDE_OPERATIONAL_ASSIGNMENT",
        tabIds: deniedTabIds,
      });
    }
  }

  private async terminalExecutionProfile(
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    const [profile] = await this.database.db
      .select()
      .from(posTerminalProfiles)
      .where(
        and(
          eq(posTerminalProfiles.organizationId, organizationId),
          eq(posTerminalProfiles.unitId, unitId),
          eq(posTerminalProfiles.installationId, installationId),
        ),
      )
      .limit(1);
    if (!profile) throw new ConflictException({ code: "TERMINAL_PROFILE_REQUIRED" });
    return profile;
  }

  private async canOperateCashier(identityId: string, organizationId: string, unitId: string) {
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      SYSTEM_ROLES,
    );
    return roles.some(
      (row) =>
        (row.unitId === null || row.unitId === unitId) &&
        ["owner", "manager", "cashier"].includes(row.role),
    );
  }

  private async printAccessScope(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      SYSTEM_ROLES,
    );
    const scopedRoles = roles.filter((row) => row.unitId === null || row.unitId === unitId);
    const canManage = scopedRoles.some((row) =>
      hasPermission(row.role as SystemRole, "operations:printing:manage"),
    );
    const canRequest = scopedRoles.some((row) =>
      hasPermission(row.role as SystemRole, "operations:printing:request"),
    );
    const isKds = scopedRoles.some((row) => row.role === "kds");
    if (!canManage && !canRequest) {
      throw new ForbiddenException({ code: "POS_CAPABILITY_DENIED" });
    }
    return { canManage, canRequest, isKds };
  }

  private assertPrintJobAccess(
    access: { canManage: boolean; canRequest: boolean; isKds: boolean },
    requestedByIdentityId: string,
    identityId: string,
    documentType?: string,
  ) {
    if (access.isKds && documentType === "kds_ticket") return;
    if (!access.canManage && (!access.canRequest || requestedByIdentityId !== identityId)) {
      throw new ForbiddenException({ code: "PRINT_JOB_OUTSIDE_REQUESTER_SCOPE" });
    }
  }

  private async lockFloorLayoutRevision(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    expectedRevision: number,
  ) {
    await tx
      .insert(posFloorLayouts)
      .values({ organizationId, unitId, revision: 1, updatedByIdentityId: identityId })
      .onConflictDoNothing({
        target: [posFloorLayouts.organizationId, posFloorLayouts.unitId],
      });
    const [floorLayout] = await tx
      .select()
      .from(posFloorLayouts)
      .where(
        and(eq(posFloorLayouts.organizationId, organizationId), eq(posFloorLayouts.unitId, unitId)),
      )
      .for("update")
      .limit(1);
    if (!floorLayout) throw new Error("Floor layout revision row was not initialized");
    if (floorLayout.revision !== expectedRevision) {
      throw new ConflictException({
        code: "FLOOR_LAYOUT_VERSION_CONFLICT",
        expectedRevision,
        currentRevision: floorLayout.revision,
      });
    }
    return floorLayout;
  }

  private async bumpFloorLayoutRevision(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    currentRevision: number,
  ) {
    const [updatedFloorLayout] = await tx
      .update(posFloorLayouts)
      .set({
        revision: currentRevision + 1,
        updatedByIdentityId: identityId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posFloorLayouts.organizationId, organizationId),
          eq(posFloorLayouts.unitId, unitId),
          eq(posFloorLayouts.revision, currentRevision),
        ),
      )
      .returning();
    if (!updatedFloorLayout) {
      throw new ConflictException({ code: "FLOOR_LAYOUT_VERSION_CONFLICT" });
    }
    return updatedFloorLayout;
  }

  async listFloor(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const roleRows = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      SYSTEM_ROLES,
    );
    await this.reconcileExpiredShiftTableTransfers(identityId, organizationId, unitId);
    const scopedRoles = new Set(
      roleRows
        .filter((row) => row.unitId === null || row.unitId === unitId)
        .map((row) => row.role as SystemRole),
    );
    const canAccessAllTabs = ["owner", "manager", "cashier"].some((role) =>
      scopedRoles.has(role as SystemRole),
    );
    const [
      rooms,
      tables,
      floorLayouts,
      floorElements,
      tabs,
      tableGroups,
      tableGroupMembers,
      serviceCalls,
      staff,
      sections,
      sectionTables,
      activeShifts,
    ] = await Promise.all([
      this.database.db
        .select()
        .from(posDiningRooms)
        .where(
          and(eq(posDiningRooms.organizationId, organizationId), eq(posDiningRooms.unitId, unitId)),
        ),
      this.database.db
        .select()
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posFloorLayouts)
        .where(
          and(
            eq(posFloorLayouts.organizationId, organizationId),
            eq(posFloorLayouts.unitId, unitId),
          ),
        )
        .limit(1),
      this.database.db
        .select()
        .from(posFloorElements)
        .where(
          and(
            eq(posFloorElements.organizationId, organizationId),
            eq(posFloorElements.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "open"),
          ),
        ),
      this.database.db
        .select()
        .from(posDiningTableGroups)
        .where(
          and(
            eq(posDiningTableGroups.organizationId, organizationId),
            eq(posDiningTableGroups.unitId, unitId),
            isNull(posDiningTableGroups.dissolvedAt),
          ),
        ),
      this.database.db
        .select()
        .from(posDiningTableGroupMembers)
        .where(
          and(
            eq(posDiningTableGroupMembers.organizationId, organizationId),
            eq(posDiningTableGroupMembers.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posServiceCalls)
        .where(
          and(
            eq(posServiceCalls.organizationId, organizationId),
            eq(posServiceCalls.unitId, unitId),
            ne(posServiceCalls.status, "resolved"),
          ),
        ),
      this.database.db
        .selectDistinct({ identityId: identities.id, displayName: identities.displayName })
        .from(memberships)
        .innerJoin(identities, eq(identities.id, memberships.identityId))
        .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
            inArray(roleBindings.role, ["owner", "manager", "waiter", "cashier"]),
          ),
        ),
      this.database.db
        .select()
        .from(posServiceSections)
        .where(
          and(
            eq(posServiceSections.organizationId, organizationId),
            eq(posServiceSections.unitId, unitId),
            eq(posServiceSections.active, true),
          ),
        ),
      this.database.db
        .select()
        .from(posServiceSectionTables)
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
          ),
        ),
      this.database.db
        .select()
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .orderBy(desc(posOperationalShifts.startsAt))
        .limit(1),
    ]);
    const activeOrders = tabs.length
      ? await this.database.db
          .select({
            tabId: posOrders.tabId,
            status: posOrders.status,
            updatedAt: posOrders.updatedAt,
          })
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              inArray(
                posOrders.tabId,
                tabs.map((tab) => tab.id),
              ),
              ne(posOrders.status, "canceled"),
            ),
          )
      : [];
    const callPrintJobs = serviceCalls.length
      ? await this.database.db
          .select({
            id: posPrintJobs.id,
            serviceCallId: posPrintJobs.serviceCallId,
            status: posPrintJobs.status,
            requestedByIdentityId: posPrintJobs.requestedByIdentityId,
            lastError: posPrintJobs.lastError,
            createdAt: posPrintJobs.createdAt,
          })
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              inArray(
                posPrintJobs.serviceCallId,
                serviceCalls.map(({ id }) => id),
              ),
            ),
          )
          .orderBy(desc(posPrintJobs.createdAt))
      : [];
    const tablePhases = tabs.flatMap((tab) => {
      if (!tab.tableId) return [];
      const orders = activeOrders.filter((order) => order.tabId === tab.id);
      const phase =
        orders.length === 0
          ? "awaiting_order"
          : orders.every((order) => order.status === "served")
            ? "served"
            : orders.some((order) => order.status === "ready")
              ? "ready"
              : orders.some((order) => order.status === "sent" || order.status === "preparing")
                ? "production"
                : "awaiting_order";
      return [
        {
          tableId: tab.tableId,
          tabId: tab.id,
          phase,
          since:
            orders.reduce<Date | null>(
              (latest, order) => (!latest || order.updatedAt > latest ? order.updatedAt : latest),
              null,
            ) ?? tab.createdAt,
        },
      ];
    });
    const activeShift = activeShifts[0] ?? null;
    const [
      shiftSections,
      shiftSectionTables,
      shiftSectionStaff,
      shiftTableLayouts,
      shiftTableTransfers,
    ] = activeShift
      ? await Promise.all([
          this.database.db
            .select()
            .from(posShiftSections)
            .where(
              and(
                eq(posShiftSections.organizationId, organizationId),
                eq(posShiftSections.unitId, unitId),
                eq(posShiftSections.shiftId, activeShift.id),
              ),
            ),
          this.database.db
            .select()
            .from(posShiftSectionTables)
            .where(
              and(
                eq(posShiftSectionTables.organizationId, organizationId),
                eq(posShiftSectionTables.unitId, unitId),
                eq(posShiftSectionTables.shiftId, activeShift.id),
              ),
            ),
          this.database.db
            .select()
            .from(posShiftSectionStaff)
            .where(
              and(
                eq(posShiftSectionStaff.organizationId, organizationId),
                eq(posShiftSectionStaff.unitId, unitId),
                eq(posShiftSectionStaff.shiftId, activeShift.id),
              ),
            ),
          this.database.db
            .select()
            .from(posShiftTableLayouts)
            .where(
              and(
                eq(posShiftTableLayouts.organizationId, organizationId),
                eq(posShiftTableLayouts.unitId, unitId),
                eq(posShiftTableLayouts.shiftId, activeShift.id),
              ),
            ),
          this.database.db
            .select()
            .from(posShiftTableTransfers)
            .where(
              and(
                eq(posShiftTableTransfers.organizationId, organizationId),
                eq(posShiftTableTransfers.unitId, unitId),
                eq(posShiftTableTransfers.shiftId, activeShift.id),
                isNull(posShiftTableTransfers.endedAt),
              ),
            ),
        ])
      : [[], [], [], [], []];
    const assignedShiftSectionIds = new Set(
      shiftSectionStaff
        .filter((assignment) => assignment.identityId === identityId)
        .map((assignment) => assignment.shiftSectionId),
    );
    const coordinatedGroupIds = new Set(
      tableGroups
        .filter((group) => group.responsibleIdentityId === identityId)
        .map((group) => group.id),
    );
    const coordinatedTableIds = new Set(
      tableGroupMembers
        .filter((member) => coordinatedGroupIds.has(member.groupId))
        .map((member) => member.tableId),
    );
    const fullTabIds = new Set(
      tabs
        .filter(
          (tab) =>
            canAccessAllTabs ||
            tab.responsibleIdentityId === identityId ||
            (tab.tableId !== null && coordinatedTableIds.has(tab.tableId)) ||
            (tab.shiftSectionId !== null && assignedShiftSectionIds.has(tab.shiftSectionId)),
        )
        .map((tab) => tab.id),
    );
    const visibleTabs = tabs.filter((tab) => fullTabIds.has(tab.id));
    const visibleTabIds = visibleTabs.map((tab) => tab.id);
    const [tabPaymentTotals, tabReversalTotals, activePaymentAttempts, tabLossTotals] =
      visibleTabIds.length
        ? await Promise.all([
            this.database.db
              .select({
                tabId: posTabPayments.tabId,
                paidCents: sql<number>`coalesce(sum(${posTabPayments.amountCents}), 0)`,
              })
              .from(posTabPayments)
              .where(
                and(
                  eq(posTabPayments.organizationId, organizationId),
                  eq(posTabPayments.unitId, unitId),
                  inArray(posTabPayments.tabId, visibleTabIds),
                ),
              )
              .groupBy(posTabPayments.tabId),
            this.database.db
              .select({
                tabId: posTabPayments.tabId,
                reversedCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`,
              })
              .from(posPaymentReversals)
              .innerJoin(posTabPayments, eq(posTabPayments.id, posPaymentReversals.paymentId))
              .where(
                and(
                  eq(posPaymentReversals.organizationId, organizationId),
                  eq(posPaymentReversals.unitId, unitId),
                  eq(posPaymentReversals.status, "approved"),
                  inArray(posTabPayments.tabId, visibleTabIds),
                ),
              )
              .groupBy(posTabPayments.tabId),
            this.database.db
              .select({ tabId: posPaymentAttempts.tabId })
              .from(posPaymentAttempts)
              .where(
                and(
                  eq(posPaymentAttempts.organizationId, organizationId),
                  eq(posPaymentAttempts.unitId, unitId),
                  inArray(posPaymentAttempts.tabId, visibleTabIds),
                  or(
                    inArray(posPaymentAttempts.status, ["processing", "unknown"]),
                    and(
                      eq(posPaymentAttempts.status, "created"),
                      gt(posPaymentAttempts.expiresAt, new Date()),
                    ),
                  ),
                ),
              )
              .groupBy(posPaymentAttempts.tabId),
            this.database.db
              .select({
                tabId: managementOperationalLosses.tabId,
                coveredLossCents: sql<number>`coalesce(sum(${managementOperationalLosses.amountCents}), 0)`,
              })
              .from(managementOperationalLosses)
              .where(
                and(
                  eq(managementOperationalLosses.organizationId, organizationId),
                  eq(managementOperationalLosses.unitId, unitId),
                  inArray(managementOperationalLosses.tabId, visibleTabIds),
                  eq(managementOperationalLosses.status, "approved"),
                  eq(managementOperationalLosses.type, "unpaid_tab"),
                ),
              )
              .groupBy(managementOperationalLosses.tabId),
          ])
        : [[], [], [], []];
    const paidByTabId = new Map(tabPaymentTotals.map((row) => [row.tabId, Number(row.paidCents)]));
    const reversedByTabId = new Map(
      tabReversalTotals.map((row) => [row.tabId, Number(row.reversedCents)]),
    );
    const activeAttemptTabIds = new Set(activePaymentAttempts.map((row) => row.tabId));
    const lossByTabId = new Map(
      tabLossTotals.map((row) => [row.tabId, Number(row.coveredLossCents)]),
    );
    const visibleTabsWithMergePolicy = visibleTabs.map((tab) => {
      const paidCents = (paidByTabId.get(tab.id) ?? 0) - (reversedByTabId.get(tab.id) ?? 0);
      const blockedReason = activeAttemptTabIds.has(tab.id)
        ? ("active_payment_attempt" as const)
        : paidCents > 0
          ? ("payment_recorded" as const)
          : (lossByTabId.get(tab.id) ?? 0) > 0
            ? ("covered_loss" as const)
            : null;
      return {
        ...tab,
        structuralMergeAllowed: blockedReason === null,
        structuralMergeBlockedReason: blockedReason,
      };
    });
    const openTabByTableId = new Map(
      tabs.flatMap((tab) => (tab.tableId ? [[tab.tableId, tab] as const] : [])),
    );
    const staffNameByIdentityId = new Map(
      staff.map(({ identityId: staffIdentityId, displayName }) => [staffIdentityId, displayName]),
    );
    const elevatedFloorAccess = scopedRoles.has("owner") || scopedRoles.has("manager");
    const cashierFloorAccess = scopedRoles.has("cashier");
    const canManagePrint = [...scopedRoles].some((role) =>
      hasPermission(role, "operations:printing:manage"),
    );
    return {
      rooms: rooms.map(({ legacyResponsibleIdentityId: _legacy, ...room }) => room),
      floorRevision: floorLayouts[0]?.revision ?? 1,
      layoutElements: floorElements.map(
        ({ layoutX, layoutY, layoutWidth, layoutHeight, layoutRotation, ...element }) => ({
          ...element,
          x: layoutX,
          y: layoutY,
          width: layoutWidth,
          height: layoutHeight,
          rotation: layoutRotation,
        }),
      ),
      tables: tables.map((table) => ({
        ...table,
        openedAt: openTabByTableId.get(table.id)?.createdAt ?? null,
        responsibleDisplayName: openTabByTableId.get(table.id)?.responsibleIdentityId
          ? (staffNameByIdentityId.get(
              openTabByTableId.get(table.id)?.responsibleIdentityId as string,
            ) ?? null)
          : null,
        accessLevel: elevatedFloorAccess
          ? ("manage" as const)
          : cashierFloorAccess
            ? ("financial" as const)
            : openTabByTableId.get(table.id) &&
                fullTabIds.has(openTabByTableId.get(table.id)?.id as string)
              ? ("operate" as const)
              : ("overview" as const),
      })),
      openTabs: visibleTabsWithMergePolicy,
      tableGroups: tableGroups.map((group) => ({
        ...group,
        primaryTabId:
          group.primaryTabId && fullTabIds.has(group.primaryTabId) ? group.primaryTabId : null,
      })),
      tableGroupMembers,
      serviceCalls: serviceCalls.map((call) => {
        const printJob = callPrintJobs.find((candidate) => candidate.serviceCallId === call.id);
        const canReadPrintJob =
          canManagePrint ||
          Boolean(call.tabId && fullTabIds.has(call.tabId)) ||
          printJob?.requestedByIdentityId === identityId;
        return {
          ...call,
          tabId: call.tabId && fullTabIds.has(call.tabId) ? call.tabId : null,
          printStatus: printJob?.status ?? null,
          printJobId: printJob && canReadPrintJob ? printJob.id : null,
          printLastErrorCode:
            printJob && canReadPrintJob && printJob.lastError
              ? printJob.lastError === "PRINTER_RESULT_UNKNOWN"
                ? "PRINTER_RESULT_UNKNOWN"
                : "PRINT_FAILED"
              : null,
        };
      }),
      tablePhases: tablePhases.map((phase) => ({
        ...phase,
        tabId: fullTabIds.has(phase.tabId) ? phase.tabId : null,
      })),
      staff,
      serviceSections: sections,
      serviceSectionTables: sectionTables,
      activeShift,
      shiftSections,
      shiftSectionTables,
      shiftSectionStaff,
      shiftTableLayouts: shiftTableLayouts.map(
        ({ layoutX, layoutY, layoutRotation, ...layout }) => ({
          ...layout,
          x: layoutX,
          y: layoutY,
          rotation: layoutRotation,
        }),
      ),
      shiftRevision: activeShift?.assignmentRevision ?? null,
      shiftTableTransfers: shiftTableTransfers.map((transfer) => ({
        ...transfer,
        tabId: transfer.tabId && fullTabIds.has(transfer.tabId) ? transfer.tabId : null,
        expired: transfer.expiresAt <= new Date(),
        confirmationRequired:
          transfer.expiresAt <= new Date() && transfer.tabId !== null ? "restore_transfer" : null,
      })),
      capabilities: {
        canManageFloor: [...scopedRoles].some((role) =>
          hasPermission(role, "operations:floor:manage"),
        ),
        canManageShift: [...scopedRoles].some((role) =>
          hasPermission(role, "operations:shift:manage"),
        ),
        canReorganizeTables: [...scopedRoles].some((role) =>
          hasPermission(role, "operations:tables:reorganize"),
        ),
        canRequestPrint: [...scopedRoles].some((role) =>
          hasPermission(role, "operations:printing:request"),
        ),
        canManagePrint,
        canAccessAllTabs,
      },
      serviceMode: activeShift?.serviceMode ?? "hybrid",
    };
  }

  async tableQrPresence(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [settings, unit] = await Promise.all([
      this.database.db
        .select({ presenceProtection: posTableQrSettings.presenceProtection })
        .from(posTableQrSettings)
        .where(
          and(
            eq(posTableQrSettings.organizationId, organizationId),
            eq(posTableQrSettings.unitId, unitId),
          ),
        )
        .limit(1),
      this.database.db
        .select({ timezone: units.timezone })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1),
    ]);
    if (!unit[0]) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const mode = settings[0]?.presenceProtection === "daily_code" ? "daily_code" : "session_only";
    return {
      mode,
      code:
        mode === "daily_code"
          ? tablePresenceCode(tableAccessSecret(), organizationId, unitId, unit[0].timezone)
          : null,
    };
  }

  async updateFloorLayout(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: FloorLayoutInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    const tableIds = input.tables.map((table) => table.tableId);
    const requestedRoomIds = [
      ...new Set([
        ...input.rooms.map((room) => room.roomId),
        ...input.tables.map((table) => table.roomId),
        ...(input.layoutElements?.map((element) => element.roomId) ?? []),
      ]),
    ];
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        input.expectedRevision,
      );
      const scopedTables = tableIds.length
        ? await tx
            .select({
              id: posDiningTables.id,
              roomId: posDiningTables.roomId,
              label: posDiningTables.label,
              status: posDiningTables.status,
              layoutX: posDiningTables.layoutX,
              layoutY: posDiningTables.layoutY,
              layoutWidth: posDiningTables.layoutWidth,
              layoutHeight: posDiningTables.layoutHeight,
              layoutRotation: posDiningTables.layoutRotation,
            })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.active, true),
                inArray(posDiningTables.id, tableIds),
              ),
            )
        : [];
      if (scopedTables.length !== tableIds.length) {
        throw new NotFoundException({
          code: "FLOOR_LAYOUT_TABLE_NOT_FOUND",
          message: "Uma ou mais mesas não pertencem a esta unidade ou estão inativas.",
        });
      }
      const inputTableById = new Map(input.tables.map((table) => [table.tableId, table]));
      const blockedMove = scopedTables.find((table) => {
        const next = inputTableById.get(table.id);
        return (
          next && next.roomId !== table.roomId && ["occupied", "reserved"].includes(table.status)
        );
      });
      if (blockedMove) {
        throw new ConflictException({
          code: "ACTIVE_TABLE_CANNOT_CHANGE_ROOM",
          tableId: blockedMove.id,
        });
      }
      const roomIds = [
        ...new Set([...requestedRoomIds, ...scopedTables.map((table) => table.roomId)]),
      ];
      const scopedRooms = roomIds.length
        ? await tx
            .select({ id: posDiningRooms.id, layoutPolygon: posDiningRooms.layoutPolygon })
            .from(posDiningRooms)
            .where(
              and(
                eq(posDiningRooms.organizationId, organizationId),
                eq(posDiningRooms.unitId, unitId),
                eq(posDiningRooms.active, true),
                inArray(posDiningRooms.id, roomIds),
              ),
            )
        : [];
      if (scopedRooms.length !== roomIds.length) {
        throw new NotFoundException({
          code: "FLOOR_LAYOUT_ROOM_NOT_FOUND",
          message: "Um ou mais ambientes não pertencem a esta unidade ou estão inativos.",
        });
      }
      const storedFloorElements = await tx
        .select()
        .from(posFloorElements)
        .where(
          and(
            eq(posFloorElements.organizationId, organizationId),
            eq(posFloorElements.unitId, unitId),
          ),
        );
      const floorElementsForValidation =
        input.layoutElements ??
        storedFloorElements.map((element) => ({
          id: element.id,
          roomId: element.roomId,
          kind: element.kind as "label" | "barrier",
          label: element.label ?? undefined,
          x: element.layoutX,
          y: element.layoutY,
          width: element.layoutWidth,
          height: element.layoutHeight,
          rotation: element.layoutRotation,
        }));
      const roomTables =
        roomIds.length || tableIds.length
          ? await tx
              .select({
                id: posDiningTables.id,
                roomId: posDiningTables.roomId,
                label: posDiningTables.label,
                layoutX: posDiningTables.layoutX,
                layoutY: posDiningTables.layoutY,
                layoutWidth: posDiningTables.layoutWidth,
                layoutHeight: posDiningTables.layoutHeight,
                layoutRotation: posDiningTables.layoutRotation,
              })
              .from(posDiningTables)
              .where(
                and(
                  eq(posDiningTables.organizationId, organizationId),
                  eq(posDiningTables.unitId, unitId),
                  eq(posDiningTables.active, true),
                  or(
                    ...(roomIds.length ? [inArray(posDiningTables.roomId, roomIds)] : []),
                    ...(tableIds.length ? [inArray(posDiningTables.id, tableIds)] : []),
                  ),
                ),
              )
          : [];
      const nextTablePositions = new Map(
        input.tables.map((table) => [
          table.tableId,
          {
            roomId: table.roomId,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
          },
        ]),
      );
      const inputRoomById = new Map(input.rooms.map((room) => [room.roomId, room.points]));
      const validationRooms = scopedRooms.map((room) => ({
        roomId: room.id,
        points: inputRoomById.get(room.id) ?? room.layoutPolygon ?? [],
      }));
      for (const room of validationRooms) {
        if (room.points.length < 3) {
          throw new BadRequestException({
            code: "FLOOR_LAYOUT_ROOM_GEOMETRY_REQUIRED",
            roomId: room.roomId,
          });
        }
        const occupied: Array<{
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
        }> = [];
        const barriers = floorElementsForValidation
          .filter((element) => element.roomId === room.roomId && element.kind === "barrier")
          .map((element) => ({
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            rotation: element.rotation,
          }));
        const invalid = roomTables.find((table) => {
          const nextPosition = nextTablePositions.get(table.id);
          if ((nextPosition?.roomId ?? table.roomId) !== room.roomId) return false;
          const placement =
            nextPosition ??
            (table.layoutX !== null && table.layoutY !== null
              ? {
                  x: table.layoutX,
                  y: table.layoutY,
                  width: table.layoutWidth,
                  height: table.layoutHeight,
                  rotation: table.layoutRotation,
                }
              : null);
          if (!placement) return false;
          const conflicts = floorPlacementConflicts(placement, room.points, occupied, barriers);
          occupied.push(placement);
          return conflicts.outsideRoom || conflicts.overlapsObject || conflicts.overlapsBarrier;
        });
        if (invalid) {
          throw new BadRequestException({
            code: "FLOOR_LAYOUT_GEOMETRY_CONFLICT",
            message: "Uma mesa ficou fora do ambiente ou sobreposta a outra mesa/barreira.",
            tableId: invalid.id,
          });
        }
        const outsideElement = floorElementsForValidation.find(
          (element) =>
            element.roomId === room.roomId &&
            floorPlacementConflicts(
              {
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
                rotation: element.rotation,
              },
              room.points,
              [],
              [],
            ).outsideRoom,
        );
        if (outsideElement) {
          throw new BadRequestException({
            code: "FLOOR_LAYOUT_ELEMENT_OUTSIDE_ROOM",
            elementId: outsideElement.id ?? null,
            roomId: room.roomId,
          });
        }
      }
      const finalLabels = new Map<string, string>();
      for (const table of roomTables) {
        const next = inputTableById.get(table.id);
        const key = `${next?.roomId ?? table.roomId}:${(next?.label ?? table.label).toLocaleLowerCase("pt-BR")}`;
        const conflictingTableId = finalLabels.get(key);
        if (conflictingTableId && conflictingTableId !== table.id) {
          throw new ConflictException({
            code: "TABLE_LABEL_CONFLICT",
            tableIds: [conflictingTableId, table.id],
          });
        }
        finalLabels.set(key, table.id);
      }
      if (input.tables.length) {
        for (const table of input.tables) {
          await tx
            .update(posDiningTables)
            .set({ label: `__layout_${table.tableId}`, updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, table.tableId),
              ),
            );
        }
      }
      for (const table of input.tables) {
        await tx
          .update(posDiningTables)
          .set({
            roomId: table.roomId,
            label: table.label,
            seats: table.seats,
            layoutX: table.x,
            layoutY: table.y,
            layoutWidth: table.width,
            layoutHeight: table.height,
            layoutRotation: table.rotation,
            layoutShape: table.shape,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, table.tableId),
            ),
          );
      }
      for (const room of input.rooms) {
        await tx
          .update(posDiningRooms)
          .set({ layoutPolygon: room.points, updatedAt: new Date() })
          .where(
            and(
              eq(posDiningRooms.organizationId, organizationId),
              eq(posDiningRooms.unitId, unitId),
              eq(posDiningRooms.id, room.roomId),
            ),
          );
      }
      let elements = storedFloorElements;
      if (input.layoutElements) {
        await tx
          .delete(posFloorElements)
          .where(
            and(
              eq(posFloorElements.organizationId, organizationId),
              eq(posFloorElements.unitId, unitId),
            ),
          );
        elements = input.layoutElements.length
          ? await tx
              .insert(posFloorElements)
              .values(
                input.layoutElements.map((element) => ({
                  ...(element.id ? { id: element.id } : {}),
                  organizationId,
                  unitId,
                  roomId: element.roomId,
                  kind: element.kind,
                  label: element.label,
                  layoutX: element.x,
                  layoutY: element.y,
                  layoutWidth: element.width,
                  layoutHeight: element.height,
                  layoutRotation: element.rotation,
                })),
              )
              .returning()
          : [];
      }
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.floor_layout.updated",
        entityType: "unit",
        entityId: unitId,
        metadata: {
          tableIds,
          roomIds,
          elementIds: elements.map((element) => element.id),
          revision: updatedFloorLayout.revision,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.floor_layout.updated",
        aggregateType: "unit",
        aggregateId: unitId,
        payload: {
          organizationId,
          unitId,
          revision: updatedFloorLayout.revision,
          tableIds,
          roomIds,
          elementIds: elements.map((element) => element.id),
        },
      });
      return {
        revision: updatedFloorLayout.revision,
        tables: input.tables,
        rooms: input.rooms,
        layoutElements: elements.map(
          ({ layoutX, layoutY, layoutWidth, layoutHeight, layoutRotation, ...element }) => ({
            ...element,
            x: layoutX,
            y: layoutY,
            width: layoutWidth,
            height: layoutHeight,
            rotation: layoutRotation,
          }),
        ),
      };
    });
  }

  async updateShiftLayout(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    input: ShiftLayoutInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:shift:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const [shift] = await tx
        .select({
          id: posOperationalShifts.id,
          assignmentRevision: posOperationalShifts.assignmentRevision,
        })
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!shift) throw new NotFoundException({ code: "ACTIVE_SHIFT_NOT_FOUND" });
      if (input.expectedRevision !== shift.assignmentRevision) {
        throw new ConflictException({
          code: "SHIFT_LAYOUT_VERSION_CONFLICT",
          expectedRevision: input.expectedRevision,
          currentRevision: shift.assignmentRevision,
        });
      }
      const tableIds = input.tables.map((table) => table.tableId);
      const roomIds = [...new Set(input.tables.map((table) => table.roomId))];
      const [tables, rooms] = await Promise.all([
        tx
          .select({
            id: posDiningTables.id,
            roomId: posDiningTables.roomId,
            x: posDiningTables.layoutX,
            y: posDiningTables.layoutY,
            width: posDiningTables.layoutWidth,
            height: posDiningTables.layoutHeight,
            rotation: posDiningTables.layoutRotation,
          })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.active, true),
              inArray(posDiningTables.id, tableIds),
            ),
          ),
        tx
          .select({ id: posDiningRooms.id, polygon: posDiningRooms.layoutPolygon })
          .from(posDiningRooms)
          .where(
            and(
              eq(posDiningRooms.organizationId, organizationId),
              eq(posDiningRooms.unitId, unitId),
              eq(posDiningRooms.active, true),
              inArray(posDiningRooms.id, roomIds),
            ),
          ),
      ]);
      if (tables.length !== tableIds.length || rooms.length !== roomIds.length) {
        throw new NotFoundException({ code: "SHIFT_LAYOUT_ENTITY_NOT_FOUND" });
      }
      const roomById = new Map(rooms.map((room) => [room.id, room]));
      const [barriers, permanentRoomTables] = await Promise.all([
        tx
          .select()
          .from(posFloorElements)
          .where(
            and(
              eq(posFloorElements.organizationId, organizationId),
              eq(posFloorElements.unitId, unitId),
              eq(posFloorElements.kind, "barrier"),
              inArray(posFloorElements.roomId, roomIds),
            ),
          ),
        tx
          .select({
            id: posDiningTables.id,
            roomId: posDiningTables.roomId,
            x: posDiningTables.layoutX,
            y: posDiningTables.layoutY,
            width: posDiningTables.layoutWidth,
            height: posDiningTables.layoutHeight,
            rotation: posDiningTables.layoutRotation,
          })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.active, true),
              inArray(posDiningTables.roomId, roomIds),
            ),
          ),
      ]);
      const movedTableIds = new Set(tableIds);
      for (const roomId of roomIds) {
        const polygon = roomById.get(roomId)?.polygon;
        if (!polygon || polygon.length < 3) {
          throw new BadRequestException({ code: "SHIFT_LAYOUT_ROOM_GEOMETRY_REQUIRED", roomId });
        }
        const occupied = permanentRoomTables
          .filter(
            (table) =>
              table.roomId === roomId &&
              !movedTableIds.has(table.id) &&
              table.x !== null &&
              table.y !== null,
          )
          .map((table) => ({
            x: table.x as number,
            y: table.y as number,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
          }));
        for (const layout of input.tables.filter((table) => table.roomId === roomId)) {
          const table = tables.find((candidate) => candidate.id === layout.tableId);
          if (!table) continue;
          const placement = {
            x: layout.x,
            y: layout.y,
            width: table.width,
            height: table.height,
            rotation: layout.rotation,
          };
          const conflicts = floorPlacementConflicts(
            placement,
            polygon,
            occupied,
            barriers
              .filter((barrier) => barrier.roomId === roomId)
              .map((barrier) => ({
                x: barrier.layoutX,
                y: barrier.layoutY,
                width: barrier.layoutWidth,
                height: barrier.layoutHeight,
                rotation: barrier.layoutRotation,
              })),
          );
          if (conflicts.outsideRoom || conflicts.overlapsObject || conflicts.overlapsBarrier) {
            throw new BadRequestException({
              code: "SHIFT_LAYOUT_GEOMETRY_CONFLICT",
              tableId: layout.tableId,
            });
          }
          occupied.push(placement);
        }
      }
      await tx
        .delete(posShiftTableLayouts)
        .where(
          and(
            eq(posShiftTableLayouts.organizationId, organizationId),
            eq(posShiftTableLayouts.unitId, unitId),
            eq(posShiftTableLayouts.shiftId, shiftId),
          ),
        );
      await tx.insert(posShiftTableLayouts).values(
        input.tables.map((table) => ({
          organizationId,
          unitId,
          shiftId,
          tableId: table.tableId,
          roomId: table.roomId,
          layoutX: table.x,
          layoutY: table.y,
          layoutRotation: table.rotation,
          movedByIdentityId: identityId,
        })),
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.shift_layout.updated",
        entityType: "operational_shift",
        entityId: shiftId,
        metadata: { tableCount: input.tables.length, revision: shift.assignmentRevision + 1 },
      });
      const [updatedShift] = await tx
        .update(posOperationalShifts)
        .set({ assignmentRevision: shift.assignmentRevision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.assignmentRevision, shift.assignmentRevision),
          ),
        )
        .returning({ assignmentRevision: posOperationalShifts.assignmentRevision });
      if (!updatedShift) throw new ConflictException({ code: "SHIFT_LAYOUT_VERSION_CONFLICT" });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_layout.updated",
        aggregateType: "operational_shift",
        aggregateId: shiftId,
        payload: {
          organizationId,
          unitId,
          shiftId,
          revision: updatedShift.assignmentRevision,
          tableIds,
        },
      });
      return {
        shiftId,
        shiftRevision: updatedShift.assignmentRevision,
        tables: input.tables,
      };
    });
  }

  async createRoom(identityId: string, organizationId: string, unitId: string, input: RoomInput) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        input.expectedRevision,
      );
      const roomInput = { name: input.name, sortOrder: input.sortOrder };
      const [room] = await tx
        .insert(posDiningRooms)
        .values({ organizationId, unitId, ...roomInput })
        .returning();
      if (!room) throw new Error("Room insert did not return a row");
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.room.created",
        entityType: "dining_room",
        entityId: room.id,
        metadata: { ...roomInput, revision: updatedFloorLayout.revision },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.room.created",
        aggregateType: "dining_room",
        aggregateId: room.id,
        payload: {
          organizationId,
          unitId,
          roomId: room.id,
          revision: updatedFloorLayout.revision,
        },
      });
      return { ...room, floorRevision: updatedFloorLayout.revision };
    });
  }

  async updateRoom(
    identityId: string,
    organizationId: string,
    unitId: string,
    roomId: string,
    input: RoomInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        input.expectedRevision,
      );
      const roomInput = { name: input.name, sortOrder: input.sortOrder };
      const [room] = await tx
        .update(posDiningRooms)
        .set({ ...roomInput, updatedAt: new Date() })
        .where(
          and(
            eq(posDiningRooms.organizationId, organizationId),
            eq(posDiningRooms.unitId, unitId),
            eq(posDiningRooms.id, roomId),
            eq(posDiningRooms.active, true),
          ),
        )
        .returning();
      if (!room) throw new NotFoundException({ code: "ROOM_NOT_FOUND" });
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.room.updated",
        entityType: "dining_room",
        entityId: roomId,
        metadata: { ...roomInput, revision: updatedFloorLayout.revision },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.room.updated",
        aggregateType: "dining_room",
        aggregateId: roomId,
        payload: { organizationId, unitId, roomId, revision: updatedFloorLayout.revision },
      });
      return { ...room, floorRevision: updatedFloorLayout.revision };
    });
  }

  async archiveRoom(
    identityId: string,
    organizationId: string,
    unitId: string,
    roomId: string,
    expectedRevision: number,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        expectedRevision,
      );
      const activeTables = await tx
        .select({ id: posDiningTables.id, status: posDiningTables.status })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.roomId, roomId),
            eq(posDiningTables.active, true),
          ),
        )
        .for("update");
      if (activeTables.length) {
        throw new ConflictException({
          code: "ROOM_HAS_ACTIVE_TABLES",
          tableIds: activeTables.map(({ id }) => id),
        });
      }
      const [room] = await tx
        .update(posDiningRooms)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(posDiningRooms.organizationId, organizationId),
            eq(posDiningRooms.unitId, unitId),
            eq(posDiningRooms.id, roomId),
            eq(posDiningRooms.active, true),
          ),
        )
        .returning();
      if (!room) throw new NotFoundException({ code: "ROOM_NOT_FOUND" });
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.room.archived",
        entityType: "dining_room",
        entityId: roomId,
        metadata: { revision: updatedFloorLayout.revision },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.room.archived",
        aggregateType: "dining_room",
        aggregateId: roomId,
        payload: { organizationId, unitId, roomId, revision: updatedFloorLayout.revision },
      });
      return { roomId, archived: true, floorRevision: updatedFloorLayout.revision };
    });
  }

  async createServiceSection(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ServiceSectionInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    if (input.defaultResponsibleIdentityId) {
      await this.requireOperationalIdentity(
        organizationId,
        unitId,
        input.defaultResponsibleIdentityId,
      );
    }
    return this.database.db.transaction(async (tx) => {
      const tables = await tx
        .select({ id: posDiningTables.id })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.active, true),
            inArray(posDiningTables.id, input.tableIds),
          ),
        );
      if (tables.length !== input.tableIds.length) {
        throw new NotFoundException({
          code: "SERVICE_SECTION_TABLE_NOT_FOUND",
          message: "Uma ou mais mesas não pertencem a esta unidade ou estão inativas.",
        });
      }
      const assigned = await tx
        .select({ tableId: posServiceSectionTables.tableId })
        .from(posServiceSectionTables)
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
            inArray(posServiceSectionTables.tableId, input.tableIds),
          ),
        );
      if (assigned.length) {
        throw new ConflictException({
          code: "SERVICE_SECTION_TABLE_ALREADY_ASSIGNED",
          message: "Uma ou mais mesas já pertencem a outro modelo de praça.",
          tableIds: assigned.map((row) => row.tableId),
        });
      }
      const [section] = await tx
        .insert(posServiceSections)
        .values({
          organizationId,
          unitId,
          name: input.name,
          color: input.color.toUpperCase(),
          serviceMode: input.serviceMode,
          defaultResponsibleIdentityId: input.defaultResponsibleIdentityId ?? null,
        })
        .returning();
      if (!section) throw new Error("Service section insert did not return a row");
      await tx.insert(posServiceSectionTables).values(
        input.tableIds.map((tableId) => ({
          organizationId,
          unitId,
          sectionId: section.id,
          tableId,
        })),
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.service_section.created",
        entityType: "service_section",
        entityId: section.id,
        metadata: { tableIds: input.tableIds, serviceMode: input.serviceMode },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.service_section.created",
        aggregateType: "service_section",
        aggregateId: section.id,
        payload: { organizationId, unitId, sectionId: section.id },
      });
      return { section, tableIds: input.tableIds };
    });
  }

  async updateServiceSection(
    identityId: string,
    organizationId: string,
    unitId: string,
    serviceSectionId: string,
    input: ServiceSectionInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    if (input.defaultResponsibleIdentityId) {
      await this.requireOperationalIdentity(
        organizationId,
        unitId,
        input.defaultResponsibleIdentityId,
      );
    }
    return this.database.db.transaction(async (tx) => {
      const [section] = await tx
        .select({ id: posServiceSections.id })
        .from(posServiceSections)
        .where(
          and(
            eq(posServiceSections.organizationId, organizationId),
            eq(posServiceSections.unitId, unitId),
            eq(posServiceSections.id, serviceSectionId),
            eq(posServiceSections.active, true),
          ),
        )
        .for("update")
        .limit(1);
      if (!section) throw new NotFoundException({ code: "SERVICE_SECTION_NOT_FOUND" });

      const tables = await tx
        .select({ id: posDiningTables.id })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.active, true),
            inArray(posDiningTables.id, input.tableIds),
          ),
        );
      if (tables.length !== input.tableIds.length) {
        throw new NotFoundException({
          code: "SERVICE_SECTION_TABLE_NOT_FOUND",
          message: "Uma ou mais mesas não pertencem a esta unidade ou estão inativas.",
        });
      }
      const assigned = await tx
        .select({ tableId: posServiceSectionTables.tableId })
        .from(posServiceSectionTables)
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
            ne(posServiceSectionTables.sectionId, serviceSectionId),
            inArray(posServiceSectionTables.tableId, input.tableIds),
          ),
        );
      if (assigned.length) {
        throw new ConflictException({
          code: "SERVICE_SECTION_TABLE_ALREADY_ASSIGNED",
          message: "Uma ou mais mesas já pertencem a outro modelo de praça.",
          tableIds: assigned.map((row) => row.tableId),
        });
      }

      const [updated] = await tx
        .update(posServiceSections)
        .set({
          name: input.name,
          color: input.color.toUpperCase(),
          serviceMode: input.serviceMode,
          defaultResponsibleIdentityId: input.defaultResponsibleIdentityId ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posServiceSections.organizationId, organizationId),
            eq(posServiceSections.unitId, unitId),
            eq(posServiceSections.id, serviceSectionId),
            eq(posServiceSections.active, true),
          ),
        )
        .returning();
      if (!updated) throw new NotFoundException({ code: "SERVICE_SECTION_NOT_FOUND" });
      await tx
        .delete(posServiceSectionTables)
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
            eq(posServiceSectionTables.sectionId, serviceSectionId),
          ),
        );
      await tx.insert(posServiceSectionTables).values(
        input.tableIds.map((tableId) => ({
          organizationId,
          unitId,
          sectionId: serviceSectionId,
          tableId,
        })),
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.service_section.updated",
        entityType: "service_section",
        entityId: serviceSectionId,
        metadata: { tableIds: input.tableIds, serviceMode: input.serviceMode },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.service_section.updated",
        aggregateType: "service_section",
        aggregateId: serviceSectionId,
        payload: { organizationId, unitId, sectionId: serviceSectionId },
      });
      return { section: updated, tableIds: input.tableIds };
    });
  }

  async archiveServiceSection(
    identityId: string,
    organizationId: string,
    unitId: string,
    serviceSectionId: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.database.db.transaction(async (tx) => {
      const [section] = await tx
        .update(posServiceSections)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(posServiceSections.organizationId, organizationId),
            eq(posServiceSections.unitId, unitId),
            eq(posServiceSections.id, serviceSectionId),
            eq(posServiceSections.active, true),
          ),
        )
        .returning({ id: posServiceSections.id });
      if (!section) throw new NotFoundException({ code: "SERVICE_SECTION_NOT_FOUND" });
      await tx
        .delete(posServiceSectionTables)
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
            eq(posServiceSectionTables.sectionId, serviceSectionId),
          ),
        );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.service_section.archived",
        entityType: "service_section",
        entityId: serviceSectionId,
        metadata: {},
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.service_section.archived",
        aggregateType: "service_section",
        aggregateId: serviceSectionId,
        payload: { organizationId, unitId, sectionId: serviceSectionId },
      });
      return { serviceSectionId, archived: true };
    });
  }

  async openOperationalShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: OpenOperationalShiftInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    await this.requireOperationalBilling(organizationId);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-shift:${organizationId}:${unitId}`}))`,
      );
      const [active] = await tx
        .select({ id: posOperationalShifts.id })
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1);
      if (active) {
        throw new ConflictException({
          code: "OPERATIONAL_SHIFT_ALREADY_ACTIVE",
          message: "Já existe um turno operacional ativo nesta unidade.",
          shiftId: active.id,
        });
      }
      const templates = await tx
        .select()
        .from(posServiceSections)
        .where(
          and(
            eq(posServiceSections.organizationId, organizationId),
            eq(posServiceSections.unitId, unitId),
            eq(posServiceSections.active, true),
          ),
        );
      const templateTables = await tx
        .select({
          sectionId: posServiceSectionTables.sectionId,
          tableId: posServiceSectionTables.tableId,
        })
        .from(posServiceSectionTables)
        .innerJoin(
          posDiningTables,
          and(
            eq(posDiningTables.organizationId, posServiceSectionTables.organizationId),
            eq(posDiningTables.unitId, posServiceSectionTables.unitId),
            eq(posDiningTables.id, posServiceSectionTables.tableId),
            eq(posDiningTables.active, true),
          ),
        )
        .where(
          and(
            eq(posServiceSectionTables.organizationId, organizationId),
            eq(posServiceSectionTables.unitId, unitId),
          ),
        );
      const usableTemplates = templates.filter((template) =>
        templateTables.some((membership) => membership.sectionId === template.id),
      );
      if (!usableTemplates.length) {
        throw new ConflictException({
          code: "SERVICE_SECTION_TEMPLATE_REQUIRED",
          message: "Crie ao menos um modelo de praça com mesas antes de abrir o turno.",
        });
      }

      const [previousShift] = input.copyPreviousAssignments
        ? await tx
            .select({ id: posOperationalShifts.id })
            .from(posOperationalShifts)
            .where(
              and(
                eq(posOperationalShifts.organizationId, organizationId),
                eq(posOperationalShifts.unitId, unitId),
                eq(posOperationalShifts.status, "closed"),
              ),
            )
            .orderBy(desc(posOperationalShifts.closedAt))
            .limit(1)
        : [];
      const previousSections = previousShift
        ? await tx
            .select({ id: posShiftSections.id, templateId: posShiftSections.sectionTemplateId })
            .from(posShiftSections)
            .where(
              and(
                eq(posShiftSections.organizationId, organizationId),
                eq(posShiftSections.unitId, unitId),
                eq(posShiftSections.shiftId, previousShift.id),
              ),
            )
        : [];
      const previousStaff = previousShift
        ? await tx
            .select({
              shiftSectionId: posShiftSectionStaff.shiftSectionId,
              identityId: posShiftSectionStaff.identityId,
              role: posShiftSectionStaff.role,
            })
            .from(posShiftSectionStaff)
            .where(
              and(
                eq(posShiftSectionStaff.organizationId, organizationId),
                eq(posShiftSectionStaff.unitId, unitId),
                eq(posShiftSectionStaff.shiftId, previousShift.id),
              ),
            )
        : [];
      const candidateIdentityIds = [
        ...new Set([
          ...usableTemplates.flatMap((template) =>
            template.defaultResponsibleIdentityId ? [template.defaultResponsibleIdentityId] : [],
          ),
          ...previousStaff.map((row) => row.identityId),
        ]),
      ];
      const validStaff = candidateIdentityIds.length
        ? await tx
            .selectDistinct({ identityId: memberships.identityId })
            .from(memberships)
            .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.status, "active"),
                inArray(memberships.identityId, candidateIdentityIds),
                or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
                inArray(roleBindings.role, ["owner", "manager", "waiter", "cashier"]),
              ),
            )
        : [];
      const validIdentityIds = new Set(validStaff.map((row) => row.identityId));

      const [shift] = await tx
        .insert(posOperationalShifts)
        .values({
          organizationId,
          unitId,
          label:
            input.label?.trim() ||
            `Turno ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`,
          serviceMode: input.serviceMode,
          openedByIdentityId: identityId,
        })
        .returning();
      if (!shift) throw new Error("Operational shift insert did not return a row");

      const sectionInstances = usableTemplates.map((template) => ({
        id: randomUUID(),
        organizationId,
        unitId,
        shiftId: shift.id,
        sectionTemplateId: template.id,
        name: template.name,
        color: template.color,
        serviceMode: template.serviceMode,
      }));
      await tx.insert(posShiftSections).values(sectionInstances);
      const sectionIdByTemplate = new Map(
        sectionInstances.map((section) => [section.sectionTemplateId, section.id]),
      );
      await tx.insert(posShiftSectionTables).values(
        templateTables.flatMap((membership) => {
          const shiftSectionId = sectionIdByTemplate.get(membership.sectionId);
          return shiftSectionId
            ? [
                {
                  organizationId,
                  unitId,
                  shiftId: shift.id,
                  shiftSectionId,
                  tableId: membership.tableId,
                },
              ]
            : [];
        }),
      );

      const staffRows = usableTemplates.flatMap((template) => {
        const shiftSectionId = sectionIdByTemplate.get(template.id);
        if (!shiftSectionId) return [];
        const previousSection = previousSections.find((row) => row.templateId === template.id);
        const previousForSection = previousSection
          ? previousStaff.filter((row) => row.shiftSectionId === previousSection.id)
          : [];
        const reusable = previousForSection.filter((row) => validIdentityIds.has(row.identityId));
        if (reusable.length) {
          return reusable.map((row) => ({
            organizationId,
            unitId,
            shiftId: shift.id,
            shiftSectionId,
            identityId: row.identityId,
            role: row.role,
          }));
        }
        return template.defaultResponsibleIdentityId &&
          validIdentityIds.has(template.defaultResponsibleIdentityId)
          ? [
              {
                organizationId,
                unitId,
                shiftId: shift.id,
                shiftSectionId,
                identityId: template.defaultResponsibleIdentityId,
                role: "primary" as const,
              },
            ]
          : [];
      });
      if (staffRows.length) await tx.insert(posShiftSectionStaff).values(staffRows);
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.operational_shift.opened",
        entityType: "operational_shift",
        entityId: shift.id,
        metadata: {
          serviceMode: shift.serviceMode,
          copiedPreviousAssignments: Boolean(previousShift),
          sectionCount: sectionInstances.length,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.operational_shift.opened",
        aggregateType: "operational_shift",
        aggregateId: shift.id,
        payload: { organizationId, unitId, shiftId: shift.id },
      });
      return {
        shift,
        sections: sectionInstances,
        tableAssignments: templateTables.length,
        staffAssignments: staffRows.length,
      };
    });
  }

  async updateShiftSectionAssignment(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    shiftSectionId: string,
    input: ShiftSectionAssignmentInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const staffIds = [
      ...new Set([
        ...(input.primaryIdentityId ? [input.primaryIdentityId] : []),
        ...input.supportIdentityIds,
      ]),
    ];
    await Promise.all(
      staffIds.map((staffId) => this.requireOperationalIdentity(organizationId, unitId, staffId)),
    );
    return this.database.db.transaction(async (tx) => {
      const [section] = await tx
        .select({
          id: posShiftSections.id,
          name: posShiftSections.name,
          assignmentRevision: posOperationalShifts.assignmentRevision,
        })
        .from(posShiftSections)
        .innerJoin(
          posOperationalShifts,
          and(
            eq(posOperationalShifts.organizationId, posShiftSections.organizationId),
            eq(posOperationalShifts.unitId, posShiftSections.unitId),
            eq(posOperationalShifts.id, posShiftSections.shiftId),
          ),
        )
        .where(
          and(
            eq(posShiftSections.organizationId, organizationId),
            eq(posShiftSections.unitId, unitId),
            eq(posShiftSections.shiftId, shiftId),
            eq(posShiftSections.id, shiftSectionId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!section) throw new NotFoundException({ code: "ACTIVE_SHIFT_SECTION_NOT_FOUND" });
      if (input.expectedRevision !== section.assignmentRevision) {
        throw new ConflictException({
          code: "SHIFT_LAYOUT_VERSION_CONFLICT",
          expectedRevision: input.expectedRevision,
          currentRevision: section.assignmentRevision,
        });
      }
      const tables = await tx
        .select({ id: posDiningTables.id })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.active, true),
            inArray(posDiningTables.id, input.tableIds),
          ),
        );
      if (tables.length !== input.tableIds.length) {
        throw new NotFoundException({ code: "SHIFT_SECTION_TABLE_NOT_FOUND" });
      }
      const conflicts = await tx
        .select({ tableId: posShiftSectionTables.tableId })
        .from(posShiftSectionTables)
        .where(
          and(
            eq(posShiftSectionTables.organizationId, organizationId),
            eq(posShiftSectionTables.unitId, unitId),
            eq(posShiftSectionTables.shiftId, shiftId),
            ne(posShiftSectionTables.shiftSectionId, shiftSectionId),
            inArray(posShiftSectionTables.tableId, input.tableIds),
          ),
        );
      if (conflicts.length) {
        throw new ConflictException({
          code: "SHIFT_TABLE_ALREADY_ASSIGNED",
          message: "Uma ou mais mesas já estão em outra praça deste turno.",
          tableIds: conflicts.map((row) => row.tableId),
        });
      }
      await tx
        .delete(posShiftSectionTables)
        .where(
          and(
            eq(posShiftSectionTables.organizationId, organizationId),
            eq(posShiftSectionTables.unitId, unitId),
            eq(posShiftSectionTables.shiftId, shiftId),
            eq(posShiftSectionTables.shiftSectionId, shiftSectionId),
          ),
        );
      await tx.insert(posShiftSectionTables).values(
        input.tableIds.map((tableId) => ({
          organizationId,
          unitId,
          shiftId,
          shiftSectionId,
          tableId,
        })),
      );
      await tx
        .delete(posShiftSectionStaff)
        .where(
          and(
            eq(posShiftSectionStaff.organizationId, organizationId),
            eq(posShiftSectionStaff.unitId, unitId),
            eq(posShiftSectionStaff.shiftId, shiftId),
            eq(posShiftSectionStaff.shiftSectionId, shiftSectionId),
          ),
        );
      const nextStaff = [
        ...(input.primaryIdentityId
          ? [{ identityId: input.primaryIdentityId, role: "primary" as const }]
          : []),
        ...input.supportIdentityIds.map((staffId) => ({
          identityId: staffId,
          role: "support" as const,
        })),
      ];
      if (nextStaff.length) {
        await tx.insert(posShiftSectionStaff).values(
          nextStaff.map((staff) => ({
            organizationId,
            unitId,
            shiftId,
            shiftSectionId,
            ...staff,
          })),
        );
      }
      const [updatedShift] = await tx
        .update(posOperationalShifts)
        .set({ assignmentRevision: section.assignmentRevision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.assignmentRevision, section.assignmentRevision),
          ),
        )
        .returning({ assignmentRevision: posOperationalShifts.assignmentRevision });
      if (!updatedShift) {
        throw new ConflictException({ code: "SHIFT_LAYOUT_VERSION_CONFLICT" });
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.shift_section.assignment_updated",
        entityType: "shift_section",
        entityId: shiftSectionId,
        metadata: {
          tableIds: input.tableIds,
          staff: nextStaff,
          revision: updatedShift.assignmentRevision,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_section.assignment_updated",
        aggregateType: "shift_section",
        aggregateId: shiftSectionId,
        payload: {
          organizationId,
          unitId,
          shiftId,
          shiftSectionId,
          revision: updatedShift.assignmentRevision,
        },
      });
      return {
        section: { id: section.id, name: section.name },
        tableIds: input.tableIds,
        staff: nextStaff,
        revision: updatedShift.assignmentRevision,
      };
    });
  }

  async updateShiftSectionsAssignments(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    input: ShiftSectionsBatchAssignmentInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:shift:manage",
    );
    const staffIds = [
      ...new Set(
        input.assignments.flatMap((assignment) => [
          ...(assignment.primaryIdentityId ? [assignment.primaryIdentityId] : []),
          ...assignment.supportIdentityIds,
        ]),
      ),
    ];
    await Promise.all(
      staffIds.map((staffId) => this.requireOperationalIdentity(organizationId, unitId, staffId)),
    );
    return this.database.db.transaction(async (tx) => {
      const [shift] = await tx
        .select({
          id: posOperationalShifts.id,
          assignmentRevision: posOperationalShifts.assignmentRevision,
        })
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!shift) throw new NotFoundException({ code: "ACTIVE_SHIFT_NOT_FOUND" });
      if (input.expectedRevision !== shift.assignmentRevision) {
        throw new ConflictException({
          code: "SHIFT_LAYOUT_VERSION_CONFLICT",
          expectedRevision: input.expectedRevision,
          currentRevision: shift.assignmentRevision,
        });
      }
      const sectionIds = input.assignments.map(({ shiftSectionId }) => shiftSectionId);
      const sections = await tx
        .select({ id: posShiftSections.id, name: posShiftSections.name })
        .from(posShiftSections)
        .where(
          and(
            eq(posShiftSections.organizationId, organizationId),
            eq(posShiftSections.unitId, unitId),
            eq(posShiftSections.shiftId, shiftId),
            inArray(posShiftSections.id, sectionIds),
          ),
        );
      if (sections.length !== sectionIds.length) {
        throw new NotFoundException({ code: "ACTIVE_SHIFT_SECTION_NOT_FOUND" });
      }
      const tableIds = input.assignments.flatMap(({ tableIds: ids }) => ids);
      const tables = tableIds.length
        ? await tx
            .select({ id: posDiningTables.id })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.active, true),
                inArray(posDiningTables.id, tableIds),
              ),
            )
        : [];
      if (tables.length !== tableIds.length) {
        throw new NotFoundException({ code: "SHIFT_SECTION_TABLE_NOT_FOUND" });
      }
      const conflicts = tableIds.length
        ? await tx
            .select({ tableId: posShiftSectionTables.tableId })
            .from(posShiftSectionTables)
            .where(
              and(
                eq(posShiftSectionTables.organizationId, organizationId),
                eq(posShiftSectionTables.unitId, unitId),
                eq(posShiftSectionTables.shiftId, shiftId),
                sql`${posShiftSectionTables.shiftSectionId} NOT IN (${sql.join(
                  sectionIds.map((sectionId) => sql`${sectionId}`),
                  sql`, `,
                )})`,
                inArray(posShiftSectionTables.tableId, tableIds),
              ),
            )
        : [];
      if (conflicts.length) {
        throw new ConflictException({
          code: "SHIFT_TABLE_ALREADY_ASSIGNED",
          tableIds: conflicts.map(({ tableId }) => tableId),
        });
      }
      await tx
        .delete(posShiftSectionTables)
        .where(
          and(
            eq(posShiftSectionTables.organizationId, organizationId),
            eq(posShiftSectionTables.unitId, unitId),
            eq(posShiftSectionTables.shiftId, shiftId),
            inArray(posShiftSectionTables.shiftSectionId, sectionIds),
          ),
        );
      await tx
        .delete(posShiftSectionStaff)
        .where(
          and(
            eq(posShiftSectionStaff.organizationId, organizationId),
            eq(posShiftSectionStaff.unitId, unitId),
            eq(posShiftSectionStaff.shiftId, shiftId),
            inArray(posShiftSectionStaff.shiftSectionId, sectionIds),
          ),
        );
      const nextTableAssignments = input.assignments.flatMap((assignment) =>
        assignment.tableIds.map((tableId) => ({
          organizationId,
          unitId,
          shiftId,
          shiftSectionId: assignment.shiftSectionId,
          tableId,
        })),
      );
      if (nextTableAssignments.length) {
        await tx.insert(posShiftSectionTables).values(nextTableAssignments);
      }
      const staff = input.assignments.flatMap((assignment) => [
        ...(assignment.primaryIdentityId
          ? [
              {
                organizationId,
                unitId,
                shiftId,
                shiftSectionId: assignment.shiftSectionId,
                identityId: assignment.primaryIdentityId,
                role: "primary" as const,
              },
            ]
          : []),
        ...assignment.supportIdentityIds.map((staffId) => ({
          organizationId,
          unitId,
          shiftId,
          shiftSectionId: assignment.shiftSectionId,
          identityId: staffId,
          role: "support" as const,
        })),
      ]);
      if (staff.length) await tx.insert(posShiftSectionStaff).values(staff);
      const [updatedShift] = await tx
        .update(posOperationalShifts)
        .set({ assignmentRevision: shift.assignmentRevision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.assignmentRevision, shift.assignmentRevision),
          ),
        )
        .returning({ assignmentRevision: posOperationalShifts.assignmentRevision });
      if (!updatedShift) {
        throw new ConflictException({ code: "SHIFT_LAYOUT_VERSION_CONFLICT" });
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.shift_sections.assignments_updated",
        entityType: "operational_shift",
        entityId: shiftId,
        metadata: {
          revision: updatedShift.assignmentRevision,
          assignments: input.assignments,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_sections.assignments_updated",
        aggregateType: "operational_shift",
        aggregateId: shiftId,
        payload: { organizationId, unitId, shiftId, revision: updatedShift.assignmentRevision },
      });
      return {
        shiftId,
        revision: updatedShift.assignmentRevision,
        assignments: input.assignments,
      };
    });
  }

  async updateShiftSectionCoverage(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    shiftSectionId: string,
    input: ShiftSectionCoverageInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
    ]);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-coverage:${organizationId}:${unitId}:${shiftSectionId}:${identityId}`}))`,
      );
      const [section] = await tx
        .select({ id: posShiftSections.id, name: posShiftSections.name })
        .from(posShiftSections)
        .innerJoin(
          posOperationalShifts,
          and(
            eq(posOperationalShifts.organizationId, posShiftSections.organizationId),
            eq(posOperationalShifts.unitId, posShiftSections.unitId),
            eq(posOperationalShifts.id, posShiftSections.shiftId),
          ),
        )
        .where(
          and(
            eq(posShiftSections.organizationId, organizationId),
            eq(posShiftSections.unitId, unitId),
            eq(posShiftSections.shiftId, shiftId),
            eq(posShiftSections.id, shiftSectionId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1);
      if (!section) throw new NotFoundException({ code: "ACTIVE_SHIFT_SECTION_NOT_FOUND" });
      const [current] = await tx
        .select({ role: posShiftSectionStaff.role })
        .from(posShiftSectionStaff)
        .where(
          and(
            eq(posShiftSectionStaff.organizationId, organizationId),
            eq(posShiftSectionStaff.unitId, unitId),
            eq(posShiftSectionStaff.shiftId, shiftId),
            eq(posShiftSectionStaff.shiftSectionId, shiftSectionId),
            eq(posShiftSectionStaff.identityId, identityId),
          ),
        )
        .limit(1);
      if (input.active && current) {
        return { shiftId, shiftSectionId, identityId, role: current.role, active: true };
      }
      if (!input.active && !current) {
        return { shiftId, shiftSectionId, identityId, role: null, active: false };
      }
      if (!input.active && current?.role === "primary") {
        throw new ConflictException({
          code: "SHIFT_SECTION_PRIMARY_CANNOT_LEAVE",
          message: "Defina outro titular antes de encerrar sua responsabilidade nesta praÃ§a.",
        });
      }
      if (input.active) {
        await tx.insert(posShiftSectionStaff).values({
          organizationId,
          unitId,
          shiftId,
          shiftSectionId,
          identityId,
          role: "support",
        });
      } else {
        await tx
          .delete(posShiftSectionStaff)
          .where(
            and(
              eq(posShiftSectionStaff.organizationId, organizationId),
              eq(posShiftSectionStaff.unitId, unitId),
              eq(posShiftSectionStaff.shiftId, shiftId),
              eq(posShiftSectionStaff.shiftSectionId, shiftSectionId),
              eq(posShiftSectionStaff.identityId, identityId),
              eq(posShiftSectionStaff.role, "support"),
            ),
          );
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: input.active
          ? "pos.shift_section.coverage_joined"
          : "pos.shift_section.coverage_left",
        entityType: "shift_section",
        entityId: shiftSectionId,
        metadata: { shiftId, sectionName: section.name },
      });
      await tx.insert(outboxEvents).values({
        topic: input.active
          ? "pos.shift_section.coverage_joined"
          : "pos.shift_section.coverage_left",
        aggregateType: "shift_section",
        aggregateId: shiftSectionId,
        payload: { organizationId, unitId, shiftId, shiftSectionId, identityId },
      });
      return {
        shiftId,
        shiftSectionId,
        identityId,
        role: input.active ? "support" : null,
        active: input.active,
      };
    });
  }

  async transferShiftTable(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    tableId: string,
    input: TemporaryTableTransferInput,
  ) {
    const actorRoles = await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
    ]);
    const canManageAnySection = actorRoles.some(
      (row) =>
        (row.role === "owner" || row.role === "manager") &&
        (row.unitId === null || row.unitId === unitId),
    );
    return this.database.db.transaction(async (tx) => {
      // ponytail: one lock per shift keeps grouped remaps atomic; split by group if contention is measured.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-shift-table-transfer:${organizationId}:${unitId}:${shiftId}`}))`,
      );
      const [baseAssignment] = await tx
        .select({ shiftSectionId: posShiftSectionTables.shiftSectionId })
        .from(posShiftSectionTables)
        .innerJoin(
          posOperationalShifts,
          and(
            eq(posOperationalShifts.organizationId, posShiftSectionTables.organizationId),
            eq(posOperationalShifts.unitId, posShiftSectionTables.unitId),
            eq(posOperationalShifts.id, posShiftSectionTables.shiftId),
          ),
        )
        .where(
          and(
            eq(posShiftSectionTables.organizationId, organizationId),
            eq(posShiftSectionTables.unitId, unitId),
            eq(posShiftSectionTables.shiftId, shiftId),
            eq(posShiftSectionTables.tableId, tableId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1);
      if (!baseAssignment) {
        throw new NotFoundException({
          code: "ACTIVE_SHIFT_TABLE_NOT_FOUND",
          message: "A mesa não está atribuída a uma praça do turno ativo.",
        });
      }
      if (baseAssignment.shiftSectionId === input.targetShiftSectionId) {
        throw new ConflictException({
          code: "SHIFT_TABLE_ALREADY_IN_BASE_SECTION",
          message: "A mesa já pertence a essa praça. Encerre o remanejamento para devolvê-la.",
        });
      }
      const [targetSection] = await tx
        .select({ id: posShiftSections.id, name: posShiftSections.name })
        .from(posShiftSections)
        .where(
          and(
            eq(posShiftSections.organizationId, organizationId),
            eq(posShiftSections.unitId, unitId),
            eq(posShiftSections.shiftId, shiftId),
            eq(posShiftSections.id, input.targetShiftSectionId),
          ),
        )
        .limit(1);
      if (!targetSection) throw new NotFoundException({ code: "TARGET_SHIFT_SECTION_NOT_FOUND" });
      const [group] = await tx
        .select({ id: posDiningTableGroups.id })
        .from(posDiningTableGroupMembers)
        .innerJoin(
          posDiningTableGroups,
          and(
            eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
            eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
            eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
          ),
        )
        .where(
          and(
            eq(posDiningTableGroupMembers.organizationId, organizationId),
            eq(posDiningTableGroupMembers.unitId, unitId),
            eq(posDiningTableGroupMembers.tableId, tableId),
            isNull(posDiningTableGroups.dissolvedAt),
          ),
        )
        .limit(1);
      const tableIds = group
        ? (
            await tx
              .select({ tableId: posDiningTableGroupMembers.tableId })
              .from(posDiningTableGroupMembers)
              .where(
                and(
                  eq(posDiningTableGroupMembers.organizationId, organizationId),
                  eq(posDiningTableGroupMembers.unitId, unitId),
                  eq(posDiningTableGroupMembers.groupId, group.id),
                ),
              )
          ).map((member) => member.tableId)
        : [tableId];
      for (const lockedTableId of [...tableIds].sort()) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${lockedTableId}`}))`,
        );
      }
      const baseAssignments = group
        ? await tx
            .select({
              tableId: posShiftSectionTables.tableId,
              shiftSectionId: posShiftSectionTables.shiftSectionId,
            })
            .from(posShiftSectionTables)
            .where(
              and(
                eq(posShiftSectionTables.organizationId, organizationId),
                eq(posShiftSectionTables.unitId, unitId),
                eq(posShiftSectionTables.shiftId, shiftId),
                inArray(posShiftSectionTables.tableId, tableIds),
              ),
            )
        : [{ tableId, shiftSectionId: baseAssignment.shiftSectionId }];
      if (baseAssignments.length !== tableIds.length) {
        throw new ConflictException({
          code: "GROUP_SHIFT_ASSIGNMENT_INCOMPLETE",
          message: "Todas as mesas do grupo precisam estar atribuídas a uma praça do turno.",
        });
      }
      const now = new Date();
      const currentTransfers = await tx
        .select({
          tableId: posShiftTableTransfers.tableId,
          targetShiftSectionId: posShiftTableTransfers.targetShiftSectionId,
        })
        .from(posShiftTableTransfers)
        .where(
          and(
            eq(posShiftTableTransfers.organizationId, organizationId),
            eq(posShiftTableTransfers.unitId, unitId),
            eq(posShiftTableTransfers.shiftId, shiftId),
            inArray(posShiftTableTransfers.tableId, tableIds),
            isNull(posShiftTableTransfers.endedAt),
            gt(posShiftTableTransfers.expiresAt, now),
          ),
        );
      if (!canManageAnySection) {
        const authorizedSections = [
          ...new Set([
            ...baseAssignments.map((assignment) => assignment.shiftSectionId),
            ...currentTransfers.map((transfer) => transfer.targetShiftSectionId),
            input.targetShiftSectionId,
          ]),
        ];
        const [assignment] = await tx
          .select({ identityId: posShiftSectionStaff.identityId })
          .from(posShiftSectionStaff)
          .where(
            and(
              eq(posShiftSectionStaff.organizationId, organizationId),
              eq(posShiftSectionStaff.unitId, unitId),
              eq(posShiftSectionStaff.shiftId, shiftId),
              eq(posShiftSectionStaff.identityId, identityId),
              inArray(posShiftSectionStaff.shiftSectionId, authorizedSections),
            ),
          )
          .limit(1);
        if (!assignment) {
          throw new ForbiddenException({
            code: "SHIFT_TABLE_TRANSFER_DENIED",
            message: "Você precisa atuar na praça de origem ou de destino para remanejar a mesa.",
          });
        }
      }
      await tx
        .update(posShiftTableTransfers)
        .set({ endedAt: now, endedByIdentityId: identityId })
        .where(
          and(
            eq(posShiftTableTransfers.organizationId, organizationId),
            eq(posShiftTableTransfers.unitId, unitId),
            eq(posShiftTableTransfers.shiftId, shiftId),
            inArray(posShiftTableTransfers.tableId, tableIds),
            isNull(posShiftTableTransfers.endedAt),
          ),
        );
      const expiresAt = new Date(now.getTime() + input.durationMinutes * 60_000);
      const transfers = await tx
        .insert(posShiftTableTransfers)
        .values(
          baseAssignments
            .filter((assignment) => assignment.shiftSectionId !== targetSection.id)
            .map((assignment) => ({
              organizationId,
              unitId,
              shiftId,
              tableId: assignment.tableId,
              sourceShiftSectionId: assignment.shiftSectionId,
              targetShiftSectionId: targetSection.id,
              expiresAt,
              reason: input.reasonNote ?? input.reasonCode,
              reasonCode: input.reasonCode,
              reasonNote: input.reasonNote,
              transferredByIdentityId: identityId,
            })),
        )
        .returning();
      if (!transfers.length) throw new Error("Shift table transfer insert did not return a row");
      const [targetPrimary] = input.transferOpenTab
        ? await tx
            .select({ identityId: posShiftSectionStaff.identityId })
            .from(posShiftSectionStaff)
            .where(
              and(
                eq(posShiftSectionStaff.organizationId, organizationId),
                eq(posShiftSectionStaff.unitId, unitId),
                eq(posShiftSectionStaff.shiftId, shiftId),
                eq(posShiftSectionStaff.shiftSectionId, targetSection.id),
                eq(posShiftSectionStaff.role, "primary"),
              ),
            )
            .limit(1)
        : [];
      const openTabs = input.transferOpenTab
        ? await tx
            .select({
              id: posTabs.id,
              tableId: posTabs.tableId,
              shiftSectionId: posTabs.shiftSectionId,
              responsibleIdentityId: posTabs.responsibleIdentityId,
              version: posTabs.version,
            })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                inArray(posTabs.tableId, tableIds),
                eq(posTabs.status, "open"),
              ),
            )
        : [];
      if (openTabs.length) {
        for (const tab of openTabs) {
          const transfer = transfers.find((row) => row.tableId === tab.tableId);
          if (!transfer) continue;
          await tx
            .update(posShiftTableTransfers)
            .set({
              tabId: tab.id,
              previousShiftSectionId: tab.shiftSectionId,
              previousResponsibleIdentityId: tab.responsibleIdentityId,
              appliedResponsibleIdentityId: targetPrimary?.identityId ?? tab.responsibleIdentityId,
              appliedTabVersion: tab.version + 1,
            })
            .where(eq(posShiftTableTransfers.id, transfer.id));
        }
        await tx
          .update(posTabs)
          .set({
            shiftSectionId: targetSection.id,
            ...(targetPrimary ? { responsibleIdentityId: targetPrimary.identityId } : {}),
            version: sql`${posTabs.version} + 1`,
            updatedAt: now,
          })
          .where(
            inArray(
              posTabs.id,
              openTabs.map((tab) => tab.id),
            ),
          );
        for (const tab of openTabs) {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            tab.id,
            "tab.handed_over",
            {
              reasonCode: input.reasonCode,
              reasonNote: input.reasonNote ?? null,
              sourceShiftSectionId: baseAssignments.find(
                (assignment) => assignment.tableId === tab.tableId,
              )?.shiftSectionId,
              targetShiftSectionId: targetSection.id,
              previousResponsibleIdentityId: tab.responsibleIdentityId,
              responsibleIdentityId: targetPrimary?.identityId ?? tab.responsibleIdentityId,
              expiresAt: expiresAt.toISOString(),
            },
          );
        }
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.shift_table.transferred",
        entityType: group ? "table_group" : "dining_table",
        entityId: group?.id ?? tableId,
        metadata: {
          shiftId,
          tableIds,
          sourceShiftSectionIds: [
            ...new Set(baseAssignments.map((assignment) => assignment.shiftSectionId)),
          ],
          targetShiftSectionId: targetSection.id,
          expiresAt: expiresAt.toISOString(),
          transferredOpenTabs: openTabs.length,
          reasonCode: input.reasonCode,
          reasonNote: input.reasonNote ?? null,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_table.transferred",
        aggregateType: group ? "table_group" : "dining_table",
        aggregateId: group?.id ?? tableId,
        payload: { organizationId, unitId, shiftId, tableIds, expiresAt: expiresAt.toISOString() },
      });
      return { transfers, targetSection, transferredOpenTabs: openTabs.length };
    });
  }

  async endShiftTableTransfer(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    tableId: string,
  ) {
    const actorRoles = await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
    ]);
    const canManageAnySection = actorRoles.some(
      (row) =>
        (row.role === "owner" || row.role === "manager") &&
        (row.unitId === null || row.unitId === unitId),
    );
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-shift-table-transfer:${organizationId}:${unitId}:${shiftId}`}))`,
      );
      const [transfer] = await tx
        .select({
          id: posShiftTableTransfers.id,
          sourceShiftSectionId: posShiftTableTransfers.sourceShiftSectionId,
          targetShiftSectionId: posShiftTableTransfers.targetShiftSectionId,
          expiresAt: posShiftTableTransfers.expiresAt,
          tabId: posShiftTableTransfers.tabId,
          previousShiftSectionId: posShiftTableTransfers.previousShiftSectionId,
          previousResponsibleIdentityId: posShiftTableTransfers.previousResponsibleIdentityId,
          appliedResponsibleIdentityId: posShiftTableTransfers.appliedResponsibleIdentityId,
          appliedTabVersion: posShiftTableTransfers.appliedTabVersion,
        })
        .from(posShiftTableTransfers)
        .innerJoin(
          posOperationalShifts,
          and(
            eq(posOperationalShifts.organizationId, posShiftTableTransfers.organizationId),
            eq(posOperationalShifts.unitId, posShiftTableTransfers.unitId),
            eq(posOperationalShifts.id, posShiftTableTransfers.shiftId),
          ),
        )
        .where(
          and(
            eq(posShiftTableTransfers.organizationId, organizationId),
            eq(posShiftTableTransfers.unitId, unitId),
            eq(posShiftTableTransfers.shiftId, shiftId),
            eq(posShiftTableTransfers.tableId, tableId),
            isNull(posShiftTableTransfers.endedAt),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1);
      if (!transfer) return { tableId, active: false };
      const [group] = await tx
        .select({ id: posDiningTableGroups.id })
        .from(posDiningTableGroupMembers)
        .innerJoin(
          posDiningTableGroups,
          and(
            eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
            eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
            eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
          ),
        )
        .where(
          and(
            eq(posDiningTableGroupMembers.organizationId, organizationId),
            eq(posDiningTableGroupMembers.unitId, unitId),
            eq(posDiningTableGroupMembers.tableId, tableId),
            isNull(posDiningTableGroups.dissolvedAt),
          ),
        )
        .limit(1);
      const tableIds = group
        ? (
            await tx
              .select({ tableId: posDiningTableGroupMembers.tableId })
              .from(posDiningTableGroupMembers)
              .where(
                and(
                  eq(posDiningTableGroupMembers.organizationId, organizationId),
                  eq(posDiningTableGroupMembers.unitId, unitId),
                  eq(posDiningTableGroupMembers.groupId, group.id),
                ),
              )
          ).map((member) => member.tableId)
        : [tableId];
      const transfers = await tx
        .select({
          id: posShiftTableTransfers.id,
          sourceShiftSectionId: posShiftTableTransfers.sourceShiftSectionId,
          targetShiftSectionId: posShiftTableTransfers.targetShiftSectionId,
          expiresAt: posShiftTableTransfers.expiresAt,
          tabId: posShiftTableTransfers.tabId,
          previousShiftSectionId: posShiftTableTransfers.previousShiftSectionId,
          previousResponsibleIdentityId: posShiftTableTransfers.previousResponsibleIdentityId,
          appliedResponsibleIdentityId: posShiftTableTransfers.appliedResponsibleIdentityId,
          appliedTabVersion: posShiftTableTransfers.appliedTabVersion,
        })
        .from(posShiftTableTransfers)
        .where(
          and(
            eq(posShiftTableTransfers.organizationId, organizationId),
            eq(posShiftTableTransfers.unitId, unitId),
            eq(posShiftTableTransfers.shiftId, shiftId),
            inArray(posShiftTableTransfers.tableId, tableIds),
            isNull(posShiftTableTransfers.endedAt),
          ),
        );
      if (!canManageAnySection) {
        const [assignment] = await tx
          .select({ identityId: posShiftSectionStaff.identityId })
          .from(posShiftSectionStaff)
          .where(
            and(
              eq(posShiftSectionStaff.organizationId, organizationId),
              eq(posShiftSectionStaff.unitId, unitId),
              eq(posShiftSectionStaff.shiftId, shiftId),
              eq(posShiftSectionStaff.identityId, identityId),
              inArray(posShiftSectionStaff.shiftSectionId, [
                ...new Set(
                  transfers.flatMap((row) => [row.sourceShiftSectionId, row.targetShiftSectionId]),
                ),
              ]),
            ),
          )
          .limit(1);
        if (!assignment) throw new ForbiddenException({ code: "SHIFT_TABLE_TRANSFER_DENIED" });
      }
      const endedAt = new Date();
      const restoration = await this.restoreShiftTransferSnapshots(
        tx,
        identityId,
        organizationId,
        unitId,
        transfers,
      );
      await tx
        .update(posShiftTableTransfers)
        .set({ endedAt, endedByIdentityId: identityId })
        .where(
          inArray(
            posShiftTableTransfers.id,
            transfers.map((row) => row.id),
          ),
        );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.shift_table.transfer_ended",
        entityType: group ? "table_group" : "dining_table",
        entityId: group?.id ?? tableId,
        metadata: {
          shiftId,
          tableIds,
          sourceShiftSectionIds: [...new Set(transfers.map((row) => row.sourceShiftSectionId))],
          targetShiftSectionIds: [...new Set(transfers.map((row) => row.targetShiftSectionId))],
          naturalExpiry: transfers.every((row) => row.expiresAt <= endedAt),
          ...restoration,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.shift_table.transfer_ended",
        aggregateType: group ? "table_group" : "dining_table",
        aggregateId: group?.id ?? tableId,
        payload: { organizationId, unitId, shiftId, tableIds },
      });
      return {
        tableIds,
        active: false,
        endedAt,
        ...restoration,
        confirmationRequired:
          restoration.preservedTabIds.length > 0 ? "tab_changed_after_transfer" : null,
      };
    });
  }

  async closeOperationalShift(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    input: CloseOperationalShiftInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    if (input.handoverIdentityId) {
      await this.requireOperationalIdentity(organizationId, unitId, input.handoverIdentityId);
    }
    for (const targetIdentityId of [
      ...new Set(
        input.handoverAssignments?.map((assignment) => assignment.targetResponsibleIdentityId) ??
          [],
      ),
    ]) {
      await this.requireOperationalIdentity(organizationId, unitId, targetIdentityId);
    }
    return this.database.db.transaction(async (tx) => {
      const closedAt = new Date();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-close-shift:${organizationId}:${unitId}`}))`,
      );
      const [activeShift] = await tx
        .select()
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.id, shiftId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1);
      if (!activeShift) throw new NotFoundException({ code: "ACTIVE_SHIFT_NOT_FOUND" });
      const openTabs = await tx
        .select({
          id: posTabs.id,
          responsibleIdentityId: posTabs.responsibleIdentityId,
          totalCents: posTabs.totalCents,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.status, "open"),
          ),
        );
      if (openTabs.length && !input.acknowledgeOpenTabs) {
        throw new ConflictException({
          code: "SHIFT_OPEN_TABS_REQUIRE_HANDOVER",
          message: "Confirme quem continuará responsável pelas comandas antes de encerrar o turno.",
          openTabs: openTabs.length,
          totalCents: openTabs.reduce((sum, tab) => sum + tab.totalCents, 0),
        });
      }
      const handoverBySource = new Map(
        input.handoverAssignments?.map((assignment) => [
          assignment.sourceResponsibleIdentityId ?? "unassigned",
          assignment.targetResponsibleIdentityId,
        ]),
      );
      const handedOverTabs = openTabs.flatMap((tab) => {
        const targetIdentityId =
          input.handoverIdentityId ??
          handoverBySource.get(tab.responsibleIdentityId ?? "unassigned");
        return targetIdentityId && targetIdentityId !== tab.responsibleIdentityId
          ? [{ ...tab, targetIdentityId }]
          : [];
      });
      const shiftStaff = await tx
        .select({ identityId: posShiftSectionStaff.identityId })
        .from(posShiftSectionStaff)
        .where(
          and(
            eq(posShiftSectionStaff.organizationId, organizationId),
            eq(posShiftSectionStaff.unitId, unitId),
            eq(posShiftSectionStaff.shiftId, activeShift.id),
          ),
        );
      const shiftIdentityIds = new Set([
        activeShift.openedByIdentityId,
        ...shiftStaff.map((staff) => staff.identityId),
        ...openTabs.flatMap((tab) =>
          tab.responsibleIdentityId ? [tab.responsibleIdentityId] : [],
        ),
      ]);
      const allOpenReturnableCustodies = await this.lockOpenReturnableCustodyForTabs(
        tx,
        organizationId,
        unitId,
      );
      const openTabIds = new Set(openTabs.map((tab) => tab.id));
      const openReturnableCustodies = allOpenReturnableCustodies.filter((custody) => {
        const sourceKey = custody.currentResponsibleIdentityId ?? "unassigned";
        return (
          openTabIds.has(custody.tabId) ||
          handoverBySource.has(sourceKey) ||
          (custody.currentResponsibleIdentityId !== null &&
            shiftIdentityIds.has(custody.currentResponsibleIdentityId))
        );
      });
      const custodyTarget = (custody: OpenReturnableCustody) =>
        input.handoverIdentityId ??
        handoverBySource.get(custody.currentResponsibleIdentityId ?? "unassigned");
      const pendingReturnables = openReturnableCustodies.filter(
        (custody) => !custodyTarget(custody),
      );
      const [configuredReturnablePolicy] = await tx
        .select({ returnableClosePolicy: managementReturnablePolicies.returnableClosePolicy })
        .from(managementReturnablePolicies)
        .where(
          and(
            eq(managementReturnablePolicies.organizationId, organizationId),
            eq(managementReturnablePolicies.unitId, unitId),
          ),
        )
        .limit(1);
      const returnableClosePolicy = configuredReturnablePolicy?.returnableClosePolicy ?? "warn";
      const pendingReturnableMilli = pendingReturnables.reduce(
        (sum, custody) => sum + returnableQuantityToMilli(custody.openQuantity),
        0n,
      );
      const pendingReturnableSnapshot = {
        policy: returnableClosePolicy,
        issueCount: pendingReturnables.length,
        openQuantity: returnableMilliToQuantity(pendingReturnableMilli),
        issues: pendingReturnables.map((custody) => ({
          issueMovementId: custody.issueMovementId,
          tabId: custody.tabId,
          containerInventoryItemId: custody.containerInventoryItemId,
          containerName: custody.containerName,
          openQuantity: custody.openQuantity,
          responsibleIdentityId: custody.currentResponsibleIdentityId,
        })),
      };
      const mustBlockReturnables = returnableClosePolicy === "block";
      const mustAcknowledgeReturnables =
        returnableClosePolicy === "warn" && input.returnableDecision !== "acknowledge";
      if (pendingReturnables.length > 0 && (mustBlockReturnables || mustAcknowledgeReturnables)) {
        throw new ConflictException({
          code: "SHIFT_HAS_OPEN_RETURNABLE_CUSTODY",
          message: mustBlockReturnables
            ? "Transfira ou confirme a devolução dos vasilhames antes de encerrar o turno."
            : "Há custódias de vasilhames sem destinatário. Confirme a ciência para encerrar o turno.",
          policy: returnableClosePolicy,
          pending: pendingReturnableSnapshot,
        });
      }
      const returnableCustodyHandoffs = openReturnableCustodies.flatMap((custody) => {
        const targetIdentityId = custodyTarget(custody);
        if (!targetIdentityId || targetIdentityId === custody.currentResponsibleIdentityId)
          return [];
        return [
          {
            organizationId,
            unitId,
            issueMovementId: custody.issueMovementId,
            fromIdentityId: custody.currentResponsibleIdentityId,
            toIdentityId: targetIdentityId,
            fromShiftReference: activeShift.id,
            toShiftReference: null,
            note: input.reason ?? "Passagem de turno confirmada",
            idempotencyKey: `shift-handoff:${activeShift.id}:${custody.issueMovementId}`,
            actorIdentityId: identityId,
            occurredAt: closedAt,
          },
        ];
      });
      if (returnableCustodyHandoffs.length > 0) {
        await tx
          .insert(managementReturnableCustodyHandoffs)
          .values(returnableCustodyHandoffs)
          .onConflictDoNothing();
      }
      const pendingReturnableCustodies = pendingReturnables.length;
      for (const targetIdentityId of [
        ...new Set(handedOverTabs.map((tab) => tab.targetIdentityId)),
      ]) {
        await tx
          .update(posTabs)
          .set({
            responsibleIdentityId: targetIdentityId,
            version: sql`${posTabs.version} + 1`,
            updatedAt: closedAt,
          })
          .where(
            inArray(
              posTabs.id,
              handedOverTabs
                .filter((tab) => tab.targetIdentityId === targetIdentityId)
                .map((tab) => tab.id),
            ),
          );
      }
      if (handedOverTabs.length) {
        await tx.insert(posTabEvents).values(
          handedOverTabs.map((tab) => ({
            organizationId,
            unitId,
            tabId: tab.id,
            actorIdentityId: identityId,
            type: "tab.shift_handover",
            payload: {
              shiftId,
              reason: input.reason ?? "Passagem de turno confirmada",
              previousResponsibleIdentityId: tab.responsibleIdentityId,
              responsibleIdentityId: tab.targetIdentityId,
            },
          })),
        );
      }
      const [shift] = await tx
        .update(posOperationalShifts)
        .set({ status: "closed", closedAt, updatedAt: closedAt })
        .where(eq(posOperationalShifts.id, activeShift.id))
        .returning();
      if (!shift) throw new Error("Operational shift update did not return a row");
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.operational_shift.closed",
        entityType: "operational_shift",
        entityId: shift.id,
        metadata: {
          openTabsAcknowledged: openTabs.length,
          openTabsTotalCents: openTabs.reduce((sum, tab) => sum + tab.totalCents, 0),
          handoverIdentityId: input.handoverIdentityId ?? null,
          handoverAssignments: input.handoverAssignments ?? [],
          handedOverTabs: handedOverTabs.length,
          returnableCustodyHandoffs: returnableCustodyHandoffs.length,
          pendingReturnableCustodies,
          returnableClosePolicy,
          returnableDecision: input.returnableDecision ?? null,
          reason: input.reason ?? null,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.operational_shift.closed",
        aggregateType: "operational_shift",
        aggregateId: shift.id,
        payload: {
          organizationId,
          unitId,
          shiftId: shift.id,
          openTabs: openTabs.length,
          returnableCustodyHandoffs: returnableCustodyHandoffs.length,
          pendingReturnableCustodies,
          returnableClosePolicy,
        },
      });
      return {
        shift,
        handover: {
          openTabs: openTabs.length,
          totalCents: openTabs.reduce((sum, tab) => sum + tab.totalCents, 0),
          responsibleIdentityId: input.handoverIdentityId ?? null,
          assignments: input.handoverAssignments ?? [],
          handedOverTabs: handedOverTabs.length,
          returnableCustodyHandoffs: returnableCustodyHandoffs.length,
          pendingReturnableCustodies,
          returnableClosePolicy,
          pendingReturnables: pendingReturnableSnapshot,
        },
      };
    });
  }

  async createTable(
    identityId: string,
    organizationId: string,
    unitId: string,
    roomId: string,
    input: TableInput,
  ) {
    const result = await this.createTables(identityId, organizationId, unitId, roomId, {
      expectedRevision: input.expectedRevision,
      tables: [
        {
          label: input.label,
          seats: input.seats,
          width: input.width,
          height: input.height,
          rotation: input.rotation,
          shape: input.shape,
        },
      ],
    });
    const table = result.tables[0];
    if (!table) throw new Error("Table batch insert did not return a row");
    return { ...table, floorRevision: result.floorRevision };
  }

  async updateTable(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    input: TableEditInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        input.expectedRevision,
      );
      const [current, room] = await Promise.all([
        tx
          .select()
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, tableId),
              eq(posDiningTables.active, true),
            ),
          )
          .for("update")
          .limit(1)
          .then((rows) => rows[0] ?? null),
        tx
          .select({ id: posDiningRooms.id })
          .from(posDiningRooms)
          .where(
            and(
              eq(posDiningRooms.organizationId, organizationId),
              eq(posDiningRooms.unitId, unitId),
              eq(posDiningRooms.id, input.roomId),
              eq(posDiningRooms.active, true),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ]);
      if (!current) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
      if (!room) throw new NotFoundException({ code: "ROOM_NOT_FOUND" });
      if (current.roomId !== input.roomId && ["occupied", "reserved"].includes(current.status)) {
        throw new ConflictException({ code: "ACTIVE_TABLE_CANNOT_CHANGE_ROOM" });
      }
      const [table] = await tx
        .update(posDiningTables)
        .set({
          roomId: input.roomId,
          label: input.label,
          seats: input.seats,
          layoutWidth: input.width,
          layoutHeight: input.height,
          layoutRotation: input.rotation,
          layoutShape: input.shape,
          updatedAt: new Date(),
        })
        .where(eq(posDiningTables.id, tableId))
        .returning();
      if (!table) throw new Error("Table update did not return a row");
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.table.updated",
        entityType: "dining_table",
        entityId: tableId,
        metadata: {
          fromRoomId: current.roomId,
          roomId: input.roomId,
          label: input.label,
          seats: input.seats,
          width: input.width,
          height: input.height,
          rotation: input.rotation,
          shape: input.shape,
          revision: updatedFloorLayout.revision,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.table.updated",
        aggregateType: "dining_table",
        aggregateId: tableId,
        payload: {
          organizationId,
          unitId,
          tableId,
          roomId: input.roomId,
          revision: updatedFloorLayout.revision,
        },
      });
      return { ...table, floorRevision: updatedFloorLayout.revision };
    });
  }

  async archiveTable(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    expectedRevision: number,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        expectedRevision,
      );
      const [table] = await tx
        .select()
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.id, tableId),
            eq(posDiningTables.active, true),
          ),
        )
        .for("update")
        .limit(1);
      if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
      if (["occupied", "reserved"].includes(table.status)) {
        throw new ConflictException({ code: "TABLE_OPERATIONALLY_BLOCKED", status: table.status });
      }
      const [[openTab], [activeShiftReference], [activeGroup]] = await Promise.all([
        tx
          .select({ id: posTabs.id })
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.tableId, tableId),
              eq(posTabs.status, "open"),
            ),
          )
          .limit(1),
        tx
          .select({ shiftId: posShiftSectionTables.shiftId })
          .from(posShiftSectionTables)
          .innerJoin(
            posOperationalShifts,
            and(
              eq(posOperationalShifts.organizationId, posShiftSectionTables.organizationId),
              eq(posOperationalShifts.unitId, posShiftSectionTables.unitId),
              eq(posOperationalShifts.id, posShiftSectionTables.shiftId),
            ),
          )
          .where(
            and(
              eq(posShiftSectionTables.organizationId, organizationId),
              eq(posShiftSectionTables.unitId, unitId),
              eq(posShiftSectionTables.tableId, tableId),
              eq(posOperationalShifts.status, "active"),
            ),
          )
          .limit(1),
        tx
          .select({ groupId: posDiningTableGroupMembers.groupId })
          .from(posDiningTableGroupMembers)
          .innerJoin(
            posDiningTableGroups,
            and(
              eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
              eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
              eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
            ),
          )
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              eq(posDiningTableGroupMembers.tableId, tableId),
              isNull(posDiningTableGroups.dissolvedAt),
            ),
          )
          .limit(1),
      ]);
      if (openTab || activeShiftReference || activeGroup) {
        throw new ConflictException({
          code: "TABLE_HAS_ACTIVE_REFERENCES",
          openTabId: openTab?.id ?? null,
          shiftId: activeShiftReference?.shiftId ?? null,
          groupId: activeGroup?.groupId ?? null,
        });
      }
      await tx
        .update(posDiningTables)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(posDiningTables.id, tableId));
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.table.archived",
        entityType: "dining_table",
        entityId: tableId,
        metadata: { revision: updatedFloorLayout.revision },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.table.archived",
        aggregateType: "dining_table",
        aggregateId: tableId,
        payload: { organizationId, unitId, tableId, revision: updatedFloorLayout.revision },
      });
      return { tableId, archived: true, floorRevision: updatedFloorLayout.revision };
    });
  }

  async updateTableTurnover(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    input: TableTurnoverInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:tables:turnover",
    );
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-table-turnover:${organizationId}:${unitId}:${tableId}`}))`,
      );
      const [table] = await tx
        .select()
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.id, tableId),
            eq(posDiningTables.active, true),
          ),
        )
        .limit(1);
      if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
      if (table.status === input.status) return table;
      const allowed =
        (table.status === "needs_cleaning" && input.status === "cleaning") ||
        ((table.status === "needs_cleaning" || table.status === "cleaning") &&
          input.status === "available");
      if (!allowed) {
        throw new ConflictException({
          code: "INVALID_TABLE_TURNOVER_TRANSITION",
          message: "A mesa não está aguardando limpeza.",
        });
      }
      const [openTab] = await tx
        .select({ id: posTabs.id })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.tableId, tableId),
            eq(posTabs.status, "open"),
          ),
        )
        .limit(1);
      if (openTab) throw new ConflictException({ code: "TABLE_HAS_OPEN_TAB" });
      const now = new Date();
      const [updated] = await tx
        .update(posDiningTables)
        .set({ status: input.status, updatedAt: now })
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.id, tableId),
            eq(posDiningTables.status, table.status),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "STALE_TABLE_TURNOVER" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: input.status === "cleaning" ? "pos.table.cleaning_started" : "pos.table.available",
        entityType: "dining_table",
        entityId: tableId,
        metadata: { from: table.status, to: input.status },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.table.turnover_changed",
        aggregateType: "dining_table",
        aggregateId: tableId,
        payload: { organizationId, unitId, tableId, from: table.status, to: input.status },
      });
      return updated;
    });
  }

  async createTables(
    identityId: string,
    organizationId: string,
    unitId: string,
    roomId: string,
    input: TableBatchInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:floor:manage",
    );
    return this.database.db.transaction(async (tx) => {
      const floorLayout = await this.lockFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        input.expectedRevision,
      );
      const [room] = await tx
        .select({ id: posDiningRooms.id })
        .from(posDiningRooms)
        .where(
          and(
            eq(posDiningRooms.organizationId, organizationId),
            eq(posDiningRooms.unitId, unitId),
            eq(posDiningRooms.id, roomId),
            eq(posDiningRooms.active, true),
          ),
        )
        .limit(1);
      if (!room) throw new NotFoundException({ code: "ROOM_NOT_FOUND" });
      const normalizedLabels = input.tables.map((table) => table.label.toLocaleLowerCase("pt-BR"));
      const existingTables = await tx
        .select({ label: posDiningTables.label })
        .from(posDiningTables)
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            eq(posDiningTables.roomId, roomId),
          ),
        );
      const existingLabels = new Set(
        existingTables.map((table) => table.label.toLocaleLowerCase("pt-BR")),
      );
      if (
        new Set(normalizedLabels).size !== normalizedLabels.length ||
        normalizedLabels.some((label) => existingLabels.has(label))
      ) {
        throw new ConflictException({ code: "TABLE_LABEL_CONFLICT" });
      }
      const tables = await tx
        .insert(posDiningTables)
        .values(
          input.tables.map((table) => ({
            organizationId,
            unitId,
            roomId,
            label: table.label,
            seats: table.seats,
            layoutWidth: table.width,
            layoutHeight: table.height,
            layoutRotation: table.rotation,
            layoutShape: table.shape,
          })),
        )
        .returning();
      const updatedFloorLayout = await this.bumpFloorLayoutRevision(
        tx,
        identityId,
        organizationId,
        unitId,
        floorLayout.revision,
      );
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.tables.created",
        entityType: "dining_room",
        entityId: roomId,
        metadata: {
          tableIds: tables.map(({ id }) => id),
          revision: updatedFloorLayout.revision,
        },
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.tables.created",
        aggregateType: "dining_room",
        aggregateId: roomId,
        payload: {
          organizationId,
          unitId,
          roomId,
          tableIds: tables.map(({ id }) => id),
          revision: updatedFloorLayout.revision,
        },
      });
      return { tables, floorRevision: updatedFloorLayout.revision };
    });
  }

  async setManagerPin(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ManagerPinInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    const [membership] = await this.database.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(roleBindings.role, ["owner", "manager"]),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!membership) throw new ForbiddenException({ code: "MANAGER_PIN_DENIED" });
    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    await this.database.db
      .insert(posManagerPins)
      .values({ membershipId: membership.id, organizationId, pinHash })
      .onConflictDoUpdate({
        target: posManagerPins.membershipId,
        set: { pinHash, active: true, updatedAt: new Date() },
      });
    await this.database.db.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "pos.manager_pin.updated",
      entityType: "membership",
      entityId: membership.id,
    });
    return { configured: true };
  }

  async listTabs(identityId: string, organizationId: string, unitId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(posTabs)
      .where(and(eq(posTabs.organizationId, organizationId), eq(posTabs.unitId, unitId)));
  }

  async listCounterQueue(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: CounterQueueQueryInput,
  ) {
    await this.requireAccess(identityId, organizationId, unitId);
    const queueCte = sql`
      with kds_rollup as (
        select tickets.order_id,
               count(*) filter (where tickets.status <> 'canceled')::int as ticket_count,
               count(*) filter (where tickets.status in ('pending', 'preparing'))::int as production_ticket_count,
               count(*) filter (where tickets.status in ('ready', 'done'))::int as ready_ticket_count
          from pos_kds_tickets tickets
         where tickets.organization_id = ${organizationId}::uuid
           and tickets.unit_id = ${unitId}::uuid
         group by tickets.order_id
      ), order_rollup as (
        select orders.tab_id,
               count(*) filter (where orders.status <> 'canceled')::int as active_order_count,
               count(*) filter (
                 where orders.status <> 'canceled'
                   and (
                     orders.status in ('ready', 'served')
                     or (
                       coalesce(kds.ticket_count, 0) > 0
                       and coalesce(kds.ready_ticket_count, 0) = coalesce(kds.ticket_count, 0)
                     )
                   )
               )::int as ready_order_count,
               count(*) filter (
                 where orders.status <> 'canceled'
                   and (
                     orders.status in ('sent', 'preparing')
                     or coalesce(kds.production_ticket_count, 0) > 0
                   )
               )::int as production_order_count
          from pos_orders orders
          left join kds_rollup kds on kds.order_id = orders.id
         where orders.organization_id = ${organizationId}::uuid
           and orders.unit_id = ${unitId}::uuid
         group by orders.tab_id
      ), queue as (
        select tabs.*,
               case
                 when tabs.status = 'closed' then 'delivered'
                 when coalesce(orders.active_order_count, 0) > 0
                   and coalesce(orders.ready_order_count, 0) = coalesce(orders.active_order_count, 0)
                   then case when tabs.ready_notified_at is not null then 'waiting' else 'ready' end
                 when tabs.promised_at is not null and tabs.promised_at < now() then 'late'
                 when coalesce(orders.production_order_count, 0) > 0 then 'production'
                 else 'new'
               end as queue_stage
          from pos_tabs tabs
          left join order_rollup orders on orders.tab_id = tabs.id
         where tabs.organization_id = ${organizationId}::uuid
           and tabs.unit_id = ${unitId}::uuid
           and tabs.table_id is null
           and tabs.status in ('open', 'closed')
           and (tabs.status = 'open' or tabs.closed_at >= now() - interval '24 hours')
      )
    `;
    const channelFilter =
      query.channel === "all" ? sql`true` : sql`queue.fulfillment_type = ${query.channel}`;
    const baseFilter = sql`
      ${channelFilter}
      and (
        ${query.query} = ''
        or position(
          lower(${query.query}) in lower(concat_ws(
            ' ',
            queue.label,
            queue.customer_name,
            queue.customer_phone,
            queue.display_number::text
          ))
        ) > 0
      )
    `;
    const offset = (query.page - 1) * query.limit;
    const [items, [summary]] = await Promise.all([
      this.database.db.execute<CounterQueueRow>(sql`
        ${queueCte}
        select queue.id,
               queue.organization_id as "organizationId",
               queue.unit_id as "unitId",
               queue.table_id as "tableId",
               queue.operational_shift_id as "operationalShiftId",
               queue.shift_section_id as "shiftSectionId",
               queue.opened_by_identity_id as "openedByIdentityId",
               queue.responsible_identity_id as "responsibleIdentityId",
               queue.label,
               queue.display_number as "displayNumber",
               queue.fulfillment_type as "fulfillmentType",
               queue.customer_name as "customerName",
               queue.customer_phone as "customerPhone",
               queue.ready_notification_consent as "readyNotificationConsent",
               queue.service_notes as "serviceNotes",
               queue.delivery_address as "deliveryAddress",
               queue.promised_at as "promisedAt",
               queue.ready_notified_at as "readyNotifiedAt",
               queue.guest_count as "guestCount",
               queue.version,
               queue.status,
               queue.merged_into_tab_id as "mergedIntoTabId",
               queue.service_charge_basis_points as "serviceChargeBasisPoints",
               queue.tip_cents as "tipCents",
               queue.subtotal_cents as "subtotalCents",
               queue.discount_cents as "discountCents",
               queue.service_charge_cents as "serviceChargeCents",
               queue.total_cents as "totalCents",
               queue.closed_at as "closedAt",
               queue.created_at as "createdAt",
               queue.updated_at as "updatedAt",
               queue.queue_stage as "queueStage"
         from queue
         where ${baseFilter}
           and (
             (${query.stage} = 'all' and queue.status = 'open')
             or (${query.stage} <> 'all' and queue.queue_stage = ${query.stage})
           )
         order by case queue.queue_stage
                    when 'late' then 0
                    when 'ready' then 1
                    when 'waiting' then 2
                    when 'new' then 3
                    when 'production' then 4
                    else 5
                  end,
                  case when queue.queue_stage = 'delivered' then queue.closed_at end desc nulls last,
                  queue.promised_at asc nulls last,
                  queue.created_at asc
         limit ${query.limit}
        offset ${offset}
      `),
      this.database.db.execute<{
        all: number;
        new: number;
        production: number;
        ready: number;
        waiting: number;
        delivered: number;
        late: number;
        selectedTotal: number;
      }>(sql`
        ${queueCte}
        select count(*) filter (where queue.status = 'open')::int as all,
               count(*) filter (where queue.queue_stage = 'new')::int as new,
               count(*) filter (where queue.queue_stage = 'production')::int as production,
               count(*) filter (where queue.queue_stage = 'ready')::int as ready,
               count(*) filter (where queue.queue_stage = 'waiting')::int as waiting,
               count(*) filter (where queue.queue_stage = 'delivered')::int as delivered,
               count(*) filter (where queue.queue_stage = 'late')::int as late,
               count(*) filter (
                 where (${query.stage} = 'all' and queue.status = 'open')
                    or (${query.stage} <> 'all' and queue.queue_stage = ${query.stage})
               )::int as "selectedTotal"
          from queue
         where ${baseFilter}
      `),
    ]);
    const counts = {
      all: summary?.all ?? 0,
      new: summary?.new ?? 0,
      production: summary?.production ?? 0,
      ready: summary?.ready ?? 0,
      waiting: summary?.waiting ?? 0,
      delivered: summary?.delivered ?? 0,
      late: summary?.late ?? 0,
    };
    const total = summary?.selectedTotal ?? 0;
    return {
      items,
      counts,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getTab(identityId: string, organizationId: string, unitId: string, tabId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [tab] = await this.database.db
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const orders = await this.database.db
      .select()
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.tabId, tabId),
        ),
      );
    const orderIds = orders.map((order) => order.id);
    const items =
      orderIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(posOrderItems)
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                inArray(posOrderItems.orderId, orderIds),
              ),
            );
    const itemIds = items.map((item) => item.id);
    const modifiers =
      itemIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                inArray(posOrderItemModifiers.orderItemId, itemIds),
              ),
            );
    const doseClubRedemptionRows =
      itemIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(doseClubRedemptions)
            .where(
              and(
                eq(doseClubRedemptions.organizationId, organizationId),
                eq(doseClubRedemptions.unitId, unitId),
                inArray(doseClubRedemptions.orderItemId, itemIds),
              ),
            );
    const [paymentRows, events, presence] = await Promise.all([
      this.database.db
        .select({
          payment: posTabPayments,
          reversedCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`.mapWith(
            Number,
          ),
        })
        .from(posTabPayments)
        .leftJoin(
          posPaymentReversals,
          and(
            eq(posPaymentReversals.organizationId, posTabPayments.organizationId),
            eq(posPaymentReversals.unitId, posTabPayments.unitId),
            eq(posPaymentReversals.paymentId, posTabPayments.id),
            eq(posPaymentReversals.status, "approved"),
          ),
        )
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            eq(posTabPayments.tabId, tabId),
          ),
        )
        .groupBy(posTabPayments.id),
      this.database.db
        .select({
          id: posTabEvents.id,
          type: posTabEvents.type,
          payload: posTabEvents.payload,
          createdAt: posTabEvents.createdAt,
          actorIdentityId: posTabEvents.actorIdentityId,
          actorName: identities.displayName,
        })
        .from(posTabEvents)
        .innerJoin(identities, eq(identities.id, posTabEvents.actorIdentityId))
        .where(
          and(
            eq(posTabEvents.organizationId, organizationId),
            eq(posTabEvents.unitId, unitId),
            eq(posTabEvents.tabId, tabId),
          ),
        )
        .orderBy(desc(posTabEvents.createdAt))
        .limit(100),
      this.database.db
        .select({ identityId: posTabPresence.identityId, displayName: identities.displayName })
        .from(posTabPresence)
        .innerJoin(identities, eq(identities.id, posTabPresence.identityId))
        .where(
          and(
            eq(posTabPresence.organizationId, organizationId),
            eq(posTabPresence.unitId, unitId),
            eq(posTabPresence.tabId, tabId),
            gt(posTabPresence.expiresAt, new Date()),
          ),
        ),
    ]);
    const payments = paymentRows.map(({ payment, reversedCents }) => ({
      ...payment,
      reversedCents,
      netAmountCents: payment.amountCents - reversedCents,
      financialStatus: reversedCents > 0 ? ("reversed" as const) : ("posted" as const),
    }));
    const grossPaidCents = payments.reduce((total, payment) => total + payment.amountCents, 0);
    const reversedCents = payments.reduce((total, payment) => total + payment.reversedCents, 0);
    return {
      tab,
      orders,
      items,
      modifiers,
      payments,
      paymentSummary: {
        grossPaidCents,
        reversedCents,
        paidCents: grossPaidCents - reversedCents,
      },
      events,
      presence,
      doseClubRedemptions: doseClubRedemptionRows,
    };
  }

  async openTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: OpenTabInput,
    offlineIds?: { tabId: string },
  ) {
    this.assertPromisedAtNotPast(input.promisedAt);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      input.reservationId || input.waitlistEntryId
        ? "operations:reception:seat"
        : "operations:tabs:open",
    );
    await this.requireOperationalBilling(organizationId);
    if (input.responsibleIdentityId) {
      await this.requireOperationalIdentity(organizationId, unitId, input.responsibleIdentityId);
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.open",
      input,
      async (tx) => {
        let reservationPreviousStatus: "booked" | "confirmed" | null = null;
        let reservationServiceNotes: string | null = null;
        let waitlistPreviousStatus: "waiting" | "notified" | null = null;
        let customerId = input.customerId ?? null;
        let displayNumber: number | null = null;
        if (!input.tableId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-counter:${organizationId}:${unitId}:${new Date().toISOString().slice(0, 10)}`}))`,
          );
          const [next] = await tx
            .select({
              value: sql<number>`coalesce(max(${posTabs.displayNumber}), 0) + 1`,
            })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                isNull(posTabs.tableId),
                sql`${posTabs.createdAt}::date = current_date`,
              ),
            );
          displayNumber = Number(next?.value ?? 1);
        }
        if (input.tableId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
          );
          const [table] = await tx
            .select({ id: posDiningTables.id, status: posDiningTables.status })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
                eq(posDiningTables.active, true),
              ),
            )
            .limit(1);
          if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
          if (
            table.status !== "available" &&
            !(input.reservationId && table.status === "reserved")
          ) {
            throw new ConflictException({
              code: "TABLE_NOT_AVAILABLE",
              status: table.status,
            });
          }
          const [occupied] = await tx
            .select({ id: posTabs.id })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.tableId, input.tableId),
                eq(posTabs.status, "open"),
              ),
            )
            .limit(1);
          if (occupied) throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        if (input.reservationId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`growth-reservation:${organizationId}:${input.reservationId}`}))`,
          );
          const [reservation] = await tx
            .select({
              status: reservations.status,
              notes: reservations.notes,
              customerId: reservations.customerId,
            })
            .from(reservations)
            .where(
              and(
                eq(reservations.id, input.reservationId),
                eq(reservations.organizationId, organizationId),
                eq(reservations.unitId, unitId),
              ),
            )
            .limit(1);
          if (!reservation) throw new NotFoundException({ code: "RESERVATION_NOT_FOUND" });
          if (reservation.status !== "booked" && reservation.status !== "confirmed") {
            throw new ConflictException({
              code: "RESERVATION_NOT_SEATABLE",
              status: reservation.status,
            });
          }
          reservationPreviousStatus = reservation.status;
          reservationServiceNotes = reservation.notes;
          if (customerId && reservation.customerId && customerId !== reservation.customerId) {
            throw new ConflictException({ code: "RESERVATION_CUSTOMER_MISMATCH" });
          }
          customerId ??= reservation.customerId;
        }
        if (input.waitlistEntryId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`growth-waitlist:${organizationId}:${input.waitlistEntryId}`}))`,
          );
          const [entry] = await tx
            .select({ status: waitlistEntries.status, customerId: waitlistEntries.customerId })
            .from(waitlistEntries)
            .where(
              and(
                eq(waitlistEntries.id, input.waitlistEntryId),
                eq(waitlistEntries.organizationId, organizationId),
                eq(waitlistEntries.unitId, unitId),
              ),
            )
            .limit(1);
          if (!entry) throw new NotFoundException({ code: "WAITLIST_ENTRY_NOT_FOUND" });
          if (entry.status !== "waiting" && entry.status !== "notified") {
            throw new ConflictException({
              code: "WAITLIST_ENTRY_NOT_SEATABLE",
              status: entry.status,
            });
          }
          waitlistPreviousStatus = entry.status;
          if (customerId && entry.customerId && customerId !== entry.customerId) {
            throw new ConflictException({ code: "WAITLIST_CUSTOMER_MISMATCH" });
          }
          customerId ??= entry.customerId;
        }
        const [customer] = customerId
          ? await tx
              .select({
                id: growthCustomers.id,
                name: growthCustomers.name,
                phone: growthCustomers.phone,
              })
              .from(growthCustomers)
              .where(
                and(
                  eq(growthCustomers.organizationId, organizationId),
                  eq(growthCustomers.id, customerId),
                  isNull(growthCustomers.archivedAt),
                ),
              )
              .limit(1)
          : [];
        if (customerId && !customer) {
          throw new NotFoundException({ code: "CUSTOMER_NOT_FOUND" });
        }
        const [activeShift] = await tx
          .select({ id: posOperationalShifts.id })
          .from(posOperationalShifts)
          .where(
            and(
              eq(posOperationalShifts.organizationId, organizationId),
              eq(posOperationalShifts.unitId, unitId),
              eq(posOperationalShifts.status, "active"),
            ),
          )
          .limit(1);
        const [baseShiftSection] =
          input.tableId && activeShift
            ? await tx
                .select({ id: posShiftSectionTables.shiftSectionId })
                .from(posShiftSectionTables)
                .where(
                  and(
                    eq(posShiftSectionTables.organizationId, organizationId),
                    eq(posShiftSectionTables.unitId, unitId),
                    eq(posShiftSectionTables.shiftId, activeShift.id),
                    eq(posShiftSectionTables.tableId, input.tableId),
                  ),
                )
                .limit(1)
            : [];
        const [activeTableTransfer] =
          input.tableId && activeShift
            ? await tx
                .select({ id: posShiftTableTransfers.targetShiftSectionId })
                .from(posShiftTableTransfers)
                .where(
                  and(
                    eq(posShiftTableTransfers.organizationId, organizationId),
                    eq(posShiftTableTransfers.unitId, unitId),
                    eq(posShiftTableTransfers.shiftId, activeShift.id),
                    eq(posShiftTableTransfers.tableId, input.tableId),
                    isNull(posShiftTableTransfers.endedAt),
                    gt(posShiftTableTransfers.expiresAt, new Date()),
                  ),
                )
                .limit(1)
            : [];
        const shiftSection = activeTableTransfer ?? baseShiftSection;
        const [sectionPrimary] =
          shiftSection && activeShift
            ? await tx
                .select({ identityId: posShiftSectionStaff.identityId })
                .from(posShiftSectionStaff)
                .where(
                  and(
                    eq(posShiftSectionStaff.organizationId, organizationId),
                    eq(posShiftSectionStaff.unitId, unitId),
                    eq(posShiftSectionStaff.shiftId, activeShift.id),
                    eq(posShiftSectionStaff.shiftSectionId, shiftSection.id),
                    eq(posShiftSectionStaff.role, "primary"),
                  ),
                )
                .limit(1)
            : [];
        let [tableGroup] = input.tableId
          ? await tx
              .select({
                id: posDiningTableGroups.id,
                mode: posDiningTableGroups.mode,
                primaryTabId: posDiningTableGroups.primaryTabId,
                responsibleIdentityId: posDiningTableGroups.responsibleIdentityId,
              })
              .from(posDiningTableGroupMembers)
              .innerJoin(
                posDiningTableGroups,
                and(
                  eq(
                    posDiningTableGroups.organizationId,
                    posDiningTableGroupMembers.organizationId,
                  ),
                  eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
                  eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
                ),
              )
              .where(
                and(
                  eq(posDiningTableGroupMembers.organizationId, organizationId),
                  eq(posDiningTableGroupMembers.unitId, unitId),
                  eq(posDiningTableGroupMembers.tableId, input.tableId),
                  isNull(posDiningTableGroups.dissolvedAt),
                ),
              )
              .limit(1)
          : [];
        if (tableGroup?.mode === "single_tab") {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table-group:${organizationId}:${unitId}:${tableGroup.id}`}))`,
          );
          [tableGroup] = await tx
            .select({
              id: posDiningTableGroups.id,
              mode: posDiningTableGroups.mode,
              primaryTabId: posDiningTableGroups.primaryTabId,
              responsibleIdentityId: posDiningTableGroups.responsibleIdentityId,
            })
            .from(posDiningTableGroups)
            .where(
              and(
                eq(posDiningTableGroups.organizationId, organizationId),
                eq(posDiningTableGroups.unitId, unitId),
                eq(posDiningTableGroups.id, tableGroup.id),
                isNull(posDiningTableGroups.dissolvedAt),
              ),
            )
            .limit(1);
          if (tableGroup?.primaryTabId) {
            const [primaryTab] = await tx
              .select({ id: posTabs.id })
              .from(posTabs)
              .where(
                and(
                  eq(posTabs.organizationId, organizationId),
                  eq(posTabs.unitId, unitId),
                  eq(posTabs.id, tableGroup.primaryTabId),
                  eq(posTabs.status, "open"),
                ),
              )
              .limit(1);
            if (primaryTab) {
              throw new ConflictException({
                code: "TABLE_GROUP_OCCUPIED",
                message: "O grupo de mesas já possui uma comanda aberta.",
                tabId: primaryTab.id,
              });
            }
          }
        }
        const responsibleIdentityId =
          input.responsibleIdentityId ??
          tableGroup?.responsibleIdentityId ??
          sectionPrimary?.identityId ??
          identityId;
        const [settlementSettings] = await tx
          .select({ configuration: managementSettlementSettings.configuration })
          .from(managementSettlementSettings)
          .where(
            and(
              eq(managementSettlementSettings.organizationId, organizationId),
              eq(managementSettlementSettings.unitId, unitId),
            ),
          )
          .limit(1);
        const serviceConfiguration = settlementSettings?.configuration;
        const fulfillmentType = input.fulfillmentType ?? "dine_in";
        const serviceChargeBasisPoints = suggestedServiceChargeBasisPoints(
          fulfillmentType,
          serviceConfiguration,
        );
        const [tab] = await tx
          .insert(posTabs)
          .values({
            ...(offlineIds ? { id: offlineIds.tabId } : {}),
            organizationId,
            unitId,
            tableId: input.tableId,
            operationalShiftId: activeShift?.id,
            shiftSectionId: shiftSection?.id,
            responsibleIdentityId,
            label:
              input.label?.trim() ||
              input.customerName?.trim() ||
              (displayNumber ? `Balcão #${displayNumber}` : undefined),
            displayNumber,
            fulfillmentType,
            customerName: input.customerName?.trim() || customer?.name || undefined,
            customerPhone: input.customerPhone?.trim() || customer?.phone || undefined,
            readyNotificationConsent: input.readyNotificationConsent ?? false,
            serviceNotes: reservationServiceNotes ?? (input.serviceNotes?.trim() || undefined),
            deliveryAddress: input.deliveryAddress?.trim() || undefined,
            promisedAt: input.promisedAt ? new Date(input.promisedAt) : undefined,
            guestCount: input.guestCount,
            serviceChargeBasisPoints,
            openedByIdentityId: identityId,
          })
          .returning();
        if (!tab) throw new Error("Tab insert did not return a row");
        if (customerId) {
          await tx.insert(posTabCustomerLinks).values({
            organizationId,
            unitId,
            tabId: tab.id,
            customerId,
            linkedByIdentityId: identityId,
          });
        }
        if (input.tableId) {
          const occupiedTableIds =
            tableGroup?.mode === "single_tab"
              ? (
                  await tx
                    .select({ tableId: posDiningTableGroupMembers.tableId })
                    .from(posDiningTableGroupMembers)
                    .where(
                      and(
                        eq(posDiningTableGroupMembers.organizationId, organizationId),
                        eq(posDiningTableGroupMembers.unitId, unitId),
                        eq(posDiningTableGroupMembers.groupId, tableGroup.id),
                      ),
                    )
                ).map((member) => member.tableId)
              : [input.tableId];
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, occupiedTableIds),
              ),
            );
          if (tableGroup?.mode === "single_tab") {
            await tx
              .update(posDiningTableGroups)
              .set({ primaryTabId: tab.id, updatedAt: new Date() })
              .where(
                and(
                  eq(posDiningTableGroups.organizationId, organizationId),
                  eq(posDiningTableGroups.unitId, unitId),
                  eq(posDiningTableGroups.id, tableGroup.id),
                  isNull(posDiningTableGroups.dissolvedAt),
                ),
              );
          }
        }
        if (input.reservationId) {
          const [seated] = await tx
            .update(reservations)
            .set({ status: "seated", updatedAt: new Date() })
            .where(
              and(
                eq(reservations.id, input.reservationId),
                eq(reservations.organizationId, organizationId),
                eq(reservations.unitId, unitId),
                inArray(reservations.status, ["booked", "confirmed"]),
              ),
            )
            .returning({ id: reservations.id });
          if (!seated) throw new ConflictException({ code: "RESERVATION_NOT_SEATABLE" });
          await tx.insert(auditEvents).values({
            organizationId,
            unitId,
            actorIdentityId: identityId,
            action: "growth.reservation.transitioned",
            entityType: "growth_reservation",
            entityId: input.reservationId,
            metadata: { from: reservationPreviousStatus, to: "seated", tabId: tab.id },
          });
          await tx.insert(outboxEvents).values({
            topic: "growth.reservation_changed",
            aggregateType: "growth_reservation",
            aggregateId: input.reservationId,
            payload: {
              organizationId,
              unitId,
              from: reservationPreviousStatus,
              to: "seated",
              tabId: tab.id,
            },
          });
        }
        if (input.waitlistEntryId) {
          const [seated] = await tx
            .update(waitlistEntries)
            .set({ status: "seated", updatedAt: new Date() })
            .where(
              and(
                eq(waitlistEntries.id, input.waitlistEntryId),
                eq(waitlistEntries.organizationId, organizationId),
                eq(waitlistEntries.unitId, unitId),
                inArray(waitlistEntries.status, ["waiting", "notified"]),
              ),
            )
            .returning({ id: waitlistEntries.id });
          if (!seated) throw new ConflictException({ code: "WAITLIST_ENTRY_NOT_SEATABLE" });
          await tx.insert(auditEvents).values({
            organizationId,
            unitId,
            actorIdentityId: identityId,
            action: "growth.waitlist.transitioned",
            entityType: "growth_waitlist_entry",
            entityId: input.waitlistEntryId,
            metadata: { from: waitlistPreviousStatus, to: "seated", tabId: tab.id },
          });
          await tx.insert(outboxEvents).values({
            topic: "growth.waitlist_changed",
            aggregateType: "growth_waitlist_entry",
            aggregateId: input.waitlistEntryId,
            payload: {
              organizationId,
              unitId,
              from: waitlistPreviousStatus,
              to: "seated",
              tabId: tab.id,
            },
          });
        }
        await this.recordEvent(tx, identityId, organizationId, unitId, tab.id, "tab.opened", {
          tableId: input.tableId,
          guestCount: input.guestCount,
          displayNumber,
          fulfillmentType: input.fulfillmentType ?? "dine_in",
          operationalShiftId: activeShift?.id,
          shiftSectionId: shiftSection?.id,
          responsibleIdentityId,
          customerId,
          reservationId: input.reservationId,
          waitlistEntryId: input.waitlistEntryId,
        });
        return { tab };
      },
    );
  }

  async updateTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    input: UpdateTabInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    if (input.responsibleIdentityId) {
      await this.requireOperationalIdentity(organizationId, unitId, input.responsibleIdentityId);
    }
    return this.database.db.transaction(async (tx) => {
      const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
      if (tab.version !== input.expectedVersion) {
        throw new ConflictException({
          code: "TAB_VERSION_CONFLICT",
          message: "A comanda foi alterada por outra pessoa. Recarregue antes de salvar.",
          currentVersion: tab.version,
        });
      }
      if (input.promisedAt && tab.promisedAt?.getTime() !== new Date(input.promisedAt).getTime()) {
        this.assertPromisedAtNotPast(input.promisedAt);
      }
      const nextFulfillmentType = input.fulfillmentType ?? tab.fulfillmentType;
      const nextDeliveryAddress =
        input.deliveryAddress === undefined ? tab.deliveryAddress : input.deliveryAddress;
      if (nextFulfillmentType === "delivery" && !nextDeliveryAddress?.trim()) {
        throw new BadRequestException({
          code: "DELIVERY_ADDRESS_REQUIRED",
          message: "Informe o endereço do delivery.",
        });
      }
      const [updated] = await tx
        .update(posTabs)
        .set({
          label: input.label === undefined ? tab.label : input.label,
          fulfillmentType: input.fulfillmentType ?? tab.fulfillmentType,
          customerName: input.customerName === undefined ? tab.customerName : input.customerName,
          customerPhone:
            input.customerPhone === undefined ? tab.customerPhone : input.customerPhone,
          readyNotificationConsent:
            input.readyNotificationConsent === undefined
              ? tab.readyNotificationConsent
              : input.readyNotificationConsent,
          serviceNotes: input.serviceNotes === undefined ? tab.serviceNotes : input.serviceNotes,
          deliveryAddress:
            input.deliveryAddress === undefined ? tab.deliveryAddress : input.deliveryAddress,
          promisedAt:
            input.promisedAt === undefined
              ? tab.promisedAt
              : input.promisedAt
                ? new Date(input.promisedAt)
                : null,
          guestCount: input.guestCount ?? tab.guestCount,
          responsibleIdentityId:
            input.responsibleIdentityId === undefined
              ? tab.responsibleIdentityId
              : input.responsibleIdentityId,
          version: tab.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, tabId),
            eq(posTabs.version, input.expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "TAB_VERSION_CONFLICT" });
      await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "tab.updated", {
        version: updated.version,
        fulfillmentType: updated.fulfillmentType,
        responsibleIdentityId: updated.responsibleIdentityId,
      });
      return { tab: updated };
    });
  }

  async claimTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    input: ClaimTabInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalIdentity(organizationId, unitId, input.responsibleIdentityId);
    return this.database.db.transaction(async (tx) => {
      const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
      if (tab.version !== input.expectedVersion) {
        throw new ConflictException({
          code: "TAB_VERSION_CONFLICT",
          message: "A comanda foi alterada por outra pessoa. Recarregue antes de assumir.",
          currentVersion: tab.version,
        });
      }
      const [updated] = await tx
        .update(posTabs)
        .set({
          responsibleIdentityId: input.responsibleIdentityId,
          version: tab.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, tabId),
            eq(posTabs.version, input.expectedVersion),
            eq(posTabs.status, "open"),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "TAB_VERSION_CONFLICT" });
      await tx
        .update(posDiningTableGroups)
        .set({ responsibleIdentityId: input.responsibleIdentityId, updatedAt: new Date() })
        .where(
          and(
            eq(posDiningTableGroups.organizationId, organizationId),
            eq(posDiningTableGroups.unitId, unitId),
            eq(posDiningTableGroups.primaryTabId, tabId),
            isNull(posDiningTableGroups.dissolvedAt),
          ),
        );
      await this.recordEvent(
        tx,
        identityId,
        organizationId,
        unitId,
        tabId,
        "tab.responsibility_transferred",
        {
          from: tab.responsibleIdentityId,
          to: input.responsibleIdentityId,
          reason: input.reason,
          version: updated.version,
        },
      );
      return { tab: updated, previousResponsibleIdentityId: tab.responsibleIdentityId };
    });
  }

  async touchPresence(identityId: string, organizationId: string, unitId: string, tabId: string) {
    await this.requireAccess(identityId, organizationId, unitId);
    const [tab] = await this.database.db
      .select({ id: posTabs.id })
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
          eq(posTabs.status, "open"),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const expiresAt = new Date(Date.now() + 45_000);
    await this.database.db
      .insert(posTabPresence)
      .values({ organizationId, unitId, tabId, identityId, expiresAt })
      .onConflictDoUpdate({
        target: [
          posTabPresence.organizationId,
          posTabPresence.unitId,
          posTabPresence.tabId,
          posTabPresence.identityId,
        ],
        set: { expiresAt, updatedAt: new Date() },
      });
    return { active: true, expiresAt };
  }

  async createServiceCall(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    idempotencyKey: string,
    input: ServiceCallInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    if (input.tabId) {
      await this.requireTabOperationalAccess(identityId, organizationId, unitId, [input.tabId]);
    }
    if (input.installationId || input.terminalId || input.printerId) {
      await this.requireScopedCapability(
        identityId,
        organizationId,
        unitId,
        "operations:printing:request",
      );
    }
    return this.createServiceCallCore(
      identityId,
      organizationId,
      unitId,
      tableId,
      idempotencyKey,
      input,
      "ops",
    );
  }

  async createPublicServiceCall(
    organizationId: string,
    unitId: string,
    tableId: string,
    tabId: string | undefined,
    idempotencyKey: string,
    kind: "assistance" | "bill",
  ) {
    const identityId = await this.publicServiceIdentity(organizationId);
    return this.createServiceCallCore(
      identityId,
      organizationId,
      unitId,
      tableId,
      idempotencyKey,
      { kind, tabId, slaMinutes: kind === "bill" ? 5 : 3, copies: 1 },
      "qr_table",
    );
  }

  private async createServiceCallCore(
    identityId: string,
    organizationId: string,
    unitId: string,
    tableId: string,
    idempotencyKey: string,
    input: ServiceCallInput,
    channel: "ops" | "qr_table",
  ) {
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      channel === "qr_table" ? "public-table-service-call.create" : "service-call.create",
      { tableId, channel, ...input },
      async (tx) => {
        const { installationId, terminalId, printerId, copies, ...serviceCallInput } = input;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-service-call:${organizationId}:${unitId}:${tableId}:${serviceCallInput.kind}`}))`,
        );
        const [table] = await tx
          .select({ id: posDiningTables.id })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, tableId),
              eq(posDiningTables.active, true),
            ),
          )
          .limit(1);
        if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
        let responsibleIdentityId: string | null = null;
        if (serviceCallInput.tabId) {
          const [tab] = await tx
            .select({
              id: posTabs.id,
              status: posTabs.status,
              tableId: posTabs.tableId,
              responsibleIdentityId: posTabs.responsibleIdentityId,
            })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.id, serviceCallInput.tabId),
              ),
            )
            .limit(1);
          if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
          if (
            tab.status !== "open" ||
            !(await this.tableBelongsToTab(tx, organizationId, unitId, tableId, tab))
          ) {
            throw new ConflictException({
              code: "SERVICE_CALL_TAB_MISMATCH",
              message: "A comanda informada não está aberta nesta mesa.",
            });
          }
          responsibleIdentityId = tab.responsibleIdentityId;
        }
        const [existing] = await tx
          .select()
          .from(posServiceCalls)
          .where(
            and(
              eq(posServiceCalls.organizationId, organizationId),
              eq(posServiceCalls.unitId, unitId),
              eq(posServiceCalls.tableId, tableId),
              eq(posServiceCalls.kind, serviceCallInput.kind),
              ne(posServiceCalls.status, "resolved"),
            ),
          )
          .limit(1);
        if (existing) {
          const [existingPrintJob] = await tx
            .select()
            .from(posPrintJobs)
            .where(
              and(
                eq(posPrintJobs.organizationId, organizationId),
                eq(posPrintJobs.unitId, unitId),
                eq(posPrintJobs.serviceCallId, existing.id),
              ),
            )
            .orderBy(desc(posPrintJobs.createdAt))
            .limit(1);
          return {
            call: existing,
            duplicate: true,
            printJob: existingPrintJob ?? null,
            deliveryRoute: existingPrintJob ? "local" : "cashier",
          };
        }
        if (channel === "qr_table") {
          const [recent] = await tx
            .select({ id: posServiceCalls.id })
            .from(posServiceCalls)
            .where(
              and(
                eq(posServiceCalls.organizationId, organizationId),
                eq(posServiceCalls.unitId, unitId),
                eq(posServiceCalls.tableId, tableId),
                eq(posServiceCalls.kind, serviceCallInput.kind),
                gt(posServiceCalls.createdAt, new Date(Date.now() - 30_000)),
              ),
            )
            .limit(1);
          if (recent) {
            throw new HttpException(
              { code: "PUBLIC_SERVICE_CALL_COOLDOWN", retryAfterSeconds: 30 },
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
        }
        const [call] = await tx
          .insert(posServiceCalls)
          .values({ organizationId, unitId, tableId, ...serviceCallInput })
          .returning();
        if (!call) throw new Error("Service call insert did not return a row");
        if (call.tabId) {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            call.tabId,
            "call.opened",
            {
              callId: call.id,
              tableId,
              kind: call.kind,
              channel,
              responsibleIdentityId,
            },
            { entityType: "service_call", entityId: call.id },
          );
        } else {
          if (channel === "qr_table") {
            await tx.insert(auditEvents).values({
              organizationId,
              unitId,
              actorIdentityId: identityId,
              action: "pos.call.opened",
              entityType: "service_call",
              entityId: call.id,
              metadata: { tableId, kind: call.kind, channel, responsibleIdentityId },
            });
          }
          await tx.insert(outboxEvents).values({
            topic: "pos.call.opened",
            aggregateType: "service_call",
            aggregateId: call.id,
            payload: {
              organizationId,
              unitId,
              callId: call.id,
              tableId,
              kind: call.kind,
              channel,
              responsibleIdentityId,
            },
          });
        }
        let printJob: Awaited<ReturnType<PilotPosService["queuePrintJob"]>> | null = null;
        if (call.kind === "bill" && call.tabId) {
          const printInput: PrintJobInput = {
            documentType: "partial_statement",
            copies,
            installationId,
            terminalId,
            printerId,
            serviceCallId: call.id,
          };
          const target = await this.resolvePrintTarget(
            tx,
            identityId,
            organizationId,
            unitId,
            printInput,
          );
          if (target.deliveryRoute === "local") {
            printJob = await this.queuePrintJob(
              tx,
              identityId,
              organizationId,
              unitId,
              call.tabId,
              printInput,
            );
          }
        }
        return {
          call,
          duplicate: false,
          printJob,
          deliveryRoute: printJob ? "local" : "cashier",
        };
      },
    );
  }

  async transitionServiceCall(
    identityId: string,
    organizationId: string,
    unitId: string,
    callId: string,
    status: "acknowledged" | "resolved",
    idempotencyKey: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      `service-call.${status}`,
      { callId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-call:${organizationId}:${unitId}:${callId}`}))`,
        );
        const [call] = await tx
          .select()
          .from(posServiceCalls)
          .where(
            and(
              eq(posServiceCalls.organizationId, organizationId),
              eq(posServiceCalls.unitId, unitId),
              eq(posServiceCalls.id, callId),
            ),
          )
          .limit(1);
        if (!call) throw new NotFoundException({ code: "SERVICE_CALL_NOT_FOUND" });
        if (call.status === "resolved") return { call };
        if (status === "acknowledged" && call.status === "acknowledged") return { call };
        const now = new Date();
        const [updated] = await tx
          .update(posServiceCalls)
          .set(
            status === "acknowledged"
              ? {
                  status,
                  acknowledgedByIdentityId: identityId,
                  acknowledgedAt: now,
                  updatedAt: now,
                }
              : {
                  status,
                  resolvedByIdentityId: identityId,
                  resolvedAt: now,
                  updatedAt: now,
                },
          )
          .where(eq(posServiceCalls.id, callId))
          .returning();
        if (!updated) throw new Error("Service call update did not return a row");
        if (updated.tabId) {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            updated.tabId,
            status === "acknowledged" ? "call.acknowledged" : "call.resolved",
            { callId, tableId: updated.tableId },
          );
        } else {
          await tx.insert(outboxEvents).values({
            topic: `pos.call.${status}`,
            aggregateType: "service_call",
            aggregateId: callId,
            payload: { organizationId, unitId, callId, tableId: updated.tableId },
          });
        }
        return { call: updated };
      },
    );
  }

  private paymentAttemptView(attempt: typeof posPaymentAttempts.$inferSelect) {
    return {
      id: attempt.id,
      tabId: attempt.tabId,
      installationId: attempt.installationId,
      provider: attempt.provider,
      method: attempt.method,
      amountCents: attempt.amountCents,
      installments: attempt.installments,
      status: attempt.status,
      providerReference: attempt.providerReference,
      failureCode: attempt.failureCode,
      failureMessage: attempt.failureMessage,
      expiresAt: attempt.expiresAt,
      processingAt: attempt.processingAt,
      resolvedAt: attempt.resolvedAt,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    };
  }

  private paymentReversalView(reversal: typeof posPaymentReversals.$inferSelect) {
    return {
      id: reversal.id,
      paymentId: reversal.paymentId,
      installationId: reversal.installationId,
      amountCents: reversal.amountCents,
      reason: reversal.reason,
      status: reversal.status,
      providerReference: reversal.providerReference,
      failureCode: reversal.failureCode,
      resolvedAt: reversal.resolvedAt,
      createdAt: reversal.createdAt,
      updatedAt: reversal.updatedAt,
    };
  }

  private async lockTabPaymentState(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pos-payment:${organizationId}:${unitId}:${tabId}`}))`,
    );
    const [paymentTotals, reversalTotals, reservationTotals, lossTotals] = await Promise.all([
      tx
        .select({ paidCents: sql<number>`coalesce(sum(${posTabPayments.amountCents}), 0)` })
        .from(posTabPayments)
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            eq(posTabPayments.tabId, tabId),
          ),
        ),
      tx
        .select({
          reversedCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`,
        })
        .from(posPaymentReversals)
        .innerJoin(posTabPayments, eq(posTabPayments.id, posPaymentReversals.paymentId))
        .where(
          and(
            eq(posPaymentReversals.organizationId, organizationId),
            eq(posPaymentReversals.unitId, unitId),
            eq(posPaymentReversals.status, "approved"),
            eq(posTabPayments.tabId, tabId),
          ),
        ),
      tx
        .select({
          reservedCents: sql<number>`coalesce(sum(${posPaymentAttempts.amountCents}) filter (where ${posPaymentAttempts.status} in ('processing', 'unknown') or (${posPaymentAttempts.status} = 'created' and ${posPaymentAttempts.expiresAt} > now())), 0)`,
        })
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, organizationId),
            eq(posPaymentAttempts.unitId, unitId),
            eq(posPaymentAttempts.tabId, tabId),
          ),
        ),
      tx
        .select({
          coveredLossCents: sql<number>`coalesce(sum(${managementOperationalLosses.amountCents}) filter (where ${managementOperationalLosses.status} = 'approved' and ${managementOperationalLosses.type} = 'unpaid_tab'), 0)`,
        })
        .from(managementOperationalLosses)
        .where(
          and(
            eq(managementOperationalLosses.organizationId, organizationId),
            eq(managementOperationalLosses.unitId, unitId),
            eq(managementOperationalLosses.tabId, tabId),
          ),
        ),
    ]);
    return {
      paidCents:
        Number(paymentTotals[0]?.paidCents ?? 0) - Number(reversalTotals[0]?.reversedCents ?? 0),
      reservedCents: Number(reservationTotals[0]?.reservedCents ?? 0),
      coveredLossCents: Number(lossTotals[0]?.coveredLossCents ?? 0),
    };
  }

  private assertTabPaymentFloor(
    totalCents: number,
    state: { paidCents: number; reservedCents: number; coveredLossCents: number },
  ) {
    const committedCents = state.paidCents + state.reservedCents + state.coveredLossCents;
    if (totalCents < committedCents) {
      throw new ConflictException({
        code: "TAB_TOTAL_BELOW_COMMITTED_PAYMENTS",
        message: "O novo total não pode ficar abaixo de pagamentos e cobranças reservadas.",
        paidCents: state.paidCents,
        reservedCents: state.reservedCents,
        coveredLossCents: state.coveredLossCents,
        minimumTotalCents: committedCents,
      });
    }
  }

  private paymentCapability(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    return this.smartPos.paymentCapability(tx, organizationId, unitId, installationId);
  }
  async getPaymentCapabilities(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, SYSTEM_ROLES);
    return this.database.db.transaction((tx) =>
      this.paymentCapability(tx, organizationId, unitId, installationId),
    );
  }

  async configurePaymentTerminal(
    organizationId: string,
    unitId: string,
    installationId: string,
    input: PaymentTerminalConfigurationInput,
  ) {
    return this.database.db.transaction(async (tx) => {
      await this.smartPos.lockPaymentInstallation(tx, organizationId, unitId, installationId);
      const [device] = await tx
        .select({ id: deviceEnrollments.id })
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.organizationId, organizationId),
            eq(deviceEnrollments.unitId, unitId),
            eq(deviceEnrollments.id, installationId),
            isNull(deviceEnrollments.revokedAt),
          ),
        )
        .limit(1);
      if (!device) throw new NotFoundException({ code: "PAYMENT_DEVICE_NOT_ENROLLED" });
      const [certification] = input.certificationId
        ? await tx
            .select()
            .from(posPaymentTerminalCertifications)
            .where(
              and(
                eq(posPaymentTerminalCertifications.organizationId, organizationId),
                eq(posPaymentTerminalCertifications.unitId, unitId),
                eq(posPaymentTerminalCertifications.id, input.certificationId),
              ),
            )
            .limit(1)
        : [];
      if (input.status === "homologated") {
        if (!certification || certification.provider !== input.provider) {
          throw new BadRequestException({ code: "PAYMENT_CERTIFICATION_INVALID" });
        }
        const certifiedMethods = new Set(certification.methods);
        if (
          certification.status !== "approved" ||
          certification.killSwitchEnabled ||
          input.methods.some((method) => !certifiedMethods.has(method)) ||
          input.maxInstallments > certification.maxInstallments ||
          (input.supports.cancel && !certification.supportsCancel) ||
          (input.supports.recover && !certification.supportsRecover) ||
          (input.supports.reversal && !certification.supportsReversal)
        ) {
          throw new BadRequestException({ code: "PAYMENT_CONFIGURATION_EXCEEDS_CERTIFICATION" });
        }
      }
      const [profile] = await tx
        .update(posTerminalProfiles)
        .set({
          paymentProvider: input.provider,
          paymentStatus: input.status,
          paymentCertificationId: input.certificationId,
          paymentMethods: input.methods,
          maxPaymentInstallments: input.maxInstallments,
          paymentSupportsCancel: input.supports.cancel,
          paymentSupportsRecover: input.supports.recover,
          paymentSupportsReversal: input.supports.reversal,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posTerminalProfiles.organizationId, organizationId),
            eq(posTerminalProfiles.unitId, unitId),
            eq(posTerminalProfiles.installationId, installationId),
          ),
        )
        .returning({ installationId: posTerminalProfiles.installationId });
      if (!profile) throw new NotFoundException({ code: "TERMINAL_PROFILE_NOT_FOUND" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        action: "pos.payment_terminal_configured",
        entityType: "payment_terminal",
        entityId: installationId,
        metadata: input,
      });
      await tx.insert(outboxEvents).values({
        topic: "pos.payment_terminal_configured",
        aggregateType: "payment_terminal",
        aggregateId: installationId,
        payload: { organizationId, unitId, installationId, ...input },
      });
      return this.paymentCapability(tx, organizationId, unitId, installationId);
    });
  }

  async createPaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: PaymentAttemptCreateInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:payments:record",
    );
    const terminalProfile = await this.terminalExecutionProfile(
      organizationId,
      unitId,
      input.installationId,
    );
    if (
      terminalProfile.paymentMode !== "homologated_pos" ||
      terminalProfile.paymentStatus !== "homologated"
    ) {
      throw new ConflictException({
        code: "HOMOLOGATED_POS_REQUIRED",
        route: terminalProfile.paymentMode === "cashier" ? "cashier" : "cashier_fallback",
      });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payment-attempt.create",
      { tabId, ...input },
      async (tx) => {
        await this.smartPos.lockPaymentInstallation(
          tx,
          organizationId,
          unitId,
          input.installationId,
        );
        const paymentState = await this.lockTabPaymentState(tx, organizationId, unitId, tabId);
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const capability = await this.paymentCapability(
          tx,
          organizationId,
          unitId,
          input.installationId,
        );
        if (!capability.available || !capability.provider) {
          throw new ConflictException({
            code: capability.reason ?? "PAYMENT_TERMINAL_UNAVAILABLE",
            message: "Este terminal não está homologado para pagamento integrado.",
          });
        }
        if (!capability.methods.includes(input.method)) {
          throw new ConflictException({
            code: "PAYMENT_METHOD_UNAVAILABLE",
            message: "Método indisponível neste terminal.",
          });
        }
        if (input.installments > capability.maxInstallments) {
          throw new ConflictException({
            code: "PAYMENT_INSTALLMENTS_UNAVAILABLE",
            message: "Parcelamento indisponível neste terminal.",
            maxInstallments: capability.maxInstallments,
          });
        }
        const remainingCents =
          tab.totalCents -
          paymentState.paidCents -
          paymentState.reservedCents -
          paymentState.coveredLossCents;
        if (input.amountCents > remainingCents) {
          throw new ConflictException({
            code: "TAB_PAYMENT_AMOUNT_UNAVAILABLE",
            message: "O valor excede o saldo livre da comanda.",
            remainingCents: Math.max(0, remainingCents),
          });
        }
        const now = new Date();
        const [attempt] = await tx
          .insert(posPaymentAttempts)
          .values({
            organizationId,
            unitId,
            tabId,
            installationId: input.installationId,
            requestedByIdentityId: identityId,
            provider: capability.provider,
            method: input.method,
            amountCents: input.amountCents,
            installments: input.installments,
            expiresAt: paymentAttemptExpiresAt(now),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!attempt) throw new Error("Payment attempt insert did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "payment.attempt_created",
          {
            attemptId: attempt.id,
            installationId: attempt.installationId,
            provider: attempt.provider,
            method: attempt.method,
            amountCents: attempt.amountCents,
          },
          { entityType: "payment_attempt", entityId: attempt.id },
        );
        return {
          attempt: this.paymentAttemptView(attempt),
          action: { type: "start", attemptId: attempt.id, provider: attempt.provider },
        };
      },
    );
  }

  async getPaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    attemptId: string,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:payments:record",
    );
    const [attempt] = await this.database.db
      .select()
      .from(posPaymentAttempts)
      .where(
        and(
          eq(posPaymentAttempts.organizationId, organizationId),
          eq(posPaymentAttempts.unitId, unitId),
          eq(posPaymentAttempts.id, attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
    return { attempt: this.paymentAttemptView(attempt) };
  }

  async recoverPaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    attemptId: string,
    idempotencyKey: string,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:payments:record",
    );
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payment-attempt.recover",
      { attemptId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-attempt:${attemptId}`}))`,
        );
        const [attempt] = await tx
          .select()
          .from(posPaymentAttempts)
          .where(
            and(
              eq(posPaymentAttempts.organizationId, organizationId),
              eq(posPaymentAttempts.unitId, unitId),
              eq(posPaymentAttempts.id, attemptId),
            ),
          )
          .limit(1);
        if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
        if (["approved", "declined", "canceled", "reversed"].includes(attempt.status)) {
          return { attempt: this.paymentAttemptView(attempt), action: null };
        }
        if (attempt.status === "created") {
          const now = new Date();
          if (attempt.expiresAt > now) {
            throw new ConflictException({
              code: "PAYMENT_ATTEMPT_NOT_STARTED",
              message: "Inicie a cobrança antes de solicitar recuperação.",
            });
          }
          const [expired] = await tx
            .update(posPaymentAttempts)
            .set({
              status: "canceled",
              failureCode: "PAYMENT_ATTEMPT_EXPIRED",
              failureMessage: "A tentativa expirou antes de abrir o provedor.",
              resolvedAt: now,
              updatedAt: now,
            })
            .where(eq(posPaymentAttempts.id, attempt.id))
            .returning();
          if (!expired) throw new Error("Expired payment attempt update did not return a row");
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            attempt.tabId,
            "payment.attempt_expired",
            { attemptId, installationId: attempt.installationId },
            { entityType: "payment_attempt", entityId: attemptId },
          );
          return { attempt: this.paymentAttemptView(expired), action: null };
        }
        const capability = await this.paymentCapability(
          tx,
          organizationId,
          unitId,
          attempt.installationId,
        );
        if (!capability.available || !capability.supports.recover) {
          throw new ConflictException({
            code: "PAYMENT_RECOVERY_UNAVAILABLE",
            message: "A recuperação não está disponível neste terminal.",
          });
        }
        const now = new Date();
        const [updated] = await tx
          .update(posPaymentAttempts)
          .set({
            status: "processing",
            processingAt: attempt.processingAt ?? now,
            recoveryRequestedAt: now,
            updatedAt: now,
          })
          .where(eq(posPaymentAttempts.id, attempt.id))
          .returning();
        if (!updated) throw new Error("Payment attempt recovery did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          attempt.tabId,
          "payment.recovery_requested",
          { attemptId, installationId: attempt.installationId },
          { entityType: "payment_attempt", entityId: attemptId },
        );
        return {
          attempt: this.paymentAttemptView(updated),
          action: { type: "recover", attemptId, provider: attempt.provider },
        };
      },
    );
  }

  async cancelPaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    attemptId: string,
    idempotencyKey: string,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:payments:record",
    );
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payment-attempt.cancel",
      { attemptId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-attempt:${attemptId}`}))`,
        );
        const [attempt] = await tx
          .select()
          .from(posPaymentAttempts)
          .where(
            and(
              eq(posPaymentAttempts.organizationId, organizationId),
              eq(posPaymentAttempts.unitId, unitId),
              eq(posPaymentAttempts.id, attemptId),
            ),
          )
          .limit(1);
        if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
        if (["approved", "declined", "canceled", "reversed"].includes(attempt.status)) {
          return { attempt: this.paymentAttemptView(attempt), action: null };
        }
        if (attempt.status === "unknown") {
          throw new ConflictException({
            code: "PAYMENT_RECOVERY_REQUIRED",
            message: "Verifique o resultado antes de cancelar uma cobrança incerta.",
          });
        }
        const now = new Date();
        if (attempt.status === "created") {
          const [canceled] = await tx
            .update(posPaymentAttempts)
            .set({ status: "canceled", cancelRequestedAt: now, resolvedAt: now, updatedAt: now })
            .where(eq(posPaymentAttempts.id, attempt.id))
            .returning();
          if (!canceled) throw new Error("Payment attempt cancel did not return a row");
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            attempt.tabId,
            "payment.attempt_canceled",
            { attemptId },
            { entityType: "payment_attempt", entityId: attemptId },
          );
          return { attempt: this.paymentAttemptView(canceled), action: null };
        }
        const capability = await this.paymentCapability(
          tx,
          organizationId,
          unitId,
          attempt.installationId,
        );
        if (!capability.available || !capability.supports.cancel) {
          throw new ConflictException({
            code: "PAYMENT_CANCEL_UNAVAILABLE",
            message: "Cancelamento indisponível neste terminal.",
          });
        }
        const [updated] = await tx
          .update(posPaymentAttempts)
          .set({ cancelRequestedAt: now, updatedAt: now })
          .where(eq(posPaymentAttempts.id, attempt.id))
          .returning();
        if (!updated) throw new Error("Payment attempt cancel request did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          attempt.tabId,
          "payment.cancel_requested",
          { attemptId, installationId: attempt.installationId },
          { entityType: "payment_attempt", entityId: attemptId },
        );
        return {
          attempt: this.paymentAttemptView(updated),
          action: { type: "cancel", attemptId, provider: attempt.provider },
        };
      },
    );
  }

  async requestPaymentReversal(
    identityId: string,
    organizationId: string,
    unitId: string,
    paymentId: string,
    idempotencyKey: string,
    input: PaymentReversalCreateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "payment.reversal.create",
      { paymentId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-reversal:${organizationId}:${unitId}:${paymentId}`}))`,
        );
        const [payment] = await tx
          .select({
            id: posTabPayments.id,
            tabId: posTabPayments.tabId,
            amountCents: posTabPayments.amountCents,
            paymentAttemptId: posTabPayments.paymentAttemptId,
            source: posTabPayments.source,
            verified: posTabPayments.verified,
            attemptStatus: posPaymentAttempts.status,
            installationId: posPaymentAttempts.installationId,
            provider: posPaymentAttempts.provider,
          })
          .from(posTabPayments)
          .leftJoin(posPaymentAttempts, eq(posPaymentAttempts.id, posTabPayments.paymentAttemptId))
          .where(
            and(
              eq(posTabPayments.organizationId, organizationId),
              eq(posTabPayments.unitId, unitId),
              eq(posTabPayments.id, paymentId),
            ),
          )
          .limit(1);
        if (
          payment?.source !== "terminal" ||
          !payment.verified ||
          !payment.paymentAttemptId ||
          !payment.installationId ||
          !payment.provider
        ) {
          throw new ConflictException({ code: "PAYMENT_REVERSAL_REQUIRES_VERIFIED_TERMINAL" });
        }
        const [fiscalDocument] = await tx
          .select({ status: fiscalDocuments.status })
          .from(fiscalDocuments)
          .where(
            and(
              eq(fiscalDocuments.organizationId, organizationId),
              eq(fiscalDocuments.unitId, unitId),
              eq(fiscalDocuments.tabId, payment.tabId),
              inArray(fiscalDocuments.status, [
                "pending",
                "processing",
                "authorized",
                "contingency",
              ]),
            ),
          )
          .limit(1);
        if (fiscalDocument) {
          throw new ConflictException({
            code: "PAYMENT_REVERSAL_REQUIRES_FISCAL_CANCELLATION",
            message: "Cancele a NFC-e antes de estornar o pagamento.",
          });
        }
        const [queuedFiscalEmission] = await tx.execute<{ active: boolean }>(sql`
          select true as active
          from outbox_events events
          inner join fiscal_profiles profiles
            on profiles.organization_id = ${organizationId}
           and profiles.unit_id = ${unitId}
           and profiles.provider = 'focus'
          where events.topic = 'pos.tab.closed'
            and events.aggregate_id = ${payment.tabId}
            and profiles.settings #>> '{focus,status}' = 'ready'
            and coalesce((profiles.settings #>> '{focus,enabled,nfce}')::boolean, false)
          limit 1
        `);
        if (queuedFiscalEmission?.active) {
          throw new ConflictException({
            code: "PAYMENT_REVERSAL_REQUIRES_FISCAL_CANCELLATION",
            message: "Aguarde a NFC-e e cancele-a antes de estornar o pagamento.",
          });
        }
        await this.smartPos.lockPaymentInstallation(
          tx,
          organizationId,
          unitId,
          payment.installationId,
        );
        if (payment.attemptStatus === "reversed") {
          throw new ConflictException({ code: "PAYMENT_ALREADY_REVERSED" });
        }
        if (payment.attemptStatus !== "approved") {
          throw new ConflictException({ code: "PAYMENT_REVERSAL_INVALID_ATTEMPT_STATE" });
        }
        await this.lockTabPaymentState(tx, organizationId, unitId, payment.tabId);
        const capability = await this.paymentCapability(
          tx,
          organizationId,
          unitId,
          payment.installationId,
        );
        if (
          !capability.available ||
          !capability.supports.reversal ||
          capability.provider !== payment.provider
        ) {
          throw new ConflictException({ code: "PAYMENT_REVERSAL_UNAVAILABLE" });
        }
        const [reversal] = await tx
          .insert(posPaymentReversals)
          .values({
            organizationId,
            unitId,
            paymentId,
            paymentAttemptId: payment.paymentAttemptId,
            installationId: payment.installationId,
            requestedByIdentityId: identityId,
            amountCents: payment.amountCents,
            reason: input.reason,
          })
          .returning();
        if (!reversal) throw new Error("Payment reversal insert did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          payment.tabId,
          "payment.reversal_requested",
          {
            reversalId: reversal.id,
            paymentId,
            paymentAttemptId: payment.paymentAttemptId,
            amountCents: payment.amountCents,
          },
          { entityType: "payment_reversal", entityId: reversal.id },
        );
        return {
          reversal: this.paymentReversalView(reversal),
          action: {
            type: "reverse" as const,
            reversalId: reversal.id,
            paymentAttemptId: payment.paymentAttemptId,
            provider: payment.provider,
          },
        };
      },
    );
  }

  private requirePaymentDevice(tx: Transaction, request: PaymentDeviceSignature) {
    return this.smartPos.authenticatePaymentDevice(tx, request);
  }

  async getDevicePaymentAttempt(request: PaymentDeviceSignature, attemptId: string) {
    return this.database.db.transaction(async (tx) => {
      const device = await this.requirePaymentDevice(tx, request);
      const [attempt] = await tx
        .select()
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, device.organizationId),
            eq(posPaymentAttempts.unitId, device.unitId),
            eq(posPaymentAttempts.installationId, device.id),
            eq(posPaymentAttempts.id, attemptId),
          ),
        )
        .limit(1);
      if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
      if (attempt.status === "created") {
        throw new ConflictException({
          code:
            attempt.expiresAt <= new Date()
              ? "PAYMENT_ATTEMPT_EXPIRED"
              : "PAYMENT_ATTEMPT_MUST_BE_CLAIMED",
          message: "A tentativa precisa ser reivindicada antes de abrir o provedor.",
        });
      }
      return { attempt: this.paymentAttemptView(attempt) };
    });
  }

  async claimDevicePaymentAttempt(request: PaymentDeviceSignature, attemptId: string) {
    const result = await this.database.db.transaction(async (tx) => {
      const device = await this.requirePaymentDevice(tx, request);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pos-attempt:${attemptId}`}))`);
      const [current] = await tx
        .select()
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, device.organizationId),
            eq(posPaymentAttempts.unitId, device.unitId),
            eq(posPaymentAttempts.installationId, device.id),
            eq(posPaymentAttempts.id, attemptId),
          ),
        )
        .limit(1);
      if (!current) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
      if (current.status === "processing" || current.status === "unknown") {
        const capability = await this.paymentCapability(
          tx,
          current.organizationId,
          current.unitId,
          current.installationId,
        );
        const action = current.cancelRequestedAt ? ("cancel" as const) : ("recover" as const);
        if (
          (action === "cancel" && !capability.supports.cancel) ||
          (action === "recover" && !capability.supports.recover)
        ) {
          throw new ConflictException({
            code:
              action === "cancel" ? "PAYMENT_CANCEL_UNAVAILABLE" : "PAYMENT_RECOVERY_UNAVAILABLE",
          });
        }
        return { attempt: current, action, capability };
      }
      if (current.status !== "created") {
        throw new ConflictException({
          code: "PAYMENT_ATTEMPT_ALREADY_RESOLVED",
          message: "A tentativa não está disponível para iniciar.",
        });
      }
      const now = new Date();
      if (current.expiresAt <= now) {
        const [expired] = await tx
          .update(posPaymentAttempts)
          .set({
            status: "canceled",
            failureCode: "PAYMENT_ATTEMPT_EXPIRED",
            failureMessage: "A tentativa expirou antes de abrir o provedor.",
            resolvedAt: now,
            updatedAt: now,
          })
          .where(eq(posPaymentAttempts.id, current.id))
          .returning();
        if (!expired) throw new Error("Expired payment attempt update did not return a row");
        await this.recordEvent(
          tx,
          current.requestedByIdentityId,
          current.organizationId,
          current.unitId,
          current.tabId,
          "payment.attempt_expired",
          { attemptId, installationId: current.installationId },
          { entityType: "payment_attempt", entityId: attemptId },
        );
        return { attempt: expired, action: null };
      }
      const paymentState = await this.lockTabPaymentState(
        tx,
        current.organizationId,
        current.unitId,
        current.tabId,
      );
      const tab = await this.requireOpenTab(
        tx,
        current.organizationId,
        current.unitId,
        current.tabId,
      );
      this.assertTabPaymentFloor(tab.totalCents, paymentState);
      const capability = await this.paymentCapability(
        tx,
        current.organizationId,
        current.unitId,
        current.installationId,
      );
      if (!capability.available || capability.provider !== current.provider) {
        throw new ConflictException({
          code: "PAYMENT_TERMINAL_UNAVAILABLE",
          message: "O terminal deixou de estar homologado para esta tentativa.",
        });
      }
      const [claimed] = await tx
        .update(posPaymentAttempts)
        .set({ status: "processing", processingAt: now, updatedAt: now })
        .where(eq(posPaymentAttempts.id, current.id))
        .returning();
      if (!claimed) throw new Error("Payment attempt claim did not return a row");
      await this.recordEvent(
        tx,
        current.requestedByIdentityId,
        current.organizationId,
        current.unitId,
        current.tabId,
        "payment.attempt_claimed",
        { attemptId, installationId: current.installationId, provider: current.provider },
        { entityType: "payment_attempt", entityId: attemptId },
      );
      return { attempt: claimed, action: "start" as const, capability };
    });
    if (result.attempt.failureCode === "PAYMENT_ATTEMPT_EXPIRED") {
      throw new ConflictException({
        code: "PAYMENT_ATTEMPT_EXPIRED",
        message: "A tentativa expirou antes de abrir o provedor.",
      });
    }
    if (!result.action || !result.capability?.certification) {
      throw new ConflictException({ code: "PAYMENT_CERTIFICATION_MISSING" });
    }
    return {
      attempt: this.paymentAttemptView(result.attempt),
      action: result.action,
      capabilities: result.capability,
      certification: result.capability.certification,
    };
  }

  async recordDevicePaymentResult(
    request: PaymentDeviceSignature,
    attemptId: string,
    input: PaymentDeviceResultInput,
  ) {
    const resultHash = requestHash(`payment-device-result:${attemptId}`, input);
    const result = await this.database.db.transaction(async (tx) => {
      const device = await this.requirePaymentDevice(tx, request);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pos-attempt:${attemptId}`}))`);
      const [attempt] = await tx
        .select()
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, device.organizationId),
            eq(posPaymentAttempts.unitId, device.unitId),
            eq(posPaymentAttempts.installationId, device.id),
            eq(posPaymentAttempts.id, attemptId),
          ),
        )
        .limit(1);
      if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
      const [existingResult] = await tx
        .select({
          attemptId: posPaymentAttemptResults.attemptId,
          requestHash: posPaymentAttemptResults.requestHash,
        })
        .from(posPaymentAttemptResults)
        .where(
          and(
            eq(posPaymentAttemptResults.organizationId, device.organizationId),
            eq(posPaymentAttemptResults.unitId, device.unitId),
            eq(posPaymentAttemptResults.installationId, device.id),
            eq(posPaymentAttemptResults.deviceResultId, input.resultId),
          ),
        )
        .limit(1);
      if (existingResult) {
        if (existingResult.attemptId !== attemptId || existingResult.requestHash !== resultHash) {
          if (["approved", "declined", "canceled", "reversed"].includes(attempt.status)) {
            if (
              !(await this.hasRecordedPaymentResultIncident(
                tx,
                attempt.organizationId,
                attempt.unitId,
                "pos.payment.attempt_result_conflict",
                attemptId,
                resultHash,
              ))
            ) {
              await this.recordEvent(
                tx,
                attempt.requestedByIdentityId,
                attempt.organizationId,
                attempt.unitId,
                attempt.tabId,
                "payment.attempt_result_conflict",
                {
                  attemptId,
                  installationId: attempt.installationId,
                  currentStatus: attempt.status,
                  reportedStatus: input.status,
                  resultId: input.resultId,
                  requestHash: resultHash,
                  failureCode: input.failureCode ?? null,
                },
                { entityType: "payment_attempt", entityId: attemptId },
              );
            }
            return { terminalResultConflict: true as const };
          }
          throw new ConflictException({
            code: "PAYMENT_DEVICE_RESULT_CONFLICT",
            message: "O identificador do resultado já foi usado com outro conteúdo.",
          });
        }
        if (
          ["approved", "declined", "canceled", "reversed"].includes(attempt.status) &&
          (await this.hasRecordedPaymentResultIncident(
            tx,
            attempt.organizationId,
            attempt.unitId,
            "pos.payment.attempt_result_conflict",
            attemptId,
            resultHash,
          ))
        ) {
          return { terminalResultConflict: true as const };
        }
        return { attempt: this.paymentAttemptView(attempt), idempotentReplay: true };
      }
      if (["approved", "declined", "canceled", "reversed"].includes(attempt.status)) {
        await tx.insert(posPaymentAttemptResults).values({
          organizationId: device.organizationId,
          unitId: device.unitId,
          attemptId,
          installationId: device.id,
          deviceResultId: input.resultId,
          requestHash: resultHash,
          status: input.status,
          providerReference: input.providerReference,
          authorizationCode: input.authorizationCode,
          failureCode: input.failureCode,
          failureMessage: input.failureCode ? "Falha reportada pelo provedor de pagamento." : null,
          occurredAt: new Date(input.occurredAt),
        });
        await this.recordEvent(
          tx,
          attempt.requestedByIdentityId,
          attempt.organizationId,
          attempt.unitId,
          attempt.tabId,
          "payment.attempt_result_conflict",
          {
            attemptId,
            installationId: attempt.installationId,
            currentStatus: attempt.status,
            reportedStatus: input.status,
            resultId: input.resultId,
            requestHash: resultHash,
            failureCode: input.failureCode ?? null,
          },
          { entityType: "payment_attempt", entityId: attemptId },
        );
        return { terminalResultConflict: true as const };
      }
      assertPaymentDeviceTransition(attempt.status as PaymentAttemptStatus, input.status);
      if (input.status === "approved" && input.providerReference) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-provider-ref:${attempt.organizationId}:${attempt.unitId}:${attempt.provider}:${input.providerReference}`}))`,
        );
        const [referenceOwner] = await tx
          .select({ id: posPaymentAttempts.id })
          .from(posPaymentAttempts)
          .where(
            and(
              eq(posPaymentAttempts.organizationId, device.organizationId),
              eq(posPaymentAttempts.unitId, device.unitId),
              eq(posPaymentAttempts.provider, attempt.provider),
              eq(posPaymentAttempts.providerReference, input.providerReference),
            ),
          )
          .limit(1);
        if (referenceOwner && referenceOwner.id !== attemptId) {
          throw new ConflictException({
            code: "PAYMENT_PROVIDER_REFERENCE_CONFLICT",
            message: "A referência do provedor já pertence a outra tentativa.",
          });
        }
      }
      const occurredAt = new Date(input.occurredAt);
      const now = new Date();
      const terminal = ["approved", "declined", "canceled"].includes(input.status);
      const failureMessage = input.failureCode
        ? "Falha reportada pelo provedor de pagamento."
        : null;
      const [updated] = await tx
        .update(posPaymentAttempts)
        .set({
          status: input.status,
          providerReference: input.providerReference ?? attempt.providerReference,
          authorizationCode: input.authorizationCode ?? null,
          failureCode: input.failureCode ?? null,
          failureMessage,
          processingAt:
            input.status === "processing" ? (attempt.processingAt ?? now) : attempt.processingAt,
          resolvedAt: terminal ? now : null,
          updatedAt: now,
        })
        .where(eq(posPaymentAttempts.id, attempt.id))
        .returning();
      if (!updated) throw new Error("Payment attempt result did not return a row");
      await tx.insert(posPaymentAttemptResults).values({
        organizationId: device.organizationId,
        unitId: device.unitId,
        attemptId,
        installationId: device.id,
        deviceResultId: input.resultId,
        requestHash: resultHash,
        status: input.status,
        providerReference: input.providerReference,
        authorizationCode: input.authorizationCode,
        failureCode: input.failureCode,
        failureMessage,
        occurredAt,
      });
      let paymentId: string | null = null;
      if (input.status === "approved") {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-payment:${attempt.organizationId}:${attempt.unitId}:${attempt.tabId}`}))`,
        );
        const [existingPayment] = await tx
          .select({ id: posTabPayments.id })
          .from(posTabPayments)
          .where(
            and(
              eq(posTabPayments.organizationId, attempt.organizationId),
              eq(posTabPayments.unitId, attempt.unitId),
              eq(posTabPayments.paymentAttemptId, attempt.id),
            ),
          )
          .limit(1);
        if (existingPayment) {
          paymentId = existingPayment.id;
        } else {
          const payment = await this.createPosPayment(
            tx,
            {
              organizationId: attempt.organizationId,
              unitId: attempt.unitId,
              tabId: attempt.tabId,
              method: attempt.method,
              amountCents: attempt.amountCents,
              reference: input.providerReference,
              paymentAttemptId: attempt.id,
              source: "terminal",
              verified: true,
              createdByIdentityId: attempt.requestedByIdentityId,
              createdAt: now,
            },
            { installationId: attempt.installationId },
          );
          paymentId = payment.id;
        }
      }
      await this.recordEvent(
        tx,
        attempt.requestedByIdentityId,
        attempt.organizationId,
        attempt.unitId,
        attempt.tabId,
        input.status === "approved" ? "payment.recorded" : `payment.attempt_${input.status}`,
        {
          attemptId,
          paymentId,
          installationId: attempt.installationId,
          provider: attempt.provider,
          method: attempt.method,
          amountCents: attempt.amountCents,
          resultId: input.resultId,
          failureCode: input.failureCode ?? null,
        },
        { entityType: "payment_attempt", entityId: attemptId },
      );
      return {
        attempt: this.paymentAttemptView(updated),
        paymentId,
        idempotentReplay: false,
      };
    });
    if ("terminalResultConflict" in result) {
      throw new ConflictException({
        code: "PAYMENT_DEVICE_RESULT_TERMINAL_CONFLICT",
        message: "O resultado conflitante foi preservado para reconciliação financeira.",
      });
    }
    return result;
  }

  async claimDevicePaymentReversal(request: PaymentDeviceSignature, reversalId: string) {
    return this.database.db.transaction(async (tx) => {
      const device = await this.requirePaymentDevice(tx, request);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-reversal:${reversalId}`}))`,
      );
      const [reversal] = await tx
        .select()
        .from(posPaymentReversals)
        .where(
          and(
            eq(posPaymentReversals.organizationId, device.organizationId),
            eq(posPaymentReversals.unitId, device.unitId),
            eq(posPaymentReversals.installationId, device.id),
            eq(posPaymentReversals.id, reversalId),
          ),
        )
        .limit(1);
      if (!reversal) throw new NotFoundException({ code: "PAYMENT_REVERSAL_NOT_FOUND" });
      const [attempt] = await tx
        .select({ provider: posPaymentAttempts.provider })
        .from(posPaymentAttempts)
        .where(eq(posPaymentAttempts.id, reversal.paymentAttemptId))
        .limit(1);
      if (!attempt) throw new NotFoundException({ code: "PAYMENT_ATTEMPT_NOT_FOUND" });
      const capability = await this.paymentCapability(
        tx,
        device.organizationId,
        device.unitId,
        device.id,
      );
      if (
        !capability.available ||
        !capability.supports.reversal ||
        capability.provider !== attempt.provider
      ) {
        throw new ConflictException({ code: "PAYMENT_REVERSAL_UNAVAILABLE" });
      }
      if (reversal.status === "processing" || reversal.status === "unknown") {
        return {
          reversal: this.paymentReversalView(reversal),
          action: {
            type: "recover" as const,
            reversalId,
            paymentAttemptId: reversal.paymentAttemptId,
            provider: attempt.provider,
          },
        };
      }
      if (reversal.status !== "pending") {
        throw new ConflictException({ code: "PAYMENT_REVERSAL_ALREADY_RESOLVED" });
      }
      const [claimed] = await tx
        .update(posPaymentReversals)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(posPaymentReversals.id, reversal.id))
        .returning();
      if (!claimed) throw new Error("Payment reversal claim did not return a row");
      return {
        reversal: this.paymentReversalView(claimed),
        action: {
          type: "reverse" as const,
          reversalId,
          paymentAttemptId: reversal.paymentAttemptId,
          provider: attempt.provider,
        },
      };
    });
  }

  async recordDevicePaymentReversalResult(
    request: PaymentDeviceSignature,
    reversalId: string,
    input: PaymentDeviceResultInput,
  ) {
    const resultHash = requestHash(`payment-device-reversal-result:${reversalId}`, input);
    const result = await this.database.db.transaction(async (tx) => {
      const device = await this.requirePaymentDevice(tx, request);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-reversal:${reversalId}`}))`,
      );
      const [reversal] = await tx
        .select()
        .from(posPaymentReversals)
        .where(
          and(
            eq(posPaymentReversals.organizationId, device.organizationId),
            eq(posPaymentReversals.unitId, device.unitId),
            eq(posPaymentReversals.installationId, device.id),
            eq(posPaymentReversals.id, reversalId),
          ),
        )
        .limit(1);
      if (!reversal) throw new NotFoundException({ code: "PAYMENT_REVERSAL_NOT_FOUND" });
      const [existingResult] = await tx
        .select({
          reversalId: posPaymentReversalResults.reversalId,
          requestHash: posPaymentReversalResults.requestHash,
        })
        .from(posPaymentReversalResults)
        .where(
          and(
            eq(posPaymentReversalResults.organizationId, device.organizationId),
            eq(posPaymentReversalResults.unitId, device.unitId),
            eq(posPaymentReversalResults.installationId, device.id),
            eq(posPaymentReversalResults.deviceResultId, input.resultId),
          ),
        )
        .limit(1);
      if (existingResult) {
        if (existingResult.reversalId !== reversalId || existingResult.requestHash !== resultHash) {
          if (["approved", "declined", "canceled"].includes(reversal.status)) {
            await this.recordPaymentReversalResultIncident(tx, {
              organizationId: device.organizationId,
              unitId: device.unitId,
              actorIdentityId: reversal.requestedByIdentityId,
              reversalId,
              paymentId: reversal.paymentId,
              paymentAttemptId: reversal.paymentAttemptId,
              installationId: reversal.installationId,
              currentStatus: reversal.status,
              reportedStatus: input.status,
              resultId: input.resultId,
              resultHash,
              failureCode: input.failureCode ?? null,
            });
            return { terminalResultConflict: true as const };
          }
          throw new ConflictException({ code: "PAYMENT_REVERSAL_RESULT_CONFLICT" });
        }
        if (
          ["approved", "declined", "canceled"].includes(reversal.status) &&
          (await this.hasRecordedPaymentResultIncident(
            tx,
            device.organizationId,
            device.unitId,
            "pos.payment.reversal_result_conflict",
            reversalId,
            resultHash,
          ))
        ) {
          return { terminalResultConflict: true as const };
        }
        return { reversal: this.paymentReversalView(reversal), idempotentReplay: true };
      }
      if (["approved", "declined", "canceled"].includes(reversal.status)) {
        await tx.insert(posPaymentReversalResults).values({
          organizationId: device.organizationId,
          unitId: device.unitId,
          reversalId,
          installationId: device.id,
          deviceResultId: input.resultId,
          requestHash: resultHash,
          status: input.status,
          providerReference: input.providerReference,
          failureCode: input.failureCode,
          occurredAt: new Date(input.occurredAt),
        });
        await this.recordPaymentReversalResultIncident(tx, {
          organizationId: device.organizationId,
          unitId: device.unitId,
          actorIdentityId: reversal.requestedByIdentityId,
          reversalId,
          paymentId: reversal.paymentId,
          paymentAttemptId: reversal.paymentAttemptId,
          installationId: reversal.installationId,
          currentStatus: reversal.status,
          reportedStatus: input.status,
          resultId: input.resultId,
          resultHash,
          failureCode: input.failureCode ?? null,
        });
        return { terminalResultConflict: true as const };
      }
      const allowed: Record<typeof reversal.status, readonly (typeof input.status)[]> = {
        pending: [],
        processing: ["processing", "approved", "declined", "canceled", "unknown"],
        unknown: ["approved", "declined", "canceled", "unknown"],
        approved: [],
        declined: [],
        canceled: [],
      };
      if (!allowed[reversal.status].includes(input.status)) {
        throw new ConflictException({ code: "PAYMENT_REVERSAL_ALREADY_RESOLVED" });
      }
      const [payment] = await tx
        .select({ tabId: posTabPayments.tabId, method: posTabPayments.method })
        .from(posTabPayments)
        .where(
          and(
            eq(posTabPayments.organizationId, device.organizationId),
            eq(posTabPayments.unitId, device.unitId),
            eq(posTabPayments.id, reversal.paymentId),
          ),
        )
        .limit(1);
      if (!payment) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
      if (input.status === "approved") {
        await this.lockTabPaymentState(tx, device.organizationId, device.unitId, payment.tabId);
      }
      const occurredAt = new Date(input.occurredAt);
      const now = new Date();
      const terminal = ["approved", "declined", "canceled"].includes(input.status);
      const [updated] = await tx
        .update(posPaymentReversals)
        .set({
          status: input.status,
          providerReference: input.providerReference ?? reversal.providerReference,
          failureCode: input.failureCode ?? null,
          resolvedAt: terminal ? now : null,
          updatedAt: now,
        })
        .where(eq(posPaymentReversals.id, reversal.id))
        .returning();
      if (!updated) throw new Error("Payment reversal result did not return a row");
      await tx.insert(posPaymentReversalResults).values({
        organizationId: device.organizationId,
        unitId: device.unitId,
        reversalId,
        installationId: device.id,
        deviceResultId: input.resultId,
        requestHash: resultHash,
        status: input.status,
        providerReference: input.providerReference,
        failureCode: input.failureCode,
        occurredAt,
      });
      let reversalAccounting: {
        cashEntryId: string | null;
        cashAdjustmentId: string | null;
        cashRegisterId: string | null;
        originalCashShiftId: string | null;
      } | null = null;
      if (input.status === "approved") {
        const [reversedAttempt] = await tx
          .update(posPaymentAttempts)
          .set({ status: "reversed", resolvedAt: now, updatedAt: now })
          .where(
            and(
              eq(posPaymentAttempts.id, reversal.paymentAttemptId),
              eq(posPaymentAttempts.status, "approved"),
            ),
          )
          .returning({ id: posPaymentAttempts.id });
        if (!reversedAttempt) throw new ConflictException({ code: "PAYMENT_REVERSAL_RACE" });
        await tx
          .update(posPaymentReconciliations)
          .set({ status: "reversed", updatedAt: now })
          .where(
            and(
              eq(posPaymentReconciliations.organizationId, device.organizationId),
              eq(posPaymentReconciliations.unitId, device.unitId),
              eq(posPaymentReconciliations.paymentId, reversal.paymentId),
              ne(posPaymentReconciliations.status, "reversed"),
            ),
          );
        reversalAccounting = await this.recordApprovedPaymentReversalAccounting(tx, {
          organizationId: device.organizationId,
          unitId: device.unitId,
          reversalId: reversal.id,
          paymentId: reversal.paymentId,
          installationId: reversal.installationId,
          actorIdentityId: reversal.requestedByIdentityId,
          paymentMethod: payment.method,
          amountCents: reversal.amountCents,
          occurredAt,
        });
      }
      await this.recordEvent(
        tx,
        reversal.requestedByIdentityId,
        device.organizationId,
        device.unitId,
        payment.tabId,
        input.status === "approved"
          ? "payment.reversal_approved"
          : `payment.reversal_${input.status}`,
        {
          reversalId,
          paymentId: reversal.paymentId,
          paymentAttemptId: reversal.paymentAttemptId,
          amountCents: reversal.amountCents,
          resultId: input.resultId,
          failureCode: input.failureCode ?? null,
          cashEntryId: reversalAccounting?.cashEntryId ?? null,
          cashAdjustmentId: reversalAccounting?.cashAdjustmentId ?? null,
          cashRegisterId: reversalAccounting?.cashRegisterId ?? null,
          originalCashShiftId: reversalAccounting?.originalCashShiftId ?? null,
        },
        { entityType: "payment_reversal", entityId: reversalId },
      );
      return { reversal: this.paymentReversalView(updated), idempotentReplay: false };
    });
    if ("terminalResultConflict" in result) {
      throw new ConflictException({
        code: "PAYMENT_REVERSAL_RESULT_TERMINAL_CONFLICT",
        message: "O resultado conflitante foi preservado para reconciliação financeira.",
      });
    }
    return result;
  }

  async recordPayment(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: PaymentInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:payments:record",
    );
    if (input.cashRegisterId && !input.installationId) {
      await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    }
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    const cashierActor = await this.canOperateCashier(identityId, organizationId, unitId);
    if (input.installationId) {
      const terminalProfile = await this.terminalExecutionProfile(
        organizationId,
        unitId,
        input.installationId,
      );
      if (terminalProfile.paymentMode === "disabled") {
        throw new ConflictException({ code: "PAYMENT_ROUTED_TO_CASHIER", route: "cashier" });
      }
      if (terminalProfile.paymentMode === "homologated_pos") {
        throw new ConflictException({ code: "PAYMENT_ATTEMPT_REQUIRED" });
      }
      if (!cashierActor) {
        throw new ForbiddenException({ code: "CASHIER_TERMINAL_REQUIRED" });
      }
    } else if (!cashierActor) {
      throw new ConflictException({ code: "PAYMENT_ROUTED_TO_CASHIER", route: "cashier" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.payment.record",
      { tabId, ...input },
      async (tx) => {
        const paymentState = await this.lockTabPaymentState(tx, organizationId, unitId, tabId);
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const availableCents =
          tab.totalCents -
          paymentState.paidCents -
          paymentState.reservedCents -
          paymentState.coveredLossCents;
        if (input.amountCents > availableCents) {
          throw new ConflictException({
            code: "TAB_OVERPAYMENT",
            message: "O pagamento excede o saldo livre da comanda.",
            remainingCents: Math.max(0, availableCents),
          });
        }
        const { cashRegisterId, installationId, ...paymentInput } = input;
        const payment = await this.createPosPayment(
          tx,
          {
            organizationId,
            unitId,
            tabId,
            ...paymentInput,
            source: "manual",
            verified: input.method === "cash",
            createdByIdentityId: identityId,
          },
          { cashRegisterId, installationId },
        );
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "payment.recorded", {
          paymentId: payment.id,
          method: payment.method,
          amountCents: payment.amountCents,
          source: payment.source,
          verified: payment.verified,
        });
        return {
          payment,
          paidCents: paymentState.paidCents + input.amountCents,
          remainingCents: availableCents - input.amountCents,
          availableCents: availableCents - input.amountCents,
        };
      },
    );
  }

  async createPrintJob(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: PrintJobInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:printing:request",
    );
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "print-job.create",
      { tabId, ...input },
      async (tx) => {
        const printJob = await this.queuePrintJob(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          input,
        );
        return { printJob };
      },
    );
  }

  async createPrintSplit(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: PrintSplitInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:printing:request",
    );
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "print-split.create",
      { tabId, ...input },
      async (tx) => {
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const paymentState = await this.lockTabPaymentState(tx, organizationId, unitId, tabId);
        const balanceSnapshotCents =
          tab.totalCents -
          paymentState.paidCents -
          paymentState.reservedCents -
          paymentState.coveredLossCents;
        const amounts = allocatePrintSplitAmounts(
          balanceSnapshotCents,
          input.method,
          input.partCount,
          input.fixedAmountCents,
        );
        const [split] = await tx
          .insert(posPrintSplits)
          .values({
            organizationId,
            unitId,
            tabId,
            balanceSnapshotCents,
            method: input.method,
            partCount: input.partCount,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!split) throw new Error("Print split insert did not return a row");
        const parts = await tx
          .insert(posPrintSplitParts)
          .values(
            amounts.map((amountCents, index) => ({
              organizationId,
              unitId,
              splitId: split.id,
              partNumber: index + 1,
              amountCents,
            })),
          )
          .returning();
        const printJobs = [];
        for (const part of parts) {
          printJobs.push(
            await this.queuePrintJob(
              tx,
              identityId,
              organizationId,
              unitId,
              tabId,
              {
                documentType: input.documentType,
                copies: input.copies,
                installationId: input.installationId,
                terminalId: input.terminalId,
                printerId: input.printerId,
                serviceCallId: input.serviceCallId,
              },
              {
                id: part.id,
                splitId: split.id,
                partNumber: part.partNumber,
                partCount: split.partCount,
                amountCents: part.amountCents,
                balanceSnapshotCents,
                method: split.method,
              },
            ),
          );
        }
        return { split, parts, printJobs };
      },
    );
  }

  async listPrintJobs(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: PrintJobQueryInput,
  ) {
    const printAccess = await this.printAccessScope(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(posPrintJobs)
      .where(
        and(
          eq(posPrintJobs.organizationId, organizationId),
          eq(posPrintJobs.unitId, unitId),
          printAccess.canManage
            ? undefined
            : printAccess.isKds
              ? eq(posPrintJobs.documentType, "kds_ticket")
              : eq(posPrintJobs.requestedByIdentityId, identityId),
          query.tabId ? eq(posPrintJobs.tabId, query.tabId) : undefined,
          query.stationId ? eq(posPrintJobs.stationId, query.stationId) : undefined,
          query.kdsTicketId ? eq(posPrintJobs.kdsTicketId, query.kdsTicketId) : undefined,
          query.documentType ? eq(posPrintJobs.documentType, query.documentType) : undefined,
          query.status ? eq(posPrintJobs.status, query.status) : undefined,
          query.terminalId
            ? or(isNull(posPrintJobs.terminalId), eq(posPrintJobs.terminalId, query.terminalId))
            : undefined,
          query.printerId ? eq(posPrintJobs.printerId, query.printerId) : undefined,
        ),
      )
      .orderBy(
        query.status === "queued" ? asc(posPrintJobs.createdAt) : desc(posPrintJobs.createdAt),
      )
      .limit(query.limit);
  }

  async updatePrintJobStatus(
    identityId: string,
    organizationId: string,
    unitId: string,
    printJobId: string,
    idempotencyKey: string,
    input: PrintJobStatusInput,
  ) {
    const printAccess = await this.printAccessScope(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "print-job.transition",
      { printJobId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-print-job:${organizationId}:${unitId}:${printJobId}`}))`,
        );
        const [current] = await tx
          .select()
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
            ),
          )
          .limit(1);
        if (!current) throw new NotFoundException({ code: "PRINT_JOB_NOT_FOUND" });
        this.assertPrintJobAccess(
          printAccess,
          current.requestedByIdentityId,
          identityId,
          current.documentType,
        );
        if (current.documentType === "kds_ticket") {
          throw new ConflictException({ code: "KDS_PRINT_JOB_RESULT_VIA_HUB_REQUIRED" });
        }
        if (
          !printAccess.canManage &&
          (!current.terminalId ||
            input.terminalId !== current.terminalId ||
            (input.printerId !== undefined && input.printerId !== current.printerId))
        ) {
          throw new ForbiddenException({ code: "PRINT_JOB_TERMINAL_BINDING_MISMATCH" });
        }
        assertPrintJobTransition(current.status, input.status);
        const now = new Date();
        const [printJob] = await tx
          .update(posPrintJobs)
          .set({
            status: input.status,
            attempts: current.attempts + (current.status === "queued" ? 1 : 0),
            terminalId: input.terminalId ?? current.terminalId,
            printerId: input.printerId ?? current.printerId,
            printingAt: input.status === "printing" ? now : current.printingAt,
            printedAt: input.status === "printed" ? now : null,
            failedAt: input.status === "failed" ? now : null,
            lastError:
              input.status === "failed"
                ? (input.error ?? "Falha de impressão")
                : input.status === "confirmation_required"
                  ? "PRINTER_RESULT_UNKNOWN"
                  : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
            ),
          )
          .returning();
        if (!printJob) throw new Error("Print job update did not return a row");
        if (input.status === "printed" && current.serviceCallId) {
          await tx
            .update(posServiceCalls)
            .set({
              status: "resolved",
              resolvedByIdentityId: identityId,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(posServiceCalls.organizationId, organizationId),
                eq(posServiceCalls.unitId, unitId),
                eq(posServiceCalls.id, current.serviceCallId),
                ne(posServiceCalls.status, "resolved"),
              ),
            );
        }
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          current.tabId,
          "print.status_changed",
          { printJobId, from: current.status, to: input.status, error: input.error ?? null },
          { entityType: "print_job", entityId: printJobId },
        );
        return { printJob };
      },
    );
  }

  async retryPrintJob(
    identityId: string,
    organizationId: string,
    unitId: string,
    printJobId: string,
    idempotencyKey: string,
    input: RetryPrintJobInput,
  ) {
    const printAccess = await this.printAccessScope(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "print-job.retry",
      { printJobId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-print-job:${organizationId}:${unitId}:${printJobId}`}))`,
        );
        const [current] = await tx
          .select()
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
            ),
          )
          .limit(1);
        if (!current) throw new NotFoundException({ code: "PRINT_JOB_NOT_FOUND" });
        this.assertPrintJobAccess(
          printAccess,
          current.requestedByIdentityId,
          identityId,
          current.documentType,
        );
        if (current.documentType === "kds_ticket") {
          throw new ConflictException({ code: "KDS_PRINT_RETRY_REQUIRES_REPRINT_REASON" });
        }
        if (current.status !== "failed") {
          throw new ConflictException({
            code: "PRINT_JOB_NOT_FAILED",
            message: "Somente impressões com falha podem ser reenfileiradas.",
          });
        }
        const inheritedInstallationId =
          input.installationId ??
          (current.terminalId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            current.terminalId,
          )
            ? current.terminalId
            : undefined);
        const target = await this.resolvePrintTarget(tx, identityId, organizationId, unitId, {
          installationId: inheritedInstallationId,
          terminalId: input.terminalId ?? current.terminalId ?? undefined,
          printerId: input.printerId ?? current.printerId ?? undefined,
        });
        const [printJob] = await tx
          .update(posPrintJobs)
          .set({
            status: "queued",
            terminalId: target.terminalId,
            printerId: target.printerId,
            printingAt: null,
            printedAt: null,
            failedAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
            ),
          )
          .returning();
        if (!printJob) throw new Error("Print job retry did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          current.tabId,
          "print.retried",
          { printJobId, attempts: current.attempts },
          { entityType: "print_job", entityId: printJobId },
        );
        return { printJob };
      },
    );
  }

  async reprintJob(
    identityId: string,
    organizationId: string,
    unitId: string,
    printJobId: string,
    idempotencyKey: string,
    input: ReprintJobInput,
  ) {
    const printAccess = await this.printAccessScope(identityId, organizationId, unitId);
    const [productionSource] = await this.database.db
      .select()
      .from(posPrintJobs)
      .where(
        and(
          eq(posPrintJobs.organizationId, organizationId),
          eq(posPrintJobs.unitId, unitId),
          eq(posPrintJobs.id, printJobId),
        ),
      )
      .limit(1);
    if (productionSource?.documentType === "kds_ticket") {
      this.assertPrintJobAccess(
        printAccess,
        productionSource.requestedByIdentityId,
        identityId,
        productionSource.documentType,
      );
      if (productionSource.status === "confirmation_required") {
        throw new ConflictException({ code: "PRINT_JOB_RESULT_CONFIRMATION_REQUIRED" });
      }
      if (productionSource.status !== "printed" && productionSource.status !== "failed") {
        throw new ConflictException({ code: "PRINT_JOB_NOT_REPRINTABLE" });
      }
      if (!this.productionPrinting) {
        throw new ConflictException({ code: "PRODUCTION_PRINTING_NOT_CONFIGURED" });
      }
      return this.productionPrinting.reprintKdsJobAuthorized(
        identityId,
        organizationId,
        unitId,
        printJobId,
        idempotencyKey,
        input,
      );
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "print-job.reprint",
      { printJobId, ...input },
      async (tx) => {
        const [source] = await tx
          .select()
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
            ),
          )
          .limit(1);
        if (!source) throw new NotFoundException({ code: "PRINT_JOB_NOT_FOUND" });
        this.assertPrintJobAccess(
          printAccess,
          source.requestedByIdentityId,
          identityId,
          source.documentType,
        );
        if (source.status !== "printed") {
          throw new ConflictException({
            code: "PRINT_JOB_NOT_PRINTED",
            message: "Somente um documento já impresso pode ser reimpresso.",
          });
        }
        const inheritedInstallationId =
          input.installationId ??
          (source.terminalId &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            source.terminalId,
          )
            ? source.terminalId
            : undefined);
        const target = await this.resolvePrintTarget(tx, identityId, organizationId, unitId, {
          installationId: inheritedInstallationId,
          terminalId: input.terminalId ?? source.terminalId ?? undefined,
          printerId: input.printerId ?? source.printerId ?? undefined,
        });
        const [printJob] = await tx
          .insert(posPrintJobs)
          .values({
            organizationId,
            unitId,
            tabId: source.tabId,
            documentType: source.documentType,
            copies: input.copies ?? source.copies,
            terminalId: target.terminalId,
            printerId: target.printerId,
            payload: source.payload,
            requestedByIdentityId: identityId,
            reprintOfJobId: source.id,
            reason: input.reason,
          })
          .returning();
        if (!printJob) throw new Error("Print job reprint did not return a row");
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          source.tabId,
          "print.reprinted",
          { printJobId: printJob.id, reprintOfJobId: source.id, reason: input.reason },
          { entityType: "print_job", entityId: printJob.id },
        );
        return { printJob };
      },
    );
  }

  private async lockOpenReturnableCustodyForTabs(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabIds?: string[],
  ): Promise<OpenReturnableCustody[]> {
    if (tabIds?.length === 0) return [];
    const orderScope = [eq(posOrders.organizationId, organizationId), eq(posOrders.unitId, unitId)];
    if (tabIds) orderScope.push(inArray(posOrders.tabId, tabIds));
    const orders = await tx
      .select({ id: posOrders.id, tabId: posOrders.tabId })
      .from(posOrders)
      .where(and(...orderScope));
    if (orders.length === 0) return [];
    const tabIdByOrderId = new Map(orders.map((order) => [order.id, order.tabId]));
    const issued = await tx
      .select({
        id: managementReturnableCustodyMovements.id,
        orderId: managementReturnableCustodyMovements.orderId,
        containerInventoryItemId: managementReturnableCustodyMovements.containerInventoryItemId,
        containerName: managementInventoryItems.name,
        quantityDelta: managementReturnableCustodyMovements.quantityDelta,
        responsibleIdentityId: managementReturnableCustodyMovements.responsibleIdentityId,
      })
      .from(managementReturnableCustodyMovements)
      .innerJoin(
        managementInventoryItems,
        and(
          eq(
            managementInventoryItems.organizationId,
            managementReturnableCustodyMovements.organizationId,
          ),
          eq(managementInventoryItems.unitId, managementReturnableCustodyMovements.unitId),
          eq(
            managementInventoryItems.id,
            managementReturnableCustodyMovements.containerInventoryItemId,
          ),
        ),
      )
      .where(
        and(
          eq(managementReturnableCustodyMovements.organizationId, organizationId),
          eq(managementReturnableCustodyMovements.unitId, unitId),
          eq(managementReturnableCustodyMovements.type, "issue"),
          inArray(
            managementReturnableCustodyMovements.orderId,
            orders.map((order) => order.id),
          ),
        ),
      )
      .for("update");
    if (issued.length === 0) return [];

    const childMovement = alias(managementReturnableCustodyMovements, "returnable_custody_child");
    const openIssues = await tx
      .select({
        issueMovementId: managementReturnableCustodyMovements.id,
        openQuantity: sql<string>`${managementReturnableCustodyMovements.quantityDelta} + coalesce(sum(${childMovement.quantityDelta}), 0)`,
      })
      .from(managementReturnableCustodyMovements)
      .leftJoin(
        childMovement,
        and(
          eq(childMovement.organizationId, managementReturnableCustodyMovements.organizationId),
          eq(childMovement.unitId, managementReturnableCustodyMovements.unitId),
          eq(childMovement.parentMovementId, managementReturnableCustodyMovements.id),
        ),
      )
      .where(
        inArray(
          managementReturnableCustodyMovements.id,
          issued.map((issue) => issue.id),
        ),
      )
      .groupBy(managementReturnableCustodyMovements.id)
      .having(
        sql`${managementReturnableCustodyMovements.quantityDelta} + coalesce(sum(${childMovement.quantityDelta}), 0) > 0`,
      );
    if (openIssues.length === 0) return [];

    const openIds = openIssues.map((issue) => issue.issueMovementId);
    const custodyHandoffs = await tx
      .select({
        issueMovementId: managementReturnableCustodyHandoffs.issueMovementId,
        toIdentityId: managementReturnableCustodyHandoffs.toIdentityId,
      })
      .from(managementReturnableCustodyHandoffs)
      .where(
        and(
          eq(managementReturnableCustodyHandoffs.organizationId, organizationId),
          eq(managementReturnableCustodyHandoffs.unitId, unitId),
          inArray(managementReturnableCustodyHandoffs.issueMovementId, openIds),
        ),
      )
      .orderBy(
        desc(managementReturnableCustodyHandoffs.occurredAt),
        desc(managementReturnableCustodyHandoffs.createdAt),
      );
    const latestResponsibleByIssueId = new Map<string, string>();
    for (const handoff of custodyHandoffs) {
      if (!latestResponsibleByIssueId.has(handoff.issueMovementId)) {
        latestResponsibleByIssueId.set(handoff.issueMovementId, handoff.toIdentityId);
      }
    }
    const openById = new Map(openIssues.map((issue) => [issue.issueMovementId, issue]));
    return issued.flatMap((issue) => {
      const open = openById.get(issue.id);
      const tabId = issue.orderId ? tabIdByOrderId.get(issue.orderId) : null;
      if (!open || !tabId) return [];
      return [
        {
          issueMovementId: issue.id,
          tabId,
          containerInventoryItemId: issue.containerInventoryItemId,
          containerName: issue.containerName,
          openQuantity: open.openQuantity,
          currentResponsibleIdentityId:
            latestResponsibleByIssueId.get(issue.id) ?? issue.responsibleIdentityId,
        },
      ];
    });
  }

  private async returnableCloseSnapshot(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const [configuredPolicy] = await tx
      .select({ returnableClosePolicy: managementReturnablePolicies.returnableClosePolicy })
      .from(managementReturnablePolicies)
      .where(
        and(
          eq(managementReturnablePolicies.organizationId, organizationId),
          eq(managementReturnablePolicies.unitId, unitId),
        ),
      )
      .limit(1);
    const policy = configuredPolicy?.returnableClosePolicy ?? "warn";
    const openIssues = await this.lockOpenReturnableCustodyForTabs(tx, organizationId, unitId, [
      tabId,
    ]);
    const [pendingProcessing] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, "tab"),
          eq(outboxEvents.aggregateId, tabId),
          inArray(outboxEvents.topic, ["pos.order.sent", "pos.item.canceled"]),
          isNull(outboxEvents.processedAt),
          sql`${outboxEvents.payload} ->> 'organizationId' = ${organizationId}`,
          sql`${outboxEvents.payload} ->> 'unitId' = ${unitId}`,
        ),
      );
    const containers = new Map<
      string,
      { inventoryItemId: string; name: string; issueCount: number; openMilli: bigint }
    >();
    let totalOpenMilli = 0n;
    for (const issue of openIssues) {
      const openMilli = returnableQuantityToMilli(issue.openQuantity);
      totalOpenMilli += openMilli;
      const current = containers.get(issue.containerInventoryItemId);
      containers.set(issue.containerInventoryItemId, {
        inventoryItemId: issue.containerInventoryItemId,
        name: issue.containerName,
        issueCount: (current?.issueCount ?? 0) + 1,
        openMilli: (current?.openMilli ?? 0n) + openMilli,
      });
    }
    const pendingEventCount = Number(pendingProcessing?.count ?? 0);
    return {
      policy,
      hasPending: openIssues.length > 0 || pendingEventCount > 0,
      issueCount: openIssues.length,
      openQuantity: returnableMilliToQuantity(totalOpenMilli),
      containers: [...containers.values()].map(({ openMilli, ...container }) => ({
        ...container,
        openQuantity: returnableMilliToQuantity(openMilli),
      })),
      processingPending: pendingEventCount > 0,
      pendingEventCount,
    };
  }

  async closeTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: CloseTabInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(identityId, organizationId, unitId, "operations:tabs:close");
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.close",
      { tabId, ...input },
      async (tx) => {
        const paymentState = await this.lockTabPaymentState(tx, organizationId, unitId, tabId);
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        let singleTabGroup = tab.tableId
          ? await this.findSingleTabGroup(tx, organizationId, unitId, tab.tableId)
          : null;
        if (singleTabGroup) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table-group:${organizationId}:${unitId}:${singleTabGroup.id}`}))`,
          );
          singleTabGroup = await this.findSingleTabGroup(
            tx,
            organizationId,
            unitId,
            tab.tableId as string,
          );
        }
        if (paymentState.reservedCents > 0) {
          throw new ConflictException({
            code: "TAB_HAS_ACTIVE_PAYMENT_ATTEMPT",
            message: "Conclua ou cancele a cobrança ativa antes de fechar a comanda.",
          });
        }
        const returnables = await this.returnableCloseSnapshot(tx, organizationId, unitId, tabId);
        const mustBlock = returnables.policy === "block";
        const needsAcknowledgement =
          returnables.policy === "warn" && input.returnableDecision !== "acknowledge";
        if (returnables.hasPending && (mustBlock || needsAcknowledgement)) {
          throw new ConflictException({
            code: "TAB_HAS_OPEN_RETURNABLE_CUSTODY",
            message: mustBlock
              ? "Confirme a devolução dos vasilhames antes de fechar a comanda."
              : "Há vasilhames pendentes. Confirme a ciência para continuar o fechamento.",
            policy: returnables.policy,
            pending: returnables,
          });
        }
        const paidCents = paymentState.paidCents;
        const operationalLossCents = paymentState.coveredLossCents;
        assertTabCanClose(tab.totalCents, paidCents + operationalLossCents);
        const now = new Date();
        const [closed] = await tx
          .update(posTabs)
          .set({
            status: "closed",
            closedAt: now,
            updatedAt: now,
            version: sql`${posTabs.version} + 1`,
          })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
              eq(posTabs.status, "open"),
            ),
          )
          .returning();
        if (!closed) throw new ConflictException({ code: "TAB_NOT_OPEN" });
        let groupPrimaryIsOpen = false;
        if (singleTabGroup?.primaryTabId && singleTabGroup.primaryTabId !== tabId) {
          const [primaryTab] = await tx
            .select({ id: posTabs.id })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.id, singleTabGroup.primaryTabId),
                eq(posTabs.status, "open"),
              ),
            )
            .limit(1);
          groupPrimaryIsOpen = Boolean(primaryTab);
        }
        const releasedTableIds = tab.tableId
          ? singleTabGroup
            ? groupPrimaryIsOpen
              ? []
              : singleTabGroup.tableIds
            : [tab.tableId]
          : [];
        if (releasedTableIds.length > 0) {
          await tx
            .update(posDiningTables)
            .set({ status: "needs_cleaning", updatedAt: now })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, releasedTableIds),
              ),
            );
          await tx
            .update(posServiceCalls)
            .set({
              status: "resolved",
              resolvedByIdentityId: identityId,
              resolvedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(posServiceCalls.organizationId, organizationId),
                eq(posServiceCalls.unitId, unitId),
                inArray(posServiceCalls.tableId, releasedTableIds),
                eq(posServiceCalls.kind, "bill"),
                inArray(posServiceCalls.status, ["open", "acknowledged"]),
              ),
            );
          if (singleTabGroup) {
            await tx
              .update(posDiningTableGroups)
              .set({ primaryTabId: null, updatedAt: now })
              .where(
                and(
                  eq(posDiningTableGroups.organizationId, organizationId),
                  eq(posDiningTableGroups.unitId, unitId),
                  eq(posDiningTableGroups.id, singleTabGroup.id),
                  isNull(posDiningTableGroups.dissolvedAt),
                ),
              );
          }
        }
        const loyaltyEntry = await this.earnLoyaltyForClosedTab(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          paidCents,
          now,
        );
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "tab.closed", {
          paidCents,
          operationalLossCents,
          printRequested: input.printRequested,
          releasedTableIds,
          turnoverStatus: releasedTableIds.length > 0 ? "needs_cleaning" : null,
          loyaltyEarned: loyaltyEntry?.amount ?? 0,
          returnables,
        });
        const printJob = input.printRequested
          ? await this.queuePrintJob(tx, identityId, organizationId, unitId, tabId, {
              documentType: "final_receipt",
              copies: input.printOptions?.copies ?? 1,
              installationId: input.printOptions?.installationId,
              terminalId: input.printOptions?.terminalId,
              printerId: input.printOptions?.printerId,
            })
          : null;
        return {
          tab: closed,
          paidCents,
          operationalLossCents,
          printJob,
          loyaltyEntry,
          returnables,
        };
      },
    );
  }

  async reopenTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: ReopenTabInput,
  ) {
    const membership = await this.verifyManagerPin(identityId, organizationId, unitId, input.pin);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.reopen",
      { tabId, reason: input.reason },
      async (tx) => {
        const [tab] = await tx
          .select()
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          )
          .limit(1);
        if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
        if (tab.status !== "closed") {
          throw new ConflictException({
            code: "TAB_NOT_CLOSED",
            message: "Somente atendimentos encerrados podem ser reabertos.",
          });
        }
        const [fiscalDocument] = await tx
          .select({ status: fiscalDocuments.status })
          .from(fiscalDocuments)
          .where(
            and(
              eq(fiscalDocuments.organizationId, organizationId),
              eq(fiscalDocuments.unitId, unitId),
              eq(fiscalDocuments.tabId, tabId),
              inArray(fiscalDocuments.status, [
                "pending",
                "processing",
                "authorized",
                "contingency",
              ]),
            ),
          )
          .limit(1);
        if (fiscalDocument) {
          throw new ConflictException({
            code: "TAB_REOPEN_REQUIRES_FISCAL_CANCELLATION",
            message: "Cancele a NFC-e antes de reabrir este atendimento.",
          });
        }
        const [queuedFiscalEmission] = await tx.execute<{ active: boolean }>(sql`
          select true as active
          from outbox_events events
          inner join fiscal_profiles profiles
            on profiles.organization_id = ${organizationId}
           and profiles.unit_id = ${unitId}
           and profiles.provider = 'focus'
          where events.topic = 'pos.tab.closed'
            and events.aggregate_id = ${tabId}
            and profiles.settings #>> '{focus,status}' = 'ready'
            and coalesce((profiles.settings #>> '{focus,enabled,nfce}')::boolean, false)
          limit 1
        `);
        if (queuedFiscalEmission?.active) {
          throw new ConflictException({
            code: "TAB_REOPEN_REQUIRES_FISCAL_CANCELLATION",
            message: "Aguarde a NFC-e e cancele-a antes de reabrir este atendimento.",
          });
        }
        const now = new Date();
        if (tab.tableId) {
          let singleTabGroup = await this.findSingleTabGroup(
            tx,
            organizationId,
            unitId,
            tab.tableId,
          );
          if (singleTabGroup) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`pos-table-group:${organizationId}:${unitId}:${singleTabGroup.id}`}))`,
            );
            singleTabGroup = await this.findSingleTabGroup(tx, organizationId, unitId, tab.tableId);
          } else {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${tab.tableId}`}))`,
            );
          }
          if (singleTabGroup?.primaryTabId && singleTabGroup.primaryTabId !== tabId) {
            const [primaryTab] = await tx
              .select({ id: posTabs.id })
              .from(posTabs)
              .where(
                and(
                  eq(posTabs.organizationId, organizationId),
                  eq(posTabs.unitId, unitId),
                  eq(posTabs.id, singleTabGroup.primaryTabId),
                  eq(posTabs.status, "open"),
                ),
              )
              .limit(1);
            if (primaryTab) {
              throw new ConflictException({
                code: "TABLE_NOT_AVAILABLE_FOR_REOPEN",
                message: "O grupo de mesas já está em outro atendimento.",
              });
            }
          }
          const tableIds = singleTabGroup?.tableIds ?? [tab.tableId];
          const tables = await tx
            .select({ id: posDiningTables.id, status: posDiningTables.status })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, tableIds),
                eq(posDiningTables.active, true),
              ),
            );
          if (tables.length !== tableIds.length) {
            throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
          }
          if (tables.some((table) => !["available", "needs_cleaning"].includes(table.status))) {
            throw new ConflictException({
              code: "TABLE_NOT_AVAILABLE_FOR_REOPEN",
              message: "Uma mesa do atendimento já está reservada ou ocupada.",
            });
          }
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: now })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, tableIds),
              ),
            );
          if (singleTabGroup) {
            await tx
              .update(posDiningTableGroups)
              .set({ primaryTabId: tabId, updatedAt: now })
              .where(
                and(
                  eq(posDiningTableGroups.organizationId, organizationId),
                  eq(posDiningTableGroups.unitId, unitId),
                  eq(posDiningTableGroups.id, singleTabGroup.id),
                  isNull(posDiningTableGroups.dissolvedAt),
                ),
              );
          }
        }
        const [reopened] = await tx
          .update(posTabs)
          .set({
            status: "open",
            closedAt: null,
            updatedAt: now,
            version: sql`${posTabs.version} + 1`,
          })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
              eq(posTabs.status, "closed"),
            ),
          )
          .returning();
        if (!reopened) throw new ConflictException({ code: "TAB_NOT_CLOSED" });
        const loyaltyReversal = await this.reverseLoyaltyForReopenedTab(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
        );
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "tab.reopened", {
          reason: input.reason,
          approverMembershipId: membership.id,
          loyaltyReversed: loyaltyReversal ? -loyaltyReversal.amount : 0,
        });
        return { tab: reopened, loyaltyReversal };
      },
    );
  }

  async requestApproval(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: ApprovalRequestInput,
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:exceptions:request",
    );
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "approval.request",
      { tabId, ...input },
      async (tx) => {
        const row = await this.getScopedItem(tx, organizationId, unitId, input.itemId);
        if (row.tabId !== tabId) {
          throw new ConflictException({ code: "APPROVAL_ITEM_TAB_MISMATCH" });
        }
        if (row.item.status === "canceled") {
          throw new ConflictException({ code: "ITEM_CANCELED" });
        }
        if (input.discountCents && input.discountCents > row.item.grossCents) {
          throw new BadRequestException({ code: "DISCOUNT_EXCEEDS_ITEM" });
        }
        const requestId = randomUUID();
        const [tab] = await tx
          .select({
            label: posTabs.label,
            displayNumber: posTabs.displayNumber,
            tableLabel: posDiningTables.label,
          })
          .from(posTabs)
          .leftJoin(
            posDiningTables,
            and(
              eq(posDiningTables.organizationId, posTabs.organizationId),
              eq(posDiningTables.unitId, posTabs.unitId),
              eq(posDiningTables.id, posTabs.tableId),
            ),
          )
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          )
          .limit(1);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "approval.requested",
          {
            requestId,
            itemId: input.itemId,
            action: input.action,
            discountCents: input.discountCents,
            reason: input.reason,
            productName: row.item.productName,
            tabLabel:
              tab?.tableLabel ??
              tab?.label ??
              (tab?.displayNumber ? `Balcão ${tab.displayNumber}` : null),
          },
        );
        return { requestId, status: "pending" };
      },
    );
  }

  async listApprovalRequests(identityId: string, organizationId: string, unitId: string) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:exceptions:approve",
    );
    const events = await this.database.db
      .select({
        id: posTabEvents.id,
        tabId: posTabEvents.tabId,
        type: posTabEvents.type,
        payload: posTabEvents.payload,
        createdAt: posTabEvents.createdAt,
        actorIdentityId: posTabEvents.actorIdentityId,
        actorName: identities.displayName,
      })
      .from(posTabEvents)
      .innerJoin(identities, eq(identities.id, posTabEvents.actorIdentityId))
      .where(
        and(
          eq(posTabEvents.organizationId, organizationId),
          eq(posTabEvents.unitId, unitId),
          inArray(posTabEvents.type, [
            "approval.requested",
            "approval.approved",
            "approval.rejected",
          ]),
        ),
      )
      .orderBy(desc(posTabEvents.createdAt))
      .limit(500);
    const decided = new Set(
      events
        .filter((event) => event.type !== "approval.requested")
        .map((event) => String(event.payload.requestId ?? "")),
    );
    return events
      .filter(
        (event) =>
          event.type === "approval.requested" &&
          !decided.has(String(event.payload.requestId ?? "")) &&
          isApprovalActive(event.createdAt),
      )
      .map((event) => ({
        requestId: String(event.payload.requestId),
        tabId: event.tabId,
        tabLabel: typeof event.payload.tabLabel === "string" ? event.payload.tabLabel : null,
        itemId: String(event.payload.itemId),
        productName: String(event.payload.productName ?? "Item"),
        action: event.payload.action,
        discountCents:
          typeof event.payload.discountCents === "number" ? event.payload.discountCents : null,
        reason: String(event.payload.reason ?? ""),
        requestedByIdentityId: event.actorIdentityId,
        requestedByName: event.actorName,
        requestedAt: event.createdAt,
        expiresAt: approvalExpiresAt(event.createdAt),
      }));
  }

  async decideApprovalRequest(
    identityId: string,
    organizationId: string,
    unitId: string,
    requestId: string,
    decision: "approved" | "rejected",
    idempotencyKey: string,
    input: ApprovalDecisionInput,
  ) {
    const membership = await this.verifyManagerPin(identityId, organizationId, unitId, input.pin);
    const requests = await this.listApprovalRequests(identityId, organizationId, unitId);
    const request = requests.find((candidate) => candidate.requestId === requestId);
    if (!request) throw new NotFoundException({ code: "APPROVAL_REQUEST_NOT_FOUND" });
    if (decision === "approved") {
      const approval = {
        approverMembershipId: membership.id,
        pin: input.pin,
        reason: request.reason,
      };
      if (request.action === "discount") {
        await this.discountItem(
          identityId,
          organizationId,
          unitId,
          request.itemId,
          idempotencyKey,
          { discountCents: request.discountCents ?? 0, approval },
        );
      } else {
        await this.cancelItem(identityId, organizationId, unitId, request.itemId, idempotencyKey, {
          approval,
        });
      }
    }
    await this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: posTabEvents.id })
        .from(posTabEvents)
        .where(
          and(
            eq(posTabEvents.organizationId, organizationId),
            eq(posTabEvents.unitId, unitId),
            inArray(posTabEvents.type, ["approval.approved", "approval.rejected"]),
            sql`${posTabEvents.payload}->>'requestId' = ${requestId}`,
          ),
        )
        .limit(1);
      if (!existing) {
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          request.tabId,
          `approval.${decision}`,
          { requestId, itemId: request.itemId, action: request.action },
        );
      }
    });
    return { requestId, status: decision };
  }

  async notifyReady(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.ready.notify",
      { tabId },
      async (tx) => {
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const notifiedAt = new Date();
        await tx
          .update(posTabs)
          .set({ readyNotifiedAt: notifiedAt, version: tab.version + 1, updatedAt: notifiedAt })
          .where(eq(posTabs.id, tabId));
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "customer.ready", {
          channel: tab.customerPhone && tab.readyNotificationConsent ? "queued" : "in_person",
        });
        return {
          tabId,
          notifiedAt,
          channel: tab.customerPhone && tab.readyNotificationConsent ? "queued" : "in_person",
        };
      },
    );
  }

  async createOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: OrderInput,
    offlineIds?: {
      orderId: string;
      itemIds: string[];
      modifierIdForOption: (itemId: string, optionId: string) => string;
    },
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const hasDoseClubItem = input.items.some((item) => Boolean(item.doseClub));
    if (hasDoseClubItem && !this.doseClub) {
      throw new ServiceUnavailableException({ code: "DOSECLUB_NOT_CONFIGURED" });
    }
    const doseClubContext = hasDoseClubItem
      ? await this.doseClub?.draftContext(organizationId, unitId, tabId)
      : undefined;
    return this.createOrderCore(
      identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      input,
      "ops",
      offlineIds,
      undefined,
      doseClubContext,
    );
  }

  async createPublicTableOrder(
    organizationId: string,
    unitId: string,
    tableId: string,
    tabId: string,
    idempotencyKey: string,
    input: OrderInput,
  ) {
    await this.requireOperationalBilling(organizationId);
    if (input.items.some((item) => Boolean(item.doseClub))) {
      throw new BadRequestException({ code: "DOSECLUB_QR_ORDER_NOT_SUPPORTED" });
    }
    const identityId = await this.publicServiceIdentity(organizationId);
    return this.createOrderCore(
      identityId,
      organizationId,
      unitId,
      tabId,
      idempotencyKey,
      input,
      "qr_table",
      undefined,
      tableId,
    );
  }

  private async createOrderCore(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: OrderInput,
    source: "ops" | "qr_table",
    offlineIds?: {
      orderId: string;
      itemIds: string[];
      modifierIdForOption: (itemId: string, optionId: string) => string;
    },
    originTableId?: string,
    doseClubContext?: { integrationId: string; externalCustomerId: string },
  ) {
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      source === "qr_table" ? "public-table-order.create" : "order.create",
      { tabId, originTableId: originTableId ?? null, source, ...input },
      async (tx) => {
        if (offlineIds && offlineIds.itemIds.length !== input.items.length) {
          throw new BadRequestException({ code: "INVALID_OFFLINE_ENTITY_IDS" });
        }
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        if (
          source === "qr_table" &&
          (!originTableId ||
            !(await this.tableBelongsToTab(tx, organizationId, unitId, originTableId, tab)))
        ) {
          throw new ConflictException({ code: "PUBLIC_TABLE_SESSION_CHANGED" });
        }
        if (source === "qr_table") {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`public-table-order:${organizationId}:${unitId}:${tabId}:${originTableId}`}))`,
          );
          const [pending] = await tx
            .select({ id: posOrders.id })
            .from(posOrders)
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.tabId, tabId),
                eq(posOrders.originTableId, originTableId as string),
                eq(posOrders.source, "qr_table"),
                eq(posOrders.status, "draft"),
              ),
            )
            .limit(1);
          if (pending) {
            throw new ConflictException({
              code: "PUBLIC_TABLE_ORDER_PENDING",
              orderId: pending.id,
              message: "A mesa já possui um pedido aguardando confirmação.",
            });
          }
        }
        const [unit] = await tx
          .select({ timezone: units.timezone })
          .from(units)
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
        const [order] = await tx
          .insert(posOrders)
          .values({
            ...(offlineIds ? { id: offlineIds.orderId } : {}),
            organizationId,
            unitId,
            tabId,
            originTableId: originTableId ?? tab.tableId,
            source,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!order) throw new Error("Order insert did not return a row");
        const createdItems = [];
        const appliedPromotions: Array<{
          itemId: string;
          promotionId: string;
          discountCents: number;
        }> = [];
        const orderCreatedAt = new Date();
        const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: unit.timezone }).format(
          orderCreatedAt,
        );
        const catalogPromotions = await tx
          .select()
          .from(posCatalogPromotions)
          .where(
            and(
              eq(posCatalogPromotions.organizationId, organizationId),
              eq(posCatalogPromotions.unitId, unitId),
              eq(posCatalogPromotions.active, true),
            ),
          );
        const qrRequestedByProduct = new Map<string, number>();
        for (const [itemIndex, item] of input.items.entries()) {
          if (item.doseClub && !doseClubContext) {
            throw new ServiceUnavailableException({ code: "DOSECLUB_NOT_CONFIGURED" });
          }
          if (item.doseClub && item.modifierOptionIds.length > 0) {
            throw new BadRequestException({
              code: "DOSECLUB_MODIFIERS_NOT_SUPPORTED",
              productId: item.productId,
            });
          }
          const productRows = await tx
            .select({
              id: posProducts.id,
              name: posProducts.name,
              categoryId: posProducts.categoryId,
              priceCents: posProductPrices.priceCents,
              deliveryPriceCents: posProductPrices.deliveryPriceCents,
              available: posProductAvailability.available,
              availabilitySchedule: posProductAvailability.schedule,
              dailyStock: posProductAvailability.dailyStock,
              soldToday: posProductAvailability.soldToday,
              stockDate: posProductAvailability.stockDate,
              operationalReason: posProductAvailability.operationalReason,
              operationalResetAt: posProductAvailability.operationalResetAt,
              stationId: posProductStations.stationId,
              estimatedPrepTimeMinutes: posProducts.estimatedPrepTimeMinutes,
            })
            .from(posProducts)
            .innerJoin(
              posProductPrices,
              and(
                eq(posProductPrices.organizationId, posProducts.organizationId),
                eq(posProductPrices.productId, posProducts.id),
                eq(posProductPrices.unitId, unitId),
              ),
            )
            .innerJoin(
              posProductAvailability,
              and(
                eq(posProductAvailability.organizationId, posProducts.organizationId),
                eq(posProductAvailability.productId, posProducts.id),
                eq(posProductAvailability.unitId, unitId),
              ),
            )
            .innerJoin(
              posProductStations,
              and(
                eq(posProductStations.organizationId, posProducts.organizationId),
                eq(posProductStations.productId, posProducts.id),
                eq(posProductStations.unitId, unitId),
              ),
            )
            .innerJoin(
              posProductionStations,
              and(
                eq(posProductionStations.organizationId, posProductStations.organizationId),
                eq(posProductionStations.unitId, posProductStations.unitId),
                eq(posProductionStations.id, posProductStations.stationId),
                eq(posProductionStations.active, true),
              ),
            )
            .where(
              and(
                eq(posProducts.organizationId, organizationId),
                eq(posProducts.id, item.productId),
                eq(posProducts.active, true),
              ),
            )
            .orderBy(asc(posProductStations.stationId));
          const product = productRows[0];
          const effectiveAvailability = product
            ? projectKdsAvailability(
                {
                  available: product.available,
                  dailyStock: product.dailyStock,
                  soldToday: product.soldToday,
                  stockDate: product.stockDate,
                  resetAt: product.operationalResetAt,
                  reason: product.operationalReason,
                },
                businessDate,
                orderCreatedAt,
              )
            : null;
          if (
            !product ||
            !effectiveAvailability?.available ||
            !isWithinAvailability(product.availabilitySchedule, orderCreatedAt, unit.timezone)
          ) {
            throw new ConflictException({ code: "PRODUCT_UNAVAILABLE", productId: item.productId });
          }
          const qrRequested = (qrRequestedByProduct.get(item.productId) ?? 0) + item.quantity;
          const currentSold = product.stockDate === businessDate ? product.soldToday : 0;
          if (
            source === "qr_table" &&
            product.dailyStock !== null &&
            currentSold + qrRequested > product.dailyStock
          ) {
            const effectiveSold = product.stockDate === businessDate ? product.soldToday : 0;
            throw new ConflictException({
              code: "PRODUCT_DAILY_STOCK_EXCEEDED",
              productId: item.productId,
              remaining: Math.max(0, (product.dailyStock ?? 0) - effectiveSold),
            });
          }
          if (source === "qr_table") {
            qrRequestedByProduct.set(item.productId, qrRequested);
          } else {
            const [reservedStock] = await tx
              .update(posProductAvailability)
              .set({
                soldToday: sql`case when ${posProductAvailability.stockDate} = ${businessDate} then ${posProductAvailability.soldToday} + ${item.quantity} else ${item.quantity} end`,
                stockDate: businessDate,
                updatedAt: orderCreatedAt,
              })
              .where(
                and(
                  eq(posProductAvailability.organizationId, organizationId),
                  eq(posProductAvailability.unitId, unitId),
                  eq(posProductAvailability.productId, item.productId),
                  or(
                    eq(posProductAvailability.available, true),
                    lte(posProductAvailability.operationalResetAt, orderCreatedAt),
                  ),
                  sql`${posProductAvailability.dailyStock} is null or (case when ${posProductAvailability.stockDate} = ${businessDate} then ${posProductAvailability.soldToday} + ${item.quantity} else ${item.quantity} end) <= ${posProductAvailability.dailyStock}`,
                ),
              )
              .returning({ id: posProductAvailability.productId });
            if (!reservedStock) {
              throw new ConflictException({
                code: "PRODUCT_DAILY_STOCK_EXCEEDED",
                productId: item.productId,
                remaining: Math.max(0, (product.dailyStock ?? 0) - currentSold),
              });
            }
          }
          const optionIds = [...new Set(item.modifierOptionIds)];
          const options =
            optionIds.length === 0
              ? []
              : await tx
                  .select({
                    id: posModifierOptions.id,
                    name: posModifierOptions.name,
                    groupId: posModifierOptions.groupId,
                    priceDeltaCents: posModifierOptions.priceDeltaCents,
                  })
                  .from(posModifierOptions)
                  .innerJoin(
                    posProductModifierGroups,
                    and(
                      eq(
                        posProductModifierGroups.organizationId,
                        posModifierOptions.organizationId,
                      ),
                      eq(posProductModifierGroups.groupId, posModifierOptions.groupId),
                      eq(posProductModifierGroups.productId, item.productId),
                    ),
                  )
                  .where(
                    and(
                      eq(posModifierOptions.organizationId, organizationId),
                      eq(posModifierOptions.active, true),
                      inArray(posModifierOptions.id, optionIds),
                    ),
                  );
          if (options.length !== optionIds.length) {
            throw new BadRequestException({
              code: "INVALID_MODIFIER_SELECTION",
              productId: item.productId,
            });
          }
          const groups = await tx
            .select({
              id: posModifierGroups.id,
              minimum: posModifierGroups.minimumSelections,
              maximum: posModifierGroups.maximumSelections,
            })
            .from(posProductModifierGroups)
            .innerJoin(
              posModifierGroups,
              and(
                eq(posModifierGroups.organizationId, posProductModifierGroups.organizationId),
                eq(posModifierGroups.id, posProductModifierGroups.groupId),
              ),
            )
            .where(
              and(
                eq(posProductModifierGroups.organizationId, organizationId),
                eq(posProductModifierGroups.productId, item.productId),
                eq(posModifierGroups.active, true),
              ),
            );
          for (const group of groups) {
            const count = options.filter((option) => option.groupId === group.id).length;
            if (count < group.minimum || count > group.maximum) {
              throw new BadRequestException({
                code: "MODIFIER_SELECTION_RANGE",
                groupId: group.id,
              });
            }
          }
          const modifierPerUnitCents = options.reduce(
            (sum, option) => sum + option.priceDeltaCents,
            0,
          );
          const channel = tab.fulfillmentType === "delivery" ? "delivery" : "salon";
          const basePriceCents = item.doseClub
            ? 0
            : channel === "delivery"
              ? (product.deliveryPriceCents ?? product.priceCents)
              : product.priceCents;
          const now = new Date();
          const local = localCalendar(now, unit.timezone);
          const promotion = item.doseClub
            ? null
            : bestPromotion(
                catalogPromotions
                  .filter(
                    (candidate) =>
                      (!candidate.startsAt || candidate.startsAt <= now) &&
                      (!candidate.endsAt || candidate.endsAt > now),
                  )
                  .map((candidate) => ({
                    ...candidate,
                    channels: candidate.channels.map((candidateChannel) =>
                      candidateChannel === "salon" ? "pickup" : candidateChannel,
                    ),
                  })),
                product.id,
                product.categoryId,
                channel === "delivery" ? "delivery" : "pickup",
                local.weekday,
                local.minute,
                basePriceCents,
                item.quantity,
              );
          const promotionDiscountCents = promotion?.discountCents ?? 0;
          const amounts = itemAmounts(item.quantity, basePriceCents, modifierPerUnitCents);
          const [created] = await tx
            .insert(posOrderItems)
            .values({
              ...(offlineIds ? { id: offlineIds.itemIds[itemIndex] } : {}),
              organizationId,
              unitId,
              orderId: order.id,
              productId: product.id,
              stationId: product.stationId,
              productName: product.name,
              quantity: item.quantity,
              unitPriceCents: basePriceCents,
              modifiersCents: modifierPerUnitCents * item.quantity,
              ...amounts,
              discountCents: promotionDiscountCents,
              netCents: amounts.grossCents - promotionDiscountCents,
              seatNumber: item.seatNumber,
              course: item.course ?? "anytime",
              estimatedPrepTimeMinutes: product.estimatedPrepTimeMinutes,
              allergyNote: item.allergyNote,
              notes: item.notes,
            })
            .returning();
          if (!created) throw new Error("Order item insert did not return a row");
          if (item.doseClub && doseClubContext && this.doseClub) {
            await this.doseClub.stageRedemption(tx, {
              organizationId,
              unitId,
              integrationId: doseClubContext.integrationId,
              orderId: order.id,
              orderItemId: created.id,
              externalCustomerId: doseClubContext.externalCustomerId,
              externalClubId: item.doseClub.externalClubId,
              externalProductId: product.id,
              doses: item.quantity,
            });
          }
          if (promotion)
            appliedPromotions.push({
              itemId: created.id,
              promotionId: promotion.id,
              discountCents: promotionDiscountCents,
            });
          if (options.length > 0) {
            await tx.insert(posOrderItemModifiers).values(
              options.map((option) => ({
                id: offlineIds?.modifierIdForOption(created.id, option.id),
                organizationId,
                unitId,
                orderItemId: created.id,
                optionId: option.id,
                name: option.name,
                unitDeltaCents: option.priceDeltaCents,
                totalDeltaCents: option.priceDeltaCents * item.quantity,
              })),
            );
          }
          createdItems.push(created);
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "order.created", {
          orderId: order.id,
          itemCount: createdItems.length,
          appliedPromotions,
          source,
        });
        if (source === "qr_table") {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            tabId,
            "public_table_order.requested",
            {
              orderId: order.id,
              tableId: originTableId ?? tab.tableId,
              channel: "qr_table",
              itemCount: createdItems.length,
            },
            { entityType: "order", entityId: order.id },
          );
        }
        return { order, items: createdItems, totals };
      },
    );
  }

  async rejectPublicTableOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    input: { reason: string },
  ) {
    const [scope] = await this.database.db
      .select({ tabId: posOrders.tabId, source: posOrders.source })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (scope?.source !== "qr_table") {
      throw new NotFoundException({ code: "PUBLIC_TABLE_ORDER_NOT_FOUND" });
    }
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [scope.tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "public-table-order.reject",
      { orderId, reason: input.reason },
      async (tx) => {
        await this.lockKdsOrder(tx, organizationId, unitId, orderId);
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
            ),
          )
          .limit(1);
        if (order?.source !== "qr_table") {
          throw new NotFoundException({ code: "PUBLIC_TABLE_ORDER_NOT_FOUND" });
        }
        if (order.status !== "draft") {
          throw new ConflictException({
            code: "PUBLIC_TABLE_ORDER_NOT_DRAFT",
            status: order.status,
          });
        }
        await this.requireOpenTab(tx, organizationId, unitId, order.tabId);
        const items = await tx
          .select()
          .from(posOrderItems)
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.orderId, order.id),
              eq(posOrderItems.status, "draft"),
            ),
          );
        if (items.length === 0) throw new ConflictException({ code: "ORDER_EMPTY" });
        const now = new Date();
        await tx
          .update(posOrderItems)
          .set({
            status: "canceled",
            canceledAt: now,
            canceledReason: input.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.orderId, order.id),
              eq(posOrderItems.status, "draft"),
            ),
          );
        const [canceledOrder] = await tx
          .update(posOrders)
          .set({ status: "canceled", updatedAt: now })
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, order.id),
              eq(posOrders.status, "draft"),
            ),
          )
          .returning({ id: posOrders.id });
        if (!canceledOrder) {
          throw new ConflictException({ code: "PUBLIC_TABLE_ORDER_NOT_DRAFT" });
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, order.tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          order.tabId,
          "public_table_order.rejected",
          { orderId, reason: input.reason, channel: "qr_table" },
          { entityType: "order", entityId: order.id },
        );
        return { orderId, status: "canceled" as const, source: "qr_table" as const, totals };
      },
    );
  }

  private async reserveOrderInventory(
    tx: Transaction,
    input: {
      identityId: string;
      organizationId: string;
      unitId: string;
      orderId: string;
      sentAt: Date;
      items: Array<{ id: string; productId: string; quantity: number; stationId: string | null }>;
    },
  ) {
    const productIds = [...new Set(input.items.map((item) => item.productId))];
    const [components, inventoryItems, issueRoutes] = await Promise.all([
      tx
        .select({
          id: managementRecipeComponents.id,
          inventoryItemId: managementRecipeComponents.inventoryItemId,
          locationId: managementRecipeComponents.locationId,
          lossBasisPoints: managementRecipeComponents.lossBasisPoints,
          productId: managementRecipeVersions.productId,
          quantityMilli: managementRecipeComponents.quantityMilli,
        })
        .from(managementRecipeVersions)
        .innerJoin(
          managementRecipeComponents,
          and(
            eq(managementRecipeComponents.organizationId, managementRecipeVersions.organizationId),
            eq(managementRecipeComponents.unitId, managementRecipeVersions.unitId),
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          ),
        )
        .where(
          and(
            eq(managementRecipeVersions.organizationId, input.organizationId),
            eq(managementRecipeVersions.unitId, input.unitId),
            inArray(managementRecipeVersions.productId, productIds),
            lte(managementRecipeVersions.validFrom, input.sentAt),
            or(
              isNull(managementRecipeVersions.validUntil),
              gt(managementRecipeVersions.validUntil, input.sentAt),
            ),
          ),
        ),
      tx
        .select({
          allowNegative: managementInventoryItems.allowNegative,
          id: managementInventoryItems.id,
          kind: managementInventoryItems.kind,
          productId: managementInventoryItems.productId,
        })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, input.organizationId),
            eq(managementInventoryItems.unitId, input.unitId),
            eq(managementInventoryItems.active, true),
          ),
        ),
      tx
        .select({
          locationId: managementInventoryIssueRoutes.locationId,
          productId: managementInventoryIssueRoutes.productId,
          stationId: managementInventoryIssueRoutes.stationId,
        })
        .from(managementInventoryIssueRoutes)
        .where(
          and(
            eq(managementInventoryIssueRoutes.organizationId, input.organizationId),
            eq(managementInventoryIssueRoutes.unitId, input.unitId),
            eq(managementInventoryIssueRoutes.active, true),
            inArray(managementInventoryIssueRoutes.productId, productIds),
          ),
        ),
    ]);
    const recipesByProduct = new Map<string, typeof components>();
    for (const component of components)
      recipesByProduct.set(component.productId, [
        ...(recipesByProduct.get(component.productId) ?? []),
        component,
      ]);
    const resaleByProduct = new Map<string, typeof inventoryItems>();
    const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
    for (const item of inventoryItems) {
      if (!item.productId || item.kind !== "resale") continue;
      resaleByProduct.set(item.productId, [...(resaleByProduct.get(item.productId) ?? []), item]);
    }
    const reservations = new Map<
      string,
      { inventoryItemId: string; locationId: string; quantityMilli: bigint; allowNegative: boolean }
    >();
    const addReservation = (
      inventoryItemId: string,
      locationId: string,
      quantityMilli: bigint,
      allowNegative: boolean,
    ) => {
      const key = `${inventoryItemId}:${locationId}`;
      const current = reservations.get(key);
      reservations.set(key, {
        inventoryItemId,
        locationId,
        quantityMilli: (current?.quantityMilli ?? 0n) + quantityMilli,
        allowNegative,
      });
    };
    for (const orderItem of input.items) {
      const recipe = recipesByProduct.get(orderItem.productId) ?? [];
      if (recipe.length) {
        for (const component of recipe) {
          const yieldBasisPoints = BigInt(10_000 - component.lossBasisPoints);
          const netMilli = BigInt(component.quantityMilli) * BigInt(orderItem.quantity);
          addReservation(
            component.inventoryItemId,
            component.locationId,
            (netMilli * 10_000n + yieldBasisPoints - 1n) / yieldBasisPoints,
            inventoryById.get(component.inventoryItemId)?.allowNegative ?? false,
          );
        }
        continue;
      }
      const directItems = resaleByProduct.get(orderItem.productId) ?? [];
      if (directItems.length === 0) continue;
      if (directItems.length > 1)
        throw new ConflictException({
          code: "INVENTORY_MAPPING_AMBIGUOUS",
          productId: orderItem.productId,
        });
      const inventoryItem = directItems[0];
      if (!inventoryItem) continue;
      const route =
        issueRoutes.find(
          (candidate) =>
            candidate.productId === orderItem.productId &&
            candidate.stationId === orderItem.stationId,
        ) ??
        issueRoutes.find(
          (candidate) =>
            candidate.productId === orderItem.productId && candidate.stationId === null,
        );
      let locationId = route?.locationId;
      if (!locationId) {
        const balances = await tx
          .select({ locationId: managementStockBalances.locationId })
          .from(managementStockBalances)
          .innerJoin(
            managementStockLocations,
            and(
              eq(managementStockLocations.organizationId, managementStockBalances.organizationId),
              eq(managementStockLocations.unitId, managementStockBalances.unitId),
              eq(managementStockLocations.id, managementStockBalances.locationId),
              eq(managementStockLocations.active, true),
            ),
          )
          .where(
            and(
              eq(managementStockBalances.organizationId, input.organizationId),
              eq(managementStockBalances.unitId, input.unitId),
              eq(managementStockBalances.inventoryItemId, inventoryItem.id),
            ),
          );
        if (balances.length !== 1)
          throw new ConflictException({
            code: "INVENTORY_ISSUE_ROUTE_MISSING",
            productId: orderItem.productId,
          });
        locationId = balances[0]?.locationId;
      }
      if (locationId)
        addReservation(
          inventoryItem.id,
          locationId,
          BigInt(orderItem.quantity) * 1_000n,
          inventoryItem.allowNegative,
        );
    }
    const quantity = (milli: bigint) =>
      `${milli / 1_000n}.${String(milli % 1_000n).padStart(3, "0")}`;
    const quantityMilli = (value: string) => {
      const [whole = "0", fraction = ""] = value.split(".");
      return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
    };
    for (const reservation of [...reservations.values()].sort((left, right) =>
      `${left.inventoryItemId}:${left.locationId}`.localeCompare(
        `${right.inventoryItemId}:${right.locationId}`,
      ),
    )) {
      const rows = await tx.execute<{
        quantity: string;
        reservedQuantity: string;
        blockedQuantity: string;
      }>(sql`
        select balance.quantity,
               coalesce((select sum(r.quantity) from management_inventory_reservations r
                 where r.organization_id = balance.organization_id and r.unit_id = balance.unit_id
                   and r.location_id = balance.location_id and r.inventory_item_id = balance.inventory_item_id
                   and r.status = 'active' and (r.expires_at is null or r.expires_at > now())), 0) as "reservedQuantity",
               coalesce((select sum(lot.quantity) from management_inventory_lots lot
                 inner join management_inventory_lot_holds hold on hold.organization_id = lot.organization_id
                   and hold.unit_id = lot.unit_id and hold.lot_id = lot.id and hold.status = 'active'
                 where lot.organization_id = balance.organization_id and lot.unit_id = balance.unit_id
                   and lot.location_id = balance.location_id and lot.inventory_item_id = balance.inventory_item_id
                   and lot.active = true), 0) as "blockedQuantity"
        from management_stock_balances balance
        where balance.organization_id = ${input.organizationId}::uuid
          and balance.unit_id = ${input.unitId}::uuid
          and balance.location_id = ${reservation.locationId}::uuid
          and balance.inventory_item_id = ${reservation.inventoryItemId}::uuid
        for update
      `);
      const balance = rows[0];
      if (!balance)
        throw new ConflictException({
          code: "INVENTORY_STOCK_BALANCE_MISSING",
          inventoryItemId: reservation.inventoryItemId,
        });
      const availableMilli =
        quantityMilli(balance.quantity) -
        quantityMilli(balance.reservedQuantity) -
        quantityMilli(balance.blockedQuantity);
      if (!reservation.allowNegative && availableMilli < reservation.quantityMilli)
        throw new ConflictException({
          code: "INVENTORY_STOCK_INSUFFICIENT",
          inventoryItemId: reservation.inventoryItemId,
          availableQuantity: quantity(availableMilli > 0n ? availableMilli : 0n),
          requiredQuantity: quantity(reservation.quantityMilli),
        });
      await tx
        .insert(managementInventoryReservations)
        .values({
          organizationId: input.organizationId,
          unitId: input.unitId,
          inventoryItemId: reservation.inventoryItemId,
          locationId: reservation.locationId,
          quantity: quantity(reservation.quantityMilli),
          sourceType: "order",
          sourceId: input.orderId,
          reason: `Pedido ${input.orderId}`,
          expiresAt: new Date(input.sentAt.getTime() + 24 * 60 * 60_000),
          idempotencyKey: `order:${input.orderId}:${reservation.inventoryItemId}:${reservation.locationId}`,
          actorIdentityId: input.identityId,
        })
        .onConflictDoNothing();
    }
  }

  async sendOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    offlineIds?: { ticketIdForStation: (stationId: string) => string },
  ) {
    const [orderScope] = await this.database.db
      .select({ tabId: posOrders.tabId })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!orderScope) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [orderScope.tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const preparedDoseClubRedemptions = this.doseClub
      ? await this.doseClub.reserveOrder(organizationId, unitId, orderId)
      : [];
    try {
      return await this.idempotent(
        identityId,
        organizationId,
        unitId,
        idempotencyKey,
        "order.send",
        { orderId },
        async (tx) => {
          await this.lockKdsOrder(tx, organizationId, unitId, orderId);
          const [order] = await tx
            .select()
            .from(posOrders)
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.id, orderId),
              ),
            )
            .limit(1);
          if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
          if (order.status !== "draft") {
            throw new ConflictException({ code: "ORDER_NOT_DRAFT", status: order.status });
          }
          const tab = await this.requireOpenTab(tx, organizationId, unitId, order.tabId);
          const [activeShift] = await tx
            .select({ serviceMode: posOperationalShifts.serviceMode })
            .from(posOperationalShifts)
            .where(
              and(
                eq(posOperationalShifts.organizationId, organizationId),
                eq(posOperationalShifts.unitId, unitId),
                eq(posOperationalShifts.status, "active"),
              ),
            )
            .limit(1);
          const serviceMode = activeShift?.serviceMode ?? "hybrid";
          const items = await tx
            .select()
            .from(posOrderItems)
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                eq(posOrderItems.orderId, orderId),
                eq(posOrderItems.status, "draft"),
              ),
            );
          if (items.length === 0) throw new ConflictException({ code: "ORDER_EMPTY" });
          const productIds = [...new Set(items.map((item) => item.productId))].sort();
          const initialRoutes = await tx
            .select({
              productId: posProductStations.productId,
              stationId: posProductStations.stationId,
              stage: posProductStations.stage,
              active: posProductionStations.active,
              station: posProductionStations,
            })
            .from(posProductStations)
            .innerJoin(
              posProductionStations,
              and(
                eq(posProductionStations.organizationId, posProductStations.organizationId),
                eq(posProductionStations.unitId, posProductStations.unitId),
                eq(posProductionStations.id, posProductStations.stationId),
              ),
            )
            .where(
              and(
                eq(posProductStations.organizationId, organizationId),
                eq(posProductStations.unitId, unitId),
                inArray(posProductStations.productId, productIds),
              ),
            )
            .orderBy(asc(posProductStations.productId), asc(posProductStations.stationId));
          if (
            productIds.some(
              (productId) => !initialRoutes.some((route) => route.productId === productId),
            )
          ) {
            throw new ConflictException({ code: "PRODUCT_WITHOUT_STATION" });
          }
          const initialStationIds = [
            ...new Set(initialRoutes.map((route) => route.stationId)),
          ].sort();
          await this.lockKdsStations(tx, organizationId, unitId, initialStationIds);
          const routes = await tx
            .select({
              productId: posProductStations.productId,
              stationId: posProductStations.stationId,
              stage: posProductStations.stage,
              active: posProductionStations.active,
              station: posProductionStations,
            })
            .from(posProductStations)
            .innerJoin(
              posProductionStations,
              and(
                eq(posProductionStations.organizationId, posProductStations.organizationId),
                eq(posProductionStations.unitId, posProductStations.unitId),
                eq(posProductionStations.id, posProductStations.stationId),
              ),
            )
            .where(
              and(
                eq(posProductStations.organizationId, organizationId),
                eq(posProductStations.unitId, unitId),
                inArray(posProductStations.productId, productIds),
              ),
            )
            .orderBy(asc(posProductStations.productId), asc(posProductStations.stationId));
          const initialRouteKeys = initialRoutes.map(
            (route) => `${route.productId}:${route.stationId}:${route.stage}`,
          );
          const currentRouteKeys = routes.map(
            (route) => `${route.productId}:${route.stationId}:${route.stage}`,
          );
          if (
            currentRouteKeys.length !== initialRouteKeys.length ||
            currentRouteKeys.some((route, index) => route !== initialRouteKeys[index])
          ) {
            throw new ConflictException({ code: "KDS_PRODUCT_ROUTING_CHANGED_RETRY" });
          }
          if (routes.some((route) => !route.active)) {
            throw new ConflictException({ code: "ORDER_HAS_INACTIVE_STATION" });
          }
          const stations = [
            ...new Map(routes.map((route) => [route.station.id, route.station])).values(),
          ];
          if (this.productionPrinting) {
            this.productionPrinting.assertStationsCanReceiveOrder(stations);
          } else {
            const disabledStation = stations.find((station) => station.deliveryMode === "disabled");
            if (disabledStation) {
              throw new ConflictException({
                code: "PRODUCTION_STATION_DELIVERY_DISABLED",
                stationId: disabledStation.id,
              });
            }
          }
          const stationById = new Map(stations.map((station) => [station.id, station]));
          const stationIdsByProduct = new Map<string, string[]>();
          const stageByProductStation = new Map<string, number>();
          for (const route of routes) {
            stationIdsByProduct.set(route.productId, [
              ...(stationIdsByProduct.get(route.productId) ?? []),
              route.stationId,
            ]);
            stageByProductStation.set(`${route.productId}:${route.stationId}`, route.stage);
          }
          const stationIds = [...new Set(routes.map((route) => route.stationId))].sort();
          const now = new Date();
          if (order.source === "qr_table") {
            const [unit] = await tx
              .select({ timezone: units.timezone })
              .from(units)
              .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
              .limit(1);
            if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
            const businessDate = new Intl.DateTimeFormat("en-CA", {
              timeZone: unit.timezone,
            }).format(now);
            const requestedByProduct = new Map<string, number>();
            for (const item of items) {
              requestedByProduct.set(
                item.productId,
                (requestedByProduct.get(item.productId) ?? 0) + item.quantity,
              );
            }
            for (const [productId, quantity] of requestedByProduct) {
              const [reserved] = await tx
                .update(posProductAvailability)
                .set({
                  soldToday: sql`case when ${posProductAvailability.stockDate} = ${businessDate} then ${posProductAvailability.soldToday} + ${quantity} else ${quantity} end`,
                  stockDate: businessDate,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(posProductAvailability.organizationId, organizationId),
                    eq(posProductAvailability.unitId, unitId),
                    eq(posProductAvailability.productId, productId),
                    or(
                      eq(posProductAvailability.available, true),
                      lte(posProductAvailability.operationalResetAt, now),
                    ),
                    sql`${posProductAvailability.dailyStock} is null or (case when ${posProductAvailability.stockDate} = ${businessDate} then ${posProductAvailability.soldToday} + ${quantity} else ${quantity} end) <= ${posProductAvailability.dailyStock}`,
                  ),
                )
                .returning({ id: posProductAvailability.productId });
              if (!reserved) {
                throw new ConflictException({
                  code: "PRODUCT_DAILY_STOCK_EXCEEDED",
                  productId,
                });
              }
            }
          }
          for (const item of items) {
            const primaryStationId = stationIdsByProduct.get(item.productId)?.[0];
            if (!primaryStationId) {
              throw new ConflictException({
                code: "PRODUCT_WITHOUT_STATION",
                productId: item.productId,
              });
            }
            if (item.stationId !== primaryStationId) {
              await tx
                .update(posOrderItems)
                .set({ stationId: primaryStationId, updatedAt: now })
                .where(
                  and(
                    eq(posOrderItems.organizationId, organizationId),
                    eq(posOrderItems.unitId, unitId),
                    eq(posOrderItems.id, item.id),
                    eq(posOrderItems.orderId, orderId),
                    eq(posOrderItems.status, "draft"),
                  ),
                );
            }
          }
          await this.doseClub?.assertReservedAndMarkCommitPending(
            tx,
            organizationId,
            unitId,
            orderId,
          );
          await this.reserveOrderInventory(tx, {
            identityId,
            organizationId,
            unitId,
            orderId,
            sentAt: now,
            items: items.map((item) => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              stationId: stationIdsByProduct.get(item.productId)?.[0] ?? item.stationId,
            })),
          });
          await tx
            .update(posOrders)
            .set({ status: "sent", sentAt: now, updatedAt: now })
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.id, orderId),
                eq(posOrders.status, "draft"),
              ),
            );
          await tx
            .update(posOrderItems)
            .set({ status: "queued", updatedAt: now })
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                eq(posOrderItems.orderId, orderId),
                eq(posOrderItems.status, "draft"),
              ),
            );
          const ticketIds = [];
          const printJobIds: string[] = [];
          for (const stationId of stationIds) {
            const stationItems = items.filter((item) =>
              stationIdsByProduct.get(item.productId)?.includes(stationId),
            );
            const stationDispatch = stationItems.map((item) => ({
              item,
              ...initialKdsCourseDispatch(serviceMode, item.course),
              stage: stageByProductStation.get(`${item.productId}:${stationId}`) ?? 1,
            }));
            const minimumStageByItem = new Map(
              stationItems.map((item) => [
                item.id,
                Math.min(
                  ...routes
                    .filter((route) => route.productId === item.productId)
                    .map((route) => route.stage),
                ),
              ]),
            );
            const estimatedMinutes = Math.max(
              0,
              ...stationDispatch
                .filter(({ fired }) => fired)
                .map(({ item }) => item.estimatedPrepTimeMinutes ?? 0),
            );
            const dueAt =
              tab.promisedAt ??
              (estimatedMinutes > 0 ? new Date(now.getTime() + estimatedMinutes * 60_000) : null);
            const [ticket] = await tx
              .insert(posKdsTickets)
              .values({
                ...(offlineIds ? { id: offlineIds.ticketIdForStation(stationId) } : {}),
                organizationId,
                unitId,
                orderId,
                stationId,
                priority: order.kdsPriority,
                dueAt,
              })
              .returning();
            if (!ticket) throw new Error("KDS ticket insert did not return a row");
            ticketIds.push(ticket.id);
            await tx.insert(posKdsTicketItems).values(
              stationDispatch.map(({ item, held: courseHeld, stage }) => {
                const dependencyHeld = stage > (minimumStageByItem.get(item.id) ?? 1);
                return {
                  organizationId,
                  unitId,
                  ticketId: ticket.id,
                  orderItemId: item.id,
                  quantity: item.quantity,
                  status: "queued" as const,
                  stage,
                  courseHeld,
                  dependencyHeld,
                  held: courseHeld || dependencyHeld,
                  heldAt: courseHeld || dependencyHeld ? now : null,
                  firedAt: courseHeld || dependencyHeld ? null : now,
                };
              }),
            );
            const station = stationById.get(stationId);
            if (!station) throw new ConflictException({ code: "PRODUCTION_STATION_NOT_FOUND" });
            const printJob = await this.productionPrinting?.queueAutomaticTicket(tx, {
              identityId,
              organizationId,
              unitId,
              tab,
              order,
              ticket,
              station,
              dispatch: stationDispatch.map(({ item, stage }) => ({ item, stage })),
            });
            if (printJob) printJobIds.push(printJob.id);
          }
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            order.tabId,
            "order.sent",
            {
              orderId,
              ticketIds,
            },
          );
          await this.recalculateTab(tx, organizationId, unitId, order.tabId);
          return { orderId, status: "sent", ticketIds, printJobIds };
        },
      );
    } catch (error) {
      await this.doseClub?.cancelPrepared(
        preparedDoseClubRedemptions,
        "Envio da comanda não foi concluído",
      );
      throw error;
    }
  }

  async requestKdsTicketPrint(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: ManualKdsTicketPrintInput,
  ) {
    if (!this.productionPrinting) {
      throw new ConflictException({ code: "PRODUCTION_PRINTING_NOT_CONFIGURED" });
    }
    const tabId = await this.productionPrinting.ticketTabId(organizationId, unitId, ticketId);
    const printAccess = await this.printAccessScope(identityId, organizationId, unitId);
    if (!printAccess.isKds) {
      await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    }
    return this.productionPrinting.manualTicketPrintAuthorized(
      identityId,
      organizationId,
      unitId,
      ticketId,
      idempotencyKey,
      input,
    );
  }

  async transferTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: TransferTabInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.transfer",
      { tabId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
        );
        const tab = await this.requireOpenTab(tx, organizationId, unitId, tabId);
        const [activeGroup] = await tx
          .select({ id: posDiningTableGroups.id })
          .from(posDiningTableGroups)
          .where(
            and(
              eq(posDiningTableGroups.organizationId, organizationId),
              eq(posDiningTableGroups.unitId, unitId),
              eq(posDiningTableGroups.primaryTabId, tabId),
              isNull(posDiningTableGroups.dissolvedAt),
            ),
          )
          .limit(1);
        if (activeGroup) {
          throw new ConflictException({
            code: "GROUPED_TAB_TRANSFER_REQUIRES_DETACH",
            message: "Separe ou desfaça o grupo antes de transferir a comanda principal.",
          });
        }
        const [destination] = await tx
          .select({ id: posDiningTables.id, status: posDiningTables.status })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, input.tableId),
              eq(posDiningTables.active, true),
            ),
          )
          .limit(1);
        if (!destination) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
        if (destination.id !== tab.tableId && destination.status !== "available") {
          throw new ConflictException({
            code: "TABLE_NOT_AVAILABLE",
            status: destination.status,
          });
        }
        const [occupied] = await tx
          .select({ id: posTabs.id })
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.tableId, input.tableId),
              eq(posTabs.status, "open"),
            ),
          )
          .limit(1);
        if (occupied && occupied.id !== tabId) {
          throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        await tx
          .update(posTabs)
          .set({ tableId: input.tableId, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        if (tab.tableId && tab.tableId !== input.tableId) {
          await tx
            .update(posDiningTables)
            .set({ status: "needs_cleaning", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, tab.tableId),
              ),
            );
        }
        await tx
          .update(posDiningTables)
          .set({ status: "occupied", updatedAt: new Date() })
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.id, input.tableId),
            ),
          );
        await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "tab.transferred", {
          fromTableId: tab.tableId,
          toTableId: input.tableId,
          reason: input.reason,
        });
        return { tabId, tableId: input.tableId };
      },
    );
  }

  private async mergeOpenTabs(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    targetTabId: string,
    sourceIds: string[],
    releaseSourceTables: boolean,
    reason?: { reasonCode: string; reasonNote?: string },
  ) {
    const target = await this.requireOpenTab(tx, organizationId, unitId, targetTabId);
    const sources = await tx
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          inArray(posTabs.id, sourceIds),
          eq(posTabs.status, "open"),
        ),
      );
    if (sources.length !== sourceIds.length) {
      throw new NotFoundException({ code: "SOURCE_TAB_NOT_FOUND" });
    }
    const paymentStates = [];
    for (const mergedTabId of [...new Set([targetTabId, ...sourceIds])].sort()) {
      paymentStates.push(await this.lockTabPaymentState(tx, organizationId, unitId, mergedTabId));
    }
    if (paymentStates.some((state) => state.paidCents > 0 || state.coveredLossCents > 0)) {
      throw new ConflictException({
        code: "TAB_MERGE_HAS_PAYMENTS",
        message: "Não é possível unificar comandas depois de registrar cobertura financeira.",
      });
    }
    if (paymentStates.some((state) => state.reservedCents > 0)) {
      throw new ConflictException({
        code: "TAB_MERGE_HAS_ACTIVE_PAYMENT_ATTEMPT",
        message: "Não é possível unificar comandas com uma cobrança ativa.",
      });
    }
    if (target.tableId) {
      await tx
        .update(posOrders)
        .set({ originTableId: target.tableId, updatedAt: new Date() })
        .where(
          and(
            eq(posOrders.organizationId, organizationId),
            eq(posOrders.unitId, unitId),
            eq(posOrders.tabId, target.id),
            isNull(posOrders.originTableId),
          ),
        );
    }
    for (const source of sources) {
      if (source.tableId) {
        await tx
          .update(posOrders)
          .set({ originTableId: source.tableId, updatedAt: new Date() })
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.tabId, source.id),
              isNull(posOrders.originTableId),
            ),
          );
      }
    }
    await tx
      .update(posOrders)
      .set({ tabId: target.id, updatedAt: new Date() })
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          inArray(posOrders.tabId, sourceIds),
        ),
      );
    await tx
      .update(posTabs)
      .set({ status: "merged", mergedIntoTabId: target.id, updatedAt: new Date() })
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          inArray(posTabs.id, sourceIds),
          eq(posTabs.status, "open"),
        ),
      );
    await tx
      .update(posTabs)
      .set({
        guestCount: target.guestCount + sources.reduce((sum, source) => sum + source.guestCount, 0),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, target.id),
        ),
      );
    const releasedTableIds = sources
      .map((source) => source.tableId)
      .filter((tableId): tableId is string => Boolean(tableId) && tableId !== target.tableId);
    if (releaseSourceTables && releasedTableIds.length > 0) {
      await tx
        .update(posDiningTables)
        .set({ status: "needs_cleaning", updatedAt: new Date() })
        .where(
          and(
            eq(posDiningTables.organizationId, organizationId),
            eq(posDiningTables.unitId, unitId),
            inArray(posDiningTables.id, releasedTableIds),
          ),
        );
    }
    const totals = await this.recalculateTab(tx, organizationId, unitId, target.id);
    await this.recordEvent(tx, identityId, organizationId, unitId, target.id, "tabs.merged", {
      sourceTabIds: sourceIds,
      sourceTableIds: releasedTableIds,
      tablesRemainGrouped: !releaseSourceTables,
      reasonCode: reason?.reasonCode ?? null,
      reasonNote: reason?.reasonNote ?? null,
    });
    return { targetTabId: target.id, sourceTabIds: sourceIds, totals };
  }

  async mergeTabs(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: MergeTabsInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [
      input.targetTabId,
      ...input.sourceTabIds,
    ]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    await this.requireOperationalBilling(organizationId);
    const sourceIds = [...new Set(input.sourceTabIds)];
    if (sourceIds.includes(input.targetTabId)) {
      throw new BadRequestException({ code: "MERGE_TARGET_IS_SOURCE" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.merge",
      { ...input, sourceTabIds: sourceIds },
      async (tx) => {
        const lockIds = [input.targetTabId, ...sourceIds].sort();
        for (const id of lockIds) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${id}`}))`,
          );
        }
        return this.mergeOpenTabs(
          tx,
          identityId,
          organizationId,
          unitId,
          input.targetTabId,
          sourceIds,
          true,
          { reasonCode: input.reasonCode, reasonNote: input.reasonNote },
        );
      },
    );
  }

  async groupTables(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: TableGroupInput,
  ) {
    const groupingRoles = await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:tables:reorganize",
    );
    const canReorganizeAny = groupingRoles.some(
      (row) =>
        (row.unitId === null || row.unitId === unitId) &&
        ["owner", "manager", "cashier"].includes(row.role),
    );
    await this.requireOperationalBilling(organizationId);
    const tableIds = [...new Set(input.tableIds)];
    if (tableIds.length !== input.tableIds.length) {
      throw new BadRequestException({ code: "DUPLICATE_GROUP_TABLE" });
    }
    if (!tableIds.includes(input.anchorTableId)) {
      throw new BadRequestException({ code: "GROUP_ANCHOR_NOT_SELECTED" });
    }
    if (input.responsibleIdentityId) {
      await this.requireOperationalIdentity(organizationId, unitId, input.responsibleIdentityId);
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-group.create",
      { ...input, tableIds },
      async (tx) => {
        for (const tableId of [...tableIds].sort()) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${tableId}`}))`,
          );
        }
        const tables = await tx
          .select()
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              inArray(posDiningTables.id, tableIds),
              eq(posDiningTables.active, true),
            ),
          );
        if (tables.length !== tableIds.length) {
          throw new NotFoundException({ code: "GROUP_TABLE_NOT_FOUND" });
        }
        if (tables.some((table) => table.status === "reserved")) {
          throw new ConflictException({
            code: "GROUP_HAS_RESERVED_TABLE",
            message: "Resolva a reserva antes de juntar a mesa.",
          });
        }
        const currentMemberships = await tx
          .select()
          .from(posDiningTableGroupMembers)
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              inArray(posDiningTableGroupMembers.tableId, tableIds),
            ),
          );
        const currentGroupIds = [...new Set(currentMemberships.map((member) => member.groupId))];
        if (currentGroupIds.length > 0) {
          const allCurrentMembers = await tx
            .select()
            .from(posDiningTableGroupMembers)
            .where(
              and(
                eq(posDiningTableGroupMembers.organizationId, organizationId),
                eq(posDiningTableGroupMembers.unitId, unitId),
                inArray(posDiningTableGroupMembers.groupId, currentGroupIds),
              ),
            );
          if (allCurrentMembers.some((member) => !tableIds.includes(member.tableId))) {
            throw new ConflictException({
              code: "GROUP_SELECTION_INCOMPLETE",
              message: "Selecione todas as mesas dos grupos envolvidos.",
            });
          }
          await tx
            .delete(posDiningTableGroupMembers)
            .where(
              and(
                eq(posDiningTableGroupMembers.organizationId, organizationId),
                eq(posDiningTableGroupMembers.unitId, unitId),
                inArray(posDiningTableGroupMembers.groupId, currentGroupIds),
              ),
            );
          await tx
            .update(posDiningTableGroups)
            .set({ dissolvedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTableGroups.organizationId, organizationId),
                eq(posDiningTableGroups.unitId, unitId),
                inArray(posDiningTableGroups.id, currentGroupIds),
              ),
            );
        }

        const openTabs = await tx
          .select()
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              inArray(posTabs.tableId, tableIds),
              eq(posTabs.status, "open"),
            ),
          );
        const groupResponsibleIdentityId =
          input.responsibleIdentityId ??
          openTabs.find((tab) => tab.tableId === input.anchorTableId)?.responsibleIdentityId ??
          openTabs.find((tab) => tab.responsibleIdentityId)?.responsibleIdentityId ??
          (openTabs.length ? identityId : null);
        if (!canReorganizeAny) {
          const [sectionAssignment, transferAssignment, coordinatedGroup] = await Promise.all([
            tx
              .select({ tableId: posShiftSectionTables.tableId })
              .from(posShiftSectionTables)
              .innerJoin(
                posShiftSectionStaff,
                and(
                  eq(posShiftSectionStaff.organizationId, posShiftSectionTables.organizationId),
                  eq(posShiftSectionStaff.unitId, posShiftSectionTables.unitId),
                  eq(posShiftSectionStaff.shiftId, posShiftSectionTables.shiftId),
                  eq(posShiftSectionStaff.shiftSectionId, posShiftSectionTables.shiftSectionId),
                ),
              )
              .innerJoin(
                posOperationalShifts,
                and(
                  eq(posOperationalShifts.organizationId, posShiftSectionTables.organizationId),
                  eq(posOperationalShifts.unitId, posShiftSectionTables.unitId),
                  eq(posOperationalShifts.id, posShiftSectionTables.shiftId),
                ),
              )
              .where(
                and(
                  eq(posShiftSectionTables.organizationId, organizationId),
                  eq(posShiftSectionTables.unitId, unitId),
                  inArray(posShiftSectionTables.tableId, tableIds),
                  eq(posShiftSectionStaff.identityId, identityId),
                  eq(posOperationalShifts.status, "active"),
                ),
              )
              .limit(1),
            tx
              .select({ tableId: posShiftTableTransfers.tableId })
              .from(posShiftTableTransfers)
              .innerJoin(
                posShiftSectionStaff,
                and(
                  eq(posShiftSectionStaff.organizationId, posShiftTableTransfers.organizationId),
                  eq(posShiftSectionStaff.unitId, posShiftTableTransfers.unitId),
                  eq(posShiftSectionStaff.shiftId, posShiftTableTransfers.shiftId),
                  eq(
                    posShiftSectionStaff.shiftSectionId,
                    posShiftTableTransfers.targetShiftSectionId,
                  ),
                ),
              )
              .where(
                and(
                  eq(posShiftTableTransfers.organizationId, organizationId),
                  eq(posShiftTableTransfers.unitId, unitId),
                  inArray(posShiftTableTransfers.tableId, tableIds),
                  isNull(posShiftTableTransfers.endedAt),
                  gt(posShiftTableTransfers.expiresAt, new Date()),
                  eq(posShiftSectionStaff.identityId, identityId),
                ),
              )
              .limit(1),
            currentGroupIds.length
              ? tx
                  .select({ id: posDiningTableGroups.id })
                  .from(posDiningTableGroups)
                  .where(
                    and(
                      eq(posDiningTableGroups.organizationId, organizationId),
                      eq(posDiningTableGroups.unitId, unitId),
                      inArray(posDiningTableGroups.id, currentGroupIds),
                      eq(posDiningTableGroups.responsibleIdentityId, identityId),
                      isNull(posDiningTableGroups.dissolvedAt),
                    ),
                  )
                  .limit(1)
              : Promise.resolve([]),
          ]);
          const operatesSelectedTable =
            openTabs.some((tab) => tab.responsibleIdentityId === identityId) ||
            Boolean(sectionAssignment[0] || transferAssignment[0] || coordinatedGroup[0]);
          if (!operatesSelectedTable) {
            throw new ForbiddenException({ code: "TABLE_GROUP_OUTSIDE_ASSIGNMENT" });
          }
        }
        let targetTabId: string | null = null;
        let mergeResult: JsonResponse | null = null;
        if (input.mode === "single_tab" && openTabs.length > 0) {
          targetTabId =
            input.targetTabId ??
            openTabs.find((tab) => tab.tableId === input.anchorTableId)?.id ??
            null;
          if (!targetTabId || !openTabs.some((tab) => tab.id === targetTabId)) {
            throw new ConflictException({
              code: "GROUP_TARGET_TAB_REQUIRED",
              message: "Escolha como principal uma mesa com comanda aberta.",
            });
          }
          const sourceTabIds = openTabs
            .map((tab) => tab.id)
            .filter((tabId) => tabId !== targetTabId);
          for (const tabId of [...openTabs.map((tab) => tab.id)].sort()) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${tabId}`}))`,
            );
          }
          mergeResult =
            sourceTabIds.length > 0
              ? await this.mergeOpenTabs(
                  tx,
                  identityId,
                  organizationId,
                  unitId,
                  targetTabId,
                  sourceTabIds,
                  false,
                  { reasonCode: input.reasonCode, reasonNote: input.reasonNote },
                )
              : { targetTabId, sourceTabIds: [] };
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                inArray(posDiningTables.id, tableIds),
              ),
            );
        }

        const responsibilityTabIds =
          groupResponsibleIdentityId && input.mode === "single_tab" && targetTabId
            ? [targetTabId]
            : [];
        if (groupResponsibleIdentityId && responsibilityTabIds.length > 0) {
          await tx
            .update(posTabs)
            .set({
              responsibleIdentityId: groupResponsibleIdentityId,
              version: sql`${posTabs.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                inArray(posTabs.id, responsibilityTabIds),
                eq(posTabs.status, "open"),
              ),
            );
          for (const tabId of responsibilityTabIds) {
            await this.recordEvent(
              tx,
              identityId,
              organizationId,
              unitId,
              tabId,
              "tab.responsibility_transferred",
              {
                to: groupResponsibleIdentityId,
                reason: "table_group_created",
              },
            );
          }
        }

        const [group] = await tx
          .insert(posDiningTableGroups)
          .values({
            organizationId,
            unitId,
            anchorTableId: input.anchorTableId,
            primaryTabId: targetTabId,
            mode: input.mode,
            responsibleIdentityId: groupResponsibleIdentityId,
            reasonCode: input.reasonCode,
            reasonNote: input.reasonNote,
            createdByIdentityId: identityId,
          })
          .returning();
        if (!group) throw new Error("Table group insert did not return a row");
        const members = await tx
          .insert(posDiningTableGroupMembers)
          .values(
            tableIds.map((tableId) => ({
              organizationId,
              unitId,
              groupId: group.id,
              tableId,
            })),
          )
          .returning();
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.table_group.created",
          entityType: "table_group",
          entityId: group.id,
          metadata: {
            tableIds,
            anchorTableId: input.anchorTableId,
            mode: input.mode,
            targetTabId,
            responsibleIdentityId: groupResponsibleIdentityId,
            reasonCode: input.reasonCode,
            reasonNote: input.reasonNote ?? null,
            shiftSectionIds: [
              ...new Set(
                openTabs.flatMap((tab) => (tab.shiftSectionId ? [tab.shiftSectionId] : [])),
              ),
            ],
          },
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.table_group.created",
          aggregateType: "table_group",
          aggregateId: group.id,
          payload: {
            organizationId,
            unitId,
            groupId: group.id,
            tableIds,
            mode: input.mode,
            reasonCode: input.reasonCode,
          },
        });
        return { group, members, mergeResult };
      },
    );
  }

  async detachTableGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    groupId: string,
    idempotencyKey: string,
    input: DetachTableGroupInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-group.detach",
      { groupId, ...input },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-table-group:${organizationId}:${unitId}:${groupId}`}))`,
        );
        const [group] = await tx
          .select()
          .from(posDiningTableGroups)
          .where(
            and(
              eq(posDiningTableGroups.organizationId, organizationId),
              eq(posDiningTableGroups.unitId, unitId),
              eq(posDiningTableGroups.id, groupId),
              isNull(posDiningTableGroups.dissolvedAt),
            ),
          )
          .limit(1);
        if (!group) throw new NotFoundException({ code: "TABLE_GROUP_NOT_FOUND" });
        if (group.anchorTableId === input.tableId) {
          throw new ConflictException({ code: "GROUP_ANCHOR_CANNOT_DETACH" });
        }
        const members = await tx
          .select()
          .from(posDiningTableGroupMembers)
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              eq(posDiningTableGroupMembers.groupId, groupId),
            ),
          );
        if (!members.some((member) => member.tableId === input.tableId)) {
          throw new NotFoundException({ code: "TABLE_GROUP_MEMBER_NOT_FOUND" });
        }
        await tx
          .delete(posDiningTableGroupMembers)
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              eq(posDiningTableGroupMembers.groupId, groupId),
              eq(posDiningTableGroupMembers.tableId, input.tableId),
            ),
          );
        const [openTab] = await tx
          .select({ id: posTabs.id })
          .from(posTabs)
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.tableId, input.tableId),
              eq(posTabs.status, "open"),
            ),
          )
          .limit(1);
        if (!openTab) {
          await tx
            .update(posDiningTables)
            .set({ status: "needs_cleaning", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
              ),
            );
        }
        if (members.length === 2) {
          await tx
            .delete(posDiningTableGroupMembers)
            .where(
              and(
                eq(posDiningTableGroupMembers.organizationId, organizationId),
                eq(posDiningTableGroupMembers.unitId, unitId),
                eq(posDiningTableGroupMembers.groupId, groupId),
              ),
            );
          await tx
            .update(posDiningTableGroups)
            .set({ dissolvedAt: new Date(), updatedAt: new Date() })
            .where(eq(posDiningTableGroups.id, groupId));
        }
        if (group.primaryTabId) {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            group.primaryTabId,
            "table-group.member_detached",
            { groupId, tableId: input.tableId },
          );
        }
        return { groupId, tableId: input.tableId, dissolved: members.length === 2 };
      },
    );
  }

  async dissolveTableGroup(
    identityId: string,
    organizationId: string,
    unitId: string,
    groupId: string,
    idempotencyKey: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "table-group.dissolve",
      { groupId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`pos-table-group:${organizationId}:${unitId}:${groupId}`}))`,
        );
        const [group] = await tx
          .select()
          .from(posDiningTableGroups)
          .where(
            and(
              eq(posDiningTableGroups.organizationId, organizationId),
              eq(posDiningTableGroups.unitId, unitId),
              eq(posDiningTableGroups.id, groupId),
              isNull(posDiningTableGroups.dissolvedAt),
            ),
          )
          .limit(1);
        if (!group) throw new NotFoundException({ code: "TABLE_GROUP_NOT_FOUND" });
        if (group.mode === "single_tab" && group.primaryTabId) {
          const orders = await tx
            .select({ id: posOrderItems.id })
            .from(posOrderItems)
            .innerJoin(posOrders, eq(posOrders.id, posOrderItems.orderId))
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.tabId, group.primaryTabId),
              ),
            )
            .limit(1);
          if (orders.length > 0) {
            throw new ConflictException({
              code: "GROUP_SPLIT_REQUIRED",
              message: "Separe os itens antes de desfazer um grupo com consumo.",
            });
          }
        }
        const members = await tx
          .select()
          .from(posDiningTableGroupMembers)
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              eq(posDiningTableGroupMembers.groupId, groupId),
            ),
          );
        await tx
          .delete(posDiningTableGroupMembers)
          .where(
            and(
              eq(posDiningTableGroupMembers.organizationId, organizationId),
              eq(posDiningTableGroupMembers.unitId, unitId),
              eq(posDiningTableGroupMembers.groupId, groupId),
            ),
          );
        await tx
          .update(posDiningTableGroups)
          .set({ dissolvedAt: new Date(), updatedAt: new Date() })
          .where(eq(posDiningTableGroups.id, groupId));
        if (group.mode === "single_tab") {
          const releasedTableIds = members
            .map((member) => member.tableId)
            .filter((tableId) => tableId !== group.anchorTableId);
          if (releasedTableIds.length > 0) {
            await tx
              .update(posDiningTables)
              .set({ status: "needs_cleaning", updatedAt: new Date() })
              .where(
                and(
                  eq(posDiningTables.organizationId, organizationId),
                  eq(posDiningTables.unitId, unitId),
                  inArray(posDiningTables.id, releasedTableIds),
                ),
              );
          }
        }
        if (group.primaryTabId) {
          await this.recordEvent(
            tx,
            identityId,
            organizationId,
            unitId,
            group.primaryTabId,
            "table-group.dissolved",
            { groupId, tableIds: members.map((member) => member.tableId) },
          );
        }
        return { groupId, dissolved: true };
      },
    );
  }

  async splitTab(
    identityId: string,
    organizationId: string,
    unitId: string,
    sourceTabId: string,
    idempotencyKey: string,
    input: SplitTabInput,
    offlineIds?: {
      targetTabId: string;
      targetOrderId: string;
      movedItemIdForSource: (sourceItemId: string) => string;
      movedModifierIdForSource: (sourceItemId: string, modifierId: string) => string;
    },
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [sourceTabId]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "cashier",
    ]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:printing:request",
    );
    await this.requireOperationalBilling(organizationId);
    const requestedIds = input.items.map((item) => item.orderItemId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException({ code: "DUPLICATE_SPLIT_ITEM" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.split",
      { sourceTabId, ...input },
      async (tx) => {
        const source = await this.requireOpenTab(tx, organizationId, unitId, sourceTabId);
        const paymentState = await this.lockTabPaymentState(
          tx,
          organizationId,
          unitId,
          sourceTabId,
        );
        if (
          paymentState.paidCents > 0 ||
          paymentState.coveredLossCents > 0 ||
          paymentState.reservedCents > 0
        ) {
          throw new ConflictException({
            code: "TAB_SPLIT_FINANCIAL_STATE_CONFLICT",
            message:
              "Não é possível dividir uma comanda com pagamento, perda ou cobrança reservada.",
            ...paymentState,
          });
        }
        if (input.tableId) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-table:${organizationId}:${unitId}:${input.tableId}`}))`,
          );
          const [table] = await tx
            .select({ id: posDiningTables.id, status: posDiningTables.status })
            .from(posDiningTables)
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
                eq(posDiningTables.active, true),
              ),
            )
            .limit(1);
          if (!table) throw new NotFoundException({ code: "TABLE_NOT_FOUND" });
          if (table.status !== "available") {
            throw new ConflictException({ code: "TABLE_NOT_AVAILABLE", status: table.status });
          }
          const [occupied] = await tx
            .select({ id: posTabs.id })
            .from(posTabs)
            .where(
              and(
                eq(posTabs.organizationId, organizationId),
                eq(posTabs.unitId, unitId),
                eq(posTabs.tableId, input.tableId),
                eq(posTabs.status, "open"),
              ),
            )
            .limit(1);
          if (occupied) throw new ConflictException({ code: "TABLE_OCCUPIED", tabId: occupied.id });
        }
        let items = await tx
          .select({
            item: posOrderItems,
            orderStatus: posOrders.status,
            orderPriority: posOrders.kdsPriority,
            orderPriorityReason: posOrders.kdsPriorityReason,
            orderPriorityUpdatedAt: posOrders.kdsPriorityUpdatedAt,
            orderPriorityUpdatedByIdentityId: posOrders.kdsPriorityUpdatedByIdentityId,
          })
          .from(posOrderItems)
          .innerJoin(
            posOrders,
            and(
              eq(posOrders.organizationId, posOrderItems.organizationId),
              eq(posOrders.unitId, posOrderItems.unitId),
              eq(posOrders.id, posOrderItems.orderId),
            ),
          )
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrders.tabId, sourceTabId),
              inArray(posOrderItems.id, requestedIds),
            ),
          );
        const splitTicketRows = await tx
          .select({ ticketId: posKdsTicketItems.ticketId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.orderItemId, requestedIds),
            ),
          );
        const splitTicketIds = [...new Set(splitTicketRows.map((row) => row.ticketId))].sort();
        await this.lockKdsScope(
          tx,
          organizationId,
          unitId,
          [...new Set(items.map(({ item }) => item.orderId))],
          splitTicketIds,
        );
        items = await tx
          .select({
            item: posOrderItems,
            orderStatus: posOrders.status,
            orderPriority: posOrders.kdsPriority,
            orderPriorityReason: posOrders.kdsPriorityReason,
            orderPriorityUpdatedAt: posOrders.kdsPriorityUpdatedAt,
            orderPriorityUpdatedByIdentityId: posOrders.kdsPriorityUpdatedByIdentityId,
          })
          .from(posOrderItems)
          .innerJoin(
            posOrders,
            and(
              eq(posOrders.organizationId, posOrderItems.organizationId),
              eq(posOrders.unitId, posOrderItems.unitId),
              eq(posOrders.id, posOrderItems.orderId),
            ),
          )
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrders.tabId, sourceTabId),
              inArray(posOrderItems.id, requestedIds),
            ),
          );
        if (items.length !== requestedIds.length) {
          throw new NotFoundException({ code: "SPLIT_ITEM_NOT_FOUND" });
        }
        if (items.some(({ item }) => item.status === "canceled")) {
          throw new ConflictException({ code: "CANCELED_ITEM_CANNOT_SPLIT" });
        }
        const [doseClubItem] = await tx
          .select({ orderItemId: doseClubRedemptions.orderItemId })
          .from(doseClubRedemptions)
          .where(
            and(
              eq(doseClubRedemptions.organizationId, organizationId),
              eq(doseClubRedemptions.unitId, unitId),
              inArray(doseClubRedemptions.orderItemId, requestedIds),
            ),
          )
          .limit(1);
        if (doseClubItem) {
          throw new ConflictException({
            code: "DOSECLUB_ITEM_CANNOT_SPLIT",
            message: "Cancele e lance novamente a dose na comanda correta.",
          });
        }
        for (const requested of input.items) {
          const row = items.find(({ item }) => item.id === requested.orderItemId);
          if (!row || requested.quantity > row.item.quantity) {
            throw new BadRequestException({
              code: "INVALID_SPLIT_QUANTITY",
              orderItemId: requested.orderItemId,
            });
          }
        }
        const [target] = await tx
          .insert(posTabs)
          .values({
            id: offlineIds?.targetTabId,
            organizationId,
            unitId,
            tableId: input.tableId,
            openedByIdentityId: identityId,
            operationalShiftId: source.operationalShiftId,
            shiftSectionId: source.shiftSectionId,
            responsibleIdentityId: source.responsibleIdentityId,
            label: input.label,
            guestCount: 1,
            serviceChargeBasisPoints: source.serviceChargeBasisPoints,
          })
          .returning();
        if (!target) throw new Error("Split target tab insert did not return a row");
        const hasProductionHistory = items.some(({ orderStatus }) => orderStatus !== "draft");
        const productionAlreadyReady =
          hasProductionHistory &&
          items.every(({ orderStatus }) => ["ready", "served", "canceled"].includes(orderStatus));
        const splitAt = new Date();
        const inheritedPriority = [...items].sort(
          (left, right) => right.orderPriority - left.orderPriority,
        )[0];
        const [targetOrder] = await tx
          .insert(posOrders)
          .values({
            id: offlineIds?.targetOrderId,
            organizationId,
            unitId,
            tabId: target.id,
            createdByIdentityId: identityId,
            status: hasProductionHistory ? "sent" : "draft",
            sentAt: hasProductionHistory ? splitAt : undefined,
            readyNotifiedAt: productionAlreadyReady ? splitAt : undefined,
            kdsPriority: inheritedPriority?.orderPriority ?? 0,
            kdsPriorityReason: inheritedPriority?.orderPriorityReason,
            kdsPriorityUpdatedAt: inheritedPriority?.orderPriorityUpdatedAt,
            kdsPriorityUpdatedByIdentityId: inheritedPriority?.orderPriorityUpdatedByIdentityId,
          })
          .returning();
        if (!targetOrder) throw new Error("Split target order insert did not return a row");
        const productionLinks =
          splitTicketIds.length === 0
            ? []
            : await tx
                .select({ assignment: posKdsTicketItems, ticket: posKdsTickets })
                .from(posKdsTicketItems)
                .innerJoin(
                  posKdsTickets,
                  and(
                    eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
                    eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
                    eq(posKdsTickets.id, posKdsTicketItems.ticketId),
                  ),
                )
                .where(
                  and(
                    eq(posKdsTicketItems.organizationId, organizationId),
                    eq(posKdsTicketItems.unitId, unitId),
                    inArray(posKdsTicketItems.orderItemId, requestedIds),
                  ),
                );
        const targetTicketBySource = new Map<string, string>();
        const ensureTargetTicket = async (sourceTicket: typeof posKdsTickets.$inferSelect) => {
          const existing = targetTicketBySource.get(sourceTicket.id);
          if (existing) return existing;
          const [targetTicket] = await tx
            .insert(posKdsTickets)
            .values({
              organizationId,
              unitId,
              orderId: targetOrder.id,
              stationId: sourceTicket.stationId,
              status: sourceTicket.status,
              priority: targetOrder.kdsPriority,
              dueAt: sourceTicket.dueAt,
              startedAt: sourceTicket.startedAt,
              readyAt: sourceTicket.readyAt,
              handedOffAt: sourceTicket.handedOffAt,
              servedAt: sourceTicket.servedAt,
              completedAt: sourceTicket.completedAt,
              recallCount: sourceTicket.recallCount,
              refireCount: sourceTicket.refireCount,
            })
            .returning({ id: posKdsTickets.id });
          if (!targetTicket) throw new Error("Split target KDS ticket insert did not return a row");
          targetTicketBySource.set(sourceTicket.id, targetTicket.id);
          return targetTicket.id;
        };
        const assignmentStateFor = (
          sourceStatus: (typeof posKdsTicketItems.$inferSelect)["status"],
          quantity: number,
          readyQuantity: number,
        ) => {
          if (sourceStatus === "served" || sourceStatus === "canceled") return sourceStatus;
          if (readyQuantity === quantity) return "ready" as const;
          if (sourceStatus === "preparing" || readyQuantity > 0) return "preparing" as const;
          return "queued" as const;
        };
        const movedItemIds: string[] = [];
        for (const requested of input.items) {
          const sourceRow = items.find(({ item }) => item.id === requested.orderItemId);
          if (!sourceRow) throw new Error("Validated split item disappeared");
          const sourceItem = sourceRow.item;
          const itemProductionLinks = productionLinks.filter(
            ({ assignment }) => assignment.orderItemId === sourceItem.id,
          );
          if (requested.quantity === sourceItem.quantity) {
            await tx
              .update(posOrderItems)
              .set({ orderId: targetOrder.id, updatedAt: new Date() })
              .where(
                and(
                  eq(posOrderItems.organizationId, organizationId),
                  eq(posOrderItems.unitId, unitId),
                  eq(posOrderItems.id, sourceItem.id),
                ),
              );
            for (const { assignment, ticket } of itemProductionLinks) {
              const targetTicketId = await ensureTargetTicket(ticket);
              await tx
                .update(posKdsTicketItems)
                .set({ ticketId: targetTicketId })
                .where(
                  and(
                    eq(posKdsTicketItems.organizationId, organizationId),
                    eq(posKdsTicketItems.unitId, unitId),
                    eq(posKdsTicketItems.ticketId, assignment.ticketId),
                    eq(posKdsTicketItems.orderItemId, sourceItem.id),
                  ),
                );
            }
            movedItemIds.push(sourceItem.id);
            continue;
          }
          const movedGross = Math.floor(
            (sourceItem.grossCents * requested.quantity) / sourceItem.quantity,
          );
          const movedDiscount = Math.floor(
            (sourceItem.discountCents * requested.quantity) / sourceItem.quantity,
          );
          const movedModifiers = Math.floor(
            (sourceItem.modifiersCents * requested.quantity) / sourceItem.quantity,
          );
          const movedCost =
            sourceItem.costCents === null
              ? null
              : Math.floor((sourceItem.costCents * requested.quantity) / sourceItem.quantity);
          const remainingQuantity = sourceItem.quantity - requested.quantity;
          const remainingGross = sourceItem.grossCents - movedGross;
          const remainingDiscount = sourceItem.discountCents - movedDiscount;
          await tx
            .update(posOrderItems)
            .set({
              quantity: remainingQuantity,
              grossCents: remainingGross,
              modifiersCents: sourceItem.modifiersCents - movedModifiers,
              discountCents: remainingDiscount,
              netCents: remainingGross - remainingDiscount,
              costCents:
                sourceItem.costCents === null ? null : sourceItem.costCents - (movedCost ?? 0),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                eq(posOrderItems.id, sourceItem.id),
              ),
            );
          const [moved] = await tx
            .insert(posOrderItems)
            .values({
              id: offlineIds?.movedItemIdForSource(sourceItem.id),
              organizationId,
              unitId,
              orderId: targetOrder.id,
              productId: sourceItem.productId,
              stationId: sourceItem.stationId,
              productName: sourceItem.productName,
              quantity: requested.quantity,
              unitPriceCents: sourceItem.unitPriceCents,
              modifiersCents: movedModifiers,
              grossCents: movedGross,
              discountCents: movedDiscount,
              netCents: movedGross - movedDiscount,
              costCents: movedCost,
              status: sourceItem.status,
              seatNumber: sourceItem.seatNumber,
              course: sourceItem.course,
              estimatedPrepTimeMinutes: sourceItem.estimatedPrepTimeMinutes,
              allergyNote: sourceItem.allergyNote,
              notes: sourceItem.notes,
            })
            .returning();
          if (!moved) throw new Error("Split item insert did not return a row");
          movedItemIds.push(moved.id);
          for (const { assignment, ticket } of itemProductionLinks) {
            const targetTicketId = await ensureTargetTicket(ticket);
            const movedReadyQuantity = Math.min(assignment.readyQuantity, requested.quantity);
            const remainingReadyQuantity = assignment.readyQuantity - movedReadyQuantity;
            const remainingAssignmentQuantity = assignment.quantity - requested.quantity;
            if (remainingAssignmentQuantity <= 0) {
              throw new ConflictException({ code: "KDS_SPLIT_QUANTITY_MISMATCH" });
            }
            await tx
              .update(posKdsTicketItems)
              .set({
                quantity: remainingAssignmentQuantity,
                readyQuantity: remainingReadyQuantity,
                status: assignmentStateFor(
                  assignment.status,
                  remainingAssignmentQuantity,
                  remainingReadyQuantity,
                ),
                readyAt:
                  remainingReadyQuantity === remainingAssignmentQuantity
                    ? assignment.readyAt
                    : null,
              })
              .where(
                and(
                  eq(posKdsTicketItems.organizationId, organizationId),
                  eq(posKdsTicketItems.unitId, unitId),
                  eq(posKdsTicketItems.ticketId, assignment.ticketId),
                  eq(posKdsTicketItems.orderItemId, sourceItem.id),
                ),
              );
            const movedState = assignmentStateFor(
              assignment.status,
              requested.quantity,
              movedReadyQuantity,
            );
            await tx.insert(posKdsTicketItems).values({
              organizationId,
              unitId,
              ticketId: targetTicketId,
              orderItemId: moved.id,
              quantity: requested.quantity,
              readyQuantity: movedReadyQuantity,
              status: movedState,
              held: assignment.held,
              heldAt: assignment.heldAt,
              firedAt: assignment.firedAt,
              startedAt: movedState === "queued" ? null : assignment.startedAt,
              readyAt:
                movedState === "ready" || movedState === "served" ? assignment.readyAt : null,
              completedAt: assignment.completedAt,
            });
          }
          const modifiers = await tx
            .select()
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                eq(posOrderItemModifiers.orderItemId, sourceItem.id),
              ),
            );
          for (const modifier of modifiers) {
            const movedDelta = Math.floor(
              (modifier.totalDeltaCents * requested.quantity) / sourceItem.quantity,
            );
            await tx
              .update(posOrderItemModifiers)
              .set({ totalDeltaCents: modifier.totalDeltaCents - movedDelta })
              .where(
                and(
                  eq(posOrderItemModifiers.organizationId, organizationId),
                  eq(posOrderItemModifiers.unitId, unitId),
                  eq(posOrderItemModifiers.id, modifier.id),
                ),
              );
            await tx.insert(posOrderItemModifiers).values({
              id: offlineIds?.movedModifierIdForSource(sourceItem.id, modifier.id),
              organizationId,
              unitId,
              orderItemId: moved.id,
              optionId: modifier.optionId,
              name: modifier.name,
              quantity: modifier.quantity,
              unitDeltaCents: modifier.unitDeltaCents,
              totalDeltaCents: movedDelta,
            });
          }
        }
        const kdsSplitNow = new Date();
        const sourceTickets = [
          ...new Map(productionLinks.map(({ ticket }) => [ticket.id, ticket])).values(),
        ];
        for (const ticket of sourceTickets) {
          const remainingRows = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(posKdsTicketItems)
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.ticketId, ticket.id),
              ),
            );
          if ((remainingRows[0]?.count ?? 0) === 0) {
            await tx
              .update(posKdsTickets)
              .set({ status: "canceled", completedAt: kdsSplitNow, updatedAt: kdsSplitNow })
              .where(
                and(
                  eq(posKdsTickets.organizationId, organizationId),
                  eq(posKdsTickets.unitId, unitId),
                  eq(posKdsTickets.id, ticket.id),
                ),
              );
          } else if (!ticket.handedOffAt && !ticket.servedAt) {
            await this.refreshKdsTicketState(tx, organizationId, unitId, ticket.id, kdsSplitNow);
          }
          const targetTicketId = targetTicketBySource.get(ticket.id);
          if (targetTicketId && !ticket.handedOffAt && !ticket.servedAt) {
            await this.refreshKdsTicketState(
              tx,
              organizationId,
              unitId,
              targetTicketId,
              kdsSplitNow,
            );
          }
        }
        const splitOrderIds = [
          ...new Set([...items.map(({ item }) => item.orderId), targetOrder.id]),
        ].sort();
        for (const splitOrderId of splitOrderIds) {
          await this.syncOrderStatus(
            tx,
            identityId,
            organizationId,
            unitId,
            splitOrderId,
            kdsSplitNow,
          );
        }
        for (const [sourceTicketId, targetTicketId] of targetTicketBySource) {
          await this.recordKdsAction(
            tx,
            identityId,
            organizationId,
            unitId,
            targetTicketId,
            "split_created",
            {
              sourceTicketId,
              sourceTabId,
              targetTabId: target.id,
              targetOrderId: targetOrder.id,
              movedItemIds,
            },
          );
        }
        if (input.tableId) {
          await tx
            .update(posDiningTables)
            .set({ status: "occupied", updatedAt: new Date() })
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, input.tableId),
              ),
            );
        }
        const sourceTotals = await this.recalculateTab(tx, organizationId, unitId, sourceTabId);
        const targetTotals = await this.recalculateTab(tx, organizationId, unitId, target.id);
        const printInput: PrintJobInput = {
          documentType: "partial_statement",
          copies: input.copies ?? 1,
          installationId: input.installationId,
          terminalId: input.terminalId,
          printerId: input.printerId,
        };
        const sourcePrintJob = await this.queuePrintJob(
          tx,
          identityId,
          organizationId,
          unitId,
          sourceTabId,
          printInput,
        );
        const targetPrintJob = await this.queuePrintJob(
          tx,
          identityId,
          organizationId,
          unitId,
          target.id,
          printInput,
        );
        await this.recordEvent(tx, identityId, organizationId, unitId, sourceTabId, "tab.split", {
          targetTabId: target.id,
          movedItemIds,
          printJobIds: [sourcePrintJob.id, targetPrintJob.id],
        });
        return {
          sourceTabId,
          targetTabId: target.id,
          printableTabIds: [sourceTabId, target.id],
          movedItemIds,
          sourceTotals,
          targetTotals,
          printJobs: [sourcePrintJob, targetPrintJob],
        };
      },
    );
  }

  async moveItems(
    identityId: string,
    organizationId: string,
    unitId: string,
    sourceTabId: string,
    idempotencyKey: string,
    input: MoveItemsInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [
      sourceTabId,
      input.targetTabId,
    ]);
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    if (sourceTabId === input.targetTabId) {
      throw new BadRequestException({ code: "MOVE_TARGET_IS_SOURCE" });
    }
    const itemIds = input.items.map((item) => item.orderItemId);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException({ code: "DUPLICATE_MOVE_ITEM" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.items.move",
      { sourceTabId, ...input },
      async (tx) => {
        for (const tabId of [sourceTabId, input.targetTabId].sort()) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${tabId}`}))`,
          );
        }
        await this.requireOpenTab(tx, organizationId, unitId, sourceTabId);
        await this.requireOpenTab(tx, organizationId, unitId, input.targetTabId);
        const [payment] = await tx
          .select({ id: posTabPayments.id })
          .from(posTabPayments)
          .where(
            and(
              eq(posTabPayments.organizationId, organizationId),
              eq(posTabPayments.unitId, unitId),
              inArray(posTabPayments.tabId, [sourceTabId, input.targetTabId]),
            ),
          )
          .limit(1);
        if (payment) {
          throw new ConflictException({
            code: "MOVE_ITEM_HAS_PAYMENTS",
            message: "Não mova itens depois do primeiro pagamento.",
          });
        }
        const items = await tx
          .select({ item: posOrderItems, orderStatus: posOrders.status })
          .from(posOrderItems)
          .innerJoin(posOrders, eq(posOrders.id, posOrderItems.orderId))
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrders.tabId, sourceTabId),
              inArray(posOrderItems.id, itemIds),
            ),
          );
        if (items.length !== itemIds.length) {
          throw new NotFoundException({ code: "MOVE_ITEM_NOT_FOUND" });
        }
        const [doseClubItem] = await tx
          .select({ orderItemId: doseClubRedemptions.orderItemId })
          .from(doseClubRedemptions)
          .where(
            and(
              eq(doseClubRedemptions.organizationId, organizationId),
              eq(doseClubRedemptions.unitId, unitId),
              inArray(doseClubRedemptions.orderItemId, itemIds),
            ),
          )
          .limit(1);
        if (doseClubItem) {
          throw new ConflictException({
            code: "DOSECLUB_ITEM_CANNOT_MOVE",
            message: "Cancele e lance novamente a dose na comanda correta.",
          });
        }
        for (const requested of input.items) {
          const row = items.find(({ item }) => item.id === requested.orderItemId);
          if (row?.orderStatus !== "draft" || row.item.status !== "draft") {
            throw new ConflictException({
              code: "MOVE_ITEM_ALREADY_SENT",
              message: "Somente itens ainda não enviados podem mudar de comanda.",
            });
          }
          if (requested.quantity !== row.item.quantity) {
            throw new BadRequestException({
              code: "MOVE_ITEM_WHOLE_LINE_REQUIRED",
              message: "Separe a quantidade antes de mover parte de um item.",
            });
          }
        }
        let [targetOrder] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.tabId, input.targetTabId),
              eq(posOrders.status, "draft"),
            ),
          )
          .limit(1);
        if (!targetOrder) {
          [targetOrder] = await tx
            .insert(posOrders)
            .values({
              organizationId,
              unitId,
              tabId: input.targetTabId,
              createdByIdentityId: identityId,
            })
            .returning();
        }
        if (!targetOrder) throw new Error("Target order insert did not return a row");
        await tx
          .update(posOrderItems)
          .set({ orderId: targetOrder.id, updatedAt: new Date() })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              inArray(posOrderItems.id, itemIds),
            ),
          );
        const sourceTotals = await this.recalculateTab(tx, organizationId, unitId, sourceTabId);
        const targetTotals = await this.recalculateTab(
          tx,
          organizationId,
          unitId,
          input.targetTabId,
        );
        await this.recordEvent(tx, identityId, organizationId, unitId, sourceTabId, "items.moved", {
          targetTabId: input.targetTabId,
          itemIds,
        });
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          input.targetTabId,
          "items.received",
          { sourceTabId, itemIds },
        );
        return { sourceTabId, targetTabId: input.targetTabId, itemIds, sourceTotals, targetTotals };
      },
    );
  }

  async setServiceCharge(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: ServiceChargeInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:charges:adjust",
    );
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.service_charge",
      { tabId, ...input },
      async (tx) => {
        await this.requireOpenTab(tx, organizationId, unitId, tabId);
        await tx
          .update(posTabs)
          .set({ serviceChargeBasisPoints: input.basisPoints, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "tab.service_charge_changed",
          input,
        );
        return { tabId, totals };
      },
    );
  }

  async setTip(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    idempotencyKey: string,
    input: TipInput,
  ) {
    await this.requireTabOperationalAccess(identityId, organizationId, unitId, [tabId]);
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:charges:adjust",
    );
    await this.requireOperationalBilling(organizationId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "tab.tip",
      { tabId, ...input },
      async (tx) => {
        await this.requireOpenTab(tx, organizationId, unitId, tabId);
        await tx
          .update(posTabs)
          .set({ tipCents: input.tipCents, updatedAt: new Date() })
          .where(
            and(
              eq(posTabs.organizationId, organizationId),
              eq(posTabs.unitId, unitId),
              eq(posTabs.id, tabId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          tabId,
          "tab.tip_changed",
          input,
        );
        return { tabId, totals };
      },
    );
  }

  async discountItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    itemId: string,
    idempotencyKey: string,
    input: DiscountInput,
    offlineIds?: { approvalId: string },
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:exceptions:approve",
    );
    await this.requireOperationalBilling(organizationId);
    const idempotencyInput = {
      itemId,
      ...input,
      approval: { ...input.approval, pin: "[redacted]" },
    };
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "item.discount",
      idempotencyInput,
      async (tx) => {
        const row = await this.getScopedItem(tx, organizationId, unitId, itemId);
        if (row.item.status === "canceled") throw new ConflictException({ code: "ITEM_CANCELED" });
        if (input.discountCents > row.item.grossCents) {
          throw new BadRequestException({ code: "DISCOUNT_EXCEEDS_ITEM" });
        }
        const approval = await this.approve(
          tx,
          identityId,
          organizationId,
          unitId,
          "discount",
          "order_item",
          itemId,
          input.approval,
          offlineIds?.approvalId,
        );
        await tx
          .update(posOrderItems)
          .set({
            discountCents: input.discountCents,
            netCents: row.item.grossCents - input.discountCents,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.id, itemId),
            ),
          );
        const totals = await this.recalculateTab(tx, organizationId, unitId, row.tabId);
        await this.recordEvent(
          tx,
          identityId,
          organizationId,
          unitId,
          row.tabId,
          "item.discounted",
          {
            itemId,
            discountCents: input.discountCents,
            approvalId: approval.id,
          },
        );
        return { itemId, discountCents: input.discountCents, approvalId: approval.id, totals };
      },
    );
  }

  async cancelItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    itemId: string,
    idempotencyKey: string,
    input: CancelItemInput,
    offlineIds?: { approvalId: string },
  ) {
    await this.requireScopedCapability(
      identityId,
      organizationId,
      unitId,
      "operations:exceptions:approve",
    );
    const idempotencyInput = {
      itemId,
      ...input,
      approval: { ...input.approval, pin: "[redacted]" },
    };
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "item.cancel",
      idempotencyInput,
      async (tx) => {
        const initial = await this.getScopedItem(tx, organizationId, unitId, itemId);
        const ticketRows = await tx
          .select({ ticketId: posKdsTicketItems.ticketId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.orderItemId, itemId),
            ),
          );
        const ticketIds = [...new Set(ticketRows.map((entry) => entry.ticketId))].sort();
        await this.lockKdsScope(tx, organizationId, unitId, [initial.item.orderId], ticketIds);
        const row = await this.getScopedItem(tx, organizationId, unitId, itemId);
        if (row.item.status === "canceled")
          throw new ConflictException({ code: "ITEM_ALREADY_CANCELED" });
        if (row.item.status === "served") {
          throw new ConflictException({ code: "ITEM_ALREADY_SERVED" });
        }
        const approval = await this.approve(
          tx,
          identityId,
          organizationId,
          unitId,
          "cancel",
          "order_item",
          itemId,
          input.approval,
          offlineIds?.approvalId,
        );
        const now = new Date();
        await tx
          .update(posOrderItems)
          .set({
            status: "canceled",
            discountCents: 0,
            netCents: 0,
            canceledAt: now,
            canceledReason: input.approval.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.id, itemId),
            ),
          );
        const [unit] = await tx
          .select({ timezone: units.timezone })
          .from(units)
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        const businessDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: unit?.timezone ?? "America/Sao_Paulo",
        }).format(now);
        await tx
          .update(posProductAvailability)
          .set({
            soldToday: sql`greatest(0, ${posProductAvailability.soldToday} - ${row.item.quantity})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(posProductAvailability.organizationId, organizationId),
              eq(posProductAvailability.unitId, unitId),
              eq(posProductAvailability.productId, row.item.productId),
              eq(posProductAvailability.stockDate, businessDate),
            ),
          );
        if (ticketIds.length > 0) {
          await tx.insert(posKdsItemChanges).values(
            ticketIds.map((ticketId) => ({
              organizationId,
              unitId,
              ticketId,
              orderItemId: itemId,
              kind: "removed",
              revision: createHash("sha256")
                .update(`${ticketId}:removed:${itemId}:${now.toISOString()}`)
                .digest("hex"),
              summary: `${row.item.productName} foi cancelado após o envio`,
              details: { reason: input.approval.reason, quantity: row.item.quantity },
              createdByIdentityId: identityId,
              createdAt: now,
            })),
          );
          await tx
            .update(posKdsTicketItems)
            .set({
              status: "canceled",
              readyQuantity: 0,
              held: false,
              completedAt: now,
            })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.orderItemId, itemId),
                inArray(posKdsTicketItems.ticketId, ticketIds),
              ),
            );
          for (const ticketId of ticketIds) {
            await this.refreshKdsTicketState(tx, organizationId, unitId, ticketId, now);
            await this.syncOrdersForTicket(tx, identityId, organizationId, unitId, ticketId, now);
            await this.recordKdsAction(
              tx,
              identityId,
              organizationId,
              unitId,
              ticketId,
              "item_canceled",
              { itemId, approvalId: approval.id, reason: input.approval.reason },
            );
          }
        }
        const totals = await this.recalculateTab(tx, organizationId, unitId, row.tabId);
        await this.doseClub?.markCancellationPending(tx, organizationId, unitId, itemId);
        await this.recordEvent(tx, identityId, organizationId, unitId, row.tabId, "item.canceled", {
          itemId,
          approvalId: approval.id,
          reason: input.approval.reason,
        });
        return { itemId, status: "canceled", approvalId: approval.id, totals };
      },
    );
  }

  private isKdsAssignmentBlocked(assignment: typeof posKdsTicketItems.$inferSelect) {
    return assignment.blockedAt !== null && assignment.unblockedAt === null;
  }

  private kdsAttentionForItem(item: typeof posOrderItems.$inferSelect) {
    const entries = [
      { id: "allergy" as const, kind: "allergy" as const, value: item.allergyNote },
      { id: "notes" as const, kind: "note" as const, value: item.notes },
    ];
    return entries.flatMap(({ id, kind, value }) => {
      const text = normalizeKdsAttentionText(value);
      return text
        ? [{ id, kind, text, required: true as const, revision: kdsAttentionRevision(id, text) }]
        : [];
    });
  }

  private async assertKdsAttentionAcknowledged(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    rows: {
      assignment: typeof posKdsTicketItems.$inferSelect;
      item: typeof posOrderItems.$inferSelect;
    }[],
  ) {
    const expected = rows.flatMap(({ assignment, item }) =>
      this.kdsAttentionForItem(item).map((attention) => ({
        ticketId: assignment.ticketId,
        orderItemId: item.id,
        noteId: attention.id,
        revision: attention.revision,
      })),
    );
    if (expected.length === 0) return;
    const ticketIds = [...new Set(expected.map((entry) => entry.ticketId))];
    const orderItemIds = [...new Set(expected.map((entry) => entry.orderItemId))];
    const acknowledgements = await tx
      .select({
        ticketId: posKdsAttentionAcknowledgements.ticketId,
        orderItemId: posKdsAttentionAcknowledgements.orderItemId,
        noteId: posKdsAttentionAcknowledgements.noteId,
        revision: posKdsAttentionAcknowledgements.revision,
      })
      .from(posKdsAttentionAcknowledgements)
      .where(
        and(
          eq(posKdsAttentionAcknowledgements.organizationId, organizationId),
          eq(posKdsAttentionAcknowledgements.unitId, unitId),
          inArray(posKdsAttentionAcknowledgements.ticketId, ticketIds),
          inArray(posKdsAttentionAcknowledgements.orderItemId, orderItemIds),
        ),
      );
    const acknowledged = new Set(
      acknowledgements.map(
        (entry) => `${entry.ticketId}:${entry.orderItemId}:${entry.noteId}:${entry.revision}`,
      ),
    );
    const missing = expected.filter(
      (entry) =>
        !acknowledged.has(
          `${entry.ticketId}:${entry.orderItemId}:${entry.noteId}:${entry.revision}`,
        ),
    );
    if (missing.length > 0) {
      throw new ConflictException({
        code: "KDS_ATTENTION_ACK_REQUIRED",
        attention: missing,
      });
    }
  }

  private async readKdsBatch(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    batchId: string,
  ) {
    const [batch] = await tx
      .select()
      .from(posKdsBatches)
      .where(
        and(
          eq(posKdsBatches.organizationId, organizationId),
          eq(posKdsBatches.unitId, unitId),
          eq(posKdsBatches.id, batchId),
        ),
      )
      .limit(1);
    if (!batch) throw new NotFoundException({ code: "KDS_BATCH_NOT_FOUND" });
    const assignments = await tx
      .select({
        ticketId: posKdsBatchAssignments.ticketId,
        orderItemId: posKdsBatchAssignments.orderItemId,
        quantity: posKdsBatchAssignments.quantity,
        position: posKdsBatchAssignments.position,
      })
      .from(posKdsBatchAssignments)
      .where(
        and(
          eq(posKdsBatchAssignments.organizationId, organizationId),
          eq(posKdsBatchAssignments.unitId, unitId),
          eq(posKdsBatchAssignments.batchId, batchId),
        ),
      )
      .orderBy(asc(posKdsBatchAssignments.position));
    return {
      batchId: batch.id,
      stationId: batch.stationId,
      productId: batch.productId,
      state: batch.status,
      assignmentCount: assignments.length,
      totalQuantity: assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
      assignments,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
      canceledAt: batch.canceledAt,
    };
  }

  private async findKdsBatchCandidates(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    input: Pick<KdsBatchCreateInput, "stationId" | "productId">,
    ticketIds?: string[],
  ) {
    const filters = [
      eq(posKdsTicketItems.organizationId, organizationId),
      eq(posKdsTicketItems.unitId, unitId),
      eq(posKdsTickets.stationId, input.stationId),
      inArray(posKdsTickets.status, ["pending", "preparing"]),
      inArray(posKdsTicketItems.status, ["queued", "preparing"]),
      eq(posKdsTicketItems.held, false),
      isNotNull(posKdsTicketItems.firedAt),
      or(isNull(posKdsTicketItems.blockedAt), isNotNull(posKdsTicketItems.unblockedAt)),
    ];
    if (input.productId) filters.push(eq(posOrderItems.productId, input.productId));
    if (ticketIds) {
      if (ticketIds.length === 0) return [];
      filters.push(inArray(posKdsTicketItems.ticketId, ticketIds));
    }
    return tx
      .select({ assignment: posKdsTicketItems, item: posOrderItems, ticket: posKdsTickets })
      .from(posKdsTicketItems)
      .innerJoin(
        posKdsTickets,
        and(
          eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
          eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
          eq(posKdsTickets.id, posKdsTicketItems.ticketId),
        ),
      )
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .where(and(...filters))
      .orderBy(
        sql`${posKdsTicketItems.firedAt} asc nulls last`,
        asc(posOrderItems.createdAt),
        asc(posKdsTicketItems.ticketId),
        asc(posKdsTicketItems.orderItemId),
      )
      .limit(200);
  }

  private async activeKdsBatchMembershipKeys(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    rows: Array<{ ticketId: string; orderItemId: string }>,
  ) {
    if (rows.length === 0) return new Set<string>();
    const ticketIds = [...new Set(rows.map((row) => row.ticketId))];
    const orderItemIds = [...new Set(rows.map((row) => row.orderItemId))];
    const active = await tx
      .select({
        ticketId: posKdsBatchAssignments.ticketId,
        orderItemId: posKdsBatchAssignments.orderItemId,
      })
      .from(posKdsBatchAssignments)
      .where(
        and(
          eq(posKdsBatchAssignments.organizationId, organizationId),
          eq(posKdsBatchAssignments.unitId, unitId),
          inArray(posKdsBatchAssignments.ticketId, ticketIds),
          inArray(posKdsBatchAssignments.orderItemId, orderItemIds),
          isNull(posKdsBatchAssignments.releasedAt),
        ),
      );
    return new Set(active.map((row) => `${row.ticketId}:${row.orderItemId}`));
  }

  async listKds(identityId: string, organizationId: string, unitId: string, stationId?: string) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.snapshotKds(organizationId, unitId, stationId);
  }

  private async readKdsProductAvailability(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    capturedAt: Date,
  ) {
    const [unit] = await tx
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: unit.timezone }).format(
      capturedAt,
    );
    const rows = await tx
      .select({
        productId: posProducts.id,
        productName: posProducts.name,
        available: posProductAvailability.available,
        dailyStock: posProductAvailability.dailyStock,
        soldToday: posProductAvailability.soldToday,
        stockDate: posProductAvailability.stockDate,
        autoDeductStock: posProductAvailability.autoDeductStock,
        reason: posProductAvailability.operationalReason,
        updatedByIdentityId: posProductAvailability.operationalUpdatedByIdentityId,
        updatedAt: posProductAvailability.updatedAt,
        resetAt: posProductAvailability.operationalResetAt,
      })
      .from(posProductAvailability)
      .innerJoin(
        posProducts,
        and(
          eq(posProducts.organizationId, posProductAvailability.organizationId),
          eq(posProducts.id, posProductAvailability.productId),
        ),
      )
      .where(
        and(
          eq(posProductAvailability.organizationId, organizationId),
          eq(posProductAvailability.unitId, unitId),
          eq(posProducts.active, true),
        ),
      )
      .orderBy(asc(posProducts.name), asc(posProducts.id));
    return rows.map((row) => {
      const projection = projectKdsAvailability(
        {
          available: row.available,
          dailyStock: row.dailyStock,
          soldToday: row.soldToday,
          stockDate: row.stockDate,
          resetAt: row.resetAt,
          reason: row.reason,
        },
        localDate,
        capturedAt,
      );
      return {
        productId: row.productId,
        productName: row.productName,
        status: projection.status,
        available: projection.available,
        dailyStock: row.dailyStock,
        soldToday: projection.soldToday,
        remainingQuantity: projection.remainingQuantity,
        autoDeductStock: row.autoDeductStock,
        reason: projection.reason,
        updatedByIdentityId: row.updatedByIdentityId,
        updatedAt: row.updatedAt,
        resetAt: projection.resetAt,
      };
    });
  }

  async listKdsProductAvailability(identityId: string, organizationId: string, unitId: string) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.database.db.transaction(
      async (tx) => {
        const capturedAt = new Date();
        return {
          capturedAt,
          products: await this.readKdsProductAvailability(tx, organizationId, unitId, capturedAt),
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async kdsAnalytics(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: KdsAnalyticsQueryInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    const capturedAt = new Date();
    const from = new Date(capturedAt.getTime() - query.windowHours * 60 * 60_000);
    const historyFilters = [
      eq(posKdsTicketItems.organizationId, organizationId),
      eq(posKdsTicketItems.unitId, unitId),
      isNotNull(posKdsTicketItems.startedAt),
      isNotNull(posKdsTicketItems.readyAt),
      gt(posKdsTicketItems.readyAt, from),
    ];
    if (query.stationId) historyFilters.push(eq(posKdsTickets.stationId, query.stationId));
    const history = await this.database.db
      .select({
        productId: posOrderItems.productId,
        productName: posOrderItems.productName,
        startedAt: posKdsTicketItems.startedAt,
        readyAt: posKdsTicketItems.readyAt,
      })
      .from(posKdsTicketItems)
      .innerJoin(
        posKdsTickets,
        and(
          eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
          eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
          eq(posKdsTickets.id, posKdsTicketItems.ticketId),
        ),
      )
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .where(and(...historyFilters))
      .orderBy(desc(posKdsTicketItems.readyAt))
      .limit(2_000);
    const durations = history.flatMap(({ startedAt, readyAt }) =>
      startedAt && readyAt ? [Math.max(0, (readyAt.getTime() - startedAt.getTime()) / 60_000)] : [],
    );
    const prep = summarizeKdsDurations(durations);
    const byProduct = new Map<string, { productName: string; durations: number[] }>();
    for (const row of history) {
      if (!row.startedAt || !row.readyAt) continue;
      const entry = byProduct.get(row.productId) ?? {
        productName: row.productName,
        durations: [],
      };
      entry.durations.push(Math.max(0, (row.readyAt.getTime() - row.startedAt.getTime()) / 60_000));
      byProduct.set(row.productId, entry);
    }
    const slowProducts = [...byProduct.entries()]
      .flatMap(([productId, entry]) => {
        const summary = summarizeKdsDurations(entry.durations);
        return summary.sampleSize >= 5
          ? [
              {
                productId,
                productName: entry.productName,
                sampleSize: summary.sampleSize,
                p50Minutes: summary.median,
                p90Minutes: summary.p90,
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          right.p90Minutes - left.p90Minutes ||
          right.p50Minutes - left.p50Minutes ||
          left.productName.localeCompare(right.productName),
      )
      .slice(0, 20);
    const auditedActions = [
      "pos.kds.item_blocked",
      "pos.kds.refired",
      "pos.kds.canceled",
      "pos.kds.item_canceled",
      "pos.kds.product_availability_changed",
    ];
    const auditFilters = [
      eq(auditEvents.organizationId, organizationId),
      eq(auditEvents.unitId, unitId),
      gt(auditEvents.occurredAt, from),
      inArray(auditEvents.action, auditedActions),
    ];
    if (query.stationId) {
      const stationAuditFilter = or(
        eq(auditEvents.action, "pos.kds.product_availability_changed"),
        eq(posKdsTickets.stationId, query.stationId),
      );
      if (stationAuditFilter) auditFilters.push(stationAuditFilter);
    }
    const audited = await this.database.db
      .select({ action: auditEvents.action, metadata: auditEvents.metadata })
      .from(auditEvents)
      .leftJoin(
        posKdsTickets,
        and(
          eq(posKdsTickets.organizationId, auditEvents.organizationId),
          eq(posKdsTickets.unitId, auditEvents.unitId),
          sql`${posKdsTickets.id}::text = ${auditEvents.entityId}`,
          eq(auditEvents.entityType, "kds_ticket"),
        ),
      )
      .where(and(...auditFilters))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(5_000);
    return {
      capturedAt,
      window: { from, to: capturedAt, hours: query.windowHours },
      sampleSize: prep.sampleSize,
      prep: {
        p50Minutes: prep.sampleSize >= 5 ? prep.median : null,
        p90Minutes: prep.sampleSize >= 5 ? prep.p90 : null,
      },
      counts: {
        blocked: audited.filter((row) => row.action === "pos.kds.item_blocked").length,
        refired: audited.filter((row) => row.action === "pos.kds.refired").length,
        canceled: audited.filter(
          (row) => row.action === "pos.kds.canceled" || row.action === "pos.kds.item_canceled",
        ).length,
        availability86: audited.filter((row) => {
          if (row.action !== "pos.kds.product_availability_changed") return false;
          const metadata = row.metadata as Record<string, unknown> | null;
          return metadata?.available === false;
        }).length,
      },
      slowProducts,
    };
  }

  async snapshotKds(
    organizationId: string,
    unitId: string,
    stationId?: string,
    executor?: Transaction,
  ): Promise<JsonResponse> {
    if (!executor) {
      return this.database.db.transaction(
        (tx) => this.snapshotKds(organizationId, unitId, stationId, tx),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    }
    const capturedAt = new Date();
    const canceledSince = new Date(capturedAt.getTime() - 12 * 60 * 60_000);
    const activeCondition = or(
      inArray(posKdsTickets.status, ["pending", "preparing", "ready"]),
      and(eq(posKdsTickets.status, "done"), isNull(posKdsTickets.servedAt)),
    );
    const canceledWhere = [
      eq(posKdsTickets.organizationId, organizationId),
      eq(posKdsTickets.unitId, unitId),
      eq(posKdsTickets.status, "canceled"),
      gt(posKdsTickets.completedAt, canceledSince),
    ];
    if (stationId) canceledWhere.push(eq(posKdsTickets.stationId, stationId));
    const recentCanceled = await executor
      .select({ id: posKdsTickets.id })
      .from(posKdsTickets)
      .where(and(...canceledWhere))
      .orderBy(desc(posKdsTickets.completedAt), desc(posKdsTickets.id))
      .limit(200);
    const recentCanceledIds = recentCanceled.map((ticket) => ticket.id);
    const ticketWhere = [
      eq(posKdsTickets.organizationId, organizationId),
      eq(posKdsTickets.unitId, unitId),
      recentCanceledIds.length > 0
        ? or(activeCondition, inArray(posKdsTickets.id, recentCanceledIds))
        : activeCondition,
    ];
    if (stationId) ticketWhere.push(eq(posKdsTickets.stationId, stationId));
    const [baseStations, activeShift, productAvailability] = await Promise.all([
      executor
        .select({
          id: posProductionStations.id,
          name: posProductionStations.name,
          code: posProductionStations.code,
        })
        .from(posProductionStations)
        .where(
          and(
            eq(posProductionStations.organizationId, organizationId),
            eq(posProductionStations.unitId, unitId),
            eq(posProductionStations.active, true),
            inArray(posProductionStations.deliveryMode, ["kds_only", "both"]),
          ),
        )
        .orderBy(asc(posProductionStations.name), asc(posProductionStations.id)),
      executor
        .select({
          serviceMode: posOperationalShifts.serviceMode,
          startsAt: posOperationalShifts.startsAt,
        })
        .from(posOperationalShifts)
        .where(
          and(
            eq(posOperationalShifts.organizationId, organizationId),
            eq(posOperationalShifts.unitId, unitId),
            eq(posOperationalShifts.status, "active"),
          ),
        )
        .limit(1),
      this.readKdsProductAvailability(executor, organizationId, unitId, capturedAt),
    ]);
    const operationServiceMode = activeShift[0]?.serviceMode ?? null;
    const capabilities = {
      ticketTransition: true,
      itemTransition: true,
      partialReady: true,
      authorizedCancellation: true,
      courseHold: true,
      priority: true,
      orderPriority: true,
      orderPriorityOffline: false,
      recall: true,
      refire: true,
      orderHandoff: true,
      availability: true,
      block: true,
      attentionAcknowledgement: true,
      reroute: true,
      batches: true,
      history: true,
      capacity: true,
      recommendation: true,
      automaticThrottling: false,
      terminalProfileRead: true,
      terminalProfileManage: true,
      sequentialStages: true,
      ticketClaim: true,
      orderChanges: true,
      runnerHandoff: true,
      productionGrid: true,
      recipes: true,
      demandControl: true,
    };
    const rows = await executor
      .select({
        ticket: posKdsTickets,
        station: {
          id: posProductionStations.id,
          name: posProductionStations.name,
          code: posProductionStations.code,
        },
        order: {
          id: posOrders.id,
          status: posOrders.status,
          readyNotifiedAt: posOrders.readyNotifiedAt,
          priority: posOrders.kdsPriority,
          priorityReason: posOrders.kdsPriorityReason,
          priorityUpdatedAt: posOrders.kdsPriorityUpdatedAt,
          priorityUpdatedByIdentityId: posOrders.kdsPriorityUpdatedByIdentityId,
          runnerIdentityId: posOrders.runnerIdentityId,
          runnerClaimedAt: posOrders.runnerClaimedAt,
          runnerPickedUpAt: posOrders.runnerPickedUpAt,
        },
        tab: {
          id: posTabs.id,
          label: posTabs.label,
          fulfillmentType: posTabs.fulfillmentType,
          customerName: posTabs.customerName,
          promisedAt: posTabs.promisedAt,
          readyNotifiedAt: posTabs.readyNotifiedAt,
        },
        table: { id: posDiningTables.id, label: posDiningTables.label },
      })
      .from(posKdsTickets)
      .innerJoin(
        posProductionStations,
        and(
          eq(posProductionStations.organizationId, posKdsTickets.organizationId),
          eq(posProductionStations.unitId, posKdsTickets.unitId),
          eq(posProductionStations.id, posKdsTickets.stationId),
        ),
      )
      .innerJoin(
        posOrders,
        and(
          eq(posOrders.organizationId, posKdsTickets.organizationId),
          eq(posOrders.unitId, posKdsTickets.unitId),
          eq(posOrders.id, posKdsTickets.orderId),
        ),
      )
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posOrders.organizationId),
          eq(posTabs.unitId, posOrders.unitId),
          eq(posTabs.id, posOrders.tabId),
        ),
      )
      .leftJoin(
        posDiningTables,
        and(
          eq(posDiningTables.organizationId, posTabs.organizationId),
          eq(posDiningTables.unitId, posTabs.unitId),
          eq(posDiningTables.id, posTabs.tableId),
        ),
      )
      .where(and(...ticketWhere, inArray(posProductionStations.deliveryMode, ["kds_only", "both"])))
      .orderBy(
        desc(posKdsTickets.priority),
        sql`${posKdsTickets.dueAt} asc nulls last`,
        asc(posKdsTickets.createdAt),
        asc(posKdsTickets.id),
      );
    const baseReadTickets = rows.map(({ ticket, station, order, tab, table }) => {
      const elapsedMinutes = Math.max(
        0,
        Math.floor((capturedAt.getTime() - ticket.createdAt.getTime()) / 60_000),
      );
      const targetMinutes = ticket.dueAt
        ? Math.max(0, Math.round((ticket.dueAt.getTime() - ticket.createdAt.getTime()) / 60_000))
        : null;
      const overdueMinutes = ticket.dueAt
        ? Math.max(0, Math.floor((capturedAt.getTime() - ticket.dueAt.getTime()) / 60_000))
        : 0;
      return {
        ...ticket,
        claimedByInstallationId:
          ticket.claimExpiresAt && ticket.claimExpiresAt > capturedAt
            ? ticket.claimedByInstallationId
            : null,
        claimedAt:
          ticket.claimExpiresAt && ticket.claimExpiresAt > capturedAt ? ticket.claimedAt : null,
        claimExpiresAt:
          ticket.claimExpiresAt && ticket.claimExpiresAt > capturedAt
            ? ticket.claimExpiresAt
            : null,
        rush: ticket.priority >= 50,
        station,
        order,
        tab,
        table: table?.id && table.label ? table : null,
        sla: { elapsedMinutes, targetMinutes, overdueMinutes, isOverdue: overdueMinutes > 0 },
      };
    });
    const ticketIds = baseReadTickets.map((ticket) => ticket.id);
    const assignmentRows =
      ticketIds.length === 0
        ? []
        : await executor
            .select({ assignment: posKdsTicketItems, item: posOrderItems })
            .from(posKdsTicketItems)
            .innerJoin(
              posOrderItems,
              and(
                eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
                eq(posOrderItems.unitId, posKdsTicketItems.unitId),
                eq(posOrderItems.id, posKdsTicketItems.orderItemId),
              ),
            )
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                inArray(posKdsTicketItems.ticketId, ticketIds),
              ),
            )
            .orderBy(
              asc(posOrderItems.course),
              asc(posOrderItems.createdAt),
              asc(posOrderItems.id),
            );
    const orderItemIds = assignmentRows.map(({ item }) => item.id);
    const modifierRows =
      orderItemIds.length === 0
        ? []
        : await executor
            .select()
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                inArray(posOrderItemModifiers.orderItemId, orderItemIds),
              ),
            )
            .orderBy(asc(posOrderItemModifiers.name));
    const productIds = [...new Set(assignmentRows.map(({ item }) => item.productId))];
    const recipeRows =
      productIds.length === 0
        ? []
        : await executor
            .select()
            .from(posRecipeComponents)
            .where(
              and(
                eq(posRecipeComponents.organizationId, organizationId),
                inArray(posRecipeComponents.productId, productIds),
              ),
            )
            .orderBy(asc(posRecipeComponents.ingredientName));
    const changeRows =
      ticketIds.length === 0
        ? []
        : await executor
            .select()
            .from(posKdsItemChanges)
            .where(
              and(
                eq(posKdsItemChanges.organizationId, organizationId),
                eq(posKdsItemChanges.unitId, unitId),
                inArray(posKdsItemChanges.ticketId, ticketIds),
              ),
            )
            .orderBy(desc(posKdsItemChanges.createdAt))
            .limit(1_000);
    const acknowledgementRows =
      ticketIds.length === 0 || orderItemIds.length === 0
        ? []
        : await executor
            .select()
            .from(posKdsAttentionAcknowledgements)
            .where(
              and(
                eq(posKdsAttentionAcknowledgements.organizationId, organizationId),
                eq(posKdsAttentionAcknowledgements.unitId, unitId),
                inArray(posKdsAttentionAcknowledgements.ticketId, ticketIds),
                inArray(posKdsAttentionAcknowledgements.orderItemId, orderItemIds),
              ),
            )
            .orderBy(desc(posKdsAttentionAcknowledgements.acknowledgedAt))
            .limit(2_000);
    const allItems = assignmentRows.map(({ assignment, item }) => ({
      ticketId: assignment.ticketId,
      productId: item.productId,
      item,
      kds: {
        quantity: assignment.quantity,
        readyQuantity: assignment.readyQuantity,
        stage: assignment.stage,
        dependencyHeld: assignment.dependencyHeld,
        status: assignment.status,
        held: assignment.held,
        heldAt: assignment.heldAt,
        firedAt: assignment.firedAt,
        startedAt: assignment.startedAt,
        readyAt: assignment.readyAt,
        completedAt: assignment.completedAt,
        blocked: {
          active: this.isKdsAssignmentBlocked(assignment),
          code: assignment.blockCode,
          reason: assignment.blockReason,
          blockedAt: assignment.blockedAt,
          blockedByIdentityId: assignment.blockedByIdentityId,
          unblockedAt: assignment.unblockedAt,
          unblockedByIdentityId: assignment.unblockedByIdentityId,
          count: assignment.blockCount,
        },
      },
      attention: this.kdsAttentionForItem(item).map((attention) => {
        const acknowledgement = acknowledgementRows.find(
          (row) =>
            row.ticketId === assignment.ticketId &&
            row.orderItemId === item.id &&
            row.noteId === attention.id &&
            row.revision === attention.revision,
        );
        return {
          ...attention,
          acknowledged: Boolean(acknowledgement),
          acknowledgedAt: acknowledgement?.acknowledgedAt ?? null,
          acknowledgedByIdentityId: acknowledgement?.acknowledgedByIdentityId ?? null,
        };
      }),
      modifiers: modifierRows.filter((modifier) => modifier.orderItemId === item.id),
      recipe: recipeRows
        .filter((component) => component.productId === item.productId)
        .map(({ id, ingredientName, quantityMilli, unit, lossBasisPoints }) => ({
          id,
          ingredientName,
          quantityMilli,
          unit,
          lossBasisPoints,
        })),
      changes: changeRows.filter(
        (change) => change.ticketId === assignment.ticketId && change.orderItemId === item.id,
      ),
    }));
    const historySince = new Date(capturedAt.getTime() - 28 * 24 * 60 * 60_000);
    const historicalWhere = [
      eq(posKdsTicketItems.organizationId, organizationId),
      eq(posKdsTicketItems.unitId, unitId),
      isNotNull(posKdsTicketItems.startedAt),
      isNotNull(posKdsTicketItems.readyAt),
      gt(posKdsTicketItems.readyAt, historySince),
    ];
    if (stationId) historicalWhere.push(eq(posKdsTickets.stationId, stationId));
    const historicalRows = await executor
      .select({
        stationId: posKdsTickets.stationId,
        productId: posOrderItems.productId,
        quantity: posKdsTicketItems.quantity,
        startedAt: posKdsTicketItems.startedAt,
        readyAt: posKdsTicketItems.readyAt,
      })
      .from(posKdsTicketItems)
      .innerJoin(
        posKdsTickets,
        and(
          eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
          eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
          eq(posKdsTickets.id, posKdsTicketItems.ticketId),
        ),
      )
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .innerJoin(
        posProductionStations,
        and(
          eq(posProductionStations.organizationId, posKdsTickets.organizationId),
          eq(posProductionStations.unitId, posKdsTickets.unitId),
          eq(posProductionStations.id, posKdsTickets.stationId),
        ),
      )
      .where(
        and(...historicalWhere, inArray(posProductionStations.deliveryMode, ["kds_only", "both"])),
      )
      .orderBy(desc(posKdsTicketItems.readyAt))
      .limit(1_000);
    const historyDuration = (row: (typeof historicalRows)[number]) =>
      row.startedAt && row.readyAt
        ? Math.max(0, (row.readyAt.getTime() - row.startedAt.getTime()) / 60_000)
        : null;
    const stationHistory = new Map<string, number[]>();
    const productHistory = new Map<string, number[]>();
    for (const row of historicalRows) {
      const duration = historyDuration(row);
      if (duration === null) continue;
      stationHistory.set(row.stationId, [...(stationHistory.get(row.stationId) ?? []), duration]);
      const productKey = `${row.stationId}:${row.productId}`;
      productHistory.set(productKey, [...(productHistory.get(productKey) ?? []), duration]);
    }
    const baseTicketById = new Map(baseReadTickets.map((ticket) => [ticket.id, ticket]));
    const capacityByStation = new Map(
      baseStations.map((station) => {
        const activeAssignments = assignmentRows.filter(({ assignment }) => {
          const ticket = baseTicketById.get(assignment.ticketId);
          return (
            ticket?.stationId === station.id && ["queued", "preparing"].includes(assignment.status)
          );
        });
        const durations = stationHistory.get(station.id) ?? [];
        const summary = summarizeKdsDurations(durations);
        const enoughHistory = summary.sampleSize >= 5;
        const historicalForStation = historicalRows.filter((row) => row.stationId === station.id);
        const totalDuration = historicalForStation.reduce(
          (sum, row) => sum + (historyDuration(row) ?? 0),
          0,
        );
        const totalQuantity = historicalForStation.reduce((sum, row) => sum + row.quantity, 0);
        const capacity = {
          activeAssignments: activeAssignments.length,
          blockedAssignments: activeAssignments.filter(({ assignment }) =>
            this.isKdsAssignmentBlocked(assignment),
          ).length,
          queuedQuantity: activeAssignments
            .filter(({ assignment }) => assignment.status === "queued" && !assignment.held)
            .reduce((sum, { assignment }) => sum + assignment.quantity, 0),
          preparingQuantity: activeAssignments
            .filter(({ assignment }) => assignment.status === "preparing")
            .reduce(
              (sum, { assignment }) =>
                sum + Math.max(0, assignment.quantity - assignment.readyQuantity),
              0,
            ),
          sampleSize: summary.sampleSize,
          p50PrepMinutes: enoughHistory ? summary.median : null,
          p90PrepMinutes: enoughHistory ? summary.p90 : null,
          estimatedUnitsPerHour:
            enoughHistory && totalDuration > 0
              ? Math.round(((totalQuantity * 60) / totalDuration) * 10) / 10
              : null,
        };
        return [
          station.id,
          { ...capacity, recommendation: kdsCapacityRecommendation(capacity) },
        ] as const;
      }),
    );
    const emptyCapacity = {
      activeAssignments: 0,
      blockedAssignments: 0,
      queuedQuantity: 0,
      preparingQuantity: 0,
      sampleSize: 0,
      p50PrepMinutes: null,
      p90PrepMinutes: null,
      estimatedUnitsPerHour: null,
      recommendation: kdsCapacityRecommendation({
        activeAssignments: 0,
        blockedAssignments: 0,
        queuedQuantity: 0,
        preparingQuantity: 0,
        sampleSize: 0,
        p50PrepMinutes: null,
        p90PrepMinutes: null,
        estimatedUnitsPerHour: null,
      }),
    };
    const stations = baseStations.map((station) => ({
      ...station,
      capacity: capacityByStation.get(station.id) ?? emptyCapacity,
    }));
    const queuePosition = new Map<string, number>();
    for (const station of baseStations) {
      baseReadTickets
        .filter(
          (ticket) =>
            ticket.stationId === station.id && ["pending", "preparing"].includes(ticket.status),
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        )
        .forEach((ticket, index) => {
          queuePosition.set(ticket.id, index);
        });
    }
    const readTickets = baseReadTickets.map((ticket) => {
      const ticketItems = allItems.filter(
        (entry) =>
          entry.ticketId === ticket.id && !["canceled", "served"].includes(entry.kds.status),
      );
      const blocked = ticketItems.some((entry) => entry.kds.blocked.active);
      const held = ticketItems.some((entry) => entry.kds.held);
      const productDurations = ticketItems.flatMap(
        (entry) => productHistory.get(`${ticket.stationId}:${entry.productId}`) ?? [],
      );
      const productSummary = summarizeKdsDurations(productDurations);
      const stationSummary = summarizeKdsDurations(stationHistory.get(ticket.stationId) ?? []);
      const configuredMinutes = ticketItems.reduce(
        (maximum, entry) => Math.max(maximum, entry.item.estimatedPrepTimeMinutes ?? 0),
        0,
      );
      const source =
        productSummary.sampleSize >= 5
          ? ("product" as const)
          : stationSummary.sampleSize >= 5
            ? ("station" as const)
            : configuredMinutes > 0
              ? ("configured" as const)
              : ("none" as const);
      const selectedSummary =
        source === "product" ? productSummary : source === "station" ? stationSummary : null;
      const estimateMinutes =
        selectedSummary?.median ?? (source === "configured" ? configuredMinutes : null);
      let predictedReadyAt: Date | null = null;
      if (ticket.status === "ready" || ticket.status === "done") {
        predictedReadyAt = ticket.readyAt;
      } else if (!blocked && !held && estimateMinutes !== null) {
        if (ticket.status === "preparing" && ticket.startedAt) {
          predictedReadyAt = new Date(
            Math.max(capturedAt.getTime(), ticket.startedAt.getTime() + estimateMinutes * 60_000),
          );
        } else {
          predictedReadyAt = new Date(
            capturedAt.getTime() +
              estimateMinutes * ((queuePosition.get(ticket.id) ?? 0) + 1) * 60_000,
          );
        }
      }
      return {
        ...ticket,
        blocked,
        predictedReadyAt,
        eta: {
          predictedReadyAt,
          p50Minutes: selectedSummary?.median ?? null,
          p90Minutes: selectedSummary?.p90 ?? null,
          sampleSize: selectedSummary?.sampleSize ?? 0,
          source,
        },
        station: {
          ...ticket.station,
          capacity: capacityByStation.get(ticket.stationId) ?? emptyCapacity,
        },
      };
    });
    const tickets = readTickets.filter((ticket) => ticket.status !== "canceled");
    const items = allItems.filter((entry) => entry.kds.status !== "canceled");
    const allDayByProduct = new Map<
      string,
      {
        stationId: string;
        productId: string;
        productName: string;
        totalQuantity: number;
        queuedQuantity: number;
        preparingQuantity: number;
        readyQuantity: number;
        heldQuantity: number;
      }
    >();
    const stationByTicket = new Map(readTickets.map((ticket) => [ticket.id, ticket.stationId]));
    const activeTicketIds = new Set(tickets.map((ticket) => ticket.id));
    for (const { assignment, item } of assignmentRows) {
      if (assignment.status === "canceled" || !activeTicketIds.has(assignment.ticketId)) continue;
      const assignmentStationId = stationByTicket.get(assignment.ticketId);
      if (!assignmentStationId) continue;
      const allDayKey = `${assignmentStationId}:${item.productId}`;
      const entry = allDayByProduct.get(allDayKey) ?? {
        stationId: assignmentStationId,
        productId: item.productId,
        productName: item.productName,
        totalQuantity: 0,
        queuedQuantity: 0,
        preparingQuantity: 0,
        readyQuantity: 0,
        heldQuantity: 0,
      };
      entry.totalQuantity += assignment.quantity;
      if (assignment.held) {
        entry.heldQuantity += assignment.quantity;
      } else if (assignment.status === "queued") {
        entry.queuedQuantity += assignment.quantity;
      } else if (assignment.status === "preparing") {
        entry.readyQuantity += assignment.readyQuantity;
        entry.preparingQuantity += assignment.quantity - assignment.readyQuantity;
      } else if (assignment.status === "ready" || assignment.status === "served") {
        entry.readyQuantity += assignment.quantity;
      }
      allDayByProduct.set(allDayKey, entry);
    }
    const rollingMetricsFrom = new Date(capturedAt.getTime() - 12 * 60 * 60_000);
    const shiftStartsAt = activeShift[0]?.startsAt ?? null;
    const metricsWindowSource =
      shiftStartsAt && shiftStartsAt >= rollingMetricsFrom
        ? ("active_shift" as const)
        : ("rolling_12h" as const);
    const metricsFrom =
      metricsWindowSource === "active_shift" && shiftStartsAt ? shiftStartsAt : rollingMetricsFrom;
    const recentWhere = [
      eq(posKdsTickets.organizationId, organizationId),
      eq(posKdsTickets.unitId, unitId),
      isNotNull(posKdsTickets.startedAt),
      isNotNull(posKdsTickets.readyAt),
      gt(posKdsTickets.readyAt, metricsFrom),
    ];
    if (stationId) recentWhere.push(eq(posKdsTickets.stationId, stationId));
    const recentReady = await executor
      .select({ startedAt: posKdsTickets.startedAt, readyAt: posKdsTickets.readyAt })
      .from(posKdsTickets)
      .where(and(...recentWhere))
      .orderBy(desc(posKdsTickets.readyAt))
      .limit(100);
    const prepMetrics = summarizeKdsDurations(
      recentReady.flatMap(({ startedAt, readyAt }) =>
        startedAt && readyAt ? [(readyAt.getTime() - startedAt.getTime()) / 60_000] : [],
      ),
    );
    const waiting = tickets.map((ticket) =>
      Math.max(
        0,
        ((ticket.startedAt ?? capturedAt).getTime() - ticket.createdAt.getTime()) / 60_000,
      ),
    );
    const alerts = readTickets
      .flatMap((ticket) => {
        const canceledItems = allItems.filter(
          (entry) =>
            entry.ticketId === ticket.id &&
            entry.kds.status === "canceled" &&
            entry.item.canceledAt !== null &&
            entry.item.canceledAt >= canceledSince,
        );
        return !shouldAlertKdsCancellation(canceledItems.map((entry) => entry.kds.status))
          ? []
          : [
              {
                ticket,
                reason: canceledItems[0]?.item.canceledReason ?? "Cancelamento autorizado",
                items: canceledItems,
              },
            ];
      })
      .sort(
        (left, right) =>
          (right.ticket.completedAt?.getTime() ?? 0) - (left.ticket.completedAt?.getTime() ?? 0),
      );
    const allDay = [...allDayByProduct.values()].sort(
      (left, right) =>
        left.stationId.localeCompare(right.stationId) ||
        right.totalQuantity - left.totalQuantity ||
        left.productName.localeCompare(right.productName),
    );
    const activeBatchWhere = [
      eq(posKdsBatches.organizationId, organizationId),
      eq(posKdsBatches.unitId, unitId),
      eq(posKdsBatches.status, "active"),
    ];
    if (stationId) activeBatchWhere.push(eq(posKdsBatches.stationId, stationId));
    const activeBatchRows = await executor
      .select()
      .from(posKdsBatches)
      .where(and(...activeBatchWhere))
      .orderBy(asc(posKdsBatches.createdAt), asc(posKdsBatches.id))
      .limit(100);
    const activeBatchIds = activeBatchRows.map((batch) => batch.id);
    const activeBatchAssignments =
      activeBatchIds.length === 0
        ? []
        : await executor
            .select({
              batchId: posKdsBatchAssignments.batchId,
              ticketId: posKdsBatchAssignments.ticketId,
              orderItemId: posKdsBatchAssignments.orderItemId,
              quantity: posKdsBatchAssignments.quantity,
              position: posKdsBatchAssignments.position,
            })
            .from(posKdsBatchAssignments)
            .where(
              and(
                eq(posKdsBatchAssignments.organizationId, organizationId),
                eq(posKdsBatchAssignments.unitId, unitId),
                inArray(posKdsBatchAssignments.batchId, activeBatchIds),
                isNull(posKdsBatchAssignments.releasedAt),
              ),
            )
            .orderBy(asc(posKdsBatchAssignments.batchId), asc(posKdsBatchAssignments.position));
    const batches = activeBatchRows.map((batch) => {
      const assignments = activeBatchAssignments
        .filter((assignment) => assignment.batchId === batch.id)
        .map(({ batchId: _batchId, ...assignment }) => assignment);
      return {
        batchId: batch.id,
        stationId: batch.stationId,
        productId: batch.productId,
        state: batch.status,
        assignmentCount: assignments.length,
        totalQuantity: assignments.reduce((sum, assignment) => sum + assignment.quantity, 0),
        assignments,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
        canceledAt: batch.canceledAt,
      };
    });
    const metrics = {
      window: { from: metricsFrom, to: capturedAt, source: metricsWindowSource },
      total: tickets.length,
      pending: tickets.filter((ticket) => ticket.status === "pending").length,
      preparing: tickets.filter((ticket) => ticket.status === "preparing").length,
      ready: tickets.filter((ticket) => ticket.status === "ready").length,
      expedition: tickets.filter(
        (ticket) => ticket.status === "done" && ticket.handedOffAt && !ticket.servedAt,
      ).length,
      overdue: tickets.filter((ticket) => ticket.sla.isOverdue).length,
      rush: tickets.filter((ticket) => ticket.rush).length,
      blockedItems: items.filter((entry) => entry.kds.blocked.active).length,
      averageWaitMinutes:
        waiting.length === 0
          ? 0
          : Math.round((waiting.reduce((sum, value) => sum + value, 0) / waiting.length) * 10) / 10,
      averagePrepMinutes: prepMetrics.average,
      medianPrepMinutes: prepMetrics.median,
      p90PrepMinutes: prepMetrics.p90,
      sampleSize: prepMetrics.sampleSize,
    };
    const productionGrid = allDay.map((summary) => ({
      ...summary,
      assignments: items
        .filter(
          (entry) =>
            entry.productId === summary.productId &&
            stationByTicket.get(entry.ticketId) === summary.stationId,
        )
        .map((entry) => ({
          ticketId: entry.ticketId,
          orderItemId: entry.item.id,
          reference:
            readTickets.find((ticket) => ticket.id === entry.ticketId)?.tab.label ?? entry.ticketId,
          quantity: entry.kds.quantity,
          readyQuantity: entry.kds.readyQuantity,
          status: entry.kds.status,
          stage: entry.kds.stage,
        })),
    }));
    const recommendationRank = { normal: 0, strained: 1, overloaded: 2 } as const;
    const demandState = stations.reduce<"normal" | "strained" | "overloaded">(
      (current, station) =>
        recommendationRank[station.capacity.recommendation.state] > recommendationRank[current]
          ? station.capacity.recommendation.state
          : current,
      "normal",
    );
    const suggestedDelayMinutes = Math.max(
      0,
      ...stations.map((station) => station.capacity.recommendation.suggestedDelayMinutes ?? 0),
    );
    const demand = {
      state: demandState,
      suggestedDelayMinutes,
      automatic: false,
      channels: (["dine_in", "pickup", "delivery"] as const).map((channel) => ({
        channel,
        activeOrders: tickets.filter((ticket) => ticket.tab.fulfillmentType === channel).length,
        suggestedDelayMinutes,
      })),
    };
    const stableTicketForRevision = (ticket: (typeof tickets)[number]) => {
      const {
        sla: _sla,
        predictedReadyAt: _predictedReadyAt,
        eta: { predictedReadyAt: _etaPredictedReadyAt, ...eta },
        ...stableTicket
      } = ticket;
      return { ...stableTicket, eta };
    };
    const revision = createHash("sha256")
      .update(
        JSON.stringify({
          operationServiceMode,
          stations,
          capabilities,
          tickets: tickets.map(stableTicketForRevision),
          items,
          alerts: alerts.map(({ ticket, ...alert }) => ({
            ...alert,
            ticket: stableTicketForRevision(ticket),
          })),
          allDay,
          batches,
          productionGrid,
          demand,
          productAvailability,
          metrics: {
            total: metrics.total,
            pending: metrics.pending,
            preparing: metrics.preparing,
            ready: metrics.ready,
            expedition: metrics.expedition,
            rush: metrics.rush,
            blockedItems: metrics.blockedItems,
            averagePrepMinutes: metrics.averagePrepMinutes,
            medianPrepMinutes: metrics.medianPrepMinutes,
            p90PrepMinutes: metrics.p90PrepMinutes,
            sampleSize: metrics.sampleSize,
          },
        }),
      )
      .digest("hex");
    return {
      capturedAt,
      serverTime: capturedAt,
      revision,
      operationServiceMode,
      serviceMode: operationServiceMode,
      stations,
      capabilities,
      tickets,
      items,
      alerts,
      metrics,
      productAvailability,
      allDay,
      batches,
      productionGrid,
      demand,
    };
  }

  async claimKdsTicket(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsTicketClaimInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.ticket.claim",
      { ticketId, ...input },
      async (tx) => {
        const ticket = await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const [terminal] = await tx
          .select({ installationId: posKdsTerminalProfiles.installationId })
          .from(posKdsTerminalProfiles)
          .where(
            and(
              eq(posKdsTerminalProfiles.organizationId, organizationId),
              eq(posKdsTerminalProfiles.unitId, unitId),
              eq(posKdsTerminalProfiles.installationId, input.installationId),
              eq(posKdsTerminalProfiles.mode, "station"),
              eq(posKdsTerminalProfiles.stationId, ticket.stationId),
            ),
          )
          .limit(1);
        if (!terminal) throw new ForbiddenException({ code: "KDS_TERMINAL_STATION_MISMATCH" });
        const now = new Date();
        if (
          ticket.claimedByInstallationId &&
          ticket.claimedByInstallationId !== input.installationId &&
          ticket.claimExpiresAt &&
          ticket.claimExpiresAt > now
        ) {
          throw new ConflictException({
            code: "KDS_TICKET_CLAIMED",
            claimedByInstallationId: ticket.claimedByInstallationId,
            claimExpiresAt: ticket.claimExpiresAt,
          });
        }
        const claimExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1_000);
        await tx
          .update(posKdsTickets)
          .set({
            claimedByInstallationId: input.installationId,
            claimedAt: now,
            claimExpiresAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          );
        await this.recordKdsAction(tx, identityId, organizationId, unitId, ticketId, "claimed", {
          installationId: input.installationId,
          claimExpiresAt,
        });
        return { ticketId, installationId: input.installationId, claimedAt: now, claimExpiresAt };
      },
    );
  }

  async releaseKdsTicketClaim(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsTicketClaimInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.ticket.claim.release",
      { ticketId, installationId: input.installationId },
      async (tx) => {
        const ticket = await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        if (
          ticket.claimedByInstallationId &&
          ticket.claimedByInstallationId !== input.installationId
        ) {
          throw new ConflictException({ code: "KDS_TICKET_CLAIMED_BY_ANOTHER_TERMINAL" });
        }
        const now = new Date();
        await tx
          .update(posKdsTickets)
          .set({
            claimedByInstallationId: null,
            claimedAt: null,
            claimExpiresAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "claim_released",
          {
            installationId: input.installationId,
          },
        );
        return { ticketId, releasedAt: now };
      },
    );
  }

  async acknowledgeKdsChange(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    changeId: string,
    idempotencyKey: string,
    input: KdsChangeAcknowledgeInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.change.acknowledge",
      { ticketId, changeId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const [change] = await tx
          .select()
          .from(posKdsItemChanges)
          .where(
            and(
              eq(posKdsItemChanges.organizationId, organizationId),
              eq(posKdsItemChanges.unitId, unitId),
              eq(posKdsItemChanges.ticketId, ticketId),
              eq(posKdsItemChanges.id, changeId),
            ),
          )
          .limit(1);
        if (!change) throw new NotFoundException({ code: "KDS_CHANGE_NOT_FOUND" });
        if (change.revision !== input.revision) {
          throw new ConflictException({ code: "KDS_CHANGE_REVISION_CHANGED" });
        }
        const acknowledgedAt = change.acknowledgedAt ?? new Date();
        if (!change.acknowledgedAt) {
          await tx
            .update(posKdsItemChanges)
            .set({ acknowledgedAt, acknowledgedByIdentityId: identityId })
            .where(
              and(
                eq(posKdsItemChanges.organizationId, organizationId),
                eq(posKdsItemChanges.unitId, unitId),
                eq(posKdsItemChanges.id, changeId),
                isNull(posKdsItemChanges.acknowledgedAt),
              ),
            );
        }
        return { ticketId, changeId, revision: input.revision, acknowledgedAt };
      },
    );
  }

  async transitionKds(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsStateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.transition",
      { ticketId, ...input },
      async (tx) => {
        const ticket = await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        assertKdsTransition(ticket.status, input.state);
        const now = new Date();
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const active = assignments.filter(({ assignment }) => assignment.status !== "canceled");
        if (active.length === 0) throw new ConflictException({ code: "KDS_TICKET_EMPTY" });
        const blocked = active.filter(({ assignment }) => this.isKdsAssignmentBlocked(assignment));
        if (blocked.length > 0) {
          throw new ConflictException({
            code: "KDS_ITEM_BLOCKED",
            orderItemIds: blocked.map(({ item }) => item.id),
          });
        }
        if (input.state === "preparing") {
          const eligible = active.filter(
            ({ assignment }) => assignment.status === "queued" && !assignment.held,
          );
          if (eligible.length === 0) {
            throw new ConflictException({ code: "KDS_NO_FIRED_ITEMS" });
          }
          const itemIds = eligible.map(({ item }) => item.id);
          await tx
            .update(posKdsTicketItems)
            .set({ status: "preparing", startedAt: now })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.ticketId, ticketId),
                inArray(posKdsTicketItems.orderItemId, itemIds),
              ),
            );
          for (const itemId of [...new Set(itemIds)].sort()) {
            await this.syncOrderItemStatusFromKds(tx, organizationId, unitId, itemId, now);
          }
        } else {
          if (
            active.some(
              ({ assignment }) =>
                assignment.held || !["preparing", "ready"].includes(assignment.status),
            )
          ) {
            throw new ConflictException({ code: "KDS_ITEMS_NOT_READY" });
          }
          await this.assertKdsAttentionAcknowledged(tx, organizationId, unitId, active);
          const itemIds = active.map(({ item }) => item.id);
          await tx
            .update(posKdsTicketItems)
            .set({
              status: "ready",
              readyQuantity: sql`${posKdsTicketItems.quantity}`,
              readyAt: now,
            })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.ticketId, ticketId),
                inArray(posKdsTicketItems.orderItemId, itemIds),
              ),
            );
          for (const itemId of [...new Set(itemIds)].sort()) {
            await this.releaseNextKdsStage(tx, organizationId, unitId, itemId, now);
            await this.syncOrderItemStatusFromKds(tx, organizationId, unitId, itemId, now);
          }
        }
        await tx
          .update(posKdsTickets)
          .set({
            status: input.state,
            startedAt: input.state === "preparing" ? (ticket.startedAt ?? now) : ticket.startedAt,
            readyAt: input.state === "ready" ? now : ticket.readyAt,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
              eq(posKdsTickets.status, ticket.status),
            ),
          );
        const orderStatuses = await this.syncOrdersForTicket(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          now,
        );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "transitioned",
          {
            from: ticket.status,
            to: input.state,
            orderId: ticket.orderId,
          },
        );
        return { ticketId, state: input.state, orderId: ticket.orderId, orderStatuses };
      },
    );
  }

  private async lockKdsOrder(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pos-kds-order:${organizationId}:${unitId}:${orderId}`}))`,
    );
  }

  private async lockKdsStations(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    stationIds: string[],
  ) {
    const unique = [...new Set(stationIds)].sort();
    for (const stationId of unique) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-station-config:${organizationId}:${unitId}:${stationId}`}))`,
      );
    }
  }

  private async lockAndAssertKdsStations(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    stationIds: string[],
  ) {
    const unique = [...new Set(stationIds)].sort();
    await this.lockKdsStations(tx, organizationId, unitId, unique);
    if (unique.length === 0) return;
    const active = await tx
      .select({ id: posProductionStations.id })
      .from(posProductionStations)
      .where(
        and(
          eq(posProductionStations.organizationId, organizationId),
          eq(posProductionStations.unitId, unitId),
          inArray(posProductionStations.id, unique),
          eq(posProductionStations.active, true),
        ),
      );
    if (active.length !== unique.length) {
      throw new ConflictException({ code: "STATION_NOT_ACTIVE" });
    }
  }

  private async lockKdsScope(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    seedOrderIds: string[],
    ticketIds: string[],
  ) {
    const uniqueTicketIds = [...new Set(ticketIds)].sort();
    const linkedOrders =
      uniqueTicketIds.length === 0
        ? []
        : await tx
            .select({ orderId: posOrderItems.orderId })
            .from(posKdsTicketItems)
            .innerJoin(
              posOrderItems,
              and(
                eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
                eq(posOrderItems.unitId, posKdsTicketItems.unitId),
                eq(posOrderItems.id, posKdsTicketItems.orderItemId),
              ),
            )
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                inArray(posKdsTicketItems.ticketId, uniqueTicketIds),
              ),
            );
    const orderIds = [
      ...new Set([...seedOrderIds, ...linkedOrders.map((row) => row.orderId)]),
    ].sort();
    for (const orderId of orderIds) {
      await this.lockKdsOrder(tx, organizationId, unitId, orderId);
    }
    for (const ticketId of uniqueTicketIds) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-kds-ticket:${organizationId}:${unitId}:${ticketId}`}))`,
      );
    }
    if (uniqueTicketIds.length > 0) {
      const lockedOrderIds = new Set(orderIds);
      const currentLinks = await tx
        .select({ orderId: posOrderItems.orderId })
        .from(posKdsTicketItems)
        .innerJoin(
          posOrderItems,
          and(
            eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
            eq(posOrderItems.unitId, posKdsTicketItems.unitId),
            eq(posOrderItems.id, posKdsTicketItems.orderItemId),
          ),
        )
        .where(
          and(
            eq(posKdsTicketItems.organizationId, organizationId),
            eq(posKdsTicketItems.unitId, unitId),
            inArray(posKdsTicketItems.ticketId, uniqueTicketIds),
          ),
        );
      if (currentLinks.some(({ orderId }) => !lockedOrderIds.has(orderId))) {
        throw new ConflictException({ code: "KDS_LOCK_SCOPE_CHANGED_RETRY" });
      }
    }
  }

  private async requireLockedKdsTicket(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    ticketId: string,
  ) {
    const [initial] = await tx
      .select()
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    if (!initial) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    await this.lockKdsScope(tx, organizationId, unitId, [initial.orderId], [ticketId]);
    const [ticket] = await tx
      .select()
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    if (!ticket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    return ticket;
  }

  private async requireLockedKdsOrderTicketsForTicket(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    ticketId: string,
  ) {
    const [initial] = await tx
      .select({ orderId: posKdsTickets.orderId })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    if (!initial) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    const initialTickets = await tx
      .select({ id: posKdsTickets.id })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.orderId, initial.orderId),
          ne(posKdsTickets.status, "canceled"),
        ),
      );
    const ticketIds = initialTickets.map(({ id }) => id).sort();
    await this.lockKdsScope(tx, organizationId, unitId, [initial.orderId], ticketIds);
    const currentTickets = await tx
      .select()
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.orderId, initial.orderId),
          ne(posKdsTickets.status, "canceled"),
        ),
      );
    const currentTicketIds = currentTickets.map(({ id }) => id).sort();
    if (
      currentTicketIds.length !== ticketIds.length ||
      currentTicketIds.some((id, index) => id !== ticketIds[index])
    ) {
      throw new ConflictException({ code: "KDS_ORDER_CHANGED_RETRY" });
    }
    const ticket = currentTickets.find(({ id }) => id === ticketId);
    if (!ticket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    return { ticket, ticketIds, orderId: initial.orderId };
  }

  private async getKdsAssignments(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    ticketId: string,
  ) {
    return tx
      .select({ assignment: posKdsTicketItems, item: posOrderItems })
      .from(posKdsTicketItems)
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.ticketId, ticketId),
        ),
      );
  }

  private async refreshKdsTicketState(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    ticketId: string,
    now: Date,
  ) {
    const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
    const active = assignments.filter(({ assignment }) => assignment.status !== "canceled");
    const persistedNow = now.toISOString();
    const state =
      active.length === 0
        ? ("canceled" as const)
        : active.every(({ assignment }) => assignment.status === "served")
          ? ("done" as const)
          : active.every(
                ({ assignment }) =>
                  ["ready", "served"].includes(assignment.status) &&
                  assignment.readyQuantity === assignment.quantity,
              )
            ? ("ready" as const)
            : active.some(
                  ({ assignment }) =>
                    assignment.status !== "queued" || assignment.readyQuantity > 0,
                )
              ? ("preparing" as const)
              : ("pending" as const);
    await tx
      .update(posKdsTickets)
      .set({
        status: state,
        startedAt:
          state === "preparing"
            ? sql`coalesce(${posKdsTickets.startedAt}, ${persistedNow}::timestamptz)`
            : undefined,
        readyAt:
          state === "ready"
            ? sql`coalesce(${posKdsTickets.readyAt}, ${persistedNow}::timestamptz)`
            : undefined,
        completedAt:
          state === "done" || state === "canceled"
            ? sql`coalesce(${posKdsTickets.completedAt}, ${persistedNow}::timestamptz)`
            : undefined,
        updatedAt: now,
      })
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      );
    return state;
  }

  private async syncOrderItemStatusFromKds(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderItemId: string,
    now: Date,
  ) {
    const assignments = await tx
      .select({
        status: posKdsTicketItems.status,
        quantity: posKdsTicketItems.quantity,
        readyQuantity: posKdsTicketItems.readyQuantity,
      })
      .from(posKdsTicketItems)
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.orderItemId, orderItemId),
        ),
      );
    const active = assignments.filter((assignment) => assignment.status !== "canceled");
    const status: (typeof posOrderItems.$inferSelect)["status"] =
      active.length === 0
        ? "canceled"
        : active.every((assignment) => assignment.status === "served")
          ? "served"
          : active.every(
                (assignment) =>
                  ["ready", "served"].includes(assignment.status) &&
                  assignment.readyQuantity === assignment.quantity,
              )
            ? "ready"
            : active.some(
                  (assignment) =>
                    ["preparing", "ready", "served"].includes(assignment.status) ||
                    assignment.readyQuantity > 0,
                )
              ? "preparing"
              : "queued";
    if (status !== "canceled") {
      await tx
        .update(posOrderItems)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posOrderItems.id, orderItemId),
            ne(posOrderItems.status, "canceled"),
          ),
        );
    }
    return status;
  }

  private async releaseNextKdsStage(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderItemId: string,
    now: Date,
  ) {
    const assignments = await tx
      .select()
      .from(posKdsTicketItems)
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.orderItemId, orderItemId),
          ne(posKdsTicketItems.status, "canceled"),
        ),
      );
    const waitingStages = [
      ...new Set(
        assignments
          .filter((assignment) => assignment.dependencyHeld)
          .map((assignment) => assignment.stage),
      ),
    ].sort((left, right) => left - right);
    const nextStage = waitingStages[0];
    if (!nextStage) return false;
    if (
      assignments.some(
        (assignment) =>
          assignment.stage < nextStage &&
          (assignment.status !== "ready" || assignment.readyQuantity !== assignment.quantity),
      )
    ) {
      return false;
    }
    await tx
      .update(posKdsTicketItems)
      .set({
        dependencyHeld: false,
        held: sql`${posKdsTicketItems.courseHeld}`,
        heldAt: sql`case when ${posKdsTicketItems.courseHeld} then ${posKdsTicketItems.heldAt} else null end`,
        firedAt: sql`case when ${posKdsTicketItems.courseHeld} then null else ${now.toISOString()}::timestamptz end`,
      })
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.orderItemId, orderItemId),
          eq(posKdsTicketItems.stage, nextStage),
          eq(posKdsTicketItems.dependencyHeld, true),
        ),
      );
    return true;
  }

  private orderStatusFromItems(states: Array<typeof posOrderItems.$inferSelect.status>) {
    if (states.length === 0) return "sent" as const;
    if (states.every((state) => state === "canceled")) return "canceled" as const;
    if (states.every((state) => state === "served" || state === "canceled"))
      return "served" as const;
    if (states.every((state) => ["ready", "served", "canceled"].includes(state))) {
      return "ready" as const;
    }
    if (states.some((state) => ["preparing", "ready", "served"].includes(state))) {
      return "preparing" as const;
    }
    return "sent" as const;
  }

  private async syncOrdersForTicket(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    now: Date,
  ) {
    const rows = await tx
      .select({ orderId: posOrderItems.orderId })
      .from(posKdsTicketItems)
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.ticketId, ticketId),
        ),
      );
    const orderIds = [...new Set(rows.map((row) => row.orderId))].sort();
    const result = [];
    for (const orderId of orderIds) {
      await this.lockKdsOrder(tx, organizationId, unitId, orderId);
      const status = await this.syncOrderStatus(
        tx,
        actorIdentityId,
        organizationId,
        unitId,
        orderId,
        now,
      );
      result.push({ orderId, status });
    }
    return result;
  }

  private async syncOrderStatus(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    now: Date,
  ) {
    const items = await tx
      .select({ status: posOrderItems.status })
      .from(posOrderItems)
      .where(
        and(
          eq(posOrderItems.organizationId, organizationId),
          eq(posOrderItems.unitId, unitId),
          eq(posOrderItems.orderId, orderId),
        ),
      );
    const status = this.orderStatusFromItems(items.map((item) => item.status));
    await tx
      .update(posOrders)
      .set({ status, updatedAt: now })
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      );
    if (status === "ready") {
      await this.notifyOrderReadyOnce(tx, actorIdentityId, organizationId, unitId, orderId, now);
    }
    return status;
  }

  private async notifyOrderReadyOnce(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    now: Date,
  ) {
    const [context] = await tx
      .select({
        tabId: posOrders.tabId,
        customerPhone: posTabs.customerPhone,
        readyNotificationConsent: posTabs.readyNotificationConsent,
        readyNotifiedAt: posOrders.readyNotifiedAt,
      })
      .from(posOrders)
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posOrders.organizationId),
          eq(posTabs.unitId, posOrders.unitId),
          eq(posTabs.id, posOrders.tabId),
        ),
      )
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!context || context.readyNotifiedAt) return;
    const [notified] = await tx
      .update(posOrders)
      .set({
        readyNotifiedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
          isNull(posOrders.readyNotifiedAt),
        ),
      )
      .returning({ id: posOrders.id });
    if (!notified) return;
    await tx
      .update(posTabs)
      .set({
        readyNotifiedAt: now,
        version: sql`${posTabs.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, context.tabId),
        ),
      );
    await tx.insert(outboxEvents).values({
      topic: "pos.order.ready_notification_requested",
      aggregateType: "order",
      aggregateId: orderId,
      payload: {
        organizationId,
        unitId,
        orderId,
        tabId: context.tabId,
        channels:
          context.customerPhone && context.readyNotificationConsent
            ? ["waiter", "customer"]
            : ["waiter"],
      },
    });
    await this.recordEvent(
      tx,
      actorIdentityId,
      organizationId,
      unitId,
      context.tabId,
      "customer.ready",
      {
        orderId,
        channel: context.customerPhone && context.readyNotificationConsent ? "queued" : "in_person",
      },
    );
  }

  private async recordKdsAction(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `pos.kds.${action}`,
      entityType: "kds_ticket",
      entityId: ticketId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: `pos.kds_${action}`,
      aggregateType: "kds_ticket",
      aggregateId: ticketId,
      payload: { organizationId, unitId, ticketId, ...metadata },
    });
  }

  private async recordKdsBatchAction(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    action: "created" | "completed" | "canceled",
    metadata: Record<string, unknown>,
  ) {
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `pos.kds.batch_${action}`,
      entityType: "kds_batch",
      entityId: batchId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: `pos.kds_batch_${action}`,
      aggregateType: "kds_batch",
      aggregateId: batchId,
      payload: { organizationId, unitId, batchId, ...metadata },
    });
  }

  async transitionKdsItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsItemStateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.item.transition",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new NotFoundException({ code: "KDS_ITEM_NOT_FOUND" });
        if (row.assignment.status === "canceled") {
          throw new ConflictException({ code: "KDS_ITEM_CANCELED" });
        }
        if (this.isKdsAssignmentBlocked(row.assignment)) {
          throw new ConflictException({ code: "KDS_ITEM_BLOCKED", orderItemId });
        }
        const now = new Date();
        let state: "preparing" | "ready";
        let readyQuantity = row.assignment.readyQuantity;
        if (input.state === "preparing") {
          if (row.assignment.status !== "queued" || row.assignment.held) {
            throw new ConflictException({ code: "INVALID_KDS_ITEM_TRANSITION" });
          }
          state = "preparing";
        } else {
          if (row.assignment.status !== "preparing") {
            throw new ConflictException({ code: "INVALID_KDS_ITEM_TRANSITION" });
          }
          await this.assertKdsAttentionAcknowledged(tx, organizationId, unitId, [row]);
          const remaining = row.assignment.quantity - row.assignment.readyQuantity;
          const increment = input.quantity ?? remaining;
          if (increment <= 0 || increment > remaining) {
            throw new ConflictException({ code: "INVALID_KDS_READY_QUANTITY", remaining });
          }
          readyQuantity += increment;
          state = kdsPartialState(row.assignment.quantity, readyQuantity);
        }
        await tx
          .update(posKdsTicketItems)
          .set({
            status: state,
            readyQuantity,
            startedAt: input.state === "preparing" ? now : row.assignment.startedAt,
            readyAt: state === "ready" ? now : null,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          );
        if (state === "ready") {
          await this.releaseNextKdsStage(tx, organizationId, unitId, orderItemId, now);
        }
        const itemState = await this.syncOrderItemStatusFromKds(
          tx,
          organizationId,
          unitId,
          orderItemId,
          now,
        );
        const ticketState = await this.refreshKdsTicketState(
          tx,
          organizationId,
          unitId,
          ticketId,
          now,
        );
        const orderStatuses = await this.syncOrdersForTicket(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          now,
        );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "item_transitioned",
          {
            orderItemId,
            state,
            readyQuantity,
          },
        );
        return {
          ticketId,
          orderItemId,
          state: ticketState,
          itemState,
          readyQuantity,
          orderStatuses,
        };
      },
    );
  }

  async blockKdsItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsBlockInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.item.block",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new NotFoundException({ code: "KDS_ITEM_NOT_FOUND" });
        if (this.isKdsAssignmentBlocked(row.assignment)) {
          throw new ConflictException({ code: "KDS_ITEM_ALREADY_BLOCKED", orderItemId });
        }
        if (!["queued", "preparing"].includes(row.assignment.status)) {
          throw new ConflictException({
            code: "KDS_ITEM_NOT_BLOCKABLE",
            status: row.assignment.status,
          });
        }
        const now = new Date();
        await tx
          .update(posKdsTicketItems)
          .set({
            blockCode: input.code,
            blockReason: input.reason,
            blockedAt: now,
            blockedByIdentityId: identityId,
            unblockedAt: null,
            unblockedByIdentityId: null,
            blockCount: sql`${posKdsTicketItems.blockCount} + 1`,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "item_blocked",
          {
            orderItemId,
            code: input.code,
            reason: input.reason,
          },
        );
        return {
          ticketId,
          orderItemId,
          blocked: true,
          code: input.code,
          reason: input.reason,
          blockedAt: now,
        };
      },
    );
  }

  async unblockKdsItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsUnblockInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.item.unblock",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new NotFoundException({ code: "KDS_ITEM_NOT_FOUND" });
        if (!this.isKdsAssignmentBlocked(row.assignment)) {
          throw new ConflictException({ code: "KDS_ITEM_NOT_BLOCKED", orderItemId });
        }
        const now = new Date();
        await tx
          .update(posKdsTicketItems)
          .set({ unblockedAt: now, unblockedByIdentityId: identityId })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "item_unblocked",
          {
            orderItemId,
            reason: input.reason,
            previousCode: row.assignment.blockCode,
            previousReason: row.assignment.blockReason,
          },
        );
        return {
          ticketId,
          orderItemId,
          blocked: false,
          reason: input.reason,
          unblockedAt: now,
        };
      },
    );
  }

  async acknowledgeKdsAttention(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsAttentionAcknowledgeInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.item.attention.acknowledge",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new NotFoundException({ code: "KDS_ITEM_NOT_FOUND" });
        const attention = this.kdsAttentionForItem(row.item).find(
          (entry) => entry.id === input.noteId,
        );
        if (!attention) {
          throw new ConflictException({ code: "KDS_ATTENTION_NOT_FOUND", noteId: input.noteId });
        }
        if (attention.revision !== input.revision) {
          throw new ConflictException({
            code: "KDS_ATTENTION_REVISION_CHANGED",
            noteId: input.noteId,
            currentRevision: attention.revision,
          });
        }
        const keyWhere = and(
          eq(posKdsAttentionAcknowledgements.organizationId, organizationId),
          eq(posKdsAttentionAcknowledgements.unitId, unitId),
          eq(posKdsAttentionAcknowledgements.ticketId, ticketId),
          eq(posKdsAttentionAcknowledgements.orderItemId, orderItemId),
          eq(posKdsAttentionAcknowledgements.noteId, input.noteId),
          eq(posKdsAttentionAcknowledgements.revision, input.revision),
        );
        const [existing] = await tx
          .select()
          .from(posKdsAttentionAcknowledgements)
          .where(keyWhere)
          .limit(1);
        if (existing) {
          return {
            ticketId,
            orderItemId,
            noteId: input.noteId,
            revision: input.revision,
            acknowledgedAt: existing.acknowledgedAt,
            acknowledgedByIdentityId: existing.acknowledgedByIdentityId,
          };
        }
        const now = new Date();
        await tx.insert(posKdsAttentionAcknowledgements).values({
          organizationId,
          unitId,
          ticketId,
          orderItemId,
          noteId: input.noteId,
          revision: input.revision,
          acknowledgedByIdentityId: identityId,
          acknowledgedAt: now,
        });
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "critical_note_acknowledged",
          { orderItemId, noteId: input.noteId, revision: input.revision },
        );
        return {
          ticketId,
          orderItemId,
          noteId: input.noteId,
          revision: input.revision,
          acknowledgedAt: now,
          acknowledgedByIdentityId: identityId,
        };
      },
    );
  }

  async rerouteKdsItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsRerouteInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.item.reroute",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        const [initialSource] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!initialSource) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        if (initialSource.stationId === input.stationId) {
          throw new ConflictException({ code: "KDS_ITEM_ALREADY_AT_STATION" });
        }
        await this.lockKdsStations(tx, organizationId, unitId, [
          initialSource.stationId,
          input.stationId,
        ]);
        const [activeTargetStation] = await tx
          .select({ id: posProductionStations.id })
          .from(posProductionStations)
          .where(
            and(
              eq(posProductionStations.organizationId, organizationId),
              eq(posProductionStations.unitId, unitId),
              eq(posProductionStations.id, input.stationId),
              eq(posProductionStations.active, true),
            ),
          )
          .limit(1);
        if (!activeTargetStation) {
          throw new ConflictException({ code: "STATION_NOT_ACTIVE" });
        }
        await this.lockKdsOrder(tx, organizationId, unitId, initialSource.orderId);
        const [initialTarget] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.orderId, initialSource.orderId),
              eq(posKdsTickets.stationId, input.stationId),
            ),
          )
          .limit(1);
        await this.lockKdsScope(
          tx,
          organizationId,
          unitId,
          [initialSource.orderId],
          [ticketId, ...(initialTarget ? [initialTarget.id] : [])],
        );
        const [source] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!source) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new ConflictException({ code: "KDS_ITEM_ROUTE_CHANGED_RETRY" });
        if (!["queued", "preparing"].includes(row.assignment.status)) {
          throw new ConflictException({
            code: "KDS_ITEM_NOT_REROUTABLE",
            status: row.assignment.status,
          });
        }
        const [activeBatch] = await tx
          .select({ batchId: posKdsBatchAssignments.batchId })
          .from(posKdsBatchAssignments)
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.ticketId, ticketId),
              eq(posKdsBatchAssignments.orderItemId, orderItemId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          )
          .limit(1);
        if (activeBatch) {
          throw new ConflictException({
            code: "KDS_ITEM_IN_ACTIVE_BATCH",
            batchId: activeBatch.batchId,
          });
        }
        let target = initialTarget;
        if (target && !["pending", "preparing", "ready"].includes(target.status)) {
          throw new ConflictException({
            code: "KDS_TARGET_TICKET_NOT_ACTIONABLE",
            status: target.status,
          });
        }
        const now = new Date();
        if (!target) {
          [target] = await tx
            .insert(posKdsTickets)
            .values({
              organizationId,
              unitId,
              orderId: source.orderId,
              stationId: input.stationId,
              priority: source.priority,
              dueAt: source.dueAt,
            })
            .returning();
        }
        if (!target) throw new Error("KDS reroute target insert did not return a row");
        const [targetAssignment] = await tx
          .select({ orderItemId: posKdsTicketItems.orderItemId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, target.id),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          )
          .limit(1);
        if (targetAssignment) {
          throw new ConflictException({ code: "KDS_TARGET_ALREADY_ASSIGNED", orderItemId });
        }
        if (target.status === "ready") {
          await tx
            .update(posKdsTickets)
            .set({
              readyAt: null,
              handedOffAt: null,
              servedAt: null,
              completedAt: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(posKdsTickets.organizationId, organizationId),
                eq(posKdsTickets.unitId, unitId),
                eq(posKdsTickets.id, target.id),
                eq(posKdsTickets.status, "ready"),
              ),
            );
        }
        await tx
          .update(posKdsTicketItems)
          .set({ ticketId: target.id })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          );
        const activeRoutes = await tx
          .select({ stationId: posKdsTickets.stationId })
          .from(posKdsTicketItems)
          .innerJoin(
            posKdsTickets,
            and(
              eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
              eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
              eq(posKdsTickets.id, posKdsTicketItems.ticketId),
            ),
          )
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
              ne(posKdsTicketItems.status, "canceled"),
            ),
          )
          .orderBy(asc(posKdsTickets.stationId));
        const primaryStationId = activeRoutes[0]?.stationId ?? input.stationId;
        await tx
          .update(posOrderItems)
          .set({ stationId: primaryStationId, updatedAt: now })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.id, orderItemId),
              eq(posOrderItems.orderId, source.orderId),
            ),
          );
        await this.refreshKdsTicketState(tx, organizationId, unitId, ticketId, now);
        const state = await this.refreshKdsTicketState(tx, organizationId, unitId, target.id, now);
        await this.syncOrdersForTicket(tx, identityId, organizationId, unitId, target.id, now);
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "item_rerouted",
          {
            orderItemId,
            orderId: source.orderId,
            sourceStationId: source.stationId,
            targetStationId: input.stationId,
            targetTicketId: target.id,
            reason: input.reason,
          },
        );
        return {
          sourceTicketId: ticketId,
          targetTicketId: target.id,
          orderItemId,
          sourceStationId: source.stationId,
          targetStationId: input.stationId,
          state,
        };
      },
    );
  }

  async createKdsBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: KdsBatchCreateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.batch.create",
      input,
      async (tx) => {
        await this.lockAndAssertKdsStations(tx, organizationId, unitId, [input.stationId]);
        const initial = await this.findKdsBatchCandidates(tx, organizationId, unitId, input);
        const initialMemberships = await this.activeKdsBatchMembershipKeys(
          tx,
          organizationId,
          unitId,
          initial.map(({ assignment }) => ({
            ticketId: assignment.ticketId,
            orderItemId: assignment.orderItemId,
          })),
        );
        const pool = initial
          .filter(
            ({ assignment }) =>
              !initialMemberships.has(`${assignment.ticketId}:${assignment.orderItemId}`),
          )
          .slice(0, Math.min(200, input.maxAssignments * 2));
        if (pool.length === 0) {
          throw new ConflictException({ code: "KDS_BATCH_EMPTY" });
        }
        const poolTicketIds = [...new Set(pool.map(({ assignment }) => assignment.ticketId))];
        await this.lockKdsScope(tx, organizationId, unitId, [], poolTicketIds);
        const current = await this.findKdsBatchCandidates(
          tx,
          organizationId,
          unitId,
          input,
          poolTicketIds,
        );
        const currentMemberships = await this.activeKdsBatchMembershipKeys(
          tx,
          organizationId,
          unitId,
          current.map(({ assignment }) => ({
            ticketId: assignment.ticketId,
            orderItemId: assignment.orderItemId,
          })),
        );
        const selected = current
          .filter(
            ({ assignment }) =>
              !currentMemberships.has(`${assignment.ticketId}:${assignment.orderItemId}`),
          )
          .slice(0, input.maxAssignments);
        if (selected.length === 0) {
          throw new ConflictException({ code: "KDS_BATCH_CHANGED_RETRY" });
        }
        const now = new Date();
        const [batch] = await tx
          .insert(posKdsBatches)
          .values({
            organizationId,
            unitId,
            stationId: input.stationId,
            productId: input.productId ?? null,
            createdByIdentityId: identityId,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: posKdsBatches.id });
        if (!batch) throw new Error("KDS batch insert did not return a row");
        await tx.insert(posKdsBatchAssignments).values(
          selected.map(({ assignment }, index) => ({
            organizationId,
            unitId,
            batchId: batch.id,
            ticketId: assignment.ticketId,
            orderItemId: assignment.orderItemId,
            position: index + 1,
            quantity: assignment.quantity,
            joinedAt: now,
          })),
        );
        await this.recordKdsBatchAction(
          tx,
          identityId,
          organizationId,
          unitId,
          batch.id,
          "created",
          {
            stationId: input.stationId,
            productId: input.productId ?? null,
            assignmentCount: selected.length,
            assignments: selected.map(({ assignment }) => ({
              ticketId: assignment.ticketId,
              orderItemId: assignment.orderItemId,
              quantity: assignment.quantity,
            })),
          },
        );
        return this.readKdsBatch(tx, organizationId, unitId, batch.id);
      },
    );
  }

  async completeKdsBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    idempotencyKey: string,
    input: KdsBatchCompleteInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.batch.complete",
      { batchId, ...input },
      async (tx) => {
        const [initial] = await tx
          .select()
          .from(posKdsBatches)
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!initial) throw new NotFoundException({ code: "KDS_BATCH_NOT_FOUND" });
        await this.lockKdsStations(tx, organizationId, unitId, [initial.stationId]);
        const initialMemberships = await tx
          .select({ ticketId: posKdsBatchAssignments.ticketId })
          .from(posKdsBatchAssignments)
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.batchId, batchId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          );
        await this.lockKdsScope(
          tx,
          organizationId,
          unitId,
          [],
          initialMemberships.map((membership) => membership.ticketId),
        );
        const [batch] = await tx
          .select()
          .from(posKdsBatches)
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!batch) throw new NotFoundException({ code: "KDS_BATCH_NOT_FOUND" });
        if (batch.status !== "active") {
          throw new ConflictException({ code: "KDS_BATCH_NOT_ACTIVE", status: batch.status });
        }
        const memberships = await tx
          .select()
          .from(posKdsBatchAssignments)
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.batchId, batchId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          )
          .orderBy(asc(posKdsBatchAssignments.position));
        if (memberships.length === 0) {
          throw new ConflictException({ code: "KDS_BATCH_EMPTY" });
        }
        const ticketIds = [...new Set(memberships.map((membership) => membership.ticketId))];
        const assignmentRows = await tx
          .select({ assignment: posKdsTicketItems, item: posOrderItems, ticket: posKdsTickets })
          .from(posKdsTicketItems)
          .innerJoin(
            posOrderItems,
            and(
              eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
              eq(posOrderItems.unitId, posKdsTicketItems.unitId),
              eq(posOrderItems.id, posKdsTicketItems.orderItemId),
            ),
          )
          .innerJoin(
            posKdsTickets,
            and(
              eq(posKdsTickets.organizationId, posKdsTicketItems.organizationId),
              eq(posKdsTickets.unitId, posKdsTicketItems.unitId),
              eq(posKdsTickets.id, posKdsTicketItems.ticketId),
            ),
          )
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.ticketId, ticketIds),
            ),
          );
        const assignmentsByKey = new Map(
          assignmentRows.map((row) => [
            `${row.assignment.ticketId}:${row.assignment.orderItemId}`,
            row,
          ]),
        );
        const selected = memberships.map((membership) => ({
          membership,
          row: assignmentsByKey.get(`${membership.ticketId}:${membership.orderItemId}`),
        }));
        if (
          selected.some(
            ({ membership, row }) =>
              !row ||
              row.ticket.stationId !== batch.stationId ||
              row.assignment.quantity !== membership.quantity,
          )
        ) {
          throw new ConflictException({ code: "KDS_BATCH_CHANGED_RETRY" });
        }
        const rows = selected.flatMap(({ row }) => (row ? [row] : []));
        const notActionable = rows.find(
          ({ assignment }) =>
            !["queued", "preparing"].includes(assignment.status) || assignment.held,
        );
        if (notActionable) {
          throw new ConflictException({
            code: "KDS_BATCH_ITEM_NOT_ACTIONABLE",
            orderItemId: notActionable.item.id,
            status: notActionable.assignment.status,
          });
        }
        const blocked = rows.filter(({ assignment }) => this.isKdsAssignmentBlocked(assignment));
        if (blocked.length > 0) {
          throw new ConflictException({
            code: "KDS_ITEM_BLOCKED",
            orderItemIds: blocked.map(({ item }) => item.id),
          });
        }
        await this.assertKdsAttentionAcknowledged(tx, organizationId, unitId, rows);
        const now = new Date();
        for (const { membership, row } of selected) {
          if (!row) continue;
          await tx
            .update(posKdsTicketItems)
            .set({
              status: "ready",
              readyQuantity: row.assignment.quantity,
              startedAt: row.assignment.startedAt ?? membership.joinedAt,
              readyAt: now,
            })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                eq(posKdsTicketItems.ticketId, membership.ticketId),
                eq(posKdsTicketItems.orderItemId, membership.orderItemId),
              ),
            );
        }
        for (const orderItemId of [
          ...new Set(memberships.map((membership) => membership.orderItemId)),
        ].sort()) {
          await this.releaseNextKdsStage(tx, organizationId, unitId, orderItemId, now);
          await this.syncOrderItemStatusFromKds(tx, organizationId, unitId, orderItemId, now);
        }
        for (const ticketId of ticketIds.sort()) {
          await this.refreshKdsTicketState(tx, organizationId, unitId, ticketId, now);
        }
        for (const ticketId of ticketIds.sort()) {
          await this.syncOrdersForTicket(tx, identityId, organizationId, unitId, ticketId, now);
        }
        await tx
          .update(posKdsBatchAssignments)
          .set({ releasedAt: now })
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.batchId, batchId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          );
        await tx
          .update(posKdsBatches)
          .set({
            status: "completed",
            completedByIdentityId: identityId,
            completionReason: input.reason ?? null,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
              eq(posKdsBatches.status, "active"),
            ),
          );
        await this.recordKdsBatchAction(
          tx,
          identityId,
          organizationId,
          unitId,
          batchId,
          "completed",
          { stationId: batch.stationId, ticketIds, assignmentCount: memberships.length },
        );
        return this.readKdsBatch(tx, organizationId, unitId, batchId);
      },
    );
  }

  async cancelKdsBatch(
    identityId: string,
    organizationId: string,
    unitId: string,
    batchId: string,
    idempotencyKey: string,
    input: KdsBatchCancelInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.batch.cancel",
      { batchId, ...input },
      async (tx) => {
        const [initial] = await tx
          .select()
          .from(posKdsBatches)
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!initial) throw new NotFoundException({ code: "KDS_BATCH_NOT_FOUND" });
        await this.lockKdsStations(tx, organizationId, unitId, [initial.stationId]);
        const memberships = await tx
          .select({ ticketId: posKdsBatchAssignments.ticketId })
          .from(posKdsBatchAssignments)
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.batchId, batchId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          );
        await this.lockKdsScope(
          tx,
          organizationId,
          unitId,
          [],
          memberships.map((membership) => membership.ticketId),
        );
        const [batch] = await tx
          .select()
          .from(posKdsBatches)
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
            ),
          )
          .limit(1);
        if (!batch) throw new NotFoundException({ code: "KDS_BATCH_NOT_FOUND" });
        if (batch.status !== "active") {
          throw new ConflictException({ code: "KDS_BATCH_NOT_ACTIVE", status: batch.status });
        }
        const now = new Date();
        await tx
          .update(posKdsBatchAssignments)
          .set({ releasedAt: now })
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              eq(posKdsBatchAssignments.batchId, batchId),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          );
        await tx
          .update(posKdsBatches)
          .set({
            status: "canceled",
            canceledByIdentityId: identityId,
            cancelReason: input.reason,
            canceledAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsBatches.organizationId, organizationId),
              eq(posKdsBatches.unitId, unitId),
              eq(posKdsBatches.id, batchId),
              eq(posKdsBatches.status, "active"),
            ),
          );
        await this.recordKdsBatchAction(
          tx,
          identityId,
          organizationId,
          unitId,
          batchId,
          "canceled",
          {
            stationId: batch.stationId,
            reason: input.reason,
            assignmentCount: memberships.length,
          },
        );
        return this.readKdsBatch(tx, organizationId, unitId, batchId);
      },
    );
  }

  private async raiseKdsOrderPriorityLocked(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    ticketIds: string[],
    minimumPriority: number,
    reason: string,
    now: Date,
  ) {
    const [order] = await tx
      .select({ priority: posOrders.kdsPriority })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const priority = Math.max(order.priority, minimumPriority);
    await tx
      .update(posKdsTickets)
      .set({ priority, updatedAt: now })
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          inArray(posKdsTickets.id, ticketIds),
        ),
      );
    if (priority === order.priority) return priority;
    await tx
      .update(posOrders)
      .set({
        kdsPriority: priority,
        kdsPriorityReason: reason,
        kdsPriorityUpdatedAt: now,
        kdsPriorityUpdatedByIdentityId: identityId,
        updatedAt: now,
      })
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      );
    const metadata = {
      from: order.priority,
      to: priority,
      reason,
      ticketIds,
      updatedByIdentityId: identityId,
    };
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "pos.kds.order_priority_changed",
      entityType: "order",
      entityId: orderId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: "pos.kds_order_priority_changed",
      aggregateType: "order",
      aggregateId: orderId,
      payload: { organizationId, unitId, orderId, ...metadata },
    });
    return priority;
  }

  private async applyKdsOrderPriority(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    input: KdsOrderPriorityInput,
  ) {
    const [initialOrder] = await tx
      .select({ id: posOrders.id })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!initialOrder) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const actionableTicketCondition = or(
      inArray(posKdsTickets.status, ["pending", "preparing", "ready"]),
      and(eq(posKdsTickets.status, "done"), isNull(posKdsTickets.servedAt)),
    );
    const initialTickets = await tx
      .select({ id: posKdsTickets.id })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.orderId, orderId),
          actionableTicketCondition,
        ),
      );
    const ticketIds = initialTickets.map(({ id }) => id).sort();
    await this.lockKdsScope(tx, organizationId, unitId, [orderId], ticketIds);
    const [order] = await tx
      .select({ status: posOrders.status, priority: posOrders.kdsPriority })
      .from(posOrders)
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      )
      .limit(1);
    if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    if (["draft", "served", "canceled"].includes(order.status)) {
      throw new ConflictException({ code: "KDS_ORDER_NOT_ACTIONABLE", status: order.status });
    }
    const currentTickets = await tx
      .select({ id: posKdsTickets.id })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.orderId, orderId),
          actionableTicketCondition,
        ),
      );
    const currentTicketIds = currentTickets.map(({ id }) => id).sort();
    if (
      currentTicketIds.length !== ticketIds.length ||
      currentTicketIds.some((id, index) => id !== ticketIds[index])
    ) {
      throw new ConflictException({ code: "KDS_ORDER_CHANGED_RETRY" });
    }
    if (ticketIds.length === 0) throw new ConflictException({ code: "KDS_ORDER_EMPTY" });
    const now = new Date();
    await tx
      .update(posOrders)
      .set({
        kdsPriority: input.priority,
        kdsPriorityReason: input.reason,
        kdsPriorityUpdatedAt: now,
        kdsPriorityUpdatedByIdentityId: identityId,
        updatedAt: now,
      })
      .where(
        and(
          eq(posOrders.organizationId, organizationId),
          eq(posOrders.unitId, unitId),
          eq(posOrders.id, orderId),
        ),
      );
    await tx
      .update(posKdsTickets)
      .set({ priority: input.priority, updatedAt: now })
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          inArray(posKdsTickets.id, ticketIds),
        ),
      );
    const metadata = {
      from: order.priority,
      to: input.priority,
      reason: input.reason,
      ticketIds,
      updatedByIdentityId: identityId,
    };
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId: identityId,
      action: "pos.kds.order_priority_changed",
      entityType: "order",
      entityId: orderId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: "pos.kds_order_priority_changed",
      aggregateType: "order",
      aggregateId: orderId,
      payload: { organizationId, unitId, orderId, ...metadata },
    });
    return {
      orderId,
      ticketIds,
      priority: input.priority,
      reason: input.reason,
      updatedAt: now,
      updatedByIdentityId: identityId,
    };
  }

  async setKdsOrderPriority(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    input: KdsOrderPriorityInput,
  ) {
    const bindings = await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "kds",
    ]);
    const managerAuthorized = bindings.some(
      (binding) =>
        ["owner", "manager"].includes(binding.role) &&
        (binding.unitId === null || binding.unitId === unitId),
    );
    if (!managerAuthorized) {
      const [passTerminal] = input.installationId
        ? await this.database.db
            .select({ installationId: posKdsTerminalProfiles.installationId })
            .from(posKdsTerminalProfiles)
            .where(
              and(
                eq(posKdsTerminalProfiles.organizationId, organizationId),
                eq(posKdsTerminalProfiles.unitId, unitId),
                eq(posKdsTerminalProfiles.installationId, input.installationId),
                eq(posKdsTerminalProfiles.mode, "pass"),
              ),
            )
            .limit(1)
        : [];
      if (!passTerminal) {
        throw new ForbiddenException({
          code: "KDS_PASS_TERMINAL_REQUIRED",
          message: "Prioridade operacional exige um terminal configurado como Passe.",
        });
      }
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.order.priority",
      { orderId, ...input },
      (tx) => this.applyKdsOrderPriority(tx, identityId, organizationId, unitId, orderId, input),
    );
  }

  async setKdsPriority(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsPriorityInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.priority",
      { ticketId, ...input },
      async (tx) => {
        const [ticket] = await tx
          .select({ orderId: posKdsTickets.orderId, status: posKdsTickets.status })
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!ticket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        const result = await this.applyKdsOrderPriority(
          tx,
          identityId,
          organizationId,
          unitId,
          ticket.orderId,
          input,
        );
        return { ...result, ticketId, state: ticket.status };
      },
    );
  }

  async setKdsCourseState(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsCourseStateInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.course",
      { ticketId, ...input },
      async (tx) => {
        await this.requireLockedKdsTicket(tx, organizationId, unitId, ticketId);
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const matching = assignments.filter(
          ({ item, assignment }) =>
            item.course === input.course &&
            assignment.status === "queued" &&
            assignment.held === (input.state === "fired"),
        );
        if (matching.length === 0)
          throw new ConflictException({ code: "KDS_COURSE_NOT_ACTIONABLE" });
        const now = new Date();
        await tx
          .update(posKdsTicketItems)
          .set({
            courseHeld: input.state === "held",
            held: input.state === "held" ? true : sql`${posKdsTicketItems.dependencyHeld}`,
            heldAt: input.state === "held" ? now : null,
            firedAt:
              input.state === "fired"
                ? sql`case when ${posKdsTicketItems.dependencyHeld} then null else ${now.toISOString()}::timestamptz end`
                : null,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              inArray(
                posKdsTicketItems.orderItemId,
                matching.map(({ item }) => item.id),
              ),
            ),
          );
        let dueAt: Date | null | undefined;
        if (input.state === "fired") {
          const [deadline] = await tx
            .select({ promisedAt: posTabs.promisedAt })
            .from(posKdsTickets)
            .innerJoin(
              posOrders,
              and(
                eq(posOrders.organizationId, posKdsTickets.organizationId),
                eq(posOrders.unitId, posKdsTickets.unitId),
                eq(posOrders.id, posKdsTickets.orderId),
              ),
            )
            .innerJoin(
              posTabs,
              and(
                eq(posTabs.organizationId, posOrders.organizationId),
                eq(posTabs.unitId, posOrders.unitId),
                eq(posTabs.id, posOrders.tabId),
              ),
            )
            .where(
              and(
                eq(posKdsTickets.organizationId, organizationId),
                eq(posKdsTickets.unitId, unitId),
                eq(posKdsTickets.id, ticketId),
              ),
            )
            .limit(1);
          const estimatedMinutes = Math.max(
            0,
            ...matching.map(({ item }) => item.estimatedPrepTimeMinutes ?? 0),
          );
          dueAt =
            deadline?.promisedAt ??
            (estimatedMinutes > 0 ? new Date(now.getTime() + estimatedMinutes * 60_000) : null);
        }
        await tx
          .update(posKdsTickets)
          .set({ dueAt, updatedAt: now })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          );
        await this.recordKdsAction(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          "course_changed",
          input,
        );
        return { ticketId, state: input.state, course: input.course };
      },
    );
  }

  async recallKdsTicket(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsRecallInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.recall",
      { ticketId, ...input },
      async (tx) => {
        const { ticket, ticketIds, orderId } = await this.requireLockedKdsOrderTicketsForTicket(
          tx,
          organizationId,
          unitId,
          ticketId,
        );
        if (ticket.status !== "ready" && !(ticket.status === "done" && !ticket.servedAt)) {
          throw new ConflictException({ code: "KDS_TICKET_NOT_RECALLABLE" });
        }
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const itemIds = assignments
          .filter(({ assignment }) => assignment.status !== "canceled")
          .map(({ item }) => item.id);
        if (itemIds.length === 0) throw new ConflictException({ code: "KDS_TICKET_EMPTY" });
        const now = new Date();
        await tx
          .update(posKdsTicketItems)
          .set({
            status: "preparing",
            readyQuantity: 0,
            held: false,
            startedAt: now,
            readyAt: null,
            completedAt: null,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              inArray(posKdsTicketItems.orderItemId, itemIds),
            ),
          );
        for (const itemId of [...new Set(itemIds)].sort()) {
          await this.syncOrderItemStatusFromKds(tx, organizationId, unitId, itemId, now);
        }
        await tx
          .update(posKdsTickets)
          .set({
            status: "preparing",
            startedAt: now,
            readyAt: null,
            handedOffAt: null,
            completedAt: null,
            recallCount: ticket.recallCount + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          );
        await this.raiseKdsOrderPriorityLocked(
          tx,
          identityId,
          organizationId,
          unitId,
          orderId,
          ticketIds,
          50,
          input.reason,
          now,
        );
        const orderStatuses = await this.syncOrdersForTicket(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          now,
        );
        await this.recordKdsAction(tx, identityId, organizationId, unitId, ticketId, "recalled", {
          reason: input.reason,
          from: ticket.status,
        });
        return { ticketId, state: "preparing", orderStatuses };
      },
    );
  }

  async refireKdsItem(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    orderItemId: string,
    idempotencyKey: string,
    input: KdsRefireInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.refire",
      { ticketId, orderItemId, ...input },
      async (tx) => {
        const { ticket, ticketIds, orderId } = await this.requireLockedKdsOrderTicketsForTicket(
          tx,
          organizationId,
          unitId,
          ticketId,
        );
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const row = assignments.find(({ item }) => item.id === orderItemId);
        if (!row) throw new NotFoundException({ code: "KDS_ITEM_NOT_FOUND" });
        if (!["ready", "served"].includes(row.assignment.status)) {
          throw new ConflictException({ code: "KDS_ITEM_NOT_REFIREABLE" });
        }
        const now = new Date();
        await tx
          .update(posKdsTicketItems)
          .set({
            status: "preparing",
            readyQuantity: 0,
            held: false,
            startedAt: now,
            readyAt: null,
            completedAt: null,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              eq(posKdsTicketItems.ticketId, ticketId),
              eq(posKdsTicketItems.orderItemId, orderItemId),
            ),
          );
        await this.syncOrderItemStatusFromKds(tx, organizationId, unitId, orderItemId, now);
        await tx
          .update(posKdsTickets)
          .set({
            status: "preparing",
            startedAt: now,
            readyAt: null,
            handedOffAt: null,
            servedAt: null,
            completedAt: null,
            refireCount: ticket.refireCount + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          );
        await this.raiseKdsOrderPriorityLocked(
          tx,
          identityId,
          organizationId,
          unitId,
          orderId,
          ticketIds,
          100,
          input.reason,
          now,
        );
        const orderStatuses = await this.syncOrdersForTicket(
          tx,
          identityId,
          organizationId,
          unitId,
          ticketId,
          now,
        );
        await this.recordKdsAction(tx, identityId, organizationId, unitId, ticketId, "refired", {
          orderItemId,
          reason: input.reason,
        });
        return { ticketId, orderItemId, state: "preparing", orderStatuses };
      },
    );
  }

  async cancelKdsTicket(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: KdsCancelInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
      "kds",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.cancel",
      { ticketId, approval: { ...input.approval, pin: "[redacted]" } },
      async (tx) => {
        const [initialTicket] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!initialTicket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        const initialAssignments = await this.getKdsAssignments(
          tx,
          organizationId,
          unitId,
          ticketId,
        );
        const initialActive = initialAssignments.filter(
          ({ assignment }) => assignment.status !== "canceled",
        );
        if (initialActive.length === 0) {
          throw new ConflictException({ code: "KDS_TICKET_EMPTY" });
        }
        const initialItemIds = [...new Set(initialActive.map(({ item }) => item.id))].sort();
        const initialLinks = await tx
          .select({ ticketId: posKdsTicketItems.ticketId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.orderItemId, initialItemIds),
            ),
          );
        const lockedTicketIds = [
          ...new Set([ticketId, ...initialLinks.map((link) => link.ticketId)]),
        ].sort();
        await this.lockKdsScope(
          tx,
          organizationId,
          unitId,
          initialActive.map(({ item }) => item.orderId),
          lockedTicketIds,
        );
        const [ticket] = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.id, ticketId),
            ),
          )
          .limit(1);
        if (!ticket) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
        if (!["pending", "preparing", "ready"].includes(ticket.status)) {
          throw new ConflictException({ code: "KDS_TICKET_NOT_CANCELABLE", status: ticket.status });
        }
        const assignments = await this.getKdsAssignments(tx, organizationId, unitId, ticketId);
        const active = assignments.filter(({ assignment }) => assignment.status !== "canceled");
        if (active.length === 0) throw new ConflictException({ code: "KDS_TICKET_EMPTY" });
        const itemIds = [...new Set(active.map(({ item }) => item.id))].sort();
        if (
          itemIds.length !== initialItemIds.length ||
          itemIds.some((itemId, index) => itemId !== initialItemIds[index])
        ) {
          throw new ConflictException({ code: "KDS_LOCK_SCOPE_CHANGED_RETRY" });
        }
        const currentLinks = await tx
          .select({ ticketId: posKdsTicketItems.ticketId })
          .from(posKdsTicketItems)
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.orderItemId, itemIds),
            ),
          );
        const linkedTicketIds = [...new Set(currentLinks.map((link) => link.ticketId))].sort();
        if (linkedTicketIds.some((linkedTicketId) => !lockedTicketIds.includes(linkedTicketId))) {
          throw new ConflictException({ code: "KDS_LOCK_SCOPE_CHANGED_RETRY" });
        }
        const approval = await this.approve(
          tx,
          identityId,
          organizationId,
          unitId,
          "cancel",
          "kds_ticket",
          ticketId,
          input.approval,
        );
        const now = new Date();
        await tx
          .update(posOrderItems)
          .set({
            status: "canceled",
            discountCents: 0,
            netCents: 0,
            canceledAt: now,
            canceledReason: input.approval.reason,
            updatedAt: now,
          })
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              inArray(posOrderItems.id, itemIds),
              ne(posOrderItems.status, "canceled"),
            ),
          );
        const [unit] = await tx
          .select({ timezone: units.timezone })
          .from(units)
          .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
          .limit(1);
        const businessDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: unit?.timezone ?? "America/Sao_Paulo",
        }).format(now);
        const restoredByProduct = new Map<string, number>();
        const uniqueItems = [...new Map(active.map(({ item }) => [item.id, item])).values()];
        for (const item of uniqueItems) {
          restoredByProduct.set(
            item.productId,
            (restoredByProduct.get(item.productId) ?? 0) + item.quantity,
          );
        }
        for (const [productId, quantity] of restoredByProduct) {
          await tx
            .update(posProductAvailability)
            .set({
              soldToday: sql`greatest(0, ${posProductAvailability.soldToday} - ${quantity})`,
              updatedAt: now,
            })
            .where(
              and(
                eq(posProductAvailability.organizationId, organizationId),
                eq(posProductAvailability.unitId, unitId),
                eq(posProductAvailability.productId, productId),
                eq(posProductAvailability.stockDate, businessDate),
              ),
            );
        }
        await tx
          .update(posKdsTicketItems)
          .set({
            status: "canceled",
            readyQuantity: 0,
            held: false,
            completedAt: now,
          })
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.orderItemId, itemIds),
              ne(posKdsTicketItems.status, "canceled"),
            ),
          );
        const affectedBatchRows = await tx
          .select({ batchId: posKdsBatchAssignments.batchId })
          .from(posKdsBatchAssignments)
          .where(
            and(
              eq(posKdsBatchAssignments.organizationId, organizationId),
              eq(posKdsBatchAssignments.unitId, unitId),
              inArray(posKdsBatchAssignments.orderItemId, itemIds),
              isNull(posKdsBatchAssignments.releasedAt),
            ),
          );
        const affectedBatchIds = [...new Set(affectedBatchRows.map((row) => row.batchId))].sort();
        if (affectedBatchIds.length > 0) {
          await tx
            .update(posKdsBatchAssignments)
            .set({ releasedAt: now })
            .where(
              and(
                eq(posKdsBatchAssignments.organizationId, organizationId),
                eq(posKdsBatchAssignments.unitId, unitId),
                inArray(posKdsBatchAssignments.batchId, affectedBatchIds),
                inArray(posKdsBatchAssignments.orderItemId, itemIds),
                isNull(posKdsBatchAssignments.releasedAt),
              ),
            );
          for (const affectedBatchId of affectedBatchIds) {
            const [remaining] = await tx
              .select({ batchId: posKdsBatchAssignments.batchId })
              .from(posKdsBatchAssignments)
              .where(
                and(
                  eq(posKdsBatchAssignments.organizationId, organizationId),
                  eq(posKdsBatchAssignments.unitId, unitId),
                  eq(posKdsBatchAssignments.batchId, affectedBatchId),
                  isNull(posKdsBatchAssignments.releasedAt),
                ),
              )
              .limit(1);
            if (!remaining) {
              const [canceledBatch] = await tx
                .update(posKdsBatches)
                .set({
                  status: "canceled",
                  canceledByIdentityId: identityId,
                  cancelReason: `Cancelamento do pedido: ${input.approval.reason}`,
                  canceledAt: now,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(posKdsBatches.organizationId, organizationId),
                    eq(posKdsBatches.unitId, unitId),
                    eq(posKdsBatches.id, affectedBatchId),
                    eq(posKdsBatches.status, "active"),
                  ),
                )
                .returning({ id: posKdsBatches.id });
              if (canceledBatch) {
                await this.recordKdsBatchAction(
                  tx,
                  identityId,
                  organizationId,
                  unitId,
                  affectedBatchId,
                  "canceled",
                  {
                    reason: input.approval.reason,
                    originTicketId: ticketId,
                    automatic: true,
                  },
                );
              }
            }
          }
        }
        const ticketStates = [];
        for (const linkedTicketId of linkedTicketIds) {
          ticketStates.push({
            ticketId: linkedTicketId,
            state: await this.refreshKdsTicketState(
              tx,
              organizationId,
              unitId,
              linkedTicketId,
              now,
            ),
          });
        }
        const orderIds = [...new Set(uniqueItems.map((item) => item.orderId))].sort();
        const orderStatuses = [];
        for (const orderId of orderIds) {
          orderStatuses.push({
            orderId,
            status: await this.syncOrderStatus(
              tx,
              identityId,
              organizationId,
              unitId,
              orderId,
              now,
            ),
          });
        }
        const orderRows = await tx
          .select({ tabId: posOrders.tabId })
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              inArray(posOrders.id, orderIds),
            ),
          );
        const totals = [];
        for (const tabId of [...new Set(orderRows.map((row) => row.tabId))].sort()) {
          totals.push({
            tabId,
            totals: await this.recalculateTab(tx, organizationId, unitId, tabId),
          });
          await this.recordEvent(tx, identityId, organizationId, unitId, tabId, "kds.canceled", {
            ticketId,
            ticketIds: linkedTicketIds,
            approvalId: approval.id,
            reason: input.approval.reason,
          });
        }
        for (const linkedTicketId of linkedTicketIds) {
          await this.recordKdsAction(
            tx,
            identityId,
            organizationId,
            unitId,
            linkedTicketId,
            "canceled",
            {
              originTicketId: ticketId,
              approvalId: approval.id,
              reason: input.approval.reason,
              itemIds,
            },
          );
        }
        return {
          ticketId,
          ticketIds: linkedTicketIds,
          state: ticketStates.find((ticketState) => ticketState.ticketId === ticketId)?.state,
          approvalId: approval.id,
          orderStatuses,
          totals,
        };
      },
    );
  }

  async claimKdsRunner(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    input: KdsRunnerClaimInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "kds",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.runner.claim",
      { orderId, ...input },
      async (tx) => {
        await this.lockKdsOrder(tx, organizationId, unitId, orderId);
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
            ),
          )
          .limit(1);
        if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
        if (order.status !== "ready") {
          throw new ConflictException({ code: "KDS_ORDER_NOT_READY", status: order.status });
        }
        const tickets = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.orderId, orderId),
              ne(posKdsTickets.status, "canceled"),
            ),
          );
        if (
          tickets.length === 0 ||
          tickets.some((ticket) => !ticket.handedOffAt || ticket.servedAt)
        ) {
          throw new ConflictException({ code: "KDS_ORDER_NOT_AT_EXPEDITION" });
        }
        if (order.runnerIdentityId && order.runnerIdentityId !== identityId) {
          throw new ConflictException({ code: "KDS_ORDER_CLAIMED_BY_ANOTHER_RUNNER" });
        }
        const runnerClaimedAt = order.runnerClaimedAt ?? new Date();
        if (!order.runnerIdentityId) {
          await tx
            .update(posOrders)
            .set({ runnerIdentityId: identityId, runnerClaimedAt, updatedAt: runnerClaimedAt })
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.id, orderId),
              ),
            );
        }
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.kds.runner_claimed",
          entityType: "order",
          entityId: orderId,
          metadata: { reason: input.reason ?? null },
        });
        return { orderId, runnerIdentityId: identityId, runnerClaimedAt };
      },
    );
  }

  async handoffKdsOrder(
    identityId: string,
    organizationId: string,
    unitId: string,
    orderId: string,
    idempotencyKey: string,
    input: KdsOrderHandoffInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, [
      "owner",
      "manager",
      "waiter",
      "kds",
    ]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.order.handoff",
      { orderId, ...input },
      async (tx) => {
        const [initialOrder] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
            ),
          )
          .limit(1);
        if (!initialOrder) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
        const initialTickets = await tx
          .select({ id: posKdsTickets.id })
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.orderId, orderId),
              ne(posKdsTickets.status, "canceled"),
            ),
          );
        const ticketIds = initialTickets.map((ticket) => ticket.id).sort();
        if (ticketIds.length === 0) throw new ConflictException({ code: "KDS_ORDER_EMPTY" });
        await this.lockKdsScope(tx, organizationId, unitId, [orderId], ticketIds);
        const currentTicketRows = await tx
          .select({ id: posKdsTickets.id })
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              eq(posKdsTickets.orderId, orderId),
              ne(posKdsTickets.status, "canceled"),
            ),
          );
        const currentTicketIds = currentTicketRows.map((ticket) => ticket.id).sort();
        if (
          currentTicketIds.length !== ticketIds.length ||
          currentTicketIds.some((ticketId, index) => ticketId !== ticketIds[index])
        ) {
          throw new ConflictException({ code: "KDS_ORDER_CHANGED_RETRY" });
        }
        const [order] = await tx
          .select()
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, orderId),
            ),
          )
          .limit(1);
        if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
        if (order.status !== "ready" && order.status !== "served") {
          throw new ConflictException({ code: "KDS_ORDER_NOT_READY", status: order.status });
        }
        const tickets = await tx
          .select()
          .from(posKdsTickets)
          .where(
            and(
              eq(posKdsTickets.organizationId, organizationId),
              eq(posKdsTickets.unitId, unitId),
              inArray(posKdsTickets.id, ticketIds),
            ),
          );
        const assignmentRows = await tx
          .select({ assignment: posKdsTicketItems, item: posOrderItems })
          .from(posKdsTicketItems)
          .innerJoin(
            posOrderItems,
            and(
              eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
              eq(posOrderItems.unitId, posKdsTicketItems.unitId),
              eq(posOrderItems.id, posKdsTicketItems.orderItemId),
            ),
          )
          .where(
            and(
              eq(posKdsTicketItems.organizationId, organizationId),
              eq(posKdsTicketItems.unitId, unitId),
              inArray(posKdsTicketItems.ticketId, ticketIds),
            ),
          );
        const active = assignmentRows.filter(({ assignment }) => assignment.status !== "canceled");
        if (active.length === 0) throw new ConflictException({ code: "KDS_ORDER_EMPTY" });
        if (
          active.some(
            ({ assignment }) =>
              !["ready", "served"].includes(assignment.status) ||
              assignment.readyQuantity !== assignment.quantity,
          )
        ) {
          throw new ConflictException({ code: "KDS_ORDER_NOT_READY" });
        }
        assertKdsOrderHandoff(input.target, tickets);
        const now = new Date();
        const persistedNow = now.toISOString();
        if (input.target === "expedition") {
          await this.notifyOrderReadyOnce(tx, identityId, organizationId, unitId, orderId, now);
          await tx
            .update(posKdsTickets)
            .set({
              status: "done",
              handedOffAt: sql`coalesce(${posKdsTickets.handedOffAt}, ${persistedNow}::timestamptz)`,
              completedAt: sql`coalesce(${posKdsTickets.completedAt}, ${persistedNow}::timestamptz)`,
              updatedAt: now,
            })
            .where(
              and(
                eq(posKdsTickets.organizationId, organizationId),
                eq(posKdsTickets.unitId, unitId),
                inArray(posKdsTickets.id, ticketIds),
              ),
            );
          await tx
            .update(posKdsTicketItems)
            .set({
              completedAt: sql`coalesce(${posKdsTicketItems.completedAt}, ${persistedNow}::timestamptz)`,
            })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                inArray(posKdsTicketItems.ticketId, ticketIds),
                ne(posKdsTicketItems.status, "canceled"),
              ),
            );
        } else if (input.target === "runner") {
          if (!order.runnerIdentityId || !order.runnerClaimedAt) {
            throw new ConflictException({ code: "KDS_RUNNER_NOT_CLAIMED" });
          }
          if (order.runnerPickedUpAt) {
            throw new ConflictException({ code: "KDS_ORDER_ALREADY_WITH_RUNNER" });
          }
          await tx
            .update(posOrders)
            .set({ runnerPickedUpAt: now, updatedAt: now })
            .where(
              and(
                eq(posOrders.organizationId, organizationId),
                eq(posOrders.unitId, unitId),
                eq(posOrders.id, orderId),
                isNull(posOrders.runnerPickedUpAt),
              ),
            );
        } else {
          if (order.runnerIdentityId && !order.runnerPickedUpAt) {
            throw new ConflictException({ code: "KDS_ORDER_NOT_PICKED_UP_BY_RUNNER" });
          }
          await this.notifyOrderReadyOnce(tx, identityId, organizationId, unitId, orderId, now);
          const itemIds = active.map(({ item }) => item.id);
          await tx
            .update(posKdsTicketItems)
            .set({
              status: "served",
              readyQuantity: sql`${posKdsTicketItems.quantity}`,
              completedAt: sql`coalesce(${posKdsTicketItems.completedAt}, ${persistedNow}::timestamptz)`,
            })
            .where(
              and(
                eq(posKdsTicketItems.organizationId, organizationId),
                eq(posKdsTicketItems.unitId, unitId),
                inArray(posKdsTicketItems.ticketId, ticketIds),
                ne(posKdsTicketItems.status, "canceled"),
              ),
            );
          await tx
            .update(posOrderItems)
            .set({ status: "served", updatedAt: now })
            .where(
              and(
                eq(posOrderItems.organizationId, organizationId),
                eq(posOrderItems.unitId, unitId),
                inArray(posOrderItems.id, itemIds),
                ne(posOrderItems.status, "canceled"),
              ),
            );
          await tx
            .update(posKdsTickets)
            .set({
              status: "done",
              handedOffAt: sql`coalesce(${posKdsTickets.handedOffAt}, ${persistedNow}::timestamptz)`,
              servedAt: sql`coalesce(${posKdsTickets.servedAt}, ${persistedNow}::timestamptz)`,
              completedAt: sql`coalesce(${posKdsTickets.completedAt}, ${persistedNow}::timestamptz)`,
              updatedAt: now,
            })
            .where(
              and(
                eq(posKdsTickets.organizationId, organizationId),
                eq(posKdsTickets.unitId, unitId),
                inArray(posKdsTickets.id, ticketIds),
              ),
            );
          const linkedOrderIds = [...new Set(active.map(({ item }) => item.orderId))].sort();
          for (const linkedOrderId of linkedOrderIds) {
            await this.syncOrderStatus(tx, identityId, organizationId, unitId, linkedOrderId, now);
          }
        }
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.kds.order_handoff",
          entityType: "order",
          entityId: orderId,
          metadata: { target: input.target, reason: input.reason, ticketIds },
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.kds_order_handoff",
          aggregateType: "order",
          aggregateId: orderId,
          payload: { organizationId, unitId, orderId, target: input.target, ticketIds },
        });
        return {
          orderId,
          ticketIds,
          target: input.target,
          state: input.target === "served" ? "served" : "ready",
        };
      },
    );
  }

  async setKdsProductAvailability(
    identityId: string,
    organizationId: string,
    unitId: string,
    productId: string,
    idempotencyKey: string,
    input: KdsProductAvailabilityInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.product.availability",
      { productId, ...input },
      async (tx) => {
        const [product] = await tx
          .select({ id: posProducts.id, name: posProducts.name })
          .from(posProducts)
          .where(
            and(
              eq(posProducts.organizationId, organizationId),
              eq(posProducts.id, productId),
              eq(posProducts.active, true),
            ),
          )
          .limit(1);
        if (!product) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND" });
        const now = new Date();
        const resetAt = input.resetAt ? new Date(input.resetAt) : null;
        if (
          (input.available && resetAt !== null) ||
          (resetAt !== null && resetAt.getTime() <= now.getTime())
        ) {
          throw new BadRequestException({
            code: "INVALID_KDS_AVAILABILITY_RESET",
            message: "resetAt deve ser futuro e só pode ser usado durante indisponibilidade.",
          });
        }
        const [availability] = await tx
          .update(posProductAvailability)
          .set({
            available: input.available,
            operationalReason: input.reason,
            operationalUpdatedByIdentityId: identityId,
            operationalResetAt: resetAt,
            ...(input.dailyStock !== undefined ? { dailyStock: input.dailyStock } : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(posProductAvailability.organizationId, organizationId),
              eq(posProductAvailability.unitId, unitId),
              eq(posProductAvailability.productId, productId),
            ),
          )
          .returning({ productId: posProductAvailability.productId });
        if (!availability) {
          throw new ConflictException({ code: "PRODUCT_NOT_CONFIGURED_FOR_UNIT" });
        }
        const projected = (
          await this.readKdsProductAvailability(tx, organizationId, unitId, now)
        ).find((row) => row.productId === productId);
        if (!projected) throw new ConflictException({ code: "PRODUCT_NOT_CONFIGURED_FOR_UNIT" });
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.kds.product_availability_changed",
          entityType: "product",
          entityId: productId,
          metadata: projected,
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.catalog_changed",
          aggregateType: "product",
          aggregateId: productId,
          payload: {
            organizationId,
            unitId,
            productId,
            action: "availability_changed_from_kds",
            available: projected.available,
            status: projected.status,
            dailyStock: projected.dailyStock,
            soldToday: projected.soldToday,
            remainingQuantity: projected.remainingQuantity,
            reason: projected.reason,
            resetAt: projected.resetAt,
            updatedByIdentityId: identityId,
          },
        });
        return projected;
      },
    );
  }

  async getKdsTerminalProfile(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager", "kds"]);
    const [profile] = await this.database.db
      .select()
      .from(posKdsTerminalProfiles)
      .where(
        and(
          eq(posKdsTerminalProfiles.organizationId, organizationId),
          eq(posKdsTerminalProfiles.unitId, unitId),
          eq(posKdsTerminalProfiles.installationId, installationId),
        ),
      )
      .limit(1);
    if (!profile) throw new NotFoundException({ code: "KDS_TERMINAL_PROFILE_NOT_FOUND" });
    return profile;
  }

  async putKdsTerminalProfile(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
    idempotencyKey: string,
    input: KdsTerminalProfileInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds.terminal.profile.put",
      { installationId, ...input },
      async (tx) => {
        if (input.mode === "station" && input.stationId) {
          await this.lockAndAssertKdsStations(tx, organizationId, unitId, [input.stationId]);
        }
        const now = new Date();
        const [profile] = await tx
          .insert(posKdsTerminalProfiles)
          .values({
            organizationId,
            unitId,
            installationId,
            mode: input.mode,
            stationId: input.stationId,
            label: input.label,
            soundEnabled: input.soundEnabled,
            fullscreenPreferred: input.fullscreenPreferred,
            createdByIdentityId: identityId,
            updatedByIdentityId: identityId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              posKdsTerminalProfiles.organizationId,
              posKdsTerminalProfiles.unitId,
              posKdsTerminalProfiles.installationId,
            ],
            set: {
              mode: input.mode,
              stationId: input.stationId,
              label: input.label,
              soundEnabled: input.soundEnabled,
              fullscreenPreferred: input.fullscreenPreferred,
              updatedByIdentityId: identityId,
              updatedAt: now,
            },
          })
          .returning();
        if (!profile) throw new Error("KDS terminal profile upsert did not return a row");
        const metadata = {
          installationId,
          mode: input.mode,
          stationId: input.stationId,
          label: input.label,
          soundEnabled: input.soundEnabled,
          fullscreenPreferred: input.fullscreenPreferred,
        };
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.kds.terminal_profile_changed",
          entityType: "kds_terminal_profile",
          entityId: installationId,
          metadata,
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.kds_terminal_profile_changed",
          aggregateType: "kds_terminal_profile",
          aggregateId: installationId,
          payload: { organizationId, unitId, ...metadata },
        });
        return profile;
      },
    );
  }

  async getTerminalProfile(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, SYSTEM_ROLES);
    const [profile] = await this.database.db
      .select()
      .from(posTerminalProfiles)
      .where(
        and(
          eq(posTerminalProfiles.organizationId, organizationId),
          eq(posTerminalProfiles.unitId, unitId),
          eq(posTerminalProfiles.installationId, installationId),
        ),
      )
      .limit(1);
    if (!profile) return null;
    const [binding] = await this.database.db
      .select({ cashRegisterId: managementCashRegisterTerminals.cashRegisterId })
      .from(managementCashRegisterTerminals)
      .where(
        and(
          eq(managementCashRegisterTerminals.organizationId, organizationId),
          eq(managementCashRegisterTerminals.unitId, unitId),
          eq(managementCashRegisterTerminals.installationId, installationId),
        ),
      )
      .limit(1);
    return { ...profile, cashRegisterId: binding?.cashRegisterId ?? null };
  }

  async putTerminalProfile(
    identityId: string,
    organizationId: string,
    unitId: string,
    installationId: string,
    idempotencyKey: string,
    input: TerminalProfileInput,
  ) {
    await this.requireScopedRole(identityId, organizationId, unitId, ["owner", "manager"]);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "terminal.profile.put",
      { installationId, ...input },
      async (tx) => {
        const { cashRegisterId, ...profileInput } = input;
        if (input.stationId) {
          await this.lockAndAssertKdsStations(tx, organizationId, unitId, [input.stationId]);
        }
        if (cashRegisterId) {
          const [cashRegister] = await tx
            .select({ id: managementCashRegisters.id })
            .from(managementCashRegisters)
            .where(
              and(
                eq(managementCashRegisters.organizationId, organizationId),
                eq(managementCashRegisters.unitId, unitId),
                eq(managementCashRegisters.id, cashRegisterId),
                eq(managementCashRegisters.active, true),
              ),
            )
            .for("update")
            .limit(1);
          if (!cashRegister) {
            throw new ConflictException({
              code: "CASH_REGISTER_NOT_FOUND",
              message: "A gaveta informada não está ativa nesta unidade.",
            });
          }
        }
        const now = new Date();
        const [profile] = await tx
          .insert(posTerminalProfiles)
          .values({
            organizationId,
            unitId,
            installationId,
            ...profileInput,
            createdByIdentityId: identityId,
            updatedByIdentityId: identityId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              posTerminalProfiles.organizationId,
              posTerminalProfiles.unitId,
              posTerminalProfiles.installationId,
            ],
            set: {
              ...profileInput,
              updatedByIdentityId: identityId,
              updatedAt: now,
            },
          })
          .returning();
        if (!profile) throw new Error("Terminal profile upsert did not return a row");
        if (cashRegisterId) {
          await tx
            .insert(managementCashRegisterTerminals)
            .values({
              organizationId,
              unitId,
              installationId,
              cashRegisterId,
              updatedByIdentityId: identityId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [
                managementCashRegisterTerminals.organizationId,
                managementCashRegisterTerminals.unitId,
                managementCashRegisterTerminals.installationId,
              ],
              set: { cashRegisterId, updatedByIdentityId: identityId, updatedAt: now },
            });
        } else if (cashRegisterId === null) {
          await tx
            .delete(managementCashRegisterTerminals)
            .where(
              and(
                eq(managementCashRegisterTerminals.organizationId, organizationId),
                eq(managementCashRegisterTerminals.unitId, unitId),
                eq(managementCashRegisterTerminals.installationId, installationId),
              ),
            );
        }
        const [binding] = await tx
          .select({ cashRegisterId: managementCashRegisterTerminals.cashRegisterId })
          .from(managementCashRegisterTerminals)
          .where(
            and(
              eq(managementCashRegisterTerminals.organizationId, organizationId),
              eq(managementCashRegisterTerminals.unitId, unitId),
              eq(managementCashRegisterTerminals.installationId, installationId),
            ),
          )
          .limit(1);
        const metadata = {
          installationId,
          ...profileInput,
          cashRegisterId: binding?.cashRegisterId ?? null,
        };
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: "pos.terminal_profile_changed",
          entityType: "terminal_profile",
          entityId: installationId,
          metadata,
        });
        await tx.insert(outboxEvents).values({
          topic: "pos.terminal_profile_changed",
          aggregateType: "terminal_profile",
          aggregateId: installationId,
          payload: { organizationId, unitId, ...metadata },
        });
        return { ...profile, cashRegisterId: binding?.cashRegisterId ?? null };
      },
    );
  }

  private async approve(
    tx: Transaction,
    requestedByIdentityId: string,
    organizationId: string,
    unitId: string,
    action: "discount" | "cancel",
    entityType: string,
    entityId: string,
    input: { approverMembershipId: string; pin: string; reason: string },
    approvalId?: string,
  ) {
    const [approver] = await tx
      .select({
        membershipId: memberships.id,
        pinHash: posManagerPins.pinHash,
      })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .innerJoin(posManagerPins, eq(posManagerPins.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.id, input.approverMembershipId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          eq(posManagerPins.organizationId, organizationId),
          eq(posManagerPins.active, true),
          inArray(roleBindings.role, ["owner", "manager"]),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!approver || !(await argon2.verify(approver.pinHash, input.pin))) {
      throw new ForbiddenException({
        code: "INVALID_MANAGER_APPROVAL",
        message: "Aprovação gerencial inválida.",
      });
    }
    const [approval] = await tx
      .insert(posOperationApprovals)
      .values({
        id: approvalId,
        organizationId,
        unitId,
        action,
        entityType,
        entityId,
        requestedByIdentityId,
        approvedByMembershipId: approver.membershipId,
        reason: input.reason,
      })
      .returning();
    if (!approval) throw new Error("Approval insert did not return a row");
    return approval;
  }

  private async getScopedItem(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    itemId: string,
  ) {
    const findItem = () =>
      tx
        .select({ item: posOrderItems, tabId: posOrders.tabId })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posOrderItems.id, itemId),
          ),
        )
        .limit(1);
    const [initial] = await findItem();
    if (!initial) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    await this.requireOpenTab(tx, organizationId, unitId, initial.tabId);
    const [row] = await findItem();
    if (!row) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    if (row.tabId !== initial.tabId) {
      throw new ConflictException({
        code: "ORDER_ITEM_CHANGED",
        message: "O item mudou de comanda. Recarregue antes de continuar.",
      });
    }
    assertTenantScope({ organizationId, unitId }, row.item);
    return row;
  }

  private async findSingleTabGroup(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tableId: string,
  ) {
    const [group] = await tx
      .select({
        id: posDiningTableGroups.id,
        primaryTabId: posDiningTableGroups.primaryTabId,
      })
      .from(posDiningTableGroupMembers)
      .innerJoin(
        posDiningTableGroups,
        and(
          eq(posDiningTableGroups.organizationId, posDiningTableGroupMembers.organizationId),
          eq(posDiningTableGroups.unitId, posDiningTableGroupMembers.unitId),
          eq(posDiningTableGroups.id, posDiningTableGroupMembers.groupId),
        ),
      )
      .where(
        and(
          eq(posDiningTableGroupMembers.organizationId, organizationId),
          eq(posDiningTableGroupMembers.unitId, unitId),
          eq(posDiningTableGroupMembers.tableId, tableId),
          eq(posDiningTableGroups.mode, "single_tab"),
          isNull(posDiningTableGroups.dissolvedAt),
        ),
      )
      .limit(1);
    if (!group) return null;
    const members = await tx
      .select({ tableId: posDiningTableGroupMembers.tableId })
      .from(posDiningTableGroupMembers)
      .where(
        and(
          eq(posDiningTableGroupMembers.organizationId, organizationId),
          eq(posDiningTableGroupMembers.unitId, unitId),
          eq(posDiningTableGroupMembers.groupId, group.id),
        ),
      );
    return { ...group, tableIds: members.map((member) => member.tableId) };
  }

  private async requireTab(tx: Transaction, organizationId: string, unitId: string, tabId: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pos-tab:${organizationId}:${unitId}:${tabId}`}))`,
    );
    const [tab] = await tx
      .select()
      .from(posTabs)
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      )
      .limit(1);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    assertTenantScope({ organizationId, unitId }, tab);
    return tab;
  }

  private async requireOpenTab(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const tab = await this.requireTab(tx, organizationId, unitId, tabId);
    if (tab.status !== "open")
      throw new ConflictException({ code: "TAB_NOT_OPEN", status: tab.status });
    return tab;
  }

  private async resolvePrintTarget(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    input: Pick<PrintJobInput, "installationId" | "terminalId" | "printerId">,
  ) {
    const cashierActor = await this.canOperateCashier(identityId, organizationId, unitId);
    if (!input.installationId) {
      return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
    }

    const [profile] = await tx
      .select()
      .from(posTerminalProfiles)
      .where(
        and(
          eq(posTerminalProfiles.organizationId, organizationId),
          eq(posTerminalProfiles.unitId, unitId),
          eq(posTerminalProfiles.installationId, input.installationId),
        ),
      )
      .limit(1);
    if (!profile || profile.paymentMode === "disabled") {
      return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
    }
    if (!profile.printerId || (input.printerId && input.printerId !== profile.printerId)) {
      return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
    }
    if (profile.paymentMode === "cashier") {
      if (!cashierActor) {
        return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
      }
      return {
        deliveryRoute: "local" as const,
        terminalId: input.terminalId ?? profile.installationId,
        printerId: profile.printerId,
      };
    }
    if (profile.paymentMode !== "homologated_pos" || profile.paymentStatus !== "homologated") {
      return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
    }
    const capability = await this.paymentCapability(
      tx,
      organizationId,
      unitId,
      profile.installationId,
    );
    if (!capability.available) {
      return { deliveryRoute: "cashier" as const, terminalId: null, printerId: null };
    }
    return {
      deliveryRoute: "local" as const,
      terminalId: input.terminalId ?? profile.installationId,
      printerId: profile.printerId,
    };
  }

  private async queuePrintJob(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    input: PrintJobInput,
    splitPart?: {
      id: string;
      splitId: string;
      partNumber: number;
      partCount: number;
      amountCents: number;
      balanceSnapshotCents: number;
      method: string;
    },
  ) {
    const tab = await this.requireTab(tx, organizationId, unitId, tabId);
    const target = await this.resolvePrintTarget(tx, identityId, organizationId, unitId, input);
    if (input.documentType === "final_receipt" && tab.status !== "closed") {
      throw new ConflictException({
        code: "FINAL_RECEIPT_REQUIRES_CLOSED_TAB",
        message: "O comprovante final só pode ser emitido após o encerramento da comanda.",
      });
    }
    if (input.serviceCallId) {
      const [call] = await tx
        .select({
          id: posServiceCalls.id,
          tabId: posServiceCalls.tabId,
          tableId: posServiceCalls.tableId,
          kind: posServiceCalls.kind,
          status: posServiceCalls.status,
        })
        .from(posServiceCalls)
        .where(
          and(
            eq(posServiceCalls.organizationId, organizationId),
            eq(posServiceCalls.unitId, unitId),
            eq(posServiceCalls.id, input.serviceCallId),
          ),
        )
        .for("update")
        .limit(1);
      if (!call) throw new NotFoundException({ code: "SERVICE_CALL_NOT_FOUND" });
      if (
        call.kind !== "bill" ||
        call.status === "resolved" ||
        call.tabId !== tabId ||
        call.tableId !== tab.tableId
      ) {
        throw new ConflictException({ code: "PRINT_SERVICE_CALL_MISMATCH" });
      }
    }
    const basePayload = await this.buildPrintDocumentPayload(tx, organizationId, unitId, tab);
    const payload = splitPart
      ? {
          ...basePayload,
          split: {
            splitId: splitPart.splitId,
            partNumber: splitPart.partNumber,
            partCount: splitPart.partCount,
            amountCents: splitPart.amountCents,
            balanceSnapshotCents: splitPart.balanceSnapshotCents,
            method: splitPart.method,
          },
        }
      : basePayload;
    const [printJob] = await tx
      .insert(posPrintJobs)
      .values({
        organizationId,
        unitId,
        tabId,
        serviceCallId: input.serviceCallId,
        splitPartId: splitPart?.id,
        documentType: input.documentType,
        copies: input.copies,
        terminalId: target.terminalId,
        printerId: target.printerId,
        payload: payload as unknown as Record<string, unknown>,
        requestedByIdentityId: identityId,
        reason: input.reason,
      })
      .returning();
    if (!printJob) throw new Error("Print job insert did not return a row");
    if (input.serviceCallId) {
      await tx
        .update(posServiceCalls)
        .set({
          status: "acknowledged",
          acknowledgedByIdentityId: identityId,
          acknowledgedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(posServiceCalls.id, input.serviceCallId));
    }
    await this.recordEvent(
      tx,
      identityId,
      organizationId,
      unitId,
      tabId,
      "print.queued",
      {
        printJobId: printJob.id,
        documentType: printJob.documentType,
        copies: printJob.copies,
        terminalId: printJob.terminalId,
        printerId: printJob.printerId,
        deliveryRoute: target.deliveryRoute,
      },
      { entityType: "print_job", entityId: printJob.id },
    );
    return { ...printJob, deliveryRoute: target.deliveryRoute };
  }

  private async buildPrintDocumentPayload(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tab: typeof posTabs.$inferSelect,
  ): Promise<PrintDocumentPayloadV2> {
    const [table, items, payments, establishment, responsible, shiftSection] = await Promise.all([
      tab.tableId
        ? tx
            .select({ label: posDiningTables.label, areaName: posDiningRooms.name })
            .from(posDiningTables)
            .innerJoin(
              posDiningRooms,
              and(
                eq(posDiningRooms.organizationId, posDiningTables.organizationId),
                eq(posDiningRooms.unitId, posDiningTables.unitId),
                eq(posDiningRooms.id, posDiningTables.roomId),
              ),
            )
            .where(
              and(
                eq(posDiningTables.organizationId, organizationId),
                eq(posDiningTables.unitId, unitId),
                eq(posDiningTables.id, tab.tableId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      tx
        .select({
          id: posOrderItems.id,
          orderId: posOrderItems.orderId,
          productName: posOrderItems.productName,
          quantity: posOrderItems.quantity,
          unitPriceCents: posOrderItems.unitPriceCents,
          modifiersCents: posOrderItems.modifiersCents,
          grossCents: posOrderItems.grossCents,
          discountCents: posOrderItems.discountCents,
          netCents: posOrderItems.netCents,
          status: posOrderItems.status,
          seatNumber: posOrderItems.seatNumber,
          course: posOrderItems.course,
        })
        .from(posOrderItems)
        .innerJoin(
          posOrders,
          and(
            eq(posOrders.organizationId, posOrderItems.organizationId),
            eq(posOrders.unitId, posOrderItems.unitId),
            eq(posOrders.id, posOrderItems.orderId),
          ),
        )
        .where(
          and(
            eq(posOrderItems.organizationId, organizationId),
            eq(posOrderItems.unitId, unitId),
            eq(posOrders.tabId, tab.id),
          ),
        ),
      tx
        .select({
          id: posTabPayments.id,
          method: posTabPayments.method,
          amountCents: posTabPayments.amountCents,
          createdAt: posTabPayments.createdAt,
          reversedCents: sql<number>`coalesce(sum(${posPaymentReversals.amountCents}), 0)`.mapWith(
            Number,
          ),
        })
        .from(posTabPayments)
        .leftJoin(
          posPaymentReversals,
          and(
            eq(posPaymentReversals.organizationId, posTabPayments.organizationId),
            eq(posPaymentReversals.unitId, posTabPayments.unitId),
            eq(posPaymentReversals.paymentId, posTabPayments.id),
            eq(posPaymentReversals.status, "approved"),
          ),
        )
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            eq(posTabPayments.tabId, tab.id),
          ),
        )
        .groupBy(
          posTabPayments.id,
          posTabPayments.method,
          posTabPayments.amountCents,
          posTabPayments.createdAt,
        ),
      tx
        .select({
          unitName: units.name,
          timezone: units.timezone,
          legalName: organizations.legalName,
          tradeName: organizations.tradeName,
          document: organizations.document,
          branding: posCatalogBranding.config,
        })
        .from(units)
        .innerJoin(organizations, eq(organizations.id, units.organizationId))
        .leftJoin(
          posCatalogBranding,
          and(
            eq(posCatalogBranding.organizationId, units.organizationId),
            eq(posCatalogBranding.unitId, units.id),
          ),
        )
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tab.responsibleIdentityId
        ? tx
            .select({ id: identities.id, displayName: identities.displayName })
            .from(identities)
            .where(eq(identities.id, tab.responsibleIdentityId))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      tab.shiftSectionId
        ? tx
            .select({ id: posShiftSections.id, name: posShiftSections.name })
            .from(posShiftSections)
            .where(
              and(
                eq(posShiftSections.organizationId, organizationId),
                eq(posShiftSections.unitId, unitId),
                eq(posShiftSections.id, tab.shiftSectionId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);
    const itemIds = items.map((item) => item.id);
    const modifiers =
      itemIds.length === 0
        ? []
        : await tx
            .select({
              orderItemId: posOrderItemModifiers.orderItemId,
              name: posOrderItemModifiers.name,
              quantity: posOrderItemModifiers.quantity,
              unitDeltaCents: posOrderItemModifiers.unitDeltaCents,
              totalDeltaCents: posOrderItemModifiers.totalDeltaCents,
            })
            .from(posOrderItemModifiers)
            .where(
              and(
                eq(posOrderItemModifiers.organizationId, organizationId),
                eq(posOrderItemModifiers.unitId, unitId),
                inArray(posOrderItemModifiers.orderItemId, itemIds),
              ),
            );
    const grossPaidCents = payments.reduce((total, payment) => total + payment.amountCents, 0);
    const reversedCents = payments.reduce((total, payment) => total + payment.reversedCents, 0);
    const paidCents = grossPaidCents - reversedCents;
    const generatedAt = new Date();
    const fallbackName = establishment?.tradeName ?? establishment?.unitName ?? "Estabelecimento";
    const presentation = normalizeStoredBranding(
      establishment?.branding,
      fallbackName,
    ).presentation;
    const durationMinutes = Math.max(
      0,
      Math.floor(((tab.closedAt ?? generatedAt).getTime() - tab.createdAt.getTime()) / 60_000),
    );
    return {
      schemaVersion: 2,
      generatedAt: generatedAt.toISOString(),
      establishment: {
        displayName: presentation.displayName,
        legalName: establishment?.legalName ?? fallbackName,
        document: establishment?.document ?? null,
        address: presentation.address,
        phone: presentation.phone,
        openingHours: presentation.openingHours,
        timezone: establishment?.timezone ?? "America/Sao_Paulo",
        logoUrl: presentation.logoUrl,
      },
      context: {
        tabId: tab.id,
        label:
          table?.label ??
          tab.label ??
          (tab.displayNumber ? `Balcão #${tab.displayNumber}` : `Comanda ${tab.id.slice(0, 6)}`),
        displayNumber: tab.displayNumber,
        tableLabel: table?.label ?? null,
        areaName: table?.areaName ?? null,
        squareName: shiftSection?.name ?? null,
        waiterDisplayName: responsible?.displayName ?? null,
        fulfillmentType: tab.fulfillmentType,
        guestCount: tab.guestCount,
        status: tab.status,
        openedAt: tab.createdAt.toISOString(),
        closedAt: tab.closedAt?.toISOString() ?? null,
        durationMinutes,
      },
      totals: {
        subtotalCents: tab.subtotalCents,
        discountCents: tab.discountCents,
        serviceChargeCents: tab.serviceChargeCents,
        serviceChargeBasisPoints: tab.serviceChargeBasisPoints,
        serviceChargeOptional: tab.serviceChargeBasisPoints > 0,
        suggestedTotalCents: tab.totalCents,
        serviceTaxNotice: presentation.serviceTaxNotice,
        tipCents: tab.tipCents,
        totalCents: tab.totalCents,
        grossPaidCents,
        reversedCents,
        paidCents,
        remainingCents: Math.max(0, tab.totalCents - paidCents),
      },
      items: items.map((item) => ({
        ...item,
        modifiers: modifiers
          .filter((modifier) => modifier.orderItemId === item.id)
          .map(({ orderItemId: _orderItemId, ...modifier }) => modifier),
      })),
      payments: payments
        .map((payment) => ({
          id: payment.id,
          method: payment.method,
          amountCents: payment.amountCents - payment.reversedCents,
          financialStatus: "posted" as const,
          createdAt: payment.createdAt.toISOString(),
        }))
        .filter((payment) => payment.amountCents > 0),
    };
  }

  private async recalculateTab(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const paymentState = await this.lockTabPaymentState(tx, organizationId, unitId, tabId);
    const [[tab], [settings]] = await Promise.all([
      tx
        .select({
          serviceChargeBasisPoints: posTabs.serviceChargeBasisPoints,
          tipCents: posTabs.tipCents,
        })
        .from(posTabs)
        .where(
          and(
            eq(posTabs.organizationId, organizationId),
            eq(posTabs.unitId, unitId),
            eq(posTabs.id, tabId),
          ),
        )
        .limit(1),
      tx
        .select({ configuration: managementSettlementSettings.configuration })
        .from(managementSettlementSettings)
        .where(
          and(
            eq(managementSettlementSettings.organizationId, organizationId),
            eq(managementSettlementSettings.unitId, unitId),
          ),
        )
        .limit(1),
    ]);
    if (!tab) throw new NotFoundException({ code: "TAB_NOT_FOUND" });
    const items = await tx
      .select({
        grossCents: posOrderItems.grossCents,
        discountCents: posOrderItems.discountCents,
        status: posOrderItems.status,
      })
      .from(posOrderItems)
      .innerJoin(
        posOrders,
        and(
          eq(posOrders.organizationId, posOrderItems.organizationId),
          eq(posOrders.unitId, posOrderItems.unitId),
          eq(posOrders.id, posOrderItems.orderId),
        ),
      )
      .where(
        and(
          eq(posOrderItems.organizationId, organizationId),
          eq(posOrderItems.unitId, unitId),
          eq(posOrders.tabId, tabId),
          or(ne(posOrders.source, "qr_table"), ne(posOrders.status, "draft")),
        ),
      );
    const totals = tabTotals(
      items.map((item) => ({
        grossCents: item.grossCents,
        discountCents: item.discountCents,
        canceled: item.status === "canceled",
      })),
      tab.serviceChargeBasisPoints,
      tab.tipCents,
      settings?.configuration.serviceBase ?? "net_after_discounts",
    );
    this.assertTabPaymentFloor(totals.totalCents, paymentState);
    await tx
      .update(posTabs)
      .set({ ...totals, updatedAt: new Date() })
      .where(
        and(
          eq(posTabs.organizationId, organizationId),
          eq(posTabs.unitId, unitId),
          eq(posTabs.id, tabId),
        ),
      );
    return totals;
  }

  private async idempotent<T extends JsonResponse>(
    identityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    operation: string,
    input: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    if (!key || key.trim().length < 8 || key.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    const normalizedKey = key.trim();
    const hash = requestHash(operation, input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-idem:${organizationId}:${unitId}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          actorIdentityId: posIdempotencyReceipts.actorIdentityId,
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, organizationId),
            eq(posIdempotencyReceipts.unitId, unitId),
            eq(posIdempotencyReceipts.key, normalizedKey),
          ),
        )
        .limit(1);
      const replay = replayResult<T>(existing, operation, hash, identityId);
      if (replay) return replay;
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(posIdempotencyReceipts).values({
        id: randomUUID(),
        organizationId,
        unitId,
        actorIdentityId: identityId,
        key: normalizedKey,
        operation,
        requestHash: hash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  private async recordPaymentReversalResultIncident(
    tx: Transaction,
    incident: {
      organizationId: string;
      unitId: string;
      actorIdentityId: string;
      reversalId: string;
      paymentId: string;
      paymentAttemptId: string;
      installationId: string;
      currentStatus: string;
      reportedStatus: string;
      resultId: string;
      resultHash: string;
      failureCode: string | null;
    },
  ) {
    if (
      await this.hasRecordedPaymentResultIncident(
        tx,
        incident.organizationId,
        incident.unitId,
        "pos.payment.reversal_result_conflict",
        incident.reversalId,
        incident.resultHash,
      )
    ) {
      return;
    }
    const [payment] = await tx
      .select({ tabId: posTabPayments.tabId })
      .from(posTabPayments)
      .where(
        and(
          eq(posTabPayments.organizationId, incident.organizationId),
          eq(posTabPayments.unitId, incident.unitId),
          eq(posTabPayments.id, incident.paymentId),
        ),
      )
      .limit(1);
    if (!payment) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
    await this.recordEvent(
      tx,
      incident.actorIdentityId,
      incident.organizationId,
      incident.unitId,
      payment.tabId,
      "payment.reversal_result_conflict",
      {
        reversalId: incident.reversalId,
        paymentId: incident.paymentId,
        paymentAttemptId: incident.paymentAttemptId,
        installationId: incident.installationId,
        currentStatus: incident.currentStatus,
        reportedStatus: incident.reportedStatus,
        resultId: incident.resultId,
        requestHash: incident.resultHash,
        failureCode: incident.failureCode,
      },
      { entityType: "payment_reversal", entityId: incident.reversalId },
    );
  }

  private async hasRecordedPaymentResultIncident(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    action: string,
    entityId: string,
    resultHash: string,
  ) {
    const [incident] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.unitId, unitId),
          eq(auditEvents.action, action),
          eq(auditEvents.entityId, entityId),
          sql`${auditEvents.metadata}->>'requestHash' = ${resultHash}`,
        ),
      )
      .limit(1);
    return Boolean(incident);
  }

  private async earnLoyaltyForClosedTab(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    paidCents: number,
    closedAt: Date,
  ) {
    const [link] = await tx
      .select({ customerId: posTabCustomerLinks.customerId })
      .from(posTabCustomerLinks)
      .where(
        and(
          eq(posTabCustomerLinks.organizationId, organizationId),
          eq(posTabCustomerLinks.unitId, unitId),
          eq(posTabCustomerLinks.tabId, tabId),
        ),
      )
      .limit(1);
    if (!link) return null;
    const [program] = await tx
      .select()
      .from(loyaltyPrograms)
      .where(
        and(eq(loyaltyPrograms.organizationId, organizationId), eq(loyaltyPrograms.active, true)),
      )
      .limit(1);
    if (!program) return null;
    const amount = loyaltyEarn(
      program.mode,
      Number(program.rate),
      paidCents,
      program.minimumOrderCents,
    );
    if (amount <= 0) return null;
    const idempotencyKey = `pos-tab-close:${tabId}:${closedAt.toISOString()}`;
    const [entry] = await tx
      .insert(loyaltyLedger)
      .values({
        organizationId,
        unitId,
        programId: program.id,
        customerId: link.customerId,
        sourceRef: tabId,
        type: "earn",
        amount,
        description: "Crédito automático pelo atendimento encerrado",
        idempotencyKey,
        requestFingerprint: requestHash("loyalty.earn.tab", {
          organizationId,
          unitId,
          tabId,
          customerId: link.customerId,
          paidCents,
          programId: program.id,
          amount,
        }),
        expiresAt: program.expiresAfterDays
          ? new Date(closedAt.getTime() + program.expiresAfterDays * 86_400_000)
          : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!entry) return null;
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: "growth.loyalty.earned",
      entityType: "growth_loyalty_entry",
      entityId: entry.id,
      metadata: { tabId, customerId: link.customerId, paidCents, amount },
    });
    await tx.insert(outboxEvents).values({
      topic: "growth.loyalty_earned",
      aggregateType: "growth_loyalty_entry",
      aggregateId: entry.id,
      payload: { organizationId, unitId, tabId, customerId: link.customerId, amount },
    });
    return entry;
  }

  private async reverseLoyaltyForReopenedTab(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
  ) {
    const [earned] = await tx
      .select()
      .from(loyaltyLedger)
      .where(
        and(
          eq(loyaltyLedger.organizationId, organizationId),
          eq(loyaltyLedger.unitId, unitId),
          eq(loyaltyLedger.sourceRef, tabId),
          eq(loyaltyLedger.type, "earn"),
          sql`not exists (
            select 1 from growth_loyalty_ledger reversal
            where reversal.organization_id = ${organizationId}
              and reversal.reversal_of_id = ${loyaltyLedger.id}
          )`,
        ),
      )
      .orderBy(desc(loyaltyLedger.createdAt))
      .limit(1)
      .for("update");
    if (!earned) return null;
    const [reversal] = await tx
      .insert(loyaltyLedger)
      .values({
        organizationId,
        unitId,
        programId: earned.programId,
        customerId: earned.customerId,
        sourceRef: tabId,
        type: "reverse",
        amount: -earned.amount,
        description: "Estorno automático pela reabertura do atendimento",
        idempotencyKey: `pos-tab-reopen:${tabId}:${earned.id}`,
        requestFingerprint: requestHash("loyalty.reverse.tab", { tabId, entryId: earned.id }),
        reversalOfId: earned.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!reversal) return null;
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: "growth.loyalty.reversed",
      entityType: "growth_loyalty_entry",
      entityId: reversal.id,
      metadata: { tabId, customerId: earned.customerId, reversalOfId: earned.id },
    });
    await tx.insert(outboxEvents).values({
      topic: "growth.loyalty_reversed",
      aggregateType: "growth_loyalty_entry",
      aggregateId: reversal.id,
      payload: {
        organizationId,
        unitId,
        tabId,
        customerId: earned.customerId,
        reversalOfId: earned.id,
      },
    });
    return reversal;
  }

  private async recordEvent(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    type: string,
    payload: Record<string, unknown>,
    subject?: { entityType: string; entityId: string },
  ) {
    await tx.insert(posTabEvents).values({
      organizationId,
      unitId,
      tabId,
      actorIdentityId,
      type,
      payload,
    });
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `pos.${type}`,
      entityType: subject?.entityType ?? "tab",
      entityId: subject?.entityId ?? tabId,
      metadata: payload,
    });
    await tx.insert(outboxEvents).values({
      topic: `pos.${type}`,
      aggregateType: subject?.entityType ?? "tab",
      aggregateId: subject?.entityId ?? tabId,
      payload: { organizationId, unitId, tabId, ...payload },
    });
  }
}
