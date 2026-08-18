import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HealthModule } from "../health/health.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ManagementController } from "./management.controller.js";
import { ManagementService } from "./management.service.js";
import { ManagementOverviewService } from "./management-overview.service.js";
import { ManagementReportService } from "./management-report.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule, HealthModule],
  controllers: [ManagementController],
  providers: [ManagementService, ManagementOverviewService, ManagementReportService],
})
export class ManagementModule {}
