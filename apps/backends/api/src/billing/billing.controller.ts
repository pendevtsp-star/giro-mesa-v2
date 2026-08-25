import {
  type BillingCheckoutInput,
  type BillingEventInput,
  type BillingUpgradeQuoteInput,
  billingCheckoutInputSchema,
  billingEventSchema,
  billingUpgradeQuoteInputSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { AsaasWebhookGuard } from "./asaas-webhook.guard.js";
import {
  type AsaasWebhookInput,
  asaasWebhookSchema,
  billingIdempotencyKeySchema,
} from "./billing.schemas.js";
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

  @UseGuards(SessionGuard)
  @Get([
    "api/v1/organizations/:organizationId/billing/summary",
    "v1/organizations/:organizationId/billing/summary",
  ])
  summary(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.billingService.summary(request.auth.identityId, organizationId);
  }

  @UseGuards(SessionGuard)
  @Post([
    "api/v1/organizations/:organizationId/billing/upgrade-quotes",
    "v1/organizations/:organizationId/billing/upgrade-quotes",
  ])
  upgradeQuote(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string,
    @Body(new ZodPipe(billingUpgradeQuoteInputSchema)) body: BillingUpgradeQuoteInput,
  ) {
    const idempotencyKey = new ZodPipe(billingIdempotencyKeySchema).transform(
      rawIdempotencyKey,
    ) as string;
    return this.billingService.createUpgradeQuote(
      request.auth.identityId,
      organizationId,
      idempotencyKey,
      body,
    );
  }

  @UseGuards(SessionGuard)
  @Post([
    "api/v1/organizations/:organizationId/billing/checkouts",
    "v1/organizations/:organizationId/billing/checkouts",
  ])
  checkout(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string,
    @Body(new ZodPipe(billingCheckoutInputSchema)) body: BillingCheckoutInput,
  ) {
    const idempotencyKey = new ZodPipe(billingIdempotencyKeySchema).transform(
      rawIdempotencyKey,
    ) as string;
    return this.billingService.createCheckout(
      request.auth.identityId,
      organizationId,
      idempotencyKey,
      body,
    );
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

  @UseGuards(AsaasWebhookGuard)
  @HttpCode(HttpStatus.OK)
  @Post(["api/v1/webhooks/asaas", "webhooks/asaas"])
  asaasWebhook(@Body(new ZodPipe(asaasWebhookSchema)) body: AsaasWebhookInput) {
    return this.billingService.receiveAsaasWebhook(body);
  }
}
