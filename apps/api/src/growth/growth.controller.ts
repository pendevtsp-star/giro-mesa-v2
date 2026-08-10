import { idempotencyKeySchema, publicMenuSlugSchema } from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type ApiKeyInput,
  apiKeySchema,
  type CampaignInput,
  type ConsentInput,
  type CouponInput,
  type CouponRedemptionInput,
  type CustomerInput,
  campaignSchema,
  consentSchema,
  couponRedemptionSchema,
  couponSchema,
  customerSchema,
  type DeliveryOrderInput,
  type DeliveryTransitionInput,
  type DeliveryZoneInput,
  type DispatchInput,
  type DoseClubInput,
  deliveryOrderSchema,
  deliveryTransitionSchema,
  deliveryZoneSchema,
  dispatchSchema,
  doseClubSchema,
  type LoyaltyEarnInput,
  type LoyaltyProgramInput,
  type LoyaltyRedeemInput,
  type LoyaltyReverseInput,
  loyaltyEarnSchema,
  loyaltyProgramSchema,
  loyaltyRedeemSchema,
  loyaltyReverseSchema,
  type OptOutInput,
  optOutSchema,
  type PriceOverrideInput,
  type PublicCouponValidationInput,
  type PublicReservationInput,
  type PublicWaitlistInput,
  priceOverrideSchema,
  publicCouponValidationSchema,
  publicReservationSchema,
  publicWaitlistSchema,
  type ReservationInput,
  type ReservationTransitionInput,
  reservationSchema,
  reservationTransitionSchema,
  type SegmentInput,
  segmentSchema,
  type TransferInput,
  type TransferTransitionInput,
  transferSchema,
  transferTransitionSchema,
  type WaitlistInput,
  type WaitlistTransitionInput,
  type WebhookEndpointInput,
  type WebhookEventInput,
  waitlistSchema,
  waitlistTransitionSchema,
  webhookEndpointSchema,
  webhookEventSchema,
} from "./growth.schemas.js";
import { GrowthService } from "./growth.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/growth",
  "v1/organizations/:organizationId/growth",
])
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Get("customers")
  listCustomers(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listCustomers(request.auth.identityId, organizationId);
  }

  @Post("customers")
  createCustomer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(customerSchema)) body: CustomerInput,
  ) {
    return this.growth.createCustomer(request.auth.identityId, organizationId, body);
  }

  @Post("customers/:customerId/consents")
  consent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body(new ZodPipe(consentSchema)) body: ConsentInput,
  ) {
    return this.growth.recordConsent(request.auth.identityId, organizationId, customerId, body);
  }

  @Post("customers/:customerId/opt-out-token")
  optOutToken(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ) {
    return this.growth.issueOptOutToken(request.auth.identityId, organizationId, customerId);
  }

  @Post("loyalty/programs")
  configureLoyalty(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(loyaltyProgramSchema)) body: LoyaltyProgramInput,
  ) {
    return this.growth.configureLoyaltyProgram(request.auth.identityId, organizationId, body);
  }

  @Get("loyalty/customers/:customerId/balance")
  loyaltyBalance(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ) {
    return this.growth.loyaltyBalance(request.auth.identityId, organizationId, customerId);
  }

  @Post("loyalty/earn")
  earnLoyalty(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(loyaltyEarnSchema)) body: LoyaltyEarnInput,
  ) {
    return this.growth.earnLoyalty(request.auth.identityId, organizationId, body);
  }

  @Post("loyalty/redeem")
  redeemLoyalty(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(loyaltyRedeemSchema)) body: LoyaltyRedeemInput,
  ) {
    return this.growth.redeemLoyalty(request.auth.identityId, organizationId, body);
  }

  @Post("loyalty/entries/:entryId/reverse")
  reverseLoyalty(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body(new ZodPipe(loyaltyReverseSchema)) body: LoyaltyReverseInput,
  ) {
    return this.growth.reverseLoyalty(request.auth.identityId, organizationId, entryId, body);
  }

  @Get("coupons")
  listCoupons(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listCoupons(request.auth.identityId, organizationId);
  }

  @Post("coupons")
  createCoupon(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(couponSchema)) body: CouponInput,
  ) {
    return this.growth.createCoupon(request.auth.identityId, organizationId, body);
  }

  @Post("coupons/redeem")
  redeemCoupon(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(couponRedemptionSchema)) body: CouponRedemptionInput,
  ) {
    return this.growth.redeemCoupon(request.auth.identityId, organizationId, body);
  }

  @Get("segments")
  listSegments(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listSegments(request.auth.identityId, organizationId);
  }

  @Post("segments")
  createSegment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(segmentSchema)) body: SegmentInput,
  ) {
    return this.growth.createSegment(request.auth.identityId, organizationId, body);
  }

  @Get("campaigns")
  listCampaigns(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listCampaigns(request.auth.identityId, organizationId);
  }

  @Post("campaigns")
  createCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(campaignSchema)) body: CampaignInput,
  ) {
    return this.growth.createCampaign(request.auth.identityId, organizationId, body);
  }

  @Post("campaigns/:campaignId/queue")
  queueCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("campaignId", ParseUUIDPipe) campaignId: string,
  ) {
    return this.growth.queueCampaign(request.auth.identityId, organizationId, campaignId);
  }

  @Get("units/:unitId/reservations")
  listReservations(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.growth.listReservations(request.auth.identityId, organizationId, unitId);
  }

  @Post("reservations")
  createReservation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(reservationSchema)) body: ReservationInput,
  ) {
    return this.growth.createReservation(request.auth.identityId, organizationId, body);
  }

  @Patch("reservations/:reservationId/status")
  transitionReservation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("reservationId", ParseUUIDPipe) reservationId: string,
    @Body(new ZodPipe(reservationTransitionSchema)) body: ReservationTransitionInput,
  ) {
    return this.growth.transitionReservation(
      request.auth.identityId,
      organizationId,
      reservationId,
      body,
    );
  }

  @Get("units/:unitId/waitlist")
  listWaitlist(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.growth.listWaitlist(request.auth.identityId, organizationId, unitId);
  }

  @Post("waitlist")
  createWaitlistEntry(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(waitlistSchema)) body: WaitlistInput,
  ) {
    return this.growth.createWaitlistEntry(request.auth.identityId, organizationId, body);
  }

  @Patch("waitlist/:entryId/status")
  transitionWaitlist(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("entryId", ParseUUIDPipe) entryId: string,
    @Body(new ZodPipe(waitlistTransitionSchema)) body: WaitlistTransitionInput,
  ) {
    return this.growth.transitionWaitlist(request.auth.identityId, organizationId, entryId, body);
  }

  @Get("units/:unitId/delivery-zones")
  listDeliveryZones(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.growth.listDeliveryZones(request.auth.identityId, organizationId, unitId);
  }

  @Post("delivery-zones")
  createDeliveryZone(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(deliveryZoneSchema)) body: DeliveryZoneInput,
  ) {
    return this.growth.createDeliveryZone(request.auth.identityId, organizationId, body);
  }

  @Post("delivery-orders")
  createDeliveryOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(deliveryOrderSchema)) body: DeliveryOrderInput,
  ) {
    return this.growth.createDeliveryOrder(request.auth.identityId, organizationId, body);
  }

  @Patch("delivery-orders/:orderId/status")
  transitionDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(deliveryTransitionSchema)) body: DeliveryTransitionInput,
  ) {
    return this.growth.transitionDelivery(request.auth.identityId, organizationId, orderId, body);
  }

  @Post("delivery-orders/:orderId/dispatch")
  dispatchDelivery(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(dispatchSchema)) body: DispatchInput,
  ) {
    return this.growth.dispatchDelivery(request.auth.identityId, organizationId, orderId, body);
  }

  @Post("multiunit/price-overrides")
  upsertPriceOverride(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(priceOverrideSchema)) body: PriceOverrideInput,
  ) {
    return this.growth.upsertPriceOverride(request.auth.identityId, organizationId, body);
  }

  @Post("multiunit/transfers")
  createTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(transferSchema)) body: TransferInput,
  ) {
    return this.growth.createTransfer(request.auth.identityId, organizationId, body);
  }

  @Patch("multiunit/transfers/:transferId/status")
  transitionTransfer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("transferId", ParseUUIDPipe) transferId: string,
    @Body(new ZodPipe(transferTransitionSchema)) body: TransferTransitionInput,
  ) {
    return this.growth.transitionTransfer(
      request.auth.identityId,
      organizationId,
      transferId,
      body,
    );
  }

  @Get("multiunit/summary")
  consolidatedSummary(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.consolidatedSummary(request.auth.identityId, organizationId);
  }

  @Get("api-keys")
  listApiKeys(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listApiKeys(request.auth.identityId, organizationId);
  }

  @Post("api-keys")
  createApiKey(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(apiKeySchema)) body: ApiKeyInput,
  ) {
    return this.growth.createApiKey(request.auth.identityId, organizationId, body);
  }

  @Post("api-keys/:keyId/revoke")
  revokeApiKey(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("keyId", ParseUUIDPipe) keyId: string,
  ) {
    return this.growth.revokeApiKey(request.auth.identityId, organizationId, keyId);
  }

  @Get("webhook-endpoints")
  listWebhookEndpoints(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.listWebhookEndpoints(request.auth.identityId, organizationId);
  }

  @Post("webhook-endpoints")
  createWebhookEndpoint(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(webhookEndpointSchema)) body: WebhookEndpointInput,
  ) {
    return this.growth.createWebhookEndpoint(request.auth.identityId, organizationId, body);
  }

  @Get("integrations/doseclub")
  getDoseClub(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.getDoseClub(request.auth.identityId, organizationId);
  }

  @Post("integrations/doseclub")
  configureDoseClub(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(doseClubSchema)) body: DoseClubInput,
  ) {
    return this.growth.configureDoseClub(request.auth.identityId, organizationId, body);
  }
}

