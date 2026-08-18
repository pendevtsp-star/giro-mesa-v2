import { memberships, roleBindings, units } from "@giromesa/db";
import type { SystemRole } from "@giromesa/domain";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class ScopeService {
  constructor(private readonly database: DatabaseService) {}

  async requireOrganizationRole(
    identityId: string,
    organizationId: string,
    allowed: readonly SystemRole[],
  ) {
    const rows = await this.database.db
      .select({
        membershipId: memberships.id,
        role: roleBindings.role,
        unitId: roleBindings.unitId,
      })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
        ),
      );
    if (!rows.some((row) => allowed.includes(row.role)))
      throw new ForbiddenException({
        code: "INSUFFICIENT_ROLE",
        message: "Acesso não autorizado.",
      });
    return rows;
  }

  async requireUnitAccess(identityId: string, organizationId: string, unitId: string) {
    const [unit] = await this.database.db
      .select({ id: units.id })
      .from(units)
      .where(
        and(eq(units.id, unitId), eq(units.organizationId, organizationId), eq(units.active, true)),
      )
      .limit(1);
    if (!unit)
      throw new NotFoundException({ code: "UNIT_NOT_FOUND", message: "Unidade não encontrada." });
    const [scope] = await this.database.db
      .select({ membershipId: memberships.id, role: roleBindings.role })
      .from(memberships)
      .innerJoin(roleBindings, eq(roleBindings.membershipId, memberships.id))
      .where(
        and(
          eq(memberships.identityId, identityId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(roleBindings.unitId), eq(roleBindings.unitId, unitId)),
        ),
      )
      .limit(1);
    if (!scope)
      throw new ForbiddenException({
        code: "UNIT_ACCESS_DENIED",
        message: "Acesso à unidade não autorizado.",
      });
    return scope;
  }
}
