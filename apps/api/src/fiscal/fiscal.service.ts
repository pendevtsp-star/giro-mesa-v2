import { type Database, fiscalDocumentEvents, fiscalDocuments } from "@giromesa/db";
import { type FiscalAdapterResult, transitionFiscalDocument } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";
import { FiscalSimulatorAdapter } from "./adapters/simulator.adapter.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const FISCAL_ROLES = ["owner", "manager", "cashier"] as const;

const SENSITIVE_FISCAL_KEY =
  /(?:^|_)(?:pan|card_number|cvv|cvc|cid|track_?1|track_?2|track_data|pin|password|passphrase|secret|token|api_key|access_key|private_key)(?:$|_)/i;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const TRACK_DATA = /(?:%B\d{12,19}\^|;\d{12,19}=)/i;
const SECRET_VALUE =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\bsk_(?:live|test)_[A-Za-z0-9]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;

function normalizedKey(key: string) {
  return key
    .replaceAll(/([a-z])([A-Z])/g, "$1_$2")
    .replaceAll(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
}

function passesLuhn(digits: string) {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsPan(value: string) {
  for (const candidate of value.matchAll(CARD_CANDIDATE)) {
    const digits = candidate[0].replaceAll(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}

function rejectSensitiveFiscalData(path: string) {
  throw new BadRequestException({
    code: "CARD_DATA_FORBIDDEN",
    message: `Dado financeiro sensível não pode integrar o documento fiscal (${path}).`,
  });
}

export function assertNoSensitiveFiscalData(value: unknown, path = "fiscal") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoSensitiveFiscalData(entry, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value === "string") {
    if (TRACK_DATA.test(value) || SECRET_VALUE.test(value) || containsPan(value)) {
      rejectSensitiveFiscalData(path);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (SENSITIVE_FISCAL_KEY.test(normalized)) rejectSensitiveFiscalData(`${path}.${key}`);
    assertNoSensitiveFiscalData(entry, `${path}.${key}`);
  }
}

@Injectable()
export class FiscalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    @Optional()
    private readonly adapter: FiscalSimulatorAdapter = new FiscalSimulatorAdapter(),
  ) {}

  private async requireRole(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const roles = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      FISCAL_ROLES,
    );
    if (
      !roles.some(
        (role) =>
          FISCAL_ROLES.includes(role.role as (typeof FISCAL_ROLES)[number]) &&
          (role.unitId === null || role.unitId === unitId),
      )
    )
      throw new ForbiddenException({
        code: "FISCAL_ROLE_DENIED",
        message: "Emissão fiscal não autorizada nesta unidade.",
      });
  }

  async issue(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: {
      saleReference: string;
      documentType: "nfce" | "nfe";
      totalCents: number;
      document: Record<string, unknown>;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    assertNoSensitiveFiscalData(input.document);
    const key = idempotencyKey.trim();
    if (
      key.length < 8 ||
      key.length > 160 ||
      input.saleReference.trim().length === 0 ||
      input.saleReference.length > 160 ||
      !Number.isSafeInteger(input.totalCents) ||
      input.totalCents <= 0 ||
      input.totalCents > POSTGRES_INT4_MAX
    )
      throw new BadRequestException({
        code: "INVALID_FISCAL_REQUEST",
        message: "Documento fiscal exige referência, idempotência e total em centavos inteiros.",
      });
    const requestHash = managementRequestHash("fiscal-document", input);
    const prepared = await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`fiscal:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.organizationId, organizationId),
            eq(fiscalDocuments.unitId, unitId),
            eq(fiscalDocuments.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outro documento fiscal.",
          });
        return { document: existing, replay: true };
      }
      const [document] = await tx
        .insert(fiscalDocuments)
        .values({
          organizationId,
          unitId,
          saleReference: input.saleReference.trim(),
          documentType: input.documentType,
          totalCents: input.totalCents,
          documentPayload: input.document,
          adapter: this.adapter.name,
          adapterHomologated: this.adapter.homologated,
          idempotencyKey: key,
          requestHash,
          actorIdentityId: identityId,
        })
        .returning();
      if (!document) throw new Error("Fiscal document insert returned no row.");
      await this.event(tx, document, null, "pending", "created", identityId);
      return { document, replay: false };
    });
    if (prepared.replay) {
      const resumed = await this.resume(prepared.document, identityId);
      return { ...resumed, idempotentReplay: true };
    }
    return this.submit(prepared.document, identityId);
  }

  async retry(identityId: string, organizationId: string, unitId: string, documentId: string) {
    await this.requireRole(identityId, organizationId, unitId);
    let document = await this.find(organizationId, unitId, documentId);
    if (document.status === "authorized" || document.status === "cancelled")
      throw new ConflictException({
        code: "FISCAL_DOCUMENT_TERMINAL",
        message: "Documento fiscal já está em estado terminal.",
      });
    if (document.status === "submitted" && document.documentReference) {
      const lookedUp = await this.adapter.lookup(document.documentReference);
      if (lookedUp.status !== "pending") return this.apply(document, lookedUp, identityId);
    }
    if (document.status === "rejected") {
      document = await this.database.db.transaction(async (tx) => {
        const current = await this.lockDocument(tx, organizationId, unitId, documentId);
        if (current.status !== "rejected") return current;
        const next = transitionFiscalDocument(current.status, "retry");
        const [updated] = await tx
          .update(fiscalDocuments)
          .set({ status: next, version: current.version + 1, updatedAt: new Date() })
          .where(
            and(
              eq(fiscalDocuments.id, current.id),
              eq(fiscalDocuments.version, current.version),
              eq(fiscalDocuments.status, current.status),
            ),
          )
          .returning();
        if (!updated) throw new ConflictException({ code: "FISCAL_VERSION_CONFLICT" });
        await this.event(tx, updated, current.status, next, "retry", identityId);
        return updated;
      });
    }
    return this.submit(document, identityId);
  }

  private async resume(document: typeof fiscalDocuments.$inferSelect, identityId: string) {
    if (document.status === "pending" || document.status === "submitted") {
      if (document.status === "submitted" && document.documentReference) {
        const lookedUp = await this.adapter.lookup(document.documentReference);
        if (lookedUp.status !== "pending") return this.apply(document, lookedUp, identityId);
      }
      return this.submit(document, identityId);
    }
    return this.dto(document);
  }

  private async lockDocument(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    documentId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`fiscal-document:${organizationId}:${unitId}:${documentId}`}))`,
    );
    const [document] = await tx
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.organizationId, organizationId),
          eq(fiscalDocuments.unitId, unitId),
          eq(fiscalDocuments.id, documentId),
        ),
      )
      .limit(1);
    if (!document)
      throw new NotFoundException({
        code: "FISCAL_DOCUMENT_NOT_FOUND",
        message: "Documento fiscal não encontrado nesta unidade.",
      });
    return document;
  }

  async cancel(
    identityId: string,
    organizationId: string,
    unitId: string,
    documentId: string,
    reason: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId);
    if (reason.trim().length < 15 || reason.length > 240)
      throw new BadRequestException({
        code: "FISCAL_CANCEL_REASON_REQUIRED",
        message: "O cancelamento exige justificativa de 15 a 240 caracteres.",
      });
    const document = await this.find(organizationId, unitId, documentId);
    if (document.status !== "authorized" || !document.documentReference)
      throw new ConflictException({
        code: "FISCAL_DOCUMENT_NOT_AUTHORIZED",
        message: "Somente documento autorizado pode ser cancelado.",
      });
    const result = await this.adapter.cancel(document.documentReference, reason.trim());
    if (result.status !== "cancelled") return this.dto(document);
    return this.database.db.transaction(async (tx) => {
      const current = await this.lockDocument(tx, organizationId, unitId, documentId);
      if (current.status === "cancelled") return this.dto(current);
      if (current.status !== "authorized") return this.dto(current);
      const next = transitionFiscalDocument(current.status, "cancel");
      const [updated] = await tx
        .update(fiscalDocuments)
        .set({
          status: next,
          version: current.version + 1,
          cancelledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fiscalDocuments.id, current.id),
            eq(fiscalDocuments.version, current.version),
            eq(fiscalDocuments.status, current.status),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "FISCAL_VERSION_CONFLICT" });
      await this.event(tx, updated, current.status, next, "cancel", identityId, undefined, {
        reason: reason.trim(),
      });
      return this.dto(updated);
    });
  }

  private async submit(document: typeof fiscalDocuments.$inferSelect, identityId: string) {
    const submitted = await this.database.db.transaction(async (tx) => {
      const current = await this.lockDocument(
        tx,
        document.organizationId,
        document.unitId,
        document.id,
      );
      if (current.status === "submitted") return current;
      if (current.status !== "pending") return current;
      const next = transitionFiscalDocument(current.status, "submit");
      const [updated] = await tx
        .update(fiscalDocuments)
        .set({
          status: next,
          attemptCount: current.attemptCount + 1,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fiscalDocuments.id, current.id),
            eq(fiscalDocuments.version, current.version),
            eq(fiscalDocuments.status, current.status),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "FISCAL_VERSION_CONFLICT" });
      await this.event(tx, updated, current.status, next, "submit", identityId);
      return updated;
    });
    if (submitted.status !== "submitted") return this.dto(submitted);
    let result: FiscalAdapterResult;
    try {
      result = await this.adapter.issue({
        documentId: submitted.id,
        idempotencyKey: `${submitted.idempotencyKey}:attempt:${submitted.attemptCount}`,
        saleReference: submitted.saleReference,
        totalCents: submitted.totalCents,
        document: submitted.documentPayload,
      });
    } catch {
      result = { status: "pending", errorCode: "FISCAL_ADAPTER_UNCERTAIN" };
    }
    return this.apply(submitted, result, identityId);
  }

  private async apply(
    document: typeof fiscalDocuments.$inferSelect,
    result: FiscalAdapterResult,
    identityId: string,
  ) {
    return this.database.db.transaction(async (tx) => {
      const current = await this.lockDocument(
        tx,
        document.organizationId,
        document.unitId,
        document.id,
      );
      if (current.status !== "submitted" || current.attemptCount !== document.attemptCount) {
        return this.dto(current);
      }
      if (result.status === "pending") {
        const [updated] = await tx
          .update(fiscalDocuments)
          .set({
            documentReference: result.documentReference ?? current.documentReference,
            lastErrorCode: result.errorCode ?? "FISCAL_PENDING",
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(fiscalDocuments.id, current.id),
              eq(fiscalDocuments.version, current.version),
              eq(fiscalDocuments.status, current.status),
            ),
          )
          .returning();
        if (!updated) throw new ConflictException({ code: "FISCAL_VERSION_CONFLICT" });
        return this.dto(updated);
      }
      if (result.status !== "authorized" && result.status !== "rejected") {
        return this.dto(current);
      }
      const event = result.status === "authorized" ? "authorize" : "reject";
      const next = transitionFiscalDocument(current.status, event);
      const [updated] = await tx
        .update(fiscalDocuments)
        .set({
          status: next,
          documentReference: result.documentReference,
          lastErrorCode: result.errorCode,
          authorizedAt: next === "authorized" ? new Date() : null,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fiscalDocuments.id, current.id),
            eq(fiscalDocuments.version, current.version),
            eq(fiscalDocuments.status, current.status),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "FISCAL_VERSION_CONFLICT" });
      await this.event(tx, updated, current.status, next, event, identityId, result.errorCode);
      return this.dto(updated);
    });
  }

  private async find(organizationId: string, unitId: string, documentId: string) {
    const [document] = await this.database.db
      .select()
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.organizationId, organizationId),
          eq(fiscalDocuments.unitId, unitId),
          eq(fiscalDocuments.id, documentId),
        ),
      )
      .limit(1);
    if (!document)
      throw new NotFoundException({
        code: "FISCAL_DOCUMENT_NOT_FOUND",
        message: "Documento fiscal não encontrado nesta unidade.",
      });
    return document;
  }

  private event(
    tx: Transaction,
    document: typeof fiscalDocuments.$inferSelect,
    fromStatus: string | null,
    toStatus: string,
    event: string,
    actorIdentityId: string,
    errorCode?: string,
    safePayload: Record<string, unknown> = {},
  ) {
    return tx.insert(fiscalDocumentEvents).values({
      organizationId: document.organizationId,
      unitId: document.unitId,
      documentId: document.id,
      fromStatus,
      toStatus,
      event,
      actorIdentityId,
      errorCode,
      safePayload,
    });
  }

  private dto(document: typeof fiscalDocuments.$inferSelect) {
    return {
      documentId: document.id,
      saleReference: document.saleReference,
      status: document.status,
      documentReference: document.documentReference,
      lastErrorCode: document.lastErrorCode,
      attemptCount: document.attemptCount,
      adapter: document.adapter,
      adapterHomologated: document.adapterHomologated,
      salePreserved: true,
    };
  }
}
