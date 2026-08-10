import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import {
  type AllergenInput,
  allergenSchema,
  type CategoryInput,
  categorySchema,
  type ModifierGroupInput,
  modifierGroupSchema,
  type ProductInput,
  type ProductUnitConfigInput,
  productSchema,
  productUnitConfigSchema,
  type StationInput,
  stationSchema,
} from "./pilot-schemas.js";

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/pilot/catalog",
  "v1/organizations/:organizationId/units/:unitId/pilot/catalog",
])
export class PilotCatalogController {
  constructor(private readonly catalog: PilotCatalogService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.list(request.auth.identityId, organizationId, unitId);
  }

  @Post("categories")
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(categorySchema)) body: CategoryInput,
  ) {
    return this.catalog.createCategory(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("allergens")
  createAllergen(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(allergenSchema)) body: AllergenInput,
  ) {
    return this.catalog.createAllergen(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("modifier-groups")
  createModifierGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(modifierGroupSchema)) body: ModifierGroupInput,
  ) {
    return this.catalog.createModifierGroup(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("stations")
  createStation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(stationSchema)) body: StationInput,
  ) {
    return this.catalog.createStation(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("products")
  createProduct(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(productSchema)) body: ProductInput,
  ) {
    return this.catalog.createProduct(request.auth.identityId, organizationId, unitId, body);
  }

  @Put("products/:productId/unit-config")
  configureProduct(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body(new ZodPipe(productUnitConfigSchema)) body: ProductUnitConfigInput,
  ) {
    return this.catalog.updateProductUnitConfig(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      body,
    );
  }
}
