import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export function secretsMatch(expected: string, supplied: string) {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

@Injectable()
export class AsaasWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const configured = process.env.ASAAS_WEBHOOK_SECRET;
    if (!configured || configured === process.env.ASAAS_API_KEY) {
      throw new ServiceUnavailableException({
        code: "ASAAS_WEBHOOK_DISABLED",
        message: "Webhook Asaas desabilitado.",
      });
    }
    const supplied = context.switchToHttp().getRequest<FastifyRequest>().headers[
      "asaas-access-token"
    ];
    if (typeof supplied !== "string" || !secretsMatch(configured, supplied)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
