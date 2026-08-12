import { managementIncidentEvents, managementIncidents } from "@giromesa/db";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { POSTGRES_INT4_MAX } from "../common/postgres-integers.js";
import { DatabaseService } from "../database/database.module.js";
import { managementRequestHash } from "../management/management.rules.js";
import { ScopeService } from "../organizations/scope.service.js";

const REPORT_ROLES = ["owner", "manager", "inventory", "finance"] as const;
const APPROVAL_ROLES = ["owner", "manager"] as const;
type IncidentStatus = "reported" | "under_review" | "approved" | "rejected" | "closed";

function idempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 160)
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "Idempotency-Key deve ter entre 8 e 160 caracteres.",
    });
  return normalized;
}

function neutralText(value: string, minimum: number, field: string) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > 1_000)
    throw new BadRequestException({
      code: "INCIDENT_NEUTRAL_TEXT_INVALID",
      message: `${field} deve ser objetivo e ter entre ${minimum} e 1000 caracteres.`,
    });
  if (
    /\b(?:culpad[oa]|roubou|furtou|descontar\s+(?:do|da)|cobrar\s+(?:do|da)\s+funcion)/iu.test(
      normalized,
    )
  )
    throw new BadRequestException({
      code: "INCIDENT_NON_NEUTRAL_LANGUAGE",
      message: `${field} deve descrever fatos observáveis sem imputar culpa ou desconto salarial.`,
    });
  return normalized;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  private async requireRole(
    identityId: string,
    organizationId: string,
    unitId: string,
    roles: readonly (typeof REPORT_ROLES)[number][],
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const bindings = await this.scope.requireOrganizationRole(identityId, organizationId, roles);
    if (
      !bindings.some(
        (binding) =>
          roles.includes(binding.role as (typeof REPORT_ROLES)[number]) &&
          (binding.unitId === null || binding.unitId === unitId),
      )
    )
      throw new ForbiddenException({
        code: "INCIDENT_ROLE_DENIED",
        message: "Ação de incidente não autorizada nesta unidade.",
      });
  }

  async report(
    identityId: string,
    organizationId: string,
    unitId: string,
    keyValue: string,
    input: {
      incidentType: string;
      neutralSummary: string;
      evidence: {
        kind: "document" | "photo" | "note" | "reference";
        reference: string;
        checksum?: string;
      }[];
      amountCents?: number;
      occurredAt: string;
    },
  ) {
    await this.requireRole(identityId, organizationId, unitId, REPORT_ROLES);
    const key = idempotencyKey(keyValue);
    const neutralSummary = neutralText(input.neutralSummary, 15, "neutralSummary");
    const occurredAt = new Date(input.occurredAt);
    if (
      input.incidentType.trim().length < 3 ||
      input.incidentType.length > 48 ||
      Number.isNaN(occurredAt.valueOf()) ||
      input.evidence.length > 50 ||
      input.evidence.some(
        (item) =>
          item.reference.trim().length === 0 ||
          item.reference.length > 500 ||
          (item.checksum !== undefined && item.checksum.length > 160),
      ) ||
      (input.amountCents !== undefined &&
        (!Number.isSafeInteger(input.amountCents) ||
          input.amountCents < 0 ||
          input.amountCents > POSTGRES_INT4_MAX))
    )
      throw new BadRequestException({
        code: "INCIDENT_REPORT_INVALID",
        message: "Relato exige tipo, data, evidências e valor opcional válidos.",
      });
    const normalized = {
      ...input,
      incidentType: input.incidentType.trim(),
      neutralSummary,
      occurredAt: occurredAt.toISOString(),
    };
    const requestHash = managementRequestHash("management-incident", normalized);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`incident-report:${organizationId}:${unitId}:${key}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(managementIncidents)
        .where(
          and(
            eq(managementIncidents.organizationId, organizationId),
            eq(managementIncidents.unitId, unitId),
            eq(managementIncidents.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outro relato.",
          });
        return this.incidentDto(existing, true);
      }
      const inserted = await tx.execute<typeof managementIncidents.$inferSelect>(sql`
        select
          id,
          organization_id as "organizationId",
          unit_id as "unitId",
          incident_type as "incidentType",
          status,
          neutral_summary as "neutralSummary",
          evidence,
          amount_cents as "amountCents",
          payroll_action as "payrollAction",
          idempotency_key as "idempotencyKey",
          request_hash as "requestHash",
          reporter_identity_id as "reporterIdentityId",
          approver_identity_id as "approverIdentityId",
          occurred_at as "occurredAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from public.giromesa_report_incident(
          ${organizationId}::uuid,
          ${unitId}::uuid,
          ${normalized.incidentType}::varchar,
          ${neutralSummary}::text,
          ${JSON.stringify(input.evidence)}::jsonb,
          ${input.amountCents ?? null}::integer,
          ${key}::varchar,
          ${requestHash}::varchar,
          ${identityId}::uuid,
          ${occurredAt.toISOString()}::timestamptz
        )
      `);
      const [incident] = [...inserted];
      if (!incident) throw new Error("Incident insert returned no row.");
      return this.incidentDto(incident, false);
    });
  }

  review(
    identityId: string,
    organizationId: string,
    unitId: string,
    incidentId: string,
    key: string,
    note: string,
  ) {
    return this.transition(
      identityId,
      organizationId,
      unitId,
      incidentId,
      key,
      "under_review",
      note,
    );
  }

  async decide(
    identityId: string,
    organizationId: string,
    unitId: string,
    incidentId: string,
    key: string,
    decision: "approved" | "rejected",
    note: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, APPROVAL_ROLES);
    return this.transition(
      identityId,
      organizationId,
      unitId,
      incidentId,
      key,
      decision,
      note,
      true,
    );
  }

  async close(
    identityId: string,
    organizationId: string,
    unitId: string,
    incidentId: string,
    key: string,
    note: string,
  ) {
    await this.requireRole(identityId, organizationId, unitId, APPROVAL_ROLES);
    return this.transition(identityId, organizationId, unitId, incidentId, key, "closed", note);
  }

  private async transition(
    identityId: string,
    organizationId: string,
    unitId: string,
    incidentId: string,
    keyValue: string,
    target: Exclude<IncidentStatus, "reported">,
    noteValue: string,
    independentApproval = false,
  ) {
    await this.requireRole(identityId, organizationId, unitId, REPORT_ROLES);
    const key = idempotencyKey(keyValue);
    const note = neutralText(noteValue, 15, "neutralNote");
    const requestHash = managementRequestHash("management-incident-transition", {
      incidentId,
      target,
      note,
    });
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`incident:${incidentId}`}))`);
      const [existingEvent] = await tx
        .select()
        .from(managementIncidentEvents)
        .where(
          and(
            eq(managementIncidentEvents.organizationId, organizationId),
            eq(managementIncidentEvents.unitId, unitId),
            eq(managementIncidentEvents.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (existingEvent) {
        if (existingEvent.requestHash !== requestHash)
          throw new ConflictException({
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
            message: "A chave já foi usada com outra transição.",
          });
        const [replayed] = await tx
          .select()
          .from(managementIncidents)
          .where(eq(managementIncidents.id, incidentId))
          .limit(1);
        if (!replayed) throw new NotFoundException({ code: "INCIDENT_NOT_FOUND" });
        return this.incidentDto(replayed, true);
      }
      const [incident] = await tx
        .select()
        .from(managementIncidents)
        .where(
          and(
            eq(managementIncidents.organizationId, organizationId),
            eq(managementIncidents.unitId, unitId),
            eq(managementIncidents.id, incidentId),
          ),
        )
        .limit(1);
      if (!incident)
        throw new NotFoundException({
          code: "INCIDENT_NOT_FOUND",
          message: "Incidente não encontrado.",
        });
      const allowed: Record<IncidentStatus, readonly IncidentStatus[]> = {
        reported: ["under_review"],
        under_review: ["approved", "rejected"],
        approved: ["closed"],
        rejected: ["closed"],
        closed: [],
      };
      if (!allowed[incident.status].includes(target))
        throw new ConflictException({
          code: "INCIDENT_TRANSITION_INVALID",
          message: `Transição ${incident.status} -> ${target} não permitida.`,
        });
      if (independentApproval && incident.reporterIdentityId === identityId)
        throw new ConflictException({
          code: "INCIDENT_INDEPENDENT_APPROVAL_REQUIRED",
          message: "A decisão exige uma identidade diferente do relator.",
        });
      const transitioned = await tx.execute<typeof managementIncidents.$inferSelect>(sql`
        select
          id,
          organization_id as "organizationId",
          unit_id as "unitId",
          incident_type as "incidentType",
          status,
          neutral_summary as "neutralSummary",
          evidence,
          amount_cents as "amountCents",
          payroll_action as "payrollAction",
          idempotency_key as "idempotencyKey",
          request_hash as "requestHash",
          reporter_identity_id as "reporterIdentityId",
          approver_identity_id as "approverIdentityId",
          occurred_at as "occurredAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from public.giromesa_transition_incident(
          ${organizationId}::uuid,
          ${unitId}::uuid,
          ${incidentId}::uuid,
          ${target}::varchar,
          ${note}::text,
          ${key}::varchar,
          ${requestHash}::varchar,
          ${identityId}::uuid
        )
      `);
      const [updated] = [...transitioned];
      if (!updated) throw new Error("Incident update returned no row.");
      return this.incidentDto(updated, false);
    });
  }

  async reportView(identityId: string, organizationId: string, unitId: string, incidentId: string) {
    await this.requireRole(identityId, organizationId, unitId, REPORT_ROLES);
    const [incident] = await this.database.db
      .select()
      .from(managementIncidents)
      .where(
        and(
          eq(managementIncidents.organizationId, organizationId),
          eq(managementIncidents.unitId, unitId),
          eq(managementIncidents.id, incidentId),
        ),
      )
      .limit(1);
    if (!incident)
      throw new NotFoundException({
        code: "INCIDENT_NOT_FOUND",
        message: "Incidente não encontrado.",
      });
    const events = await this.database.db
      .select()
      .from(managementIncidentEvents)
      .where(eq(managementIncidentEvents.incidentId, incident.id))
      .orderBy(asc(managementIncidentEvents.createdAt));
    return { ...this.incidentDto(incident, false), events };
  }

  private incidentDto(
    incident: typeof managementIncidents.$inferSelect,
    idempotentReplay: boolean,
  ) {
    return {
      incidentId: incident.id,
      incidentType: incident.incidentType,
      status: incident.status,
      neutralSummary: incident.neutralSummary,
      evidence: incident.evidence,
      amountCents: incident.amountCents,
      payrollAction: false as const,
      reporterIdentityId: incident.reporterIdentityId,
      approverIdentityId: incident.approverIdentityId,
      occurredAt: incident.occurredAt,
      idempotentReplay,
    };
  }
}
