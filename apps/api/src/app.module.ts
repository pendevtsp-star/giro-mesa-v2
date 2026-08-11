import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { CatalogModule } from "./catalog/catalog.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { TenantContextInterceptor } from "./database/tenant-context.interceptor.js";
import { GrowthModule } from "./growth/growth.module.js";
import { HealthModule } from "./health/health.module.js";
import { ManagementModule } from "./management/management.module.js";
import { OnboardingModule } from "./onboarding/onboarding.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { PilotOperationsModule } from "./pilot-operations/pilot-operations.module.js";
import { PlatformModule } from "./platform/platform.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PublicMenuModule } from "./public-menu/public-menu.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { SyncModule } from "./sync/sync.module.js";

@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    CatalogModule,
    AuthModule,
    OrganizationsModule,
    OnboardingModule,
    BillingModule,
    OperationsModule,
    PublicMenuModule,
    RealtimeModule,
    PilotOperationsModule,
    PaymentsModule,
    PlatformModule,
    ManagementModule,
    GrowthModule,
    SyncModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }],
})
export class AppModule {}
