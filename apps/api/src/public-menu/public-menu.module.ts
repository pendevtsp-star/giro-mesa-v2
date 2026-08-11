import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SyncModule } from "../sync/sync.module.js";
import { PublicMenuAdminController, PublicMenuController } from "./public-menu.controller.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule, SyncModule],
  controllers: [PublicMenuController, PublicMenuAdminController],
  providers: [PublicMenuService, PublicOrderService],
})
export class PublicMenuModule {}
