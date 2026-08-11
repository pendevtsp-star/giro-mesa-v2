import {
  managementReturnableAssets,
  managementReturnableMovements,
  managementReturnableSerials,
} from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";

const RETURNABLE_ROLES = ["owner", "manager", "inventory"] as const;
const CUSTODY_TYPES = [
  "supplier",
  "location",
  "table",
  "waiter",
  "shift",
  "reconciliation",
] as const;
type CustodyType = (typeof CUSTODY_TYPES)[number];
type Custody = { type: CustodyType; id: string };
type MovementType =
  | "receive"
  | "circulate"
  | "return_empty"
  | "send_supplier"
  | "receive_supplier"
  | "broken"
  | "lost"
  | "reconcile_adjustment";

function requiredKey(value: string) {
  const key = value.trim();
  if (key.length < 8 || key.length > 160)
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "Idempotency-Key deve ter entre 8 e 160 caracteres.",
    });
  return key;
}

function custody(value: Custody | undefined, field: string) {
  if (
    !value ||
    !CUSTODY_TYPES.includes(value.type) ||
    value.id.trim().length === 0 ||
    value.id.length > 160
  )
    throw new BadRequestException({
      code: "RETURNABLE_CUSTODY_INVALID",
      message: `${field} exige tipo e identificador de custódia válidos.`,
    });
  return { type: value.type, id: value.id.trim() };
}

