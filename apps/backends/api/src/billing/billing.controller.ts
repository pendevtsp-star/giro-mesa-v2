import { type BillingEventInput, billingEventSchema } from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { BillingService } from "./billing.service.js";
import { InternalKeyGuard } from "./internal-key.guard.js";

@Controller()
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(SessionGuard)
  @Get([
    "api/v1/organizations/:organizationId/billing/access",
    "v1/organizations/:organizationId/billing/access",
  ])
  access(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.billingService.access(request.auth.identityId, organizationId);
  }

  @UseGuards(InternalKeyGuard)
  @Post([
    "api/v1/internal/organizations/:organizationId/billing/events",
    "internal/v1/organizations/:organizationId/billing/events",
  ])
  event(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(billingEventSchema)) body: BillingEventInput,
  ) {
    return this.billingService.applyEvent(organizationId, body);
  }

  @Post(["api/v1/webhooks/asaas", "webhooks/asaas"])
  asaasWebhook() {
    throw new ServiceUnavailableException({
      code: "ASAAS_DISABLED",
      message: "Webhook Asaas desabilitado até a configuração de credenciais e assinatura.",
    });
  }
}
