import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { FiscalController } from "./fiscal.controller.js";
import { FiscalService } from "./fiscal.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [FiscalController],
  providers: [FiscalService],
  exports: [FiscalService],
})
export class FiscalModule {}
