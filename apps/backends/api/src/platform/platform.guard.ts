import { identities, mfaFactors, platformStaffAccess } from "@giromesa/db";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { AuthenticatedRequest } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import {
  type PlatformAccess,
  platformAccessForEmail,
  platformAccessForRole,
} from "./platform-access.js";

export type PlatformRequest = AuthenticatedRequest & { platformAccess: PlatformAccess };

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const [identity] = await this.database.db
      .select({
        disabledAt: identities.disabledAt,
        emailVerifiedAt: identities.emailVerifiedAt,
        kind: identities.kind,
      })
      .from(identities)
      .where(eq(identities.id, request.auth.identityId))
      .limit(1);
    if (identity?.kind !== "human" || identity.disabledAt || !identity.emailVerifiedAt) {
      throw new ForbiddenException({ code: "PLATFORM_IDENTITY_NOT_VERIFIED" });
    }
    const [storedAccess] = await this.database.db
      .select({ role: platformStaffAccess.role })
      .from(platformStaffAccess)
      .where(
        and(
          eq(platformStaffAccess.identityId, request.auth.identityId),
          isNull(platformStaffAccess.revokedAt),
        ),
      )
      .limit(1);
    const access =
      platformAccessForEmail(request.auth.email) ?? platformAccessForRole(storedAccess?.role ?? "");
    if (!access) throw new ForbiddenException({ code: "PLATFORM_ACCESS_DENIED" });
    const [factor] = await this.database.db
      .select({ identityId: mfaFactors.identityId })
      .from(mfaFactors)
      .where(
        and(eq(mfaFactors.identityId, request.auth.identityId), isNotNull(mfaFactors.verifiedAt)),
      )
      .limit(1);
    if (!factor) throw new ForbiddenException({ code: "PLATFORM_MFA_REQUIRED" });
    request.platformAccess = access;
    return true;
  }
}
