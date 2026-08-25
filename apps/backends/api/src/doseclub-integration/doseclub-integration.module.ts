import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { DoseClubIntegrationController } from "./doseclub-integration.controller.js";
import { DoseClubIntegrationService } from "./doseclub-integration.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [DoseClubIntegrationController],
  providers: [DoseClubIntegrationService],
  exports: [DoseClubIntegrationService],
})
export class DoseClubIntegrationModule {}
