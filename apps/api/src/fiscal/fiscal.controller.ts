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
  type FiscalCancelInput,
  type FiscalIssueInput,
  fiscalCancelSchema,
  fiscalIssueSchema,
} from "./fiscal.schemas.js";
import { FiscalService } from "./fiscal.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/fiscal",
  "v1/organizations/:organizationId/units/:unitId/fiscal",
])
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Post("documents")
  issue(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(fiscalIssueSchema)) body: FiscalIssueInput,
  ) {
    return this.fiscal.issue(request.auth.identityId, organizationId, unitId, idempotencyKey, body);
  }

  @Post("documents/:documentId/retry")
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.fiscal.retry(request.auth.identityId, organizationId, unitId, documentId);
  }

  @Post("documents/:documentId/cancel")
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body(new ZodPipe(fiscalCancelSchema)) body: FiscalCancelInput,
  ) {
    return this.fiscal.cancel(
      request.auth.identityId,
      organizationId,
      unitId,
      documentId,
      body.reason,
    );
  }
}
