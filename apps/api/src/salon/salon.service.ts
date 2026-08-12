import { randomUUID } from "node:crypto";
import {
  areaAssignments,
  deviceEnrollments,
  memberships,
  posDiningRooms,
  posDiningTables,
  roleBindings,
  salonExceptions,
  serviceAreas,
  serviceShifts,
  staffPresenceLeases,
  tableLayoutNodes,
  tableLayoutVersions,
  tableOccupancies,
} from "@giromesa/db";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import type { AreaAssignmentInput, LayoutNodesInput, PresenceLeaseInput } from "./salon.schemas.js";

function conflict(code: string, message: string) {
  return new ConflictException({ code, message });
}

@Injectable()
export class SalonService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async createLayout(identityId: string, organizationId: string, unitId: string, roomId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.requireRoom(organizationId, unitId, roomId);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${posDiningRooms} where id = ${roomId} for update`);
      const [latest] = await tx
        .select({ version: tableLayoutVersions.version })
        .from(tableLayoutVersions)
        .where(eq(tableLayoutVersions.roomId, roomId))
        .orderBy(desc(tableLayoutVersions.version))
        .limit(1);
      const [created] = await tx
        .insert(tableLayoutVersions)
        .values({
          organizationId,
          unitId,
          roomId,
          version: (latest?.version ?? 0) + 1,
          createdByIdentityId: identityId,
        })
        .returning();
      if (!created) throw new Error("Layout insert returned no row");
      return created;
    });
  }

  async replaceNodes(
    identityId: string,
    organizationId: string,
    unitId: string,
    layoutId: string,
    expectedVersion: number,
    nodes: LayoutNodesInput["nodes"],
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    if (new Set(nodes.map((node) => node.tableId)).size !== nodes.length)
      throw conflict("LAYOUT_TABLE_DUPLICATED", "Cada mesa pode aparecer uma vez por versão.");
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${tableLayoutVersions} where id = ${layoutId} for update`,
      );
      const [layout] = await tx
        .select()
        .from(tableLayoutVersions)
        .where(
          and(
            eq(tableLayoutVersions.organizationId, organizationId),
            eq(tableLayoutVersions.unitId, unitId),
            eq(tableLayoutVersions.id, layoutId),
          ),
        )
        .limit(1);
      if (!layout)
        throw new NotFoundException({ code: "LAYOUT_NOT_FOUND", message: "Mapa não encontrado." });
      if (layout.state === "published")
        throw conflict("LAYOUT_IMMUTABLE", "Crie uma nova versão para alterar um mapa publicado.");
      if (layout.resourceVersion !== expectedVersion)
        throw conflict("LAYOUT_VERSION_CONFLICT", "O mapa mudou em outro dispositivo.");
      if (nodes.length) {
        const tables = await tx
          .select({ id: posDiningTables.id })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, organizationId),
              eq(posDiningTables.unitId, unitId),
              eq(posDiningTables.roomId, layout.roomId),
              inArray(
                posDiningTables.id,
                nodes.map((node) => node.tableId),
              ),
            ),
          );
        if (tables.length !== nodes.length)
          throw conflict("LAYOUT_TABLE_SCOPE_INVALID", "Uma mesa não pertence a este salão.");
        const areaIds = [...new Set(nodes.flatMap((node) => (node.areaId ? [node.areaId] : [])))];
        if (areaIds.length) {
          const areas = await tx
            .select({ id: serviceAreas.id })
            .from(serviceAreas)
            .where(
              and(
                eq(serviceAreas.organizationId, organizationId),
                eq(serviceAreas.unitId, unitId),
                eq(serviceAreas.roomId, layout.roomId),
                inArray(serviceAreas.id, areaIds),
              ),
            );
          if (areas.length !== areaIds.length)
            throw conflict("LAYOUT_AREA_SCOPE_INVALID", "Uma praça não pertence a este salão.");
        }
      }
      await tx.delete(tableLayoutNodes).where(eq(tableLayoutNodes.layoutVersionId, layoutId));
      if (nodes.length)
        await tx
          .insert(tableLayoutNodes)
          .values(
            nodes.map((node) => ({ organizationId, unitId, layoutVersionId: layoutId, ...node })),
          );
      const [updated] = await tx
        .update(tableLayoutVersions)
        .set({ resourceVersion: expectedVersion + 1, updatedAt: new Date() })
        .where(
          and(
            eq(tableLayoutVersions.id, layoutId),
            eq(tableLayoutVersions.resourceVersion, expectedVersion),
            eq(tableLayoutVersions.state, "draft"),
          ),
        )
        .returning();
      if (!updated) throw conflict("LAYOUT_VERSION_CONFLICT", "O mapa mudou em outro dispositivo.");
      return updated;
    });
  }

  async publishLayout(
    identityId: string,
    organizationId: string,
    unitId: string,
    layoutId: string,
    expectedVersion: number,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    const now = new Date();
    const [published] = await this.database.db
      .update(tableLayoutVersions)
      .set({
        state: "published",
        resourceVersion: expectedVersion + 1,
        publishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tableLayoutVersions.organizationId, organizationId),
          eq(tableLayoutVersions.unitId, unitId),
          eq(tableLayoutVersions.id, layoutId),
          eq(tableLayoutVersions.state, "draft"),
          eq(tableLayoutVersions.resourceVersion, expectedVersion),
        ),
      )
      .returning();
    if (!published)
      throw conflict("LAYOUT_VERSION_CONFLICT", "O mapa não pode mais ser publicado nesta versão.");
    return published;
  }

  async operationalMap(identityId: string, organizationId: string, unitId: string, roomId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
      "kds",
    ]);
    const fullFloor = roles.some((row) => ["owner", "manager", "cashier"].includes(row.role));
    const [layout] = await this.database.db
      .select()
      .from(tableLayoutVersions)
      .where(
        and(
          eq(tableLayoutVersions.organizationId, organizationId),
          eq(tableLayoutVersions.unitId, unitId),
          eq(tableLayoutVersions.roomId, roomId),
          eq(tableLayoutVersions.state, "published"),
        ),
      )
      .orderBy(desc(tableLayoutVersions.version))
      .limit(1);
    if (!layout)
      return {
        layout: null,
        nodes: [],
        occupancies: [],
        allowedAreaIds: [],
        state: "empty" as const,
      };
    const assignments = fullFloor
      ? []
      : await this.database.db
          .select({ areaId: areaAssignments.areaId })
          .from(areaAssignments)
          .innerJoin(serviceShifts, eq(serviceShifts.id, areaAssignments.shiftId))
          .where(
            and(
              eq(areaAssignments.organizationId, organizationId),
              eq(areaAssignments.unitId, unitId),
              inArray(serviceShifts.state, ["open", "handoff"]),
              or(
                eq(areaAssignments.primaryIdentityId, identityId),
                eq(areaAssignments.supportIdentityId, identityId),
              ),
            ),
          );
    const allowedAreaIds = assignments.map((assignment) => assignment.areaId);
    const allNodes = await this.database.db
      .select()
      .from(tableLayoutNodes)
      .where(eq(tableLayoutNodes.layoutVersionId, layout.id));
    const nodes = fullFloor
      ? allNodes
      : allNodes.filter((node) => node.areaId && allowedAreaIds.includes(node.areaId));
    const tableIds = nodes.map((node) => node.tableId);
    const occupancies = tableIds.length
      ? await this.database.db
          .select()
          .from(tableOccupancies)
          .where(
            and(
              eq(tableOccupancies.organizationId, organizationId),
              eq(tableOccupancies.unitId, unitId),
              inArray(tableOccupancies.tableId, tableIds),
              inArray(tableOccupancies.state, ["reserved", "open", "paying"]),
            ),
          )
      : [];
    return { layout, nodes, occupancies, allowedAreaIds, state: "ready" as const };
  }

  async assignArea(
    identityId: string,
    organizationId: string,
    unitId: string,
    shiftId: string,
    areaId: string,
    input: AreaAssignmentInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    await this.requireStaff(organizationId, unitId, input.primaryIdentityId);
    if (input.supportIdentityId)
      await this.requireStaff(organizationId, unitId, input.supportIdentityId);
    const [shift] = await this.database.db
      .select({ id: serviceShifts.id })
      .from(serviceShifts)
      .where(
        and(
          eq(serviceShifts.id, shiftId),
          eq(serviceShifts.organizationId, organizationId),
          eq(serviceShifts.unitId, unitId),
        ),
      )
      .limit(1);
    const [area] = await this.database.db
      .select({ id: serviceAreas.id })
      .from(serviceAreas)
      .where(
        and(
          eq(serviceAreas.id, areaId),
          eq(serviceAreas.organizationId, organizationId),
          eq(serviceAreas.unitId, unitId),
        ),
      )
      .limit(1);
    if (!shift || !area)
      throw new NotFoundException({
        code: "AREA_ASSIGNMENT_SCOPE_INVALID",
        message: "Turno ou praça não encontrado.",
      });
    const [assignment] = await this.database.db
      .insert(areaAssignments)
      .values({ organizationId, unitId, shiftId, areaId, ...input })
      .onConflictDoUpdate({
        target: [areaAssignments.shiftId, areaAssignments.areaId],
        set: {
          ...input,
          resourceVersion: sql`${areaAssignments.resourceVersion} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return assignment;
  }

  async renewPresence(
    identityId: string,
    organizationId: string,
    unitId: string,
    deviceId: string,
    current: PresenceLeaseInput,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const [device] = await this.database.db
      .select({ id: deviceEnrollments.id })
      .from(deviceEnrollments)
      .where(
        and(
          eq(deviceEnrollments.id, deviceId),
          eq(deviceEnrollments.organizationId, organizationId),
          eq(deviceEnrollments.unitId, unitId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    if (!device) throw new ForbiddenException({ code: "DEVICE_NOT_ENROLLED" });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30_000);
    if (!current) {
      const [created] = await this.database.db
        .insert(staffPresenceLeases)
        .values({ organizationId, unitId, identityId, deviceId, expiresAt })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      throw conflict("PRESENCE_LEASE_CONFLICT", "Renove usando a versão atual da presença.");
    }
    const [existing] = await this.database.db
      .select({ expiresAt: staffPresenceLeases.expiresAt })
      .from(staffPresenceLeases)
      .where(
        and(
          eq(staffPresenceLeases.organizationId, organizationId),
          eq(staffPresenceLeases.unitId, unitId),
          eq(staffPresenceLeases.identityId, identityId),
          eq(staffPresenceLeases.deviceId, deviceId),
          eq(staffPresenceLeases.leaseEpoch, current.leaseEpoch),
          eq(staffPresenceLeases.resourceVersion, current.resourceVersion),
        ),
      )
      .limit(1);
    if (!existing)
      throw conflict("PRESENCE_LEASE_CONFLICT", "A presença mudou em outro dispositivo.");
    const rotate = existing.expiresAt <= now;
    const [renewed] = await this.database.db
      .update(staffPresenceLeases)
      .set({
        expiresAt,
        acknowledgedAt: rotate ? null : undefined,
        leaseEpoch: rotate ? randomUUID() : current.leaseEpoch,
        resourceVersion: current.resourceVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(staffPresenceLeases.organizationId, organizationId),
          eq(staffPresenceLeases.unitId, unitId),
          eq(staffPresenceLeases.identityId, identityId),
          eq(staffPresenceLeases.deviceId, deviceId),
          eq(staffPresenceLeases.leaseEpoch, current.leaseEpoch),
          eq(staffPresenceLeases.resourceVersion, current.resourceVersion),
        ),
      )
      .returning();
    if (!renewed)
      throw conflict("PRESENCE_LEASE_CONFLICT", "A presença mudou em outro dispositivo.");
    return renewed;
  }

  async ackPresence(
    identityId: string,
    organizationId: string,
    unitId: string,
    deviceId: string,
    leaseEpoch: string,
    resourceVersion: number,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const now = new Date();
    const [acknowledged] = await this.database.db
      .update(staffPresenceLeases)
      .set({ acknowledgedAt: now, resourceVersion: resourceVersion + 1, updatedAt: now })
      .where(
        and(
          eq(staffPresenceLeases.organizationId, organizationId),
          eq(staffPresenceLeases.unitId, unitId),
          eq(staffPresenceLeases.identityId, identityId),
          eq(staffPresenceLeases.deviceId, deviceId),
          eq(staffPresenceLeases.leaseEpoch, leaseEpoch),
          eq(staffPresenceLeases.resourceVersion, resourceVersion),
          gt(staffPresenceLeases.expiresAt, now),
        ),
      )
      .returning();
    if (!acknowledged)
      throw conflict("PRESENCE_LEASE_EXPIRED", "Renove a presença antes de confirmar.");
    return acknowledged;
  }

  async listExceptions(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    return this.database.db
      .select()
      .from(salonExceptions)
      .where(
        and(
          eq(salonExceptions.organizationId, organizationId),
          eq(salonExceptions.unitId, unitId),
          inArray(salonExceptions.state, ["open", "acknowledged"]),
        ),
      )
      .orderBy(desc(salonExceptions.createdAt));
  }

  async acknowledgeException(
    identityId: string,
    organizationId: string,
    unitId: string,
    exceptionId: string,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const now = new Date();
    const [updated] = await this.database.db
      .update(salonExceptions)
      .set({
        state: "acknowledged",
        acknowledgedByIdentityId: identityId,
        acknowledgedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(salonExceptions.organizationId, organizationId),
          eq(salonExceptions.unitId, unitId),
          eq(salonExceptions.id, exceptionId),
          eq(salonExceptions.state, "open"),
        ),
      )
      .returning();
    if (!updated)
      throw conflict("SALON_EXCEPTION_CONFLICT", "A exceção já foi tratada ou não existe.");
    return updated;
  }

  private async requireManager(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
  }

  private async requireRoom(organizationId: string, unitId: string, roomId: string) {
    const [room] = await this.database.db
      .select({ id: posDiningRooms.id })
      .from(posDiningRooms)
      .where(
        and(
          eq(posDiningRooms.id, roomId),
          eq(posDiningRooms.organizationId, organizationId),
          eq(posDiningRooms.unitId, unitId),
        ),
      )
      .limit(1);
    if (!room)
      throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Salão não encontrado." });
    return room;
  }

  private async requireStaff(organizationId: string, unitId: string, identityId: string) {
    const [staff] = await this.database.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.identityId, identityId),
          eq(memberships.status, "active"),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!staff)
      throw new NotFoundException({
        code: "STAFF_SCOPE_INVALID",
        message: "Profissional não pertence à unidade.",
      });
  }
}
