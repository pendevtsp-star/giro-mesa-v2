import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SimulatorPaymentAdapter } from "./adapters/simulator.adapter.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PaymentsController],
  providers: [SimulatorPaymentAdapter, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
