import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import {
  GrowthController,
  GrowthPublicApiController,
  GrowthPublicController,
  GrowthPublicMenuController,
} from "./growth.controller.js";
import { GrowthService } from "./growth.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [
    GrowthController,
    GrowthPublicController,
    GrowthPublicMenuController,
    GrowthPublicApiController,
  ],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
