import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from "@nestjs/swagger";
import { z } from "zod";
import { ZodPipe } from "../../common/zod.pipe.js";
import { DatabaseContext } from "../../database/database-context.decorator.js";
import {
  doseClubConsumptionWireSchema,
  doseClubReversalWireSchema,
  doseClubSaleWireSchema,
  doseClubV1ConsumptionSchema,
  doseClubV1ReversalSchema,
  doseClubV1SaleSchema,
  doseClubV2ConsumptionSchema,
  doseClubV2OperationSchema,
  doseClubV2ReconcileSchema,
  doseClubV2ReservationSchema,
  doseClubV2ReversalSchema,
  doseClubV2SaleSchema,
} from "./doseclub.schemas.js";
import { DoseClubService } from "./doseclub.service.js";

class DoseClubV2AcknowledgementDto {
  @ApiProperty({ format: "date-time" })
  acknowledgedAt!: string;

  @ApiProperty({ enum: ["v2"] })
  contractVersion!: "v2";

  @ApiProperty()
  externalClubId!: string;

  @ApiProperty()
  operationId!: string;

  @ApiProperty({ enum: ["accepted", "duplicate", "reconciled"] })
  outcome!: "accepted" | "duplicate" | "reconciled";

  @ApiProperty({ format: "int32", minimum: 1 })
  version!: number;
}

class DoseClubV1AcknowledgementDto {
  @ApiProperty({ enum: ["v1"] })
  contractVersion!: "v1";

  @ApiProperty()
  externalClubId!: string;

  @ApiProperty({ required: false })
  operationId?: string;

  @ApiProperty({ enum: ["accepted", "duplicate"] })
  outcome!: "accepted" | "duplicate";

  @ApiProperty({ enum: ["ok"] })
  status!: "ok";
}

const negotiatedAcknowledgementSchema = {
  oneOf: [
    { $ref: getSchemaPath(DoseClubV1AcknowledgementDto) },
    { $ref: getSchemaPath(DoseClubV2AcknowledgementDto) },
  ],
  discriminator: {
    propertyName: "contractVersion",
    mapping: {
      v1: getSchemaPath(DoseClubV1AcknowledgementDto),
      v2: getSchemaPath(DoseClubV2AcknowledgementDto),
    },
  },
};

class DoseClubBranchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: "uuid" })
  unitId!: string;
}

class DoseClubBranchListDto {
  @ApiProperty({ type: [DoseClubBranchDto] })
  branches!: DoseClubBranchDto[];
}

class DoseClubProductDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, required: true })
  sku!: string | null;
}

class DoseClubProductListDto {
  @ApiProperty({ type: [DoseClubProductDto] })
  products!: DoseClubProductDto[];
}

class DoseClubStockDto {
  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ example: "1000.000000", pattern: "^-?[0-9]+\\.[0-9]{6}$" })
  quantity!: string;

  @ApiProperty({ enum: ["ml"] })
  unit!: string;
}

function invalidContract(): never {
  throw new BadRequestException({
    statusCode: 400,
    code: "DOSECLUB_CONTRACT_INVALID",
    message: "O contrato da integracao DoseClub e invalido.",
  });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalidContract();
  return result.data;
}

@ApiTags("DoseClub integration")
@ApiHeader({ name: "x-giromesa-integration-key", required: true })
@ApiUnauthorizedResponse({ description: "Integration key or scope is invalid." })
@ApiBadRequestResponse({ description: "The request does not satisfy the negotiated contract." })
@ApiConflictResponse({ description: "The operation conflicts with the authoritative state." })
@ApiExtraModels(DoseClubV1AcknowledgementDto, DoseClubV2AcknowledgementDto)
@DatabaseContext("doseclub")
@Controller(["api/v1/integrations/club-whisky", "v1/integrations/club-whisky"])
export class DoseClubController {
  constructor(private readonly doseClub: DoseClubService) {}

  @Get("branches")
  @ApiOperation({ summary: "List GiroMesa branches enabled for DoseClub" })
  @ApiOkResponse({ type: DoseClubBranchListDto })
  listBranches() {
    return this.doseClub.listBranches();
  }