@Controller(["api/v1/growth", "v1/growth"])
export class GrowthPublicController {
  constructor(private readonly growth: GrowthService) {}

  @Post("opt-out")
  optOut(@Body(new ZodPipe(optOutSchema)) body: OptOutInput) {
    return this.growth.optOut(body.token);
  }
}

@Controller(["api/v1/public/menus/:slug", "public/v1/menus/:slug"])
export class GrowthPublicMenuController {
  constructor(private readonly growth: GrowthService) {}

  @Post("reservations")
  createReservation(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(publicReservationSchema)) body: PublicReservationInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.growth.createPublicReservation(slug, idempotencyKey, body);
  }

  @Post("waitlist")
  joinWaitlist(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(publicWaitlistSchema)) body: PublicWaitlistInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.growth.createPublicWaitlistEntry(slug, idempotencyKey, body);
  }

  @HttpCode(200)
  @Post("coupons/validate")
  validateCoupon(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Body(new ZodPipe(publicCouponValidationSchema)) body: PublicCouponValidationInput,
  ) {
    return this.growth.validatePublicCoupon(slug, body);
  }
}

@Controller(["api/v1/public", "v1/public"])
export class GrowthPublicApiController {
  constructor(private readonly growth: GrowthService) {}

  @Post("events")
  publish(
    @Headers("authorization") authorization: string | undefined,
    @Body(new ZodPipe(webhookEventSchema)) body: WebhookEventInput,
  ) {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1])
      throw new UnauthorizedException({
        code: "API_KEY_REQUIRED",
        message: "Bearer token obrigatório.",
      });
    return this.growth.publishWebhook(match[1], body);
  }
}
