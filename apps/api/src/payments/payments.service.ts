import { type Database, financialLedgerEntries, financialLedgerTransactions } from "@giromesa/db";
import {
  createLedgerPosting,
  type MoneyComponent,
  type MoneyLedgerEntry,
  type MoneyLedgerKind,
  reverseLedgerPosting,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type PostableKind = Exclude<MoneyLedgerKind, "reversal">;

export type PostLedgerInput = {
  kind: PostableKind;
  referenceType: string;
  referenceId: string;
  entries: readonly MoneyLedgerEntry[];
};

const LEDGER_ROLES = ["owner", "manager", "finance", "cashier"] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireLedgerRole(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      LEDGER_ROLES,
    );
    if (
      !roles.some(
        (role) =>
          LEDGER_ROLES.includes(role.role as (typeof LEDGER_ROLES)[number]) &&
          (role.unitId === null || role.unitId === unitId),
      )
    ) {
      throw new ForbiddenException({
        code: "PAYMENT_ROLE_DENIED",
        message: "Ação financeira não autorizada nesta unidade.",
      });
    }
  }

  private normalizedKey(idempotencyKey: string) {
    const key = idempotencyKey.trim();
    if (key.length < 8 || key.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    return key;
  }

  private async persist(
    tx: Transaction,
    scope: { actorIdentityId: string; organizationId: string; unitId: string },
    idempotencyKey: string,
    requestHash: string,
    referenceType: string,
    posting: ReturnType<typeof createLedgerPosting>,
  ) {
    await tx.insert(financialLedgerTransactions).values({
      id: posting.postingId,
      organizationId: scope.organizationId,
      unitId: scope.unitId,
      kind: posting.kind,
      referenceType,
      referenceId: posting.referenceId,
      idempotencyKey,
      requestHash,
      reversalOf: posting.reversalOf,
      debitCents: posting.debitCents,
      creditCents: posting.creditCents,
      actorIdentityId: scope.actorIdentityId,
    });
    await tx.insert(financialLedgerEntries).values(
      posting.entries.map((entry, sequence) => ({
        organizationId: scope.organizationId,
        unitId: scope.unitId,
        transactionId: posting.postingId,
        sequence,
        account: entry.account,
        component: entry.component,
        debitCents: entry.debitCents,
        creditCents: entry.creditCents,
      })),
    );
    return {
      transactionId: posting.postingId,
      kind: posting.kind,
      referenceType,
      referenceId: posting.referenceId,
      debitCents: posting.debitCents,
      creditCents: posting.creditCents,
      ...(posting.reversalOf ? { reversalOf: posting.reversalOf } : {}),
      idempotentReplay: false,
    };
  }

  async postLedger(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: PostLedgerInput,
  ) {
    await this.requireLedgerRole(identityId, organizationId, unitId);
    if (input.referenceType.trim().length === 0 || input.referenceType.length > 48) {
      throw new BadRequestException({
        code: "INVALID_LEDGER_REFERENCE",
        message: "O tipo da referência financeira é obrigatório.",
      });
    }
    const key = this.normalizedKey(idempotencyKey);
    const requestHash = managementRequestHash("money-ledger", input);
    const posting = createLedgerPosting({
      kind: input.kind,
      referenceId: input.referenceId,
      entries: input.entries,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ledger:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(financialLedgerTransactions)
        .where(
          and(
            eq(financialLedgerTransactions.organizationId, organizationId),
            eq(financialLedgerTransactions.unitId, unitId),
            eq(financialLedgerTransactions.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outro lançamento financeiro.",
          });
        return {
          transactionId: existing.id,
          kind: existing.kind,
          referenceType: existing.referenceType,
          referenceId: existing.referenceId,
          debitCents: existing.debitCents,
          creditCents: existing.creditCents,
          ...(existing.reversalOf ? { reversalOf: existing.reversalOf } : {}),
          idempotentReplay: true,
        };
      }
      return this.persist(
        tx,
        { actorIdentityId: identityId, organizationId, unitId },
        key,
        requestHash,
        input.referenceType.trim(),
        posting,
      );
    });
  }

  async reverseLedger(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    transactionId: string,
    referenceType: string,
    referenceId: string,
  ) {
    await this.requireLedgerRole(identityId, organizationId, unitId);
    const key = this.normalizedKey(idempotencyKey);
    const requestHash = managementRequestHash("money-ledger-reversal", {
      transactionId,
      referenceType,
      referenceId,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`ledger:${organizationId}:${unitId}:${key}`}))`,
      );
      const [replay] = await tx
        .select()
        .from(financialLedgerTransactions)
        .where(
          and(
            eq(financialLedgerTransactions.organizationId, organizationId),
            eq(financialLedgerTransactions.unitId, unitId),
            eq(financialLedgerTransactions.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outra reversão.",
          });
        return {
          transactionId: replay.id,
          kind: replay.kind,
          referenceType: replay.referenceType,
          referenceId: replay.referenceId,
          debitCents: replay.debitCents,
          creditCents: replay.creditCents,
          reversalOf: replay.reversalOf,
          idempotentReplay: true,
        };
      }
      const [original] = await tx
        .select()
        .from(financialLedgerTransactions)
        .where(
          and(
            eq(financialLedgerTransactions.organizationId, organizationId),
            eq(financialLedgerTransactions.unitId, unitId),
            eq(financialLedgerTransactions.id, transactionId),
          ),
        )
        .limit(1);
      if (!original)
        throw new NotFoundException({
          code: "LEDGER_TRANSACTION_NOT_FOUND",
          message: "Lançamento financeiro não encontrado nesta unidade.",
        });
      const lines = await tx
        .select()
        .from(financialLedgerEntries)
        .where(
          and(
            eq(financialLedgerEntries.organizationId, organizationId),
            eq(financialLedgerEntries.unitId, unitId),
            eq(financialLedgerEntries.transactionId, transactionId),
          ),
        );
      const originalPosting = createLedgerPosting({
        postingId: original.id,
        kind: original.kind,
        referenceId: original.referenceId,
        ...(original.reversalOf ? { reversalOf: original.reversalOf } : {}),
        entries: lines.map((line) => ({
          account: line.account,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
          ...(line.component ? { component: line.component as MoneyComponent } : {}),
        })),
      });
      const reversal = reverseLedgerPosting(originalPosting, referenceId);
      return this.persist(
        tx,
        { actorIdentityId: identityId, organizationId, unitId },
        key,
        requestHash,
        referenceType,
        reversal,
      );
    });
  }
}
