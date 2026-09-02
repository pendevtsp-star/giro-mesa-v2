import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { EstablishmentSettingsService } from "./establishment-settings.service.js";
import {
  EdgeHubEnrollmentController,
  OrganizationsController,
} from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { ScopeService } from "./scope.service.js";

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, EdgeHubEnrollmentController],
  providers: [OrganizationsService, ScopeService, EstablishmentSettingsService],
  exports: [ScopeService, EstablishmentSettingsService],
})
export class OrganizationsModule {}
