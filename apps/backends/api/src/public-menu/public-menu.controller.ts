import {
  idempotencyKeySchema,
  type PublicMenuCommandInput,
  type PublicOrderInput,
  type PublicTableOrderInput,
  type PublicTableSessionRequest,
  publicMenuCommandResponseSchema,
  publicMenuCommandSchema,
  publicMenuSlugSchema,
  publicOrderSchema,
  publicTableConsumptionResponseSchema,
  publicTableOrderResponseSchema,
  publicTableOrderSchema,
  publicTableSessionRequestSchema,
  publicTableSessionResponseSchema,
} from "@giromesa/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiHeader, ApiOkResponse } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";
import { PublicTableService } from "./public-table.service.js";
import { TABLE_SESSION_COOKIE_NAME } from "./table-session-token.js";

@Controller(["api/v1/public/menus", "public/v1/menus"])
export class PublicMenuController {
  constructor(
    private readonly publicMenuService: PublicMenuService,
    private readonly publicOrderService: PublicOrderService,
    private readonly publicTableService: PublicTableService,
  ) {}

  @Get(":slug")
  menu(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicMenuService.menu(slug);
  }

  @Get(":slug/hub-status")
  hubStatus(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicMenuService.hubStatus(slug);
  }

  @Get(":slug/order-options")
  orderOptions(@Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string) {
    return this.publicOrderService.options(slug);
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
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiHeader({ name: "X-GiroMesa-Table-Token", required: false })
  @ApiOkResponse({ schema: toOpenApiSchema(publicMenuCommandResponseSchema) })
  command(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Headers("x-giromesa-table-token") tableToken: string | undefined,
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(publicMenuCommandSchema)) body: PublicMenuCommandInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.publicTableService.command(
      slug,
      idempotencyKey,
      tableToken,
      request.cookies[TABLE_SESSION_COOKIE_NAME],
      body,
    );
  }

  @Post(":slug/table-session")
  @ApiHeader({ name: "X-GiroMesa-Table-Token", required: true })
  @ApiOkResponse({ schema: toOpenApiSchema(publicTableSessionResponseSchema) })
  async tableSession(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("x-giromesa-table-token") tableToken: string | undefined,
    @Body(new ZodPipe(publicTableSessionRequestSchema)) body: PublicTableSessionRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.publicTableService.openSession(slug, tableToken, body);
    reply.setCookie(TABLE_SESSION_COOKIE_NAME, result.token, result.cookieOptions);
    return result.response;
  }

  @Get(":slug/table-session")
  @ApiOkResponse({ schema: toOpenApiSchema(publicTableSessionResponseSchema) })
  async tableSessionStatus(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.publicTableService.status(
      slug,
      request.cookies[TABLE_SESSION_COOKIE_NAME],
    );
    if (result.token && result.cookieOptions) {
      reply.setCookie(TABLE_SESSION_COOKIE_NAME, result.token, result.cookieOptions);
    }
    return result.response;
  }

  @Get(":slug/consumption")
  @ApiOkResponse({ schema: toOpenApiSchema(publicTableConsumptionResponseSchema) })
  consumption(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Req() request: FastifyRequest,
  ) {
    return this.publicTableService.consumption(slug, request.cookies[TABLE_SESSION_COOKIE_NAME]);
  }

  @Post(":slug/table-orders")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiOkResponse({ schema: toOpenApiSchema(publicTableOrderResponseSchema) })
  tableOrder(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(publicTableOrderSchema)) body: PublicTableOrderInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.publicTableService.createOrder(
      slug,
      request.cookies[TABLE_SESSION_COOKIE_NAME],
      idempotencyKey,
      body,
    );
  }

  @Get(":slug/table-orders/:orderId")
  @ApiOkResponse({ schema: toOpenApiSchema(publicTableOrderResponseSchema) })
  tableOrderStatus(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.publicTableService.order(slug, request.cookies[TABLE_SESSION_COOKIE_NAME], orderId);
  }
}
