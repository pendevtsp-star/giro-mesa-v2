import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { type AuthContext, AuthService } from "./auth.service.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";
import { TerminalSessionService } from "./terminal-session.service.js";

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
    @Optional() private readonly terminalSessions?: TerminalSessionService,
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
    const identityAuth = await this.authService.authenticate(token);
    const auth = identityAuth ?? (await this.terminalSessions?.authenticate(token));
    if (!auth) throw new UnauthorizedException();
    if (
      auth.authKind === "terminal" &&
      !terminalRequestAllowed(request.method, request.url, auth)
    ) {
      throw new ForbiddenException({
        code: "TERMINAL_ROUTE_DENIED",
        message: "Esta área exige uma sessão pessoal completa.",
      });
    }
    request.auth = auth;
    return true;
  }
}

const operationalResource =
  /^(?:tabs(?:\/|$)|orders(?:\/|$)|items(?:\/|$)|payments(?:\/|$)|payment-attempts(?:\/|$)|print-jobs(?:\/|$)|approval-requests(?:\/|$)|calls(?:\/|$)|table-groups(?:\/|$)|kds(?:\/|$)|tables\/[^/]+\/(?:turnover|calls)$)/;

export function terminalRequestAllowed(method: string, url: string, auth: AuthContext) {
  if (!auth.organizationId || !auth.unitId) return false;
  const path = new URL(url, "http://localhost").pathname.replace(/\/+$/, "");
  const match = path.match(
    /^\/(?:api\/)?v1\/organizations\/([^/]+)\/units\/([^/]+)\/pilot(?:\/(.*))?$/,
  );
  if (!match || match[1] !== auth.organizationId || match[2] !== auth.unitId) return false;
  const resource = match[3] ?? "";
  if (method.toUpperCase() === "GET" && resource === "floor") return true;
  if (resource.startsWith("kds/terminals/")) return false;
  return operationalResource.test(resource);
}
