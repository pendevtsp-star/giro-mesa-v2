import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { SimulatorPaymentAdapter } from "./adapters/simulator.adapter.js";
import { PaymentCallbacksController, PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [PaymentsController, PaymentCallbacksController],
  providers: [SimulatorPaymentAdapter, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
