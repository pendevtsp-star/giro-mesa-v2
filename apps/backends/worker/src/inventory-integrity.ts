import { auditEvents, type createDatabase } from "@giromesa/db";
import { sql } from "drizzle-orm";
import { deterministicUuid } from "./inventory.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type InventoryIntegrityResult = {
  organizationId: string;
  unitId: string;
  overcommittedBalances: number;
  invalidTransfers: number;
  negativeCustodies: number;
  ledgerMismatches: number;
};

export function inventoryIntegrityStatus(result: InventoryIntegrityResult) {
  const mismatchCount =
    result.overcommittedBalances +
    result.invalidTransfers +
    result.negativeCustodies +
    result.ledgerMismatches;
  return { mismatchCount, status: mismatchCount === 0 ? ("ok" as const) : ("attention" as const) };
}

export async function runInventoryIntegrityChecks(database: Database, now = new Date()) {
  const rows = await database.execute<InventoryIntegrityResult>(sql`
    with reservations as (
      select organization_id, unit_id, location_id, inventory_item_id, sum(quantity) as quantity
      from management_inventory_reservations
      where status = 'active' and (expires_at is null or expires_at > ${now.toISOString()}::timestamptz)
      group by organization_id, unit_id, location_id, inventory_item_id
    ), held as (
      select lots.organization_id, lots.unit_id, lots.location_id, lots.inventory_item_id,
             sum(lots.quantity) as quantity
      from management_inventory_lots as lots
      join management_inventory_lot_holds as holds
        on holds.organization_id = lots.organization_id
       and holds.unit_id = lots.unit_id
       and holds.lot_id = lots.id
       and holds.status = 'active'
      group by lots.organization_id, lots.unit_id, lots.location_id, lots.inventory_item_id
    ), overcommitted as (
      select balances.organization_id, balances.unit_id, count(*)::int as quantity
      from management_stock_balances as balances
      left join reservations
        on reservations.organization_id = balances.organization_id
       and reservations.unit_id = balances.unit_id
       and reservations.location_id = balances.location_id
       and reservations.inventory_item_id = balances.inventory_item_id
      left join held
        on held.organization_id = balances.organization_id
       and held.unit_id = balances.unit_id
       and held.location_id = balances.location_id
       and held.inventory_item_id = balances.inventory_item_id
      where balances.quantity < coalesce(reservations.quantity, 0) + coalesce(held.quantity, 0)
      group by balances.organization_id, balances.unit_id
    ), invalid_transfers as (
      select organization_id, unit_id, count(*)::int as quantity
      from management_inventory_transfers
      where quantity_received < 0 or quantity_divergent < 0
         or quantity_received + quantity_divergent > quantity
      group by organization_id, unit_id
    ), negative_custodies as (
      select organization_id, unit_id, count(*)::int as quantity
      from (
        select organization_id, unit_id, container_inventory_item_id
        from management_returnable_custody_movements
        group by organization_id, unit_id, container_inventory_item_id
        having sum(quantity_delta) < 0
      ) as custody
      group by organization_id, unit_id
    ), latest_closing as (
      select distinct on (lines.organization_id, lines.unit_id, lines.location_id, lines.inventory_item_id)
             lines.organization_id, lines.unit_id, lines.location_id, lines.inventory_item_id,
             lines.quantity, closings.closed_at
      from management_inventory_closing_lines as lines
      join management_inventory_closings as closings
        on closings.organization_id = lines.organization_id
       and closings.unit_id = lines.unit_id
       and closings.id = lines.closing_id
      order by lines.organization_id, lines.unit_id, lines.location_id, lines.inventory_item_id,
               closings.closed_at desc
    ), ledger_expected as (
      select closing.organization_id, closing.unit_id, closing.location_id,
             closing.inventory_item_id,
             closing.quantity + coalesce(sum(movements.quantity_delta), 0) as quantity
      from latest_closing as closing
      left join management_inventory_movements as movements
        on movements.organization_id = closing.organization_id
       and movements.unit_id = closing.unit_id
       and movements.location_id = closing.location_id
       and movements.inventory_item_id = closing.inventory_item_id
       and movements.occurred_at > closing.closed_at
      group by closing.organization_id, closing.unit_id, closing.location_id,
               closing.inventory_item_id, closing.quantity
    ), ledger_mismatches as (
      select expected.organization_id, expected.unit_id, count(*)::int as quantity
      from ledger_expected as expected
      left join management_stock_balances as balances
        on balances.organization_id = expected.organization_id
       and balances.unit_id = expected.unit_id
       and balances.location_id = expected.location_id
       and balances.inventory_item_id = expected.inventory_item_id
      where expected.quantity <> coalesce(balances.quantity, 0)
      group by expected.organization_id, expected.unit_id
    )
    select units.organization_id as "organizationId", units.id as "unitId",
           coalesce(overcommitted.quantity, 0)::int as "overcommittedBalances",
           coalesce(invalid_transfers.quantity, 0)::int as "invalidTransfers",
           coalesce(negative_custodies.quantity, 0)::int as "negativeCustodies",
           coalesce(ledger_mismatches.quantity, 0)::int as "ledgerMismatches"
    from units
    left join overcommitted on overcommitted.organization_id = units.organization_id
                           and overcommitted.unit_id = units.id
    left join invalid_transfers on invalid_transfers.organization_id = units.organization_id
                               and invalid_transfers.unit_id = units.id
    left join negative_custodies on negative_custodies.organization_id = units.organization_id
                                and negative_custodies.unit_id = units.id
    left join ledger_mismatches on ledger_mismatches.organization_id = units.organization_id
                               and ledger_mismatches.unit_id = units.id
  `);
  const day = now.toISOString().slice(0, 10);
  const results = [...rows];
  await database.transaction(async (tx) => {
    for (const result of results) {
      const status = inventoryIntegrityStatus(result);
      await tx
        .insert(auditEvents)
        .values({
          id: deterministicUuid(
            `inventory-integrity:${result.organizationId}:${result.unitId}:${day}`,
          ),
          organizationId: result.organizationId,
          unitId: result.unitId,
          action: "management.inventory.integrity_checked",
          entityType: "inventory_integrity",
          entityId: result.unitId,
          metadata: { checkedAt: now.toISOString(), ...result, ...status },
          occurredAt: now,
        })
        .onConflictDoNothing();
    }
  });
  return results.map((result) => ({ ...result, ...inventoryIntegrityStatus(result) }));
}
