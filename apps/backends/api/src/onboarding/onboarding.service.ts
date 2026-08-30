import type { ActivateTrialInput, UpdateOnboardingInput } from "@giromesa/contracts";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  onboardingRecords,
  organizations,
  outboxEvents,
  trials,
} from "@giromesa/db";
import { type ActivationChecklist, missingActivationItems, trialWindow } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

@Injectable()
export class OnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async get(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    const [record] = await this.database.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, organizationId))
      .limit(1);
    if (!record)
      throw new NotFoundException({
        code: "ONBOARDING_NOT_FOUND",
        message: "Onboarding não encontrado.",
      });
    return { ...record, missingItems: missingActivationItems(record.checklist) };
  }

  async update(identityId: string, organizationId: string, input: UpdateOnboardingInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner", "manager"]);
    const [record] = await this.database.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, organizationId))
      .limit(1);
    if (!record) throw new NotFoundException();
    const [organization] = await this.database.db
      .select({ billingState: organizations.billingState })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (record.activatedAt && organization?.billingState !== "trial_active")
      throw new ConflictException({
        code: "ONBOARDING_ALREADY_ACTIVATED",
        message: "O onboarding já foi ativado.",
      });
    const checklist = { ...record.checklist, ...input.checklist };
    const [updated] = await this.database.db
      .update(onboardingRecords)
      .set({ checklist, updatedAt: new Date() })
      .where(eq(onboardingRecords.organizationId, organizationId))
      .returning();
    await this.database.db.insert(auditEvents).values({
      organizationId,
      actorIdentityId: identityId,
      action: "onboarding.updated",
      entityType: "onboarding",
      entityId: organizationId,
      metadata: { changedItems: Object.keys(input.checklist) },
    });
    return { ...updated, missingItems: missingActivationItems(checklist) };
  }

  async activate(identityId: string, organizationId: string, input: ActivateTrialInput) {
    await this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
    const [record] = await this.database.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, organizationId))
      .limit(1);
    if (!record) throw new NotFoundException();
    if (record.activatedAt) {
      const [trial] = await this.database.db
        .select()
        .from(trials)
        .where(eq(trials.organizationId, organizationId))
        .limit(1);
      if (trial) return trial;
    }
    const missingItems = missingActivationItems(record.checklist as Partial<ActivationChecklist>);
    if (missingItems.length > 0)
      throw new BadRequestException({
        code: "ONBOARDING_INCOMPLETE",
        message: "Finalize o checklist antes de ativar o teste.",
        details: { missingItems },
      });

    const [organization] = await this.database.db
      .select({ state: organizations.billingState })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();
    if (organization.state !== "onboarding")
      throw new ConflictException({
        code: "INVALID_ACTIVATION_STATE",
        message: "A organização não pode ser ativada neste estado.",
      });

    const [plan] = await this.database.db
      .select({ id: commercialPlans.id })
      .from(commercialPlans)
      .innerJoin(
        commercialCatalogVersions,
        eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
      )
      .where(
        and(
          eq(commercialPlans.slug, input.planSlug),
          eq(commercialCatalogVersions.status, "published"),
        ),
      )
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    if (!plan)
      throw new BadRequestException({
        code: "PLAN_NOT_AVAILABLE",
        message: "Plano selecionado indisponível.",
      });

    const now = new Date();
    const window = trialWindow(now);
    return this.database.db.transaction(async (tx) => {
      const [trial] = await tx
        .insert(trials)
        .values({
          organizationId,
          commercialPlanId: plan.id,
          ...window,
          activatedByIdentityId: identityId,
        })
        .returning();
      if (!trial) throw new Error("Trial was not created");
      await tx
        .update(onboardingRecords)
        .set({ activatedAt: now, activatedByIdentityId: identityId, updatedAt: now })
        .where(eq(onboardingRecords.organizationId, organizationId));
      await tx
        .update(organizations)
        .set({ billingState: "trial_active", billingStateChangedAt: now, updatedAt: now })
        .where(
          and(eq(organizations.id, organizationId), eq(organizations.billingState, "onboarding")),
        );
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "trial.activated",
        entityType: "trial",
        entityId: trial.id,
        metadata: { planSlug: input.planSlug, endsAt: window.endsAt.toISOString() },
      });
      await tx.insert(outboxEvents).values({
        topic: "trial.activated",
        aggregateType: "trial",
        aggregateId: trial.id,
        payload: { organizationId, trialId: trial.id, endsAt: window.endsAt.toISOString() },
      });
      return trial;
    });
  }
}
