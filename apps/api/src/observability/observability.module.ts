import { OpenTelemetryBackend, SafeTelemetry } from "@giromesa/observability";
import { Injectable, Module } from "@nestjs/common";

@Injectable()
export class ObservabilityService extends SafeTelemetry {
  constructor() {
    super(new OpenTelemetryBackend(process.env.OTEL_SERVICE_NAME ?? "giromesa.api"));
  }
}

@Module({
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
