import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  doseClubRedemptions,
  growthIntegrations,
  posTabCustomerLinks,
} from "@giromesa/db";
import { doseClubManagedCredential } from "@giromesa/domain";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { DoseClubClientError, DoseClubHttpClient } from "./doseclub-client.js";
import type { DoseClubOperation } from "./doseclub-contract.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const connectionConfigSchema = z
  .object({
    apiBaseUrl: z.string().url(),
    clientId: z.string().trim().min(3).max(180),
  })
  .passthrough();

type ActiveConnection = {
  id: string;
  organizationId: string;
  unitId: string | null;
  credentialReference: string;
  config: z.infer<typeof connectionConfigSchema>;
};

function operationDate(value: string | null) {
  return value ? new Date(value) : null;
}

function operationState(operation: DoseClubOperation) {
  return {
    operationId: operation.operationId,
    status: operation.status,
    availableDoses: operation.availableDoses,
    reservedAt: operationDate(operation.reservedAt),
    expiresAt: operationDate(operation.expiresAt),
    committedAt: operationDate(operation.committedAt),
    canceledAt: operationDate(operation.canceledAt),
    expiredAt: operationDate(operation.expiredAt),
    reversedAt: operationDate(operation.reversedAt),
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: new Date(operation.updatedAt),
  };
}

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

