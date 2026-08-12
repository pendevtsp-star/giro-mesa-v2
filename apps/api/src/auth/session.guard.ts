import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { DatabaseService } from "../database/database.module.js";
import { type AuthContext, AuthService } from "./auth.service.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";

export type AuthenticatedRequest = FastifyRequest & { auth: AuthContext };

export function sessionToken(
  authorization: string | undefined,
  cookies: Record<string, string | undefined> | undefined,
) {
  if (authorization !== undefined) {
    if (!authorization.startsWith("Bearer ")) return null;
    return authorization.slice(7).trim() || null;
  }
  return cookies?.[SESSION_COOKIE_NAME] ?? null;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<
      FastifyRequest & {
        auth?: AuthContext;
        cookies?: Record<string, string | undefined>;
      }
    >();
    const token = sessionToken(request.headers.authorization, request.cookies);
    if (!token) throw new UnauthorizedException();
    const auth = await this.database.withRoleContext("identity", null, () =>
      this.authService.authenticate(token),
    );
    if (!auth) throw new UnauthorizedException();
    request.auth = auth;
    return true;
  }
}