  @Get("products")
  @ApiOperation({ summary: "List active GiroMesa products" })
  @ApiOkResponse({ type: DoseClubProductListDto })
  listProducts() {
    return this.doseClub.listProducts();
  }

  @Get("stock")
  @ApiOperation({ summary: "Read mapped stock for a DoseClub branch" })
  @ApiOkResponse({ type: DoseClubStockDto })
  stock(
    @Query("productId") productId: string | undefined,
    @Query("branchId") branchId: string | undefined,
  ) {
    if (
      !productId?.trim() ||
      productId.length > 180 ||
      !branchId?.trim() ||
      branchId.length > 180
    ) {
      invalidContract();
    }
    return this.doseClub.stock(productId.trim(), branchId.trim());
  }

  @Post("sales")
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: "x-giromesa-contract-version", required: false, enum: ["2"] })
  @ApiOkResponse({ schema: negotiatedAcknowledgementSchema })
  sale(
    @Headers("x-giromesa-contract-version") version: string | undefined,
    @Body(
      new ZodPipe(
        z.union([doseClubV1SaleSchema, doseClubV2SaleSchema]),
        undefined,
        doseClubSaleWireSchema,
      ),
    )
    body: unknown,
  ) {
    if (version === "2") {
      const operation = parse(doseClubV2OperationSchema, body);
      if (operation.operation !== "sale") invalidContract();
      return this.doseClub.receiveV2(operation);
    }
    if (version !== undefined) invalidContract();
    return this.doseClub.receiveV1Sale(parse(doseClubV1SaleSchema, body));
  }

  @Post("reservations")
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: "x-giromesa-contract-version", required: true, enum: ["2"] })
  @ApiOkResponse({ type: DoseClubV2AcknowledgementDto })
  reservation(
    @Headers("x-giromesa-contract-version") version: string | undefined,
    @Body(new ZodPipe(doseClubV2ReservationSchema)) body: unknown,
  ) {
    return this.v2(version, body, "reservation");
  }

  @Post("dose-consumptions")
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: "x-giromesa-contract-version", required: false, enum: ["2"] })
  @ApiOkResponse({ schema: negotiatedAcknowledgementSchema })
  consumption(
    @Headers("x-giromesa-contract-version") version: string | undefined,
    @Body(
      new ZodPipe(
        z.union([doseClubV1ConsumptionSchema, doseClubV2ConsumptionSchema]),
        undefined,
        doseClubConsumptionWireSchema,
      ),
    )
    body: unknown,
  ) {
    if (version === "2") return this.v2(version, body, "consumption");
    if (version !== undefined) invalidContract();
    return this.doseClub.receiveV1Consumption(parse(doseClubV1ConsumptionSchema, body));
  }

  @Post("dose-consumptions/reversals")
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: "x-giromesa-contract-version", required: false, enum: ["2"] })
  @ApiOkResponse({ schema: negotiatedAcknowledgementSchema })
  reversal(
    @Headers("x-giromesa-contract-version") version: string | undefined,
    @Body(
      new ZodPipe(
        z.union([doseClubV1ReversalSchema, doseClubV2ReversalSchema]),
        undefined,
        doseClubReversalWireSchema,
      ),
    )
    body: unknown,
  ) {
    if (version === "2") return this.v2(version, body, "reversal");
    if (version !== undefined) invalidContract();
    return this.doseClub.receiveV1Reversal(parse(doseClubV1ReversalSchema, body));
  }

  @Post("reconcile")
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: "x-giromesa-contract-version", required: true, enum: ["2"] })
  @ApiOkResponse({ type: DoseClubV2AcknowledgementDto })
  reconcile(
    @Headers("x-giromesa-contract-version") version: string | undefined,
    @Body(new ZodPipe(doseClubV2ReconcileSchema)) body: unknown,
  ) {
    return this.v2(version, body, "reconcile");
  }

  private v2(
    version: string | undefined,
    body: unknown,
    expected: "reservation" | "consumption" | "reversal" | "reconcile",
  ) {
    if (version !== "2") invalidContract();
    const operation = parse(doseClubV2OperationSchema, body);
    if (operation.operation !== expected) invalidContract();
    return this.doseClub.receiveV2(operation);
  }
}
