import { createHash } from "node:crypto";
import {
  aggregateSequenceStates,
  auditEvents,
  commandInbox,
  commandQuarantine,
  deviceEnrollments,
  hubCommands,
  hubHeartbeats,
  operationalCommands,
  outboxEvents,
} from "@giromesa/db";
import { type CommandEnvelope, createCommandEnvelope } from "@giromesa/domain";
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { DatabaseService } from "../database/database.module.js";
import { canonicalJson } from "./canonical-json.js";
import {
  type CommandFingerprint,
  type CommandFingerprintKeyring,
  createCommandFingerprint,
  loadCommandFingerprintKeyring,
  verifyCommandFingerprint,
} from "./command-fingerprint.js";
import { OperationalSnapshotService } from "./operational-snapshot.service.js";
import {
  type NormalizedSyncEventInput,
  normalizeSyncBatch,
  type SyncBatchInput,
} from "./sync.schemas.js";
import { SyncPilotService } from "./sync-pilot.service.js";

const hashSyncKey = (value: string) => createHash("sha256").update(value).digest("hex");

export { canonicalJson } from "./canonical-json.js";

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

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly pilot: SyncPilotService,
    private readonly snapshots: OperationalSnapshotService,
  ) {}

  async synchronize(syncKey: string | undefined, rawInput: SyncBatchInput) {
    if (!syncKey) throw this.invalidHubKey();
    const input = normalizeSyncBatch(rawInput);
    const fingerprintKeyring = loadCommandFingerprintKeyring();
    const hub = await this.database.withRoleContext("internal", null, async (tx) => {
      const resolved = await tx.execute<{
        hub_id: string;
        organization_id: string;
        unit_id: string;
      }>(sql`select * from public.giromesa_resolve_sync_hub(${hashSyncKey(syncKey)})`);
      const [scope] = [...resolved];
      if (!scope) throw this.invalidHubKey();
      return {
        id: scope.hub_id,
        organizationId: scope.organization_id,
        unitId: scope.unit_id,
      };
    });
    await this.database.withTenantContext(
      {
        source: "internal",
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        actorIdentityId: null,
      },
      async (tx) => {
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
      },
    );
    const acceptedEventIds: string[] = [];
    const rejectedEvents: Array<{ id: string; code: string }> = [];
    const eventResults: Array<{
      id: string;
      replayed: boolean;
      result: Record<string, unknown>;
    }> = [];

    for (const event of input.events) {
      try {
        const outcome = await this.database.withTenantContext(
          {
            source: "internal",
            organizationId: hub.organizationId,
            unitId: hub.unitId,
            actorIdentityId: null,
          },
          () => this.applyEnvelope(event, hub, fingerprintKeyring),
        );
        const result = outcome.result as Record<string, unknown>;
        eventResults.push({ id: event.id, replayed: outcome.replayed, result });
        if (result.status === "applied") acceptedEventIds.push(event.id);
        else {
          rejectedEvents.push({
            id: event.id,
            code: typeof result.code === "string" ? result.code : "COMMAND_REJECTED",
          });
        }
      } catch (error) {
        this.logger.warn(`Operational command ${event.id} rolled back after transient failure`);
        const code =
          error instanceof TypeError ? "INVALID_COMMAND_CONTEXT" : "COMMAND_RETRY_REQUIRED";
        rejectedEvents.push({ id: event.id, code });
        eventResults.push({
          id: event.id,
          replayed: false,
          result: { status: "rejected", code, retryable: code === "COMMAND_RETRY_REQUIRED" },
        });
      }
    }

    const now = new Date();
    const { commands, snapshot } = await this.database.withTenantContext(
      {
        source: "internal",
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        actorIdentityId: null,
      },
      async (tx) => ({
        commands: await tx
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
          .limit(100),
        snapshot: await this.snapshots.capture(hub.organizationId, hub.unitId),
      }),
    );

    return { acceptedEventIds, rejectedEvents, eventResults, commands, snapshot, serverTime: now };
  }

  private async applyEnvelope(
    event: NormalizedSyncEventInput,
    hub: { id: string; organizationId: string; unitId: string },
    fingerprintKeyring: CommandFingerprintKeyring,
  ) {
    const envelope = createCommandEnvelope(event, {
      organizationId: hub.organizationId,
      unitId: hub.unitId,
      receivedAt: new Date().toISOString(),
    });
    let fingerprint = createCommandFingerprint(envelope, fingerprintKeyring);
    const scope = and(
      eq(commandInbox.organizationId, hub.organizationId),
      eq(commandInbox.unitId, hub.unitId),
    );

    await this.database.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`command-idempotency:${hub.organizationId}:${hub.unitId}:${event.idempotencyKey}`}, 0))`,
    );
    await this.database.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`command-aggregate:${hub.organizationId}:${hub.unitId}:${event.aggregate.type}:${event.aggregate.id}:${event.occupancyEpoch}`}, 0))`,
    );

    const [existingReceipt] = await this.database.db
      .select()
      .from(commandInbox)
      .where(
        and(
          scope,
          or(
            eq(commandInbox.commandId, event.commandId),
            eq(commandInbox.idempotencyKey, event.idempotencyKey),
          ),
        ),
      )
      .limit(1);
    if (existingReceipt) {
      const storedFingerprint = {
        keyVersion: existingReceipt.fingerprintKeyVersion,
        digest: existingReceipt.fingerprint,
      };
      if (!verifyCommandFingerprint(envelope, storedFingerprint, fingerprintKeyring)) {
        return {
          replayed: true,
          result: { status: "rejected", code: this.idempotencyConflictCode(event) },
        };
      }
      fingerprint = storedFingerprint;
    }
    if (existingReceipt && existingReceipt.status !== "quarantined") {
      return { replayed: true, result: existingReceipt.result as Record<string, unknown> };
    }
    const preconditionCode = await this.commandPrecondition(event, hub);
    const effectivePreconditionCode = existingReceipt?.preconditionCode ?? preconditionCode;

    const aggregateScope = and(
      eq(aggregateSequenceStates.organizationId, hub.organizationId),
      eq(aggregateSequenceStates.unitId, hub.unitId),
      eq(aggregateSequenceStates.aggregateType, event.aggregate.type),
      eq(aggregateSequenceStates.aggregateId, event.aggregate.id),
      eq(aggregateSequenceStates.occupancyEpoch, event.occupancyEpoch),
    );
    const [sequenceState] = await this.database.db
      .select()
      .from(aggregateSequenceStates)
      .where(aggregateScope)
      .limit(1);
    const expectedSequence = (sequenceState?.lastSequence ?? 0) + 1;
    if (event.aggregateSequence !== expectedSequence) {
      if (existingReceipt) {
        return { replayed: true, result: existingReceipt.result as Record<string, unknown> };
      }
      const code =
        event.aggregateSequence > expectedSequence
          ? "AGGREGATE_SEQUENCE_GAP"
          : "AGGREGATE_SEQUENCE_OUT_OF_ORDER";
      const result = {
        status: "quarantined",
        code,
        expectedSequence,
        receivedSequence: event.aggregateSequence,
      } as const;
      await this.database.db.insert(commandInbox).values({
        ...this.receiptValues(envelope, fingerprint, effectivePreconditionCode),
        status: "quarantined",
        result,
      });
      await this.database.db.insert(commandQuarantine).values({
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        commandId: event.commandId,
        reason: code,
        evidence: {
          aggregate: event.aggregate,
          occupancyEpoch: event.occupancyEpoch,
          expectedSequence,
          receivedSequence: event.aggregateSequence,
          lastCommandId: sequenceState?.lastCommandId ?? null,
          preconditionCode: effectivePreconditionCode,
        },
      });
      return { replayed: false, result };
    }

    if (effectivePreconditionCode !== null) {
      const result = { status: "rejected", code: effectivePreconditionCode } as const;
      await this.advanceSequence(event, hub);
      await this.completeReceipt(
        existingReceipt !== undefined,
        envelope,
        fingerprint,
        result,
        effectivePreconditionCode,
      );
      return { replayed: existingReceipt !== undefined, result };
    }

    const redactedPayload = redactOperationalSecrets(event.payload) as Record<string, unknown>;
    const [insertedCommand] = await this.database.db
      .insert(operationalCommands)
      .values({
        id: event.commandId,
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        actorIdentityId: event.actorId,
        deviceId: event.deviceId,
        idempotencyKey: event.idempotencyKey,
        type: event.type,
        version: event.version,
        occurredAt: new Date(event.occurredAt),
        payload: redactedPayload,
      })
      .onConflictDoNothing()
      .returning();
    if (!insertedCommand) {
      const [legacyCommand] = await this.database.db
        .select()
        .from(operationalCommands)
        .where(
          and(
            eq(operationalCommands.organizationId, hub.organizationId),
            eq(operationalCommands.unitId, hub.unitId),
            or(
              eq(operationalCommands.id, event.commandId),
              eq(operationalCommands.idempotencyKey, event.idempotencyKey),
            ),
          ),
        )
        .limit(1);
      if (
        !legacyCommand ||
        !this.matchesEvent(legacyCommand, event, hub.organizationId, hub.unitId)
      ) {
        return {
          replayed: true,
          result: { status: "rejected", code: this.idempotencyConflictCode(event) },
        };
      }
      const result = { status: "applied", effect: { legacyReplay: true } } as const;
      await this.advanceSequence(event, hub);
      await this.database.db.insert(commandInbox).values({
        ...this.receiptValues(envelope, fingerprint, null),
        status: "applied",
        result,
        completedAt: new Date(),
      });
      return { replayed: true, result };
    }

    let effect: Record<string, unknown> | null;
    try {
      effect = await this.pilot.apply(event, hub);
    } catch (error) {
      const code = this.deterministicRejection(error);
      if (!code) throw error;
      const result = { status: "rejected", code } as const;
      await this.database.db
        .update(operationalCommands)
        .set({ status: "rejected", rejectionReason: code })
        .where(
          and(
            eq(operationalCommands.id, event.commandId),
            eq(operationalCommands.organizationId, hub.organizationId),
            eq(operationalCommands.unitId, hub.unitId),
          ),
        );
      await this.advanceSequence(event, hub);
      await this.completeReceipt(
        existingReceipt !== undefined,
        envelope,
        fingerprint,
        result,
        null,
      );
      return { replayed: existingReceipt !== undefined, result };
    }

    const result = { status: "applied", effect } as const;
    await this.database.db
      .update(operationalCommands)
      .set({ status: "processed", rejectionReason: null })
      .where(
        and(
          eq(operationalCommands.id, event.commandId),
          eq(operationalCommands.organizationId, hub.organizationId),
          eq(operationalCommands.unitId, hub.unitId),
        ),
      );
    await this.advanceSequence(event, hub);
    await this.completeReceipt(existingReceipt !== undefined, envelope, fingerprint, result, null);
    await this.database.db.insert(auditEvents).values({
      organizationId: hub.organizationId,
      unitId: hub.unitId,
      actorIdentityId: event.actorId,
      action: "operational_command.processed_from_edge",
      entityType: "operational_command",
      entityId: event.commandId,
      metadata: {
        type: event.type,
        deviceId: event.deviceId,
        hubId: hub.id,
        aggregate: event.aggregate,
        occupancyEpoch: event.occupancyEpoch,
        aggregateSequence: event.aggregateSequence,
      },
    });
    await this.database.db.insert(outboxEvents).values({
      organizationId: hub.organizationId,
      unitId: hub.unitId,
      topic: "operational.command_processed",
      aggregateType: event.aggregate.type,
      aggregateId: event.aggregate.id,
      sourceCommandId: event.commandId,
      aggregateSequence: event.aggregateSequence,
      occupancyEpoch: event.occupancyEpoch,
      resourceVersion: event.resourceVersion,
      payload: {
        commandId: event.commandId,
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        type: event.type,
        aggregate: event.aggregate,
        occupancyEpoch: event.occupancyEpoch,
        resourceVersion: event.resourceVersion,
        aggregateSequence: event.aggregateSequence,
      },
    });
    return { replayed: existingReceipt !== undefined, result };
  }

  private async commandPrecondition(
    event: NormalizedSyncEventInput,
    hub: { organizationId: string; unitId: string },
  ) {
    await this.database.db.execute(sql.raw("set local role giromesa_internal"));
    const lockedDevices = await this.database.db.execute<{
      device_id: string;
      organization_id: string;
      revoked_at: Date | null;
      unit_id: string;
    }>(sql`select * from public.giromesa_lock_command_device(${event.deviceId})`);
    const lockedActors = await this.database.db.execute<{ authorized: boolean }>(
      sql`select public.giromesa_lock_command_actor(
        ${hub.organizationId}, ${hub.unitId}, ${event.actorId}
      ) as authorized`,
    );
    await this.database.db.execute(sql.raw("set local role giromesa_app"));
    const [device] = [...lockedDevices];
    const [actor] = [...lockedActors];

    if (!device) return "DEVICE_NOT_ENROLLED";
    if (device.organization_id !== hub.organizationId || device.unit_id !== hub.unitId) {
      return "DEVICE_SCOPE_DENIED";
    }
    if (device.revoked_at !== null) return "DEVICE_REVOKED";
    if (actor?.authorized !== true) return "ACTOR_SCOPE_DENIED";
    return null;
  }

  private receiptValues(
    envelope: CommandEnvelope,
    fingerprint: CommandFingerprint,
    preconditionCode: string | null,
  ) {
    return {
      organizationId: envelope.organizationId,
      unitId: envelope.unitId,
      commandId: envelope.commandId,
      idempotencyKey: envelope.idempotencyKey,
      fingerprintKeyVersion: fingerprint.keyVersion,
      fingerprint: fingerprint.digest,
      actorIdentityId: envelope.actorId,
      deviceId: envelope.deviceId,
      commandType: envelope.type,
      aggregateType: envelope.aggregate.type,
      aggregateId: envelope.aggregate.id,
      occupancyEpoch: envelope.occupancyEpoch,
      resourceVersion: envelope.resourceVersion,
      aggregateSequence: envelope.aggregateSequence,
      occurredAt: new Date(envelope.occurredAt),
      receivedAt: new Date(envelope.receivedAt),
      payload: redactOperationalSecrets(envelope.payload) as Record<string, unknown>,
      preconditionCode,
    };
  }

  private idempotencyConflictCode(event: NormalizedSyncEventInput) {
    return event.aggregate.type === "legacy.operational_command"
      ? "IDEMPOTENCY_CONFLICT"
      : "IDEMPOTENCY_KEY_REUSED";
  }

  private async advanceSequence(
    event: NormalizedSyncEventInput,
    hub: { organizationId: string; unitId: string },
  ) {
    await this.database.db
      .insert(aggregateSequenceStates)
      .values({
        organizationId: hub.organizationId,
        unitId: hub.unitId,
        aggregateType: event.aggregate.type,
        aggregateId: event.aggregate.id,
        occupancyEpoch: event.occupancyEpoch,
        lastSequence: event.aggregateSequence,
        resourceVersion: event.resourceVersion,
        lastCommandId: event.commandId,
      })
      .onConflictDoUpdate({
        target: [
          aggregateSequenceStates.organizationId,
          aggregateSequenceStates.unitId,
          aggregateSequenceStates.aggregateType,
          aggregateSequenceStates.aggregateId,
          aggregateSequenceStates.occupancyEpoch,
        ],
        set: {
          lastSequence: event.aggregateSequence,
          resourceVersion: event.resourceVersion,
          lastCommandId: event.commandId,
          updatedAt: new Date(),
        },
      });
  }

  private async completeReceipt(
    recovering: boolean,
    envelope: CommandEnvelope,
    fingerprint: CommandFingerprint,
    result: { status: "applied" | "rejected"; [key: string]: unknown },
    preconditionCode: string | null,
  ) {
    const now = new Date();
    if (!recovering) {
      await this.database.db.insert(commandInbox).values({
        ...this.receiptValues(envelope, fingerprint, preconditionCode),
        status: result.status,
        result,
        completedAt: now,
      });
      return;
    }
    const transitionedReceipts = await this.database.db
      .update(commandInbox)
      .set({ status: result.status, result, preconditionCode, completedAt: now })
      .where(
        and(
          eq(commandInbox.organizationId, envelope.organizationId),
          eq(commandInbox.unitId, envelope.unitId),
          eq(commandInbox.commandId, envelope.commandId),
          eq(commandInbox.fingerprintKeyVersion, fingerprint.keyVersion),
          eq(commandInbox.fingerprint, fingerprint.digest),
          eq(commandInbox.status, "quarantined"),
        ),
      )
      .returning({ commandId: commandInbox.commandId });
    if (transitionedReceipts.length !== 1) throw new Error("COMMAND_RECEIPT_TRANSITION_FAILED");
    const recoveredQuarantines = await this.database.db
      .update(commandQuarantine)
      .set({ status: "recovered", recoveredAt: now })
      .where(
        and(
          eq(commandQuarantine.organizationId, envelope.organizationId),
          eq(commandQuarantine.unitId, envelope.unitId),
          eq(commandQuarantine.commandId, envelope.commandId),
          eq(commandQuarantine.status, "pending"),
        ),
      )
      .returning({ commandId: commandQuarantine.commandId });
    if (recoveredQuarantines.length !== 1) throw new Error("COMMAND_QUARANTINE_TRANSITION_FAILED");
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
    event: NormalizedSyncEventInput,
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
