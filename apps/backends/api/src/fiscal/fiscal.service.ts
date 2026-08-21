import { createHash } from "node:crypto";
import {
  accountantRequests,
  accountingExports,
  auditEvents,
  fiscalDocumentEvents,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalPeriods,
  fiscalProfiles,
  fiscalWebhookReceipts,
  legalEntities,
  outboxEvents,
  posOrderItems,
  posOrders,
  posProducts,
  productTaxRevisions,
  units,
} from "@giromesa/db";
import {
  decryptSecret,
  encryptionKey,
  encryptSecret,
  hasPermission,
  type SecretEnvelope,
  SYSTEM_ROLES,
  type SystemRole,
} from "@giromesa/domain";
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import type {
  AccountantRequestInput,
  AccountantRequestListQuery,
  CancelFiscalDocumentInput,
  FiscalDocumentListQuery,
  FiscalProfileInput,
  FocusCompanyOnboardingInput,
  ProductTaxRevisionBulkInput,
  ProductTaxRevisionInput,
  ProductTaxRevisionListQuery,
  ReopenFiscalPeriodInput,
  ResolveAccountantRequestInput,
} from "./fiscal.schemas.js";
import { edgeFiscalEventSchema, idempotencyKeySchema } from "./fiscal.schemas.js";
import {
  type FocusCompany,
  type FocusCompanyInput,
  type FocusDocumentResult,
  FocusNfeClient,
  FocusNfeError,
} from "./focus-nfe.client.js";

type Permission =
  | "fiscal:dashboard:read"
  | "fiscal:documents:read"
  | "fiscal:periods:read"
  | "fiscal:periods:write"
  | "fiscal:periods:reopen"
  | "fiscal:configuration:write"
  | "accounting:exports:read"
  | "accounting:requests:read"
  | "accounting:requests:write";

type StoredFocusConnection = {
  companyId: string;
  cnpj: string;
  status: "ready" | "credentials_missing" | "error";
  idempotencyHash?: string;
  tokenProduction?: SecretEnvelope;
  tokenHomologation?: SecretEnvelope;
  certificateValidUntil: string | null;
  enabled: { nfce: boolean; nfe: boolean; nfse: boolean };
  lastCheckedAt: string;
  lastError?: { code: string; message: string };
};

type FiscalSettings = Record<string, unknown> & {
  series?: { nfce?: string; nfe?: string; nfse?: string };
  focus?: StoredFocusConnection;
};

export function competenceBounds(competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const from = new Date(Date.UTC(year as number, (month as number) - 1, 1));
  const to = new Date(Date.UTC(year as number, month as number, 1));
  return { competenceDate: from.toISOString().slice(0, 10), from, to };
}

export function buildAccountingPackage(
  organizationId: string,
  unitId: string,
  competence: string,
  closedAt: Date,
  documents: readonly {
    id: string;
    model: "nfce" | "nfe" | "nfse";
    status: "pending" | "processing" | "authorized" | "rejected" | "contingency" | "canceled";
    accessKey: string | null;
    series: string | null;
    number: number | null;
    totalCents: number;
    taxCents: number;
    issuedAt: Date;
    xmlSha256: string | null;
  }[],
) {
  const totals = documents.reduce(
    (summary, document) => {
      summary.documents += 1;
      summary.totalCents += document.status === "authorized" ? document.totalCents : 0;
      summary.taxCents += document.status === "authorized" ? document.taxCents : 0;
      summary.byStatus[document.status] = (summary.byStatus[document.status] ?? 0) + 1;
      return summary;
    },
    {
      documents: 0,
      totalCents: 0,
      taxCents: 0,
      byStatus: {} as Record<string, number>,
    },
  );
  return {
    schemaVersion: 1,
    organizationId,
    unitId,
    competence,
    closedAt: closedAt.toISOString(),
    totals,
    documents: documents.map((document) => ({
      id: document.id,
      model: document.model,
      status: document.status,
      accessKey: document.accessKey,
      series: document.series,
      number: document.number,
      totalCents: document.totalCents,
      taxCents: document.taxCents,
      issuedAt: document.issuedAt.toISOString(),
      xmlSha256: document.xmlSha256,
    })),
  };
}

export function buildFocusCompanyInput(
  legalEntity: {
    legalName: string;
    document: string;
  },
  profile: {
    taxRegime: string;
    crt: string;
    stateCode: string;
    municipalRegistration: string | null;
    settings: Record<string, unknown>;
  },
  input: FocusCompanyOnboardingInput,
): FocusCompanyInput {
  const series = settingsOf(profile.settings).series ?? {};
  const taxRegime =
    profile.crt === "4"
      ? 4
      : profile.taxRegime === "simples_nacional"
        ? 1
        : profile.taxRegime === "simples_excesso"
          ? 2
          : 3;
  return {
    nome: legalEntity.legalName,
    nome_fantasia: input.tradeName,
    cnpj: legalEntity.document,
    inscricao_estadual: input.stateRegistration,
    inscricao_municipal: profile.municipalRegistration ?? undefined,
    regime_tributario: taxRegime,
    logradouro: input.street,
    numero: input.number,
    complemento: input.complement,
    municipio: input.city,
    bairro: input.district,
    cep: Number(input.postalCode),
    uf: profile.stateCode,
    telefone: input.phone,
    email: input.email,
    cpf_cnpj_contabilidade: input.accountantDocument,
    habilita_nfe: input.enableNfe,
    habilita_nfce: input.enableNfce,
    habilita_nfse: input.enableNfse,
    discrimina_impostos: true,
    arquivo_certificado_base64: input.certificateBase64,
    senha_certificado: input.certificatePassword,
    csc_nfce_producao: input.cscProduction,
    id_token_nfce_producao: input.cscProductionId ? Number(input.cscProductionId) : undefined,
    csc_nfce_homologacao: input.cscHomologation,
    id_token_nfce_homologacao: input.cscHomologationId
      ? Number(input.cscHomologationId)
      : undefined,
    serie_nfe_producao: series.nfe,
    serie_nfe_homologacao: series.nfe,
    serie_nfce_producao: series.nfce,
    serie_nfce_homologacao: series.nfce,
    serie_nfse_producao: series.nfse,
    serie_nfse_homologacao: series.nfse,
  };
}

function settingsOf(value: unknown): FiscalSettings {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as FiscalSettings)
    : {};
}

function publicFocusConnection(settings: FiscalSettings) {
  const connection = settings.focus;
  if (!connection) return null;
  return {
    companyId: connection.companyId,
    cnpj: connection.cnpj,
    status: connection.status,
    certificateValidUntil: connection.certificateValidUntil,
    enabled: connection.enabled,
    lastCheckedAt: connection.lastCheckedAt,
    environments: {
      homologation: Boolean(connection.tokenHomologation),
      production: Boolean(connection.tokenProduction),
    },
    lastError: connection.lastError,
  };
}

function sanitizedProfile<T extends { settings: unknown }>(profile: T) {
  const settings = settingsOf(profile.settings);
  return {
    ...profile,
    settings: {
      series: settings.series ?? {},
      focus: publicFocusConnection(settings),
    },
  };
}

function providerStatusPayload(
  profile: { provider: string | null; environment: string; settings: unknown } | null,
  platformConfigured: boolean,
  encryptionConfigured: boolean,
) {
  const connection =
    profile?.provider === "focus" ? publicFocusConnection(settingsOf(profile.settings)) : null;
  const selectedEnvironmentReady =
    profile?.environment === "production"
      ? connection?.environments.production
      : profile?.environment === "homologation"
        ? connection?.environments.homologation
        : false;
  const status =
    !platformConfigured || !encryptionConfigured
      ? "platform_not_configured"
      : !profile
        ? "profile_required"
        : !connection
          ? "company_required"
          : connection.status === "error"
            ? "error"
            : !selectedEnvironmentReady
              ? "credentials_missing"
              : "ready";
  return {
    provider: "focus" as const,
    status,
    environment:
      profile?.environment === "production" || profile?.environment === "homologation"
        ? profile.environment
        : null,
    platformConfigured: platformConfigured && encryptionConfigured,
    connection,
    nextAction:
      status === "platform_not_configured"
        ? "Configure as credenciais da conta GiroMesa no ambiente da API."
        : status === "profile_required"
          ? "Salve o perfil fiscal da unidade."
          : status === "company_required"
            ? "Valide e cadastre a empresa emitente na Focus NFe."
            : status === "credentials_missing"
              ? "Sincronize os tokens da empresa emitente."
              : status === "error"
                ? "Revise a última falha retornada pela Focus NFe."
                : "Conexão pronta para o ambiente selecionado.",
  };
}

