import { idempotencyKeySchema, publicMenuSlugSchema } from "@giromesa/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type ApiKeyInput,
  apiKeySchema,
  type CampaignCancelInput,
  type CampaignInput,
  type ConsentInput,
  type CouponInput,
  type CouponRedemptionInput,
  type CouponUpdateInput,
  type CrmAutomationExecutionQueryInput,
  type CrmAutomationRuleInput,
  type CrmAutomationTestInput,
  type CrmQuickReplyInput,
  type CustomerArchiveInput,
  type CustomerInput,
  type CustomerListQueryInput,
  type CustomerMergeInput,
  type CustomerUpdateInput,
  campaignCancelSchema,
  campaignSchema,
  consentSchema,
  couponRedemptionSchema,
  couponSchema,
  couponUpdateSchema,
  crmAutomationExecutionQuerySchema,
  crmAutomationRuleSchema,
  crmAutomationTestSchema,
  crmQuickReplySchema,
  customerArchiveSchema,
  customerListQuerySchema,
  customerMergeSchema,
  customerSchema,
  customerUpdateSchema,
  type DeliveryAddressValidationInput,
  type DeliveryCourierAssignmentInput,
  type DeliveryCourierCreateInput,
  type DeliveryCourierPositionInput,
  type DeliveryCourierStatusInput,
  type DeliveryNotificationInput,
  type DeliveryOrderInput,
  type DeliveryOrderQueryInput,
  type DeliveryTransitionInput,
  type DeliveryZoneInput,
  type DeliveryZoneUpdateInput,
  type DispatchInput,
  type DoseClubInput,
  deliveryAddressValidationSchema,
  deliveryCourierAssignmentSchema,
  deliveryCourierCreateSchema,
  deliveryCourierPositionSchema,
  deliveryCourierStatusSchema,
  deliveryNotificationSchema,
  deliveryOrderQuerySchema,
  deliveryOrderSchema,
  deliveryTransitionSchema,
  deliveryZoneSchema,
  deliveryZoneUpdateSchema,
  dispatchSchema,
  doseClubSchema,
  type EvolutionConfigurationInput,
  type EvolutionUnitQueryInput,
  type EvolutionWebhookInput,
  evolutionConfigurationSchema,
  evolutionUnitQuerySchema,
  evolutionWebhookSchema,
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
  type ReservationListQueryInput,
  type ReservationTransitionInput,
  reservationListQuerySchema,
  reservationSchema,
  reservationTransitionSchema,
  type SegmentInput,
  segmentSchema,
  type TransferInput,
  type TransferTransitionInput,
  transferSchema,
  transferTransitionSchema,
  type WaitlistInput,
  type WaitlistListQueryInput,
  type WaitlistTransitionInput,
  type WebhookEndpointInput,
  type WebhookEventInput,
  type WhatsAppConversationUpdateInput,
  type WhatsAppInboxQueryInput,
  type WhatsAppMessageInput,
  type WhatsAppMessagesQueryInput,
  waitlistListQuerySchema,
  waitlistSchema,
  waitlistTransitionSchema,
  webhookEndpointSchema,
  webhookEventSchema,
  whatsappConversationUpdateSchema,
  whatsappInboxQuerySchema,
  whatsappMessageSchema,
  whatsappMessagesQuerySchema,
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

  @Get("customers/page")
  listCustomerPage(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(customerListQuerySchema)) query: CustomerListQueryInput,
  ) {
    return this.growth.listCustomerPage(request.auth.identityId, organizationId, query);
  }

  @Get("customers/:customerId")
  customerDetail(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ) {
    return this.growth.customerDetail(request.auth.identityId, organizationId, customerId);
  }

  @Patch("customers/:customerId")
  updateCustomer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body(new ZodPipe(customerUpdateSchema)) body: CustomerUpdateInput,
  ) {
    return this.growth.updateCustomer(request.auth.identityId, organizationId, customerId, body);
  }

  @Post("customers/:customerId/archive")
  archiveCustomer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body(new ZodPipe(customerArchiveSchema)) body: CustomerArchiveInput,
  ) {
    return this.growth.archiveCustomer(request.auth.identityId, organizationId, customerId, body);
  }

  @Post("customers/:customerId/merge")
  mergeCustomer(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("customerId", ParseUUIDPipe) customerId: string,
    @Body(new ZodPipe(customerMergeSchema)) body: CustomerMergeInput,
  ) {
    return this.growth.mergeCustomer(request.auth.identityId, organizationId, customerId, body);
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

  @Get("loyalty/programs/current")
  loyaltyProgram(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.growth.loyaltyProgram(request.auth.identityId, organizationId);
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

  @Patch("coupons/:couponId")
  updateCoupon(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("couponId", ParseUUIDPipe) couponId: string,
    @Body(new ZodPipe(couponUpdateSchema)) body: CouponUpdateInput,
  ) {
    return this.growth.updateCoupon(request.auth.identityId, organizationId, couponId, body);
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

  @Get("campaigns/:campaignId/preview")
  previewCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("campaignId", ParseUUIDPipe) campaignId: string,
  ) {
    return this.growth.previewCampaign(request.auth.identityId, organizationId, campaignId);
  }

  @Get("campaigns/:campaignId/deliveries")
  campaignDeliveries(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("campaignId", ParseUUIDPipe) campaignId: string,
  ) {
    return this.growth.campaignDeliverySummary(request.auth.identityId, organizationId, campaignId);
  }

  @Post("campaigns/:campaignId/cancel")
  cancelCampaign(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("campaignId", ParseUUIDPipe) campaignId: string,
    @Body(new ZodPipe(campaignCancelSchema)) body: CampaignCancelInput,
  ) {
    return this.growth.cancelCampaign(request.auth.identityId, organizationId, campaignId, body);
  }

  @Get("units/:unitId/reservations")
  @ApiQuery({ name: "scope", required: false, enum: ["active", "history", "all"] })
  @ApiQuery({ name: "from", required: false, schema: { type: "string", format: "date-time" } })
  @ApiQuery({ name: "to", required: false, schema: { type: "string", format: "date-time" } })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200, default: 100 },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, default: 0 },
  })
  listReservations(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(reservationListQuerySchema)) query: ReservationListQueryInput,
  ) {
    return this.growth.listReservations(request.auth.identityId, organizationId, unitId, query);
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
  @ApiQuery({ name: "scope", required: false, enum: ["active", "history", "all"] })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200, default: 100 },
  })
  @ApiQuery({
    name: "offset",
    required: false,
    schema: { type: "integer", minimum: 0, default: 0 },
  })
  listWaitlist(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(waitlistListQuerySchema)) query: WaitlistListQueryInput,
  ) {
    return this.growth.listWaitlist(request.auth.identityId, organizationId, unitId, query);
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

  @Patch("delivery-zones/:zoneId")
  updateDeliveryZone(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("zoneId", ParseUUIDPipe) zoneId: string,
    @Body(new ZodPipe(deliveryZoneUpdateSchema)) body: DeliveryZoneUpdateInput,
  ) {
    return this.growth.updateDeliveryZone(request.auth.identityId, organizationId, zoneId, body);
  }

  @Post("delivery-zones/:zoneId/validate-address")
  validateDeliveryAddress(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("zoneId", ParseUUIDPipe) zoneId: string,
    @Body(new ZodPipe(deliveryAddressValidationSchema)) body: DeliveryAddressValidationInput,
  ) {
    return this.growth.validateDeliveryAddress(
      request.auth.identityId,
      organizationId,
      zoneId,
      body,
    );
  }

  @Get("units/:unitId/delivery-couriers")
  listDeliveryCouriers(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.growth.listDeliveryCouriers(request.auth.identityId, organizationId, unitId);
  }

  @Post("delivery-couriers")
  createDeliveryCourier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(deliveryCourierCreateSchema)) body: DeliveryCourierCreateInput,
  ) {
    return this.growth.createDeliveryCourier(request.auth.identityId, organizationId, body);
  }

  @Patch("delivery-couriers/:courierId/status")
  updateDeliveryCourierStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("courierId", ParseUUIDPipe) courierId: string,
    @Body(new ZodPipe(deliveryCourierStatusSchema)) body: DeliveryCourierStatusInput,
  ) {
    return this.growth.updateDeliveryCourierStatus(
      request.auth.identityId,
      organizationId,
      courierId,
      body,
    );
  }

  @Patch("delivery-couriers/:courierId/position")
  updateDeliveryCourierPosition(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("courierId", ParseUUIDPipe) courierId: string,
    @Body(new ZodPipe(deliveryCourierPositionSchema)) body: DeliveryCourierPositionInput,
  ) {
    return this.growth.updateDeliveryCourierPosition(
      request.auth.identityId,
      organizationId,
      courierId,
      body,
    );
  }

  @Get("units/:unitId/delivery-orders")
  @ApiQuery({
    name: "status",
    required: false,
    enum: [
      "draft",
      "placed",
      "confirmed",
      "preparing",
      "ready",
      "dispatched",
      "completed",
      "canceled",
    ],
  })
  @ApiQuery({
    name: "updatedSince",
    required: false,
    schema: { type: "string", format: "date-time" },
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: { type: "integer", minimum: 1, maximum: 200, default: 100 },
  })
  @ApiQuery({
    name: "query",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 120 },
  })
  @ApiQuery({ name: "scheduled", required: false, schema: { type: "boolean" } })
  @ApiQuery({ name: "sla", required: false, enum: ["overdue", "on_time", "unset"] })
  listDeliveryOrders(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(deliveryOrderQuerySchema)) query: DeliveryOrderQueryInput,
  ) {
    return this.growth.listDeliveryOrders(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("delivery-orders")
  createDeliveryOrder(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(deliveryOrderSchema)) body: DeliveryOrderInput,
  ) {
    return this.growth.createDeliveryOrder(request.auth.identityId, organizationId, body);
  }

  @Post("delivery-orders/:orderId/assign")
  assignDeliveryCourier(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(deliveryCourierAssignmentSchema)) body: DeliveryCourierAssignmentInput,
  ) {
    return this.growth.assignDeliveryCourier(
      request.auth.identityId,
      organizationId,
      orderId,
      body,
    );
  }

  @Post("delivery-orders/:orderId/notifications")
  requestDeliveryNotification(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(deliveryNotificationSchema)) body: DeliveryNotificationInput,
  ) {
    return this.growth.requestDeliveryNotification(
      request.auth.identityId,
      organizationId,
      orderId,
      body,
    );
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

  @Get("integrations/evolution-go")
  getEvolution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.getEvolutionIntegration(
      request.auth.identityId,
      organizationId,
      query.unitId,
    );
  }

  @Post("integrations/evolution-go")
  configureEvolution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(evolutionConfigurationSchema)) body: EvolutionConfigurationInput,
  ) {
    return this.growth.configureEvolution(request.auth.identityId, organizationId, body);
  }

  @Get("integrations/evolution-go/status")
  evolutionStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.evolutionStatus(request.auth.identityId, organizationId, query.unitId);
  }

  @Get("integrations/evolution-go/qr")
  evolutionQr(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.evolutionQr(request.auth.identityId, organizationId, query.unitId);
  }

  @Post("integrations/evolution-go/reconnect")
  reconnectEvolution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(evolutionUnitQuerySchema)) body: EvolutionUnitQueryInput,
  ) {
    return this.growth.evolutionConnectionAction(
      request.auth.identityId,
      organizationId,
      body.unitId,
      "reconnect",
    );
  }

  @Post("integrations/evolution-go/logout")
  logoutEvolution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(evolutionUnitQuerySchema)) body: EvolutionUnitQueryInput,
  ) {
    return this.growth.evolutionConnectionAction(
      request.auth.identityId,
      organizationId,
      body.unitId,
      "logout",
    );
  }

  @Get("whatsapp/conversations")
  whatsappInbox(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(whatsappInboxQuerySchema)) query: WhatsAppInboxQueryInput,
  ) {
    return this.growth.listWhatsAppInbox(request.auth.identityId, organizationId, query);
  }

  @Get("whatsapp/conversations/:conversationId/messages")
  whatsappMessages(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Query(new ZodPipe(whatsappMessagesQuerySchema)) query: WhatsAppMessagesQueryInput,
  ) {
    return this.growth.listWhatsAppMessages(
      request.auth.identityId,
      organizationId,
      conversationId,
      query,
    );
  }

  @Patch("whatsapp/conversations/:conversationId")
  updateWhatsappConversation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Body(new ZodPipe(whatsappConversationUpdateSchema)) body: WhatsAppConversationUpdateInput,
  ) {
    return this.growth.updateWhatsAppConversation(
      request.auth.identityId,
      organizationId,
      conversationId,
      body,
    );
  }

  @Get("whatsapp/assignees")
  whatsappAssignees(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.listWhatsAppAssignees(request.auth.identityId, organizationId, query.unitId);
  }

  @Get("whatsapp/conversations/:conversationId/messages/:messageId/media")
  whatsappMessageMedia(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Param("messageId", ParseUUIDPipe) messageId: string,
  ) {
    return this.growth.whatsAppMessageMedia(
      request.auth.identityId,
      organizationId,
      conversationId,
      messageId,
    );
  }

  @Post("whatsapp/conversations/:conversationId/read")
  markWhatsappRead(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
  ) {
    return this.growth.markWhatsAppConversationRead(
      request.auth.identityId,
      organizationId,
      conversationId,
    );
  }

  @Post("whatsapp/messages")
  sendWhatsappMessage(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(whatsappMessageSchema)) body: WhatsAppMessageInput,
  ) {
    return this.growth.sendWhatsAppMessage(request.auth.identityId, organizationId, body);
  }

  @Get("crm/automations")
  crmAutomations(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.listCrmAutomations(request.auth.identityId, organizationId, query.unitId);
  }

  @Post("crm/automations")
  upsertCrmAutomation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(crmAutomationRuleSchema)) body: CrmAutomationRuleInput,
  ) {
    return this.growth.upsertCrmAutomation(request.auth.identityId, organizationId, body);
  }

  @Get("crm/automation-executions")
  crmAutomationExecutions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(crmAutomationExecutionQuerySchema)) query: CrmAutomationExecutionQueryInput,
  ) {
    return this.growth.listCrmAutomationExecutions(request.auth.identityId, organizationId, query);
  }

  @Post("crm/automation-executions/:executionId/retry")
  retryCrmAutomationExecution(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
  ) {
    return this.growth.retryCrmAutomationExecution(
      request.auth.identityId,
      organizationId,
      executionId,
    );
  }

  @Post("crm/automations/:ruleId/test")
  testCrmAutomation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
    @Body(new ZodPipe(crmAutomationTestSchema)) body: CrmAutomationTestInput,
  ) {
    return this.growth.testCrmAutomation(request.auth.identityId, organizationId, ruleId, body);
  }

  @Get("crm/quick-replies")
  crmQuickReplies(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query(new ZodPipe(evolutionUnitQuerySchema)) query: EvolutionUnitQueryInput,
  ) {
    return this.growth.listCrmQuickReplies(request.auth.identityId, organizationId, query.unitId);
  }

  @Post("crm/quick-replies")
  upsertCrmQuickReply(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(crmQuickReplySchema)) body: CrmQuickReplyInput,
  ) {
    return this.growth.upsertCrmQuickReply(request.auth.identityId, organizationId, body);
  }

  @Delete("crm/quick-replies/:replyId")
  deleteCrmQuickReply(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("replyId", ParseUUIDPipe) replyId: string,
  ) {
    return this.growth.deleteCrmQuickReply(request.auth.identityId, organizationId, replyId);
  }
}

@Controller(["api/v1/growth", "v1/growth"])
export class GrowthPublicController {
  constructor(private readonly growth: GrowthService) {}

  @Post("opt-out")
  optOut(@Body(new ZodPipe(optOutSchema)) body: OptOutInput) {
    return this.growth.optOut(body.token);
  }

  @Post("evolution-go/webhook")
  evolutionWebhook(@Body(new ZodPipe(evolutionWebhookSchema)) body: EvolutionWebhookInput) {
    return this.growth.handleEvolutionWebhook(body);
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