@Injectable()
export class ReturnablesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireRole(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      RETURNABLE_ROLES,
    );
    if (
      !roles.some(
        (role) =>
          RETURNABLE_ROLES.includes(role.role as (typeof RETURNABLE_ROLES)[number]) &&
          (role.unitId === null || role.unitId === unitId),
      )
    )
      throw new ForbiddenException({
        code: "RETURNABLE_ROLE_DENIED",
        message: "Movimentação de retornáveis não autorizada nesta unidade.",
      });
  }

  async createAsset(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: {
      sku: string;
      name: string;
      trackingMode: "aggregate" | "serialized";
      depositCents?: number;
      serialNumbers: string[];
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const key = requiredKey(idempotencyKey);
    const serialNumbers = input.serialNumbers.map((serial) => serial.trim());
    if (
      input.sku.trim().length === 0 ||
      input.sku.length > 80 ||
      input.name.trim().length === 0 ||
      input.name.length > 160 ||
      (input.depositCents !== undefined &&
        (!Number.isSafeInteger(input.depositCents) || input.depositCents < 0)) ||
      new Set(serialNumbers).size !== serialNumbers.length ||
      serialNumbers.some((serial) => serial.length === 0 || serial.length > 120) ||
      (input.trackingMode === "serialized" && serialNumbers.length === 0) ||
      (input.trackingMode === "aggregate" && serialNumbers.length > 0)
    )
      throw new BadRequestException({
        code: "RETURNABLE_ASSET_INVALID",
        message: "Ativo retornável inválido para o modo de rastreamento informado.",
      });
    const requestHash = managementRequestHash("returnable-asset", {
      ...input,
      sku: input.sku.trim(),
      name: input.name.trim(),
      serialNumbers,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`returnable-asset:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(managementReturnableAssets)
        .where(
          and(
            eq(managementReturnableAssets.organizationId, organizationId),
            eq(managementReturnableAssets.unitId, unitId),
            eq(managementReturnableAssets.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outro ativo retornável.",
          });
        const serials = await tx
          .select()
          .from(managementReturnableSerials)
          .where(eq(managementReturnableSerials.assetId, existing.id))
          .orderBy(asc(managementReturnableSerials.serialNumber));
        return this.assetDto(existing, serials, true);
      }
      const [asset] = await tx
        .insert(managementReturnableAssets)
        .values({
          organizationId,
          unitId,
          sku: input.sku.trim(),
          name: input.name.trim(),
          trackingMode: input.trackingMode,
          depositCents: input.depositCents,
          idempotencyKey: key,
          requestHash,
        })
        .returning();
      if (!asset) throw new Error("Returnable asset insert returned no row.");
      const serials =
        serialNumbers.length === 0
          ? []
          : await tx
              .insert(managementReturnableSerials)
              .values(
                serialNumbers.map((serialNumber) => ({
                  organizationId,
                  unitId,
                  assetId: asset.id,
                  serialNumber,
                })),
              )
              .returning();
      return this.assetDto(asset, serials, false);
    });
  }

  async move(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: {
      assetId: string;
      serialId?: string;
      movementType: MovementType;
      quantity: number;
      fromCustody: Custody;
      toCustody: Custody;
      supplierReference?: string;
      lotReference?: string;
      reason?: string;
      occurredAt: string;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const key = requiredKey(idempotencyKey);
    const from = custody(input.fromCustody, "fromCustody");
    const to = custody(input.toCustody, "toCustody");
    const occurredAt = new Date(input.occurredAt);
    if (
      !Number.isSafeInteger(input.quantity) ||
      input.quantity <= 0 ||
      Number.isNaN(occurredAt.valueOf()) ||
      (from.type === to.type && from.id === to.id) ||
      (input.reason !== undefined && (input.reason.trim().length < 3 || input.reason.length > 240))
    )
      throw new BadRequestException({
        code: "RETURNABLE_MOVEMENT_INVALID",
        message: "Movimento retornável exige quantidade, data e custódias distintas válidas.",
      });
    const normalized = {
      ...input,
      fromCustody: from,
      toCustody: to,
      occurredAt: occurredAt.toISOString(),
    };
    const requestHash = managementRequestHash("returnable-movement", normalized);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`returnable-movement:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(managementReturnableMovements)
        .where(
          and(
            eq(managementReturnableMovements.organizationId, organizationId),
            eq(managementReturnableMovements.unitId, unitId),
            eq(managementReturnableMovements.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outro movimento retornável.",
          });
        return this.movementDto(existing, true);
      }
      const [asset] = await tx
        .select()
        .from(managementReturnableAssets)
        .where(
          and(
            eq(managementReturnableAssets.organizationId, organizationId),
            eq(managementReturnableAssets.unitId, unitId),
            eq(managementReturnableAssets.id, input.assetId),
            eq(managementReturnableAssets.active, true),
          ),
        )
        .limit(1);
      if (!asset)
        throw new NotFoundException({
          code: "RETURNABLE_ASSET_NOT_FOUND",
          message: "Ativo não encontrado.",
        });
      let serial: typeof managementReturnableSerials.$inferSelect | undefined;
      if (asset.trackingMode === "serialized") {
        if (!input.serialId || input.quantity !== 1)
          throw new BadRequestException({
            code: "RETURNABLE_SERIAL_REQUIRED",
            message: "Ativo serializado exige um serial e quantidade igual a um.",
          });
        [serial] = await tx
          .select()
          .from(managementReturnableSerials)
          .where(
            and(
              eq(managementReturnableSerials.organizationId, organizationId),
              eq(managementReturnableSerials.unitId, unitId),
              eq(managementReturnableSerials.assetId, asset.id),
              eq(managementReturnableSerials.id, input.serialId),
            ),
          )
          .limit(1);
        if (!serial)
          throw new NotFoundException({
            code: "RETURNABLE_SERIAL_NOT_FOUND",
            message: "Serial não encontrado.",
          });
        const [latest] = await tx
          .select()
          .from(managementReturnableMovements)
          .where(eq(managementReturnableMovements.serialId, serial.id))
          .orderBy(
            desc(managementReturnableMovements.occurredAt),
            desc(managementReturnableMovements.createdAt),
          )
          .limit(1);
        if (
          latest?.toCustodyType &&
          (latest.toCustodyType !== from.type || latest.toCustodyId !== from.id)
        )
          throw new ConflictException({
            code: "RETURNABLE_CUSTODY_CHAIN_MISMATCH",
            message: "A origem não corresponde à última custódia registrada para o serial.",
          });
      } else if (input.serialId) {
        throw new BadRequestException({
          code: "RETURNABLE_SERIAL_NOT_ALLOWED",
          message: "Ativo agregado não aceita serial individual.",
        });
      }
      const [movement] = await tx
        .insert(managementReturnableMovements)
        .values({
          organizationId,
          unitId,
          assetId: asset.id,
          serialId: serial?.id,
          movementType: input.movementType,
          quantity: input.quantity,
          fromCustodyType: from.type,
          fromCustodyId: from.id,
          toCustodyType: to.type,
          toCustodyId: to.id,
          supplierReference: input.supplierReference?.trim(),
          lotReference: input.lotReference?.trim(),
          reason: input.reason?.trim(),
          idempotencyKey: key,
          requestHash,
          actorIdentityId: identityId,
          approverIdentityId:
            input.movementType === "reconcile_adjustment" ? identityId : undefined,
          occurredAt,
        })
        .returning();
      if (!movement) throw new Error("Returnable movement insert returned no row.");
      if (serial) {
        const state =
          input.movementType === "broken"
            ? "broken"
            : input.movementType === "lost"
              ? "lost"
              : to.type === "supplier"
                ? "with_supplier"
                : "in_custody";
        await tx
          .update(managementReturnableSerials)
          .set({ state, updatedAt: new Date() })
          .where(eq(managementReturnableSerials.id, serial.id));
      }
      return this.movementDto(movement, false);
    });
  }

  async reconcile(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: {
      assetId: string;
      custody: Custody;
      physicalQuantity: number;
      occurredAt: string;
      reason: string;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const target = custody(input.custody, "custody");
    if (!Number.isSafeInteger(input.physicalQuantity) || input.physicalQuantity < 0)
      throw new BadRequestException({
        code: "RETURNABLE_PHYSICAL_COUNT_INVALID",
        message: "A contagem física deve ser um inteiro não negativo.",
      });
    const movements = await this.ledger(identityId, organizationId, unitId, input.assetId);
    const expectedQuantity = movements.reduce((balance, movement) => {
      const incoming = movement.toCustodyType === target.type && movement.toCustodyId === target.id;
      const outgoing =
        movement.fromCustodyType === target.type && movement.fromCustodyId === target.id;
      return balance + (incoming ? movement.quantity : 0) - (outgoing ? movement.quantity : 0);
    }, 0);
    const adjustmentQuantity = input.physicalQuantity - expectedQuantity;
    if (adjustmentQuantity === 0)
      return {
        expectedQuantity,
        physicalQuantity: input.physicalQuantity,
        adjustmentQuantity,
        movementId: null,
      };
    const reconciliationCustody: Custody = { type: "reconciliation", id: "physical-count" };
    const movement = await this.move(identityId, organizationId, unitId, idempotencyKey, {
      assetId: input.assetId,
      movementType: "reconcile_adjustment",
      quantity: Math.abs(adjustmentQuantity),
      fromCustody: adjustmentQuantity > 0 ? reconciliationCustody : target,
      toCustody: adjustmentQuantity > 0 ? target : reconciliationCustody,
      occurredAt: input.occurredAt,
      reason: input.reason,
    });
    return {
      expectedQuantity,
      physicalQuantity: input.physicalQuantity,
      adjustmentQuantity,
      movementId: movement.movementId,
      idempotentReplay: movement.idempotentReplay,
    };
  }

  async ledger(identityId: string, organizationId: string, unitId: string, assetId: string) {
    await this.requireRole(identityId, organizationId, unitId);
    const rows = await this.database.db
      .select()
      .from(managementReturnableMovements)
      .where(
        and(
          eq(managementReturnableMovements.organizationId, organizationId),
          eq(managementReturnableMovements.unitId, unitId),
          eq(managementReturnableMovements.assetId, assetId),
        ),
      )
      .orderBy(
        asc(managementReturnableMovements.occurredAt),
        asc(managementReturnableMovements.createdAt),
      );
    return rows.map((movement) => this.movementDto(movement, false));
  }

  private assetDto(
    asset: typeof managementReturnableAssets.$inferSelect,
    serials: (typeof managementReturnableSerials.$inferSelect)[],
    idempotentReplay: boolean,
  ) {
    return {
      assetId: asset.id,
      sku: asset.sku,
      name: asset.name,
      trackingMode: asset.trackingMode,
      depositCents: asset.depositCents,
      serials: serials.map((serial) => ({
        serialId: serial.id,
        serialNumber: serial.serialNumber,
        state: serial.state,
      })),
      idempotentReplay,
    };
  }

  private movementDto(
    movement: typeof managementReturnableMovements.$inferSelect,
    idempotentReplay: boolean,
  ) {
    return { movementId: movement.id, ...movement, idempotentReplay };
  }
}
