import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";
import { PlatformCommercialService } from "./platform-commercial.service.js";
import { PlatformControlService } from "./platform-control.service.js";
import { PlatformInvitationController } from "./platform-invitation.controller.js";
import { PlatformTeamService } from "./platform-team.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController, PlatformInvitationController],
  providers: [
    PlatformService,
    PlatformControlService,
    PlatformCommercialService,
    PlatformAdminGuard,
    PlatformTeamService,
  ],
})
export class PlatformModule {}
