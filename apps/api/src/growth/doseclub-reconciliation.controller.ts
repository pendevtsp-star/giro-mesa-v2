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
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DoseClubReconciliationService } from "./doseclub-reconciliation.service.js";
import {
  type DoseClubFindingRecheckInput,
  type DoseClubMappingCreateInput,
  type DoseClubMappingUpdateInput,
  type DoseClubReconciliationUnitInput,
  type DoseClubRetryRunInput,
  doseClubFindingRecheckSchema,
  doseClubMappingCreateSchema,
  doseClubMappingUpdateSchema,
  doseClubReconciliationUnitSchema,
  doseClubRetryRunSchema,
} from "./growth.schemas.js";

class DoseClubReconciliationRunDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) unitId!: string;
  @ApiProperty({ format: "date" }) runDate!: string;
  @ApiProperty({ enum: ["scheduled", "manual", "retry"] }) trigger!:
    | "scheduled"
    | "manual"
    | "retry";
  @ApiProperty({ enum: ["pending", "running", "completed", "failed"] }) status!:
    | "pending"
    | "running"
    | "completed"
    | "failed";
  @ApiProperty() findingCount!: number;
  @ApiProperty({ type: String, nullable: true }) failureCode!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) startedAt!: Date | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) completedAt!: Date | null;
  @ApiProperty({ format: "date-time" }) createdAt!: Date;
  @ApiProperty({ format: "date-time" }) updatedAt!: Date;
}

class DoseClubMappingDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) unitId!: string;
  @ApiProperty() externalProductId!: string;
  @ApiProperty({ format: "uuid" }) productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty({ format: "uuid" }) inventoryItemId!: string;
  @ApiProperty() inventoryItemName!: string;
  @ApiProperty({ format: "uuid" }) stockLocationId!: string;
  @ApiProperty() stockLocationName!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() version!: number;
  @ApiProperty({ format: "date-time" }) updatedAt!: Date;
}

class DoseClubFindingDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) unitId!: string;
  @ApiProperty({
    enum: [
      "missing_mapping",
      "inactive_mapping",
      "invalid_inventory_dimension",
      "invalid_inventory_unit",
      "state_version_gap",
      "missing_reconcile_heartbeat",
    ],
  })
  kind!: string;
  @ApiProperty({ enum: ["open", "resolved", "superseded"] }) status!: string;
  @ApiProperty({ enum: ["warning", "critical"] }) severity!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: "object", additionalProperties: true }) evidence!: Record<string, unknown>;
  @ApiProperty({ format: "date-time" }) firstDetectedAt!: Date;
  @ApiProperty({ format: "date-time" }) lastDetectedAt!: Date;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) resolvedAt!: Date | null;
  @ApiProperty() version!: number;
}

class DoseClubIntegrationDto {
  @ApiProperty({ enum: ["doseclub"] }) provider!: "doseclub";
  @ApiProperty() status!: string;
  @ApiProperty({ format: "uuid" }) unitId!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: Date;
}

class DoseClubReconciliationSummaryDto {
  @ApiProperty({ enum: ["not_scanned", "healthy", "attention", "failed"] }) status!: string;
  @ApiProperty({ enum: ["partial"] }) remoteHeartbeat!: "partial";
  @ApiProperty({ type: DoseClubReconciliationRunDto, nullable: true })
  lastRun!: DoseClubReconciliationRunDto | null;
  @ApiProperty() openFindingCount!: number;
}

class DoseClubOverviewDto {
  @ApiProperty({ type: DoseClubIntegrationDto, nullable: true })
  integration!: DoseClubIntegrationDto | null;
  @ApiProperty({ type: DoseClubReconciliationSummaryDto })
  reconciliation!: DoseClubReconciliationSummaryDto;
  @ApiProperty({ type: [DoseClubMappingDto] }) mappings!: DoseClubMappingDto[];
  @ApiProperty({ type: [DoseClubFindingDto] }) findings!: DoseClubFindingDto[];
  @ApiProperty({ type: [DoseClubReconciliationRunDto] }) runs!: DoseClubReconciliationRunDto[];
}

@ApiTags("DoseClub administration")
@ApiBadRequestResponse({ description: "Invalid route or request contract" })
@ApiUnauthorizedResponse({ description: "Authenticated session required" })
@ApiForbiddenResponse({ description: "Owner or manager role required" })
@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/growth/integrations/doseclub",
  "v1/organizations/:organizationId/growth/integrations/doseclub",
])
export class DoseClubReconciliationController {
  constructor(private readonly reconciliation: DoseClubReconciliationService) {}

