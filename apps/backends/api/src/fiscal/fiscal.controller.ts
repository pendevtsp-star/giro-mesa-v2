import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type AccountantRequestInput,
  type AccountantRequestListQuery,
  accountantRequestListQuerySchema,
  accountantRequestSchema,
  competenceSchema,
  type FiscalDocumentListQuery,
  type FiscalPackageQuery,
  type FiscalProfileInput,
  fiscalDocumentListQuerySchema,
  fiscalPackageQuerySchema,
  fiscalProfileSchema,
  type ProductTaxRevisionInput,
  type ProductTaxRevisionListQuery,
  productTaxRevisionListQuerySchema,
  productTaxRevisionSchema,
  type ReopenFiscalPeriodInput,
  type ResolveAccountantRequestInput,
  reopenFiscalPeriodSchema,
  resolveAccountantRequestSchema,
} from "./fiscal.schemas.js";
import { FiscalService } from "./fiscal.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/fiscal",
  "v1/organizations/:organizationId/units/:unitId/fiscal",
])
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get("profile")
  profile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.profile(request.auth.identityId, organizationId, unitId);
  }

  @Put("profile")
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(fiscalProfileSchema)) body: FiscalProfileInput,
  ) {
    return this.fiscal.updateProfile(request.auth.identityId, organizationId, unitId, body);
  }

  @Get("tax-revisions")
  taxRevisions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(productTaxRevisionListQuerySchema)) query: ProductTaxRevisionListQuery,
  ) {
    return this.fiscal.taxRevisions(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("tax-revisions")
  createTaxRevision(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(productTaxRevisionSchema)) body: ProductTaxRevisionInput,
  ) {
    return this.fiscal.createTaxRevision(request.auth.identityId, organizationId, unitId, body);
  }

  @Get("dashboard")
  dashboard(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.dashboard(request.auth.identityId, organizationId, unitId);
  }

  @Get("documents")
  documents(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(fiscalDocumentListQuerySchema)) query: FiscalDocumentListQuery,
  ) {
    return this.fiscal.documents(request.auth.identityId, organizationId, unitId, query);
  }

  @Get("documents/:documentId")
  document(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.fiscal.document(request.auth.identityId, organizationId, unitId, documentId);
  }

  @Get("periods")
  periods(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.periods(request.auth.identityId, organizationId, unitId);
  }

  @Post("periods/:competence/close")
  closePeriod(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("competence", new ZodPipe(competenceSchema)) competence: string,
  ) {
    return this.fiscal.closePeriod(request.auth.identityId, organizationId, unitId, competence);
  }

  @Post("periods/:competence/reopen")
  reopenPeriod(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("competence", new ZodPipe(competenceSchema)) competence: string,
    @Body(new ZodPipe(reopenFiscalPeriodSchema)) body: ReopenFiscalPeriodInput,
  ) {
    return this.fiscal.reopenPeriod(
      request.auth.identityId,
      organizationId,
      unitId,
      competence,
      body,
    );
  }

  @Get("accountant/package")
  accountantPackage(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(fiscalPackageQuerySchema)) query: FiscalPackageQuery,
  ) {
    return this.fiscal.accountantPackage(
      request.auth.identityId,
      organizationId,
      unitId,
      query.competence,
    );
  }

  @Get("accountant/requests")
  accountantRequests(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(accountantRequestListQuerySchema)) query: AccountantRequestListQuery,
  ) {
    return this.fiscal.accountantRequests(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("accountant/requests")
  createAccountantRequest(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(accountantRequestSchema)) body: AccountantRequestInput,
  ) {
    return this.fiscal.createAccountantRequest(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("accountant/requests/:requestId/resolve")
  resolveAccountantRequest(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body(new ZodPipe(resolveAccountantRequestSchema)) body: ResolveAccountantRequestInput,
  ) {
    return this.fiscal.resolveAccountantRequest(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      body,
    );
  }
}
