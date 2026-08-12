import { createHash } from "node:crypto";
import {
  areaAssignments,
  type Database,
  memberships,
  outboxEvents,
  posOrderItems,
  posOrders,
  posTabs,
  publicTableServiceSettings,
  publicTableSessionRateLimits,
  roleBindings,
  serviceShifts,
  staffPresenceLeases,
  tableLayoutNodes,
  tableLayoutVersions,
  tableOccupancies,
  tableServiceCallEvents,
  tableServiceCallReceipts,
  tableServiceCalls,
} from "@giromesa/db";
import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { TableSessionService } from "./table-session.js";

type CallKind = "waiter" | "bill";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function tableCallFingerprint(kind: CallKind, occupancyId: string, occupancyEpoch: string) {
  return fingerprint({ kind, occupancyId, occupancyEpoch });
}

function conflict(code: string, message: string) {
  return new ConflictException({ code, message });
}

@Injectable()
export class TableServiceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: TableSessionService,
    private readonly scope: ScopeService,
    private readonly realtime?: RealtimeService,
  ) {}

  async request(
    slug: string,
    token: string,
    requestNonce: string,
    idempotencyKey: string,
    kind: CallKind,
  ) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw conflict("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key inválida.");
    }
    const result = await this.database.db.transaction(async (tx) => {
      const capability = kind === "waiter" ? "call_waiter" : "request_bill";
      const claims = await this.sessions.validate(slug, token, capability, tx);
      const requestHash = tableCallFingerprint(kind, claims.occupancyId, claims.occupancyEpoch);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`table-call:${claims.organizationId}:${claims.unitId}:${claims.occupancyId}:${claims.occupancyEpoch}:${kind}`}))`,
      );
      const [receipt] = await tx
        .select()
        .from(tableServiceCallReceipts)
        .where(
          and(
            eq(tableServiceCallReceipts.sessionId, claims.sessionId),
            eq(tableServiceCallReceipts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (receipt) {
        if (receipt.requestHash !== requestHash) {
          throw conflict("IDEMPOTENCY_KEY_REUSED", "A chave já foi usada para outro chamado.");
        }
        const [knownCall] = await tx
          .select()
          .from(tableServiceCalls)
          .where(eq(tableServiceCalls.id, receipt.callId))
          .limit(1);
        if (!knownCall) throw new Error("TABLE_SERVICE_RECEIPT_CALL_NOT_FOUND");
        return {
          call: knownCall,
          idempotentReplay: true,
          cooldownDeduplicated: receipt.cooldownDeduplicated,
          notify: false,
        };
      }

      await this.enforceCallRateLimit(claims, tx);
      await this.sessions.consumeRequestNonce(claims, requestNonce, `call:${kind}`, tx);
      const [cooldown] = await tx
        .select()
        .from(tableServiceCalls)
        .where(
          and(
            eq(tableServiceCalls.organizationId, claims.organizationId),
            eq(tableServiceCalls.unitId, claims.unitId),
            eq(tableServiceCalls.occupancyId, claims.occupancyId),
            eq(tableServiceCalls.occupancyEpoch, claims.occupancyEpoch),
            eq(tableServiceCalls.kind, kind),
            inArray(tableServiceCalls.state, ["received", "routed"]),
            gt(tableServiceCalls.createdAt, new Date(Date.now() - 90_000)),
          ),
        )
        .orderBy(desc(tableServiceCalls.createdAt))
        .limit(1);
      if (cooldown) {
        await tx.insert(tableServiceCallReceipts).values({
          organizationId: claims.organizationId,
          unitId: claims.unitId,
          sessionId: claims.sessionId,
          callId: cooldown.id,
          idempotencyKey,
          requestHash,
          cooldownDeduplicated: true,
        });
        return {
          call: cooldown,
          idempotentReplay: false,
          cooldownDeduplicated: true,
          notify: false,
        };
      }

      const route = await this.resolveRoute(
        claims.organizationId,
        claims.unitId,
        claims.tableId,
        tx,
      );
      const state = route.identityId ? "routed" : "received";
      const now = new Date();
      const [created] = await tx
        .insert(tableServiceCalls)
        .values({
          organizationId: claims.organizationId,
          unitId: claims.unitId,
          sessionId: claims.sessionId,
          occupancyId: claims.occupancyId,
          occupancyEpoch: claims.occupancyEpoch,
          tableId: claims.tableId,
          kind,
          state,
          routedIdentityId: route.identityId,
          routeSource: route.source,
          idempotencyKey,
          requestHash,
          routedAt: route.identityId ? now : null,
        })
        .returning();
      if (!created) throw new Error("TABLE_SERVICE_CALL_NOT_CREATED");
      await tx.insert(tableServiceCallReceipts).values({
        organizationId: claims.organizationId,
        unitId: claims.unitId,
        sessionId: claims.sessionId,
        callId: created.id,
        idempotencyKey,
        requestHash,
      });
      await tx.insert(tableServiceCallEvents).values([
        {
          organizationId: claims.organizationId,
          unitId: claims.unitId,
          callId: created.id,
          sequence: 1,
          state: "received",
          metadata: { kind },
        },
        ...(state === "routed"
          ? [
              {
                organizationId: claims.organizationId,
                unitId: claims.unitId,
                callId: created.id,
                sequence: 2,
                state: "routed" as const,
                metadata: { routeSource: route.source, routedIdentityId: route.identityId },
              },
            ]
          : []),
      ]);
      await tx.insert(outboxEvents).values({
        organizationId: claims.organizationId,
        unitId: claims.unitId,
        topic: `table_service_call.${state}`,
        aggregateType: "table_service_call",
        aggregateId: created.id,
        occupancyEpoch: claims.occupancyEpoch,
        resourceVersion: 0,
        payload: {
          organizationId: claims.organizationId,
          unitId: claims.unitId,
          tableId: claims.tableId,
          callId: created.id,
          kind,
          state,
          routeSource: route.source,
          routedIdentityId: route.identityId,
        },
      });
      return {
        call: created,
        idempotentReplay: false,
        cooldownDeduplicated: false,
        notify: true,
      };
    });
    if (result.notify) {
      this.realtime?.publishTableServiceCall({
        organizationId: result.call.organizationId,
        unitId: result.call.unitId,
        callId: result.call.id,
        tableId: result.call.tableId,
        occupancyEpoch: result.call.occupancyEpoch,
        state: result.call.state,
        routeSource: result.call.routeSource,
      });
    }
    return {
      call: result.call,
      idempotentReplay: result.idempotentReplay,
      cooldownDeduplicated: result.cooldownDeduplicated,
    };
  }

  async partial(slug: string, token: string) {
    return this.database.db.transaction(async (tx) => {
      const claims = await this.sessions.validate(slug, token, "view_partial", tx);
      const [tab] = await tx
        .select({
          id: posTabs.id,
          guestCount: posTabs.guestCount,
          subtotalCents: posTabs.subtotalCents,
          discountCents: posTabs.discountCents,
          serviceChargeCents: posTabs.serviceChargeCents,
          tipCents: posTabs.tipCents,
          totalCents: posTabs.totalCents,
        })
        .from(posTabs)
        .innerJoin(tableOccupancies, eq(tableOccupancies.tabId, posTabs.id))
        .where(
          and(
            eq(posTabs.organizationId, claims.organizationId),
            eq(posTabs.unitId, claims.unitId),
            eq(posTabs.tableId, claims.tableId),
            eq(posTabs.status, "open"),
            eq(tableOccupancies.id, claims.occupancyId),
            eq(tableOccupancies.occupancyEpoch, claims.occupancyEpoch),
            inArray(tableOccupancies.state, ["open", "paying"]),
          ),
        )
        .limit(1);
      if (!tab)
        throw new NotFoundException({
          code: "CURRENT_OCCUPANCY_TAB_NOT_FOUND",
          message: "Comanda atual não encontrada.",
        });
      const items = await tx
        .select({
          id: posOrderItems.id,
          productName: posOrderItems.productName,
          quantity: posOrderItems.quantity,
          netCents: posOrderItems.netCents,
          status: posOrderItems.status,
        })
        .from(posOrderItems)
        .innerJoin(posOrders, eq(posOrders.id, posOrderItems.orderId))
        .where(
          and(
            eq(posOrders.organizationId, claims.organizationId),
            eq(posOrders.unitId, claims.unitId),
            eq(posOrders.tabId, tab.id),
          ),
        );
      return { occupancyId: claims.occupancyId, occupancyEpoch: claims.occupancyEpoch, tab, items };
    });
  }

  async capabilitySettings(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    const [settings] = await this.database.db
      .select()
      .from(publicTableServiceSettings)
      .where(
        and(
          eq(publicTableServiceSettings.organizationId, organizationId),
          eq(publicTableServiceSettings.unitId, unitId),
        ),
      )
      .limit(1);
    return (
      settings ?? {
        organizationId,
        unitId,
        callWaiterEnabled: false,
        requestBillEnabled: false,
        viewPartialEnabled: false,
        resourceVersion: 0,
      }
    );
  }

  async configureCapabilities(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: {
      callWaiterEnabled: boolean;
      requestBillEnabled: boolean;
      viewPartialEnabled: boolean;
      expectedResourceVersion: number;
    },
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`table-capabilities:${organizationId}:${unitId}`}))`,
      );
      if (input.expectedResourceVersion === 0) {
        const [created] = await tx
          .insert(publicTableServiceSettings)
          .values({
            organizationId,
            unitId,
            callWaiterEnabled: input.callWaiterEnabled,
            requestBillEnabled: input.requestBillEnabled,
            viewPartialEnabled: input.viewPartialEnabled,
            resourceVersion: 1,
            updatedByIdentityId: identityId,
          })
          .onConflictDoNothing()
          .returning();
        if (created) return created;
      }
      const [updated] = await tx
        .update(publicTableServiceSettings)
        .set({
          callWaiterEnabled: input.callWaiterEnabled,
          requestBillEnabled: input.requestBillEnabled,
          viewPartialEnabled: input.viewPartialEnabled,
          resourceVersion: input.expectedResourceVersion + 1,
          updatedByIdentityId: identityId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(publicTableServiceSettings.organizationId, organizationId),
            eq(publicTableServiceSettings.unitId, unitId),
            eq(publicTableServiceSettings.resourceVersion, input.expectedResourceVersion),
          ),
        )
        .returning();
      if (!updated) {
        throw conflict(
          "TABLE_CAPABILITIES_VERSION_CONFLICT",
          "As permissões da mesa mudaram em outro dispositivo.",
        );
      }
      return updated;
    });
  }

  async attend(
    identityId: string,
    organizationId: string,
    unitId: string,
    callId: string,
    expectedVersion: number,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
    ]);
    const [attended] = await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(tableServiceCalls)
        .set({
          state: "attended",
          attendedByIdentityId: identityId,
          attendedAt: new Date(),
          updatedAt: new Date(),
          resourceVersion: sql`${tableServiceCalls.resourceVersion} + 1`,
        })
        .where(
          and(
            eq(tableServiceCalls.id, callId),
            eq(tableServiceCalls.organizationId, organizationId),
            eq(tableServiceCalls.unitId, unitId),
            inArray(tableServiceCalls.state, ["received", "routed"]),
            eq(tableServiceCalls.resourceVersion, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw conflict("TABLE_SERVICE_CALL_VERSION_CONFLICT", "Chamado já alterado.");
      const [last] = await tx
        .select({ sequence: tableServiceCallEvents.sequence })
        .from(tableServiceCallEvents)
        .where(eq(tableServiceCallEvents.callId, callId))
        .orderBy(desc(tableServiceCallEvents.sequence))
        .limit(1);
      await tx.insert(tableServiceCallEvents).values({
        organizationId,
        unitId,
        callId,
        sequence: (last?.sequence ?? 0) + 1,
        state: "attended",
        actorIdentityId: identityId,
      });
      return [updated];
    });
    if (!attended) throw new Error("TABLE_SERVICE_CALL_NOT_ATTENDED");
    this.realtime?.publishTableServiceCall({
      organizationId,
      unitId,
      callId,
      tableId: attended.tableId,
      occupancyEpoch: attended.occupancyEpoch,
      state: "attended",
      routeSource: attended.routeSource,
    });
    return attended;
  }

  private async enforceCallRateLimit(
    claims: { organizationId: string; unitId: string; menuId: string; sessionId: string },
    tx: Transaction,
  ) {
    const windowStartedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const [bucket] = await tx
      .insert(publicTableSessionRateLimits)
      .values({
        organizationId: claims.organizationId,
        unitId: claims.unitId,
        menuId: claims.menuId,
        bucketHash: fingerprint(`table-call:${claims.sessionId}`),
        windowStartedAt,
        expiresAt: new Date(windowStartedAt.getTime() + 2 * 60_000),
      })
      .onConflictDoUpdate({
        target: [
          publicTableSessionRateLimits.menuId,
          publicTableSessionRateLimits.bucketHash,
          publicTableSessionRateLimits.windowStartedAt,
        ],
        set: { requestCount: sql`${publicTableSessionRateLimits.requestCount} + 1` },
      })
      .returning({ requestCount: publicTableSessionRateLimits.requestCount });
    if (bucket && bucket.requestCount > 8) {
      throw new HttpException(
        { code: "TABLE_SERVICE_RATE_LIMITED", message: "Muitos chamados para esta mesa." },
        429,
      );
    }
  }

  private async resolveRoute(
    organizationId: string,
    unitId: string,
    tableId: string,
    tx: Transaction,
  ) {
    const [node] = await tx
      .select({ areaId: tableLayoutNodes.areaId })
      .from(tableLayoutNodes)
      .innerJoin(tableLayoutVersions, eq(tableLayoutVersions.id, tableLayoutNodes.layoutVersionId))
      .where(
        and(
          eq(tableLayoutVersions.organizationId, organizationId),
          eq(tableLayoutVersions.unitId, unitId),
          eq(tableLayoutVersions.state, "published"),
          eq(tableLayoutNodes.tableId, tableId),
        ),
      )
      .orderBy(desc(tableLayoutVersions.version))
      .limit(1);
    const [assignment] = node?.areaId
      ? await tx
          .select({
            primaryIdentityId: areaAssignments.primaryIdentityId,
            supportIdentityId: areaAssignments.supportIdentityId,
            fallbackRole: areaAssignments.fallbackRole,
          })
          .from(areaAssignments)
          .innerJoin(serviceShifts, eq(serviceShifts.id, areaAssignments.shiftId))
          .where(
            and(
              eq(areaAssignments.organizationId, organizationId),
              eq(areaAssignments.unitId, unitId),
              eq(areaAssignments.areaId, node.areaId),
              inArray(serviceShifts.state, ["open", "handoff"]),
            ),
          )
          .limit(1)
      : [];
    const present = async (identityId: string | null) => {
      if (!identityId) return false;
      const [lease] = await tx
        .select({ identityId: staffPresenceLeases.identityId })
        .from(staffPresenceLeases)
        .where(
          and(
            eq(staffPresenceLeases.organizationId, organizationId),
            eq(staffPresenceLeases.unitId, unitId),
            eq(staffPresenceLeases.identityId, identityId),
            isNotNull(staffPresenceLeases.acknowledgedAt),
            gt(staffPresenceLeases.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return Boolean(lease);
    };
    const primaryIdentityId = assignment?.primaryIdentityId ?? null;
    const supportIdentityId = assignment?.supportIdentityId ?? null;
    if (await present(primaryIdentityId))
      return { identityId: primaryIdentityId, source: "primary" as const };
    if (await present(supportIdentityId))
      return { identityId: supportIdentityId, source: "support" as const };
    const [fallback] = await tx
      .select({ identityId: memberships.identityId })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          eq(roleBindings.role, assignment?.fallbackRole === "owner" ? "owner" : "manager"),
          or(eq(roleBindings.unitId, unitId), sql`${roleBindings.unitId} is null`),
        ),
      )
      .limit(1);
    if (fallback) return { identityId: fallback.identityId, source: "fallback" as const };
    return { identityId: null, source: "unassigned" as const };
  }
}
