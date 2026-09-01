import { Badge, Button, Icon, Modal, Separator } from "@giromesa/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type PosPrintJob } from "../../api";
import {
  type PilotFloor,
  parsePilotFloor,
  parseTabDetail,
  type TabDetail,
} from "../../operations.shared";
import {
  currentOperationalPushSubscription,
  requestOperationalPush,
  showOperationalNotification,
  usePwaSnapshot,
} from "../../pwa";
import type { RealtimeStatus } from "../../realtime";
import "./operational-attention.css";

export type OperationalAttention = {
  id: string;
  kind: "service_call" | "ready" | "awaiting_order" | "draft_order" | "print_failed";
  priority: "critical" | "warning";
  title: string;
  detail: string;
  since: string;
  route: "salon" | "counter";
  tableId?: string;
  tabId?: string | null;
  sourceId?: string;
  orderId?: string;
  responsibleIdentityId?: string | null;
  isQrOrder?: boolean;
};

export function operationalAttentionHref(item: OperationalAttention): string {
  if (item.route === "salon" && item.tableId) {
    return `#/salon?table=${encodeURIComponent(item.tableId)}`;
  }
  if (item.route === "counter" && item.tabId) {
    return `#/counter?tab=${encodeURIComponent(item.tabId)}`;
  }
  return `#/${item.route}`;
}

const minutesSince = (value: string, now: number) =>
  Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));

function tableResponsible(floor: PilotFloor, tableId: string, tabId?: string | null) {
  const tab = floor.openTabs?.find((candidate) => candidate.id === tabId);
  let identityId = tab?.responsibleIdentityId;

  if (!identityId) {
    const groupId = floor.tableGroupMembers?.find((row) => row.tableId === tableId)?.groupId;
    identityId = floor.tableGroups?.find((row) => row.id === groupId)?.responsibleIdentityId;
  }

  if (!identityId && floor.activeShift) {
    const transferredSectionId = floor.shiftTableTransfers?.find(
      (row) => row.shiftId === floor.activeShift?.id && row.tableId === tableId,
    )?.targetShiftSectionId;
    const sectionId =
      transferredSectionId ??
      floor.shiftSectionTables?.find(
        (row) => row.shiftId === floor.activeShift?.id && row.tableId === tableId,
      )?.shiftSectionId;
    identityId = floor.shiftSectionStaff?.find(
      (row) =>
        row.shiftId === floor.activeShift?.id &&
        row.shiftSectionId === sectionId &&
        row.role === "primary",
    )?.identityId;
  }

  if (!identityId) {
    const serviceSectionId = floor.serviceSectionTables?.find(
      (row) => row.tableId === tableId,
    )?.sectionId;
    identityId = floor.serviceSections?.find(
      (row) => row.id === serviceSectionId,
    )?.defaultResponsibleIdentityId;
  }

  if (!identityId) return null;
  return {
    identityId,
    name:
      floor.staff?.find((person) => person.identityId === identityId)?.displayName ??
      "Responsável da mesa",
  };
}

function responsibilityDetail(
  responsible: ReturnType<typeof tableResponsible>,
  currentIdentityId?: string,
) {
  if (!responsible) return "Fila geral";
  return responsible.identityId === currentIdentityId
    ? "Responsável: você"
    : `Responsável: ${responsible.name}`;
}

function eventIdentifiesQrOrder(detail: TabDetail, orderId: string) {
  return detail.events.some((event) => {
    if (event.payload.orderId !== orderId) return false;
    const metadata =
      typeof event.payload.metadata === "object" && event.payload.metadata !== null
        ? (event.payload.metadata as Record<string, unknown>)
        : {};
    const sourceValues = [
      event.payload.source,
      event.payload.channel,
      event.payload.origin,
      metadata.source,
      metadata.channel,
      metadata.origin,
    ];
    return (
      /(^|[._-])qr([._-]|$)/i.test(event.type) ||
      sourceValues.some(
        (value) =>
          typeof value === "string" &&
          ["qr", "qr_table", "table_qr", "public_table_qr"].includes(value.toLowerCase()),
      )
    );
  });
}

