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
  type CancelFiscalDocumentInput,
  cancelFiscalDocumentSchema,
  competenceSchema,
  type FiscalDocumentListQuery,
  type FiscalNumberInvalidationInput,
  type FiscalPackageQuery,
  type FiscalProfileInput,
  type FocusCompanyOnboardingInput,
  fiscalDocumentListQuerySchema,
  fiscalNumberInvalidationSchema,
  fiscalPackageQuerySchema,
  fiscalProfileSchema,
  focusCompanyOnboardingSchema,
  type ProductTaxRevisionBulkInput,
  type ProductTaxRevisionImportInput,
  type ProductTaxRevisionInput,
  type ProductTaxRevisionListQuery,
  productTaxRevisionBulkSchema,
  productTaxRevisionImportSchema,
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

  @Get("provider")
  providerStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.providerStatus(request.auth.identityId, organizationId, unitId);
  }

  @Post("provider/validate")
  validateProvider(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(focusCompanyOnboardingSchema)) body: FocusCompanyOnboardingInput,
  ) {
    return this.fiscal.validateFocusCompany(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("provider/activate")
  activateProvider(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(focusCompanyOnboardingSchema)) body: FocusCompanyOnboardingInput,
  ) {
    return this.fiscal.activateFocusCompany(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("provider/check")
  checkProvider(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.checkFocusCompany(request.auth.identityId, organizationId, unitId);
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

  @Post("tax-revisions/bulk")
  createTaxRevisionsBulk(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(productTaxRevisionBulkSchema)) body: ProductTaxRevisionBulkInput,
  ) {
    return this.fiscal.createTaxRevisionsBulk(
      request.auth.identityId,
      organizationId,
      unitId,
      body,
    );
  }

  @Post("tax-revisions/import")
  importTaxRevisions(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(productTaxRevisionImportSchema)) body: ProductTaxRevisionImportInput,
  ) {
    return this.fiscal.importTaxRevisions(request.auth.identityId, organizationId, unitId, body);
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

  @Post("documents/:documentId/reconcile")
  reconcileDocument(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ) {
    return this.fiscal.reconcileDocument(
      request.auth.identityId,
      organizationId,
      unitId,
      documentId,
    );
  }

  @Get("documents/:documentId/artifacts/:kind")
  documentArtifact(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Param("kind") kind: string,
  ) {
    return this.fiscal.documentArtifact(
      request.auth.identityId,
      organizationId,
      unitId,
      documentId,
      kind,
    );
  }

  @Post("documents/:documentId/cancel")
  cancelDocument(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body(new ZodPipe(cancelFiscalDocumentSchema)) body: CancelFiscalDocumentInput,
  ) {
    return this.fiscal.cancelDocument(
      request.auth.identityId,
      organizationId,
      unitId,
      documentId,
      body,
    );
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

  @Get("accountant/package/content")
  accountantPackageContent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(fiscalPackageQuerySchema)) query: FiscalPackageQuery,
  ) {
    return this.fiscal.accountantPackageContent(
      request.auth.identityId,
      organizationId,
      unitId,
      query.competence,
    );
  }

  @Get("number-invalidations")
  numberInvalidations(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.fiscal.numberInvalidations(request.auth.identityId, organizationId, unitId);
  }

  @Post("number-invalidations")
  invalidateNumbers(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(fiscalNumberInvalidationSchema)) body: FiscalNumberInvalidationInput,
  ) {
    return this.fiscal.invalidateNumbers(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("number-invalidations/:invalidationId/artifact")
  numberInvalidationArtifact(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("invalidationId", ParseUUIDPipe) invalidationId: string,
  ) {
    return this.fiscal.numberInvalidationArtifact(
      request.auth.identityId,
      organizationId,
      unitId,
      invalidationId,
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