function focusConnection(
  company: FocusCompany,
  environment: "homologation" | "production",
  idempotencyHash: string | undefined,
  key: Buffer,
  scope: { organizationId: string; unitId: string },
  current?: StoredFocusConnection,
): StoredFocusConnection {
  const associatedData = (target: "homologation" | "production") =>
    `focus:${scope.organizationId}:${scope.unitId}:${target}`;
  const tokenProduction = company.tokenProduction
    ? encryptSecret(company.tokenProduction, key, associatedData("production"))
    : current?.tokenProduction;
  const tokenHomologation = company.tokenHomologation
    ? encryptSecret(company.tokenHomologation, key, associatedData("homologation"))
    : current?.tokenHomologation;
  const selectedToken = environment === "production" ? tokenProduction : tokenHomologation;
  return {
    companyId: company.id,
    cnpj: company.cnpj,
    status: selectedToken ? "ready" : "credentials_missing",
    idempotencyHash,
    tokenProduction,
    tokenHomologation,
    certificateValidUntil: company.certificateValidUntil,
    enabled: company.enabled,
    lastCheckedAt: new Date().toISOString(),
  };
}

function rethrowFocus(error: unknown): never {
  if (!(error instanceof FocusNfeError)) throw error;
  const body = {
    code: `FOCUS_${error.code.toUpperCase()}`,
    message: error.message,
    details: error.details,
  };
  if (error.status === 503) throw new ServiceUnavailableException(body);
  if (error.status >= 500) throw new BadGatewayException(body);
  throw new HttpException(body, error.status >= 400 && error.status < 500 ? error.status : 422);
}

