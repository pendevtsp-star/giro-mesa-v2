import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { AsaasWebhookGuard } from "./asaas-webhook.guard.js";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { InternalKeyGuard } from "./internal-key.guard.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [BillingController],
  providers: [BillingService, InternalKeyGuard, AsaasWebhookGuard],
})
export class BillingModule {}
