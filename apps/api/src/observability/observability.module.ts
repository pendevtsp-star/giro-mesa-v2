import {
  OpenTelemetryBackend,
  SafeTelemetry,
  type TelemetryBackend,
  type UnsafeTelemetryAttributes,
} from "@giromesa/observability";
import {
  type CallHandler,
  type DynamicModule,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Module,
  type NestInterceptor,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { catchError, finalize, throwError } from "rxjs";

const TELEMETRY_BACKEND = Symbol("TELEMETRY_BACKEND");

type ObservedRequest = FastifyRequest & {
  params?: { organizationId?: unknown; unitId?: unknown };
};

@Injectable()
export class ObservabilityService extends SafeTelemetry {
  constructor(@Inject(TELEMETRY_BACKEND) backend: TelemetryBackend) {
    super(backend);
  }
}

@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  constructor(private readonly telemetry: ObservabilityService) {}

  intercept(executionContext: ExecutionContext, next: CallHandler) {
    const request = executionContext.switchToHttp().getRequest<ObservedRequest>();
    const reply = executionContext.switchToHttp().getResponse<FastifyReply>();
    const startedAt = performance.now();
    let errorStatus: number | undefined;
    let errorType: string | undefined;

    return next.handle().pipe(
      catchError((error: unknown) => {
        errorStatus = error instanceof HttpException ? error.getStatus() : 500;
        if (errorStatus >= 500) {
          errorType = error instanceof Error ? error.name : "UnknownError";
        }
        return throwError(() => error);
      }),
      finalize(() => {
        const durationMs = performance.now() - startedAt;
        const statusCode = errorStatus ?? reply.statusCode;
        const attributes = this.attributes(request, statusCode, errorType);
        this.telemetry.span("http.server.request", durationMs, attributes);
        this.telemetry.counter("http.server.request.count", 1, attributes);
        this.telemetry.histogram("http.server.request.duration", durationMs, attributes);
        if (statusCode >= 500) {
          this.telemetry.log("error", "giromesa.http.request.failed", attributes);
        }
      }),
    );
  }

  private attributes(
    request: ObservedRequest,
    statusCode: number,
    errorType?: string,
  ): UnsafeTelemetryAttributes {
    const attributes: Record<string, unknown> = {
      "http.request.method": request.method,
      "http.route": request.routeOptions.url ?? "/unmatched",
      "http.response.status_code": statusCode,
      outcome: statusCode >= 500 ? "error" : statusCode >= 400 ? "client_rejected" : "success",
    };
    const organizationId = request.params?.organizationId;
    const unitId = request.params?.unitId;
    const deviceId = request.headers["x-device-id"];
    if (typeof organizationId === "string") attributes["organization.id"] = organizationId;
    if (typeof unitId === "string") attributes["unit.id"] = unitId;
    if (typeof deviceId === "string") attributes["device.id"] = deviceId;
    if (errorType) {
      attributes["error.type"] = errorType;
      attributes["error.code"] = "HTTP_REQUEST_FAILED";
    } else if (statusCode >= 500) {
      attributes["error.code"] = "HTTP_RESPONSE_FAILED";
    }
    return attributes;
  }
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules are class-based.
export class ObservabilityModule {
  static forBackend(
    backend: TelemetryBackend = new OpenTelemetryBackend(
      process.env.OTEL_SERVICE_NAME ?? "giromesa.api",
    ),
  ): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [
        { provide: TELEMETRY_BACKEND, useValue: backend },
        ObservabilityService,
        { provide: APP_INTERCEPTOR, useClass: HttpObservabilityInterceptor },
      ],
      exports: [ObservabilityService],
    };
  }
}
