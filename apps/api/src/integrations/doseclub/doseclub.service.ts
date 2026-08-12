import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.module.js";
import { canonicalJson } from "../../sync/canonical-json.js";
import type {
  DoseClubV1Consumption,
  DoseClubV1Reversal,
  DoseClubV1Sale,
  DoseClubV2Operation,
} from "./doseclub.schemas.js";

type PurchaseSnapshot = DoseClubV2Operation["purchaseSnapshot"];

type StateRow = {
  id: string;
  contract_version: "v1" | "v2";
  eligible_product_ids: string[];
  external_club_id: string;
  purchase_snapshot: PurchaseSnapshot;
  remaining_doses: number;
  reserved_doses: number;
  sale_type: "individual" | "combo_pool";
  version: number;
};

type OperationRow = {
  acknowledged_at: Date | string;
  contract_version: "v1" | "v2";
  external_club_id: string;
  operation_id: string;
  outcome: "accepted" | "reconciled";
  request_fingerprint: string;
  version: number;
};

type MappingRow = {
  allow_negative: boolean;
  balance_id: string | null;
  dimension: "mass" | "volume" | "count";
  inventory_item_id: string;
  mapping_id: string;
  quantity: string | null;
  stock_location_id: string;
  unit: string;
};

export type DoseClubV2Acknowledgement = {
  acknowledgedAt: string;
  contractVersion: "v2";
  externalClubId: string;
  operationId: string;
  outcome: "accepted" | "duplicate" | "reconciled";
  version: number;
};

function fingerprint(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function rows<T>(result: Iterable<T>) {
  return [...result];
}

function publicConflict(code: string, message: string): never {
  throw new ConflictException({ statusCode: 409, code, message });
}

function publicBadRequest(code: string, message: string): never {
  throw new BadRequestException({ statusCode: 400, code, message });
}

function timestamp(value: string) {
  const parsed = new Date(value);
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime())) {
    publicBadRequest("DOSECLUB_OCCURRED_AT_INVALID", "A data da operacao e invalida.");
  }
  if (parsed.getTime() > now + 5 * 60_000) {
    publicBadRequest("DOSECLUB_OCCURRED_AT_FUTURE", "A data da operacao esta no futuro.");
  }
  if (parsed.getTime() < now - 90 * 24 * 60 * 60_000) {
    publicConflict("DOSECLUB_OPERATION_EXPIRED", "A operacao excedeu a janela de repeticao.");
  }
  return parsed;
}

function eligibleProductIds(
  input: Extract<DoseClubV2Operation, { operation: "sale" }> | DoseClubV1Sale,
) {
  if (input.saleType === "individual") return [input.productId];
  return [...input.eligibleProductIds];
}

@Injectable()
export class DoseClubService {
  constructor(private readonly database: DatabaseService) {}

  async listBranches() {
    const result = await this.database.db.execute<{
      branch_id: string;
      branch_name: string;
      unit_id: string;
    }>(
      sql`select branch_id, unit_id, branch_name from public.giromesa_doseclub_visible_branches()`,
    );
    return {
      branches: rows(result).map((branch) => ({
        id: branch.branch_id,
        name: branch.branch_name,
        unitId: branch.unit_id,
      })),
    };
  }

  async listProducts() {
    const context = this.requiredContext(false);
    const result = await this.database.db.execute<{
      id: string;
      name: string;
      sku: string | null;
    }>(sql`
      select id, name, sku
      from public.pos_products
      where organization_id = ${context.organizationId}::uuid and active = true
      order by name, id
    `);
    return { products: rows(result).map((product) => ({ ...product, id: product.id })) };
  }

  async stock(productId: string, branchId: string) {
    this.requiredContext(true);
    const mapping = await this.mapping(productId);
    return {
      branchId,
      productId,
      quantity: mapping.quantity ?? "0.000000",
      unit: mapping.unit,
    };
  }

