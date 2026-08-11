import { dispatchEffects, hubCommands } from "@giromesa/db";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

type DispatchCandidate = {
  effect_id: string;
  organization_id: string;
  unit_id: string;
  order_id: string;
  station_id: string;
  effect_key: string;
  destination: "kds" | "printer";
  target_ref: string;
  operation: "dispatch" | "reprint" | "cancel" | "contingency";
  delivery_key: string;
  attempt_number: number;
  hub_id: string;
};

@Injectable()
export class DispatchCloudWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchCloudWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runOnce(), 500);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(limit = 50) {
    if (this.running) return { scheduled: 0 };
    this.running = true;
    try {
      return await this.database.db.transaction(async (tx) => {
        const rows = await tx.execute<DispatchCandidate>(sql`
          select e.id as effect_id, e.organization_id, e.unit_id, e.order_id, e.station_id,
                 e.effect_key, e.destination, e.target_ref, e.operation,
                 a.delivery_key, a.attempt_number, active_hub.hub_id
          from ${dispatchEffects} e
          join public.dispatch_attempts a
            on a.organization_id = e.organization_id
           and a.unit_id = e.unit_id
           and a.effect_id = e.id
           and a.state = 'scheduled'
          join lateral (
            select h.hub_id
            from public.hub_heartbeats h
            join public.device_enrollments d
              on d.organization_id = h.organization_id
             and d.unit_id = h.unit_id
             and d.id = h.hub_id
             and d.revoked_at is null
            where h.organization_id = e.organization_id
              and h.unit_id = e.unit_id
              and h.last_seen_at > now() - interval '2 minutes'
            order by h.last_seen_at desc
            limit 1
          ) active_hub on true
          where e.state = 'pending'
            and e.next_attempt_at <= now()
            and not exists (
              select 1 from public.hub_commands c
              where c.unit_id = e.unit_id and c.idempotency_key = a.delivery_key
            )
          order by e.next_attempt_at, e.id, a.attempt_number
          for update of e skip locked
          limit ${Math.max(1, Math.min(limit, 100))}
        `);
        let scheduled = 0;
        for (const row of rows) {
          const [created] = await tx
            .insert(hubCommands)
            .values({
              organizationId: row.organization_id,
              unitId: row.unit_id,
              hubId: row.hub_id,
              idempotencyKey: row.delivery_key,
              type: "dispatch.effect.execute",
              source: "dispatch_worker",
              payload: {
                effectId: row.effect_id,
                organizationId: row.organization_id,
                unitId: row.unit_id,
                effectKey: row.effect_key,
                destination: row.destination,
                targetRef: row.target_ref,
                operation: row.operation,
                deliveryKey: row.delivery_key,
                attemptNumber: row.attempt_number,
                payload: {
                  orderId: row.order_id,
                  stationId: row.station_id,
                  content: JSON.stringify({
                    orderId: row.order_id,
                    stationId: row.station_id,
                    operation: row.operation,
                  }),
                },
              },
              expiresAt: new Date(Date.now() + 5 * 60_000),
            })
            .onConflictDoNothing()
            .returning({ id: hubCommands.id });
          if (created) scheduled += 1;
        }
        return { scheduled };
      });
    } catch (error) {
      this.logger.warn("Dispatch cloud scheduling failed; effects remain durable", error);
      return { scheduled: 0 };
    } finally {
      this.running = false;
    }
  }
}
