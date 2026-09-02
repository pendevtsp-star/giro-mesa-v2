import { type ApiCapability, apiHealthResponseSchema } from "@giromesa/contracts";
import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import { googleConfiguration } from "../auth/google-oauth.js";
import { InternalKeyGuard } from "../billing/internal-key.guard.js";
import { toOpenApiSchema } from "../common/openapi-zod.js";
import { DatabaseService } from "../database/database.module.js";

export const RELEASE_SCHEMA_VERSION = 76;
export const RELEASE_CAPABILITIES = [
  "table_qr_lifecycle_v1",
  "table_qr_metrics_v1",
  "table_qr_presence_code_v1",
  "ops_background_notifications_v1",
  "table_qr_brand_upload_v1",
  "ops_web_push_v1",
  "public_menu_cover_image_v1",
  "platform_backoffice_v1",
  "platform_commercial_site_v1",
  "crm_evolution_go_v1",
  "crm_operational_inbox_v1",
  "edge_hub_pairing_v1",
] satisfies ApiCapability[];

export function releaseBuildSha() {
  return (
    process.env.BUILD_SHA?.trim() ||
    process.env.GIROMESA_RELEASE_ARTIFACT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.RENDER_GIT_COMMIT?.trim() ||
    "local"
  ).slice(0, 64);
}

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
  private readonly logger = new Logger(DatabaseReadinessService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertReady() {
    let readiness:
      | {
          management: string | null;
          tableQrMetrics: string | null;
          operationalPush: string | null;
          whatsappMessages: string | null;
          crmAutomations: string | null;
          crmQuickReplies: string | null;
          edgeHubPairings: string | null;
        }
      | undefined;
    try {
      [readiness] = await this.database.db.execute<{
        management: string | null;
        tableQrMetrics: string | null;
        operationalPush: string | null;
        whatsappMessages: string | null;
        crmAutomations: string | null;
        crmQuickReplies: string | null;
        edgeHubPairings: string | null;
      }>(
        sql`select
          to_regclass('public.management_time_tracking_settings')::text as management,
          to_regclass('public.pos_table_qr_metrics')::text as "tableQrMetrics",
          to_regclass('public.pos_operational_push_subscriptions')::text as "operationalPush",
          to_regclass('public.growth_whatsapp_messages')::text as "whatsappMessages",
          to_regclass('public.growth_crm_automation_rules')::text as "crmAutomations",
          to_regclass('public.growth_crm_quick_replies')::text as "crmQuickReplies",
          to_regclass('public.edge_hub_pairing_codes')::text as "edgeHubPairings"`,
      );
    } catch (error) {
      this.logger.error(
        "Database readiness check failed.",
        error instanceof Error ? `${error.name}: ${error.message}` : "Unknown database error",
      );
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Banco de dados indisponível.",
      });
    }
    const missingRelations = [
      !readiness?.management ? "management_time_tracking_settings" : null,
      !readiness?.tableQrMetrics ? "pos_table_qr_metrics" : null,
      !readiness?.operationalPush ? "pos_operational_push_subscriptions" : null,
      !readiness?.whatsappMessages ? "growth_whatsapp_messages" : null,
      !readiness?.crmAutomations ? "growth_crm_automation_rules" : null,
      !readiness?.crmQuickReplies ? "growth_crm_quick_replies" : null,
      !readiness?.edgeHubPairings ? "edge_hub_pairing_codes" : null,
    ].filter((value): value is string => Boolean(value));
    if (missingRelations.length > 0) {
      throw new ServiceUnavailableException({
        code: "DATABASE_MIGRATION_REQUIRED",
        message: "Schema do banco desatualizado. Execute as migrations antes de iniciar a API.",
        missingRelations,
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

export const webPushConfigured = () =>
  /^[A-Za-z0-9_-]{87}$/.test(process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "") &&
  /^[A-Za-z0-9_-]{43}$/.test(process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "") &&
  /^mailto:.+@.+|^https:\/\/.+/.test(process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "") &&
  Buffer.from(process.env.OUTBOX_ENCRYPTION_KEY?.trim() ?? "", "base64").length === 32;

@Controller(["api/v1/health", "health"])
class HealthController {
  constructor(
    @Inject(DatabaseReadinessService)
    private readonly readiness: DatabaseReadinessService,
  ) {}

  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(apiHealthResponseSchema) })
  async health() {
    await this.readiness.assertReady();
    const edgeHubInstallerChannel = process.env.EDGE_HUB_WINDOWS_INSTALLER_CHANNEL?.trim();
    const edgeHubInstallerConfigured = Boolean(
      (process.env.EDGE_HUB_WINDOWS_INSTALLER_PATH?.trim() ||
        process.env.EDGE_HUB_WINDOWS_INSTALLER_URL?.trim()) &&
        process.env.EDGE_HUB_WINDOWS_INSTALLER_VERSION?.trim() &&
        /^[a-fA-F0-9]{64}$/.test(process.env.EDGE_HUB_WINDOWS_INSTALLER_SHA256?.trim() ?? "") &&
        (edgeHubInstallerChannel !== "pilot" ||
          process.env.EDGE_HUB_PILOT_ORGANIZATION_IDS?.trim()),
    );
    return {
      status: "ok",
      version: "2.0.0",
      buildSha: releaseBuildSha(),
      schemaVersion: RELEASE_SCHEMA_VERSION,
      capabilities: RELEASE_CAPABILITIES,
      database: "up",
      integrations: {
        asaas: process.env.ASAAS_API_KEY ? "configured_not_homologated" : "disabled",
        google: googleConfiguration() ? "configured" : "disabled",
        email: emailDeliveryConfigured() ? "configured" : "disabled",
        webPush: webPushConfigured() ? "configured" : "disabled",
        evolutionGo:
          process.env.WHATSAPP_PROVIDER_ENABLED === "true" &&
          process.env.WHATSAPP_PROVIDER_CREDENTIAL_REFERENCE === "evolution-go" &&
          process.env.WHATSAPP_EVOLUTION_API_URL?.trim()
            ? "configured_unit_status_required"
            : "disabled",
        focus: "edge_capability_required",
        edgeHubInstaller: edgeHubInstallerConfigured ? "configured_not_homologated" : "disabled",
        paygo: "external_homologation_required",
      },
    };
  }
}

@Controller(["api/v1/metrics", "metrics"])
@UseGuards(InternalKeyGuard)
class MetricsController {
  constructor(@Inject(MetricsService) private readonly metrics: MetricsService) {}

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