  async receiveV2(input: DoseClubV2Operation): Promise<DoseClubV2Acknowledgement> {
    const context = this.requiredContext(true);
    const occurredAt = timestamp(input.occurredAt);
    const requestFingerprint = fingerprint(input);
    await this.lock(
      context.organizationId,
      context.unitId,
      input.externalClubId,
      input.idempotencyKey,
    );

    const duplicate = await this.knownOperation(input.idempotencyKey);
    if (duplicate) {
      if (duplicate.request_fingerprint !== requestFingerprint) {
        publicConflict(
          "DOSECLUB_IDEMPOTENCY_CONFLICT",
          "A chave de idempotencia ja foi utilizada por outra operacao.",
        );
      }
      return this.acknowledgement(input, "duplicate", duplicate.acknowledged_at);
    }

    if (input.operation === "sale") {
      return this.createV2Sale(input, requestFingerprint, occurredAt);
    }

    const state = await this.stateForUpdate(input.externalClubId);
    if (state?.contract_version !== "v2") {
      publicConflict("DOSECLUB_STATE_NOT_FOUND", "O clube ainda nao foi registrado no GiroMesa.");
    }
    this.assertSnapshot(state, input.purchaseSnapshot);
    if (input.version !== state.version + 1) {
      publicConflict("DOSECLUB_VERSION_CONFLICT", "A sequencia da operacao esta desatualizada.");
    }

    const operationRecordId = randomUUID();
    let outcome: "accepted" | "reconciled" = "accepted";
    let remaining = state.remaining_doses;
    let reserved = state.reserved_doses;

    if (input.operation === "reconcile") {
      if (
        input.localVersion !== state.version ||
        input.expectedRemainingDoses !== state.remaining_doses ||
        input.expectedReservedDoses !== state.reserved_doses
      ) {
        publicConflict(
          "DOSECLUB_RECONCILIATION_REQUIRED",
          "O estado local divergiu do saldo autoritativo do GiroMesa.",
        );
      }
      this.assertEligible(state, input.productId);
      await this.mapping(input.productId);
      outcome = "reconciled";
    } else if (input.operation === "reservation") {
      this.assertEligible(state, input.productId);
      await this.mapping(input.productId);
      if (input.doses > state.remaining_doses - state.reserved_doses) {
        publicConflict("DOSECLUB_BALANCE_UNAVAILABLE", "Nao ha doses disponiveis para a reserva.");
      }
      reserved += input.doses;
    } else if (input.operation === "consumption") {
      this.assertEligible(state, input.productId);
      if (input.doses > state.remaining_doses) {
        publicConflict("DOSECLUB_BALANCE_UNAVAILABLE", "Nao ha doses disponiveis para o consumo.");
      }
      await this.moveStock(
        input.productId,
        input.doses,
        state.purchase_snapshot.doseMlAtPurchase,
        -1,
        operationRecordId,
        occurredAt,
      );
      remaining -= input.doses;
      reserved -= Math.min(reserved, input.doses);
    } else {
      this.assertEligible(state, input.productId);
      const original = await this.originalConsumption(input.originalOperationId, state.id);
      if (!original) {
        publicConflict(
          "DOSECLUB_ORIGINAL_OPERATION_NOT_FOUND",
          "O consumo original nao foi localizado.",
        );
      }
      const originalPayload = original.payload as Record<string, unknown>;
      if (originalPayload.productId !== input.productId || originalPayload.doses !== input.doses) {
        publicConflict(
          "DOSECLUB_REVERSAL_MISMATCH",
          "A reversao nao corresponde ao consumo original.",
        );
      }
      if (remaining + input.doses > state.purchase_snapshot.totalDoses) {
        publicConflict("DOSECLUB_BALANCE_OVERFLOW", "A reversao excederia o saldo contratado.");
      }
      await this.moveStock(
        input.productId,
        input.doses,
        state.purchase_snapshot.doseMlAtPurchase,
        1,
        operationRecordId,
        occurredAt,
      );
      remaining += input.doses;
    }

    await this.updateState(state.id, input.version, remaining, reserved);
    await this.recordOperation({
      id: operationRecordId,
      stateId: state.id,
      externalClubId: input.externalClubId,
      operationId: input.operationId,
      originalOperationId: input.operation === "reversal" ? input.originalOperationId : null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      contractVersion: "v2",
      operation: input.operation,
      version: input.version,
      outcome,
      payload: input,
      occurredAt,
    });
    await this.publish(operationRecordId, input.externalClubId, input.operation, input.version);
    return this.acknowledgement(input, outcome);
  }

