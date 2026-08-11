import {
  type Database,
  financialLedgerEntries,
  financialLedgerTransactions,
  paymentAttempts,
  paymentIntents,
  paymentProviderEvents,
} from "@giromesa/db";
import {
  assertSafePaymentPayload,
  canStartPaymentAttempt,
  createLedgerPosting,
  type MoneyComponent,
  type MoneyLedgerEntry,
  type MoneyLedgerKind,
  normalizeAdapterResult,
  type PaymentAdapterResult,
  reverseLedgerPosting,
} from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";
import { SimulatorPaymentAdapter } from "./adapters/simulator.adapter.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type PostableKind = Exclude<MoneyLedgerKind, "reversal">;

export type PostLedgerInput = {
  kind: PostableKind;
  referenceType: string;
  referenceId: string;
  entries: readonly MoneyLedgerEntry[];
};

const LEDGER_ROLES = ["owner", "manager", "finance", "cashier"] as const;
const REVIEW_ROLES = ["owner", "manager", "finance"] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    @Optional()
    private readonly paymentAdapter: SimulatorPaymentAdapter = new SimulatorPaymentAdapter(),
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

  private async requireReviewRole(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      REVIEW_ROLES,
    );
    if (
      !roles.some(
        (role) =>
          REVIEW_ROLES.includes(role.role as (typeof REVIEW_ROLES)[number]) &&
          (role.unitId === null || role.unitId === unitId),
      )
    ) {
      throw new ForbiddenException({
        code: "PAYMENT_REVIEW_ROLE_DENIED",
        message: "A revisão manual exige gestão financeira nesta unidade.",
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

  async createPaymentIntent(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: { sourceType: string; sourceId: string; amountCents: number },
  ) {
    await this.requireLedgerRole(identityId, organizationId, unitId);
    assertSafePaymentPayload(input);
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.sourceType.trim().length === 0 ||
      input.sourceType.length > 48 ||
      input.sourceId.trim().length === 0 ||
      input.sourceId.length > 160
    ) {
      throw new BadRequestException({
        code: "INVALID_PAYMENT_INTENT",
        message: "A intenção exige origem e valor positivo em centavos inteiros.",
      });
    }
    const key = this.normalizedKey(idempotencyKey);
    const requestHash = managementRequestHash("payment-intent", input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`payment-intent:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.organizationId, organizationId),
            eq(paymentIntents.unitId, unitId),
            eq(paymentIntents.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outra intenção de pagamento.",
          });
        return {
          intentId: existing.id,
          amountCents: existing.amountCents,
          capturedCents: existing.capturedCents,
          status: existing.status,
          idempotentReplay: true,
        };
      }
      const [created] = await tx
        .insert(paymentIntents)
        .values({
          organizationId,
          unitId,
          sourceType: input.sourceType.trim(),
          sourceId: input.sourceId.trim(),
          amountCents: input.amountCents,
          idempotencyKey: key,
          requestHash,
        })
        .returning();
      if (!created) throw new Error("Payment intent insert returned no row.");
      return {
        intentId: created.id,
        amountCents: created.amountCents,
        capturedCents: created.capturedCents,
        status: created.status,
        idempotentReplay: false,
      };
    });
  }

  async executePaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: { intentId: string; amountCents: number; method: string; terminalId?: string },
  ) {
    await this.requireLedgerRole(identityId, organizationId, unitId);
    assertSafePaymentPayload(input);
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents <= 0 ||
      input.method.trim().length === 0
    ) {
      throw new BadRequestException({
        code: "INVALID_PAYMENT_ATTEMPT",
        message: "A tentativa exige método e valor positivo em centavos inteiros.",
      });
    }
    const key = this.normalizedKey(idempotencyKey);
    const requestHash = managementRequestHash("payment-attempt", input);
    const prepared = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`payment-attempt:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.organizationId, organizationId),
            eq(paymentAttempts.unitId, unitId),
            eq(paymentAttempts.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outra tentativa de pagamento.",
          });
        return { attempt: existing, replay: true };
      }
      await tx.execute(
        sql`select id from payment_intents where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.intentId}::uuid for update`,
      );
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(
          and(
            eq(paymentIntents.organizationId, organizationId),
            eq(paymentIntents.unitId, unitId),
            eq(paymentIntents.id, input.intentId),
          ),
        )
        .limit(1);
      if (!intent)
        throw new NotFoundException({
          code: "PAYMENT_INTENT_NOT_FOUND",
          message: "Intenção de pagamento não encontrada nesta unidade.",
        });
      if (intent.status === "paid" || intent.status === "cancelled")
        throw new ConflictException({
          code: "PAYMENT_INTENT_CLOSED",
          message: "A intenção não aceita novas tentativas.",
        });
      if (input.amountCents > intent.amountCents - intent.capturedCents)
        throw new ConflictException({
          code: "PAYMENT_EXCEEDS_REMAINING",
          message: "A tentativa excede o saldo da intenção.",
        });
      const previous = await tx
        .select({ status: paymentAttempts.status, amountCents: paymentAttempts.amountCents })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.organizationId, organizationId),
            eq(paymentAttempts.unitId, unitId),
            eq(paymentAttempts.intentId, input.intentId),
          ),
        );
      if (!canStartPaymentAttempt(previous, input.amountCents))
        throw new ConflictException({
          code: "PAYMENT_OUTCOME_UNKNOWN",
          message: "Consulte ou reconcilie a tentativa incerta antes de tentar novamente.",
        });
      const [attempt] = await tx
        .insert(paymentAttempts)
        .values({
          organizationId,
          unitId,
          intentId: input.intentId,
          terminalId: input.terminalId,
          adapter: this.paymentAdapter.name,
          amountCents: input.amountCents,
          status: "processing",
          idempotencyKey: key,
          requestHash,
        })
        .returning();
      if (!attempt) throw new Error("Payment attempt insert returned no row.");
      return { attempt, replay: false };
    });
    if (prepared.replay) return this.describeAttempt(prepared.attempt, true);

    let result: PaymentAdapterResult;
    try {
      result = await this.paymentAdapter.execute({
        attemptId: prepared.attempt.id,
        idempotencyKey: key,
        amountCents: input.amountCents,
        method: input.method.trim().toLowerCase(),
        ...(input.terminalId ? { terminalReference: input.terminalId } : {}),
      });
    } catch {
      result = { status: "unknown", errorCode: "ADAPTER_EXECUTION_UNCERTAIN" };
    }
    return this.applyAttemptResult(
      organizationId,
      unitId,
      prepared.attempt.id,
      normalizeAdapterResult(result),
    );
  }

  async reconcilePaymentAttempt(
    identityId: string,
    organizationId: string,
    unitId: string,
    attemptId: string,
  ) {
    await this.requireLedgerRole(identityId, organizationId, unitId);
    const [attempt] = await this.database.db
      .select()
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.organizationId, organizationId),
          eq(paymentAttempts.unitId, unitId),
          eq(paymentAttempts.id, attemptId),
        ),
      )
      .limit(1);
    if (!attempt)
      throw new NotFoundException({
        code: "PAYMENT_ATTEMPT_NOT_FOUND",
        message: "Tentativa de pagamento não encontrada nesta unidade.",
      });
    if (attempt.status !== "unknown" && attempt.status !== "processing") {
      return this.describeAttempt(attempt, true);
    }
    if (!attempt.providerReference) {
      return this.applyAttemptResult(organizationId, unitId, attempt.id, {
        status: "unknown",
        errorCode: "MANUAL_REVIEW_REQUIRED",
        reviewRequired: true,
        nextAction: "lookup_or_reconcile",
      });
    }
    let result: PaymentAdapterResult;
    try {
      result = await this.paymentAdapter.lookup(attempt.providerReference);
    } catch {
      result = {
        status: "unknown",
        providerReference: attempt.providerReference,
        errorCode: "ADAPTER_LOOKUP_UNCERTAIN",
      };
    }
    return this.applyAttemptResult(
      organizationId,
      unitId,
      attempt.id,
      normalizeAdapterResult(result),
    );
  }

  async resolvePaymentAttemptManually(
    identityId: string,
    organizationId: string,
    unitId: string,
    attemptId: string,
    input: { status: "authorized" | "declined"; reason: string },
  ) {
    await this.requireReviewRole(identityId, organizationId, unitId);
    assertSafePaymentPayload(input);
    if (input.reason.trim().length < 10 || input.reason.length > 240) {
      throw new BadRequestException({
        code: "PAYMENT_REVIEW_REASON_REQUIRED",
        message: "A revisão manual exige justificativa de 10 a 240 caracteres.",
      });
    }
    const eventId = `manual-${managementRequestHash("payment-manual-review", {
      attemptId,
      actor: identityId,
      ...input,
    }).slice(0, 48)}`;
    await this.database.db
      .insert(paymentProviderEvents)
      .values({
        organizationId,
        unitId,
        attemptId,
        adapter: "manual-review",
        providerEventId: eventId,
        outcome: input.status,
        safePayload: { actorIdentityId: identityId, reason: input.reason.trim() },
      })
      .onConflictDoNothing();
    return this.applyAttemptResult(
      organizationId,
      unitId,
      attemptId,
      normalizeAdapterResult({ status: input.status }),
    );
  }

  async handleProviderCallback(
    adapterName: string,
    signature: string | undefined,
    organizationId: string,
    unitId: string,
    input: {
      attemptId: string;
      providerEventId: string;
      status: "authorized" | "declined" | "unknown";
      providerReference?: string;
      amountCents?: number;
      safePayload?: Record<string, unknown>;
    },
  ) {
    assertSafePaymentPayload(input);
    if (
      adapterName !== this.paymentAdapter.name ||
      !(await this.paymentAdapter.verifyCallback(signature, input))
    ) {
      throw new UnauthorizedException({
        code: "PAYMENT_CALLBACK_UNAUTHORIZED",
        message: "Callback do provedor não autenticado.",
      });
    }
    if (input.providerEventId.trim().length === 0 || input.providerEventId.length > 160) {
      throw new BadRequestException({
        code: "INVALID_PROVIDER_EVENT",
        message: "O callback exige identificador de evento do provedor.",
      });
    }
    const normalized = normalizeAdapterResult({
      status: input.status,
      ...(input.providerReference ? { providerReference: input.providerReference } : {}),
      ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from payment_attempts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${input.attemptId}::uuid for update`,
      );
      const [attempt] = await tx
        .select()
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.organizationId, organizationId),
            eq(paymentAttempts.unitId, unitId),
            eq(paymentAttempts.id, input.attemptId),
          ),
        )
        .limit(1);
      if (!attempt)
        throw new NotFoundException({
          code: "PAYMENT_ATTEMPT_NOT_FOUND",
          message: "Tentativa de pagamento não encontrada nesta unidade.",
        });
      const [inserted] = await tx
        .insert(paymentProviderEvents)
        .values({
          organizationId,
          unitId,
          attemptId: input.attemptId,
          adapter: this.paymentAdapter.name,
          providerEventId: input.providerEventId.trim(),
          outcome: input.status,
          safePayload: input.safePayload ?? {},
        })
        .onConflictDoNothing()
        .returning({ id: paymentProviderEvents.id });
      if (!inserted) {
        const [intent] = await tx
          .select({ status: paymentIntents.status })
          .from(paymentIntents)
          .where(eq(paymentIntents.id, attempt.intentId))
          .limit(1);
        return {
          attemptId: attempt.id,
          intentId: attempt.intentId,
          status: attempt.status,
          intentStatus: intent?.status ?? "pending",
          amountCents: attempt.amountCents,
          providerReference: attempt.providerReference,
          reviewRequired: attempt.reviewRequired,
          nextAction: attempt.reviewRequired ? "lookup_or_reconcile" : "none",
          idempotentReplay: true,
        };
      }
      return this.applyAttemptResultInTransaction(
        tx,
        organizationId,
        unitId,
        input.attemptId,
        normalized,
      );
    });
  }

  private async describeAttempt(
    attempt: typeof paymentAttempts.$inferSelect,
    idempotentReplay: boolean,
  ) {
    const [intent] = await this.database.db
      .select({ status: paymentIntents.status })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, attempt.intentId))
      .limit(1);
    return {
      attemptId: attempt.id,
      intentId: attempt.intentId,
      status: attempt.status,
      intentStatus: intent?.status ?? "pending",
      amountCents: attempt.amountCents,
      providerReference: attempt.providerReference,
      reviewRequired: attempt.reviewRequired,
      nextAction: attempt.reviewRequired ? "lookup_or_reconcile" : "none",
      idempotentReplay,
    };
  }

  private async applyAttemptResult(
    organizationId: string,
    unitId: string,
    attemptId: string,
    result: ReturnType<typeof normalizeAdapterResult>,
  ) {
    return this.database.db.transaction((tx) =>
      this.applyAttemptResultInTransaction(tx, organizationId, unitId, attemptId, result),
    );
  }

  private async applyAttemptResultInTransaction(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    attemptId: string,
    result: ReturnType<typeof normalizeAdapterResult>,
  ) {
    await tx.execute(
      sql`select id from payment_attempts where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${attemptId}::uuid for update`,
    );
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(
        and(
          eq(paymentAttempts.organizationId, organizationId),
          eq(paymentAttempts.unitId, unitId),
          eq(paymentAttempts.id, attemptId),
        ),
      )
      .limit(1);
    if (!attempt) throw new Error("Payment attempt disappeared during reconciliation.");
    if (attempt.status === "authorized" || attempt.status === "declined") {
      const [intent] = await tx
        .select({ status: paymentIntents.status })
        .from(paymentIntents)
        .where(eq(paymentIntents.id, attempt.intentId))
        .limit(1);
      return {
        attemptId: attempt.id,
        intentId: attempt.intentId,
        status: attempt.status,
        intentStatus: intent?.status ?? "pending",
        amountCents: attempt.amountCents,
        providerReference: attempt.providerReference,
        reviewRequired: attempt.reviewRequired,
        nextAction: attempt.reviewRequired ? "lookup_or_reconcile" : "none",
        idempotentReplay: true,
      };
    }
    const amountMatches =
      result.amountCents === undefined || result.amountCents === attempt.amountCents;
    const status = amountMatches ? result.status : "unknown";
    const reviewRequired = status === "unknown";
    const reviewReason = amountMatches
      ? reviewRequired
        ? (result.errorCode ?? "PAYMENT_OUTCOME_UNKNOWN")
        : null
      : "ADAPTER_AMOUNT_MISMATCH";
    let intentStatus: "pending" | "partially_paid" | "paid" | "cancelled" = "pending";
    if (status === "authorized") {
      await tx.execute(
        sql`select id from payment_intents where organization_id=${organizationId}::uuid and unit_id=${unitId}::uuid and id=${attempt.intentId}::uuid for update`,
      );
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.id, attempt.intentId))
        .limit(1);
      if (!intent) throw new Error("Payment intent disappeared during reconciliation.");
      const capturedCents = intent.capturedCents + attempt.amountCents;
      if (!Number.isSafeInteger(capturedCents) || capturedCents > intent.amountCents)
        throw new ConflictException({
          code: "PAYMENT_CAPTURE_EXCEEDS_INTENT",
          message: "A captura conciliada excederia o valor da intenção.",
        });
      intentStatus = capturedCents === intent.amountCents ? "paid" : "partially_paid";
      await tx
        .update(paymentIntents)
        .set({
          capturedCents,
          status: intentStatus,
          version: intent.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intent.id));
    } else {
      const [intent] = await tx
        .select({ status: paymentIntents.status })
        .from(paymentIntents)
        .where(eq(paymentIntents.id, attempt.intentId))
        .limit(1);
      intentStatus = intent?.status ?? "pending";
    }
    const [updated] = await tx
      .update(paymentAttempts)
      .set({
        status,
        providerReference: result.providerReference ?? attempt.providerReference,
        reviewRequired,
        reviewReason,
        lastLookupAt: attempt.status === "unknown" ? new Date() : attempt.lastLookupAt,
        resolvedAt: status === "unknown" ? null : new Date(),
        version: attempt.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    if (!updated) throw new Error("Payment attempt update returned no row.");
    return {
      attemptId: updated.id,
      intentId: updated.intentId,
      status: updated.status,
      intentStatus,
      amountCents: updated.amountCents,
      providerReference: updated.providerReference,
      reviewRequired: updated.reviewRequired,
      nextAction: updated.reviewRequired ? "lookup_or_reconcile" : "none",
      idempotentReplay: false,
    };
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
