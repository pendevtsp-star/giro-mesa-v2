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
    const memory = process.memoryUsage();
    lines.push(`# TYPE giromesa_http_requests_in_flight gauge`);
    lines.push(`giromesa_http_requests_in_flight ${this.inFlight}`);
    lines.push(`# TYPE giromesa_process_resident_memory_bytes gauge`);
    lines.push(`giromesa_process_resident_memory_bytes ${memory.rss}`);
    return `${lines.join("\n")}\n`;
  }
}

const escapeLabel = (value = "unknown") => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const resendConfigured = () =>
  process.env.EMAIL_PROVIDER_ENABLED === "true" &&
  process.env.EMAIL_PROVIDER_CREDENTIAL_REFERENCE?.trim().toLowerCase() === "resend" &&
  Boolean(process.env.RESEND_API_KEY?.trim()) &&
  Boolean(process.env.RESEND_FROM?.trim());

@Controller(["api/v1/health", "health"])
class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async health() {
    try {
      await this.database.db.execute(sql`select 1`);
      return {
        status: "ok",
        version: "2.0.0",
        database: "up",
        integrations: {
          asaas: process.env.ASAAS_API_KEY ? "configured_not_homologated" : "disabled",
          google: googleConfiguration() ? "configured" : "disabled",
          email: resendConfigured() ? "configured" : "disabled",
          focus: "edge_capability_required",
          paygo: "external_homologation_required",
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Banco de dados indisponível.",
      });
    }
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
  providers: [MetricsService, InternalKeyGuard],
  exports: [MetricsService],
})
export class HealthModule {}
