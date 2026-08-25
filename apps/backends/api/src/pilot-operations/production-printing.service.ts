import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  CloudCommandResult,
  CreateProductionPrinterInput,
  KdsTicketPrintPayloadV1,
  ManualKdsTicketPrintInput,
  PrinterConfigurationArchiveCommandV1,
  PrinterConfigurationCommandV1,
  PrinterTestCommandV1,
  PrintJobExecuteCommandV1,
  ProductionPrinterDocumentType,
  ProductionPrintPolicyInput,
  ResolveUnknownProductionPrintJobInput,
  UpdateProductionPrinterInput,
} from "@giromesa/contracts";
import {
  auditEvents,
  type Database,
  deviceEnrollments,
  hubCommands,
  hubHeartbeats,
  outboxEvents,
  posDiningTables,
  posIdempotencyReceipts,
  posKdsTerminalProfiles,
  posKdsTicketItems,
  posKdsTickets,
  posOrderItemModifiers,
  posOrderItems,
  posOrders,
  posPrintJobs,
  posProductionPrinters,
  posProductionStations,
  posTabEvents,
  posTabs,
} from "@giromesa/db";
import { hasPermission, SYSTEM_ROLES, type SystemRole } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { replayResult, requestHash } from "./pilot-rules.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type JsonResponse = Record<string, unknown>;
type PrinterRow = typeof posProductionPrinters.$inferSelect;
type StationRow = typeof posProductionStations.$inferSelect;
type TicketDispatchItem = {
  item: typeof posOrderItems.$inferSelect;
  stage: number;
};

const HUB_ONLINE_WINDOW_MS = 2 * 60_000;
const PRINT_COMMAND_TTL_MS = 10 * 60_000;
const PRINTER_TEST_TTL_MS = 5 * 60_000;
const PRINTER_CONFIGURATION_TTL_MS = 7 * 24 * 60 * 60_000;

