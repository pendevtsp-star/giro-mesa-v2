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
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import {
  type AccountantAttachmentUploadInput,
  type AccountantRequestInput,
  type AccountantRequestListQuery,
  accountantAttachmentUploadSchema,
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

type OpenApiSchema = NonNullable<NonNullable<OpenAPIObject["components"]>["schemas"]>[string];

const publicAccountantRequestOpenApi: OpenApiSchema = {
  type: "object",
  required: [
    "id",
    "competence",
    "title",
    "description",
    "status",
    "targetAudience",
    "createdByName",
    "createdAt",
    "attachments",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    competence: { type: "string", format: "date" },
    title: { type: "string" },
    description: { type: "string" },
    status: { type: "string", enum: ["open", "resolved"] },
    targetAudience: { type: "string", enum: ["accountant", "establishment"] },
    dueDate: { type: "string", format: "date", nullable: true },
    resolution: { type: "string", nullable: true },
    createdByName: { type: "string" },
    resolvedByName: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    resolvedAt: { type: "string", format: "date-time", nullable: true },
    updatedAt: { type: "string", format: "date-time" },
    attachments: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "fileName", "contentType", "sizeBytes", "sha256", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          fileName: { type: "string" },
          contentType: {
            type: "string",
            enum: [
              "application/pdf",
              "application/xml",
              "text/xml",
              "text/csv",
              "image/jpeg",
              "image/png",
            ],
          },
          sizeBytes: { type: "integer", maximum: 3_145_728 },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
};

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
  @ApiQuery({
    name: "competence",
    required: true,
    schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["status", "competence"],
      properties: {
        status: { type: "string", enum: ["available", "unavailable"] },
        competence: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
        reason: { type: "string", enum: ["period_not_closed"] },
        closedAt: { type: "string", format: "date-time", nullable: true },
        generatedAt: { type: "string", format: "date-time", nullable: true },
        sha256: { type: "string", nullable: true },
        summary: {
          type: "object",
          properties: {
            documents: { type: "integer" },
            totalCents: { type: "integer" },
            taxCents: { type: "integer" },
          },
        },
        files: { type: "array", items: { type: "string" } },
      },
    },
  })
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
  @ApiQuery({
    name: "competence",
    required: true,
    schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
  })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["filename", "content", "contentEncoding", "mimeType", "sha256"],
      properties: {
        filename: { type: "string" },
        content: { type: "string", format: "byte" },
        contentEncoding: { type: "string", enum: ["base64"] },
        mimeType: { type: "string", enum: ["application/zip"] },
        sha256: { type: "string" },
      },
    },
  })
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
  @ApiQuery({ name: "status", required: false, enum: ["open", "resolved"] })
  @ApiQuery({ name: "targetAudience", required: false, enum: ["accountant", "establishment"] })
  @ApiQuery({ name: "overdue", required: false, type: Boolean })
  @ApiQuery({
    name: "competence",
    required: false,
    schema: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["items", "pagination"],
      properties: {
        items: { type: "array", items: publicAccountantRequestOpenApi },
        pagination: {
          type: "object",
          required: ["page", "pageSize", "total"],
          properties: {
            page: { type: "integer" },
            pageSize: { type: "integer" },
            total: { type: "integer" },
          },
        },
      },
    },
  })
  accountantRequests(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(accountantRequestListQuerySchema)) query: AccountantRequestListQuery,
  ) {
    return this.fiscal.accountantRequests(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("accountant/requests")
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: ["request", "replayed"],
      properties: {
        request: publicAccountantRequestOpenApi,
        replayed: { type: "boolean" },
      },
    },
  })
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

  @Post("accountant/requests/:requestId/attachments")
  @ApiBody({
    schema: {
      type: "object",
      required: ["fileName", "contentType", "contentBase64"],
      properties: {
        fileName: { type: "string", maxLength: 180 },
        contentType: {
          type: "string",
          enum: [
            "application/pdf",
            "application/xml",
            "text/xml",
            "text/csv",
            "image/jpeg",
            "image/png",
          ],
        },
        contentBase64: { type: "string", format: "byte", maxLength: 4_194_304 },
      },
    },
  })
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: ["attachment", "replayed"],
      properties: {
        attachment: {
          type: "object",
          required: ["id", "fileName", "contentType", "sizeBytes", "sha256", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            fileName: { type: "string" },
            contentType: { type: "string" },
            sizeBytes: { type: "integer" },
            sha256: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        replayed: { type: "boolean" },
      },
    },
  })
  createAccountantAttachment(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body(new ZodPipe(accountantAttachmentUploadSchema)) body: AccountantAttachmentUploadInput,
  ) {
    return this.fiscal.createAccountantAttachment(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      body,
    );
  }

  @Get("accountant/requests/:requestId/attachments/:attachmentId/content")
  @ApiOkResponse({
    schema: {
      type: "object",
      required: ["filename", "content", "contentEncoding", "mimeType", "sha256"],
      properties: {
        filename: { type: "string" },
        content: { type: "string", format: "byte" },
        contentEncoding: { type: "string", enum: ["base64"] },
        mimeType: { type: "string" },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
  })
  accountantAttachmentContent(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
  ) {
    return this.fiscal.accountantAttachmentContent(
      request.auth.identityId,
      organizationId,
      unitId,
      requestId,
      attachmentId,
    );
  }

  @Post("accountant/requests/:requestId/resolve")
  @ApiCreatedResponse({
    schema: {
      type: "object",
      required: ["request", "replayed"],
      properties: {
        request: publicAccountantRequestOpenApi,
        replayed: { type: "boolean" },
      },
    },
  })
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
