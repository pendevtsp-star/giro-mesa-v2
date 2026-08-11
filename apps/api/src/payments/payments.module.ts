import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [OrganizationsModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
