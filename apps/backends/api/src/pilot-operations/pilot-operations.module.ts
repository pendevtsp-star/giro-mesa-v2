import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InternalKeyGuard } from "../billing/internal-key.guard.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { PilotCatalogController } from "./pilot-catalog.controller.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import { PilotPaymentDeviceController } from "./pilot-payment-device.controller.js";
import { PilotPaymentInternalController } from "./pilot-payment-internal.controller.js";
import { PilotPosController } from "./pilot-pos.controller.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [
    PilotCatalogController,
    PilotPosController,
    PilotPaymentDeviceController,
    PilotPaymentInternalController,
  ],
  providers: [PilotCatalogService, PilotPosService, PilotSmartPosService, InternalKeyGuard],
  exports: [PilotCatalogService, PilotPosService],
})
export class PilotOperationsModule {}