  async receiveV1Sale(input: DoseClubV1Sale) {
    const context = this.requiredContext(true);
    const requestFingerprint = fingerprint(input);
    await this.lock(
      context.organizationId,
      context.unitId,
      input.externalClubId,
      input.idempotencyKey,
    );
    const duplicate = await this.knownOperation(input.idempotencyKey);
    if (duplicate) return this.v1Duplicate(input, duplicate, requestFingerprint);
    const knownState = await this.stateForUpdate(input.externalClubId);
    if (knownState) {
      publicConflict("DOSECLUB_STATE_EXISTS", "O clube ja foi registrado no GiroMesa.");
    }
    for (const productId of eligibleProductIds(input)) await this.mapping(productId);
    const operationRecordId = randomUUID();
    const snapshot: PurchaseSnapshot = {
      volumeMlAtPurchase: input.totalDoses * input.doseMl,
      doseMlAtPurchase: input.doseMl,
      totalDoses: input.totalDoses,
      remainingDoses: input.totalDoses,
    };
    const stateId = await this.insertState({
      externalClubId: input.externalClubId,
      externalOfferId: input.externalOfferId,
      externalCustomerId: input.externalCustomerId ?? null,
      saleType: input.saleType,
      eligibleProductIds: eligibleProductIds(input),
      purchaseSnapshot: snapshot,
      contractVersion: "v1",
      version: 0,
    });
    await this.recordOperation({
      id: operationRecordId,
      stateId,
      externalClubId: input.externalClubId,
      operationId: input.idempotencyKey,
      originalOperationId: null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      contractVersion: "v1",
      operation: "sale",
      version: 0,
      outcome: "accepted",
      payload: input,
      occurredAt: new Date(),
    });
    await this.publish(operationRecordId, input.externalClubId, "sale", 0);
    return {
      contractVersion: "v1" as const,
      externalClubId: input.externalClubId,
      outcome: "accepted" as const,
      status: "ok" as const,
    };
  }

  async receiveV1Consumption(input: DoseClubV1Consumption) {
    return this.receiveV1DoseMutation(input, "consumption");
  }

  async receiveV1Reversal(input: DoseClubV1Reversal) {
    return this.receiveV1DoseMutation(input, "reversal");
  }

  private async receiveV1DoseMutation(
    input: DoseClubV1Consumption | DoseClubV1Reversal,
    operation: "consumption" | "reversal",
  ) {
    const context = this.requiredContext(true);
    const requestFingerprint = fingerprint(input);
    await this.lock(
      context.organizationId,
      context.unitId,
      input.externalClubId,
      input.idempotencyKey,
    );
    const duplicate = await this.knownOperation(input.idempotencyKey);
    if (duplicate) return this.v1Duplicate(input, duplicate, requestFingerprint);
    const state = await this.stateForUpdate(input.externalClubId);
    if (state?.contract_version !== "v1") {
      publicConflict("DOSECLUB_STATE_NOT_FOUND", "O clube ainda nao foi registrado no GiroMesa.");
    }
    this.assertEligible(state, input.productId);
    if (input.doseMl !== state.purchase_snapshot.doseMlAtPurchase) {
      publicConflict("DOSECLUB_DOSE_MISMATCH", "O volume da dose diverge do contrato de compra.");
    }
    const operationRecordId = randomUUID();
    let remaining = state.remaining_doses;
    let originalOperationId: string | null = null;
    if (operation === "consumption") {
      if (remaining < 1) {
        publicConflict("DOSECLUB_BALANCE_UNAVAILABLE", "Nao ha doses disponiveis para o consumo.");
      }
      await this.moveStock(input.productId, 1, input.doseMl, -1, operationRecordId, new Date());
      remaining -= 1;
    } else {
      const reversal = input as DoseClubV1Reversal;
      const original = await this.originalConsumption(reversal.externalConsumptionId, state.id);
      if (!original) {
        publicConflict(
          "DOSECLUB_ORIGINAL_OPERATION_NOT_FOUND",
          "O consumo original nao foi localizado.",
        );
      }
      const originalPayload = original.payload as Record<string, unknown>;
      if (
        original.idempotency_key !== reversal.originalIdempotencyKey ||
        originalPayload.productId !== reversal.productId ||
        originalPayload.doseMl !== reversal.doseMl
      ) {
        publicConflict(
          "DOSECLUB_REVERSAL_MISMATCH",
          "A reversao nao corresponde ao consumo original.",
        );
      }
      if (remaining + 1 > state.purchase_snapshot.totalDoses) {
        publicConflict("DOSECLUB_BALANCE_OVERFLOW", "A reversao excederia o saldo contratado.");
      }
      await this.moveStock(input.productId, 1, input.doseMl, 1, operationRecordId, new Date());
      remaining += 1;
      originalOperationId = reversal.externalConsumptionId;
    }
    const nextVersion = state.version + 1;
    await this.updateState(state.id, nextVersion, remaining, state.reserved_doses);
    const operationId =
      operation === "consumption"
        ? (input as DoseClubV1Consumption).externalConsumptionId
        : (input as DoseClubV1Reversal).externalReversalId;
    await this.recordOperation({
      id: operationRecordId,
      stateId: state.id,
      externalClubId: input.externalClubId,
      operationId,
      originalOperationId,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      contractVersion: "v1",
      operation,
      version: nextVersion,
      outcome: "accepted",
      payload: input,
      occurredAt: new Date(),
    });
    await this.publish(operationRecordId, input.externalClubId, operation, nextVersion);
    return {
      contractVersion: "v1" as const,
      externalClubId: input.externalClubId,
      operationId,
      outcome: "accepted" as const,
      status: "ok" as const,
    };
  }