@Injectable()
export class FiscalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
    private readonly focus: FocusNfeClient,
  ) {}

  private async requirePermission(
    identityId: string,
    organizationId: string,
    unitId: string,
    permission: Permission,
  ) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const bindings = await this.scope.requireOrganizationRole(
      identityId,
      organizationId,
      SYSTEM_ROLES,
    );
    const allowed = bindings.some(
      (binding) =>
        (binding.unitId === null || binding.unitId === unitId) &&
        hasPermission(binding.role as SystemRole, permission),
    );
    if (!allowed) {
      throw new ForbiddenException({
        code: "FISCAL_PERMISSION_DENIED",
        message: "Ação fiscal não autorizada nesta unidade.",
      });
    }
  }

  async profile(identityId: string, organizationId: string, unitId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:dashboard:read");
    const [profile] = await this.database.db
      .select()
      .from(fiscalProfiles)
      .where(
        and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
      )
      .limit(1);
    if (profile) return sanitizedProfile(profile);
    const [unit] = await this.database.db
      .select({ legalEntityId: units.legalEntityId })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit?.legalEntityId) return null;
    return {
      id: null,
      organizationId,
      unitId,
      legalEntityId: unit.legalEntityId,
      version: 0,
      taxRegime: "simples_nacional",
      crt: "1",
      municipalRegistration: null,
      cnae: null,
      stateCode: "",
      cityCode: "",
      environment: "homologation" as const,
      provider: null,
      settings: { series: {}, focus: null },
      approvedByIdentityId: null,
      approvedAt: null,
      createdAt: null,
      updatedAt: null,
      draft: true,
    };
  }

  async updateProfile(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: FiscalProfileInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    return this.database.db.transaction(async (tx) => {
      const [legalEntity] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(
          and(
            eq(legalEntities.organizationId, organizationId),
            eq(legalEntities.id, input.legalEntityId),
          ),
        )
        .limit(1);
      if (!legalEntity) {
        throw new NotFoundException({
          code: "LEGAL_ENTITY_NOT_FOUND",
          message: "Entidade legal não encontrada nesta organização.",
        });
      }
      const [currentProfile] = await tx
        .select({ legalEntityId: fiscalProfiles.legalEntityId, settings: fiscalProfiles.settings })
        .from(fiscalProfiles)
        .where(
          and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
        )
        .limit(1);
      const currentSettings = settingsOf(currentProfile?.settings);
      const nextSettings = {
        ...currentSettings,
        series: input.series,
        focus: currentProfile?.legalEntityId === legalEntity.id ? currentSettings.focus : undefined,
      };
      const now = new Date();
      const [profile] = await tx
        .insert(fiscalProfiles)
        .values({
          organizationId,
          unitId,
          legalEntityId: legalEntity.id,
          taxRegime: input.taxRegime,
          crt: input.crt,
          municipalRegistration: input.municipalRegistration,
          cnae: input.cnae,
          stateCode: input.stateCode,
          cityCode: input.cityCode,
          environment: input.environment,
          provider: input.provider,
          settings: nextSettings,
          approvedByIdentityId: identityId,
          approvedAt: now,
        })
        .onConflictDoUpdate({
          target: [fiscalProfiles.organizationId, fiscalProfiles.unitId],
          set: {
            legalEntityId: legalEntity.id,
            version: sql`${fiscalProfiles.version} + 1`,
            taxRegime: input.taxRegime,
            crt: input.crt,
            municipalRegistration: input.municipalRegistration ?? null,
            cnae: input.cnae ?? null,
            stateCode: input.stateCode,
            cityCode: input.cityCode,
            environment: input.environment,
            provider: input.provider ?? null,
            settings: nextSettings,
            approvedByIdentityId: identityId,
            approvedAt: now,
            updatedAt: now,
          },
        })
        .returning();
      if (!profile) throw new ConflictException({ code: "FISCAL_PROFILE_UPDATE_FAILED" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "fiscal.profile.updated",
        entityType: "fiscal_profile",
        entityId: profile.id,
        metadata: { version: profile.version, environment: profile.environment },
      });
      await tx.insert(outboxEvents).values({
        topic: "fiscal.profile.updated",
        aggregateType: "fiscal_profile",
        aggregateId: profile.id,
        payload: { organizationId, unitId, profileId: profile.id, version: profile.version },
      });
      return sanitizedProfile(profile);
    });
  }

  async providerStatus(identityId: string, organizationId: string, unitId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:dashboard:read");
    const [profile] = await this.database.db
      .select({
        provider: fiscalProfiles.provider,
        environment: fiscalProfiles.environment,
        settings: fiscalProfiles.settings,
      })
      .from(fiscalProfiles)
      .where(
        and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
      )
      .limit(1);
    return providerStatusPayload(
      profile ?? null,
      this.focus.configured(),
      Boolean(process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY?.trim()),
    );
  }

  async edgeProviderConfiguration(organizationId: string, unitId: string) {
    const [profile] = await this.database.db
      .select({
        environment: fiscalProfiles.environment,
        provider: fiscalProfiles.provider,
        settings: fiscalProfiles.settings,
      })
      .from(fiscalProfiles)
      .where(
        and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
      )
      .limit(1);
    if (profile?.provider !== "focus") {
      return {
        provider: "focus" as const,
        enabled: false,
        environment: "homologation" as const,
        token: null,
      };
    }
    const connection = settingsOf(profile.settings).focus;
    const envelope =
      profile.environment === "production"
        ? connection?.tokenProduction
        : connection?.tokenHomologation;
    if (!envelope) {
      return {
        provider: "focus" as const,
        enabled: false,
        environment: profile.environment,
        token: null,
      };
    }
    try {
      const key = encryptionKey(
        process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY,
        "FISCAL_CREDENTIALS_ENCRYPTION_KEY",
      );
      return {
        provider: "focus" as const,
        enabled: true,
        environment: profile.environment,
        token: decryptSecret(
          envelope,
          key,
          `focus:${organizationId}:${unitId}:${profile.environment}`,
        ),
      };
    } catch {
      return {
        provider: "focus" as const,
        enabled: false,
        environment: profile.environment,
        token: null,
      };
    }
  }

  async validateFocusCompany(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: FocusCompanyOnboardingInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    const setup = await this.focusSetup(organizationId, unitId);
    this.assertFocusSetup(setup, input);
    const payload = buildFocusCompanyInput(setup.legalEntity, setup.profile, input);
    try {
      const existing = await this.focus.listCompanies(setup.legalEntity.document);
      const company = existing[0]
        ? await this.focus.updateCompany(existing[0].id, payload, true)
        : await this.focus.createCompany(payload, true);
      return {
        valid: true,
        existingCompany: Boolean(existing[0]),
        companyId: company.id,
        cnpj: company.cnpj,
        certificateValidUntil: company.certificateValidUntil,
      };
    } catch (error) {
      rethrowFocus(error);
    }
  }

  async activateFocusCompany(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: FocusCompanyOnboardingInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    const parsedKey = idempotencyKeySchema.parse(idempotencyKey);
    const keyHash = createHash("sha256").update(parsedKey).digest("hex");
    const encryption = encryptionKey(
      process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY,
      "FISCAL_CREDENTIALS_ENCRYPTION_KEY",
    );
    try {
      return await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`focus:${organizationId}:${unitId}`}, 0))`,
        );
        const [profile] = await tx
          .select()
          .from(fiscalProfiles)
          .where(
            and(
              eq(fiscalProfiles.organizationId, organizationId),
              eq(fiscalProfiles.unitId, unitId),
            ),
          )
          .limit(1);
        if (!profile) throw new NotFoundException({ code: "FISCAL_PROFILE_NOT_FOUND" });
        const currentSettings = settingsOf(profile.settings);
        if (currentSettings.focus?.idempotencyHash === keyHash) {
          return { replayed: true, provider: providerStatusPayload(profile, true, true) };
        }
        const [legalEntity] = await tx
          .select({
            id: legalEntities.id,
            legalName: legalEntities.legalName,
            document: legalEntities.document,
          })
          .from(legalEntities)
          .where(
            and(
              eq(legalEntities.organizationId, organizationId),
              eq(legalEntities.id, profile.legalEntityId),
            ),
          )
          .limit(1);
        if (!legalEntity) throw new NotFoundException({ code: "LEGAL_ENTITY_NOT_FOUND" });
        const setup = { profile, legalEntity };
        this.assertFocusSetup(setup, input);
        const payload = buildFocusCompanyInput(legalEntity, profile, input);
        const listed = await this.focus.listCompanies(legalEntity.document);
        let company = listed[0]
          ? await this.focus.updateCompany(listed[0].id, payload)
          : await this.focus.createCompany(payload);
        company = await this.focus.company(company.id);
        const connection = focusConnection(
          company,
          profile.environment,
          keyHash,
          encryption,
          { organizationId, unitId },
          currentSettings.focus,
        );
        const now = new Date();
        const [updated] = await tx
          .update(fiscalProfiles)
          .set({
            provider: "focus",
            settings: { ...currentSettings, focus: connection },
            updatedAt: now,
          })
          .where(eq(fiscalProfiles.id, profile.id))
          .returning();
        await tx
          .update(legalEntities)
          .set({
            stateRegistration: input.stateRegistration,
            fiscalProvider: "focus",
            fiscalStatus: connection.status === "ready" ? "active" : "pending",
            updatedAt: now,
          })
          .where(eq(legalEntities.id, legalEntity.id));
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          actorIdentityId: identityId,
          action: listed[0] ? "fiscal.focus_company.linked" : "fiscal.focus_company.created",
          entityType: "fiscal_profile",
          entityId: profile.id,
          metadata: {
            provider: "focus",
            companyId: company.id,
            cnpj: company.cnpj,
            status: connection.status,
          },
        });
        await tx.insert(outboxEvents).values({
          topic: "fiscal.focus_company.activated",
          aggregateType: "fiscal_profile",
          aggregateId: profile.id,
          payload: { organizationId, unitId, profileId: profile.id, companyId: company.id },
        });
        if (!updated) throw new ConflictException({ code: "FISCAL_PROVIDER_UPDATE_FAILED" });
        return {
          replayed: false,
          provider: providerStatusPayload(updated, true, true),
        };
      });
    } catch (error) {
      rethrowFocus(error);
    }
  }

  async checkFocusCompany(identityId: string, organizationId: string, unitId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    const encryption = encryptionKey(
      process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY,
      "FISCAL_CREDENTIALS_ENCRYPTION_KEY",
    );
    const [profile] = await this.database.db
      .select()
      .from(fiscalProfiles)
      .where(
        and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
      )
      .limit(1);
    const current = profile ? settingsOf(profile.settings).focus : undefined;
    if (!profile || !current?.companyId) {
      throw new ConflictException({
        code: "FOCUS_COMPANY_NOT_CONNECTED",
        message: "Conclua o cadastro da empresa na Focus NFe antes de testar a conexão.",
      });
    }
    try {
      const company = await this.focus.company(current.companyId);
      const connection = focusConnection(
        company,
        profile.environment,
        current.idempotencyHash,
        encryption,
        { organizationId, unitId },
        current,
      );
      const [updated] = await this.database.db
        .update(fiscalProfiles)
        .set({
          settings: { ...settingsOf(profile.settings), focus: connection },
          updatedAt: new Date(),
        })
        .where(eq(fiscalProfiles.id, profile.id))
        .returning();
      return providerStatusPayload(updated ?? profile, true, true);
    } catch (error) {
      rethrowFocus(error);
    }
  }

  private async focusSetup(organizationId: string, unitId: string) {
    const [row] = await this.database.db
      .select({
        profile: fiscalProfiles,
        legalEntity: {
          id: legalEntities.id,
          legalName: legalEntities.legalName,
          document: legalEntities.document,
        },
      })
      .from(fiscalProfiles)
      .innerJoin(
        legalEntities,
        and(
          eq(legalEntities.organizationId, organizationId),
          eq(legalEntities.id, fiscalProfiles.legalEntityId),
        ),
      )
      .where(
        and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
      )
      .limit(1);
    if (!row) {
      throw new ConflictException({
        code: "FISCAL_PROFILE_REQUIRED",
        message: "Salve o perfil fiscal antes de cadastrar a empresa na Focus NFe.",
      });
    }
    return row;
  }

  private assertFocusSetup(
    setup: Awaited<ReturnType<FiscalService["focusSetup"]>>,
    input: FocusCompanyOnboardingInput,
  ) {
    if (!/^\d{14}$/.test(setup.legalEntity.document)) {
      throw new ConflictException({
        code: "FOCUS_CNPJ_UNSUPPORTED",
        message:
          "A API de empresas da Focus NFe exige, neste momento, CNPJ numérico com 14 dígitos.",
      });
    }
    if (input.enableNfce) {
      const missingCsc =
        setup.profile.environment === "production"
          ? !input.cscProduction || !input.cscProductionId
          : !input.cscHomologation || !input.cscHomologationId;
      if (missingCsc) {
        throw new ConflictException({
          code: "FOCUS_NFCE_CSC_REQUIRED",
          message: `Informe o CSC e o ID de ${setup.profile.environment === "production" ? "produção" : "homologação"} para habilitar NFC-e.`,
        });
      }
    }
  }

  async taxRevisions(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: ProductTaxRevisionListQuery,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:dashboard:read");
    const conditions = [
      eq(productTaxRevisions.organizationId, organizationId),
      eq(productTaxRevisions.unitId, unitId),
    ];
    if (query.productId) conditions.push(eq(productTaxRevisions.productId, query.productId));
    if (query.status) conditions.push(eq(productTaxRevisions.status, query.status));
    return this.database.db
      .select()
      .from(productTaxRevisions)
      .where(and(...conditions))
      .orderBy(desc(productTaxRevisions.createdAt));
  }

  async createTaxRevision(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ProductTaxRevisionInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    return this.database.db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(
          and(eq(posProducts.organizationId, organizationId), eq(posProducts.id, input.productId)),
        )
        .limit(1);
      if (!product) {
        throw new NotFoundException({
          code: "FISCAL_PRODUCT_NOT_FOUND",
          message: "Produto não encontrado nesta organização.",
        });
      }
      const [versionRow] = await tx
        .select({ version: sql<number>`coalesce(max(${productTaxRevisions.version}), 0)::int + 1` })
        .from(productTaxRevisions)
        .where(
          and(
            eq(productTaxRevisions.organizationId, organizationId),
            eq(productTaxRevisions.unitId, unitId),
            eq(productTaxRevisions.productId, product.id),
          ),
        );
      const now = new Date();
      if (input.status === "active") {
        await tx
          .update(productTaxRevisions)
          .set({ status: "revoked", updatedAt: now })
          .where(
            and(
              eq(productTaxRevisions.organizationId, organizationId),
              eq(productTaxRevisions.unitId, unitId),
              eq(productTaxRevisions.productId, product.id),
              eq(productTaxRevisions.status, "active"),
            ),
          );
      }
      const [revision] = await tx
        .insert(productTaxRevisions)
        .values({
          organizationId,
          unitId,
          productId: product.id,
          version: Number(versionRow?.version ?? 1),
          status: input.status,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil,
          classification: input.classification,
          createdByIdentityId: identityId,
          approvedByIdentityId: input.status === "active" ? identityId : undefined,
          approvedAt: input.status === "active" ? now : undefined,
        })
        .returning();
      if (!revision) throw new ConflictException({ code: "FISCAL_REVISION_CREATE_FAILED" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "fiscal.product_tax_revision.created",
        entityType: "product_tax_revision",
        entityId: revision.id,
        metadata: { productId: product.id, version: revision.version, status: revision.status },
      });
      await tx.insert(outboxEvents).values({
        topic: "fiscal.product_tax_revision.created",
        aggregateType: "product_tax_revision",
        aggregateId: revision.id,
        payload: { organizationId, unitId, productId: product.id, revisionId: revision.id },
      });
      return revision;
    });
  }

  async createTaxRevisionsBulk(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: ProductTaxRevisionBulkInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    const productIds = [...new Set(input.productIds)].sort();
    return this.database.db.transaction(async (tx) => {
      const products = await tx
        .select({ id: posProducts.id })
        .from(posProducts)
        .where(
          and(eq(posProducts.organizationId, organizationId), inArray(posProducts.id, productIds)),
        );
      if (products.length !== productIds.length) {
        throw new NotFoundException({
          code: "FISCAL_PRODUCT_NOT_FOUND",
          message: "Um ou mais produtos não pertencem a esta organização.",
        });
      }
      const now = new Date();
      const revisions = [];
      for (const productId of productIds) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`tax:${organizationId}:${unitId}:${productId}`}, 0))`,
        );
        const [versionRow] = await tx
          .select({
            version: sql<number>`coalesce(max(${productTaxRevisions.version}), 0)::int + 1`,
          })
          .from(productTaxRevisions)
          .where(
            and(
              eq(productTaxRevisions.organizationId, organizationId),
              eq(productTaxRevisions.unitId, unitId),
              eq(productTaxRevisions.productId, productId),
            ),
          );
        if (input.status === "active") {
          await tx
            .update(productTaxRevisions)
            .set({ status: "revoked", updatedAt: now })
            .where(
              and(
                eq(productTaxRevisions.organizationId, organizationId),
                eq(productTaxRevisions.unitId, unitId),
                eq(productTaxRevisions.productId, productId),
                eq(productTaxRevisions.status, "active"),
              ),
            );
        }
        const [revision] = await tx
          .insert(productTaxRevisions)
          .values({
            organizationId,
            unitId,
            productId,
            version: Number(versionRow?.version ?? 1),
            status: input.status,
            effectiveFrom: input.effectiveFrom,
            effectiveUntil: input.effectiveUntil,
            classification: input.classification,
            createdByIdentityId: identityId,
            approvedByIdentityId: input.status === "active" ? identityId : undefined,
            approvedAt: input.status === "active" ? now : undefined,
          })
          .returning();
        if (!revision) throw new ConflictException({ code: "FISCAL_REVISION_CREATE_FAILED" });
        revisions.push(revision);
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "fiscal.product_tax_revision.bulk_created",
        entityType: "product_tax_revision",
        entityId: revisions[0]?.id ?? unitId,
        metadata: { productIds, status: input.status, count: revisions.length },
      });
      await tx.insert(outboxEvents).values({
        topic: "fiscal.product_tax_revision.bulk_created",
        aggregateType: "fiscal_profile",
        aggregateId: unitId,
        payload: {
          organizationId,
          unitId,
          productIds,
          revisionIds: revisions.map((item) => item.id),
        },
      });
      return { revisions };
    });
  }

  async ingestEdgeEvent(
    event: unknown,
    hub: { organizationId: string; unitId: string; hubId?: string },
  ) {
    const parsed = edgeFiscalEventSchema.parse(event);
    const { organizationId, unitId } = hub;
    return this.database.db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ environment: fiscalProfiles.environment, provider: fiscalProfiles.provider })
        .from(fiscalProfiles)
        .where(
          and(eq(fiscalProfiles.organizationId, organizationId), eq(fiscalProfiles.unitId, unitId)),
        )
        .limit(1);
      if (!profile) {
        throw new NotFoundException({
          code: "FISCAL_PROFILE_NOT_FOUND",
          message: "Configure o perfil fiscal antes de processar eventos do hub.",
        });
      }
      const provider = profile.provider ?? "focus";
      const bodySha256 = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
      const [receipt] = await tx
        .insert(fiscalWebhookReceipts)
        .values({
          organizationId,
          unitId,
          provider,
          providerEventId: parsed.id,
          bodySha256,
          payload: parsed,
        })
        .onConflictDoNothing()
        .returning({ id: fiscalWebhookReceipts.id });
      if (!receipt) return { replayed: true };

      const occurredAt = new Date(parsed.occurredAt);
      if (parsed.payload.kind === "fiscal.number_invalidation_result") {
        await tx.insert(auditEvents).values({
          organizationId,
          unitId,
          action: parsed.payload.kind,
          entityType: "fiscal_number_invalidation",
          entityId: parsed.payload.providerReference ?? parsed.payload.idempotencyKey,
          metadata: {
            hubId: hub.hubId,
            status: parsed.payload.status,
            cnpj: parsed.payload.cnpj,
            series: parsed.payload.series,
            initialNumber: parsed.payload.initialNumber,
            finalNumber: parsed.payload.finalNumber,
            errorCode: parsed.payload.errorCode,
          },
          occurredAt,
        });
        await tx
          .update(fiscalWebhookReceipts)
          .set({ processedAt: new Date() })
          .where(eq(fiscalWebhookReceipts.id, receipt.id));
        return { replayed: false, invalidation: parsed.payload };
      }

      const references = [eq(fiscalDocuments.idempotencyKey, parsed.payload.idempotencyKey)];
      if (parsed.payload.providerReference) {
        references.push(eq(fiscalDocuments.providerReference, parsed.payload.providerReference));
      }
      if (parsed.payload.orderId)
        references.push(eq(fiscalDocuments.orderId, parsed.payload.orderId));
      const [existing] = await tx
        .select()
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.organizationId, organizationId),
            eq(fiscalDocuments.unitId, unitId),
            or(...references),
          ),
        )
        .orderBy(desc(fiscalDocuments.createdAt))
        .limit(1);

      let document = existing;
      const accessKey = /^\d{44}$/.test(parsed.payload.providerReference ?? "")
        ? parsed.payload.providerReference
        : undefined;
      if (!document) {
        if (!parsed.payload.orderId) {
          throw new NotFoundException({
            code: "FISCAL_DOCUMENT_NOT_FOUND",
            message: "O resultado fiscal não corresponde a um documento conhecido.",
          });
        }
        const [order] = await tx
          .select({ id: posOrders.id })
          .from(posOrders)
          .where(
            and(
              eq(posOrders.organizationId, organizationId),
              eq(posOrders.unitId, unitId),
              eq(posOrders.id, parsed.payload.orderId),
            ),
          )
          .limit(1);
        if (!order) {
          throw new NotFoundException({
            code: "FISCAL_ORDER_NOT_FOUND",
            message: "Pedido de origem não encontrado no escopo do hub.",
          });
        }
        const orderItems = await tx
          .select({
            id: posOrderItems.id,
            productId: posOrderItems.productId,
            productName: posOrderItems.productName,
            quantity: posOrderItems.quantity,
            unitPriceCents: posOrderItems.unitPriceCents,
            netCents: posOrderItems.netCents,
          })
          .from(posOrderItems)
          .where(
            and(
              eq(posOrderItems.organizationId, organizationId),
              eq(posOrderItems.unitId, unitId),
              eq(posOrderItems.orderId, order.id),
            ),
          )
          .orderBy(asc(posOrderItems.createdAt), asc(posOrderItems.id));
        if (orderItems.length === 0) {
          throw new ConflictException({
            code: "FISCAL_ORDER_EMPTY",
            message: "Não é possível registrar documento fiscal para um pedido sem itens.",
          });
        }
        const productIds = [...new Set(orderItems.map((item) => item.productId))];
        const revisions = await tx
          .select({
            id: productTaxRevisions.id,
            productId: productTaxRevisions.productId,
            classification: productTaxRevisions.classification,
          })
          .from(productTaxRevisions)
          .where(
            and(
              eq(productTaxRevisions.organizationId, organizationId),
              eq(productTaxRevisions.unitId, unitId),
              eq(productTaxRevisions.status, "active"),
              inArray(productTaxRevisions.productId, productIds),
            ),
          )
          .orderBy(desc(productTaxRevisions.effectiveFrom));
        const revisionByProduct = new Map(
          revisions.map((revision) => [revision.productId, revision] as const),
        );
        const totalCents = orderItems.reduce((total, item) => total + item.netCents, 0);
        // ponytail: item taxes stay zero until the homologated tax engine returns tax amounts.
        const [created] = await tx
          .insert(fiscalDocuments)
          .values({
            organizationId,
            unitId,
            orderId: order.id,
            model: "nfce",
            environment: profile.environment,
            status: parsed.payload.status,
            idempotencyKey: parsed.payload.idempotencyKey,
            providerReference: parsed.payload.providerReference,
            accessKey,
            totalCents,
            taxCents: 0,
            snapshot: {
              source: "edge_hub",
              hubId: hub.hubId,
              orderId: order.id,
              totalSource: "pos_order_items.net_cents",
            },
            issuedAt: occurredAt,
            authorizedAt: parsed.payload.status === "authorized" ? occurredAt : undefined,
            canceledAt: parsed.payload.status === "canceled" ? occurredAt : undefined,
          })
          .returning();
        if (!created) throw new ConflictException({ code: "FISCAL_DOCUMENT_CREATE_FAILED" });
        await tx.insert(fiscalDocumentItems).values(
          orderItems.map((item, index) => {
            const revision = revisionByProduct.get(item.productId);
            return {
              organizationId,
              unitId,
              documentId: created.id,
              productId: item.productId,
              taxRevisionId: revision?.id,
              lineNumber: index + 1,
              description: item.productName,
              quantityMilli: item.quantity * 1_000,
              unitPriceCents: item.unitPriceCents,
              totalCents: item.netCents,
              taxCents: 0,
              taxSnapshot: revision?.classification ?? {},
            };
          }),
        );
        document = created;
      } else {
        const cancelAccepted =
          parsed.payload.kind === "fiscal.document.cancel_result" &&
          parsed.payload.status === "canceled";
        const cancelRejected =
          parsed.payload.kind === "fiscal.document.cancel_result" &&
          parsed.payload.status === "rejected";
        const nextStatus = cancelAccepted
          ? "canceled"
          : cancelRejected
            ? document.status
            : parsed.payload.status;
        const [updated] = await tx
          .update(fiscalDocuments)
          .set({
            status: nextStatus,
            providerReference: parsed.payload.providerReference ?? document.providerReference,
            accessKey: accessKey ?? document.accessKey,
            authorizedAt:
              nextStatus === "authorized"
                ? (document.authorizedAt ?? occurredAt)
                : document.authorizedAt,
            canceledAt:
              nextStatus === "canceled" ? (document.canceledAt ?? occurredAt) : document.canceledAt,
            updatedAt: occurredAt,
          })
          .where(eq(fiscalDocuments.id, document.id))
          .returning();
        document = updated ?? document;
      }

      await tx.insert(fiscalDocumentEvents).values({
        organizationId,
        unitId,
        documentId: document.id,
        providerEventId: parsed.id,
        type: parsed.payload.kind,
        status: document.status,
        code: parsed.payload.errorCode,
        payload: parsed.payload,
        occurredAt,
      });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        action: parsed.payload.kind,
        entityType: "fiscal_document",
        entityId: document.id,
        metadata: {
          hubId: hub.hubId,
          providerReference: parsed.payload.providerReference,
          status: document.status,
          reportedTotalCents: parsed.payload.totalCents,
          persistedTotalCents: document.totalCents,
        },
        occurredAt,
      });
      await tx
        .update(fiscalWebhookReceipts)
        .set({ processedAt: new Date() })
        .where(eq(fiscalWebhookReceipts.id, receipt.id));
      return { document, replayed: false };
    });
  }

  async dashboard(identityId: string, organizationId: string, unitId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:dashboard:read");
    const scope = and(
      eq(fiscalDocuments.organizationId, organizationId),
      eq(fiscalDocuments.unitId, unitId),
    );
    const [profileRows, statusRows, openPeriodRows, requestRows, productRows, revisionRows] =
      await Promise.all([
        this.database.db
          .select({
            id: fiscalProfiles.id,
            version: fiscalProfiles.version,
            taxRegime: fiscalProfiles.taxRegime,
            crt: fiscalProfiles.crt,
            stateCode: fiscalProfiles.stateCode,
            cityCode: fiscalProfiles.cityCode,
            environment: fiscalProfiles.environment,
            provider: fiscalProfiles.provider,
            approvedAt: fiscalProfiles.approvedAt,
          })
          .from(fiscalProfiles)
          .where(
            and(
              eq(fiscalProfiles.organizationId, organizationId),
              eq(fiscalProfiles.unitId, unitId),
            ),
          )
          .limit(1),
        this.database.db
          .select({ status: fiscalDocuments.status, count: sql<number>`count(*)::int` })
          .from(fiscalDocuments)
          .where(scope)
          .groupBy(fiscalDocuments.status),
        this.database.db
          .select({ count: sql<number>`count(*)::int` })
          .from(fiscalPeriods)
          .where(
            and(
              eq(fiscalPeriods.organizationId, organizationId),
              eq(fiscalPeriods.unitId, unitId),
              inArray(fiscalPeriods.status, ["open", "reviewing"]),
            ),
          ),
        this.database.db
          .select({ count: sql<number>`count(*)::int` })
          .from(accountantRequests)
          .where(
            and(
              eq(accountantRequests.organizationId, organizationId),
              eq(accountantRequests.unitId, unitId),
              eq(accountantRequests.status, "open"),
            ),
          ),
        this.database.db
          .select({ count: sql<number>`count(*)::int` })
          .from(posProducts)
          .where(eq(posProducts.organizationId, organizationId)),
        this.database.db
          .select({ count: sql<number>`count(distinct ${productTaxRevisions.productId})::int` })
          .from(productTaxRevisions)
          .where(
            and(
              eq(productTaxRevisions.organizationId, organizationId),
              eq(productTaxRevisions.unitId, unitId),
              eq(productTaxRevisions.status, "active"),
            ),
          ),
      ]);
    const documentsByStatus = Object.fromEntries(
      statusRows.map((row) => [row.status, Number(row.count)]),
    );
    const productCount = Number(productRows[0]?.count ?? 0);
    const classifiedProductCount = Number(revisionRows[0]?.count ?? 0);
    return {
      profile: profileRows[0] ?? null,
      documentsByStatus,
      pendingDocuments:
        (documentsByStatus.pending ?? 0) +
        (documentsByStatus.processing ?? 0) +
        (documentsByStatus.contingency ?? 0),
      openPeriods: Number(openPeriodRows[0]?.count ?? 0),
      openAccountantRequests: Number(requestRows[0]?.count ?? 0),
      products: {
        total: productCount,
        classified: classifiedProductCount,
        missingClassification: Math.max(0, productCount - classifiedProductCount),
      },
    };
  }

  async documents(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: FiscalDocumentListQuery,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:documents:read");
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const conditions = [
      eq(fiscalDocuments.organizationId, organizationId),
      eq(fiscalDocuments.unitId, unitId),
    ];
    if (query.status) conditions.push(eq(fiscalDocuments.status, query.status));
    if (query.model) conditions.push(eq(fiscalDocuments.model, query.model));
    if (query.from) {
      conditions.push(
        sql`(${fiscalDocuments.issuedAt} AT TIME ZONE ${unit.timezone}) >= ${query.from}::date`,
      );
    }
    if (query.to) {
      conditions.push(
        sql`(${fiscalDocuments.issuedAt} AT TIME ZONE ${unit.timezone}) < (${query.to}::date + 1)`,
      );
    }
    if (query.search) {
      const search = `%${query.search}%`;
      const searchCondition = or(
        ilike(fiscalDocuments.accessKey, search),
        ilike(fiscalDocuments.providerReference, search),
        ilike(fiscalDocuments.customerDocument, search),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    const where = and(...conditions);
    const offset = (query.page - 1) * query.pageSize;
    const [items, countRows] = await Promise.all([
      this.database.db
        .select({
          id: fiscalDocuments.id,
          orderId: fiscalDocuments.orderId,
          model: fiscalDocuments.model,
          environment: fiscalDocuments.environment,
          status: fiscalDocuments.status,
          providerReference: fiscalDocuments.providerReference,
          accessKey: fiscalDocuments.accessKey,
          series: fiscalDocuments.series,
          number: fiscalDocuments.number,
          totalCents: fiscalDocuments.totalCents,
          taxCents: fiscalDocuments.taxCents,
          customerDocument: fiscalDocuments.customerDocument,
          issuedAt: fiscalDocuments.issuedAt,
          authorizedAt: fiscalDocuments.authorizedAt,
          canceledAt: fiscalDocuments.canceledAt,
        })
        .from(fiscalDocuments)
        .where(where)
        .orderBy(desc(fiscalDocuments.issuedAt))
        .limit(query.pageSize)
        .offset(offset),
      this.database.db
        .select({ count: sql<number>`count(*)::int` })
        .from(fiscalDocuments)
        .where(where),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: Number(countRows[0]?.count ?? 0),
      },
    };
  }

  async document(identityId: string, organizationId: string, unitId: string, documentId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:documents:read");
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
    if (!document) {
      throw new NotFoundException({
        code: "FISCAL_DOCUMENT_NOT_FOUND",
        message: "Documento fiscal não encontrado.",
      });
    }
    const [items, events] = await Promise.all([
      this.database.db
        .select()
        .from(fiscalDocumentItems)
        .where(
          and(
            eq(fiscalDocumentItems.organizationId, organizationId),
            eq(fiscalDocumentItems.unitId, unitId),
            eq(fiscalDocumentItems.documentId, documentId),
          ),
        )
        .orderBy(asc(fiscalDocumentItems.lineNumber)),
      this.database.db
        .select()
        .from(fiscalDocumentEvents)
        .where(
          and(
            eq(fiscalDocumentEvents.organizationId, organizationId),
            eq(fiscalDocumentEvents.unitId, unitId),
            eq(fiscalDocumentEvents.documentId, documentId),
          ),
        )
        .orderBy(asc(fiscalDocumentEvents.occurredAt)),
    ]);
    return { ...document, items, events };
  }

  async reconcileDocument(
    identityId: string,
    organizationId: string,
    unitId: string,
    documentId: string,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:documents:read");
    const context = await this.focusDocumentContext(organizationId, unitId, documentId);
    try {
      const result = await this.focus.document(
        context.document.model,
        context.document.providerReference,
        context.profile.environment,
        this.focusToken(
          context.profile.settings,
          context.profile.environment,
          organizationId,
          unitId,
        ),
      );
      return this.persistFocusDocumentResult(identityId, context.document, result, "reconciled");
    } catch (error) {
      rethrowFocus(error);
    }
  }

  async cancelDocument(
    identityId: string,
    organizationId: string,
    unitId: string,
    documentId: string,
    input: CancelFiscalDocumentInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:configuration:write");
    const context = await this.focusDocumentContext(organizationId, unitId, documentId);
    if (context.document.status === "canceled") {
      return {
        replayed: true,
        document: context.document,
        artifacts: { xmlUrl: null, pdfUrl: null },
      };
    }
    if (context.document.status !== "authorized") {
      throw new ConflictException({
        code: "FISCAL_DOCUMENT_NOT_AUTHORIZED",
        message: "Somente um documento autorizado pode ser cancelado.",
      });
    }
    try {
      const result = await this.focus.cancelDocument(
        context.document.model,
        context.document.providerReference,
        input.justification,
        context.profile.environment,
        this.focusToken(
          context.profile.settings,
          context.profile.environment,
          organizationId,
          unitId,
        ),
      );
      const persisted = await this.persistFocusDocumentResult(
        identityId,
        context.document,
        result,
        "cancel_result",
        { justification: input.justification },
      );
      return { ...persisted, replayed: false };
    } catch (error) {
      rethrowFocus(error);
    }
  }

  private async focusDocumentContext(organizationId: string, unitId: string, documentId: string) {
    const [row] = await this.database.db
      .select({ document: fiscalDocuments, profile: fiscalProfiles })
      .from(fiscalDocuments)
      .innerJoin(
        fiscalProfiles,
        and(
          eq(fiscalProfiles.organizationId, fiscalDocuments.organizationId),
          eq(fiscalProfiles.unitId, fiscalDocuments.unitId),
        ),
      )
      .where(
        and(
          eq(fiscalDocuments.organizationId, organizationId),
          eq(fiscalDocuments.unitId, unitId),
          eq(fiscalDocuments.id, documentId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ code: "FISCAL_DOCUMENT_NOT_FOUND" });
    if (row.profile.provider !== "focus" || !row.document.providerReference) {
      throw new ConflictException({
        code: "FOCUS_DOCUMENT_REFERENCE_REQUIRED",
        message: "Este documento ainda não possui uma referência conciliável na Focus NFe.",
      });
    }
    return {
      ...row,
      document: { ...row.document, providerReference: row.document.providerReference },
    };
  }

  private focusToken(
    value: unknown,
    environment: "homologation" | "production",
    organizationId: string,
    unitId: string,
  ) {
    const connection = settingsOf(value).focus;
    const envelope =
      environment === "production" ? connection?.tokenProduction : connection?.tokenHomologation;
    if (!envelope) {
      throw new ServiceUnavailableException({
        code: "FOCUS_COMPANY_TOKEN_MISSING",
        message: `O token de ${environment === "production" ? "produção" : "homologação"} da empresa ainda não foi sincronizado.`,
      });
    }
    const key = encryptionKey(
      process.env.FISCAL_CREDENTIALS_ENCRYPTION_KEY,
      "FISCAL_CREDENTIALS_ENCRYPTION_KEY",
    );
    return decryptSecret(envelope, key, `focus:${organizationId}:${unitId}:${environment}`);
  }

  private async persistFocusDocumentResult(
    identityId: string,
    document: typeof fiscalDocuments.$inferSelect,
    result: FocusDocumentResult,
    action: "reconciled" | "cancel_result",
    auditMetadata: Record<string, unknown> = {},
  ) {
    const now = new Date();
    return this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(fiscalDocuments)
        .set({
          status: result.status,
          accessKey: result.accessKey ?? document.accessKey,
          number: result.number ?? document.number,
          series: result.series ?? document.series,
          taxCents: result.taxCents ?? document.taxCents,
          authorizedAt:
            result.status === "authorized" ? (document.authorizedAt ?? now) : document.authorizedAt,
          canceledAt:
            result.status === "canceled" ? (document.canceledAt ?? now) : document.canceledAt,
          updatedAt: now,
        })
        .where(eq(fiscalDocuments.id, document.id))
        .returning();
      if (!updated) throw new ConflictException({ code: "FISCAL_DOCUMENT_UPDATE_FAILED" });
      const eventFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            status: result.status,
            accessKey: result.accessKey,
            number: result.number,
            series: result.series,
            taxCents: result.taxCents,
          }),
        )
        .digest("hex")
        .slice(0, 32);
      await tx
        .insert(fiscalDocumentEvents)
        .values({
          organizationId: document.organizationId,
          unitId: document.unitId,
          documentId: document.id,
          providerEventId: `focus:${document.id}:${eventFingerprint}`,
          type: `fiscal.document.${action}`,
          status: result.status,
          code: result.code,
          message: result.message,
          payload: {
            accessKey: result.accessKey,
            number: result.number,
            series: result.series,
            taxCents: result.taxCents,
            artifacts: { xmlUrl: result.xmlUrl, pdfUrl: result.pdfUrl },
          },
          occurredAt: now,
        })
        .onConflictDoNothing();
      await tx.insert(auditEvents).values({
        organizationId: document.organizationId,
        unitId: document.unitId,
        actorIdentityId: identityId,
        action: `fiscal.document.${action}`,
        entityType: "fiscal_document",
        entityId: document.id,
        metadata: { status: result.status, ...auditMetadata },
      });
      return {
        document: updated,
        artifacts: { xmlUrl: result.xmlUrl, pdfUrl: result.pdfUrl },
      };
    });
  }

  async periods(identityId: string, organizationId: string, unitId: string) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:periods:read");
    const [unit] = await this.database.db
      .select({ timezone: units.timezone })
      .from(units)
      .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
      .limit(1);
    if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
    const rows = await this.database.db
      .select({
        id: fiscalPeriods.id,
        competence: fiscalPeriods.competence,
        status: fiscalPeriods.status,
        snapshotSha256: fiscalPeriods.snapshotSha256,
        closedByIdentityId: fiscalPeriods.closedByIdentityId,
        closedAt: fiscalPeriods.closedAt,
        reopenedByIdentityId: fiscalPeriods.reopenedByIdentityId,
        reopenedAt: fiscalPeriods.reopenedAt,
        reopenReason: fiscalPeriods.reopenReason,
        createdAt: fiscalPeriods.createdAt,
        updatedAt: fiscalPeriods.updatedAt,
        authorizedCount: sql<number>`(
          select count(*)::int from fiscal_documents d
          where d.organization_id = ${fiscalPeriods.organizationId}
            and d.unit_id = ${fiscalPeriods.unitId}
            and (d.issued_at at time zone ${unit.timezone}) >= ${fiscalPeriods.competence}
            and (d.issued_at at time zone ${unit.timezone}) < (${fiscalPeriods.competence} + interval '1 month')
            and d.status = 'authorized'
        )`,
        canceledCount: sql<number>`(
          select count(*)::int from fiscal_documents d
          where d.organization_id = ${fiscalPeriods.organizationId}
            and d.unit_id = ${fiscalPeriods.unitId}
            and (d.issued_at at time zone ${unit.timezone}) >= ${fiscalPeriods.competence}
            and (d.issued_at at time zone ${unit.timezone}) < (${fiscalPeriods.competence} + interval '1 month')
            and d.status = 'canceled'
        )`,
        grossTotalCents: sql<number>`(
          select coalesce(sum(d.total_cents), 0)::double precision from fiscal_documents d
          where d.organization_id = ${fiscalPeriods.organizationId}
            and d.unit_id = ${fiscalPeriods.unitId}
            and (d.issued_at at time zone ${unit.timezone}) >= ${fiscalPeriods.competence}
            and (d.issued_at at time zone ${unit.timezone}) < (${fiscalPeriods.competence} + interval '1 month')
            and d.status = 'authorized'
        )`,
        blockerCount: sql<number>`(
          select count(*)::int from fiscal_documents d
          where d.organization_id = ${fiscalPeriods.organizationId}
            and d.unit_id = ${fiscalPeriods.unitId}
            and (d.issued_at at time zone ${unit.timezone}) >= ${fiscalPeriods.competence}
            and (d.issued_at at time zone ${unit.timezone}) < (${fiscalPeriods.competence} + interval '1 month')
            and d.status in ('pending', 'processing', 'contingency', 'rejected')
        )`,
        rejectedCount: sql<number>`(
          select count(*)::int from fiscal_documents d
          where d.organization_id = ${fiscalPeriods.organizationId}
            and d.unit_id = ${fiscalPeriods.unitId}
            and (d.issued_at at time zone ${unit.timezone}) >= ${fiscalPeriods.competence}
            and (d.issued_at at time zone ${unit.timezone}) < (${fiscalPeriods.competence} + interval '1 month')
            and d.status = 'rejected'
        )`,
      })
      .from(fiscalPeriods)
      .where(
        and(eq(fiscalPeriods.organizationId, organizationId), eq(fiscalPeriods.unitId, unitId)),
      )
      .orderBy(desc(fiscalPeriods.competence));
    return rows.map(({ blockerCount, rejectedCount, ...period }) => ({
      ...period,
      blockers: { count: Number(blockerCount), rejectedCount: Number(rejectedCount) },
    }));
  }

  async closePeriod(
    identityId: string,
    organizationId: string,
    unitId: string,
    competence: string,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:periods:write");
    const { competenceDate } = competenceBounds(competence);
    return this.database.db.transaction(async (tx) => {
      await tx
        .insert(fiscalPeriods)
        .values({ organizationId, unitId, competence: competenceDate })
        .onConflictDoNothing();
      const [period] = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.organizationId, organizationId),
            eq(fiscalPeriods.unitId, unitId),
            eq(fiscalPeriods.competence, competenceDate),
          ),
        )
        .limit(1);
      if (!period) throw new ConflictException({ code: "FISCAL_PERIOD_CREATE_FAILED" });
      if (period.status === "closed") {
        const [existing] = await tx
          .select()
          .from(accountingExports)
          .where(
            and(eq(accountingExports.periodId, period.id), eq(accountingExports.format, "json")),
          )
          .limit(1);
        return { period, package: existing ?? null, replayed: true };
      }
      const [unit] = await tx
        .select({ timezone: units.timezone })
        .from(units)
        .where(and(eq(units.organizationId, organizationId), eq(units.id, unitId)))
        .limit(1);
      if (!unit) throw new NotFoundException({ code: "UNIT_NOT_FOUND" });
      const documents = await tx
        .select({
          id: fiscalDocuments.id,
          model: fiscalDocuments.model,
          status: fiscalDocuments.status,
          accessKey: fiscalDocuments.accessKey,
          series: fiscalDocuments.series,
          number: fiscalDocuments.number,
          totalCents: fiscalDocuments.totalCents,
          taxCents: fiscalDocuments.taxCents,
          issuedAt: fiscalDocuments.issuedAt,
          xmlSha256: fiscalDocuments.xmlSha256,
        })
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.organizationId, organizationId),
            eq(fiscalDocuments.unitId, unitId),
            sql`(${fiscalDocuments.issuedAt} AT TIME ZONE ${unit.timezone}) >= ${competenceDate}::date`,
            sql`(${fiscalDocuments.issuedAt} AT TIME ZONE ${unit.timezone}) < (${competenceDate}::date + interval '1 month')`,
          ),
        )
        .orderBy(asc(fiscalDocuments.issuedAt), asc(fiscalDocuments.id));
      const unresolved = documents.filter((document) =>
        ["pending", "processing", "contingency", "rejected"].includes(document.status),
      );
      if (unresolved.length > 0) {
        throw new ConflictException({
          code: "FISCAL_PERIOD_HAS_PENDING_DOCUMENTS",
          message: "Resolva os documentos pendentes antes do fechamento.",
          pendingDocumentIds: unresolved.map((document) => document.id),
        });
      }
      const closedAt = new Date();
      const payload = buildAccountingPackage(
        organizationId,
        unitId,
        competence,
        closedAt,
        documents,
      );
      const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const [closedPeriod] = await tx
        .update(fiscalPeriods)
        .set({
          status: "closed",
          snapshotSha256: sha256,
          closedByIdentityId: identityId,
          closedAt,
          updatedAt: closedAt,
        })
        .where(and(eq(fiscalPeriods.id, period.id), ne(fiscalPeriods.status, "closed")))
        .returning();
      if (!closedPeriod) {
        const [currentPeriod] = await tx
          .select()
          .from(fiscalPeriods)
          .where(eq(fiscalPeriods.id, period.id))
          .limit(1);
        const [existingPackage] = await tx
          .select()
          .from(accountingExports)
          .where(
            and(eq(accountingExports.periodId, period.id), eq(accountingExports.format, "json")),
          )
          .limit(1);
        return { period: currentPeriod, package: existingPackage ?? null, replayed: true };
      }
      const [accountingPackage] = await tx
        .insert(accountingExports)
        .values({
          organizationId,
          unitId,
          periodId: period.id,
          format: "json",
          status: "ready",
          payload,
          sha256,
          requestedByIdentityId: identityId,
          generatedAt: closedAt,
        })
        .onConflictDoUpdate({
          target: [accountingExports.periodId, accountingExports.format],
          set: {
            status: "ready",
            payload,
            sha256,
            requestedByIdentityId: identityId,
            generatedAt: closedAt,
            error: null,
            updatedAt: closedAt,
          },
        })
        .returning();
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "fiscal.period.closed",
        entityType: "fiscal_period",
        entityId: period.id,
        metadata: { competence, sha256, documentCount: documents.length },
      });
      await tx.insert(outboxEvents).values({
        topic: "fiscal.period.closed",
        aggregateType: "fiscal_period",
        aggregateId: period.id,
        payload: { organizationId, unitId, competence, sha256 },
      });
      return { period: closedPeriod, package: accountingPackage, replayed: false };
    });
  }

  async reopenPeriod(
    identityId: string,
    organizationId: string,
    unitId: string,
    competence: string,
    input: ReopenFiscalPeriodInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "fiscal:periods:reopen");
    const { competenceDate } = competenceBounds(competence);
    return this.database.db.transaction(async (tx) => {
      const [period] = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.organizationId, organizationId),
            eq(fiscalPeriods.unitId, unitId),
            eq(fiscalPeriods.competence, competenceDate),
          ),
        )
        .limit(1);
      if (!period) {
        throw new NotFoundException({
          code: "FISCAL_PERIOD_NOT_FOUND",
          message: "Período fiscal não encontrado.",
        });
      }
      if (period.status !== "closed") return { period, replayed: true };
      const reopenedAt = new Date();
      const [reopened] = await tx
        .update(fiscalPeriods)
        .set({
          status: "open",
          snapshotSha256: null,
          reopenedByIdentityId: identityId,
          reopenedAt,
          reopenReason: input.reason,
          updatedAt: reopenedAt,
        })
        .where(and(eq(fiscalPeriods.id, period.id), eq(fiscalPeriods.status, "closed")))
        .returning();
      if (!reopened) {
        const [current] = await tx
          .select()
          .from(fiscalPeriods)
          .where(eq(fiscalPeriods.id, period.id))
          .limit(1);
        return { period: current, replayed: true };
      }
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "fiscal.period.reopened",
        entityType: "fiscal_period",
        entityId: period.id,
        metadata: { competence, reason: input.reason },
      });
      await tx.insert(outboxEvents).values({
        topic: "fiscal.period.reopened",
        aggregateType: "fiscal_period",
        aggregateId: period.id,
        payload: { organizationId, unitId, competence },
      });
      return { period: reopened, replayed: false };
    });
  }

  async accountantPackage(
    identityId: string,
    organizationId: string,
    unitId: string,
    competence: string,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "accounting:exports:read");
    const { competenceDate } = competenceBounds(competence);
    const [result] = await this.database.db
      .select({ period: fiscalPeriods, accountingPackage: accountingExports })
      .from(fiscalPeriods)
      .innerJoin(accountingExports, eq(accountingExports.periodId, fiscalPeriods.id))
      .where(
        and(
          eq(fiscalPeriods.organizationId, organizationId),
          eq(fiscalPeriods.unitId, unitId),
          eq(fiscalPeriods.competence, competenceDate),
          eq(fiscalPeriods.status, "closed"),
          eq(accountingExports.format, "json"),
          eq(accountingExports.status, "ready"),
        ),
      )
      .limit(1);
    if (!result) {
      return {
        status: "unavailable" as const,
        competence,
        reason: "period_not_closed" as const,
      };
    }
    return { status: "available" as const, competence, ...result };
  }

  async accountantRequests(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: AccountantRequestListQuery,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "accounting:requests:read");
    const conditions = [
      eq(accountantRequests.organizationId, organizationId),
      eq(accountantRequests.unitId, unitId),
    ];
    if (query.status) conditions.push(eq(accountantRequests.status, query.status));
    if (query.competence) {
      conditions.push(
        eq(accountantRequests.competence, competenceBounds(query.competence).competenceDate),
      );
    }
    return this.database.db
      .select()
      .from(accountantRequests)
      .where(and(...conditions))
      .orderBy(desc(accountantRequests.createdAt));
  }

  async createAccountantRequest(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: AccountantRequestInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "accounting:requests:write");
    const parsedIdempotencyKey = idempotencyKeySchema.parse(idempotencyKey);
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(accountantRequests)
        .where(
          and(
            eq(accountantRequests.organizationId, organizationId),
            eq(accountantRequests.unitId, unitId),
            eq(accountantRequests.idempotencyKey, parsedIdempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return { request: existing, replayed: true };
      const [created] = await tx
        .insert(accountantRequests)
        .values({
          organizationId,
          unitId,
          createdByIdentityId: identityId,
          idempotencyKey: parsedIdempotencyKey,
          competence: competenceBounds(input.competence).competenceDate,
          title: input.title,
          description: input.description,
          dueDate: input.dueDate,
          attachments: input.attachments,
        })
        .returning();
      if (!created) throw new ConflictException({ code: "ACCOUNTANT_REQUEST_CREATE_FAILED" });
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "accounting.request.created",
        entityType: "accountant_request",
        entityId: created.id,
        metadata: { dueDate: created.dueDate },
      });
      await tx.insert(outboxEvents).values({
        topic: "accounting.request.created",
        aggregateType: "accountant_request",
        aggregateId: created.id,
        payload: { organizationId, unitId, requestId: created.id },
      });
      return { request: created, replayed: false };
    });
  }

  async resolveAccountantRequest(
    identityId: string,
    organizationId: string,
    unitId: string,
    requestId: string,
    input: ResolveAccountantRequestInput,
  ) {
    await this.requirePermission(identityId, organizationId, unitId, "accounting:requests:write");
    return this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(accountantRequests)
        .where(
          and(
            eq(accountantRequests.organizationId, organizationId),
            eq(accountantRequests.unitId, unitId),
            eq(accountantRequests.id, requestId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new NotFoundException({
          code: "ACCOUNTANT_REQUEST_NOT_FOUND",
          message: "Solicitação do contador não encontrada.",
        });
      }
      if (existing.status === "resolved") return { request: existing, replayed: true };
      const resolvedAt = new Date();
      const [resolved] = await tx
        .update(accountantRequests)
        .set({
          status: "resolved",
          resolvedByIdentityId: identityId,
          resolvedAt,
          resolution: input.resolution,
          updatedAt: resolvedAt,
        })
        .where(eq(accountantRequests.id, requestId))
        .returning();
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "accounting.request.resolved",
        entityType: "accountant_request",
        entityId: requestId,
      });
      await tx.insert(outboxEvents).values({
        topic: "accounting.request.resolved",
        aggregateType: "accountant_request",
        aggregateId: requestId,
        payload: { organizationId, unitId, requestId },
      });
      return { request: resolved, replayed: false };
    });
  }
}