export function buildOperationalAttentions(
  floor: PilotFloor,
  printJobs: PosPrintJob[],
  access: { salon: boolean; counter: boolean },
  now = Date.now(),
  tabDetails: TabDetail[] = [],
  currentIdentityId?: string,
): OperationalAttention[] {
  const tableLabel = (tableId: string) =>
    floor.tables.find((table) => table.id === tableId)?.label ?? "Mesa";
  const items: OperationalAttention[] = [];
  if (access.salon) {
    for (const call of floor.serviceCalls.filter((candidate) => candidate.status === "open")) {
      const elapsed = minutesSince(call.createdAt, now);
      const responsible = tableResponsible(floor, call.tableId, call.tabId);
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
        detail: `${elapsed} min · SLA ${call.slaMinutes} min · ${responsibilityDetail(responsible, currentIdentityId)}`,
        since: call.createdAt,
        route: call.kind === "bill" && access.counter ? "counter" : "salon",
        tableId: call.tableId,
        tabId: call.tabId,
        sourceId: call.id,
        responsibleIdentityId: responsible?.identityId ?? null,
      });
    }
    for (const phase of floor.tablePhases) {
      const elapsed = minutesSince(phase.since, now);
      const responsible = tableResponsible(floor, phase.tableId, phase.tabId);
      if (phase.phase === "ready" && elapsed >= 2) {
        items.push({
          id: `ready:${phase.tabId}`,
          kind: "ready",
          priority: elapsed >= 5 ? "critical" : "warning",
          title: `${tableLabel(phase.tableId)} · Pedido pronto`,
          detail: `Aguardando retirada há ${elapsed} min · ${responsibilityDetail(responsible, currentIdentityId)}`,
          since: phase.since,
          route: "salon",
          tableId: phase.tableId,
          tabId: phase.tabId,
          responsibleIdentityId: responsible?.identityId ?? null,
        });
      }
      if (phase.phase === "awaiting_order") {
        const detail = tabDetails.find((candidate) => candidate.tab.id === phase.tabId);
        const hasDraftOrder = detail?.orders.some((order) => order.status === "draft") ?? false;
        if (!hasDraftOrder && elapsed >= 10) {
          items.push({
            id: `order:${phase.tabId}`,
            kind: "awaiting_order",
            priority: elapsed >= 15 ? "critical" : "warning",
            title: `${tableLabel(phase.tableId)} · Sem primeiro pedido`,
            detail: `Mesa aberta há ${elapsed} min · ${responsibilityDetail(responsible, currentIdentityId)}`,
            since: phase.since,
            route: "salon",
            tableId: phase.tableId,
            tabId: phase.tabId,
            responsibleIdentityId: responsible?.identityId ?? null,
          });
        }
      }
    }
    for (const detail of tabDetails) {
      const tableId =
        detail.tab.tableId ??
        floor.tablePhases.find((phase) => phase.tabId === detail.tab.id)?.tableId ??
        null;
      if (!tableId) continue;
      const responsible = tableResponsible(floor, tableId, detail.tab.id);
      for (const order of detail.orders.filter((candidate) => candidate.status === "draft")) {
        const orderSince =
          order.createdAt ??
          detail.tab.openedAt ??
          detail.tab.createdAt ??
          new Date(now).toISOString();
        const orderElapsed = minutesSince(orderSince, now);
        const itemCount = detail.items.filter(
          (item) => item.orderId === order.id && item.status !== "canceled",
        ).length;
        const isQrOrder = eventIdentifiesQrOrder(detail, order.id);
        items.push({
          id: `draft:${order.id}`,
          kind: "draft_order",
          priority: orderElapsed >= 5 ? "critical" : "warning",
          title: `${tableLabel(tableId)} · ${isQrOrder ? "Pedido QR aguardando confirmação" : "Pedido aguardando revisão"}`,
          detail: `${itemCount} item(ns) · ${orderElapsed} min · ${responsibilityDetail(responsible, currentIdentityId)}`,
          since: orderSince,
          route: "salon",
          tableId,
          tabId: detail.tab.id,
          orderId: order.id,
          responsibleIdentityId: responsible?.identityId ?? null,
          isQrOrder,
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
  const responsibilityWeight = (item: OperationalAttention) =>
    currentIdentityId && item.responsibleIdentityId === currentIdentityId
      ? 0
      : item.responsibleIdentityId === null || item.responsibleIdentityId === undefined
        ? 1
        : 2;
  return items.sort(
    (left, right) =>
      weight[left.priority] - weight[right.priority] ||
      responsibilityWeight(left) - responsibilityWeight(right) ||
      new Date(left.since).getTime() - new Date(right.since).getTime(),
  );
}

export function OperationalAttentionInbox({
  organizationId,
  unitId,
  identityId,
  installationId,
  canSalon,
  canCounter,
  refreshToken,
  realtimeStatus,
  onChanged,
  onNavigate,
}: {
  organizationId: string;
  unitId: string;
  identityId: string;
  installationId: string;
  canSalon: boolean;
  canCounter: boolean;
  refreshToken: number;
  realtimeStatus: RealtimeStatus;
  onChanged: () => void;
  onNavigate: (href: string) => void;
}) {
  const [items, setItems] = useState<OperationalAttention[]>([]);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draftLoadPartial, setDraftLoadPartial] = useState(false);
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pushConfig, setPushConfig] = useState<{
    configured: boolean;
    publicKey: string | null;
    active: boolean;
  } | null>(null);
  const [pushUnavailable, setPushUnavailable] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const [presence, setPresence] = useState<{
    mode: "session_only" | "daily_code";
    code: string | null;
  } | null>(null);
  const pwa = usePwaSnapshot();
  const previousItemIds = useRef<Set<string> | null>(null);
  const access = useMemo(() => ({ salon: canSalon, counter: canCounter }), [canCounter, canSalon]);

  const refresh = useCallback(async () => {
    try {
      const [floorPayload, printJobs, tableQrPresence] = await Promise.all([
        canSalon ? api.pilot.floor(organizationId, unitId) : null,
        canCounter ? api.pilot.printJobs(organizationId, unitId, { limit: 30 }) : [],
        canSalon ? api.pilot.tableQrPresence(organizationId, unitId).catch(() => null) : null,
      ]);
      setPresence(tableQrPresence);
      const floor = floorPayload
        ? parsePilotFloor(floorPayload)
        : ({ tables: [], serviceCalls: [], tablePhases: [] } as unknown as PilotFloor);
      const tabIds = [...new Set(floor.openTabs.map((tab) => tab.id))];
      const tabResults = await Promise.all(
        tabIds.map(async (tabId) => {
          try {
            return parseTabDetail(await api.pilot.tab(organizationId, unitId, tabId));
          } catch {
            return null;
          }
        }),
      );
      const next = buildOperationalAttentions(
        floor,
        printJobs,
        access,
        Date.now(),
        tabResults.filter((detail): detail is TabDetail => detail !== null),
        identityId,
      );
      if (previousItemIds.current) {
        const newRelevantItems = next.filter(
          (item) =>
            !previousItemIds.current?.has(item.id) &&
            (!item.responsibleIdentityId || item.responsibleIdentityId === identityId),
        );
        if (newRelevantItems.length > 0) {
          if (!pushConfig?.active) {
            navigator.vibrate?.(80);
            for (const item of newRelevantItems) {
              void showOperationalNotification({
                title: item.title,
                body: item.detail,
                tag: item.id,
                route: operationalAttentionHref(item),
              });
            }
          }
          setAnnouncement(
            `Nova atenção operacional: ${newRelevantItems[0]?.title ?? "verifique a fila"}.`,
          );
        }
      }
      previousItemIds.current = new Set(next.map((item) => item.id));
      setItems(next);
      setDraftLoadPartial(tabResults.some((detail) => detail === null));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [access, canCounter, canSalon, identityId, organizationId, pushConfig?.active, unitId]);

  useEffect(() => {
    void refreshToken;
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    let active = true;
    void api.pilot
      .operationalPushConfig(organizationId, unitId, installationId)
      .then(async (config) => {
        if (!active) return;
        setPushUnavailable(false);
        setPushConfig(config);
        if (!config.configured || pwa.notifications !== "granted") {
          return;
        }
        const subscription = await currentOperationalPushSubscription();
        if (!active) return;
        if (!subscription) {
          if (config.active) {
            await api.pilot.removeOperationalPushSubscription(
              organizationId,
              unitId,
              installationId,
            );
          }
          if (active) setPushConfig({ ...config, active: false });
          return;
        }
        const synced = await api.pilot.upsertOperationalPushSubscription(
          organizationId,
          unitId,
          installationId,
          subscription,
        );
        if (active) setPushConfig(synced);
      })
      .catch(() => {
        if (active) {
          setPushConfig(null);
          setPushUnavailable(true);
        }
      });
    return () => {
      active = false;
    };
  }, [installationId, organizationId, pwa.notifications, unitId]);

  useEffect(() => {
    if (realtimeStatus === "live") return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [realtimeStatus, refresh]);

  if (!canSalon && !canCounter) return null;

  async function enablePush() {
    if (!pushConfig?.publicKey) return;
    setPushBusy(true);
    setPushError("");
    try {
      const result = await requestOperationalPush(pushConfig.publicKey);
      if (result.permission === "denied") {
        setPushError("As notificações estão bloqueadas nas configurações do navegador.");
        return;
      }
      if (!result.subscription) {
        setPushError("Este navegador não oferece Web Push neste modo de uso.");
        return;
      }
      const synced = await api.pilot.upsertOperationalPushSubscription(
        organizationId,
        unitId,
        installationId,
        result.subscription,
      );
      setPushConfig(synced);
      setAnnouncement("Notificações externas ativadas neste dispositivo.");
    } catch (error) {
      setPushError(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar as notificações externas.",
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function acknowledge(item: OperationalAttention) {
    if (!item.sourceId) return;
    setBusyId(item.id);
    setActionError("");
    try {
      await api.pilot.acknowledgeServiceCall(
        organizationId,
        unitId,
        item.sourceId,
        crypto.randomUUID(),
      );
      await refresh();
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível assumir o chamado.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function confirmDraftOrder(item: OperationalAttention) {
    if (!item.orderId) return;
    setBusyId(item.id);
    setActionError("");
    try {
      await api.pilot.sendOrder(organizationId, unitId, item.orderId, crypto.randomUUID());
      setAnnouncement(`${item.title} confirmado e enviado para produção.`);
      await refresh();
      onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Não foi possível confirmar o pedido.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function rejectDraftOrder(item: OperationalAttention) {
    if (!item.orderId || !item.isQrOrder) return;
    const reason = window.prompt("Informe o motivo da recusa deste pedido QR:")?.trim();
    if (!reason) return;
    setBusyId(item.id);
    setActionError("");
    try {
      await api.pilot.rejectTableQrOrder(
        organizationId,
        unitId,
        item.orderId,
        reason,
        crypto.randomUUID(),
      );
      setAnnouncement(`${item.title} recusado.`);
      await refresh();
      onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível recusar o pedido.");
    } finally {
      setBusyId("");
    }
  }

  const criticalCount = items.filter((item) => item.priority === "critical").length;
  return (
    <>
      <span aria-live="polite" className="gm-sr-only" role="status">
        {announcement}
      </span>
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
        {!loadError && items.length > 0 && <span>{items.length}</span>}
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
                {presence?.mode === "daily_code" && presence.code && (
                  <Badge tone="info">Código QR de hoje: {presence.code}</Badge>
                )}
                {pushConfig?.configured && pushConfig.active && (
                  <Badge tone="success">Notificações externas ativas</Badge>
                )}
                {pushConfig?.configured && !pushConfig.active && pwa.notifications !== "denied" && (
                  <Button
                    disabled={pushBusy}
                    onClick={() => void enablePush()}
                    size="sm"
                    variant="secondary"
                  >
                    {pushBusy ? "Ativando…" : "Ativar notificações externas"}
                  </Button>
                )}
                {pushConfig?.configured && pwa.notifications === "denied" && (
                  <Badge tone="warning">Notificações bloqueadas no navegador</Badge>
                )}
                {pushConfig && !pushConfig.configured && (
                  <Badge tone="neutral">Notificações externas indisponíveis</Badge>
                )}
                {pushUnavailable && (
                  <Badge tone="warning">Estado das notificações indisponível</Badge>
                )}
              </div>
              {pushError && (
                <span className="operational-attention-error" role="alert">
                  {pushError}
                </span>
              )}
              {draftLoadPartial && (
                <span className="operational-attention-partial" role="status">
                  Alguns pedidos em revisão estão temporariamente indisponíveis.
                </span>
              )}
              {actionError && (
                <span className="operational-attention-error" role="alert">
                  {actionError}
                </span>
              )}
              <Separator />
              {items.length === 0 ? (
                <div className="operational-attention-empty" role="status">
                  <strong>Nenhuma atenção pendente</strong>
                  <span>A fila operacional está em dia.</span>
                </div>
              ) : (
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
                        {item.kind === "draft_order" && item.orderId && (
                          <>
                            {item.isQrOrder && (
                              <Button
                                disabled={busyId === item.id}
                                onClick={() => void rejectDraftOrder(item)}
                                size="sm"
                                variant="danger"
                              >
                                Recusar
                              </Button>
                            )}
                            <Button
                              disabled={busyId === item.id}
                              onClick={() => void confirmDraftOrder(item)}
                              size="sm"
                              variant="primary"
                            >
                              Confirmar
                            </Button>
                          </>
                        )}
                        <Button
                          onClick={() => {
                            setOpen(false);
                            onNavigate(operationalAttentionHref(item));
                          }}
                          size="sm"
                        >
                          Abrir
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </Modal>
    </>
  );
}