  private requiredContext(requireUnit: boolean) {
    const context = this.database.tenantContext;
    if (!context || (requireUnit && !context.unitId)) {
      throw new NotFoundException({
        statusCode: 404,
        code: "DOSECLUB_BRANCH_NOT_FOUND",
        message: "A filial solicitada nao esta habilitada para a integracao.",
      });
    }
    return context as typeof context & { unitId: string };
  }

  private async lock(organizationId: string, unitId: string, clubId: string, key: string) {
    await this.database.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`doseclub-idempotency:${organizationId}:${unitId}:${key}`}::text, 0))`,
    );
    await this.database.db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`doseclub-club:${organizationId}:${unitId}:${clubId}`}::text, 0))`,
    );
  }

  private async knownOperation(idempotencyKey: string) {
    const result = await this.database.db.execute<OperationRow>(sql`
      select acknowledged_at, contract_version, external_club_id, operation_id, outcome,
             request_fingerprint, version
      from public.doseclub_operations
      where idempotency_key = ${idempotencyKey}
      limit 1
    `);
    return rows(result)[0] ?? null;
  }

  private async stateForUpdate(externalClubId: string) {
    const result = await this.database.db.execute<StateRow>(sql`
      select id, contract_version, eligible_product_ids, external_club_id, purchase_snapshot,
             remaining_doses, reserved_doses, sale_type, version
      from public.doseclub_states
      where external_club_id = ${externalClubId}
      for update
    `);
    return rows(result)[0] ?? null;
  }

  private async mapping(productId: string) {
    const result = await this.database.db.execute<MappingRow>(sql`
      select mapping.id as mapping_id, mapping.inventory_item_id, mapping.stock_location_id,
             item.dimension, item.unit, item.allow_negative,
             balance.id as balance_id, balance.quantity
      from public.doseclub_product_mappings as mapping
      inner join public.management_inventory_items as item
        on item.organization_id = mapping.organization_id
       and item.unit_id = mapping.unit_id
       and item.id = mapping.inventory_item_id
      inner join public.management_stock_balances as balance
        on balance.organization_id = mapping.organization_id
       and balance.unit_id = mapping.unit_id
       and balance.location_id = mapping.stock_location_id
       and balance.inventory_item_id = mapping.inventory_item_id
      where mapping.active = true
        and item.active = true
        and (mapping.external_product_id = ${productId} or mapping.product_id::text = ${productId})
      for update of mapping, balance
    `);
    const mapping = rows(result)[0];
    if (!mapping?.balance_id || mapping.dimension !== "volume" || mapping.unit !== "ml") {
      publicConflict(
        "DOSECLUB_PRODUCT_NOT_MAPPED",
        "O produto nao possui um mapeamento ativo de estoque em mililitros.",
      );
    }
    return mapping;
  }

  private assertEligible(state: StateRow, productId: string) {
    if (!state.eligible_product_ids.includes(productId)) {
      publicConflict("DOSECLUB_PRODUCT_NOT_ELIGIBLE", "O produto nao pertence a este clube.");
    }
  }

  private assertSnapshot(state: StateRow, snapshot: PurchaseSnapshot) {
    const known = state.purchase_snapshot;
    if (
      snapshot.volumeMlAtPurchase !== known.volumeMlAtPurchase ||
      snapshot.doseMlAtPurchase !== known.doseMlAtPurchase ||
      snapshot.totalDoses !== known.totalDoses ||
      snapshot.remainingDoses !== state.remaining_doses
    ) {
      publicConflict(
        "DOSECLUB_SNAPSHOT_CONFLICT",
        "O snapshot de compra divergiu do estado autoritativo do GiroMesa.",
      );
    }
  }

  private async createV2Sale(
    input: Extract<DoseClubV2Operation, { operation: "sale" }>,
    requestFingerprint: string,
    occurredAt: Date,
  ) {
    if (input.purchaseSnapshot.remainingDoses !== input.purchaseSnapshot.totalDoses) {
      publicConflict(
        "DOSECLUB_SALE_SNAPSHOT_INVALID",
        "Uma nova venda deve iniciar com o saldo integral.",
      );
    }
    const knownState = await this.stateForUpdate(input.externalClubId);
    if (knownState)
      publicConflict("DOSECLUB_STATE_EXISTS", "O clube ja foi registrado no GiroMesa.");
    for (const productId of eligibleProductIds(input)) await this.mapping(productId);
    const stateId = await this.insertState({
      externalClubId: input.externalClubId,
      externalOfferId: input.externalOfferId,
      externalCustomerId: input.externalCustomerId ?? null,
      saleType: input.saleType,
      eligibleProductIds: eligibleProductIds(input),
      purchaseSnapshot: input.purchaseSnapshot,
      contractVersion: "v2",
      version: 1,
    });
    const operationRecordId = randomUUID();
    await this.recordOperation({
      id: operationRecordId,
      stateId,
      externalClubId: input.externalClubId,
      operationId: input.operationId,
      originalOperationId: null,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      contractVersion: "v2",
      operation: "sale",
      version: 1,
      outcome: "accepted",
      payload: input,
      occurredAt,
    });
    await this.publish(operationRecordId, input.externalClubId, "sale", 1);
    return this.acknowledgement(input, "accepted");
  }

  private async insertState(input: {
    contractVersion: "v1" | "v2";
    eligibleProductIds: string[];
    externalClubId: string;
    externalCustomerId: string | null;
    externalOfferId: string;
    purchaseSnapshot: PurchaseSnapshot;
    saleType: "individual" | "combo_pool";
    version: number;
  }) {
    const context = this.requiredContext(true);
    const result = await this.database.db.execute<{ id: string }>(sql`
      insert into public.doseclub_states (
        organization_id, unit_id, external_club_id, external_offer_id, external_customer_id,
        sale_type, eligible_product_ids, purchase_snapshot, contract_version, version,
        remaining_doses, reserved_doses
      ) values (
        ${context.organizationId}::uuid, ${context.unitId}::uuid, ${input.externalClubId},
        ${input.externalOfferId}, ${input.externalCustomerId}, ${input.saleType},
        ${JSON.stringify(input.eligibleProductIds)}::jsonb,
        ${JSON.stringify(input.purchaseSnapshot)}::jsonb, ${input.contractVersion}, ${input.version},
        ${input.purchaseSnapshot.remainingDoses}, 0
      ) returning id
    `);
    const state = rows(result)[0];
    if (!state) throw new Error("DOSECLUB_STATE_INSERT_FAILED");
    return state.id;
  }

  private async updateState(id: string, version: number, remaining: number, reserved: number) {
    const result = await this.database.db.execute<{ id: string }>(sql`
      update public.doseclub_states
      set version = ${version}, remaining_doses = ${remaining}, reserved_doses = ${reserved},
          updated_at = clock_timestamp()
      where id = ${id}::uuid
      returning id
    `);
    if (rows(result).length !== 1) throw new Error("DOSECLUB_STATE_UPDATE_FAILED");
  }

  private async originalConsumption(operationId: string, stateId: string) {
    const result = await this.database.db.execute<{
      idempotency_key: string;
      payload: unknown;
    }>(sql`
      select idempotency_key, payload
      from public.doseclub_operations
      where state_id = ${stateId}::uuid
        and operation_id = ${operationId}
        and operation = 'consumption'
      limit 1
    `);
    return rows(result)[0] ?? null;
  }

  private async moveStock(
    productId: string,
    doses: number,
    doseMl: number,
    direction: -1 | 1,
    operationRecordId: string,
    occurredAt: Date,
  ) {
    const context = this.requiredContext(true);
    const mapping = await this.mapping(productId);
    const quantity = (BigInt(doses) * BigInt(doseMl)).toString();
    const signedQuantity = direction === -1 ? `-${quantity}.000000` : `${quantity}.000000`;
    const update = await this.database.db.execute<{ quantity: string }>(sql`
      update public.management_stock_balances
      set quantity = quantity + ${signedQuantity}::numeric,
          version = version + 1,
          updated_at = clock_timestamp()
      where id = ${mapping.balance_id}::uuid
        and (${mapping.allow_negative} = true or quantity + ${signedQuantity}::numeric >= 0)
      returning quantity
    `);
    if (rows(update).length !== 1) {
      publicConflict(
        "DOSECLUB_STOCK_UNAVAILABLE",
        "O estoque fisico e insuficiente para esta dose.",
      );
    }
    await this.database.db.execute(sql`
      insert into public.management_inventory_movements (
        organization_id, unit_id, location_id, inventory_item_id, type, quantity_delta,
        source_type, source_id, occurred_at
      ) values (
        ${context.organizationId}::uuid, ${context.unitId}::uuid,
        ${mapping.stock_location_id}::uuid, ${mapping.inventory_item_id}::uuid,
        ${direction === -1 ? "doseclub_consumption" : "doseclub_reversal"},
        ${signedQuantity}::numeric, 'doseclub_operation', ${operationRecordId}::uuid,
        ${occurredAt.toISOString()}::timestamptz
      )
    `);
  }

  private async recordOperation(input: {
    contractVersion: "v1" | "v2";
    externalClubId: string;
    id: string;
    idempotencyKey: string;
    operation: string;
    operationId: string;
    originalOperationId: string | null;
    outcome: "accepted" | "reconciled";
    payload: unknown;
    occurredAt: Date;
    requestFingerprint: string;
    stateId: string;
    version: number;
  }) {
    const context = this.requiredContext(true);
    await this.database.db.execute(sql`
      insert into public.doseclub_operations (
        id, organization_id, unit_id, state_id, external_club_id, operation_id,
        original_operation_id, idempotency_key, request_fingerprint, contract_version,
        operation, version, outcome, payload, occurred_at
      ) values (
        ${input.id}::uuid, ${context.organizationId}::uuid, ${context.unitId}::uuid,
        ${input.stateId}::uuid, ${input.externalClubId}, ${input.operationId},
        ${input.originalOperationId}, ${input.idempotencyKey}, ${input.requestFingerprint},
        ${input.contractVersion}, ${input.operation}, ${input.version}, ${input.outcome},
        ${JSON.stringify(input.payload)}::jsonb, ${input.occurredAt.toISOString()}::timestamptz
      )
    `);
  }

  private async publish(operationId: string, clubId: string, operation: string, version: number) {
    const context = this.requiredContext(true);
    const payload = { clubId, operation, operationId, version };
    await this.database.db.execute(sql`
      insert into public.outbox_events (
        organization_id, unit_id, topic, aggregate_type, aggregate_id, payload
      ) values (
        ${context.organizationId}::uuid, ${context.unitId}::uuid,
        'integration.doseclub.operation.accepted', 'doseclub', ${clubId},
        ${JSON.stringify(payload)}::jsonb
      )
    `);
    await this.database.db.execute(sql`
      insert into public.audit_events (
        organization_id, unit_id, action, entity_type, entity_id, metadata
      ) values (
        ${context.organizationId}::uuid, ${context.unitId}::uuid,
        ${`integration.doseclub.${operation}`}, 'doseclub_operation', ${operationId},
        ${JSON.stringify({ clubId, version })}::jsonb
      )
    `);
  }

  private acknowledgement(
    input: DoseClubV2Operation,
    outcome: DoseClubV2Acknowledgement["outcome"],
    acknowledgedAt: Date | string = new Date(),
  ): DoseClubV2Acknowledgement {
    return {
      acknowledgedAt: new Date(acknowledgedAt).toISOString(),
      contractVersion: "v2",
      externalClubId: input.externalClubId,
      operationId: input.operationId,
      outcome,
      version: input.version,
    };
  }

  private v1Duplicate(
    input: { externalClubId: string; idempotencyKey: string },
    known: OperationRow,
    requestFingerprint: string,
  ) {
    if (known.request_fingerprint !== requestFingerprint) {
      publicConflict(
        "DOSECLUB_IDEMPOTENCY_CONFLICT",
        "A chave de idempotencia ja foi utilizada por outra operacao.",
      );
    }
    return {
      contractVersion: "v1" as const,
      externalClubId: input.externalClubId,
      outcome: "duplicate" as const,
      status: "ok" as const,
    };
  }
}
