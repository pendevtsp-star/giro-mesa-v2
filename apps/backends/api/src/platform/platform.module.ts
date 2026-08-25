import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";
import { PlatformCommercialService } from "./platform-commercial.service.js";
import { PlatformControlService } from "./platform-control.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [
    PlatformService,
    PlatformControlService,
    PlatformCommercialService,
    PlatformAdminGuard,
  ],
})
export class PlatformModule {}
