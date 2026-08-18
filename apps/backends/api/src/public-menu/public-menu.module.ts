import { Module } from "@nestjs/common";
import { SyncModule } from "../sync/sync.module.js";
import { PublicMediaController } from "./public-media.controller.js";
import { PublicMenuController } from "./public-menu.controller.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";

@Module({
  imports: [SyncModule],
  controllers: [PublicMenuController, PublicMediaController],
  providers: [PublicMenuService, PublicOrderService],
})
export class PublicMenuModule {}
