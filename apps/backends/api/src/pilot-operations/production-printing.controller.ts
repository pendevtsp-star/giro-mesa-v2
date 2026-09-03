import {
  type CreateProductionPrinterInput,
  createProductionPrinterSchema,
  idempotencyKeySchema,
  type ManualKdsTicketPrintInput,
  manualKdsTicketPrintSchema,
  type ProductionPrinterConnectionProbeInput,
  type ProductionPrinterRevisionInput,
  type ProductionPrintPolicyInput,
  productionPrinterConnectionProbeInputSchema,
  productionPrinterConnectionProbeResponseSchema,
  productionPrinterConnectionProbeStatusSchema,
  productionPrinterListResponseSchema,
  productionPrinterMutationResponseSchema,
  productionPrinterRevisionSchema,
  productionPrinterTestResponseSchema,
  productionPrintJobMutationResponseSchema,
  productionPrintPolicyInputSchema,
  productionStationListResponseSchema,
  productionStationMutationResponseSchema,
  type ResolveUnknownProductionPrintJobInput,
  resolveUnknownProductionPrintJobSchema,
  type UpdateProductionPrinterInput,
  updateProductionPrinterSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse } from "@nestjs/swagger";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { ProductionPrintingService } from "./production-printing.service.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/pilot",
  "v1/organizations/:organizationId/units/:unitId/pilot",
])
export class ProductionPrintingController {
  constructor(
    private readonly productionPrinting: ProductionPrintingService,
    private readonly pos: PilotPosService,
  ) {}

  @Get("production-printers")
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterListResponseSchema) })
  listPrinters(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.productionPrinting.listPrinters(request.auth.identityId, organizationId, unitId);
  }

  @Post("production-printers/connection-probes")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(productionPrinterConnectionProbeInputSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterConnectionProbeResponseSchema) })
  probePrinterConnection(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(productionPrinterConnectionProbeInputSchema))
    body: ProductionPrinterConnectionProbeInput,
  ) {
    return this.productionPrinting.probePrinterConnection(
      request.auth.identityId,
      organizationId,
      unitId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Get("production-printers/connection-probes/:commandId")
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterConnectionProbeStatusSchema) })
  printerConnectionProbeStatus(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("commandId", ParseUUIDPipe) commandId: string,
  ) {
    return this.productionPrinting.printerConnectionProbeStatus(
      request.auth.identityId,
      organizationId,
      unitId,
      commandId,
    );
  }

  @Post("production-printers")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(createProductionPrinterSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterMutationResponseSchema) })
  createPrinter(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(createProductionPrinterSchema)) body: CreateProductionPrinterInput,
  ) {
    return this.productionPrinting.createPrinter(
      request.auth.identityId,
      organizationId,
      unitId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Put("production-printers/:printerId")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(updateProductionPrinterSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterMutationResponseSchema) })
  updatePrinter(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printerId", ParseUUIDPipe) printerId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(updateProductionPrinterSchema)) body: UpdateProductionPrinterInput,
  ) {
    return this.productionPrinting.updatePrinter(
      request.auth.identityId,
      organizationId,
      unitId,
      printerId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Delete("production-printers/:printerId")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(productionPrinterRevisionSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterMutationResponseSchema) })
  archivePrinter(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printerId", ParseUUIDPipe) printerId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(productionPrinterRevisionSchema)) body: ProductionPrinterRevisionInput,
  ) {
    return this.productionPrinting.archivePrinter(
      request.auth.identityId,
      organizationId,
      unitId,
      printerId,
      this.idempotencyKey(rawIdempotencyKey),
      body.revision,
    );
  }

  @Post("production-printers/:printerId/test")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(productionPrinterRevisionSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrinterTestResponseSchema) })
  testPrinter(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printerId", ParseUUIDPipe) printerId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(productionPrinterRevisionSchema)) body: ProductionPrinterRevisionInput,
  ) {
    return this.productionPrinting.testPrinter(
      request.auth.identityId,
      organizationId,
      unitId,
      printerId,
      this.idempotencyKey(rawIdempotencyKey),
      body.revision,
    );
  }

  @Get("production-printing/stations")
  @ApiOkResponse({ schema: toOpenApiSchema(productionStationListResponseSchema) })
  listStationPolicies(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.productionPrinting.listStations(request.auth.identityId, organizationId, unitId);
  }

  @Put("production-printing/stations/:stationId/policy")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(productionPrintPolicyInputSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionStationMutationResponseSchema) })
  updateStationPolicy(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("stationId", ParseUUIDPipe) stationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(productionPrintPolicyInputSchema)) body: ProductionPrintPolicyInput,
  ) {
    return this.productionPrinting.updateStationPolicy(
      request.auth.identityId,
      organizationId,
      unitId,
      stationId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Post("kds/:ticketId/print-jobs")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(manualKdsTicketPrintSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrintJobMutationResponseSchema) })
  printKdsTicket(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(manualKdsTicketPrintSchema)) body: ManualKdsTicketPrintInput,
  ) {
    return this.pos.requestKdsTicketPrint(
      request.auth.identityId,
      organizationId,
      unitId,
      ticketId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  @Post("production-print-jobs/:printJobId/resolve-unknown")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ schema: toOpenApiSchema(resolveUnknownProductionPrintJobSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productionPrintJobMutationResponseSchema) })
  resolveUnknownPrintJob(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("printJobId", ParseUUIDPipe) printJobId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(resolveUnknownProductionPrintJobSchema))
    body: ResolveUnknownProductionPrintJobInput,
  ) {
    return this.productionPrinting.resolveUnknownPrintJob(
      request.auth.identityId,
      organizationId,
      unitId,
      printJobId,
      this.idempotencyKey(rawIdempotencyKey),
      body,
    );
  }

  private idempotencyKey(raw: string | undefined) {
    return new ZodPipe(idempotencyKeySchema).transform(raw) as string;
  }
}
