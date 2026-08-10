import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { from, lastValueFrom } from "rxjs";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "./database.module.js";

type TenantRequest = FastifyRequest & {
  auth?: AuthContext;
  params?: { organizationId?: unknown; unitId?: unknown };
};

function routeUuid(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly database: DatabaseService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler) {
    const request = executionContext.switchToHttp().getRequest<TenantRequest>();
    const organizationId = routeUuid(request.params?.organizationId);
    if (!organizationId) return next.handle();

    return from(
      this.database.withTenantContext(
        {
          source: "http",
          organizationId,
          unitId: routeUuid(request.params?.unitId),
          actorIdentityId: request.auth?.identityId,
        },
        () => lastValueFrom(next.handle()),
      ),
    );
  }
}
