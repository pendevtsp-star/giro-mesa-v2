import { Badge, Button, Icon, Modal, Separator } from "@giromesa/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PosPrintJob } from "../../api";
import { type PilotFloor, parsePilotFloor } from "../../operations.shared";
import type { RealtimeStatus } from "../../realtime";
import "./operational-attention.css";

export type OperationalAttention = {
  id: string;
  kind: "service_call" | "ready" | "awaiting_order" | "print_failed";
  priority: "critical" | "warning";
  title: string;
  detail: string;
  since: string;
  route: "salon" | "counter";
  sourceId?: string;
};

const minutesSince = (value: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));

export function buildOperationalAttentions(
  floor: PilotFloor,
  printJobs: PosPrintJob[],
  access: { salon: boolean; counter: boolean },
  now = Date.now(),
): OperationalAttention[] {
  const tableLabel = (tableId: string) =>
    floor.tables.find((table) => table.id === tableId)?.label ?? "Mesa";
  const items: OperationalAttention[] = [];
  if (access.salon) {
    for (const call of floor.serviceCalls.filter((candidate) => candidate.status === "open")) {
      const elapsed = minutesSince(call.createdAt, now);
      const callLabel =
        call.kind === "bill"
          ? "Conta solicitada"
          : call.kind === "water"
            ? "Água solicitada"
            : "Cliente chamando";
      items.push({
        id: `call:${call.id}`,
        kind: "service_call",
        priority: elapsed >= call.slaMinutes ? "critical" : "warning",
        title: `${tableLabel(call.tableId)} · ${callLabel}`,
        detail: `${elapsed} min · SLA ${call.slaMinutes} min`,
        since: call.createdAt,
        route: call.kind === "bill" && access.counter ? "counter" : "salon",
        sourceId: call.id,
      });
    }
    for (const phase of floor.tablePhases) {
      const elapsed = minutesSince(phase.since, now);
      if (phase.phase === "ready" && elapsed >= 2) {
        items.push({
          id: `ready:${phase.tabId}`,
          kind: "ready",
          priority: elapsed >= 5 ? "critical" : "warning",
          title: `${tableLabel(phase.tableId)} · Pedido pronto`,
          detail: `Aguardando retirada há ${elapsed} min`,
          since: phase.since,
          route: "salon",
        });
      }
      if (phase.phase === "awaiting_order" && elapsed >= 10) {
        items.push({
          id: `order:${phase.tabId}`,
          kind: "awaiting_order",
          priority: elapsed >= 15 ? "critical" : "warning",
          title: `${tableLabel(phase.tableId)} · Sem primeiro pedido`,
          detail: `Mesa aberta há ${elapsed} min`,
          since: phase.since,
          route: "salon",
        });
      }
    }
  }
  if (access.counter) {
    for (const job of printJobs.filter((candidate) => candidate.status === "failed")) {
      items.push({
        id: `print:${job.id}`,
        kind: "print_failed",
        priority: "critical",
        title: "Falha de impressão",
        detail: job.lastError ?? "A impressora não recebeu o documento.",
        since: job.updatedAt,
        route: "counter",
      });
    }
  }
  const weight = { critical: 0, warning: 1 } as const;
  return items.sort(
    (left, right) =>
      weight[left.priority] - weight[right.priority] ||
      new Date(left.since).getTime() - new Date(right.since).getTime(),
  );
}

export function OperationalAttentionInbox({
  organizationId,
  unitId,
  canSalon,
  canCounter,
  refreshToken,
  realtimeStatus,
  onChanged,
  onNavigate,
}: {
  organizationId: string;
  unitId: string;
  canSalon: boolean;
  canCounter: boolean;
  refreshToken: number;
  realtimeStatus: RealtimeStatus;
  onChanged: () => void;
  onNavigate: (route: "salon" | "counter") => void;
}) {
  const [items, setItems] = useState<OperationalAttention[]>([]);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState("");
  const previousCriticalCount = useRef(0);
  const access = useMemo(() => ({ salon: canSalon, counter: canCounter }), [canCounter, canSalon]);

  const refresh = useCallback(async () => {
    try {
      const [floorPayload, printJobs] = await Promise.all([
        canSalon ? api.pilot.floor(organizationId, unitId) : null,
        canCounter ? api.pilot.printJobs(organizationId, unitId, { limit: 30 }) : [],
      ]);
      const floor = floorPayload
        ? parsePilotFloor(floorPayload)
        : ({ tables: [], serviceCalls: [], tablePhases: [] } as unknown as PilotFloor);
      const next = buildOperationalAttentions(floor, printJobs, access);
      const criticalCount = next.filter((item) => item.priority === "critical").length;
      if (criticalCount > previousCriticalCount.current) navigator.vibrate?.(80);
      previousCriticalCount.current = criticalCount;
      setItems(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [access, canCounter, canSalon, organizationId, unitId]);

  useEffect(() => {
    void refreshToken;
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    if (realtimeStatus === "live") return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [realtimeStatus, refresh]);

  if ((!canSalon && !canCounter) || (items.length === 0 && !loadError)) return null;

  async function acknowledge(item: OperationalAttention) {
    if (!item.sourceId) return;
    setBusyId(item.id);
    try {
      await api.pilot.acknowledgeServiceCall(
        organizationId,
        unitId,
        item.sourceId,
        crypto.randomUUID(),
      );
      await refresh();
      onChanged();
    } finally {
      setBusyId("");
    }
  }

  const criticalCount = items.filter((item) => item.priority === "critical").length;
  return (
    <>
      <Button
        aria-expanded={open}
        aria-label={
          loadError
            ? "Falha ao consultar atenções operacionais"
            : `${items.length} atenções operacionais`
        }
        className="operational-attention-trigger"
        onClick={() => setOpen(true)}
        size="sm"
        variant="ghost"
      >
        <Icon name="alerts" size={17} />
        {!loadError && <span>{items.length}</span>}
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)} size="md" title="Atenções da operação">
        <section aria-live="polite" className="operational-attention-inbox">
          {loadError ? (
            <div className="operational-attention-empty" role="alert">
              <strong>Atenções indisponíveis</strong>
              <span>Os dados atuais foram preservados. Tente atualizar novamente.</span>
              <Button onClick={() => void refresh()} size="sm" variant="secondary">
                Atualizar
              </Button>
            </div>
          ) : (
            <>
              <div className="operational-attention-summary">
                <span>{items.length} exigem ação</span>
                {criticalCount > 0 && <Badge tone="danger">{criticalCount} vencidas</Badge>}
              </div>
              <Separator />
              <div className="operational-attention-list">
                {items.map((item) => (
                  <article data-priority={item.priority} key={item.id}>
                    <div>
                      <Badge tone={item.priority === "critical" ? "danger" : "warning"}>
                        {item.priority === "critical" ? "Agora" : "Atenção"}
                      </Badge>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                    <div className="operational-attention-actions">
                      {item.kind === "service_call" && item.sourceId && (
                        <Button
                          disabled={busyId === item.id}
                          onClick={() => void acknowledge(item)}
                          size="sm"
                          variant="secondary"
                        >
                          Assumir
                        </Button>
                      )}
                      <Button
                        onClick={() => {
                          setOpen(false);
                          onNavigate(item.route);
                        }}
                        size="sm"
                      >
                        Abrir
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </Modal>
    </>
  );
}
