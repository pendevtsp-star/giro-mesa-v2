import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { from, lastValueFrom } from "rxjs";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "./database.module.js";
import { DATABASE_CONTEXT_ROLE, type HttpDatabaseContext } from "./database-context.decorator.js";

type TenantRequest = FastifyRequest & {
  auth?: AuthContext;
  internalDatabaseContext?: boolean;
  params?: { organizationId?: unknown; slug?: unknown; unitId?: unknown };
};

function routeUuid(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(
    private readonly database: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  intercept(executionContext: ExecutionContext, next: CallHandler) {
    const request = executionContext.switchToHttp().getRequest<TenantRequest>();
    const organizationId = routeUuid(request.params?.organizationId);
    const role = this.reflector.getAllAndOverride<HttpDatabaseContext>(DATABASE_CONTEXT_ROLE, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (role === "platform") {
      if (!request.auth) throw new UnauthorizedException();
      return from(
        this.database.withPlatformContext(
          {
            actorIdentityId: request.auth.identityId,
            sessionId: request.auth.sessionId,
            organizationId,
          },
          () => lastValueFrom(next.handle()),
        ),
      );
    }
    if (!organizationId) {
      if (!role) return next.handle();
      if (role === "public-menu") {
        const slug = typeof request.params?.slug === "string" ? request.params.slug : "";
        return from(this.database.withPublicMenuContext(slug, () => lastValueFrom(next.handle())));
      }
      return from(
        this.database.withRoleContext(role, request.auth?.identityId ?? null, () =>
          lastValueFrom(next.handle()),
        ),
      );
    }

    return from(
      this.database.withTenantContext(
        {
          source: request.internalDatabaseContext ? "internal" : "http",
          organizationId,
          unitId: routeUuid(request.params?.unitId),
          actorIdentityId: request.auth?.identityId,
        },
        () => lastValueFrom(next.handle()),
      ),
    );
  }
}
