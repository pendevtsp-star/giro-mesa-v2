import {
  type CreateTableQrPrintBatchInput,
  createTableQrPrintBatchSchema,
  idempotencyKeySchema,
  markTableQrPrintBatchPrintedSchema,
  type TestTableQrUrlInput,
  testTableQrUrlSchema,
  type UpdateTableQrSettingsInput,
  updateTableQrSettingsSchema,
} from "@giromesa/contracts";
import {
  type ArgumentsHost,
  Body,
  Catch,
  ConflictException,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiHeader } from "@nestjs/swagger";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { type AuthenticatedRequest, SessionGuard } from "../auth/session.guard.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import {
  type AggregateProductInput,
  type AllergenInput,
  type AnalyticsQueryInput,
  aggregateProductSchema,
  allergenSchema,
  analyticsQuerySchema,
  type BrandingInput,
  type BulkPriceInput,
  brandingSchema,
  bulkPriceSchema,
  type CategoryAvailabilityInput,
  type CategoryInput,
  type ComboInput,
  categoryAvailabilitySchema,
  categorySchema,
  comboSchema,
  type DailyStockInput,
  dailyStockSchema,
  type ImportCatalogInput,
  importCatalogSchema,
  type MediaUploadInput,
  type ModifierGroupInput,
  type ModifierOptionInput,
  mediaUploadSchema,
  modifierGroupSchema,
  modifierOptionSchema,
  type ProductInput,
  type ProductUnitConfigInput,
  type PromotionInput,
  type PublicationInput,
  productSchema,
  productUnitConfigSchema,
  promotionSchema,
  publicationSchema,
  type ReorderInput,
  reorderSchema,
  type StationInput,
  stationSchema,
  type UpdateAllergenInput,
  type UpdateCategoryInput,
  type UpdateModifierGroupInput,
  type UpdateModifierOptionInput,
  type UpdateProductInput,
  type UpdatePromotionInput,
  type UpdateStationInput,
  updateAllergenSchema,
  updateCategorySchema,
  updateModifierGroupSchema,
  updateModifierOptionSchema,
  updateProductSchema,
  updatePromotionSchema,
  updateStationSchema,
} from "./pilot-schemas.js";

@Catch(DrizzleQueryError)
class CatalogConflictFilter implements ExceptionFilter {
  catch(exception: DrizzleQueryError, host: ArgumentsHost) {
    const cause = exception.cause;
    if (!(cause && "code" in cause && cause.code === "23505")) throw exception;
    const conflict = new ConflictException({
      code: "CATALOG_CONFLICT",
      message: "Já existe um registro de catálogo com esses dados.",
    });
    const response = host.switchToHttp().getResponse<{
      status(code: number): { send(body: unknown): void };
    }>();
    response.status(conflict.getStatus()).send(conflict.getResponse());
  }
}

