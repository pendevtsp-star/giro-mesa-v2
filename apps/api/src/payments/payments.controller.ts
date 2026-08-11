import {
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type PaymentAttemptInput,
  type PaymentIntentInput,
  type PaymentManualReviewInput,
  paymentAttemptSchema,
  paymentIntentSchema,
  paymentManualReviewSchema,
} from "./payments.schemas.js";
import { PaymentsService } from "./payments.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/payments",
  "v1/organizations/:organizationId/units/:unitId/payments",
])
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("intents")
  createIntent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(paymentIntentSchema)) body: PaymentIntentInput,
  ) {
    return this.payments.createPaymentIntent(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("intents/:intentId/attempts")
  executeAttempt(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("intentId", ParseUUIDPipe) intentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(paymentAttemptSchema)) body: PaymentAttemptInput,
  ) {
    return this.payments.executePaymentAttempt(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      { intentId, ...body },
    );
  }

  @Post("attempts/:attemptId/reconcile")
  reconcile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
  ) {
    return this.payments.reconcilePaymentAttempt(
      request.auth.identityId,
      organizationId,
      unitId,
      attemptId,
    );
  }

  @Post("attempts/:attemptId/manual-review")
  manualReview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
    @Body(new ZodPipe(paymentManualReviewSchema)) body: PaymentManualReviewInput,
  ) {
    return this.payments.resolvePaymentAttemptManually(
      request.auth.identityId,
      organizationId,
      unitId,
      attemptId,
      body,
    );
  }
}
