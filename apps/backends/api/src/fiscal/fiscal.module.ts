import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { FiscalController } from "./fiscal.controller.js";
import { FiscalService } from "./fiscal.service.js";
import { FocusNfeClient } from "./focus-nfe.client.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [FiscalController],
  providers: [FiscalService, FocusNfeClient],
  exports: [FiscalService],
})
export class FiscalModule {}