@Injectable()
export class DoseClubIntegrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async activeConnection(
    organizationId: string,
    unitId: string,
  ): Promise<ActiveConnection> {
    if (process.env.DOSECLUB_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({
        code: "DOSECLUB_DISABLED",
        message: "A integração Dose Club está desabilitada neste ambiente.",
      });
    }
    const rows = await this.database.db
      .select()
      .from(growthIntegrations)
      .where(
        and(
          eq(growthIntegrations.organizationId, organizationId),
          eq(growthIntegrations.provider, "doseclub"),
          eq(growthIntegrations.status, "active"),
          or(eq(growthIntegrations.unitId, unitId), isNull(growthIntegrations.unitId)),
        ),
      );
    const row = rows.find((candidate) => candidate.unitId === unitId) ?? rows[0];
    if (!row?.credentialReference) {
      throw new ServiceUnavailableException({
        code: "DOSECLUB_CONNECTION_INACTIVE",
        message: "Ative a conexão Dose Club para esta unidade.",
      });
    }
    const parsed = connectionConfigSchema.safeParse(row.config);
    if (!parsed.success) {
      throw new ServiceUnavailableException({ code: "DOSECLUB_CONFIG_INVALID" });
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      unitId: row.unitId,
      credentialReference: row.credentialReference,
      config: parsed.data,
    };
  }

  private client(connection: ActiveConnection) {
    const integrationKey = connection.credentialReference.startsWith("managed:v1:")
      ? this.managedCredential(connection)
      : process.env[connection.credentialReference]?.trim();
    if (!integrationKey) {
      throw new ServiceUnavailableException({
        code: "DOSECLUB_CREDENTIALS_NOT_CONFIGURED",
        credentialReference: connection.credentialReference,
      });
    }
    return new DoseClubHttpClient({
      baseUrl: connection.config.apiBaseUrl,
      clientId: connection.config.clientId,
      integrationKey,
    });
  }

  private managedCredential(connection: ActiveConnection) {
    try {
      const credential = doseClubManagedCredential(
        connection.id,
        process.env.DOSECLUB_CREDENTIAL_SECRET ?? "",
      );
      return credential.reference === connection.credentialReference ? credential.token : undefined;
    } catch {
      return undefined;
    }
  }

  private throwClientError(error: unknown): never {
    if (error instanceof DoseClubClientError) {
      const body = {
        code: error.code,
        providerStatus: error.status,
        retryable: error.retryable,
        message: error.retryable
          ? "O Dose Club não respondeu. Tente novamente sem duplicar o pedido."
          : "O Dose Club recusou a operação.",
      };
      if (error.retryable) throw new ServiceUnavailableException(body);
      throw new ConflictException(body);
    }
    throw error;
  }

  async activate(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    if (process.env.DOSECLUB_PROVIDER_ENABLED !== "true") {
      throw new ServiceUnavailableException({ code: "DOSECLUB_DISABLED" });
    }
    const rows = await this.database.db
      .select()
      .from(growthIntegrations)
      .where(
        and(
          eq(growthIntegrations.organizationId, organizationId),
          eq(growthIntegrations.provider, "doseclub"),
          or(eq(growthIntegrations.unitId, unitId), isNull(growthIntegrations.unitId)),
        ),
      );
    const row = rows.find((candidate) => candidate.unitId === unitId) ?? rows[0];
    if (!row?.credentialReference) {
      throw new NotFoundException({ code: "DOSECLUB_CONNECTION_NOT_CONFIGURED" });
    }
    const parsed = connectionConfigSchema.safeParse(row.config);
    if (!parsed.success) throw new ConflictException({ code: "DOSECLUB_CONFIG_INVALID" });
    const connection: ActiveConnection = {
      id: row.id,
      organizationId,
      unitId: row.unitId,
      credentialReference: row.credentialReference,
      config: parsed.data,
    };
    try {
      const health = await this.client(connection).health();
      const now = new Date();
      const [updated] = await this.database.db
        .update(growthIntegrations)
        .set({
          status: "active",
          config: {
            ...row.config,
            tenantId: health.tenantId,
            integrationAccountId: health.integrationAccountId,
            healthCheckedAt: now.toISOString(),
          },
          updatedAt: now,
        })
        .where(
          and(
            eq(growthIntegrations.id, row.id),
            eq(growthIntegrations.organizationId, organizationId),
          ),
        )
        .returning();
      await this.database.db.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "doseclub.integration.activated",
        entityType: "growth_integration",
        entityId: row.id,
        metadata: {
          tenantId: health.tenantId,
          integrationAccountId: health.integrationAccountId,
        },
      });
      return {
        provider: "doseclub",
        status: updated?.status ?? "active",
        unitId,
        healthCheckedAt: now,
        tenantId: health.tenantId,
      };
    } catch (error) {
      this.throwClientError(error);
    }
  }

  async listEligibleMemberships(
    identityId: string,
    organizationId: string,
    unitId: string,
    tabId: string,
    productId?: string,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const [customer] = await this.database.db
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
    if (!customer) {
      throw new ConflictException({
        code: "DOSECLUB_CUSTOMER_REQUIRED",
        message: "Vincule o cliente à comanda antes de consultar o Dose Club.",
      });
    }
    const connection = await this.activeConnection(organizationId, unitId);
    try {
      return await this.client(connection).listEligibleMemberships({
        externalCustomerId: customer.customerId,
        externalBranchId: unitId,
        ...(productId ? { externalProductId: productId } : {}),
      });
    } catch (error) {
      this.throwClientError(error);
    }
  }

  async draftContext(organizationId: string, unitId: string, tabId: string) {
    const connection = await this.activeConnection(organizationId, unitId);
    const [customer] = await this.database.db
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
    if (!customer) {
      throw new ConflictException({
        code: "DOSECLUB_CUSTOMER_REQUIRED",
        message: "Vincule o cliente à comanda antes de usar uma dose.",
      });
    }
    return { integrationId: connection.id, externalCustomerId: customer.customerId };
  }

  async stageRedemption(
    tx: Transaction,
    input: {
      organizationId: string;
      unitId: string;
      integrationId: string;
      orderId: string;
      orderItemId: string;
      externalCustomerId: string;
      externalClubId: string;
      externalProductId: string;
      doses: number;
    },
  ) {
    const reserveIdempotencyKey = `gm:${input.organizationId}:${input.unitId}:${input.orderItemId}:reserve:1`;
    const [redemption] = await tx
      .insert(doseClubRedemptions)
      .values({
        ...input,
        reserveIdempotencyKey,
        requestFingerprint: fingerprint({
          externalCustomerId: input.externalCustomerId,
          externalClubId: input.externalClubId,
          externalProductId: input.externalProductId,
          orderId: input.orderId,
          orderItemId: input.orderItemId,
          doses: input.doses,
        }),
      })
      .returning();
    if (!redemption) throw new Error("DOSECLUB_REDEMPTION_INSERT_FAILED");
    return redemption;
  }

  async reserveOrder(organizationId: string, unitId: string, orderId: string) {
    const rows = await this.database.db
      .select()
      .from(doseClubRedemptions)
      .where(
        and(
          eq(doseClubRedemptions.organizationId, organizationId),
          eq(doseClubRedemptions.unitId, unitId),
          eq(doseClubRedemptions.orderId, orderId),
        ),
      );
    if (rows.length === 0) return [];
    const connection = await this.activeConnection(organizationId, unitId);
    if (rows.some((row) => row.integrationId !== connection.id)) {
      throw new ConflictException({ code: "DOSECLUB_CONNECTION_CHANGED" });
    }
    const client = this.client(connection);
    const preparedIds: string[] = [];
    try {
      for (const initial of rows) {
        let row = initial;
        if (["commit_pending", "committed"].includes(row.status)) continue;
        if (row.status === "reserved" && row.expiresAt && row.expiresAt > new Date()) continue;
        if (row.operationId) {
          const remote = await client.getOperation(row.operationId);
          if (remote.status === "reserved" && new Date(remote.expiresAt) > new Date()) {
            await this.database.db
              .update(doseClubRedemptions)
              .set({ ...operationState(remote), status: "reserved", version: row.version + 1 })
              .where(eq(doseClubRedemptions.id, row.id));
            continue;
          }
          if (remote.status === "committed") {
            throw new ConflictException({ code: "DOSECLUB_ALREADY_COMMITTED" });
          }
          const nextVersion = row.version + 1;
          const [reset] = await this.database.db
            .update(doseClubRedemptions)
            .set({
              status: "pending_reservation",
              operationId: null,
              reserveIdempotencyKey: `gm:${organizationId}:${unitId}:${row.orderItemId}:reserve:${nextVersion}`,
              reservedAt: null,
              expiresAt: null,
              canceledAt: null,
              expiredAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
              version: nextVersion,
              updatedAt: new Date(),
            })
            .where(eq(doseClubRedemptions.id, row.id))
            .returning();
          if (!reset) throw new Error("DOSECLUB_REDEMPTION_RESET_FAILED");
          row = reset;
        }
        if (!["pending_reservation", "canceled", "expired"].includes(row.status)) {
          throw new ConflictException({
            code: "DOSECLUB_REDEMPTION_NOT_RESERVABLE",
            status: row.status,
          });
        }
        const operation = await client.reserveConsumption({
          externalCustomerId: row.externalCustomerId,
          externalBranchId: unitId,
          externalProductId: row.externalProductId,
          externalClubId: row.externalClubId,
          externalCommandId: row.orderId,
          externalCommandItemId: row.orderItemId,
          doses: row.doses,
          idempotencyKey: row.reserveIdempotencyKey,
          reason: "Consumo por doses na comanda GiroMesa",
        });
        if (operation.status !== "reserved") {
          throw new ConflictException({
            code: "DOSECLUB_RESERVATION_REJECTED",
            status: operation.status,
          });
        }
        await this.database.db
          .update(doseClubRedemptions)
          .set({ ...operationState(operation), status: "reserved", version: row.version + 1 })
          .where(eq(doseClubRedemptions.id, row.id));
        preparedIds.push(row.id);
      }
      return preparedIds;
    } catch (error) {
      await this.cancelPrepared(preparedIds, "Envio da comanda não foi concluído");
      this.throwClientError(error);
    }
  }

  async cancelPrepared(redemptionIds: string[], reason: string) {
    if (redemptionIds.length === 0) return;
    const rows = await this.database.db
      .select()
      .from(doseClubRedemptions)
      .where(inArray(doseClubRedemptions.id, redemptionIds));
    for (const row of rows) {
      if (!row.operationId || row.status !== "reserved") continue;
      try {
        const connection = await this.activeConnection(row.organizationId, row.unitId);
        const operation = await this.client(connection).cancelReservation({
          operationId: row.operationId,
          idempotencyKey: `gm:${row.organizationId}:${row.unitId}:${row.orderItemId}:cancel:${row.version}`,
          reason,
        });
        const nextVersion = row.version + 1;
        await this.database.db
          .update(doseClubRedemptions)
          .set({
            ...operationState(operation),
            status: operation.status,
            version: nextVersion,
          })
          .where(eq(doseClubRedemptions.id, row.id));
      } catch (error) {
        const clientError = error instanceof DoseClubClientError ? error : null;
        await this.database.db
          .update(doseClubRedemptions)
          .set({
            status: "cancel_pending",
            lastErrorCode: clientError?.code ?? "DOSECLUB_CANCEL_FAILED",
            lastErrorMessage:
              error instanceof Error ? error.message.slice(0, 500) : "Falha ao cancelar reserva",
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(doseClubRedemptions.id, row.id));
      }
    }
  }

  async assertReservedAndMarkCommitPending(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderId: string,
  ) {
    const rows = await tx
      .select()
      .from(doseClubRedemptions)
      .where(
        and(
          eq(doseClubRedemptions.organizationId, organizationId),
          eq(doseClubRedemptions.unitId, unitId),
          eq(doseClubRedemptions.orderId, orderId),
        ),
      );
    if (rows.length === 0) return;
    const invalid = rows.find((row) => row.status !== "reserved" || !row.operationId);
    if (invalid) {
      throw new ConflictException({
        code: "DOSECLUB_RESERVATION_REQUIRED",
        orderItemId: invalid.orderItemId,
        status: invalid.status,
      });
    }
    await tx
      .update(doseClubRedemptions)
      .set({ status: "commit_pending", updatedAt: new Date() })
      .where(
        and(
          eq(doseClubRedemptions.organizationId, organizationId),
          eq(doseClubRedemptions.unitId, unitId),
          eq(doseClubRedemptions.orderId, orderId),
          eq(doseClubRedemptions.status, "reserved"),
        ),
      );
  }

  async markCancellationPending(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    orderItemId: string,
  ) {
    const [row] = await tx
      .select()
      .from(doseClubRedemptions)
      .where(
        and(
          eq(doseClubRedemptions.organizationId, organizationId),
          eq(doseClubRedemptions.unitId, unitId),
          eq(doseClubRedemptions.orderItemId, orderItemId),
        ),
      )
      .limit(1);
    if (!row || ["canceled", "expired", "reversed"].includes(row.status)) return;
    await tx
      .update(doseClubRedemptions)
      .set({
        status: row.operationId ? "cancel_pending" : "canceled",
        canceledAt: row.operationId ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(doseClubRedemptions.id, row.id));
  }
}
