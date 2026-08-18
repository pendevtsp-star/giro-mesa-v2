import {
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { googleConfiguration } from "../auth/google-oauth.js";
import { InternalKeyGuard } from "../billing/internal-key.guard.js";
import { DatabaseService } from "../database/database.module.js";

@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, { count: number; durationSeconds: number }>();
  private readonly reportOperations = new Map<
    string,
    { count: number; durationSeconds: number; slowCount: number }
  >();
  private inFlight = 0;

  begin() {
    this.inFlight += 1;
    return process.hrtime.bigint();
  }

  end(method: string, route: string, status: number, startedAt: bigint) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const key = `${method}|${route}|${status}`;
    const current = this.requests.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    this.requests.set(key, current);
  }

  observeReportOperation(operation: string, status: "success" | "failure", startedAt: bigint) {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const key = `${operation}|${status}`;
    const current = this.reportOperations.get(key) ?? {
      count: 0,
      durationSeconds: 0,
      slowCount: 0,
    };
    current.count += 1;
    current.durationSeconds += durationSeconds;
    if (durationSeconds >= 2) current.slowCount += 1;
    this.reportOperations.set(key, current);
    return durationSeconds;
  }

  render() {
    const lines = [
      "# HELP giromesa_http_requests_total Total de respostas HTTP.",
      "# TYPE giromesa_http_requests_total counter",
    ];
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split("|");
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
      lines.push(`giromesa_http_requests_total{${labels}} ${value.count}`);
      lines.push(`giromesa_http_request_duration_seconds_sum{${labels}} ${value.durationSeconds}`);
    }
    lines.push("# TYPE giromesa_management_report_operations_total counter");
    for (const [key, value] of this.reportOperations) {
      const [operation, status] = key.split("|");
      const labels = `operation="${escapeLabel(operation)}",status="${escapeLabel(status)}"`;
      lines.push(`giromesa_management_report_operations_total{${labels}} ${value.count}`);
      lines.push(
        `giromesa_management_report_operation_duration_seconds_sum{${labels}} ${value.durationSeconds}`,
      );
      lines.push(`giromesa_management_report_slow_operations_total{${labels}} ${value.slowCount}`);
    }
    const memory = process.memoryUsage();
    lines.push(`# TYPE giromesa_http_requests_in_flight gauge`);
    lines.push(`giromesa_http_requests_in_flight ${this.inFlight}`);
    lines.push(`# TYPE giromesa_process_resident_memory_bytes gauge`);
    lines.push(`giromesa_process_resident_memory_bytes ${memory.rss}`);
    return `${lines.join("\n")}\n`;
  }
}

@Injectable()
export class DatabaseReadinessService {
  constructor(private readonly database: DatabaseService) {}

  async assertReady() {
    let relation: string | null;
    try {
      const [row] = await this.database.db.execute<{ relation: string | null }>(
        sql`select to_regclass('public.management_time_tracking_settings')::text as relation`,
      );
      relation = row?.relation ?? null;
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Banco de dados indisponível.",
      });
    }
    if (!relation) {
      throw new ServiceUnavailableException({
        code: "DATABASE_MIGRATION_REQUIRED",
        message:
          "Schema do banco desatualizado: tabela management_time_tracking_settings ausente. Execute as migrations antes de iniciar a API.",
        missingRelations: ["management_time_tracking_settings"],
      });
    }
  }
}

const escapeLabel = (value = "unknown") => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

export const emailDeliveryConfigured = () =>
  process.env.EMAIL_PROVIDER_ENABLED === "true" &&
  process.env.EMAIL_PROVIDER_CREDENTIAL_REFERENCE?.trim().toLowerCase() === "resend" &&
  Boolean(process.env.RESEND_API_KEY?.trim()) &&
  Boolean(process.env.RESEND_FROM?.trim());

export const reportEmailDeliveryConfigured = () =>
  emailDeliveryConfigured() && process.env.REPORT_EMAIL_DELIVERY_HOMOLOGATED === "true";

@Controller(["api/v1/health", "health"])
class HealthController {
  constructor(private readonly readiness: DatabaseReadinessService) {}

  @Get()
  async health() {
    await this.readiness.assertReady();
    return {
      status: "ok",
      version: "2.0.0",
      database: "up",
      integrations: {
        asaas: process.env.ASAAS_API_KEY ? "configured_not_homologated" : "disabled",
        google: googleConfiguration() ? "configured" : "disabled",
        email: emailDeliveryConfigured() ? "configured" : "disabled",
        focus: "edge_capability_required",
        paygo: "external_homologation_required",
      },
    };
  }
}

@Controller(["api/v1/metrics", "metrics"])
@UseGuards(InternalKeyGuard)
class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsText() {
    return this.metrics.render();
  }
}

@Module({
  controllers: [HealthController, MetricsController],
  providers: [MetricsService, DatabaseReadinessService, InternalKeyGuard],
  exports: [MetricsService, DatabaseReadinessService],
})
export class HealthModule {}
