import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
