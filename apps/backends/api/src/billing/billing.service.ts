import type {
  BillingCheckout,
  BillingCheckoutInput,
  BillingEventInput,
  BillingUpgradeQuoteInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  billingCheckouts,
  billingUpgradeQuotes,
  charges,
  commercialCatalogVersions,
  commercialPlans,
  commercialPromotions,
  identities,
  onboardingRecords,
  organizations,
  outboxEvents,
  paymentEvents,
  subscriptions,
  trials,
} from "@giromesa/db";
import {
  type BillingState,
  billingAccess,
  missingActivationItems,
  OPERATIONAL_CLOSURE_HOURS,
  transitionBilling,
} from "@giromesa/domain";
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, gt, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { resolveCommercialPromotion } from "../catalog/commercial.rules.js";
import { activateDueCommercialCatalog } from "../catalog/commercial-publication.js";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import {
  checkoutExpiresAt,
  cyclePriceCents,
  isHttpsUrl,
  proratedUpgrade,
  sameCheckoutRequest,
} from "./billing.rules.js";
import type { AsaasWebhookInput } from "./billing.schemas.js";

const PAID_CHARGE_STATUSES = new Set(["CONFIRMED", "PAID", "RECEIVED", "RECEIVED_IN_CASH"]);
type Cycle = "monthly" | "annual";

interface CheckoutResponse {
  id: string;
  status: BillingCheckout["status"];
  url: string;
  expiresAt: string;
  amountCents: number;
}