@UseGuards(SessionGuard)
@UseFilters(new CatalogConflictFilter())
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
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(categorySchema)) body: CategoryInput,
  ) {
    return this.catalog.createCategory(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Put("categories/:categoryId")
  updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("categoryId", ParseUUIDPipe) categoryId: string,
    @Body(new ZodPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.catalog.updateCategory(
      request.auth.identityId,
      organizationId,
      unitId,
      categoryId,
      body,
    );
  }

  @Delete("categories/:categoryId")
  archiveCategory(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("categoryId", ParseUUIDPipe) categoryId: string,
  ) {
    return this.catalog.archiveCategory(
      request.auth.identityId,
      organizationId,
      unitId,
      categoryId,
    );
  }

  @Post("combos")
  createCombo(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(comboSchema)) body: ComboInput,
  ) {
    return this.catalog.createCombo(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("allergens")
  createAllergen(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(allergenSchema)) body: AllergenInput,
  ) {
    return this.catalog.createAllergen(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("modifier-groups")
  createModifierGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(modifierGroupSchema)) body: ModifierGroupInput,
  ) {
    return this.catalog.createModifierGroup(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("stations")
  createStation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(stationSchema)) body: StationInput,
  ) {
    return this.catalog.createStation(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("products")
  createProduct(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body(new ZodPipe(productSchema)) body: ProductInput,
  ) {
    return this.catalog.createProduct(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
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

  @Put("products/:productId")
  updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body(new ZodPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.catalog.updateProduct(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      body,
    );
  }

  @Delete("products/:productId")
  archiveProduct(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
  ) {
    return this.catalog.archiveProduct(request.auth.identityId, organizationId, unitId, productId);
  }

  @Put("products/:productId/aggregate")
  updateProductAggregate(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body(new ZodPipe(aggregateProductSchema)) body: AggregateProductInput,
  ) {
    return this.catalog.updateProductAggregate(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      body,
    );
  }

  @Put("categories/reorder")
  reorderCategories(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(reorderSchema)) body: ReorderInput,
  ) {
    return this.catalog.reorderCategories(request.auth.identityId, organizationId, unitId, body);
  }

  @Put("products/reorder")
  reorderProducts(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(reorderSchema)) body: ReorderInput,
  ) {
    return this.catalog.reorderProducts(request.auth.identityId, organizationId, unitId, body);
  }

  @Put("categories/:categoryId/availability")
  setCategoryAvailability(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("categoryId", ParseUUIDPipe) categoryId: string,
    @Body(new ZodPipe(categoryAvailabilitySchema)) body: CategoryAvailabilityInput,
  ) {
    return this.catalog.setCategoryAvailability(
      request.auth.identityId,
      organizationId,
      unitId,
      categoryId,
      body,
    );
  }

  @Post("prices/bulk")
  bulkPrices(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodPipe(bulkPriceSchema)) body: BulkPriceInput,
  ) {
    return this.catalog.bulkUpdatePrices(
      request.auth.identityId,
      organizationId,
      unitId,
      key,
      body,
    );
  }

  @Put("allergens/:allergenId")
  updateAllergen(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("allergenId", ParseUUIDPipe) allergenId: string,
    @Body(new ZodPipe(updateAllergenSchema)) body: UpdateAllergenInput,
  ) {
    return this.catalog.updateAllergen(
      request.auth.identityId,
      organizationId,
      unitId,
      allergenId,
      body,
    );
  }

  @Delete("allergens/:allergenId")
  archiveAllergen(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("allergenId", ParseUUIDPipe) allergenId: string,
  ) {
    return this.catalog.archiveAllergen(
      request.auth.identityId,
      organizationId,
      unitId,
      allergenId,
    );
  }

  @Put("stations/:stationId")
  updateStation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("stationId", ParseUUIDPipe) stationId: string,
    @Body(new ZodPipe(updateStationSchema)) body: UpdateStationInput,
  ) {
    return this.catalog.updateStation(
      request.auth.identityId,
      organizationId,
      unitId,
      stationId,
      body,
    );
  }

  @Delete("stations/:stationId")
  archiveStation(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("stationId", ParseUUIDPipe) stationId: string,
  ) {
    return this.catalog.archiveStation(request.auth.identityId, organizationId, unitId, stationId);
  }

  @Put("modifier-groups/:groupId")
  updateModifierGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Body(new ZodPipe(updateModifierGroupSchema)) body: UpdateModifierGroupInput,
  ) {
    return this.catalog.updateModifierGroup(
      request.auth.identityId,
      organizationId,
      unitId,
      groupId,
      body,
    );
  }

  @Delete("modifier-groups/:groupId")
  archiveModifierGroup(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
  ) {
    return this.catalog.archiveModifierGroup(
      request.auth.identityId,
      organizationId,
      unitId,
      groupId,
    );
  }

  @Post("modifier-groups/:groupId/options")
  createModifierOption(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodPipe(modifierOptionSchema)) body: ModifierOptionInput,
  ) {
    return this.catalog.createModifierOption(
      request.auth.identityId,
      organizationId,
      unitId,
      groupId,
      key,
      body,
    );
  }

  @Put("modifier-options/:optionId")
  updateModifierOption(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("optionId", ParseUUIDPipe) optionId: string,
    @Body(new ZodPipe(updateModifierOptionSchema)) body: UpdateModifierOptionInput,
  ) {
    return this.catalog.updateModifierOption(
      request.auth.identityId,
      organizationId,
      unitId,
      optionId,
      body,
    );
  }

  @Delete("modifier-options/:optionId")
  archiveModifierOption(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("optionId", ParseUUIDPipe) optionId: string,
  ) {
    return this.catalog.archiveModifierOption(
      request.auth.identityId,
      organizationId,
      unitId,
      optionId,
    );
  }

  @Put("combos/:comboId")
  updateCombo(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("comboId", ParseUUIDPipe) comboId: string,
    @Body(new ZodPipe(comboSchema)) body: ComboInput,
  ) {
    return this.catalog.updateCombo(request.auth.identityId, organizationId, unitId, comboId, body);
  }

  @Delete("combos/:comboId")
  archiveCombo(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("comboId", ParseUUIDPipe) comboId: string,
  ) {
    return this.catalog.archiveCombo(request.auth.identityId, organizationId, unitId, comboId);
  }

  @Post("promotions")
  createPromotion(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodPipe(promotionSchema)) body: PromotionInput,
  ) {
    return this.catalog.createPromotion(request.auth.identityId, organizationId, unitId, key, body);
  }

  @Put("promotions/:promotionId")
  updatePromotion(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("promotionId", ParseUUIDPipe) promotionId: string,
    @Body(new ZodPipe(updatePromotionSchema)) body: UpdatePromotionInput,
  ) {
    return this.catalog.updatePromotion(
      request.auth.identityId,
      organizationId,
      unitId,
      promotionId,
      body,
    );
  }

  @Delete("promotions/:promotionId")
  archivePromotion(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("promotionId", ParseUUIDPipe) promotionId: string,
  ) {
    return this.catalog.archivePromotion(
      request.auth.identityId,
      organizationId,
      unitId,
      promotionId,
    );
  }

  @Get("branding")
  getBranding(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.getBranding(request.auth.identityId, organizationId, unitId);
  }

  @Put("branding")
  updateBranding(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(brandingSchema)) body: BrandingInput,
  ) {
    return this.catalog.updateBranding(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("import")
  importCatalog(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodPipe(importCatalogSchema)) body: ImportCatalogInput,
  ) {
    return this.catalog.importCatalog(request.auth.identityId, organizationId, unitId, key, body);
  }

  @Get("publication")
  getPublication(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.getPublication(request.auth.identityId, organizationId, unitId);
  }

  @Put("publication")
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") key: string,
    @Body(new ZodPipe(publicationSchema)) body: PublicationInput,
  ) {
    return this.catalog.publish(request.auth.identityId, organizationId, unitId, key, body);
  }

  @Get("analytics/bcg")
  analyticsBcg(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Query(new ZodPipe(analyticsQuerySchema)) query: AnalyticsQueryInput,
  ) {
    return this.catalog.analyticsBcg(request.auth.identityId, organizationId, unitId, query);
  }

  @Post("media")
  uploadMedia(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(mediaUploadSchema)) body: MediaUploadInput,
  ) {
    return this.catalog.uploadMedia(request.auth.identityId, organizationId, unitId, body);
  }

  @Delete("media/:key")
  deleteMedia(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("key") key: string,
  ) {
    return this.catalog.deleteMedia(request.auth.identityId, organizationId, unitId, key);
  }

  @Put("products/:productId/daily-stock")
  setDailyStock(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body(new ZodPipe(dailyStockSchema)) body: DailyStockInput,
  ) {
    return this.catalog.setDailyStock(
      request.auth.identityId,
      organizationId,
      unitId,
      productId,
      body,
    );
  }

  @Get("tables/qr")
  tableQr(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.listTableQr(request.auth.identityId, organizationId, unitId);
  }

  @Get("tables/qr/settings")
  tableQrSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.getTableQrSettings(request.auth.identityId, organizationId, unitId);
  }

  @Put("tables/qr/settings")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  updateTableQrSettings(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(updateTableQrSettingsSchema)) body: UpdateTableQrSettingsInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.catalog.updateTableQrSettings(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Get("tables/qr/lifecycle")
  tableQrLifecycle(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
  ) {
    return this.catalog.tableQrLifecycle(request.auth.identityId, organizationId, unitId);
  }

  @Post("tables/qr/print-batches")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  createTableQrPrintBatch(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(createTableQrPrintBatchSchema)) body: CreateTableQrPrintBatchInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.catalog.createTableQrPrintBatch(
      request.auth.identityId,
      organizationId,
      unitId,
      idempotencyKey,
      body,
    );
  }

  @Post("tables/qr/print-batches/:batchId/printed")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  markTableQrPrintBatchPrinted(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("batchId", ParseUUIDPipe) batchId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(markTableQrPrintBatchPrintedSchema)) _body: Record<string, never>,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.catalog.markTableQrPrintBatchPrinted(
      request.auth.identityId,
      organizationId,
      unitId,
      batchId,
      idempotencyKey,
    );
  }

  @Post("tables/qr/test")
  testTableQrUrl(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Body(new ZodPipe(testTableQrUrlSchema)) body: TestTableQrUrlInput,
  ) {
    return this.catalog.testTableQrUrl(request.auth.identityId, organizationId, unitId, body);
  }

  @Post("tables/:tableId/qr/rotate")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  rotateTableQr(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.catalog.rotateTableQr(
      request.auth.identityId,
      organizationId,
      unitId,
      tableId,
      idempotencyKey,
    );
  }
}
