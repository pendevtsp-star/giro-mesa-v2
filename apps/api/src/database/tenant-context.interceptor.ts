import { createHash } from "node:crypto";
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { from, lastValueFrom } from "rxjs";
import type { AuthContext } from "../auth/auth.service.js";
import { PlatformDurableOutcomeError } from "../platform/platform-errors.js";
import { DatabaseService } from "./database.module.js";
import { DATABASE_CONTEXT_ROLE, type HttpDatabaseContext } from "./database-context.decorator.js";

type TenantRequest = FastifyRequest & {
  auth?: AuthContext;
  internalDatabaseContext?: boolean;
  params?: { organizationId?: unknown; slug?: unknown; unitId?: unknown };
  body?: unknown;
  query?: unknown;
};

function routeUuid(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PlatformContextOutcome =
  | { status: "success"; value: unknown }
  | { status: "durable-error"; error: unknown };

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
      if (organizationId && !uuidPattern.test(organizationId)) {
        throw new BadRequestException({
          statusCode: 400,
          code: "INVALID_PLATFORM_ORGANIZATION_ID",
          message: "O identificador da organizacao e invalido.",
        });
      }
      return from(
        this.database
          .withPlatformContext<PlatformContextOutcome>(
            {
              actorIdentityId: request.auth.identityId,
              sessionId: request.auth.sessionId,
              organizationId,
            },
            async () => {
              try {
                return {
                  status: "success" as const,
                  value: await lastValueFrom(next.handle()),
                };
              } catch (error) {
                if (error instanceof PlatformDurableOutcomeError) {
                  return { status: "durable-error" as const, error: error.originalError };
                }
                throw error;
              }
            },
          )
          .then((outcome) => {
            if (outcome.status === "durable-error") throw outcome.error;
            return outcome.value;
          }),
      );
    }
    if (!organizationId) {
      if (!role) return next.handle();
      if (role === "doseclub") {
        const rawKey = request.headers["x-giromesa-integration-key"];
        if (typeof rawKey !== "string" || !rawKey.trim()) throw new UnauthorizedException();
        const body =
          request.body && typeof request.body === "object" && !Array.isArray(request.body)
            ? (request.body as Record<string, unknown>)
            : null;
        const query =
          request.query && typeof request.query === "object" && !Array.isArray(request.query)
            ? (request.query as Record<string, unknown>)
            : null;
        const candidate = body?.branchId ?? query?.branchId;
        const branchId = typeof candidate === "string" ? candidate : null;
        const scope = request.method === "GET" ? "doseclub:read" : "doseclub:write";
        const keyHash = createHash("sha256").update(rawKey).digest("hex");
        return from(
          this.database
            .withDoseClubContext({ keyHash, scope, branchId }, () => lastValueFrom(next.handle()))
            .catch((error: unknown) => {
              if (error instanceof Error && error.message === "DOSECLUB_SCOPE_NOT_FOUND") {
                throw new UnauthorizedException();
              }
              throw error;
            }),
        );
      }
      if (role === "public-menu") {
        const slug = typeof request.params?.slug === "string" ? request.params.slug : "";
        return from(
          this.database
            .withPublicMenuContext(slug, () => lastValueFrom(next.handle()))
            .catch((error: unknown) => {
              if (error instanceof Error && error.message === "PUBLIC_MENU_SCOPE_NOT_FOUND") {
                throw new NotFoundException({
                  statusCode: 404,
                  code: "PUBLIC_MENU_NOT_FOUND",
                  message: "O cardapio solicitado nao foi encontrado.",
                });
              }
              throw error;
            }),
        );
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