interface CheckoutReservation {
  response?: CheckoutResponse;
  checkoutId?: string;
  quoteId?: string;
  intent: BillingCheckoutInput["intent"];
  cycle: Cycle | null;
  amountCents: number;
  expiresAt: Date;
  itemName: string;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async access(identityId: string, organizationId: string) {
    await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
      "waiter",
      "cashier",
      "kds",
      "inventory",
      "finance",
    ]);
    const [organization] = await this.database.db
      .select({
        state: organizations.billingState,
        operationalClosureUntil: organizations.operationalClosureUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();
    return {
      state: organization.state,
      access: billingAccess(organization.state, new Date(), organization.operationalClosureUntil),
    };
  }

  async summary(identityId: string, organizationId: string) {
    await this.requireOwner(identityId, organizationId);
    const [organization] = await this.database.db
      .select({
        state: organizations.billingState,
        operationalClosureUntil: organizations.operationalClosureUntil,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) throw new NotFoundException();

    const [onboarding] =
      organization.state === "onboarding"
        ? await this.database.db
            .select({ checklist: onboardingRecords.checklist })
            .from(onboardingRecords)
            .where(eq(onboardingRecords.organizationId, organizationId))
            .limit(1)
        : [];

    const [subscription] = await this.database.db
      .select({
        id: subscriptions.id,
        state: subscriptions.state,
        cycle: subscriptions.cycle,
        paymentMethod: subscriptions.paymentMethod,
        contractedPriceCents: subscriptions.contractedPriceCents,
        currentPeriodStartsAt: subscriptions.currentPeriodStartsAt,
        currentPeriodEndsAt: subscriptions.currentPeriodEndsAt,
        createdAt: subscriptions.createdAt,
        planId: commercialPlans.id,
        planSlug: commercialPlans.slug,
        planName: commercialPlans.name,
        monthlyPriceCents: commercialPlans.monthlyPriceCents,
        annualPriceCents: commercialPlans.annualPriceCents,
        includedUnits: commercialPlans.includedUnits,
        entitlements: commercialPlans.entitlements,
      })
      .from(subscriptions)
      .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
      .where(
        and(eq(subscriptions.organizationId, organizationId), ne(subscriptions.state, "canceled")),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    const [trial] = subscription
      ? []
      : await this.database.db
          .select({
            startsAt: trials.startsAt,
            endsAt: trials.endsAt,
            planId: commercialPlans.id,
            planSlug: commercialPlans.slug,
            planName: commercialPlans.name,
            includedUnits: commercialPlans.includedUnits,
            entitlements: commercialPlans.entitlements,
          })
          .from(trials)
          .innerJoin(commercialPlans, eq(commercialPlans.id, trials.commercialPlanId))
          .where(eq(trials.organizationId, organizationId))
          .limit(1);
    const [catalog] = await this.database.db
      .select({ id: commercialCatalogVersions.id })
      .from(commercialCatalogVersions)
      .where(eq(commercialCatalogVersions.status, "published"))
      .orderBy(desc(commercialCatalogVersions.version))
      .limit(1);
    const plans = catalog
      ? await this.database.db
          .select({
            id: commercialPlans.id,
            slug: commercialPlans.slug,
            name: commercialPlans.name,
            monthlyPriceCents: commercialPlans.monthlyPriceCents,
            annualPriceCents: commercialPlans.annualPriceCents,
            includedUnits: commercialPlans.includedUnits,
            entitlements: commercialPlans.entitlements,
          })
          .from(commercialPlans)
          .where(eq(commercialPlans.catalogVersionId, catalog.id))
          .orderBy(commercialPlans.monthlyPriceCents)
      : [];
    const recentCharges = subscription
      ? await this.database.db
          .select({
            id: charges.id,
            amountCents: charges.amountCents,
            status: charges.status,
            dueAt: charges.dueAt,
            paidAt: charges.paidAt,
            paymentUrl: charges.paymentUrl,
          })
          .from(charges)
          .where(eq(charges.subscriptionId, subscription.id))
          .orderBy(desc(charges.dueAt))
          .limit(12)
      : [];

    const now = new Date();
    const onlinePaymentsEnabled = this.onlinePaymentsEnabled();
    const currentPriceCents = subscription
      ? (subscription.contractedPriceCents ??
        cyclePriceCents(
          subscription.monthlyPriceCents,
          subscription.annualPriceCents,
          subscription.cycle,
        ))
      : null;
    const periodValid = Boolean(
      subscription?.currentPeriodStartsAt &&
        subscription.currentPeriodEndsAt &&
        subscription.currentPeriodStartsAt <= now &&
        subscription.currentPeriodEndsAt > now,
    );
    const hasUpgrade = plans.some(
      (plan) =>
        subscription &&
        (subscription.cycle === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents) >
          (currentPriceCents ?? Number.MAX_SAFE_INTEGER),
    );
    const canSubscribe =
      onlinePaymentsEnabled &&
      !subscription &&
      ["trial_active", "canceled"].includes(organization.state);
    const canRegularize =
      onlinePaymentsEnabled &&
      recentCharges.some(
        (charge) =>
          !PAID_CHARGE_STATUSES.has(charge.status.toUpperCase()) && Boolean(charge.paymentUrl),
      );
    const canUpgrade =
      onlinePaymentsEnabled &&
      organization.state === "active" &&
      subscription?.state === "active" &&
      periodValid &&
      hasUpgrade;
    const current = subscription
      ? {
          source: "subscription" as const,
          plan: {
            id: subscription.planId,
            slug: subscription.planSlug,
            name: subscription.planName,
            includedUnits: subscription.includedUnits,
            entitlements: subscription.entitlements,
          },
          cycle: subscription.cycle,
          priceCents: currentPriceCents,
          periodStartsAt: (
            subscription.currentPeriodStartsAt ?? subscription.createdAt
          ).toISOString(),
          periodEndsAt: (
            subscription.currentPeriodEndsAt ??
            subscription.currentPeriodStartsAt ??
            subscription.createdAt
          ).toISOString(),
          renewsAutomatically: subscription.state === "active",
          paymentMethod: subscription.paymentMethod,
        }
      : trial
        ? {
            source: "trial" as const,
            plan: {
              id: trial.planId,
              slug: trial.planSlug,
              name: trial.planName,
              includedUnits: trial.includedUnits,
              entitlements: trial.entitlements,
            },
            cycle: null,
            priceCents: null,
            periodStartsAt: trial.startsAt.toISOString(),
            periodEndsAt: trial.endsAt.toISOString(),
            renewsAutomatically: false,
            paymentMethod: null,
          }
        : null;

    return {
      state: organization.state,
      access: billingAccess(organization.state, now, organization.operationalClosureUntil),
      onboarding:
        organization.state === "onboarding"
          ? { missingItems: missingActivationItems(onboarding?.checklist ?? {}) }
          : null,
      current,
      charges: recentCharges.map((charge) => ({
        ...charge,
        dueAt: charge.dueAt.toISOString(),
        paidAt: charge.paidAt?.toISOString() ?? null,
      })),
      plans: plans.map((plan) => ({
        ...plan,
        current: current?.plan.slug === plan.slug,
        upgradeEligible:
          Boolean(subscription && periodValid && subscription.state === "active") &&
          (subscription?.cycle === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents) >
            (currentPriceCents ?? Number.MAX_SAFE_INTEGER),
      })),
      actions: {
        onlinePaymentsEnabled,
        canSubscribe,
        canRegularize,
        canUpgrade,
        unavailableReason: this.unavailableReason({
          onlinePaymentsEnabled,
          canSubscribe,
          canRegularize,
          canUpgrade,
          subscription: Boolean(subscription),
          periodValid,
          hasUpgrade,
        }),
      },
    };
  }

  async createUpgradeQuote(
    identityId: string,
    organizationId: string,
    idempotencyKey: string,
    input: BillingUpgradeQuoteInput,
  ) {
    await this.requireOwner(identityId, organizationId);
    const now = new Date();
    return this.database.db.transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      await activateDueCommercialCatalog(tx, now);
      const [subscription] = await tx
        .select({
          id: subscriptions.id,
          state: subscriptions.state,
          cycle: subscriptions.cycle,
          currentPeriodStartsAt: subscriptions.currentPeriodStartsAt,
          currentPeriodEndsAt: subscriptions.currentPeriodEndsAt,
          contractedPriceCents: subscriptions.contractedPriceCents,
          sourcePlanId: commercialPlans.id,
          sourcePlanSlug: commercialPlans.slug,
          sourceMonthlyPriceCents: commercialPlans.monthlyPriceCents,
          sourceAnnualPriceCents: commercialPlans.annualPriceCents,
        })
        .from(subscriptions)
        .innerJoin(commercialPlans, eq(commercialPlans.id, subscriptions.commercialPlanId))
        .where(
          and(
            eq(subscriptions.organizationId, organizationId),
            ne(subscriptions.state, "canceled"),
          ),
        )
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);
      if (
        subscription?.state !== "active" ||
        !subscription.currentPeriodStartsAt ||
        !subscription.currentPeriodEndsAt
      ) {
        throw new ConflictException({
          code: "BILLING_UPGRADE_UNAVAILABLE",
          message: "A assinatura atual não permite upgrade.",
        });
      }
      const [target] = await tx
        .select({
          id: commercialPlans.id,
          slug: commercialPlans.slug,
          monthlyPriceCents: commercialPlans.monthlyPriceCents,
          annualPriceCents: commercialPlans.annualPriceCents,
        })
        .from(commercialPlans)
        .innerJoin(
          commercialCatalogVersions,
          eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
        )
        .where(
          and(
            eq(commercialCatalogVersions.status, "published"),
            eq(commercialPlans.slug, input.targetPlanSlug),
          ),
        )
        .orderBy(desc(commercialCatalogVersions.version))
        .limit(1);
      if (!target) {
        throw new NotFoundException({
          code: "COMMERCIAL_PLAN_NOT_FOUND",
          message: "Plano comercial publicado não encontrado.",
        });
      }
      const sourcePriceCents =
        subscription.contractedPriceCents ??
        cyclePriceCents(
          subscription.sourceMonthlyPriceCents,
          subscription.sourceAnnualPriceCents,
          subscription.cycle,
        );
      const targetPriceCents = cyclePriceCents(
        target.monthlyPriceCents,
        target.annualPriceCents,
        subscription.cycle,
      );
      const [existing] = await tx
        .select()
        .from(billingUpgradeQuotes)
        .where(
          and(
            eq(billingUpgradeQuotes.organizationId, organizationId),
            eq(billingUpgradeQuotes.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.targetCommercialPlanId !== target.id) {
          throw this.idempotencyConflict();
        }
        return {
          id: existing.id,
          sourcePlanSlug: subscription.sourcePlanSlug,
          targetPlanSlug: target.slug,
          cycle: existing.cycle,
          periodEndsAt: existing.periodEndsAt.toISOString(),
          amountCents: existing.amountCents,
          remainingRatio: Math.min(1, existing.amountCents / (targetPriceCents - sourcePriceCents)),
          expiresAt: existing.expiresAt.toISOString(),
          status:
            existing.expiresAt <= now
              ? "expired"
              : existing.status === "quoted"
                ? "quoted"
                : existing.status === "canceled"
                  ? "canceled"
                  : "consumed",
        };
      }
      const calculation = proratedUpgrade(
        sourcePriceCents,
        targetPriceCents,
        subscription.currentPeriodStartsAt,
        subscription.currentPeriodEndsAt,
        now,
      );
      const expiresAt = checkoutExpiresAt(now);
      const [quote] = await tx
        .insert(billingUpgradeQuotes)
        .values({
          organizationId,
          subscriptionId: subscription.id,
          targetCommercialPlanId: target.id,
          cycle: subscription.cycle,
          amountCents: calculation.amountCents,
          periodStartsAt: subscription.currentPeriodStartsAt,
          periodEndsAt: subscription.currentPeriodEndsAt,
          idempotencyKey,
          expiresAt,
          status: "quoted",
        })
        .returning({ id: billingUpgradeQuotes.id });
      if (!quote) throw new Error("Billing quote was not created");
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: "billing.upgrade_quoted",
        entityType: "billing_upgrade_quote",
        entityId: quote.id,
        metadata: {
          sourcePlanId: subscription.sourcePlanId,
          targetPlanId: target.id,
          cycle: subscription.cycle,
          amountCents: calculation.amountCents,
          expiresAt: expiresAt.toISOString(),
        },
      });
      return {
        id: quote.id,
        sourcePlanSlug: subscription.sourcePlanSlug,
        targetPlanSlug: target.slug,
        cycle: subscription.cycle,
        periodEndsAt: subscription.currentPeriodEndsAt.toISOString(),
        amountCents: calculation.amountCents,
        remainingRatio: calculation.remainingRatio,
        expiresAt: expiresAt.toISOString(),
        status: "quoted",
      };
    });
  }

  async createCheckout(
    identityId: string,
    organizationId: string,
    idempotencyKey: string,
    input: BillingCheckoutInput,
  ): Promise<CheckoutResponse> {
    await this.requireOwner(identityId, organizationId);
    const config = this.asaasConfiguration();
    const now = new Date();
    const reservation = await this.database.db.transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const [preexisting] = await tx
        .select()
        .from(billingCheckouts)
        .where(
          and(
            eq(billingCheckouts.organizationId, organizationId),
            eq(billingCheckouts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      let normalized: {
        subscriptionId: string | null;
        targetPlanId: string | null;
        cycle: Cycle | null;
        amountCents: number;
        itemName: string;
        upgradeQuoteId?: string;
        upgradeQuoteUsable?: boolean;
        payment?: { id: string; url: string };
        promotionId?: string | null;
        promotionCode?: string | null;
        promotionDiscountCents?: number;
        promotionFingerprint?: string | null;
      };
      if (input.intent === "subscribe") {
        const [organization] = await tx
          .select({ state: organizations.billingState })
          .from(organizations)
          .where(eq(organizations.id, organizationId))
          .limit(1);
        const [currentSubscription] = await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, organizationId),
              ne(subscriptions.state, "canceled"),
            ),
          )
          .limit(1);
        const [historicalSubscription] = await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.organizationId, organizationId))
          .limit(1);
        if (
          !organization ||
          (!preexisting &&
            (currentSubscription || !["trial_active", "canceled"].includes(organization.state)))
        ) {
          throw new ConflictException({
            code: "BILLING_SUBSCRIBE_UNAVAILABLE",
            message: "A conta atual não permite uma nova assinatura.",
          });
        }
        const [plan] = await tx
          .select({
            id: commercialPlans.id,
            slug: commercialPlans.slug,
            catalogVersionId: commercialPlans.catalogVersionId,
            name: commercialPlans.name,
            monthlyPriceCents: commercialPlans.monthlyPriceCents,
            annualPriceCents: commercialPlans.annualPriceCents,
          })
          .from(commercialPlans)
          .innerJoin(
            commercialCatalogVersions,
            eq(commercialCatalogVersions.id, commercialPlans.catalogVersionId),
          )
          .where(
            and(
              eq(commercialCatalogVersions.status, "published"),
              eq(commercialPlans.slug, input.planSlug),
            ),
          )
          .orderBy(desc(commercialCatalogVersions.version))
          .limit(1);
        if (!plan) throw new NotFoundException({ code: "COMMERCIAL_PLAN_NOT_FOUND" });
        const basePriceCents = cyclePriceCents(
          plan.monthlyPriceCents,
          plan.annualPriceCents,
          input.cycle,
        );
        const promotionRows = await tx
          .select()
          .from(commercialPromotions)
          .where(
            and(
              eq(commercialPromotions.catalogVersionId, plan.catalogVersionId),
              eq(commercialPromotions.active, true),
            ),
          )
          .for("update");
        let candidates = promotionRows;
        let promotion = resolveCommercialPromotion(candidates, {
          planSlug: plan.slug,
          cycle: input.cycle,
          basePriceCents,
          code: input.promotionCode,
          newCustomer: !historicalSubscription,
          now,
        });
        while (promotion?.redemptionLimit) {
          const [redemptions] = await tx
            .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
            .from(billingCheckouts)
            .where(
              and(
                eq(billingCheckouts.promotionId, promotion.id),
                preexisting ? ne(billingCheckouts.id, preexisting.id) : undefined,
                notInArray(billingCheckouts.status, ["failed", "canceled", "expired"]),
                or(
                  isNotNull(billingCheckouts.confirmedAt),
                  isNull(billingCheckouts.expiresAt),
                  gt(billingCheckouts.expiresAt, now),
                ),
              ),
            );
          if ((redemptions?.count ?? 0) < promotion.redemptionLimit) break;
          candidates = candidates.filter((candidate) => candidate.id !== promotion?.id);
          promotion = resolveCommercialPromotion(candidates, {
            planSlug: plan.slug,
            cycle: input.cycle,
            basePriceCents,
            code: input.promotionCode,
            newCustomer: !historicalSubscription,
            now,
          });
        }
        if (input.promotionCode && !promotion)
          throw new BadRequestException({ code: "COMMERCIAL_PROMOTION_INVALID_OR_EXHAUSTED" });
        normalized = {
          subscriptionId: null,
          targetPlanId: plan.id,
          cycle: input.cycle,
          amountCents: promotion?.finalPriceCents ?? basePriceCents,
          itemName: `Assinatura ${plan.name}`,
          promotionId: promotion?.id ?? null,
          promotionCode: promotion?.code ?? null,
          promotionDiscountCents: promotion?.discountCents ?? 0,
          promotionFingerprint: promotion?.fingerprint ?? null,
        };
      } else if (input.intent === "regularize") {
        const [charge] = await tx
          .select({
            providerChargeId: charges.providerChargeId,
            amountCents: charges.amountCents,
            status: charges.status,
            paymentUrl: charges.paymentUrl,
            subscriptionId: subscriptions.id,
            planId: subscriptions.commercialPlanId,
            cycle: subscriptions.cycle,
          })
          .from(charges)
          .innerJoin(subscriptions, eq(subscriptions.id, charges.subscriptionId))
          .where(
            and(eq(charges.id, input.chargeId), eq(subscriptions.organizationId, organizationId)),
          )
          .limit(1);
        if (
          !charge?.paymentUrl ||
          !isHttpsUrl(charge.paymentUrl) ||
          (!preexisting && PAID_CHARGE_STATUSES.has(charge.status.toUpperCase()))
        ) {
          throw new ConflictException({
            code: "BILLING_REGULARIZATION_UNAVAILABLE",
            message: "A cobrança não possui pagamento pendente disponível.",
          });
        }
        normalized = {
          subscriptionId: charge.subscriptionId,
          targetPlanId: charge.planId,
          cycle: charge.cycle,
          amountCents: charge.amountCents,
          itemName: "Regularização da assinatura GiroMesa",
          payment: charge.paymentUrl
            ? { id: `payment:${charge.providerChargeId}`, url: charge.paymentUrl }
            : undefined,
        };
      } else {
        const [quote] = await tx
          .select({
            id: billingUpgradeQuotes.id,
            status: billingUpgradeQuotes.status,
            subscriptionId: billingUpgradeQuotes.subscriptionId,
            targetPlanId: billingUpgradeQuotes.targetCommercialPlanId,
            cycle: billingUpgradeQuotes.cycle,
            amountCents: billingUpgradeQuotes.amountCents,
            expiresAt: billingUpgradeQuotes.expiresAt,
            targetPlanName: commercialPlans.name,
          })
          .from(billingUpgradeQuotes)
          .innerJoin(
            commercialPlans,
            eq(commercialPlans.id, billingUpgradeQuotes.targetCommercialPlanId),
          )
          .where(
            and(
              eq(billingUpgradeQuotes.id, input.quoteId),
              eq(billingUpgradeQuotes.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!quote || (!preexisting && (quote.status !== "quoted" || quote.expiresAt <= now))) {
          throw new ConflictException({
            code: "BILLING_QUOTE_UNAVAILABLE",
            message: "A cotação expirou ou já foi utilizada.",
          });
        }
        normalized = {
          subscriptionId: quote.subscriptionId,
          targetPlanId: quote.targetPlanId,
          cycle: quote.cycle,
          amountCents: quote.amountCents,
          itemName: `Upgrade para ${quote.targetPlanName}`,
          upgradeQuoteId: quote.id,
          upgradeQuoteUsable: quote.status === "quoted" && quote.expiresAt > now,
        };
      }
      if (preexisting) {
        if (
          preexisting.promotionId !== (normalized.promotionId ?? null) ||
          preexisting.promotionCode !== (normalized.promotionCode ?? null) ||
          preexisting.promotionDiscountCents !== (normalized.promotionDiscountCents ?? 0) ||
          preexisting.promotionFingerprint !== (normalized.promotionFingerprint ?? null) ||
          !sameCheckoutRequest(
            {
              intent: preexisting.intent,
              targetPlanId: preexisting.targetCommercialPlanId,
              amountCents: preexisting.amountCents,
              cycle: preexisting.cycle,
              upgradeQuoteId: preexisting.upgradeQuoteId,
              providerReference: preexisting.providerCheckoutId,
            },
            {
              intent: input.intent,
              targetPlanId: normalized.targetPlanId,
              amountCents: normalized.amountCents,
              cycle: normalized.cycle,
              upgradeQuoteId: normalized.upgradeQuoteId ?? null,
              providerReference: normalized.payment?.id,
            },
          )
        ) {
          throw this.idempotencyConflict();
        }
        if (
          preexisting.providerCheckoutUrl &&
          preexisting.expiresAt &&
          preexisting.amountCents !== null
        ) {
          return {
            intent: input.intent,
            cycle: preexisting.cycle,
            amountCents: preexisting.amountCents,
            expiresAt: preexisting.expiresAt,
            itemName: normalized.itemName,
            response: {
              id: preexisting.id,
              status: this.publicCheckoutStatus(preexisting.status),
              url: preexisting.providerCheckoutUrl,
              expiresAt: preexisting.expiresAt.toISOString(),
              amountCents: preexisting.amountCents,
            },
          } satisfies CheckoutReservation;
        }
        throw new ConflictException({
          code: "BILLING_CHECKOUT_IN_PROGRESS",
          message: "O checkout desta requisição está em processamento ou reconciliação.",
        });
      }
      if (input.intent === "upgrade" && !normalized.upgradeQuoteUsable) {
        throw new ConflictException({
          code: "BILLING_QUOTE_UNAVAILABLE",
          message: "A cotação expirou ou já foi utilizada.",
        });
      }
      const expiresAt = new Date(now.getTime() + 60 * 60_000);
      const [checkout] = await tx
        .insert(billingCheckouts)
        .values({
          organizationId,
          subscriptionId: normalized.subscriptionId,
          provider: "asaas",
          intent: input.intent,
          targetCommercialPlanId: normalized.targetPlanId,
          upgradeQuoteId: normalized.upgradeQuoteId,
          cycle: normalized.cycle,
          amountCents: normalized.amountCents,
          promotionId: normalized.promotionId,
          promotionCode: normalized.promotionCode,
          promotionDiscountCents: normalized.promotionDiscountCents ?? 0,
          promotionFingerprint: normalized.promotionFingerprint,
          idempotencyKey,
          expiresAt,
          providerCheckoutId: normalized.payment?.id,
          providerCheckoutUrl: normalized.payment?.url,
          status: normalized.payment ? "created" : "provider_pending",
        })
        .returning({ id: billingCheckouts.id });
      if (!checkout) throw new Error("Billing checkout was not reserved");
      if (normalized.upgradeQuoteId) {
        await tx
          .update(billingUpgradeQuotes)
          .set({ status: "consumed" })
          .where(eq(billingUpgradeQuotes.id, normalized.upgradeQuoteId));
      }
      await tx.insert(auditEvents).values({
        organizationId,
        actorIdentityId: identityId,
        action: `billing.${input.intent}_checkout_requested`,
        entityType: "billing_checkout",
        entityId: checkout.id,
        metadata: {
          amountCents: normalized.amountCents,
          cycle: normalized.cycle,
          promotionId: normalized.promotionId ?? null,
          promotionDiscountCents: normalized.promotionDiscountCents ?? 0,
          promotionFingerprint: normalized.promotionFingerprint ?? null,
        },
      });
      const response: CheckoutResponse | undefined = normalized.payment
        ? {
            id: checkout.id,
            status: "created",
            url: normalized.payment.url,
            expiresAt: expiresAt.toISOString(),
            amountCents: normalized.amountCents,
          }
        : undefined;
      return {
        intent: input.intent,
        cycle: normalized.cycle,
        amountCents: normalized.amountCents,
        expiresAt,
        itemName: normalized.itemName,
        checkoutId: checkout.id,
        quoteId: normalized.upgradeQuoteId,
        response,
      } satisfies CheckoutReservation;
    });

    if (reservation.response) return reservation.response;
    if (!reservation.checkoutId) throw new Error("Billing checkout reservation is invalid");
    try {
      const provider = await this.createAsaasCheckout(config, {
        checkoutId: reservation.checkoutId,
        intent: reservation.intent,
        cycle: reservation.cycle,
        amountCents: reservation.amountCents,
        itemName: reservation.itemName,
        identityId,
        organizationId,
      });
      await this.database.db.transaction(async (tx) => {
        await this.lockOrganization(tx, organizationId);
        await tx
          .update(billingCheckouts)
          .set({
            providerCheckoutId: provider.id,
            providerCheckoutUrl: provider.link,
            status: sql`case when ${billingCheckouts.status} = 'provider_pending' then 'created' else ${billingCheckouts.status} end`,
          })
          .where(eq(billingCheckouts.id, reservation.checkoutId));
        await tx.insert(auditEvents).values({
          organizationId,
          actorIdentityId: identityId,
          action: "billing.checkout_created",
          entityType: "billing_checkout",
          entityId: reservation.checkoutId,
          metadata: { provider: "asaas", providerCheckoutId: provider.id },
        });
      });
      return {
        id: reservation.checkoutId,
        status: "created",
        url: provider.link,
        expiresAt: reservation.expiresAt.toISOString(),
        amountCents: reservation.amountCents,
      };
    } catch (error) {
      await this.database.db.transaction(async (tx) => {
        await this.lockOrganization(tx, organizationId);
        await tx
          .update(billingCheckouts)
          .set({
            status: sql`case when ${billingCheckouts.status} = 'provider_pending' then 'reconciliation_required' else ${billingCheckouts.status} end`,
            reconciliationStatus: "pending",
            reconciliationError: "ASAAS_CHECKOUT_RESULT_UNKNOWN",
            updatedAt: new Date(),
          })
          .where(eq(billingCheckouts.id, reservation.checkoutId));
        await tx.insert(outboxEvents).values({
          topic: "billing.checkout_reconciliation_requested",
          aggregateType: "billing_checkout",
          aggregateId: reservation.checkoutId,
          payload: { organizationId, checkoutId: reservation.checkoutId, provider: "asaas" },
        });
      });
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException({
        code: "ASAAS_CHECKOUT_FAILED",
        message: "Não foi possível confirmar a criação do checkout; a conciliação foi agendada.",
      });
    }
  }

  async receiveAsaasWebhook(input: AsaasWebhookInput) {
    return this.database.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(paymentEvents)
        .values({
          provider: "asaas",
          providerEventId: input.id,
          eventType: input.event,
          payload: input,
        })
        .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.providerEventId] })
        .returning({ id: paymentEvents.id });
      if (!event) return { received: true, duplicate: true };
      await tx.insert(outboxEvents).values({
        topic: "billing.payment_event_received",
        aggregateType: "payment_event",
        aggregateId: event.id,
        payload: { paymentEventId: event.id, provider: "asaas" },
      });
      return { received: true, duplicate: false };
    });
  }

  async applyEvent(organizationId: string, input: BillingEventInput) {
    return this.database.db.transaction(async (tx) => {
      await this.lockOrganization(tx, organizationId);
      const [organization] = await tx
        .select({ state: organizations.billingState })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (!organization) throw new NotFoundException();
      let next: BillingState;
      try {
        next = transitionBilling(organization.state as BillingState, input.event);
      } catch {
        throw new ConflictException({
          code: "INVALID_BILLING_TRANSITION",
          message: "Transição de cobrança inválida para o estado atual.",
        });
      }
      const now = new Date();
      const operationalClosureUntil =
        next === "restricted"
          ? new Date(now.getTime() + OPERATIONAL_CLOSURE_HOURS * 60 * 60 * 1000)
          : next === "active"
            ? null
            : undefined;
      const [updated] = await tx
        .update(organizations)
        .set({
          billingState: next,
          billingStateChangedAt: now,
          operationalClosureUntil,
          updatedAt: now,
        })
        .where(eq(organizations.id, organizationId))
        .returning({
          state: organizations.billingState,
          operationalClosureUntil: organizations.operationalClosureUntil,
        });
      await tx.insert(auditEvents).values({
        organizationId,
        action: `billing.${input.event.toLowerCase()}`,
        entityType: "organization",
        entityId: organizationId,
        metadata: { from: organization.state, to: next },
      });
      await tx.insert(outboxEvents).values({
        topic: "billing.state_changed",
        aggregateType: "organization",
        aggregateId: organizationId,
        payload: { organizationId, from: organization.state, to: next, event: input.event },
      });
      return updated;
    });
  }

  private requireOwner(identityId: string, organizationId: string) {
    return this.scope.requireOrganizationRole(identityId, organizationId, ["owner"]);
  }

  private lockOrganization(
    tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> },
    organizationId: string,
  ) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`billing:${organizationId}`}::text, 0))`,
    );
  }

  private onlinePaymentsEnabled() {
    try {
      this.asaasConfiguration();
      return true;
    } catch {
      return false;
    }
  }

  private asaasConfiguration() {
    const apiKey = process.env.ASAAS_API_KEY;
    const opsUrl = process.env.OPS_APP_URL;
    if (
      !apiKey ||
      !process.env.ASAAS_WEBHOOK_SECRET ||
      process.env.ASAAS_WEBHOOK_SECRET === apiKey ||
      !opsUrl
    ) {
      throw new ServiceUnavailableException({
        code: "ASAAS_DISABLED",
        message: "Pagamento online ainda não está habilitado.",
      });
    }
    let api: URL;
    let ops: URL;
    try {
      api = new URL(process.env.ASAAS_API_URL ?? "https://api-sandbox.asaas.com/v3");
      ops = new URL(opsUrl);
    } catch {
      throw new ServiceUnavailableException({
        code: "ASAAS_CONFIGURATION_INVALID",
        message: "As URLs da integração de pagamento são inválidas.",
      });
    }
    if (
      process.env.NODE_ENV === "production" &&
      (api.protocol !== "https:" || ops.protocol !== "https:")
    ) {
      throw new ServiceUnavailableException({
        code: "ASAAS_HTTPS_REQUIRED",
        message: "A integração de pagamento exige HTTPS em produção.",
      });
    }
    return {
      apiKey,
      apiUrl: api.toString().replace(/\/$/, ""),
      opsUrl: ops.toString(),
    };
  }

  private async createAsaasCheckout(
    config: { apiKey: string; apiUrl: string; opsUrl: string },
    input: {
      checkoutId: string;
      intent: BillingCheckoutInput["intent"];
      cycle: Cycle | null;
      amountCents: number;
      itemName: string;
      identityId: string;
      organizationId: string;
    },
  ) {
    const [customer] = await this.database.db
      .select({
        name: identities.displayName,
        email: identities.email,
        cpfCnpj: organizations.document,
      })
      .from(identities)
      .innerJoin(organizations, eq(organizations.id, input.organizationId))
      .where(eq(identities.id, input.identityId))
      .limit(1);
    if (!customer) throw new NotFoundException();
    const callback = (result: string) => {
      const url = new URL("/billing", config.opsUrl);
      url.searchParams.set("checkout", result);
      return url.toString();
    };
    const recurrent = input.intent === "subscribe";
    const response = await fetch(`${config.apiUrl}/checkouts`, {
      method: "POST",
      headers: {
        accept: "application/json",
        access_token: config.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD", "PIX"],
        chargeTypes: [recurrent ? "RECURRENT" : "DETACHED"],
        minutesToExpire: 60,
        externalReference: input.checkoutId,
        callback: {
          successUrl: callback("success"),
          cancelUrl: callback("canceled"),
          expiredUrl: callback("expired"),
        },
        items: [
          {
            name: input.itemName,
            description: "Plano GiroMesa",
            quantity: 1,
            value: input.amountCents / 100,
          },
        ],
        customerData: customer,
        ...(recurrent
          ? {
              subscription: {
                cycle: input.cycle === "annual" ? "YEARLY" : "MONTHLY",
                nextDueDate: new Date().toISOString().slice(0, 10),
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new BadGatewayException({
        code: "ASAAS_CHECKOUT_REJECTED",
        message: "O provedor não aceitou a criação do checkout.",
      });
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("id" in payload) ||
      typeof payload.id !== "string" ||
      !("link" in payload) ||
      typeof payload.link !== "string"
    ) {
      throw new BadGatewayException({
        code: "ASAAS_CHECKOUT_INVALID_RESPONSE",
        message: "O provedor retornou um checkout inválido.",
      });
    }
    if (!isHttpsUrl(payload.link)) {
      throw new BadGatewayException({
        code: "ASAAS_CHECKOUT_INSECURE_URL",
        message: "O provedor retornou uma URL de checkout insegura.",
      });
    }
    return {
      id: payload.id,
      link: new URL(payload.link).toString(),
    };
  }

  private idempotencyConflict() {
    return new ConflictException({
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "A chave de idempotência já foi usada com outro conteúdo.",
    });
  }

  private publicCheckoutStatus(status: string): BillingCheckout["status"] {
    if (["created", "pending", "paid", "expired", "canceled", "failed"].includes(status)) {
      return status as BillingCheckout["status"];
    }
    return status === "reconciliation_required" || status === "provider_pending"
      ? "pending"
      : "failed";
  }

  private unavailableReason(input: {
    onlinePaymentsEnabled: boolean;
    canSubscribe: boolean;
    canRegularize: boolean;
    canUpgrade: boolean;
    subscription: boolean;
    periodValid: boolean;
    hasUpgrade: boolean;
  }) {
    if (!input.onlinePaymentsEnabled) return "Pagamento online ainda não está habilitado.";
    if (input.canSubscribe || input.canRegularize || input.canUpgrade) return null;
    if (input.subscription && !input.periodValid)
      return "O período atual da assinatura está indisponível.";
    if (input.subscription && !input.hasUpgrade) return "Seu plano já está no nível mais alto.";
    return "Nenhuma ação de cobrança está disponível para o estado atual.";
  }
}
