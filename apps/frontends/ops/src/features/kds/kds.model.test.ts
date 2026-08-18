import { describe, expect, it } from "vitest";
import {
  parseKds,
  parseKdsTerminalProfile,
  remoteStateAfterFailure,
} from "../../operations.shared";
import {
  deriveKdsAllDay,
  findKdsItemAssignment,
  isKdsItemTransitionConfirmed,
  isKdsRerouteConfirmed,
  KDS_PILOT_ACTIONS,
  kdsHasUnacknowledgedAttention,
  parseKdsAnalytics,
  shouldInvalidateKdsTopic,
  sortKdsTickets,
} from "./kds.model";

const item = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  orderId: "order-1",
  productName: "Risoto",
  quantity: 2,
  grossCents: 8_000,
  discountCents: 0,
  netCents: 8_000,
  status: "draft",
  seatNumber: 1,
  course: "main",
  allergyNote: null,
  notes: "Sem cebola",
  ...overrides,
});

describe("KDS operacional", () => {
  it("preserva o contrato legado e normaliza estados de item válidos", () => {
    const data = parseKds({
      serviceMode: "full_service",
      tickets: [
        {
          id: "ticket-1",
          orderId: "order-1",
          stationId: "station-1",
          status: "pending",
          createdAt: "2026-08-16T20:00:00.000Z",
        },
      ],
      items: [{ ticketId: "ticket-1", item: item() }],
    });

    expect(data.operationServiceMode).toBe("full_service");
    expect(data.items[0]?.item.kdsState).toBe("queued");
    expect(data.stations[0]).toMatchObject({ id: "station-1" });
    expect(data.capabilities.itemState).toBe(false);
  });

  it("aceita o envelope estendido, aliases e alertas sem perder referências humanas", () => {
    const data = parseKds({
      capturedAt: "2026-08-16T20:20:00.000Z",
      revision: "rev-42",
      operationServiceMode: "hybrid",
      capabilities: {
        itemTransition: true,
        partialReady: true,
        itemRefire: true,
        courseHold: true,
        orderHandoff: true,
        orderPriority: true,
        availability: true,
        terminalProfileRead: true,
        terminalProfileManage: true,
        authorizedCancellation: true,
      },
      freshness: {
        status: "degraded",
        lastSyncedAt: "2026-08-16T20:19:00.000Z",
        pendingCount: 2,
        message: "Operando com fila local",
      },
      sync: {
        projectionBlockedByEventId: "event-9",
        leaseExpiresAt: "2026-08-17T08:00:00.000Z",
      },
      tickets: [
        {
          id: "ticket-1",
          status: "done",
          createdAt: "2026-08-16T20:00:00.000Z",
          handedOffAt: "2026-08-16T20:18:00.000Z",
          station: { id: "station-1", name: "Cozinha quente", code: "CQ" },
          order: {
            id: "order-1",
            status: "ready",
            displayNumber: 42,
            priority: 80,
            reason: "Cliente com horário",
            updatedAt: "2026-08-16T20:15:00.000Z",
            updatedByIdentityId: "identity-1",
          },
          tab: { id: "tab-1", label: "Comanda 12", fulfillmentType: "dine_in" },
          table: { id: "table-1", label: "Mesa 8" },
          sla: { elapsedMinutes: 18, targetMinutes: 15, overdueMinutes: 3, isOverdue: true },
        },
      ],
      items: [
        {
          ticketId: "ticket-1",
          productId: "product-1",
          item: item({ status: "served" }),
          kds: { quantity: 2, readyQuantity: 2, status: "served", held: false },
          modifiers: [{ id: "mod-1", name: "Ponto malpassado", quantity: 1 }],
        },
      ],
      metrics: { total: 1, averagePrepMinutes: 17, p90PrepMinutes: 24 },
      allDay: [
        {
          productId: "product-1",
          productName: "Risoto",
          totalQuantity: 2,
          queuedQuantity: 0,
          preparingQuantity: 0,
          readyQuantity: 2,
          heldQuantity: 0,
        },
      ],
      productAvailability: [
        {
          productId: "product-1",
          productName: "Risoto",
          status: "limited",
          available: true,
          dailyStock: 12,
          soldToday: 7,
          remainingQuantity: 5,
          autoDeductStock: true,
          reason: "Últimas porções",
          updatedAt: "2026-08-16T20:10:00.000Z",
          resetAt: null,
        },
      ],
      alerts: [
        {
          id: "cancel-1",
          reason: "Cliente desistiu",
          canceledAt: "2026-08-16T20:21:00.000Z",
          ticket: {
            id: "ticket-2",
            order: { id: "order-2", displayReference: "Pedido 77" },
            station: { id: "station-1", name: "Cozinha quente" },
          },
          items: [{ productName: "Sopa", quantity: 1 }],
        },
      ],
    });

    expect(data.tickets[0]).toMatchObject({
      reference: "42",
      tableLabel: "Mesa 8",
      stationName: "Cozinha quente",
      isOverdue: true,
      priority: 80,
      priorityReason: "Cliente com horário",
    });
    expect(data.items[0]?.item).toMatchObject({
      productId: "product-1",
      kdsState: "done",
      modifiers: ["Ponto malpassado"],
    });
    expect(data.capabilities).toMatchObject({
      itemState: true,
      partialReady: true,
      refire: true,
      courseFire: true,
      handoff: true,
      availability: true,
      orderPriority: true,
      terminalProfileRead: true,
      terminalProfileManage: true,
      authorizedCancellation: true,
      priority: false,
    });
    expect(data.productAvailability[0]).toMatchObject({
      productName: "Risoto",
      status: "limited",
      remainingQuantity: 5,
    });
    expect(data.freshness).toMatchObject({
      status: "degraded",
      lastSyncedAt: "2026-08-16T20:19:00.000Z",
      pendingCount: 2,
      message: "Operando com fila local",
      projectionBlocked: true,
      leaseExpiresAt: "2026-08-17T08:00:00.000Z",
    });
    expect(data.alerts[0]).toMatchObject({
      id: "cancel-1",
      reference: "Pedido 77",
      reason: "Cliente desistiu",
      items: [{ productName: "Sopa", quantity: 1 }],
    });
  });

  it("ordena rush, atraso e FIFO e calcula all-day apenas dos tickets visíveis", () => {
    const data = parseKds({
      tickets: [
        {
          id: "normal",
          orderId: "order-normal",
          stationId: "station-1",
          status: "pending",
          createdAt: "2026-08-16T20:00:00.000Z",
          slaMinutes: 30,
        },
        {
          id: "late",
          orderId: "order-late",
          stationId: "station-1",
          status: "pending",
          createdAt: "2026-08-16T19:30:00.000Z",
          slaMinutes: 20,
        },
        {
          id: "rush",
          orderId: "order-rush",
          stationId: "station-1",
          status: "pending",
          createdAt: "2026-08-16T20:10:00.000Z",
          rush: true,
        },
      ],
      items: [
        { ticketId: "normal", item: item({ id: "item-normal", status: "preparing" }) },
        { ticketId: "late", item: item({ id: "item-late", status: "ready" }) },
      ],
    });
    const now = Date.parse("2026-08-16T20:20:00.000Z");

    expect(sortKdsTickets(data.tickets, now).map((ticket) => ticket.id)).toEqual([
      "rush",
      "late",
      "normal",
    ]);
    expect(
      deriveKdsAllDay(
        data,
        data.tickets.filter((ticket) => ticket.id !== "rush"),
      ),
    ).toMatchObject([
      { productName: "Risoto", quantity: 4, preparingQuantity: 2, readyQuantity: 2 },
    ]);
  });

  it("preserva dados prontos em falha de refresh e mantém ações de replay distintas", () => {
    const ready = { status: "ready" as const, data: { revision: "1" } };
    expect(remoteStateAfterFailure(ready, "offline")).toBe(ready);
    expect(KDS_PILOT_ACTIONS).toEqual({
      ticketState: "transition-kds",
      itemState: "transition-kds-item",
      refireItem: "refire-kds-item",
      recall: "recall-kds",
      priority: "set-kds-priority",
      orderPriority: "set-kds-order-priority",
      courseState: "set-kds-course-state",
      availability: "set-kds-product-availability",
      handoff: "handoff-kds-order",
      cancelTicket: "cancel-kds-ticket",
      blockItem: "block-kds-item",
      unblockItem: "unblock-kds-item",
      acknowledgeAttention: "acknowledge-kds-critical-note",
      rerouteItem: "reroute-kds-item",
      createBatch: "create-kds-batch",
      completeBatch: "complete-kds-batch",
      cancelBatch: "cancel-kds-batch",
    });
  });

  it("normaliza bloqueio, ciência crítica, capacidade, ETA, lotes e analytics", () => {
    const data = parseKds({
      capabilities: {
        itemBlock: true,
        acknowledgeAttention: true,
        itemReroute: true,
        productionBatches: true,
        stationCapacity: true,
        recommendation: true,
        offlineAvailabilityLifecycle: true,
        offlineActions: ["block-kds-item", "acknowledge-kds-critical-note"],
      },
      stations: [
        {
          id: "station-1",
          name: "Cozinha",
          capacity: {
            activeAssignments: 6,
            blockedAssignments: 2,
            queuedQuantity: 8,
            preparingQuantity: 4,
            sampleSize: 30,
            p50PrepMinutes: 9,
            p90PrepMinutes: 21,
            estimatedUnitsPerHour: 18,
            recommendation: {
              state: "overloaded",
              suggestedDelayMinutes: 12,
              reasons: ["queue_depth", "blocked_items"],
            },
          },
        },
      ],
      tickets: [
        {
          id: "ticket-1",
          orderId: "order-1",
          stationId: "station-1",
          status: "preparing",
          eta: {
            predictedReadyAt: "2026-08-17T20:30:00.000Z",
            p50Minutes: 12,
            p90Minutes: 20,
            sampleSize: 18,
            source: "station_history",
          },
        },
      ],
      items: [
        {
          ticketId: "ticket-1",
          item: item({ status: "preparing" }),
          kds: {
            status: "preparing",
            quantity: 2,
            blocked: {
              active: true,
              code: "missing_ingredient",
              reason: "Sem cogumelos",
            },
            attention: [
              {
                noteId: "allergy",
                revision: "sha-1",
                text: "Amendoim",
                required: true,
                acknowledgedAt: null,
              },
            ],
          },
        },
      ],
      batches: [
        {
          batchId: "batch-1",
          stationId: "station-1",
          state: "active",
          assignmentCount: 1,
          totalQuantity: 2,
          assignments: [{ ticketId: "ticket-1", orderItemId: "item-1", quantity: 2, position: 1 }],
        },
      ],
    });

    expect(data.stations[0]?.capacity).toMatchObject({
      activeAssignments: 6,
      blockedAssignments: 2,
      queuedQuantity: 8,
      p90PrepMinutes: 21,
      recommendation: {
        state: "overloaded",
        suggestedDelayMinutes: 12,
        reasons: ["queue_depth", "blocked_items"],
      },
    });
    expect(data.tickets[0]?.eta).toMatchObject({
      predictedReadyAt: "2026-08-17T20:30:00.000Z",
      p50Minutes: 12,
      p90Minutes: 20,
      sampleSize: 18,
    });
    expect(data.items[0]?.item.blocked).toMatchObject({
      code: "missing_ingredient",
      reason: "Sem cogumelos",
    });
    const parsedItem = data.items[0]?.item;
    expect(parsedItem).toBeDefined();
    expect(parsedItem ? kdsHasUnacknowledgedAttention(parsedItem) : false).toBe(true);
    expect(data.capabilities).toMatchObject({
      block: true,
      attentionAcknowledgement: true,
      reroute: true,
      batches: true,
      capacity: true,
      recommendation: true,
      offlineAvailabilityLifecycle: true,
      offlineBlock: true,
      offlineAttentionAcknowledgement: true,
    });
    expect(data.batches[0]).toMatchObject({
      id: "batch-1",
      status: "active",
      assignmentCount: 1,
      totalQuantity: 2,
      assignments: [{ position: 1 }],
    });

    expect(
      parseKdsAnalytics({
        window: { hours: 24 },
        sampleSize: 18,
        prep: { p50Minutes: 9, p90Minutes: 21 },
        counts: { blocked: 2, availability86: 3 },
        slowProducts: [{ productId: "p-1", productName: "Risoto", p90Minutes: 28, sampleSize: 5 }],
      }),
    ).toMatchObject({
      windowHours: 24,
      prep: { p50Minutes: 9, p90Minutes: 21, sampleSize: 18 },
      counts: { completed: null, blocked: 2, availability86: 3 },
      slowProducts: [{ productName: "Risoto", p90Minutes: 28, count: 5 }],
    });
    expect(shouldInvalidateKdsTopic("pos.kds_item_blocked")).toBe(true);
    expect(shouldInvalidateKdsTopic("pos.batch.completed")).toBe(true);
    expect(shouldInvalidateKdsTopic("management.inventory.changed")).toBe(false);
  });

  it("confirma prontidão parcial por quantidade sem exigir estado ready", () => {
    const data = parseKds({
      capabilities: { itemTransition: true, partialReady: true },
      tickets: [
        {
          id: "ticket-partial",
          orderId: "order-partial",
          stationId: "station-1",
          status: "preparing",
        },
      ],
      items: [
        {
          ticketId: "ticket-partial",
          item: item({ id: "item-partial", quantity: 3, status: "preparing" }),
          kds: { quantity: 3, readyQuantity: 1, status: "preparing", held: false },
        },
      ],
    });

    expect(data.capabilities.partialReady).toBe(true);
    expect(isKdsItemTransitionConfirmed(data, "ticket-partial", "item-partial", "ready", 1)).toBe(
      true,
    );
    expect(isKdsItemTransitionConfirmed(data, "ticket-partial", "item-partial", "ready", 2)).toBe(
      false,
    );
    expect(deriveKdsAllDay(data, data.tickets)).toMatchObject([
      {
        quantity: 3,
        queuedQuantity: 0,
        preparingQuantity: 2,
        readyQuantity: 1,
        heldQuantity: 0,
      },
    ]);
  });

  it("normaliza o perfil persistido deste terminal sem confundi-lo com autenticação", () => {
    expect(
      parseKdsTerminalProfile({
        installationId: "11111111-1111-4111-8111-111111111111",
        mode: "pass",
        stationId: null,
        label: "Passe principal",
        soundEnabled: true,
        fullscreenPreferred: false,
        createdAt: "2026-08-17T10:00:00.000Z",
        updatedAt: "2026-08-17T11:00:00.000Z",
        updatedByIdentityId: "identity-1",
      }),
    ).toMatchObject({
      mode: "pass",
      stationId: null,
      label: "Passe principal",
      soundEnabled: true,
    });
  });

  it("confirma ações pela atribuição composta quando o mesmo item está em duas praças", () => {
    const snapshot = parseKds({
      tickets: [
        { id: "ticket-a", orderId: "order-1", stationId: "station-a", status: "preparing" },
        { id: "ticket-b", orderId: "order-1", stationId: "station-b", status: "preparing" },
      ],
      items: [
        {
          ticketId: "ticket-a",
          item: item({ id: "shared-item", status: "preparing" }),
          kds: { status: "preparing", blocked: { active: false } },
        },
        {
          ticketId: "ticket-b",
          item: item({ id: "shared-item", status: "preparing" }),
          kds: {
            status: "preparing",
            blocked: { active: true, code: "dependency", reason: "Aguardando praça A" },
          },
        },
      ],
    });

    expect(
      Boolean(findKdsItemAssignment(snapshot, "ticket-a", "shared-item")?.blocked?.active),
    ).toBe(false);
    expect(findKdsItemAssignment(snapshot, "ticket-b", "shared-item")?.blocked?.active).toBe(true);
    expect(isKdsRerouteConfirmed(snapshot, "ticket-a", "shared-item", "station-b")).toBe(false);

    const rerouted = parseKds({
      tickets: [
        { id: "ticket-a", orderId: "order-1", stationId: "station-a", status: "preparing" },
        { id: "ticket-b", orderId: "order-1", stationId: "station-b", status: "preparing" },
      ],
      items: [
        {
          ticketId: "ticket-b",
          item: item({ id: "shared-item", status: "preparing" }),
          kds: { status: "preparing", blocked: { active: false } },
        },
      ],
    });
    expect(isKdsRerouteConfirmed(rerouted, "ticket-a", "shared-item", "station-b")).toBe(true);
  });
});