function isAllowedPrinterIpv4(value: string) {
  const [first = 0, second = 0] = value.split(".").map(Number);
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function expandIpv6(value: string) {
  let source = value.toLowerCase().split("%", 1)[0] ?? "";
  const dottedTail = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    source = `${source.slice(0, -dottedTail.length)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, omitted) }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 &&
    groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

export function isPrivatePrinterAddress(value: string) {
  const version = isIP(value);
  if (version === 4) return isAllowedPrinterIpv4(value);
  if (version !== 6) return false;

  const groups = expandIpv6(value);
  if (!groups) return false;
  const first = groups[0] ?? 0;
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isUniqueLocal = (first & 0xfe00) === 0xfc00;
  const isLinkLocal = (first & 0xffc0) === 0xfe80;
  const isMappedIpv4 = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return isAllowedPrinterIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  return isLoopback || isUniqueLocal || isLinkLocal;
}

@Injectable()
export class ProductionPrintingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async listPrinters(identityId: string, organizationId: string, unitId: string) {
    await this.requireManage(identityId, organizationId, unitId);
    const printers = await this.database.db
      .select()
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
        ),
      )
      .orderBy(desc(posProductionPrinters.isDefault), asc(posProductionPrinters.label));
    const hubs = await this.database.db
      .select({
        id: deviceEnrollments.id,
        label: deviceEnrollments.label,
        lastSeenAt: hubHeartbeats.lastSeenAt,
      })
      .from(deviceEnrollments)
      .leftJoin(
        hubHeartbeats,
        and(
          eq(hubHeartbeats.organizationId, deviceEnrollments.organizationId),
          eq(hubHeartbeats.unitId, deviceEnrollments.unitId),
          eq(hubHeartbeats.hubId, deviceEnrollments.id),
        ),
      )
      .where(
        and(
          eq(deviceEnrollments.organizationId, organizationId),
          eq(deviceEnrollments.unitId, unitId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .orderBy(asc(deviceEnrollments.label));
    const onlineThreshold = Date.now() - HUB_ONLINE_WINDOW_MS;
    return {
      printers: printers.map((printer) => this.projectPrinter(printer)),
      hubs: hubs.map((hub) => ({
        id: hub.id,
        label: hub.label,
        lastSeenAt: hub.lastSeenAt?.toISOString() ?? null,
        online: Boolean(hub.lastSeenAt && hub.lastSeenAt.getTime() > onlineThreshold),
      })),
    };
  }

  async createPrinter(
    identityId: string,
    organizationId: string,
    unitId: string,
    idempotencyKey: string,
    input: CreateProductionPrinterInput,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    if (!input.active) {
      throw new BadRequestException({ code: "PRODUCTION_PRINTER_ARCHIVE_ENDPOINT_REQUIRED" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-printer.create",
      input,
      async (tx) => {
        const printerId = randomUUID();
        await this.validatePrinterDesiredState(tx, organizationId, unitId, printerId, input);
        const targetDefaults = await this.lockHubPrinterState(
          tx,
          organizationId,
          unitId,
          input.hubId,
          null,
        );
        const isDefault = input.isDefault || !targetDefaults.some((printer) => printer.isDefault);
        if (isDefault) {
          await this.demoteHubDefault(tx, identityId, organizationId, unitId, input.hubId, null);
        }
        const [printer] = await tx
          .insert(posProductionPrinters)
          .values({
            id: printerId,
            organizationId,
            unitId,
            hubId: input.hubId,
            label: input.label,
            host: input.host,
            port: input.port,
            paperWidthMm: input.paperWidthMm,
            charactersPerLine: input.charactersPerLine,
            codeTable: input.codeTable,
            cut: input.cut,
            supportsRasterGraphics: input.supportsRasterGraphics,
            isDefault,
            documentTypes: input.documentTypes,
            fallbackPrinterId: input.fallbackPrinterId,
            active: input.active,
            revision: 1,
            applyStatus: "pending",
            createdByIdentityId: identityId,
            updatedByIdentityId: identityId,
          })
          .returning();
        if (!printer) throw new Error("Production printer insert did not return a row");
        const commandId = await this.queuePrinterConfiguration(
          tx,
          printer,
          "printer.configuration.upsert",
        );
        const [pendingPrinter] = await tx
          .update(posProductionPrinters)
          .set({ pendingCommandId: commandId, applyStatus: "pending", updatedAt: new Date() })
          .where(eq(posProductionPrinters.id, printer.id))
          .returning();
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "production_printer.configured",
          "production_printer",
          printer.id,
          { revision: 1, commandId, hubId: printer.hubId },
        );
        return {
          printer: this.projectPrinter(pendingPrinter ?? printer),
        };
      },
    );
  }

  async updatePrinter(
    identityId: string,
    organizationId: string,
    unitId: string,
    printerId: string,
    idempotencyKey: string,
    input: UpdateProductionPrinterInput,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    if (!input.active) {
      throw new BadRequestException({ code: "PRODUCTION_PRINTER_ARCHIVE_ENDPOINT_REQUIRED" });
    }
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-printer.update",
      { printerId, ...input },
      async (tx) => {
        const current = await this.lockPrinter(tx, organizationId, unitId, printerId);
        if (current.revision !== input.revision) {
          throw new ConflictException({
            code: "PRODUCTION_PRINTER_VERSION_CONFLICT",
            expectedRevision: input.revision,
            currentRevision: current.revision,
          });
        }
        await this.validatePrinterDesiredState(tx, organizationId, unitId, printerId, input);
        if (current.hubId !== input.hubId) {
          const [dependent] = await tx
            .select({ id: posProductionPrinters.id })
            .from(posProductionPrinters)
            .where(
              and(
                eq(posProductionPrinters.organizationId, organizationId),
                eq(posProductionPrinters.unitId, unitId),
                eq(posProductionPrinters.fallbackPrinterId, printerId),
                eq(posProductionPrinters.active, true),
              ),
            )
            .limit(1);
          if (dependent) {
            throw new ConflictException({ code: "PRINTER_HUB_CHANGE_HAS_FALLBACK_DEPENDENTS" });
          }
        }
        if (current.isDefault && current.hubId === input.hubId && !input.isDefault) {
          throw new ConflictException({ code: "PRODUCTION_PRINTER_DEFAULT_REQUIRED" });
        }
        if (current.isDefault && current.hubId !== input.hubId) {
          const sourcePrinters = await this.lockHubPrinterState(
            tx,
            organizationId,
            unitId,
            current.hubId,
            printerId,
          );
          if (sourcePrinters.length > 0) {
            throw new ConflictException({
              code: "PRODUCTION_PRINTER_DEFAULT_REASSIGNMENT_REQUIRED",
              hubId: current.hubId,
            });
          }
        }
        const targetPrinters = await this.lockHubPrinterState(
          tx,
          organizationId,
          unitId,
          input.hubId,
          printerId,
        );
        const isDefault = input.isDefault || !targetPrinters.some((printer) => printer.isDefault);
        if (isDefault) {
          await this.demoteHubDefault(
            tx,
            identityId,
            organizationId,
            unitId,
            input.hubId,
            printerId,
          );
        }
        const revision = current.revision + 1;
        const [updated] = await tx
          .update(posProductionPrinters)
          .set({
            hubId: input.hubId,
            label: input.label,
            host: input.host,
            port: input.port,
            paperWidthMm: input.paperWidthMm,
            charactersPerLine: input.charactersPerLine,
            codeTable: input.codeTable,
            cut: input.cut,
            supportsRasterGraphics: input.supportsRasterGraphics,
            isDefault,
            documentTypes: input.documentTypes,
            fallbackPrinterId: input.fallbackPrinterId,
            active: input.active,
            revision,
            applyStatus: "pending",
            pendingCommandId: null,
            lastTestCommandId: null,
            lastStatus: "unknown",
            lastError: null,
            updatedByIdentityId: identityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posProductionPrinters.organizationId, organizationId),
              eq(posProductionPrinters.unitId, unitId),
              eq(posProductionPrinters.id, printerId),
              eq(posProductionPrinters.revision, input.revision),
            ),
          )
          .returning();
        if (!updated) throw new ConflictException({ code: "PRODUCTION_PRINTER_VERSION_CONFLICT" });
        const commandId = await this.queuePrinterConfiguration(
          tx,
          updated,
          "printer.configuration.upsert",
        );
        const [pendingPrinter] = await tx
          .update(posProductionPrinters)
          .set({ pendingCommandId: commandId, updatedAt: new Date() })
          .where(eq(posProductionPrinters.id, printerId))
          .returning();
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "production_printer.configured",
          "production_printer",
          printerId,
          { revision, commandId, hubId: updated.hubId },
        );
        return { printer: this.projectPrinter(pendingPrinter ?? updated) };
      },
    );
  }

  async archivePrinter(
    identityId: string,
    organizationId: string,
    unitId: string,
    printerId: string,
    idempotencyKey: string,
    revision: number,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-printer.archive",
      { printerId, revision },
      async (tx) => {
        const current = await this.lockPrinter(tx, organizationId, unitId, printerId);
        if (current.revision !== revision) {
          throw new ConflictException({
            code: "PRODUCTION_PRINTER_VERSION_CONFLICT",
            expectedRevision: revision,
            currentRevision: current.revision,
          });
        }
        const [policyReference] = await tx
          .select({ id: posProductionStations.id })
          .from(posProductionStations)
          .where(
            and(
              eq(posProductionStations.organizationId, organizationId),
              eq(posProductionStations.unitId, unitId),
              eq(posProductionStations.printPrinterId, printerId),
              inArray(posProductionStations.deliveryMode, ["printer_only", "both"]),
            ),
          )
          .limit(1);
        const [fallbackReference] = await tx
          .select({ id: posProductionPrinters.id })
          .from(posProductionPrinters)
          .where(
            and(
              eq(posProductionPrinters.organizationId, organizationId),
              eq(posProductionPrinters.unitId, unitId),
              eq(posProductionPrinters.fallbackPrinterId, printerId),
              eq(posProductionPrinters.active, true),
            ),
          )
          .limit(1);
        if (policyReference || fallbackReference) {
          throw new ConflictException({
            code: "PRODUCTION_PRINTER_IN_USE",
            stationId: policyReference?.id,
            fallbackPrinterId: fallbackReference?.id,
          });
        }
        if (current.isDefault) {
          const remaining = await this.lockHubPrinterState(
            tx,
            organizationId,
            unitId,
            current.hubId,
            printerId,
          );
          if (remaining.length > 0) {
            throw new ConflictException({
              code: "PRODUCTION_PRINTER_DEFAULT_REASSIGNMENT_REQUIRED",
              hubId: current.hubId,
            });
          }
        }
        const nextRevision = current.revision + 1;
        const [archived] = await tx
          .update(posProductionPrinters)
          .set({
            active: false,
            isDefault: false,
            revision: nextRevision,
            applyStatus: "pending",
            pendingCommandId: null,
            lastTestCommandId: null,
            lastStatus: "unknown",
            lastError: null,
            updatedByIdentityId: identityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posProductionPrinters.id, printerId),
              eq(posProductionPrinters.revision, revision),
            ),
          )
          .returning();
        if (!archived) throw new ConflictException({ code: "PRODUCTION_PRINTER_VERSION_CONFLICT" });
        const commandId = await this.queuePrinterConfiguration(
          tx,
          archived,
          "printer.configuration.archive",
        );
        const [pendingPrinter] = await tx
          .update(posProductionPrinters)
          .set({ pendingCommandId: commandId, updatedAt: new Date() })
          .where(eq(posProductionPrinters.id, printerId))
          .returning();
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "production_printer.archived",
          "production_printer",
          printerId,
          { revision: nextRevision, commandId, hubId: current.hubId },
        );
        return { printer: this.projectPrinter(pendingPrinter ?? archived) };
      },
    );
  }

  async testPrinter(
    identityId: string,
    organizationId: string,
    unitId: string,
    printerId: string,
    idempotencyKey: string,
    revision: number,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-printer.test",
      { printerId, revision },
      async (tx) => {
        const printer = await this.lockPrinter(tx, organizationId, unitId, printerId);
        if (printer.revision !== revision) {
          throw new ConflictException({
            code: "PRODUCTION_PRINTER_VERSION_CONFLICT",
            expectedRevision: revision,
            currentRevision: printer.revision,
          });
        }
        if (!printer.active) throw new ConflictException({ code: "PRODUCTION_PRINTER_ARCHIVED" });
        await this.requireActiveHub(tx, organizationId, unitId, printer.hubId);
        const commandId = randomUUID();
        const commandPayload: PrinterTestCommandV1 = {
          printerId: printer.id,
          idempotencyKey,
        };
        await tx.insert(hubCommands).values({
          id: commandId,
          organizationId,
          unitId,
          hubId: printer.hubId,
          idempotencyKey: `printer-test:${printer.id}:${revision}:${idempotencyKey}`.slice(0, 160),
          type: "printer.test",
          source: "operations",
          payload: commandPayload as unknown as Record<string, unknown>,
          expiresAt: new Date(Date.now() + PRINTER_TEST_TTL_MS),
        });
        await tx
          .update(posProductionPrinters)
          .set({
            lastTestCommandId: commandId,
            lastStatus: "pending",
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(posProductionPrinters.id, printer.id));
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "production_printer.test_requested",
          "production_printer",
          printer.id,
          { revision, commandId, hubId: printer.hubId },
        );
        return { commandId, printerId, revision, state: "pending" as const };
      },
    );
  }

  async listStations(identityId: string, organizationId: string, unitId: string) {
    await this.requireManage(identityId, organizationId, unitId);
    const stations = await this.database.db
      .select()
      .from(posProductionStations)
      .where(
        and(
          eq(posProductionStations.organizationId, organizationId),
          eq(posProductionStations.unitId, unitId),
        ),
      )
      .orderBy(asc(posProductionStations.name));
    return {
      stations: await Promise.all(
        stations.map((station) =>
          this.projectStationReadiness(this.database.db, organizationId, unitId, station),
        ),
      ),
    };
  }

  async updateStationPolicy(
    identityId: string,
    organizationId: string,
    unitId: string,
    stationId: string,
    idempotencyKey: string,
    input: ProductionPrintPolicyInput,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-station.print-policy",
      { stationId, ...input },
      async (tx) => {
        const [current] = await tx
          .select()
          .from(posProductionStations)
          .where(
            and(
              eq(posProductionStations.organizationId, organizationId),
              eq(posProductionStations.unitId, unitId),
              eq(posProductionStations.id, stationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw new NotFoundException({ code: "PRODUCTION_STATION_NOT_FOUND" });
        if (input.printerId) {
          await this.requirePrinterForStation(
            tx,
            organizationId,
            unitId,
            stationId,
            input.printerId,
          );
        }
        const [updated] = await tx
          .update(posProductionStations)
          .set({
            deliveryMode: input.deliveryMode,
            printCopies: input.copies,
            printPrinterId: input.printerId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posProductionStations.organizationId, organizationId),
              eq(posProductionStations.unitId, unitId),
              eq(posProductionStations.id, stationId),
            ),
          )
          .returning();
        if (!updated) throw new NotFoundException({ code: "PRODUCTION_STATION_NOT_FOUND" });
        const affectedPrinterIds = [current.printPrinterId, input.printerId].filter(
          (printerId): printerId is string => Boolean(printerId),
        );
        for (const printerId of [...new Set(affectedPrinterIds)].sort()) {
          await this.republishPrinterConfiguration(
            tx,
            identityId,
            organizationId,
            unitId,
            printerId,
          );
        }
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "production_station.print_policy_updated",
          "production_station",
          stationId,
          {
            deliveryMode: input.deliveryMode,
            copies: input.copies,
            printerId: input.printerId,
          },
        );
        return {
          station: await this.projectStationReadiness(tx, organizationId, unitId, updated),
        };
      },
    );
  }

  assertStationsCanReceiveOrder(routes: Array<Pick<StationRow, "id" | "deliveryMode">>) {
    const disabled = routes.find((station) => station.deliveryMode === "disabled");
    if (disabled) {
      throw new ConflictException({
        code: "PRODUCTION_STATION_DELIVERY_DISABLED",
        stationId: disabled.id,
      });
    }
  }

  async queueAutomaticTicket(
    tx: Transaction,
    context: {
      identityId: string;
      organizationId: string;
      unitId: string;
      tab: typeof posTabs.$inferSelect;
      order: typeof posOrders.$inferSelect;
      ticket: typeof posKdsTickets.$inferSelect;
      station: StationRow;
      dispatch: TicketDispatchItem[];
    },
  ) {
    if (
      context.station.deliveryMode !== "printer_only" &&
      context.station.deliveryMode !== "both"
    ) {
      return null;
    }
    if (!context.station.printPrinterId) {
      throw new ConflictException({
        code: "PRODUCTION_STATION_PRINT_POLICY_INVALID",
        stationId: context.station.id,
      });
    }
    const printer = await this.requirePrinterForStation(
      tx,
      context.organizationId,
      context.unitId,
      context.station.id,
      context.station.printPrinterId,
    );
    const payload = await this.buildTicketPayload(tx, context);
    return this.queueKdsJob(tx, {
      identityId: context.identityId,
      organizationId: context.organizationId,
      unitId: context.unitId,
      tabId: context.tab.id,
      ticketId: context.ticket.id,
      station: context.station,
      printer,
      payload,
      copies: context.station.printCopies,
      dispatchKey: `kds-ticket:${context.ticket.id}:initial`,
      reason: null,
      reprintOfJobId: null,
    });
  }

  async manualTicketPrintAuthorized(
    identityId: string,
    organizationId: string,
    unitId: string,
    ticketId: string,
    idempotencyKey: string,
    input: ManualKdsTicketPrintInput,
  ) {
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds-ticket.print",
      { ticketId, ...input },
      async (tx) => {
        const context = await this.loadTicketContext(tx, organizationId, unitId, ticketId);
        if (context.station.deliveryMode === "disabled") {
          throw new ConflictException({
            code: "PRODUCTION_STATION_DELIVERY_DISABLED",
            stationId: context.station.id,
          });
        }
        const printerId = input.printerId ?? context.station.printPrinterId;
        if (!printerId) {
          throw new ConflictException({
            code: "PRODUCTION_PRINTER_REQUIRED",
            stationId: context.station.id,
          });
        }
        const printer = await this.requirePrinterForStation(
          tx,
          organizationId,
          unitId,
          context.station.id,
          printerId,
        );
        const payload = await this.buildTicketPayload(tx, {
          organizationId,
          unitId,
          ...context,
        });
        const printJob = await this.queueKdsJob(tx, {
          identityId,
          organizationId,
          unitId,
          tabId: context.tab.id,
          ticketId,
          station: context.station,
          printer,
          payload,
          copies: input.copies ?? context.station.printCopies,
          dispatchKey: `kds-ticket:${ticketId}:manual:${idempotencyKey}`.slice(0, 200),
          reason: input.reason,
          reprintOfJobId: null,
        });
        return { printJob };
      },
    );
  }

  async reprintKdsJobAuthorized(
    identityId: string,
    organizationId: string,
    unitId: string,
    sourcePrintJobId: string,
    idempotencyKey: string,
    input: { copies?: number; printerId?: string; reason: string },
  ) {
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "kds-ticket.reprint",
      { sourcePrintJobId, ...input },
      async (tx) => {
        const [source] = await tx
          .select()
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, sourcePrintJobId),
              eq(posPrintJobs.documentType, "kds_ticket"),
            ),
          )
          .for("update")
          .limit(1);
        if (!source?.kdsTicketId || !source.stationId) {
          throw new NotFoundException({ code: "KDS_PRINT_JOB_NOT_FOUND" });
        }
        if (source.status === "confirmation_required") {
          throw new ConflictException({ code: "PRINT_JOB_RESULT_CONFIRMATION_REQUIRED" });
        }
        if (source.status !== "printed" && source.status !== "failed") {
          throw new ConflictException({ code: "PRINT_JOB_NOT_REPRINTABLE" });
        }
        const context = await this.loadTicketContext(
          tx,
          organizationId,
          unitId,
          source.kdsTicketId,
        );
        if (context.station.id !== source.stationId) {
          throw new ConflictException({ code: "KDS_PRINT_JOB_STATION_MISMATCH" });
        }
        if (context.station.deliveryMode === "disabled") {
          throw new ConflictException({
            code: "PRODUCTION_STATION_DELIVERY_DISABLED",
            stationId: context.station.id,
          });
        }
        const printerId = input.printerId ?? source.printerId ?? context.station.printPrinterId;
        if (!printerId) throw new ConflictException({ code: "PRODUCTION_PRINTER_REQUIRED" });
        const printer = await this.requirePrinterForStation(
          tx,
          organizationId,
          unitId,
          context.station.id,
          printerId,
        );
        const printJob = await this.queueKdsJob(tx, {
          identityId,
          organizationId,
          unitId,
          tabId: source.tabId,
          ticketId: source.kdsTicketId,
          station: context.station,
          printer,
          payload: source.payload as unknown as KdsTicketPrintPayloadV1,
          copies: input.copies ?? source.copies,
          dispatchKey: `kds-ticket:${source.kdsTicketId}:reprint:${idempotencyKey}`.slice(0, 200),
          reason: input.reason,
          reprintOfJobId: source.id,
        });
        return { printJob };
      },
    );
  }

  async resolveUnknownPrintJob(
    identityId: string,
    organizationId: string,
    unitId: string,
    printJobId: string,
    idempotencyKey: string,
    input: ResolveUnknownProductionPrintJobInput,
  ) {
    await this.requireManage(identityId, organizationId, unitId);
    return this.idempotent(
      identityId,
      organizationId,
      unitId,
      idempotencyKey,
      "production-print-job.resolve-unknown",
      { printJobId, ...input },
      async (tx) => {
        const [current] = await tx
          .select()
          .from(posPrintJobs)
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
              eq(posPrintJobs.documentType, "kds_ticket"),
            ),
          )
          .for("update")
          .limit(1);
        if (!current) throw new NotFoundException({ code: "KDS_PRINT_JOB_NOT_FOUND" });
        if (current.status !== "confirmation_required") {
          throw new ConflictException({ code: "PRINT_JOB_CONFIRMATION_NOT_REQUIRED" });
        }
        const now = new Date();
        const [printJob] = await tx
          .update(posPrintJobs)
          .set({
            status: input.outcome,
            printingAt: sql`coalesce(${posPrintJobs.printingAt}, now())`,
            printedAt: input.outcome === "printed" ? now : null,
            failedAt: input.outcome === "failed" ? now : null,
            lastError: input.outcome === "failed" ? "OPERATOR_CONFIRMED_FAILED" : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(posPrintJobs.organizationId, organizationId),
              eq(posPrintJobs.unitId, unitId),
              eq(posPrintJobs.id, printJobId),
              eq(posPrintJobs.status, "confirmation_required"),
            ),
          )
          .returning();
        if (!printJob) {
          throw new ConflictException({ code: "PRINT_JOB_CONFIRMATION_NOT_REQUIRED" });
        }
        await tx.insert(posTabEvents).values({
          organizationId,
          unitId,
          tabId: current.tabId,
          actorIdentityId: identityId,
          type: "print_job.unknown_resolved",
          payload: { printJobId, outcome: input.outcome, reason: input.reason },
        });
        await this.recordLifecycle(
          tx,
          identityId,
          organizationId,
          unitId,
          "print_job.unknown_resolved",
          "print_job",
          printJobId,
          {
            tabId: current.tabId,
            stationId: current.stationId,
            kdsTicketId: current.kdsTicketId,
            outcome: input.outcome,
            reason: input.reason,
          },
        );
        return { printJob };
      },
    );
  }

  async ticketTabId(organizationId: string, unitId: string, ticketId: string) {
    const [row] = await this.database.db
      .select({ tabId: posOrders.tabId })
      .from(posKdsTickets)
      .innerJoin(
        posOrders,
        and(
          eq(posOrders.organizationId, posKdsTickets.organizationId),
          eq(posOrders.unitId, posKdsTickets.unitId),
          eq(posOrders.id, posKdsTickets.orderId),
        ),
      )
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    return row.tabId;
  }

  async applyCommandResult(
    tx: Transaction,
    hub: { id: string; organizationId: string; unitId: string },
    result: CloudCommandResult,
    now = new Date(),
  ) {
    const [command] = await tx
      .select()
      .from(hubCommands)
      .where(
        and(
          eq(hubCommands.id, result.commandId),
          eq(hubCommands.organizationId, hub.organizationId),
          eq(hubCommands.unitId, hub.unitId),
          eq(hubCommands.hubId, hub.id),
          eq(hubCommands.type, result.type),
        ),
      )
      .for("update")
      .limit(1);
    if (!command) throw new ConflictException({ code: "CLOUD_COMMAND_RESULT_SCOPE_MISMATCH" });
    if (command.acknowledgedAt) return;

    if (result.type === "print_job.execute") {
      await this.applyPrintJobResult(tx, hub, command.id, result, now);
    } else if (
      result.type === "printer.configuration.upsert" ||
      result.type === "printer.configuration.archive"
    ) {
      await this.applyPrinterConfigurationResult(tx, hub, command.id, result, now);
    } else if (result.type === "printer.test") {
      await this.applyPrinterTestResult(tx, hub, command.id, result, now);
    } else {
      throw new ConflictException({ code: "CLOUD_COMMAND_RESULT_TYPE_UNSUPPORTED" });
    }
    await tx
      .update(hubCommands)
      .set({ acknowledgedAt: now })
      .where(and(eq(hubCommands.id, command.id), isNull(hubCommands.acknowledgedAt)));
  }

  async expireUnknownPrintCommands(
    tx: Transaction,
    hub: { id: string; organizationId: string; unitId: string },
    now = new Date(),
  ) {
    const expired = await tx
      .select({ commandId: hubCommands.id, jobId: posPrintJobs.id })
      .from(hubCommands)
      .innerJoin(posPrintJobs, eq(posPrintJobs.hubCommandId, hubCommands.id))
      .where(
        and(
          eq(hubCommands.organizationId, hub.organizationId),
          eq(hubCommands.unitId, hub.unitId),
          eq(hubCommands.hubId, hub.id),
          eq(hubCommands.type, "print_job.execute"),
          isNull(hubCommands.acknowledgedAt),
          lte(hubCommands.expiresAt, now),
          inArray(posPrintJobs.status, ["queued", "printing"]),
        ),
      )
      .for("update");
    for (const row of expired) {
      await tx
        .update(posPrintJobs)
        .set({
          status: "confirmation_required",
          lastError: "PRINTER_RESULT_UNKNOWN",
          updatedAt: now,
        })
        .where(eq(posPrintJobs.id, row.jobId));
      await tx
        .update(hubCommands)
        .set({ acknowledgedAt: now })
        .where(eq(hubCommands.id, row.commandId));
      await this.recordLifecycle(
        tx,
        null,
        hub.organizationId,
        hub.unitId,
        "print_job.confirmation_required",
        "print_job",
        row.jobId,
        { errorCode: "PRINTER_RESULT_UNKNOWN", commandId: row.commandId },
      );
    }
  }

  private async applyPrintJobResult(
    tx: Transaction,
    hub: { id: string; organizationId: string; unitId: string },
    commandId: string,
    result: Extract<CloudCommandResult, { type: "print_job.execute" }>,
    now: Date,
  ) {
    if (
      result.status === "confirmation_required" &&
      result.errorCode !== "PRINTER_RESULT_UNKNOWN"
    ) {
      throw new BadRequestException({ code: "PRINTER_RESULT_UNKNOWN_REQUIRED" });
    }
    const [job] = await tx
      .select()
      .from(posPrintJobs)
      .where(
        and(
          eq(posPrintJobs.organizationId, hub.organizationId),
          eq(posPrintJobs.unitId, hub.unitId),
          eq(posPrintJobs.hubCommandId, commandId),
          eq(posPrintJobs.documentType, "kds_ticket"),
          ...(result.cloudPrintJobId ? [eq(posPrintJobs.id, result.cloudPrintJobId)] : []),
        ),
      )
      .for("update")
      .limit(1);
    if (!job) throw new ConflictException({ code: "PRINT_JOB_COMMAND_MISMATCH" });
    if (["printed", "failed", "confirmation_required"].includes(job.status)) {
      if (job.status !== result.status) {
        throw new ConflictException({ code: "PRINT_JOB_RESULT_CONFLICT" });
      }
      return;
    }
    const lastError =
      result.status === "printed"
        ? null
        : (result.errorCode ??
          (result.status === "confirmation_required" ? "PRINTER_RESULT_UNKNOWN" : "PRINT_FAILED"));
    await tx
      .update(posPrintJobs)
      .set({
        status: result.status,
        attempts: sql`greatest(${posPrintJobs.attempts}, 1)`,
        printingAt: sql`coalesce(${posPrintJobs.printingAt}, now())`,
        printedAt: result.status === "printed" ? now : null,
        failedAt: result.status === "failed" ? now : null,
        lastError,
        updatedAt: now,
      })
      .where(eq(posPrintJobs.id, job.id));
    await this.recordLifecycle(
      tx,
      null,
      hub.organizationId,
      hub.unitId,
      `print_job.${result.status}`,
      "print_job",
      job.id,
      { commandId, errorCode: lastError, documentType: "kds_ticket" },
    );
  }

  private async applyPrinterConfigurationResult(
    tx: Transaction,
    hub: { id: string; organizationId: string; unitId: string },
    commandId: string,
    result: Extract<
      CloudCommandResult,
      { type: "printer.configuration.upsert" | "printer.configuration.archive" }
    >,
    now: Date,
  ) {
    let [printer] = await tx
      .select()
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, hub.organizationId),
          eq(posProductionPrinters.unitId, hub.unitId),
          eq(posProductionPrinters.hubId, hub.id),
          eq(posProductionPrinters.pendingCommandId, commandId),
        ),
      )
      .for("update")
      .limit(1);
    if (!printer && result.printerId) {
      [printer] = await tx
        .select()
        .from(posProductionPrinters)
        .where(
          and(
            eq(posProductionPrinters.organizationId, hub.organizationId),
            eq(posProductionPrinters.unitId, hub.unitId),
            eq(posProductionPrinters.hubId, hub.id),
            eq(posProductionPrinters.id, result.printerId),
          ),
        )
        .for("update")
        .limit(1);
    }
    if (!printer || printer.pendingCommandId !== commandId) return;
    if (result.status === "applied" && result.printerId !== printer.id) {
      throw new ConflictException({ code: "PRODUCTION_PRINTER_COMMAND_MISMATCH" });
    }
    const resultRevision =
      result.revision && result.revision > 0 ? result.revision : printer.revision;
    if (resultRevision !== printer.revision) return;
    await tx
      .update(posProductionPrinters)
      .set({
        appliedRevision:
          result.status === "applied"
            ? sql`greatest(coalesce(${posProductionPrinters.appliedRevision}, 0), ${resultRevision})`
            : printer.appliedRevision,
        applyStatus: result.status === "applied" ? "applied" : "error",
        pendingCommandId: null,
        lastAppliedAt: result.status === "applied" ? now : printer.lastAppliedAt,
        lastError:
          result.status === "failed" ? (result.errorCode ?? "PRINTER_CONFIG_FAILED") : null,
        updatedAt: now,
      })
      .where(eq(posProductionPrinters.id, printer.id));
    await this.recordLifecycle(
      tx,
      null,
      hub.organizationId,
      hub.unitId,
      `production_printer.configuration_${result.status}`,
      "production_printer",
      printer.id,
      { commandId, revision: resultRevision, errorCode: result.errorCode ?? null },
    );
  }

  private async applyPrinterTestResult(
    tx: Transaction,
    hub: { id: string; organizationId: string; unitId: string },
    commandId: string,
    result: Extract<CloudCommandResult, { type: "printer.test" }>,
    now: Date,
  ) {
    if (
      result.status === "confirmation_required" &&
      result.errorCode !== "PRINTER_RESULT_UNKNOWN"
    ) {
      throw new BadRequestException({ code: "PRINTER_RESULT_UNKNOWN_REQUIRED" });
    }
    let [printer] = await tx
      .select()
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, hub.organizationId),
          eq(posProductionPrinters.unitId, hub.unitId),
          eq(posProductionPrinters.hubId, hub.id),
          eq(posProductionPrinters.lastTestCommandId, commandId),
        ),
      )
      .for("update")
      .limit(1);
    if (!printer && result.printerId) {
      [printer] = await tx
        .select()
        .from(posProductionPrinters)
        .where(
          and(
            eq(posProductionPrinters.organizationId, hub.organizationId),
            eq(posProductionPrinters.unitId, hub.unitId),
            eq(posProductionPrinters.hubId, hub.id),
            eq(posProductionPrinters.id, result.printerId),
          ),
        )
        .for("update")
        .limit(1);
    }
    if (!printer || printer.lastTestCommandId !== commandId) return;
    if (result.status !== "failed" && result.printerId !== printer.id) {
      throw new ConflictException({ code: "PRODUCTION_PRINTER_COMMAND_MISMATCH" });
    }
    const resultRevision =
      result.revision && result.revision > 0 ? result.revision : printer.revision;
    if (resultRevision !== printer.revision) return;
    const status =
      result.status === "printed"
        ? "online"
        : result.status === "confirmation_required"
          ? "confirmation_required"
          : "error";
    await tx
      .update(posProductionPrinters)
      .set({
        lastStatus: status,
        lastTestAt: now,
        lastError:
          result.status === "printed"
            ? null
            : (result.errorCode ??
              (result.status === "confirmation_required"
                ? "PRINTER_RESULT_UNKNOWN"
                : "PRINTER_TEST_FAILED")),
        updatedAt: now,
      })
      .where(eq(posProductionPrinters.id, printer.id));
    await this.recordLifecycle(
      tx,
      null,
      hub.organizationId,
      hub.unitId,
      `production_printer.test_${result.status}`,
      "production_printer",
      printer.id,
      { commandId, revision: resultRevision, errorCode: result.errorCode ?? null },
    );
  }

  private async queueKdsJob(
    tx: Transaction,
    input: {
      identityId: string;
      organizationId: string;
      unitId: string;
      tabId: string;
      ticketId: string;
      station: StationRow;
      printer: PrinterRow;
      payload: KdsTicketPrintPayloadV1;
      copies: number;
      dispatchKey: string;
      reason: string | null;
      reprintOfJobId: string | null;
    },
  ) {
    const [inserted] = await tx
      .insert(posPrintJobs)
      .values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        tabId: input.tabId,
        stationId: input.station.id,
        kdsTicketId: input.ticketId,
        documentType: "kds_ticket",
        status: "queued",
        copies: input.copies,
        printerId: input.printer.id,
        payload: input.payload as unknown as Record<string, unknown>,
        requestedByIdentityId: input.identityId,
        reprintOfJobId: input.reprintOfJobId,
        reason: input.reason,
        dispatchKey: input.dispatchKey,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      const [existing] = await tx
        .select()
        .from(posPrintJobs)
        .where(
          and(
            eq(posPrintJobs.organizationId, input.organizationId),
            eq(posPrintJobs.unitId, input.unitId),
            eq(posPrintJobs.dispatchKey, input.dispatchKey),
          ),
        )
        .limit(1);
      if (!existing) throw new ConflictException({ code: "PRINT_JOB_IDEMPOTENCY_CONFLICT" });
      return existing;
    }
    const commandId = randomUUID();
    const commandPayload: PrintJobExecuteCommandV1 = {
      cloudPrintJobId: inserted.id,
      idempotencyKey: input.dispatchKey,
      stationId: input.station.id,
      stationName: input.station.name,
      documentType: "kds_ticket",
      payload: input.payload,
      copies: input.copies,
      printerId: input.printer.id,
    };
    await tx.insert(hubCommands).values({
      id: commandId,
      organizationId: input.organizationId,
      unitId: input.unitId,
      hubId: input.printer.hubId,
      idempotencyKey: `print-job:${inserted.id}`,
      type: "print_job.execute",
      source: "operations",
      payload: commandPayload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + PRINT_COMMAND_TTL_MS),
    });
    const [job] = await tx
      .update(posPrintJobs)
      .set({ hubCommandId: commandId, updatedAt: new Date() })
      .where(eq(posPrintJobs.id, inserted.id))
      .returning();
    await tx.insert(posTabEvents).values({
      organizationId: input.organizationId,
      unitId: input.unitId,
      tabId: input.tabId,
      actorIdentityId: input.identityId,
      type: "print_job.queued",
      payload: {
        printJobId: inserted.id,
        kdsTicketId: input.ticketId,
        stationId: input.station.id,
        documentType: "kds_ticket",
        commandId,
      },
    });
    await this.recordLifecycle(
      tx,
      input.identityId,
      input.organizationId,
      input.unitId,
      "print_job.queued",
      "print_job",
      inserted.id,
      {
        tabId: input.tabId,
        kdsTicketId: input.ticketId,
        stationId: input.station.id,
        commandId,
        copies: input.copies,
      },
    );
    return job ?? inserted;
  }

  private async buildTicketPayload(
    tx: Transaction,
    context: {
      organizationId: string;
      unitId: string;
      tab: typeof posTabs.$inferSelect;
      order: typeof posOrders.$inferSelect;
      ticket: typeof posKdsTickets.$inferSelect;
      station: StationRow;
      dispatch: TicketDispatchItem[];
    },
  ): Promise<KdsTicketPrintPayloadV1> {
    const itemIds = context.dispatch.map(({ item }) => item.id);
    const modifiers = itemIds.length
      ? await tx
          .select({
            orderItemId: posOrderItemModifiers.orderItemId,
            name: posOrderItemModifiers.name,
            quantity: posOrderItemModifiers.quantity,
          })
          .from(posOrderItemModifiers)
          .where(
            and(
              eq(posOrderItemModifiers.organizationId, context.organizationId),
              eq(posOrderItemModifiers.unitId, context.unitId),
              inArray(posOrderItemModifiers.orderItemId, itemIds),
            ),
          )
          .orderBy(asc(posOrderItemModifiers.name))
      : [];
    const [table] = context.tab.tableId
      ? await tx
          .select({ label: posDiningTables.label })
          .from(posDiningTables)
          .where(
            and(
              eq(posDiningTables.organizationId, context.organizationId),
              eq(posDiningTables.unitId, context.unitId),
              eq(posDiningTables.id, context.tab.tableId),
            ),
          )
          .limit(1)
      : [];
    const tabLabel =
      context.tab.label ??
      (context.tab.displayNumber
        ? `Comanda ${context.tab.displayNumber}`
        : context.tab.id.slice(0, 8));
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      id: context.ticket.id,
      reference: context.tab.displayNumber
        ? String(context.tab.displayNumber)
        : context.order.id.slice(0, 8).toUpperCase(),
      orderId: context.order.id,
      stationId: context.station.id,
      stationName: context.station.name,
      tableLabel: table?.label ?? null,
      tabLabel,
      channel: context.order.source,
      rush: context.order.kdsPriority > 0,
      dueAt: context.ticket.dueAt?.toISOString() ?? null,
      items: [...context.dispatch]
        .sort((left, right) => left.item.createdAt.getTime() - right.item.createdAt.getTime())
        .map(({ item, stage }) => ({
          orderItemId: item.id,
          quantity: item.quantity,
          productName: item.productName,
          modifiers: modifiers
            .filter((modifier) => modifier.orderItemId === item.id)
            .map((modifier) =>
              modifier.quantity > 1 ? `${modifier.quantity}x ${modifier.name}` : modifier.name,
            ),
          notes: item.notes,
          allergyNote: item.allergyNote,
          seatNumber: item.seatNumber,
          course: item.course,
          stage,
        })),
    };
  }

  private async loadTicketContext(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    ticketId: string,
  ) {
    const [row] = await tx
      .select({
        ticket: posKdsTickets,
        order: posOrders,
        tab: posTabs,
        station: posProductionStations,
      })
      .from(posKdsTickets)
      .innerJoin(
        posOrders,
        and(
          eq(posOrders.organizationId, posKdsTickets.organizationId),
          eq(posOrders.unitId, posKdsTickets.unitId),
          eq(posOrders.id, posKdsTickets.orderId),
        ),
      )
      .innerJoin(
        posTabs,
        and(
          eq(posTabs.organizationId, posOrders.organizationId),
          eq(posTabs.unitId, posOrders.unitId),
          eq(posTabs.id, posOrders.tabId),
        ),
      )
      .innerJoin(
        posProductionStations,
        and(
          eq(posProductionStations.organizationId, posKdsTickets.organizationId),
          eq(posProductionStations.unitId, posKdsTickets.unitId),
          eq(posProductionStations.id, posKdsTickets.stationId),
        ),
      )
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationId),
          eq(posKdsTickets.unitId, unitId),
          eq(posKdsTickets.id, ticketId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException({ code: "KDS_TICKET_NOT_FOUND" });
    const ticketItems = await tx
      .select({ item: posOrderItems, stage: posKdsTicketItems.stage })
      .from(posKdsTicketItems)
      .innerJoin(
        posOrderItems,
        and(
          eq(posOrderItems.organizationId, posKdsTicketItems.organizationId),
          eq(posOrderItems.unitId, posKdsTicketItems.unitId),
          eq(posOrderItems.id, posKdsTicketItems.orderItemId),
        ),
      )
      .where(
        and(
          eq(posKdsTicketItems.organizationId, organizationId),
          eq(posKdsTicketItems.unitId, unitId),
          eq(posKdsTicketItems.ticketId, ticketId),
        ),
      );
    return { ...row, dispatch: ticketItems };
  }

  private async requirePrinterForStation(
    tx: Transaction | DatabaseService["db"],
    organizationId: string,
    unitId: string,
    stationId: string,
    printerId: string,
  ) {
    const [printer] = await tx
      .select({ printer: posProductionPrinters })
      .from(posProductionPrinters)
      .innerJoin(
        deviceEnrollments,
        and(
          eq(deviceEnrollments.organizationId, posProductionPrinters.organizationId),
          eq(deviceEnrollments.unitId, posProductionPrinters.unitId),
          eq(deviceEnrollments.id, posProductionPrinters.hubId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
          eq(posProductionPrinters.id, printerId),
          eq(posProductionPrinters.active, true),
        ),
      )
      .limit(1);
    if (!printer?.printer.documentTypes.includes("kds_ticket")) {
      throw new ConflictException({
        code: "PRODUCTION_PRINTER_NOT_READY",
        stationId,
        printerId,
      });
    }
    return printer.printer;
  }

  private async projectStationReadiness(
    tx: Transaction | DatabaseService["db"],
    organizationId: string,
    unitId: string,
    station: StationRow,
  ) {
    const [kds] = await tx
      .select({ installationId: posKdsTerminalProfiles.installationId })
      .from(posKdsTerminalProfiles)
      .where(
        and(
          eq(posKdsTerminalProfiles.organizationId, organizationId),
          eq(posKdsTerminalProfiles.unitId, unitId),
          eq(posKdsTerminalProfiles.mode, "station"),
          eq(posKdsTerminalProfiles.stationId, station.id),
        ),
      )
      .limit(1);
    let printer: PrinterRow | undefined;
    if (station.printPrinterId) {
      const [row] = await tx
        .select({ printer: posProductionPrinters })
        .from(posProductionPrinters)
        .where(
          and(
            eq(posProductionPrinters.organizationId, organizationId),
            eq(posProductionPrinters.unitId, unitId),
            eq(posProductionPrinters.id, station.printPrinterId),
            eq(posProductionPrinters.active, true),
          ),
        )
        .limit(1);
      if (row?.printer.documentTypes.includes("kds_ticket")) printer = row.printer;
    }
    const [heartbeat] = printer
      ? await tx
          .select({ lastSeenAt: hubHeartbeats.lastSeenAt })
          .from(hubHeartbeats)
          .where(
            and(
              eq(hubHeartbeats.organizationId, organizationId),
              eq(hubHeartbeats.unitId, unitId),
              eq(hubHeartbeats.hubId, printer.hubId),
              gt(hubHeartbeats.lastSeenAt, new Date(Date.now() - HUB_ONLINE_WINDOW_MS)),
            ),
          )
          .limit(1)
      : [];
    const kdsConfigured = Boolean(kds);
    const printerConfigured = Boolean(
      printer && printer.applyStatus === "applied" && printer.appliedRevision === printer.revision,
    );
    const hubOnline = Boolean(heartbeat);
    const issues: Array<
      | "DELIVERY_DISABLED"
      | "KDS_NOT_CONFIGURED"
      | "PRINT_PRINTER_NOT_CONFIGURED"
      | "PRINT_POLICY_INVALID"
      | "EDGE_HUB_OFFLINE"
    > = [];
    if (station.active) {
      if (station.deliveryMode === "disabled") issues.push("DELIVERY_DISABLED");
      if (
        (station.deliveryMode === "kds_only" || station.deliveryMode === "both") &&
        !kdsConfigured
      ) {
        issues.push("KDS_NOT_CONFIGURED");
      }
      if (station.deliveryMode === "printer_only" || station.deliveryMode === "both") {
        if (!station.printPrinterId) issues.push("PRINT_PRINTER_NOT_CONFIGURED");
        else if (!printerConfigured) issues.push("PRINT_POLICY_INVALID");
        else if (!hubOnline) issues.push("EDGE_HUB_OFFLINE");
      }
    }
    return {
      id: station.id,
      name: station.name,
      code: station.code,
      active: station.active,
      deliveryMode: station.deliveryMode,
      copies: station.printCopies,
      printerId: station.printPrinterId,
      readiness: {
        ready: issues.length === 0,
        issues,
        kdsConfigured,
        printerConfigured,
        hubOnline,
      },
    };
  }

  private async validatePrinterDesiredState(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    printerId: string,
    input: CreateProductionPrinterInput | UpdateProductionPrinterInput,
  ) {
    if (!isPrivatePrinterAddress(input.host)) {
      throw new BadRequestException({
        code: "PRODUCTION_PRINTER_PRIVATE_ADDRESS_REQUIRED",
        message: "Use um endereço IPv4 ou IPv6 privado literal.",
      });
    }
    await this.requireActiveHub(tx, organizationId, unitId, input.hubId);
    if (input.fallbackPrinterId === printerId) {
      throw new BadRequestException({ code: "PRODUCTION_PRINTER_FALLBACK_SELF_REFERENCE" });
    }
    if (input.fallbackPrinterId) {
      const visited = new Set([printerId]);
      let nextId: string | null = input.fallbackPrinterId;
      while (nextId) {
        if (visited.has(nextId)) {
          throw new ConflictException({ code: "PRODUCTION_PRINTER_FALLBACK_CYCLE" });
        }
        visited.add(nextId);
        const [fallback] = await tx
          .select({
            id: posProductionPrinters.id,
            hubId: posProductionPrinters.hubId,
            active: posProductionPrinters.active,
            fallbackPrinterId: posProductionPrinters.fallbackPrinterId,
          })
          .from(posProductionPrinters)
          .where(
            and(
              eq(posProductionPrinters.organizationId, organizationId),
              eq(posProductionPrinters.unitId, unitId),
              eq(posProductionPrinters.id, nextId),
            ),
          )
          .for("update")
          .limit(1);
        if (!fallback?.active || fallback.hubId !== input.hubId) {
          throw new ConflictException({ code: "PRODUCTION_PRINTER_FALLBACK_INVALID" });
        }
        nextId = fallback.fallbackPrinterId;
      }
    }
  }

  private async requireActiveHub(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    hubId: string,
  ) {
    const [hub] = await tx
      .select({ id: deviceEnrollments.id })
      .from(deviceEnrollments)
      .where(
        and(
          eq(deviceEnrollments.organizationId, organizationId),
          eq(deviceEnrollments.unitId, unitId),
          eq(deviceEnrollments.id, hubId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!hub) throw new ConflictException({ code: "EDGE_HUB_NOT_ENROLLED", hubId });
    return hub;
  }

  private async queuePrinterConfiguration(
    tx: Transaction,
    printer: PrinterRow,
    type: "printer.configuration.upsert" | "printer.configuration.archive",
  ) {
    await this.requireActiveHub(tx, printer.organizationId, printer.unitId, printer.hubId);
    const stationIds = (
      await tx
        .select({ id: posProductionStations.id })
        .from(posProductionStations)
        .where(
          and(
            eq(posProductionStations.organizationId, printer.organizationId),
            eq(posProductionStations.unitId, printer.unitId),
            eq(posProductionStations.printPrinterId, printer.id),
            eq(posProductionStations.active, true),
            inArray(posProductionStations.deliveryMode, ["printer_only", "both"]),
          ),
        )
        .orderBy(asc(posProductionStations.id))
    ).map(({ id }) => id);
    const commandId = randomUUID();
    const payload: PrinterConfigurationCommandV1 | PrinterConfigurationArchiveCommandV1 =
      type === "printer.configuration.archive"
        ? { printerId: printer.id, revision: printer.revision }
        : {
            printerId: printer.id,
            revision: printer.revision,
            configuration: {
              host: printer.host,
              port: printer.port,
              paperWidthMm: printer.paperWidthMm as 58 | 80,
              charactersPerLine: printer.charactersPerLine,
              codeTable: printer.codeTable,
              cut: printer.cut,
              supportsRasterGraphics: printer.supportsRasterGraphics,
              isDefault: printer.isDefault,
              stationIds,
              documentTypes: printer.documentTypes,
              fallbackPrinterId: printer.fallbackPrinterId,
            },
          };
    await tx.insert(hubCommands).values({
      id: commandId,
      organizationId: printer.organizationId,
      unitId: printer.unitId,
      hubId: printer.hubId,
      idempotencyKey: `printer-config:${printer.id}:${printer.revision}`,
      type,
      source: "operations",
      payload: payload as unknown as Record<string, unknown>,
      expiresAt: new Date(Date.now() + PRINTER_CONFIGURATION_TTL_MS),
    });
    return commandId;
  }

  private async republishPrinterConfiguration(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    printerId: string,
  ) {
    const printer = await this.lockPrinter(tx, organizationId, unitId, printerId);
    if (!printer.active) return;
    const revision = printer.revision + 1;
    const [updated] = await tx
      .update(posProductionPrinters)
      .set({
        revision,
        applyStatus: "pending",
        pendingCommandId: null,
        lastTestCommandId: null,
        lastStatus: "unknown",
        lastError: null,
        updatedByIdentityId: actorIdentityId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
          eq(posProductionPrinters.id, printerId),
          eq(posProductionPrinters.revision, printer.revision),
        ),
      )
      .returning();
    if (!updated) throw new ConflictException({ code: "PRODUCTION_PRINTER_VERSION_CONFLICT" });
    const commandId = await this.queuePrinterConfiguration(
      tx,
      updated,
      "printer.configuration.upsert",
    );
    await tx
      .update(posProductionPrinters)
      .set({ pendingCommandId: commandId, updatedAt: new Date() })
      .where(eq(posProductionPrinters.id, printerId));
    await this.recordLifecycle(
      tx,
      actorIdentityId,
      organizationId,
      unitId,
      "production_printer.routing_republished",
      "production_printer",
      printerId,
      { revision, commandId },
    );
  }

  private async lockPrinter(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    printerId: string,
  ) {
    const [printer] = await tx
      .select()
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
          eq(posProductionPrinters.id, printerId),
        ),
      )
      .for("update")
      .limit(1);
    if (!printer) throw new NotFoundException({ code: "PRODUCTION_PRINTER_NOT_FOUND" });
    return printer;
  }

  private async lockHubPrinterState(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    hubId: string,
    exceptPrinterId: string | null,
  ) {
    return tx
      .select({ id: posProductionPrinters.id, isDefault: posProductionPrinters.isDefault })
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
          eq(posProductionPrinters.hubId, hubId),
          eq(posProductionPrinters.active, true),
          ...(exceptPrinterId ? [ne(posProductionPrinters.id, exceptPrinterId)] : []),
        ),
      )
      .for("update");
  }

  private async demoteHubDefault(
    tx: Transaction,
    actorIdentityId: string,
    organizationId: string,
    unitId: string,
    hubId: string,
    exceptPrinterId: string | null,
  ) {
    const defaults = await tx
      .select()
      .from(posProductionPrinters)
      .where(
        and(
          eq(posProductionPrinters.organizationId, organizationId),
          eq(posProductionPrinters.unitId, unitId),
          eq(posProductionPrinters.hubId, hubId),
          eq(posProductionPrinters.isDefault, true),
          eq(posProductionPrinters.active, true),
          ...(exceptPrinterId ? [ne(posProductionPrinters.id, exceptPrinterId)] : []),
        ),
      )
      .for("update");
    for (const current of defaults) {
      const revision = current.revision + 1;
      const [updated] = await tx
        .update(posProductionPrinters)
        .set({
          isDefault: false,
          revision,
          applyStatus: "pending",
          pendingCommandId: null,
          lastTestCommandId: null,
          lastStatus: "unknown",
          lastError: null,
          updatedByIdentityId: actorIdentityId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(posProductionPrinters.id, current.id),
            eq(posProductionPrinters.revision, current.revision),
          ),
        )
        .returning();
      if (!updated) throw new ConflictException({ code: "PRODUCTION_PRINTER_VERSION_CONFLICT" });
      const commandId = await this.queuePrinterConfiguration(
        tx,
        updated,
        "printer.configuration.upsert",
      );
      await tx
        .update(posProductionPrinters)
        .set({ pendingCommandId: commandId, updatedAt: new Date() })
        .where(eq(posProductionPrinters.id, current.id));
      await this.recordLifecycle(
        tx,
        actorIdentityId,
        organizationId,
        unitId,
        "production_printer.default_reassigned",
        "production_printer",
        current.id,
        { revision, commandId, hubId },
      );
    }
  }

  private projectPrinter(printer: PrinterRow) {
    return {
      id: printer.id,
      hubId: printer.hubId,
      label: printer.label,
      host: printer.host,
      port: printer.port,
      paperWidthMm: printer.paperWidthMm as 58 | 80,
      charactersPerLine: printer.charactersPerLine,
      codeTable: printer.codeTable,
      cut: printer.cut,
      supportsRasterGraphics: printer.supportsRasterGraphics,
      isDefault: printer.isDefault,
      documentTypes: printer.documentTypes as ProductionPrinterDocumentType[],
      fallbackPrinterId: printer.fallbackPrinterId,
      active: printer.active,
      revision: printer.revision,
      appliedRevision: printer.appliedRevision,
      applyStatus: printer.applyStatus,
      pendingCommandId: printer.pendingCommandId,
      lastAppliedAt: printer.lastAppliedAt?.toISOString() ?? null,
      lastTestAt: printer.lastTestAt?.toISOString() ?? null,
      lastStatus: printer.lastStatus,
      lastError: printer.lastError,
      createdAt: printer.createdAt.toISOString(),
      updatedAt: printer.updatedAt.toISOString(),
    };
  }

  private async requireManage(identityId: string, organizationId: string, unitId: string) {
    await this.scope.requireUnitAccess(identityId, organizationId, unitId);
    const rows = await this.scope.requireOrganizationRole(identityId, organizationId, SYSTEM_ROLES);
    const scoped = rows.filter((row) => row.unitId === null || row.unitId === unitId);
    if (!scoped.some((row) => row.role === "owner" || row.role === "manager")) {
      throw new ForbiddenException({ code: "POS_MANAGER_REQUIRED" });
    }
    if (
      !scoped.some((row) => hasPermission(row.role as SystemRole, "operations:printing:manage"))
    ) {
      throw new ForbiddenException({
        code: "POS_CAPABILITY_DENIED",
        capability: "operations:printing:manage",
      });
    }
  }

  private async idempotent<T extends JsonResponse>(
    identityId: string,
    organizationId: string,
    unitId: string,
    key: string,
    operation: string,
    input: unknown,
    work: (tx: Transaction) => Promise<T>,
  ) {
    if (!key || key.trim().length < 8 || key.length > 160) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Envie Idempotency-Key com 8 a 160 caracteres.",
      });
    }
    const normalizedKey = key.trim();
    const hash = requestHash(operation, input);
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`pos-idem:${organizationId}:${unitId}:${normalizedKey}`}))`,
      );
      const [existing] = await tx
        .select({
          actorIdentityId: posIdempotencyReceipts.actorIdentityId,
          operation: posIdempotencyReceipts.operation,
          requestHash: posIdempotencyReceipts.requestHash,
          response: posIdempotencyReceipts.response,
        })
        .from(posIdempotencyReceipts)
        .where(
          and(
            eq(posIdempotencyReceipts.organizationId, organizationId),
            eq(posIdempotencyReceipts.unitId, unitId),
            eq(posIdempotencyReceipts.key, normalizedKey),
          ),
        )
        .limit(1);
      const replay = replayResult<T>(existing, operation, hash, identityId);
      if (replay) return replay;
      const response = await work(tx);
      const stored = JSON.parse(JSON.stringify(response)) as T;
      await tx.insert(posIdempotencyReceipts).values({
        id: randomUUID(),
        organizationId,
        unitId,
        actorIdentityId: identityId,
        key: normalizedKey,
        operation,
        requestHash: hash,
        response: stored,
      });
      return { ...stored, idempotentReplay: false };
    });
  }

  private async recordLifecycle(
    tx: Transaction,
    actorIdentityId: string | null,
    organizationId: string,
    unitId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await tx.insert(auditEvents).values({
      organizationId,
      unitId,
      actorIdentityId,
      action: `pos.${action}`,
      entityType,
      entityId,
      metadata,
    });
    await tx.insert(outboxEvents).values({
      topic: `pos.${action}`,
      aggregateType: entityType,
      aggregateId: entityId,
      payload: { organizationId, unitId, ...metadata },
    });
  }
}
