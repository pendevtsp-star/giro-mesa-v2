import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "@giromesa/db";
import {
  decidePilotConflict,
  type PilotCommandType,
  type PilotConflictDecision,
} from "@giromesa/domain";
import { sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type PilotResourcePrecondition = Readonly<{
  type: string;
  id: string;
  occupancyEpoch: string;
  resourceVersion: number;
}>;

export type PilotMutationLocator =
  | Readonly<{ kind: "open"; tabId: string; tableId?: string }>
  | Readonly<{ kind: "tab"; tabId: string }>
  | Readonly<{ kind: "order"; orderId: string }>
  | Readonly<{ kind: "item"; itemId: string }>
  | Readonly<{ kind: "ticket"; ticketId: string }>
  | Readonly<{ kind: "transfer"; tabId: string; targetTableId: string }>
  | Readonly<{ kind: "merge"; targetTabId: string; sourceTabIds: readonly string[] }>
  | Readonly<{ kind: "split"; sourceTabId: string; targetTabId: string; targetTableId?: string }>;

type ResourceRow = PilotResourcePrecondition & Readonly<{ status: string; exists: boolean }>;
type SyncContext = Readonly<{
  commandType: PilotCommandType;
  resources: readonly PilotResourcePrecondition[];
}>;

export class PilotResourceConflict extends Error {
  constructor(
    readonly outcome: Exclude<PilotConflictDecision["outcome"], "apply" | "replay">,
    readonly code: string,
  ) {
    super(code);
  }
}

export class PilotResourceBoundary {
  private readonly syncContext = new AsyncLocalStorage<SyncContext>();

  withSyncPreconditions<T>(context: SyncContext, work: () => Promise<T>): Promise<T> {
    return this.syncContext.run(context, work);
  }

  async mutate<T>(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    locator: PilotMutationLocator,
    work: () => Promise<T>,
  ): Promise<T> {
    const resources = await this.resolve(tx, scope, locator);
    for (const resource of resources) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${this.lockKey(scope, resource)}, 0))`,
      );
    }
    const locked = await this.lockRows(tx, scope, resources);
    const confirmedTopology = await this.resolve(tx, scope, locator);
    if (
      locked.map((resource) => `${resource.type}:${resource.id}`).join("|") !==
      confirmedTopology.map((resource) => `${resource.type}:${resource.id}`).join("|")
    )
      throw new Error("PILOT_RESOURCE_TOPOLOGY_CHANGED");
    this.validateSyncContext(locked, locator);
    const result = await work();
    await this.advance(tx, scope, locked);
    return result;
  }

  private async resolve(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    locator: PilotMutationLocator,
  ): Promise<ResourceRow[]> {
    const rows: ResourceRow[] = [];
    const tab = async (id: string, creates = false, includeTable = false) => {
      const found = await this.readTab(tx, scope, id);
      if (found) {
        rows.push(found);
        if (includeTable && found.tableId) {
          const table = await this.readTable(tx, scope, found.tableId);
          if (table) rows.push(table);
        }
      } else if (creates) {
        const expected = this.syncContext
          .getStore()
          ?.resources.find((resource) => resource.type === "tab" && resource.id === id);
        rows.push({
          type: "tab",
          id,
          occupancyEpoch: expected?.occupancyEpoch ?? crypto.randomUUID(),
          resourceVersion: 0,
          status: "missing",
          exists: false,
        });
      }
    };
    const table = async (id: string) => {
      const found = await this.readTable(tx, scope, id);
      if (found) rows.push(found);
    };
    switch (locator.kind) {
      case "open":
        await tab(locator.tabId, true);
        if (locator.tableId) await table(locator.tableId);
        break;
      case "tab":
        await tab(locator.tabId);
        break;
      case "order":
        await tab(await this.tabIdFor(tx, scope, "order", locator.orderId));
        break;
      case "item":
        await tab(await this.tabIdFor(tx, scope, "item", locator.itemId));
        break;
      case "ticket":
        await tab(await this.tabIdFor(tx, scope, "ticket", locator.ticketId));
        break;
      case "transfer":
        await tab(locator.tabId, false, true);
        await table(locator.targetTableId);
        break;
      case "merge":
        for (const id of [locator.targetTabId, ...locator.sourceTabIds]) await tab(id, false, true);
        break;
      case "split":
        await tab(locator.sourceTabId);
        await tab(locator.targetTabId, true);
        if (locator.targetTableId) await table(locator.targetTableId);
        break;
    }
    return [...new Map(rows.map((row) => [`${row.type}:${row.id}`, row])).values()].sort((a, b) =>
      `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`),
    );
  }

  private async lockRows(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    resources: ResourceRow[],
  ) {
    const locked: ResourceRow[] = [];
    for (const resource of resources) {
      if (!resource.exists) {
        locked.push(resource);
        continue;
      }
      const result = await tx.execute<{
        id: string;
        occupancy_epoch: string;
        resource_version: number;
        status: string;
      }>(
        resource.type === "tab"
          ? sql`
          select id, occupancy_epoch, resource_version, status
          from pos_tabs
          where organization_id = ${scope.organizationId} and unit_id = ${scope.unitId}
            and id = ${resource.id}
          for update
        `
          : sql`
          select id, occupancy_epoch, resource_version, status
          from pos_dining_tables
          where organization_id = ${scope.organizationId} and unit_id = ${scope.unitId}
            and id = ${resource.id}
          for update
        `,
      );
      const [row] = [...result];
      if (!row) throw new PilotResourceConflict("reject", "RESOURCE_NOT_FOUND");
      locked.push({
        type: resource.type,
        id: row.id,
        occupancyEpoch: row.occupancy_epoch,
        resourceVersion: row.resource_version,
        status: row.status,
        exists: true,
      });
    }
    return locked;
  }

  private validateSyncContext(resources: ResourceRow[], locator: PilotMutationLocator) {
    const context = this.syncContext.getStore();
    if (!context) return;
    const actualKeys = resources.map((resource) => `${resource.type}:${resource.id}`);
    const expectedKeys = context.resources
      .map((resource) => `${resource.type}:${resource.id}`)
      .sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new PilotResourceConflict("reject", "RESOURCE_PRECONDITION_VECTOR_MISMATCH");
    }
    for (const current of resources) {
      const expected = context.resources.find(
        (resource) => resource.type === current.type && resource.id === current.id,
      );
      if (!expected)
        throw new PilotResourceConflict("reject", "RESOURCE_PRECONDITION_VECTOR_MISMATCH");
      if (!current.exists) {
        if (expected.resourceVersion !== 0 || !this.creates(locator, expected))
          throw new PilotResourceConflict("reject", "RESOURCE_NOT_FOUND");
        continue;
      }
      if (expected.occupancyEpoch !== current.occupancyEpoch)
        throw new PilotResourceConflict("reconcile", "OCCUPANCY_EPOCH_MISMATCH");
      if (expected.resourceVersion > current.resourceVersion)
        throw new PilotResourceConflict("reconcile", "RESOURCE_VERSION_AHEAD");
      if (expected.resourceVersion < current.resourceVersion) {
        const decision = decidePilotConflict({
          commandType: context.commandType,
          delivery: "new",
          protocol: "ordered",
          commandEpoch: expected.occupancyEpoch,
          currentEpoch: current.occupancyEpoch,
          commandVersion: expected.resourceVersion,
          currentVersion: current.resourceVersion,
          resourceState:
            current.status === "open" || current.type === "table" ? "active" : "terminal",
        });
        if (decision.outcome === "reject" || decision.outcome === "reconcile")
          throw new PilotResourceConflict(decision.outcome, decision.code);
        if (decision.outcome !== "apply") throw new Error("INVALID_RESOURCE_MATRIX_OUTCOME");
      }
    }
  }

  private creates(locator: PilotMutationLocator, expected: PilotResourcePrecondition) {
    return (
      expected.type === "tab" &&
      ((locator.kind === "open" && locator.tabId === expected.id) ||
        (locator.kind === "split" && locator.targetTabId === expected.id))
    );
  }

  private async advance(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    resources: ResourceRow[],
  ) {
    for (const resource of resources) {
      const updated = await tx.execute<{ id: string }>(
        resource.type === "tab"
          ? sql`
          update pos_tabs set
            occupancy_epoch = ${resource.occupancyEpoch},
            resource_version = resource_version + 1,
            updated_at = now()
          where organization_id = ${scope.organizationId} and unit_id = ${scope.unitId}
            and id = ${resource.id} and resource_version = ${resource.resourceVersion}
          returning id
        `
          : sql`
          update pos_dining_tables set
            resource_version = resource_version + 1,
            updated_at = now()
          where organization_id = ${scope.organizationId} and unit_id = ${scope.unitId}
            and id = ${resource.id} and occupancy_epoch = ${resource.occupancyEpoch}
            and resource_version = ${resource.resourceVersion}
          returning id
        `,
      );
      if ([...updated].length !== 1) throw new Error("PILOT_RESOURCE_VERSION_RACE");
    }
  }

  private async readTab(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    id: string,
  ): Promise<(ResourceRow & { tableId: string | null }) | null> {
    const result = await tx.execute<{
      id: string;
      occupancy_epoch: string;
      resource_version: number;
      status: string;
      table_id: string | null;
    }>(sql`
      select id, occupancy_epoch, resource_version, status, table_id
      from pos_tabs where organization_id = ${scope.organizationId} and unit_id = ${scope.unitId}
        and id = ${id}
    `);
    const [row] = [...result];
    return row
      ? {
          type: "tab",
          id: row.id,
          occupancyEpoch: row.occupancy_epoch,
          resourceVersion: row.resource_version,
          status: row.status,
          exists: true,
          tableId: row.table_id,
        }
      : null;
  }

  private async readTable(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    id: string,
  ): Promise<ResourceRow | null> {
    const result = await tx.execute<{
      id: string;
      occupancy_epoch: string;
      resource_version: number;
      status: string;
    }>(sql`
      select id, occupancy_epoch, resource_version, status
      from pos_dining_tables where organization_id = ${scope.organizationId}
        and unit_id = ${scope.unitId} and id = ${id}
    `);
    const [row] = [...result];
    return row
      ? {
          type: "table",
          id: row.id,
          occupancyEpoch: row.occupancy_epoch,
          resourceVersion: row.resource_version,
          status: row.status,
          exists: true,
        }
      : null;
  }

  private async tabIdFor(
    tx: Transaction,
    scope: { organizationId: string; unitId: string },
    kind: "order" | "item" | "ticket",
    id: string,
  ) {
    const query =
      kind === "order"
        ? sql`
      select tab_id from pos_orders where organization_id = ${scope.organizationId}
        and unit_id = ${scope.unitId} and id = ${id}
    `
        : kind === "item"
          ? sql`
      select ord.tab_id from pos_order_items item join pos_orders ord
        on ord.organization_id = item.organization_id and ord.unit_id = item.unit_id and ord.id = item.order_id
      where item.organization_id = ${scope.organizationId} and item.unit_id = ${scope.unitId} and item.id = ${id}
    `
          : sql`
      select ord.tab_id from pos_kds_tickets ticket join pos_orders ord
        on ord.organization_id = ticket.organization_id and ord.unit_id = ticket.unit_id and ord.id = ticket.order_id
      where ticket.organization_id = ${scope.organizationId} and ticket.unit_id = ${scope.unitId} and ticket.id = ${id}
    `;
    const result = await tx.execute<{ tab_id: string }>(query);
    const [row] = [...result];
    if (!row) throw new PilotResourceConflict("reject", "RESOURCE_NOT_FOUND");
    return row.tab_id;
  }

  private lockKey(scope: { organizationId: string; unitId: string }, resource: ResourceRow) {
    return `pos-resource:${scope.organizationId}:${scope.unitId}:${resource.type}:${resource.id}`;
  }
}
