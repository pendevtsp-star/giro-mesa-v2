import { mfaFactors } from "@giromesa/db";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import type { AuthenticatedRequest } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import { type PlatformAccess, platformAccessForEmail } from "./platform-access.js";

export type PlatformRequest = AuthenticatedRequest & { platformAccess: PlatformAccess };

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const access = platformAccessForEmail(request.auth.email);
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
