import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { type PaymentDeviceSignature, PilotPosService } from "./pilot-pos.service.js";
import {
  type PaymentDeviceCredentialRotateInput,
  type PaymentDeviceDiagnosticsInput,
  type PaymentDevicePairingRedeemInput,
  type PaymentDeviceResultInput,
  paymentAttemptLookupResponseSchema,
  paymentDeviceClaimResponseSchema,
  paymentDeviceCredentialResponseSchema,
  paymentDeviceCredentialRotateSchema,
  paymentDeviceDiagnosticsSchema,
  paymentDevicePairingRedeemSchema,
  paymentDeviceResultResponseSchema,
  paymentDeviceResultSchema,
  paymentDeviceReversalResultResponseSchema,
  paymentReversalResponseSchema,
  paymentTerminalCapabilityResponseSchema,
} from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

type RawRequest = { method?: string; raw?: { url?: string } };

function signatureOf(
  request: RawRequest,
  credentialId: string | undefined,
  timestamp: string | undefined,
  nonce: string | undefined,
  signature: string | undefined,
  body?: unknown,
): PaymentDeviceSignature {
  return {
    credentialId,
    timestamp,
    nonce,
    signature,
    method: request.method ?? "",
    path: request.raw?.url ?? "",
    body,
  };
}

@Controller(["api/v1/device", "v1/device"])
export class PilotPaymentDeviceController {
  constructor(
    private readonly pos: PilotPosService,
    private readonly smartPos: PilotSmartPosService,
  ) {}

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentDeviceCredentialResponseSchema) })
  @Post("payment-pairings/redeem")
  redeemPairing(
    @Body(new ZodPipe(paymentDevicePairingRedeemSchema)) body: PaymentDevicePairingRedeemInput,
  ) {
    return this.smartPos.redeemPairing(body);
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentDeviceCredentialResponseSchema) })
  @Post("payment-credentials/rotate")
  rotateCredential(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Body(new ZodPipe(paymentDeviceCredentialRotateSchema))
    body: PaymentDeviceCredentialRotateInput,
  ) {
    return this.smartPos.rotateCredential(
      signatureOf(request, credentialId, timestamp, nonce, signature, body),
      body,
    );
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentTerminalCapabilityResponseSchema) })
  @Post("payment-diagnostics")
  reportDiagnostics(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Body(new ZodPipe(paymentDeviceDiagnosticsSchema)) body: PaymentDeviceDiagnosticsInput,
  ) {
    return this.smartPos.reportDiagnostics(
      signatureOf(request, credentialId, timestamp, nonce, signature, body),
      body,
    );
  }

  @ApiOkResponse({ schema: toOpenApiSchema(paymentAttemptLookupResponseSchema) })
  @Get("payment-attempts/:attemptId")
  getAttempt(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
  ) {
    return this.pos.getDevicePaymentAttempt(
      signatureOf(request, credentialId, timestamp, nonce, signature),
      attemptId,
    );
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentDeviceClaimResponseSchema) })
  @Post("payment-attempts/:attemptId/claim")
  claimAttempt(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
  ) {
    return this.pos.claimDevicePaymentAttempt(
      signatureOf(request, credentialId, timestamp, nonce, signature),
      attemptId,
    );
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentDeviceResultResponseSchema) })
  @Post("payment-attempts/:attemptId/result")
  recordResult(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
    @Body(new ZodPipe(paymentDeviceResultSchema)) body: PaymentDeviceResultInput,
  ) {
    return this.pos.recordDevicePaymentResult(
      signatureOf(request, credentialId, timestamp, nonce, signature, body),
      attemptId,
      body,
    );
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentReversalResponseSchema) })
  @Post("payment-reversals/:reversalId/claim")
  claimReversal(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Param("reversalId", ParseUUIDPipe) reversalId: string,
  ) {
    return this.pos.claimDevicePaymentReversal(
      signatureOf(request, credentialId, timestamp, nonce, signature),
      reversalId,
    );
  }

  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(paymentDeviceReversalResultResponseSchema) })
  @Post("payment-reversals/:reversalId/result")
  recordReversalResult(
    @Req() request: RawRequest,
    @Headers("x-giromesa-credential-id") credentialId: string | undefined,
    @Headers("x-giromesa-timestamp") timestamp: string | undefined,
    @Headers("x-giromesa-nonce") nonce: string | undefined,
    @Headers("x-giromesa-signature") signature: string | undefined,
    @Param("reversalId", ParseUUIDPipe) reversalId: string,
    @Body(new ZodPipe(paymentDeviceResultSchema)) body: PaymentDeviceResultInput,
  ) {
    return this.pos.recordDevicePaymentReversalResult(
      signatureOf(request, credentialId, timestamp, nonce, signature, body),
      reversalId,
      body,
    );
  }
}
