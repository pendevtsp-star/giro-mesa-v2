import { Module } from "@nestjs/common";
import { PilotOperationsModule } from "../pilot-operations/pilot-operations.module.js";
import { PublicMediaController } from "./public-media.controller.js";
import { PublicMenuController } from "./public-menu.controller.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";
import { PublicTableService } from "./public-table.service.js";

@Module({
  imports: [PilotOperationsModule],
  controllers: [PublicMenuController, PublicMediaController],
  providers: [PublicMenuService, PublicOrderService, PublicTableService],
})
export class PublicMenuModule {}
