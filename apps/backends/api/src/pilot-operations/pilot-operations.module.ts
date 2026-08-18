import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { PilotCatalogController } from "./pilot-catalog.controller.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import { PilotPosController } from "./pilot-pos.controller.js";
import { PilotPosService } from "./pilot-pos.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PilotCatalogController, PilotPosController],
  providers: [PilotCatalogService, PilotPosService],
  exports: [PilotCatalogService, PilotPosService],
})
export class PilotOperationsModule {}
