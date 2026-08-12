import type { OperationalCommandInput } from "@giromesa/contracts";
import {
  auditEvents,
  deviceEnrollments,
  operationalCommands,
  organizations,
  outboxEvents,
} from "@giromesa/db";
import { billingAccess } from "@giromesa/domain";
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

const CLOSURE_COMMANDS = new Set([
  "order.closed",
  "shift.closed",
  "cashier.closed",
  "payment.completed",
  "fiscal.completed",
]);

@Injectable()
export class OperationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async accept(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: OperationalCommandInput,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const [organization] = await this.database.db
      .select({
        state: organizations.billingState,
        operationalClosureUntil: organizations.operationalClosureUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();
    const access = billingAccess(
      organization.state,
      new Date(),
      organization.operationalClosureUntil,
    );
    if (access !== "full" && !(access === "finish_shift" && CLOSURE_COMMANDS.has(input.type))) {
      throw new HttpException(
        {
          code: "OPERATION_RESTRICTED",
          message:
            "Novas operações estão bloqueadas; cobrança, exportação e suporte continuam disponíveis.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const [device] = await this.database.db
      .select({ id: deviceEnrollments.id })
      .from(deviceEnrollments)
      .where(
        and(
          eq(deviceEnrollments.id, input.deviceId),
          eq(deviceEnrollments.organizationId, organizationId),
          eq(deviceEnrollments.unitId, unitId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    if (!device)
      throw new ForbiddenException({
        code: "DEVICE_NOT_ENROLLED",
        message: "Dispositivo não cadastrado nesta unidade.",
      });

    const result = await this.database.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(operationalCommands)
        .values({
          id: input.id,
          organizationId,
          unitId,
          actorIdentityId: identityId,
          deviceId: input.deviceId,
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          version: input.version,
          occurredAt: new Date(input.occurredAt),
          payload: input.payload,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) return null;
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "operational_command.accepted",
        entityType: "operational_command",
        entityId: inserted.id,
        metadata: { type: inserted.type, deviceId: inserted.deviceId },
      });
      await tx.insert(outboxEvents).values({
        organizationId,
        unitId,
        topic: "operational.command_accepted",
        aggregateType: "operational_command",
        aggregateId: inserted.id,
        payload: { commandId: inserted.id, organizationId, unitId, type: inserted.type },
      });
      return inserted;
    });
    if (result) return { duplicate: false, command: result };

    const [existing] = await this.database.db
      .select()
      .from(operationalCommands)
      .where(
        and(
          eq(operationalCommands.organizationId, organizationId),
          eq(operationalCommands.unitId, unitId),
          eq(operationalCommands.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Idempotency conflict without an existing command");
    return { duplicate: true, command: existing };
  }
}
