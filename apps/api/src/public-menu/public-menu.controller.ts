import {
  idempotencyKeySchema,
  type PublicMenuCommandInput,
  type PublicOrderInput,
  publicMenuCommandSchema,
  publicMenuSlugSchema,
  publicOrderSchema,
} from "@giromesa/contracts";
import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod.pipe.js";
import { DatabaseContext } from "../database/database-context.decorator.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";

@DatabaseContext("public-menu")
@Controller(["api/v1/public/menus", "public/v1/menus"])
export class PublicMenuController {
  constructor(
    private readonly publicMenuService: PublicMenuService,
    private readonly publicOrderService: PublicOrderService,
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
  command(
    @Param("slug", new ZodPipe(publicMenuSlugSchema)) slug: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new ZodPipe(publicMenuCommandSchema)) body: PublicMenuCommandInput,
  ) {
    const idempotencyKey = new ZodPipe(idempotencyKeySchema).transform(rawIdempotencyKey) as string;
    return this.publicMenuService.command(slug, idempotencyKey, body);
  }
}
