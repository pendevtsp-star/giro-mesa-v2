import { createHash } from "node:crypto";
import {
  areaAssignments,
  memberships,
  outboxEvents,
  posOrderItems,
  posOrders,
  posTabs,
  roleBindings,
  serviceShifts,
  staffPresenceLeases,
  tableLayoutNodes,
  tableLayoutVersions,
  tableOccupancies,
  tableServiceCallEvents,
  tableServiceCalls,
} from "@giromesa/db";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { TableSessionService } from "./table-session.js";

type CallKind = "waiter" | "bill";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
    const capability = kind === "waiter" ? "call_waiter" : "request_bill";
    const claims = await this.sessions.validate(slug, token, capability);
    const requestHash = fingerprint({ kind, occupancyId: claims.occupancyId, occupancyEpoch: claims.occupancyEpoch });
    const [existing] = await this.database.db
      .select()
      .from(tableServiceCalls)
      .where(and(eq(tableServiceCalls.sessionId, claims.sessionId), eq(tableServiceCalls.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "A chave já foi usada para outro chamado.");
      return { call: existing, idempotentReplay: true, cooldownDeduplicated: false };
    }
    await this.sessions.consumeRequestNonce(claims, requestNonce, `call:${kind}`);
    const [cooldown] = await this.database.db
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
    if (cooldown) return { call: cooldown, idempotentReplay: false, cooldownDeduplicated: true };

    const route = await this.resolveRoute(claims.organizationId, claims.unitId, claims.tableId);
    const state = route.identityId ? "routed" : "received";
    const now = new Date();
    const [call] = await this.database.db.transaction(async (tx) => {
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
      return [created];
    });
    if (!call) throw new Error("TABLE_SERVICE_CALL_NOT_CREATED");
    this.realtime?.publishTableServiceCall({
      organizationId: call.organizationId,
      unitId: call.unitId,
      callId: call.id,
      tableId: call.tableId,
      occupancyEpoch: call.occupancyEpoch,
      state: call.state,
      routeSource: call.routeSource,
    });
    return { call, idempotentReplay: false, cooldownDeduplicated: false };
  }

  async partial(slug: string, token: string) {
    const claims = await this.sessions.validate(slug, token, "view_partial");
    const [tab] = await this.database.db
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
    if (!tab) throw new NotFoundException({ code: "CURRENT_OCCUPANCY_TAB_NOT_FOUND", message: "Comanda atual não encontrada." });
    const items = await this.database.db
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
  }

  async attend(identityId: string, organizationId: string, unitId: string, callId: string, expectedVersion: number) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager", "waiter", "cashier"]);
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

  private async resolveRoute(organizationId: string, unitId: string, tableId: string) {
    const [node] = await this.database.db
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
      ? await this.database.db
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
      const [lease] = await this.database.db
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
    if (await present(primaryIdentityId)) return { identityId: primaryIdentityId, source: "primary" as const };
    if (await present(supportIdentityId)) return { identityId: supportIdentityId, source: "support" as const };
    const [fallback] = await this.database.db
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
