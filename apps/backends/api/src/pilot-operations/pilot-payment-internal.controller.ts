import { Body, Controller, Param, ParseUUIDPipe, Post, Put, UseGuards } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { InternalKeyGuard } from "../billing/internal-key.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PilotPosService } from "./pilot-pos.service.js";
import {
  type PaymentReconciliationInput,
  type PaymentTerminalCertificationInput,
  type PaymentTerminalConfigurationInput,
  paymentReconciliationInputSchema,
  paymentTerminalCapabilityResponseSchema,
  paymentTerminalCertificationSchema,
  paymentTerminalConfigurationSchema,
} from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

@UseGuards(InternalKeyGuard)
@Controller([
  "api/v1/internal/organizations/:organizationId/units/:unitId/payment-terminals",
  "internal/v1/organizations/:organizationId/units/:unitId/payment-terminals",
])
export class PilotPaymentInternalController {
  constructor(
    private readonly pos: PilotPosService,
    private readonly smartPos: PilotSmartPosService,
  ) {}

  @Put("certifications/:certificationId")
  configureCertification(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("certificationId", ParseUUIDPipe) certificationId: string,
    @Body(new ZodPipe(paymentTerminalCertificationSchema)) body: PaymentTerminalCertificationInput,
  ) {
    return this.smartPos.configureCertification(organizationId, unitId, certificationId, body);
  }

  @Post("reconciliation")
  ingestReconciliation(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(paymentReconciliationInputSchema)) body: PaymentReconciliationInput,
  ) {
    return this.smartPos.ingestReconciliation(organizationId, unitId, body);
  }

  @ApiOkResponse({ schema: toOpenApiSchema(paymentTerminalCapabilityResponseSchema) })
  @Put(":installationId")
  configure(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("installationId", ParseUUIDPipe) installationId: string,
    @Body(new ZodPipe(paymentTerminalConfigurationSchema)) body: PaymentTerminalConfigurationInput,
  ) {
    return this.pos.configurePaymentTerminal(organizationId, unitId, installationId, body);
  }
}
