import { createHash } from "node:crypto";
import {
  auditEvents,
  deviceEnrollments,
  hubCommands,
  hubHeartbeats,
  memberships,
  operationalCommands,
  outboxEvents,
  roleBindings,
} from "@giromesa/db";
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { ZodError } from "zod";
import { DatabaseService } from "../database/database.module.js";
import { FiscalService } from "../fiscal/fiscal.service.js";
import { OperationalSnapshotService } from "./operational-snapshot.service.js";
import type { SyncBatchInput, SyncEventInput } from "./sync.schemas.js";
import { SyncPilotService } from "./sync-pilot.service.js";

const hashSyncKey = (value: string) => createHash("sha256").update(value).digest("hex");

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

export function redactOperationalSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOperationalSecrets);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      key === "pin" ? "[redacted]" : redactOperationalSecrets(entry),
    ]),
  );
}

export function operationalSnapshotRevision(snapshot: Record<string, unknown>): string {
  const { capturedAt, approvals, kds, ...data } = snapshot;
  const approvalRecord =
    typeof approvals === "object" && approvals !== null && !Array.isArray(approvals)
      ? (approvals as Record<string, unknown>)
      : {};
  const { validUntil: _validUntil, ...stableApprovals } = approvalRecord;
  const kdsRecord =
    typeof kds === "object" && kds !== null && !Array.isArray(kds)
      ? (kds as Record<string, unknown>)
      : {};
  const {
    capturedAt: _kdsCapturedAt,
    serverTime: _kdsServerTime,
    ...kdsWithoutTransportTime
  } = kdsRecord;
  const stableKds =
    typeof kdsRecord.revision === "string"
      ? { revision: kdsRecord.revision }
      : kdsWithoutTransportTime;
  const capturedTime =
    capturedAt instanceof Date ? capturedAt.getTime() : new Date(String(capturedAt)).getTime();
  const leaseBucket = Number.isFinite(capturedTime)
    ? Math.floor(capturedTime / (60 * 60 * 1_000))
    : 0;
  return createHash("sha256")
    .update(canonicalJson({ ...data, approvals: stableApprovals, kds: stableKds, leaseBucket }))
    .digest("hex");
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly pilot: SyncPilotService,
    private readonly snapshots: OperationalSnapshotService,
    private readonly fiscal: FiscalService,
  ) {}

  async synchronize(syncKey: string | undefined, input: SyncBatchInput) {
    if (!syncKey) throw this.invalidHubKey();
    const hub = await this.database.db.transaction(async (tx) => {
      const [hub] = await tx
        .select({
          id: deviceEnrollments.id,
          organizationId: deviceEnrollments.organizationId,
          unitId: deviceEnrollments.unitId,
        })
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.syncKeyHash, hashSyncKey(syncKey)),
            isNull(deviceEnrollments.revokedAt),
          ),
        )
        .limit(1);
      if (!hub) throw this.invalidHubKey();

      const now = new Date();
      await tx
        .insert(hubHeartbeats)
        .values({
          organizationId: hub.organizationId,
          unitId: hub.unitId,
          hubId: hub.id,
          version: input.hubVersion,
          lastSeenAt: now,
          metadata: { ...input.metadata, protocolVersion: input.protocolVersion },
        })
        .onConflictDoUpdate({
          target: hubHeartbeats.unitId,
          set: {
            organizationId: hub.organizationId,
            hubId: hub.id,
            version: input.hubVersion,
            lastSeenAt: now,
            metadata: { ...input.metadata, protocolVersion: input.protocolVersion },
          },
        });

      if (input.acknowledgedCommandIds.length > 0) {
        await tx
          .update(hubCommands)
          .set({ acknowledgedAt: now })
          .where(
            and(
              eq(hubCommands.organizationId, hub.organizationId),
              eq(hubCommands.unitId, hub.unitId),
              eq(hubCommands.hubId, hub.id),
              inArray(hubCommands.id, input.acknowledgedCommandIds),
              isNull(hubCommands.acknowledgedAt),
            ),
          );
      }
      return hub;
    });

    const actorIds = [...new Set(input.events.map((event) => event.actorId))];
    const actorRows =
      actorIds.length === 0
        ? []
        : await this.database.db
            .select({
              identityId: memberships.identityId,
              role: roleBindings.role,
              unitId: roleBindings.unitId,
            })
            .from(memberships)
            .leftJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
            .where(
              and(
                eq(memberships.organizationId, hub.organizationId),
                eq(memberships.status, "active"),
                inArray(memberships.identityId, actorIds),
              ),
            );
    const allowedActors = new Set(
      actorRows
        .filter((row) => row.role !== null && (row.unitId === null || row.unitId === hub.unitId))
        .map((row) => row.identityId),
    );
    const acceptedEventIds: string[] = [];
    const rejectedEvents: Array<{ id: string; code: string }> = [];

    for (const event of input.events) {
      if (!allowedActors.has(event.actorId)) {
        rejectedEvents.push({ id: event.id, code: "ACTOR_SCOPE_DENIED" });
        continue;
      }
      const persisted = await this.persistEnvelope(event, hub.organizationId, hub.unitId);
      if (!persisted) {
        rejectedEvents.push({ id: event.id, code: "IDEMPOTENCY_CONFLICT" });
        continue;
      }
      if (persisted.status === "processed") {
        acceptedEventIds.push(event.id);
        continue;
      }
      if (persisted.status === "rejected") {
        rejectedEvents.push({
          id: event.id,
          code: persisted.rejectionReason ?? "COMMAND_REJECTED",
        });
        continue;
      }
      try {
        if (event.type.startsWith("fiscal.")) {
          await this.fiscal.ingestEdgeEvent(event, { ...hub, hubId: hub.id });
        } else {
          await this.pilot.apply(event, hub);
        }
      } catch (error) {
        const code = this.deterministicRejection(error);
        if (code) {
          await this.rejectEnvelope(event.id, hub.organizationId, hub.unitId, code);
          rejectedEvents.push({ id: event.id, code });
        } else {
          this.logger.warn(
            `Operational command ${event.id} remains pending after transient failure`,
          );
        }
        continue;
      }
      await this.processEnvelope(event, hub);
      acceptedEventIds.push(event.id);
    }

    const now = new Date();
    const commands = await this.database.db
      .select({
        id: hubCommands.id,
        type: hubCommands.type,
        payload: hubCommands.payload,
        createdAt: hubCommands.createdAt,
        expiresAt: hubCommands.expiresAt,
      })
      .from(hubCommands)
      .where(
        and(
          eq(hubCommands.organizationId, hub.organizationId),
          eq(hubCommands.unitId, hub.unitId),
          eq(hubCommands.hubId, hub.id),
          isNull(hubCommands.acknowledgedAt),
          gt(hubCommands.expiresAt, now),
        ),
      )
      .orderBy(asc(hubCommands.createdAt))
      .limit(100);
    const snapshot = await this.snapshots.capture(hub.organizationId, hub.unitId);
    const snapshotRevision = operationalSnapshotRevision(snapshot);
    const requestedRevision = input.metadata.snapshotRevision;
    const snapshotUnchanged =
      typeof requestedRevision === "string" && requestedRevision === snapshotRevision;

    return {
      acceptedEventIds,
      rejectedEvents,
      commands,
      snapshot: snapshotUnchanged ? null : snapshot,
      snapshotRevision,
      snapshotUnchanged,
      serverTime: now,
    };
  }

  private async persistEnvelope(event: SyncEventInput, organizationId: string, unitId: string) {
    const [inserted] = await this.database.db
      .insert(operationalCommands)
      .values({
        id: event.id,
        organizationId,
        unitId,
        actorIdentityId: event.actorId,
        deviceId: event.deviceId,
        idempotencyKey: event.idempotencyKey,
        type: event.type,
        version: event.version,
        occurredAt: new Date(event.occurredAt),
        payload: redactOperationalSecrets(event.payload) as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const [existing] = await this.database.db
      .select()
      .from(operationalCommands)
      .where(
        or(
          eq(operationalCommands.id, event.id),
          and(
            eq(operationalCommands.unitId, unitId),
            eq(operationalCommands.idempotencyKey, event.idempotencyKey),
          ),
        ),
      )
      .limit(1);
    return existing && this.matchesEvent(existing, event, organizationId, unitId) ? existing : null;
  }

  private async processEnvelope(
    event: SyncEventInput,
    hub: { id: string; organizationId: string; unitId: string },
  ) {
    await this.database.db.transaction(async (tx) => {
      const [processed] = await tx
        .update(operationalCommands)
        .set({ status: "processed", rejectionReason: null })
        .where(
          and(
            eq(operationalCommands.id, event.id),
            eq(operationalCommands.organizationId, hub.organizationId),
            eq(operationalCommands.unitId, hub.unitId),
            eq(operationalCommands.status, "accepted"),
          ),
        )
        .returning({ id: operationalCommands.id });
      if (!processed) return;
      await tx.insert(auditEvents).values({
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        actorIdentityId: event.actorId,
        action: "operational_command.processed_from_edge",
        entityType: "operational_command",
        entityId: event.id,
        metadata: { type: event.type, deviceId: event.deviceId, hubId: hub.id },
      });
      await tx.insert(outboxEvents).values({
        topic: "operational.command_processed",
        aggregateType: "operational_command",
        aggregateId: event.id,
        payload: {
          commandId: event.id,
          organizationId: hub.organizationId,
          unitId: hub.unitId,
          type: event.type,
        },
      });
    });
  }

  private async rejectEnvelope(id: string, organizationId: string, unitId: string, code: string) {
    await this.database.db
      .update(operationalCommands)
      .set({ status: "rejected", rejectionReason: code.slice(0, 200) })
      .where(
        and(
          eq(operationalCommands.id, id),
          eq(operationalCommands.organizationId, organizationId),
          eq(operationalCommands.unitId, unitId),
          eq(operationalCommands.status, "accepted"),
        ),
      );
  }

  private deterministicRejection(error: unknown) {
    if (error instanceof ZodError) return "INVALID_OPERATIONAL_PAYLOAD";
    if (!(error instanceof HttpException) || error.getStatus() >= 500) return null;
    const response = error.getResponse();
    if (typeof response === "object" && response !== null && "code" in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === "string" && code.length <= 100) return code;
    }
    return `OPERATION_REJECTED_${error.getStatus()}`;
  }

  async enqueuePublicCommand(input: {
    organizationId: string;
    unitId: string;
    hubId: string;
    idempotencyKey: string;
    type: string;
    payload: Record<string, unknown>;
  }) {
    return this.database.db.transaction(async (tx) => {
      const [activeHub] = await tx
        .select({ id: deviceEnrollments.id })
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.id, input.hubId),
            eq(deviceEnrollments.organizationId, input.organizationId),
            eq(deviceEnrollments.unitId, input.unitId),
            isNull(deviceEnrollments.revokedAt),
          ),
        )
        .limit(1);
      if (!activeHub) {
        throw new ServiceUnavailableException({
          code: "HUB_UNAVAILABLE",
          message: "O hub da unidade não está habilitado para receber comandos.",
        });
      }
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const [created] = await tx
        .insert(hubCommands)
        .values({ ...input, source: "public_menu", expiresAt })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [existing] = await tx
        .select()
        .from(hubCommands)
        .where(
          and(
            eq(hubCommands.unitId, input.unitId),
            eq(hubCommands.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (
        !existing ||
        existing.organizationId !== input.organizationId ||
        existing.hubId !== input.hubId ||
        existing.type !== input.type ||
        canonicalJson(existing.payload) !== canonicalJson(input.payload)
      ) {
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: "A chave de idempotência já foi usada para outro comando.",
        });
      }
      return existing;
    });
  }

  async waitForAcknowledgement(
    command: { id: string; organizationId: string; unitId: string; expiresAt: Date },
    timeoutMs = this.publicAckTimeout(),
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [status] = await this.database.db
        .select({ acknowledgedAt: hubCommands.acknowledgedAt })
        .from(hubCommands)
        .where(
          and(
            eq(hubCommands.id, command.id),
            eq(hubCommands.organizationId, command.organizationId),
            eq(hubCommands.unitId, command.unitId),
          ),
        )
        .limit(1);
      if (status?.acknowledgedAt) {
        return {
          acknowledged: true as const,
          state: "acknowledged" as const,
          acknowledgedAt: status.acknowledgedAt,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      acknowledged: false as const,
      state: "pending" as const,
      retryable: command.expiresAt > new Date(),
    };
  }

  private matchesEvent(
    existing: typeof operationalCommands.$inferSelect,
    event: SyncEventInput,
    organizationId: string,
    unitId: string,
  ) {
    return (
      existing.id === event.id &&
      existing.organizationId === organizationId &&
      existing.unitId === unitId &&
      existing.actorIdentityId === event.actorId &&
      existing.deviceId === event.deviceId &&
      existing.idempotencyKey === event.idempotencyKey &&
      existing.type === event.type &&
      existing.version === event.version &&
      existing.occurredAt.getTime() === new Date(event.occurredAt).getTime() &&
      canonicalJson(existing.payload) === canonicalJson(redactOperationalSecrets(event.payload))
    );
  }

  private publicAckTimeout() {
    const configured = Number(process.env.PUBLIC_HUB_ACK_TIMEOUT_MS ?? 5_000);
    return Number.isFinite(configured) ? Math.min(10_000, Math.max(250, configured)) : 5_000;
  }

  private invalidHubKey() {
    return new UnauthorizedException({
      code: "INVALID_HUB_KEY",
      message: "Credencial do hub inválida ou revogada.",
    });
  }
}
