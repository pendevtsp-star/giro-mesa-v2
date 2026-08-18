import type { BillingEventInput } from "@giromesa/contracts";
import { auditEvents, organizations, outboxEvents } from "@giromesa/db";
import {
  type BillingState,
  billingAccess,
  OPERATIONAL_CLOSURE_HOURS,
  transitionBilling,
} from "@giromesa/domain";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";

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

  async applyEvent(organizationId: string, input: BillingEventInput) {
    const [organization] = await this.database.db
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

    return this.database.db.transaction(async (tx) => {
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
}
