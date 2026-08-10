import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ManagementController } from "./management.controller.js";
import { ManagementService } from "./management.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ManagementController],
  providers: [ManagementService],
})
export class ManagementModule {}
