import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SalonController } from "./salon.controller.js";
import { SalonService } from "./salon.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [SalonController],
  providers: [SalonService],
})
export class SalonModule {}
