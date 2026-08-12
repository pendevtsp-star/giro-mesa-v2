import {
  type Database,
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
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";
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
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MovementInput = {
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
};
type NormalizedMovementInput = Omit<MovementInput, "occurredAt"> & {
  occurredAt: string;
};

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

function normalizeMovement(input: MovementInput): NormalizedMovementInput {
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
  return {
    ...input,
    fromCustody: from,
    toCustody: to,
    occurredAt: occurredAt.toISOString(),
  };
}

function isExternalOrigin(input: NormalizedMovementInput) {
  return (
    ((input.movementType === "receive" || input.movementType === "receive_supplier") &&
      input.fromCustody.type === "supplier") ||
    (input.movementType === "reconcile_adjustment" && input.fromCustody.type === "reconciliation")
  );
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
        (!Number.isSafeInteger(input.depositCents) ||
          input.depositCents < 0 ||
          input.depositCents > POSTGRES_INT4_MAX)) ||
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
        sql`select pg_advisory_xact_lock(hashtext(${`returnable-asset-ledger:${organizationId}:${unitId}:${input.assetId}`}))`,
      );
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`returnable-serial:${organizationId}:${asset.id}:${input.serialId}`}))`,
        );
        await tx.execute(
          sql`select id from management_returnable_serials where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and asset_id=${asset.id}::uuid and id=${input.serialId}::uuid for update`,
        );
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
          (latest && (latest.toCustodyType !== from.type || latest.toCustodyId !== from.id)) ||
          (!latest && !isExternalOrigin(normalized))
        )
          throw new ConflictException({
            code: "RETURNABLE_CUSTODY_CHAIN_MISMATCH",
            message: "A origem não corresponde à última custódia registrada para o serial.",
          });
        if (latest && occurredAt < latest.occurredAt)
          throw new ConflictException({
            code: "RETURNABLE_MOVEMENT_BACKDATED",
            message: "Movimento serial não pode anteceder a última custódia registrada.",
          });
      } else {
        if (input.serialId)
          throw new BadRequestException({
            code: "RETURNABLE_SERIAL_NOT_ALLOWED",
            message: "Ativo agregado não aceita serial individual.",
          });
        const rows = await tx
          .select()
          .from(managementReturnableMovements)
          .where(eq(managementReturnableMovements.assetId, asset.id))
          .orderBy(
            asc(managementReturnableMovements.occurredAt),
            asc(managementReturnableMovements.createdAt),
          );
        const latest = rows.at(-1);
        if (latest && occurredAt < latest.occurredAt)
          throw new ConflictException({
            code: "RETURNABLE_MOVEMENT_BACKDATED",
            message: "Aggregate movement cannot predate the latest asset event.",
          });
        if (!isExternalOrigin(normalized)) {
          const available = rows.reduce((balance, movement) => {
            const incoming =
              movement.toCustodyType === from.type && movement.toCustodyId === from.id;
            const outgoing =
              movement.fromCustodyType === from.type && movement.fromCustodyId === from.id;
            return (
              balance + (incoming ? movement.quantity : 0) - (outgoing ? movement.quantity : 0)
            );
          }, 0);
          if (available < input.quantity)
            throw new ConflictException({
              code: "RETURNABLE_INSUFFICIENT_BALANCE",
              message: "Source custody has insufficient balance for this movement.",
            });
        }
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
        const [updatedSerial] = await tx
          .update(managementReturnableSerials)
          .set({ state, version: serial.version + 1, updatedAt: new Date() })
          .where(
            and(
              eq(managementReturnableSerials.id, serial.id),
              eq(managementReturnableSerials.version, serial.version),
            ),
          )
          .returning({ id: managementReturnableSerials.id });
        if (!updatedSerial)
          throw new ConflictException({ code: "RETURNABLE_SERIAL_VERSION_CONFLICT" });
      }
      return this.movementDto(movement, false);
    });
  }

  private async moveReconciliationInTransaction(
    tx: Transaction,
    identityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    input: NormalizedMovementInput,
  ) {
    const occurredAt = new Date(input.occurredAt);
    const requestHash = managementRequestHash("returnable-movement", input);
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
          message: "Idempotency key was already used with another returnable movement.",
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
        message: "Returnable asset not found.",
      });

    let serial: typeof managementReturnableSerials.$inferSelect | undefined;
    if (asset.trackingMode === "serialized") {
      if (!input.serialId || input.quantity !== 1)
        throw new BadRequestException({
          code: "RETURNABLE_SERIAL_REQUIRED",
          message: "Serialized assets require one serial and quantity one.",
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
          message: "Returnable serial not found.",
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
        (latest &&
          (latest.toCustodyType !== input.fromCustody.type ||
            latest.toCustodyId !== input.fromCustody.id)) ||
        (!latest && !isExternalOrigin(input))
      )
        throw new ConflictException({
          code: "RETURNABLE_CUSTODY_CHAIN_MISMATCH",
          message: "Source does not match the serial custody chain.",
        });
      if (latest && occurredAt < latest.occurredAt)
        throw new ConflictException({
          code: "RETURNABLE_MOVEMENT_BACKDATED",
          message: "Serialized movement cannot predate the latest custody event.",
        });
    } else {
      if (input.serialId)
        throw new BadRequestException({
          code: "RETURNABLE_SERIAL_NOT_ALLOWED",
          message: "Aggregate assets do not accept a serial.",
        });
      const rows = await tx
        .select()
        .from(managementReturnableMovements)
        .where(eq(managementReturnableMovements.assetId, asset.id))
        .orderBy(
          asc(managementReturnableMovements.occurredAt),
          asc(managementReturnableMovements.createdAt),
        );
      const latest = rows.at(-1);
      if (latest && occurredAt < latest.occurredAt)
        throw new ConflictException({
          code: "RETURNABLE_MOVEMENT_BACKDATED",
          message: "Aggregate movement cannot predate the latest asset event.",
        });
      if (!isExternalOrigin(input)) {
        const available = rows.reduce((balance, movement) => {
          const incoming =
            movement.toCustodyType === input.fromCustody.type &&
            movement.toCustodyId === input.fromCustody.id;
          const outgoing =
            movement.fromCustodyType === input.fromCustody.type &&
            movement.fromCustodyId === input.fromCustody.id;
          return balance + (incoming ? movement.quantity : 0) - (outgoing ? movement.quantity : 0);
        }, 0);
        if (available < input.quantity)
          throw new ConflictException({
            code: "RETURNABLE_INSUFFICIENT_BALANCE",
            message: "Source custody has insufficient balance for this movement.",
          });
      }
    }

    const [movement] = await tx
      .insert(managementReturnableMovements)
      .values({
        organizationId,
        unitId,
        assetId: asset.id,
        serialId: serial?.id,
        movementType: "reconcile_adjustment",
        quantity: input.quantity,
        fromCustodyType: input.fromCustody.type,
        fromCustodyId: input.fromCustody.id,
        toCustodyType: input.toCustody.type,
        toCustodyId: input.toCustody.id,
        reason: input.reason?.trim(),
        idempotencyKey: key,
        requestHash,
        actorIdentityId: identityId,
        approverIdentityId: identityId,
        occurredAt,
      })
      .returning();
    if (!movement) throw new Error("Returnable reconciliation insert returned no row.");
    if (serial) {
      const [updatedSerial] = await tx
        .update(managementReturnableSerials)
        .set({ state: "in_custody", version: serial.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(managementReturnableSerials.id, serial.id),
            eq(managementReturnableSerials.version, serial.version),
          ),
        )
        .returning({ id: managementReturnableSerials.id });
      if (!updatedSerial)
        throw new ConflictException({ code: "RETURNABLE_SERIAL_VERSION_CONFLICT" });
    }
    return this.movementDto(movement, false);
  }

  async reconcile(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: {
      assetId: string;
      custody: Custody;
      physicalQuantity?: number;
      physicalSerialIds?: string[];
      occurredAt: string;
      reason: string;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    const key = requiredKey(idempotencyKey);
    const target = custody(input.custody, "custody");
    const occurredAt = new Date(input.occurredAt);
    if (
      Number.isNaN(occurredAt.valueOf()) ||
      input.reason.trim().length < 3 ||
      input.reason.length > 240
    )
      throw new BadRequestException({
        code: "RETURNABLE_RECONCILIATION_INVALID",
        message: "Reconciliation requires a valid timestamp and reason.",
      });

    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`returnable-asset-ledger:${organizationId}:${unitId}:${input.assetId}`}))`,
      );
      await tx.execute(
        sql`select id from management_returnable_assets where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.assetId}::uuid for update`,
      );
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
          message: "Returnable asset not found.",
        });
      const movements = await tx
        .select()
        .from(managementReturnableMovements)
        .where(eq(managementReturnableMovements.assetId, asset.id))
        .orderBy(
          asc(managementReturnableMovements.occurredAt),
          asc(managementReturnableMovements.createdAt),
        );

      if (asset.trackingMode === "serialized") {
        const physicalSerialIds = input.physicalSerialIds;
        if (
          !physicalSerialIds ||
          new Set(physicalSerialIds).size !== physicalSerialIds.length ||
          (input.physicalQuantity !== undefined &&
            input.physicalQuantity !== physicalSerialIds.length)
        )
          throw new BadRequestException({
            code: "RETURNABLE_SERIAL_INVENTORY_INVALID",
            message: "Serialized reconciliation requires unique serials and a coherent count.",
          });
        await tx.execute(
          sql`select id from management_returnable_serials where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and asset_id=${asset.id}::uuid order by id for update`,
        );
        const serials = await tx
          .select()
          .from(managementReturnableSerials)
          .where(
            and(
              eq(managementReturnableSerials.organizationId, organizationId),
              eq(managementReturnableSerials.unitId, unitId),
              eq(managementReturnableSerials.assetId, asset.id),
            ),
          )
          .orderBy(asc(managementReturnableSerials.id));
        const serialById = new Map(serials.map((serial) => [serial.id, serial]));
        if (physicalSerialIds.some((serialId) => !serialById.has(serialId)))
          throw new BadRequestException({
            code: "RETURNABLE_SERIAL_INVENTORY_INVALID",
            message: "Physical count contains a serial outside this asset.",
          });
        const latestBySerial = new Map<string, typeof managementReturnableMovements.$inferSelect>();
        for (const movement of movements) {
          if (movement.serialId) latestBySerial.set(movement.serialId, movement);
        }
        const expectedSerialIds = serials
          .filter((serial) => {
            const latest = latestBySerial.get(serial.id);
            return latest?.toCustodyType === target.type && latest.toCustodyId === target.id;
          })
          .map((serial) => serial.id);
        const physical = new Set(physicalSerialIds);
        const expected = new Set(expectedSerialIds);
        const missing = expectedSerialIds.filter((serialId) => !physical.has(serialId));
        const unexpected = physicalSerialIds.filter((serialId) => !expected.has(serialId));
        const reconciliationCustody: Custody = {
          type: "reconciliation",
          id: "physical-count",
        };
        const adjustments: Awaited<
          ReturnType<ReturnablesService["moveReconciliationInTransaction"]>
        >[] = [];
        for (const serialId of [...missing, ...unexpected]) {
          const missingFromTarget = expected.has(serialId);
          const latest = latestBySerial.get(serialId);
          const fromCustody: Custody = missingFromTarget
            ? target
            : latest?.toCustodyType && latest.toCustodyId
              ? { type: latest.toCustodyType as CustodyType, id: latest.toCustodyId }
              : reconciliationCustody;
          const toCustody = missingFromTarget ? reconciliationCustody : target;
          const movementKey = `returnable-serial-reconcile:${managementRequestHash(
            "returnable-serial-reconcile",
            { key, serialId, fromCustody, toCustody },
          )}`;
          adjustments.push(
            await this.moveReconciliationInTransaction(
              tx,
              identityId,
              organizationId,
              unitId,
              movementKey,
              normalizeMovement({
                assetId: asset.id,
                serialId,
                movementType: "reconcile_adjustment",
                quantity: 1,
                fromCustody,
                toCustody,
                occurredAt: input.occurredAt,
                reason: input.reason,
              }),
            ),
          );
        }
        return {
          expectedQuantity: expectedSerialIds.length,
          physicalQuantity: physicalSerialIds.length,
          adjustmentQuantity: physicalSerialIds.length - expectedSerialIds.length,
          movementId: adjustments[0]?.movementId ?? null,
          movementIds: adjustments.map((movement) => movement.movementId),
          idempotentReplay:
            adjustments.length > 0 && adjustments.every((movement) => movement.idempotentReplay),
        };
      }

      if (
        input.physicalSerialIds !== undefined ||
        !Number.isSafeInteger(input.physicalQuantity) ||
        (input.physicalQuantity ?? -1) < 0
      )
        throw new BadRequestException({
          code: "RETURNABLE_PHYSICAL_COUNT_INVALID",
          message: "Physical count must be a non-negative integer.",
        });
      const physicalQuantity = input.physicalQuantity as number;
      const expectedQuantity = movements.reduce((balance, movement) => {
        const incoming =
          movement.toCustodyType === target.type && movement.toCustodyId === target.id;
        const outgoing =
          movement.fromCustodyType === target.type && movement.fromCustodyId === target.id;
        return balance + (incoming ? movement.quantity : 0) - (outgoing ? movement.quantity : 0);
      }, 0);
      const adjustmentQuantity = physicalQuantity - expectedQuantity;
      if (adjustmentQuantity === 0)
        return {
          expectedQuantity,
          physicalQuantity,
          adjustmentQuantity,
          movementId: null,
          movementIds: [],
        };
      const reconciliationCustody: Custody = {
        type: "reconciliation",
        id: "physical-count",
      };
      const movement = await this.moveReconciliationInTransaction(
        tx,
        identityId,
        organizationId,
        unitId,
        key,
        normalizeMovement({
          assetId: input.assetId,
          movementType: "reconcile_adjustment",
          quantity: Math.abs(adjustmentQuantity),
          fromCustody: adjustmentQuantity > 0 ? reconciliationCustody : target,
          toCustody: adjustmentQuantity > 0 ? target : reconciliationCustody,
          occurredAt: input.occurredAt,
          reason: input.reason,
        }),
      );
      return {
        expectedQuantity,
        physicalQuantity,
        adjustmentQuantity,
        movementId: movement.movementId,
        movementIds: [movement.movementId],
        idempotentReplay: movement.idempotentReplay,
      };
    });
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
