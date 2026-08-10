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
    const supplied = context.switchToHttp().getRequest<FastifyRequest>().headers[
      "x-internal-api-key"
    ];
    if (typeof supplied !== "string") throw new UnauthorizedException();
    const expectedBuffer = Buffer.from(configured);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    )
      throw new UnauthorizedException();
    return true;
  }
}
