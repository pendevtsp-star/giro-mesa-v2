import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

@Injectable()
export class InternalKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const configured = process.env.INTERNAL_API_KEY;
    if (!configured)
      throw new ServiceUnavailableException({
        code: "INTERNAL_API_DISABLED",
        message: "API interna desabilitada.",
      });
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { internalDatabaseContext?: boolean }>();
    const supplied = request.headers["x-internal-api-key"];
    if (typeof supplied !== "string") throw new UnauthorizedException();
    const expectedBuffer = Buffer.from(configured);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    )
      throw new UnauthorizedException();
    request.internalDatabaseContext = true;
    return true;
  }
}
