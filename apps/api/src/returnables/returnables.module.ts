import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { ReturnablesController } from "./returnables.controller.js";
import { ReturnablesService } from "./returnables.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ReturnablesController],
  providers: [ReturnablesService],
  exports: [ReturnablesService],
})
export class ReturnablesModule {}