  @Get("overview")
  @ApiOperation({ summary: "Get tenant-scoped DoseClub mapping and reconciliation status" })
  @ApiOkResponse({ type: DoseClubOverviewDto })
  overview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.reconciliation.overview(request.auth.identityId, organizationId, unitId);
  }

  @Post("mappings")
  @ApiOperation({ summary: "Create a local mapping using the POS product id as external id" })
  @ApiCreatedResponse({ type: DoseClubMappingDto })
  @ApiConflictResponse({ description: "Mapping already exists" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitId", "productId", "inventoryItemId", "stockLocationId"],
      additionalProperties: false,
      properties: {
        unitId: { type: "string", format: "uuid" },
        productId: { type: "string", format: "uuid" },
        inventoryItemId: { type: "string", format: "uuid" },
        stockLocationId: { type: "string", format: "uuid" },
      },
    },
  })
  createMapping(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body(new ZodPipe(doseClubMappingCreateSchema)) body: DoseClubMappingCreateInput,
  ) {
    return this.reconciliation.createMapping(request.auth.identityId, organizationId, body);
  }

  @Patch("mappings/:mappingId")
  @ApiOperation({ summary: "Update a mapping with optimistic concurrency" })
  @ApiOkResponse({ type: DoseClubMappingDto })
  @ApiConflictResponse({ description: "Mapping version conflict" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitId", "inventoryItemId", "stockLocationId", "active", "expectedVersion"],
      additionalProperties: false,
      properties: {
        unitId: { type: "string", format: "uuid" },
        inventoryItemId: { type: "string", format: "uuid" },
        stockLocationId: { type: "string", format: "uuid" },
        active: { type: "boolean" },
        expectedVersion: { type: "integer", minimum: 1 },
      },
    },
  })
  updateMapping(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("mappingId", ParseUUIDPipe) mappingId: string,
    @Body(new ZodPipe(doseClubMappingUpdateSchema)) body: DoseClubMappingUpdateInput,
  ) {
    return this.reconciliation.updateMapping(
      request.auth.identityId,
      organizationId,
      mappingId,
      body,
    );
  }

  @Post("runs")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Queue an idempotent local reconciliation scan" })
  @ApiAcceptedResponse({ type: DoseClubReconciliationRunDto })
  @ApiConflictResponse({ description: "Idempotency conflict" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitId"],
      additionalProperties: false,
      properties: { unitId: { type: "string", format: "uuid" } },
    },
  })
  requestRun(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodPipe(doseClubReconciliationUnitSchema)) body: DoseClubReconciliationUnitInput,
  ) {
    return this.reconciliation.requestRun(
      request.auth.identityId,
      organizationId,
      body.unitId,
      idempotencyKey,
    );
  }

  @Post("runs/:runId/retry")
  @HttpCode(202)
  @ApiOperation({ summary: "Requeue a failed local scan using optimistic concurrency" })
  @ApiAcceptedResponse({ type: DoseClubReconciliationRunDto })
  @ApiConflictResponse({ description: "Run state or version conflict" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitId", "expectedVersion"],
      additionalProperties: false,
      properties: {
        unitId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 1 },
      },
    },
  })
  retryRun(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @Body(new ZodPipe(doseClubRetryRunSchema)) body: DoseClubRetryRunInput,
  ) {
    return this.reconciliation.retryRun(request.auth.identityId, organizationId, runId, body);
  }

  @Post("findings/:findingId/recheck")
  @HttpCode(202)
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOperation({ summary: "Queue a local recheck for a current finding" })
  @ApiAcceptedResponse({ type: DoseClubReconciliationRunDto })
  @ApiConflictResponse({ description: "Finding state, version or idempotency conflict" })
  @ApiNotFoundResponse({ description: "Finding not found in the tenant unit" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitId", "expectedVersion"],
      additionalProperties: false,
      properties: {
        unitId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 1 },
      },
    },
  })
  recheckFinding(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("findingId", ParseUUIDPipe) findingId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body(new ZodPipe(doseClubFindingRecheckSchema)) body: DoseClubFindingRecheckInput,
  ) {
    return this.reconciliation.recheckFinding(
      request.auth.identityId,
      organizationId,
      findingId,
      body,
      idempotencyKey,
    );
  }
}
