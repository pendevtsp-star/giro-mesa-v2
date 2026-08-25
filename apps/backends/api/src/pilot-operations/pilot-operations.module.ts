import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { InternalKeyGuard } from "../billing/internal-key.guard.js";
import { DoseClubIntegrationModule } from "../doseclub-integration/doseclub-integration.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";
import { PilotCatalogController } from "./pilot-catalog.controller.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import { PilotPaymentDeviceController } from "./pilot-payment-device.controller.js";
import { PilotPaymentInternalController } from "./pilot-payment-internal.controller.js";
import { PilotPosController } from "./pilot-pos.controller.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";
import { ProductionPrintingController } from "./production-printing.controller.js";
import { ProductionPrintingService } from "./production-printing.service.js";

@Module({
  imports: [AuthModule, OrganizationsModule, DoseClubIntegrationModule],
  controllers: [
    PilotCatalogController,
    PilotPosController,
    PilotPaymentDeviceController,
    PilotPaymentInternalController,
    ProductionPrintingController,
  ],
  providers: [
    PilotCatalogService,
    ProductionPrintingService,
    PilotPosService,
    PilotSmartPosService,
    InternalKeyGuard,
  ],
  exports: [PilotCatalogService, PilotPosService, ProductionPrintingService],
})
export class PilotOperationsModule {}
