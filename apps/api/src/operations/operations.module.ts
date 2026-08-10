import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { OperationsController } from "./operations.controller.js";
import { OperationsService } from "./operations.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
