import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ManagementController } from "./management.controller.js";
import { ManagementService } from "./management.service.js";
import { RemunerationController } from "./remuneration.controller.js";
import { RemunerationService } from "./remuneration.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ManagementController, RemunerationController],
  providers: [ManagementService, RemunerationService],
  exports: [RemunerationService],
})
export class ManagementModule {}
