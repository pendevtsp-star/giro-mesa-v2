import {
  idempotencyKeySchema,
  type PublicMenuCommandInput,
  type PublicOrderInput,
  publicMenuCommandSchema,
  publicMenuSlugSchema,
  publicOrderSchema,
} from "@giromesa/contracts";
import { z } from "zod";
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
import { DatabaseContext } from "../database/database-context.decorator.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";
import { TableSessionService } from "./table-session.js";

const publicMenuDraftSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  branding: z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500),
    primaryColor: z.string().max(7),
    surfaceColor: z.string().max(7),
    textColor: z.string().max(7),
    logoAssetId: z.uuid().nullable(),
    coverAssetId: z.uuid().nullable(),
  }),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        category: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(500),
        priceCents: z.number().int().nonnegative(),
        available: z.boolean(),
        imageAssetId: z.uuid().nullable(),
        tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
        modifierGroups: z
          .array(
            z.object({
              id: z.string().min(1).max(100),
              name: z.string().trim().min(1).max(120),
              required: z.boolean(),
              maxSelections: z.number().int().min(1).max(20),
              options: z
                .array(
                  z.object({
                    id: z.string().min(1).max(100),
                    name: z.string().trim().min(1).max(120),
                    priceCents: z.number().int().nonnegative(),
                  }),
                )
                .max(50),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .max(500),
});

const expectedVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() });
const publishSchema = z.object({ expectedPublishEpoch: z.number().int().nonnegative() });
const tableSessionSchema = z.object({ qrToken: z.string().min(40).max(2_048) });

@DatabaseContext("public-menu")
@Controller(["api/v1/public/menus", "public/v1/menus"])
export class PublicMenuController {
  constructor(
    private readonly publicMenuService: PublicMenuService,
    private readonly publicOrderService: PublicOrderService,
    private readonly tableSessionService: TableSessionService,
  ) {}

  @Get(":slug")
  menu(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicMenuService.menu(slug);
  }

  @Get(":slug/preview")
  preview(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Query("token") token: string,
  ) {
    return this.publicMenuService.preview(slug, token);
  }

  @Get(":slug/hub-status")
  hubStatus(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicMenuService.hubStatus(slug);
  }

  @Get(":slug/order-options")
  orderOptions(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicOrderService.options(slug);
  }

  @Post(":slug/table-session")
  tableSession(
    @Req() request: { ip?: string },
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Body(new ZodPipe(tableSessionSchema)) body: z.infer<typeof tableSessionSchema>,
  ) {
    return this.tableSessionService.issue(slug, body.qrToken, request.ip ?? "unknown");
  }

  @Post(":slug/orders")
  placeOrder(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(publicOrderSchema)) body: PublicOrderInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.publicOrderService.place(slug, idempotencyKey, body);
  }

  @Post(":slug/commands")
  command(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(publicMenuCommandSchema)) body: PublicMenuCommandInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.publicMenuService.command(slug, idempotencyKey, body);
  }
}

@UseGuards(SessionGuard)
@Controller([
  "api/v1/organizations/:organizationId/units/:unitId/public-menus",
  "v1/organizations/:organizationId/units/:unitId/public-menus",
])
export class PublicMenuAdminController {
  constructor(private readonly publicMenuService: PublicMenuService) {}

  @Post(":menuId/tables/:tableId/qr")
  tableQr(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
    @Param("tableId", ParseUUIDPipe) tableId: string,
  ) {
    return this.publicMenuService.issueTableQr(
      request.auth.identityId,
      organizationId,
      unitId,
      menuId,
      tableId,
    );
  }

  @Put(":menuId/draft")
  saveDraft(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
    @Body(new ZodPipe(publicMenuDraftSchema)) body: z.infer<typeof publicMenuDraftSchema>,
  ) {
    return this.publicMenuService.saveDraft(
      request.auth.identityId,
      organizationId,
      unitId,
      menuId,
      body,
    );
  }

  @Post(":menuId/preview")
  createPreview(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
    @Body(new ZodPipe(expectedVersionSchema)) body: z.infer<typeof expectedVersionSchema>,
  ) {
    return this.publicMenuService.createPreview(
      request.auth.identityId,
      organizationId,
      unitId,
      menuId,
      body.expectedVersion,
    );
  }

  @Post(":menuId/versions")
  createVersion(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
    @Body(new ZodPipe(expectedVersionSchema)) body: z.infer<typeof expectedVersionSchema>,
  ) {
    return this.publicMenuService.createVersion(
      request.auth.identityId,
      organizationId,
      unitId,
      menuId,
      body.expectedVersion,
    );
  }

  @Post(":menuId/versions/:versionId/publish")
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Body(new ZodPipe(publishSchema)) body: z.infer<typeof publishSchema>,
  ) {
    return this.publicMenuService.publish(
      request.auth.identityId,
      organizationId,
      unitId,
      menuId,
      versionId,
      body.expectedPublishEpoch,
    );
  }

  @Get(":menuId")
  menuForTenant(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("unitId", ParseUUIDPipe) unitId: string,
    @Param("menuId", ParseUUIDPipe) menuId: string,
  ) {
    return this.publicMenuService.menuForTenant(organizationId, unitId, menuId);
  }
}
