import { Badge, Button, Card, EmptyState, Modal } from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { sendShellPrintJob } from "../../bridge";
import { type PilotAction, pilotMutation } from "../../operational-dispatch";
import {
  type KdsAttention,
  type KdsBatch,
  type KdsBlockCode,
  type KdsCancellationAlert,
  type KdsData,
  type KdsItem,
  type KdsProductAvailability,
  type KdsTicket,
  type KdsTicketStatus,
  kdsActionLabel,
  nextKdsState,
  type PilotScope,
  parseKds,
  parseKdsProductAvailability,
  parseKdsTerminalProfile,
  RemoteGate,
  useRemote,
} from "../../operations.shared";
import {
  type RealtimeFreshness,
  type RealtimeStatus,
  subscribeScopeRealtime,
} from "../../realtime";
import type { KdsAvailabilityChange } from "./KdsAvailabilityPanel";
import type { KdsPrinterPreferences } from "./KdsHardwareSettings";
import { type KdsDensity, KdsSettingsPage } from "./KdsSettingsPage";
import { KdsBatchesPanel, KdsReadyNotices } from "./KdsSupportPanels";
import {
  type KdsBumpBarMap,
  kdsBumpActionForKey,
  readKdsBumpBarMap,
  saveKdsBumpBarMap,
} from "./kds.bumpbar";
import {
  deriveKdsAllDay,
  findKdsItemAssignment,
  isKdsItemTransitionConfirmed,
  isKdsRerouteConfirmed,
  itemsForTicket,
  KDS_PILOT_ACTIONS,
  KDS_STATUS_LABEL,
  type KdsAnalytics,
  kdsChannelLabel,
  kdsFreshnessAgeMinutes,
  kdsHasUnacknowledgedAttention,
  kdsOperatingDay,
  kdsSla,
  kdsStationLabel,
  kdsTicketReference,
  parseKdsAnalytics,
  productiveKdsAllDay,
  shouldInvalidateKdsTopic,
  sortKdsTickets,
} from "./kds.model";
import {
  type KdsArea,
  kdsStoragePrefix,
  saveKdsLastOperationalArea,
  saveKdsStationLabel,
} from "./kds.navigation";
import { createKdsThermalPrintRequest } from "./kds.printing";

type KdsViewMode = "station" | "pass";
type KdsTone = "neutral" | "info" | "warning" | "success" | "danger";

interface KdsActionInput {
  action: PilotAction;
  key: string;
  label: string;
  eventType: string;
  data: Record<string, unknown>;
  execute: (idempotencyKey: string) => Promise<unknown>;
  accepted?: (response: unknown) => void;
  confirmed: (data: KdsData) => boolean;
  delivery?: "cloud-only" | "edge-capable";
}

interface ReadyNotice {
  orderId: string;
  reference: string;
  context: string | null;
  readyAt: string | null;
}

interface ItemOperation {
  kind: "block" | "unblock" | "reroute";
  ticketId: string;
  itemId: string;
}

const KDS_BLOCK_LABEL: Record<KdsBlockCode, string> = {
  missing_ingredient: "Falta de ingrediente",
  equipment_issue: "Problema em equipamento",
  quality_check: "Conferência de qualidade",
  dependency: "Dependência de outra praça",
  other: "Outro motivo",
};

interface PendingConfirmation {
  label: string;
  confirmed: (data: KdsData) => boolean;
  timeout: number;
}

function sessionValue(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function saveSessionValue(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, value);
  } catch {
    // Sessão privada pode bloquear storage; o estado em memória continua funcional.
  }
}

function persistentValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function savePersistentValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // O terminal continua com o valor atual mesmo se o armazenamento estiver indisponível.
  }
}

function printerPreferences(key: string): KdsPrinterPreferences {
  try {
    const parsed = JSON.parse(persistentValue(key) ?? "null") as Partial<KdsPrinterPreferences>;
    return {
      printerId: typeof parsed?.printerId === "string" ? parsed.printerId : "default",
      copies: parsed?.copies === 2 || parsed?.copies === 3 ? parsed.copies : 1,
    };
  } catch {
    return { printerId: "default", copies: 1 };
  }
}

const KDS_INSTALLATION_ID_KEY = "giromesa:kds:installation-id";

function createInstallationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function installationId(): string {
  const stored = persistentValue(KDS_INSTALLATION_ID_KEY);
  if (stored) return stored;
  const created = createInstallationId();
  savePersistentValue(KDS_INSTALLATION_ID_KEY, created);
  return created;
}

function statusTone(status: KdsTicketStatus): KdsTone {
  if (status === "pending") return "warning";
  if (status === "preparing") return "info";
  if (status === "ready" || status === "done") return "success";
  return "danger";
}

function itemTone(item: KdsItem): KdsTone {
  if (item.kdsState === "held" || item.kdsState === "canceled") return "danger";
  if (item.kdsState === "preparing" || item.kdsState === "fired") return "info";
  if (["ready", "done"].includes(item.kdsState)) return "success";
  return "neutral";
}

function itemStateLabel(item: KdsItem): string {
  if (item.kdsState === "held") return "Segurado";
  if (item.kdsState === "preparing") return "Em preparo";
  if (item.kdsState === "ready") return "Pronto";
  if (item.kdsState === "fired") return "Fogo";
  if (item.kdsState === "done") return "Entregue";
  if (item.kdsState === "canceled") return "Cancelado";
  return "Na fila";
}

function courseLabel(course: KdsItem["course"]): string {
  if (course === "starter") return "Entrada";
  if (course === "main") return "Principal";
  if (course === "dessert") return "Sobremesa";
  return "A qualquer momento";
}

function formatTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "A ação não foi confirmada.";
}

function cancellationReference(alert: KdsCancellationAlert): string {
  return (
    alert.tableLabel ?? alert.tabLabel ?? alert.reference ?? `Pedido #${alert.orderId.slice(0, 6)}`
  );
}

function cancellationStation(alert: KdsCancellationAlert): string {
  return (
    alert.stationName ?? (alert.stationId ? `Estação ${alert.stationId.slice(0, 6)}` : "Produção")
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
}

async function playKdsSound(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return false;
  let context: AudioContext | null = null;
  try {
    context = new AudioContextConstructor();
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") {
      await context.close();
      return false;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.17);
    oscillator.addEventListener("ended", () => void context?.close(), { once: true });
    return true;
  } catch {
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    return false;
  }
}

function TicketCard({
  ticket,
  data,
  now,
  busyKeys,
  errors,
  canSequenceCourses,
  canRefire,
  canCancel,
  cloudUnavailable,
  onTicketState,
  onItemState,
  onAcknowledgeAttention,
  onRequestItemOperation,
  onRefireItem,
  onCourseState,
  onRecall,
  onRequestCancel,
}: {
  ticket: KdsTicket;
  data: KdsData;
  now: number;
  busyKeys: Set<string>;
  errors: Record<string, string>;
  canSequenceCourses: boolean;
  canRefire: boolean;
  canCancel: boolean;
  cloudUnavailable: boolean;
  onTicketState: (ticket: KdsTicket, state: "preparing" | "ready") => void;
  onItemState: (
    ticket: KdsTicket,
    item: KdsItem,
    state: "preparing" | "ready",
    quantity?: number,
  ) => void;
  onAcknowledgeAttention: (ticket: KdsTicket, item: KdsItem, attention: KdsAttention) => void;
  onRequestItemOperation: (ticket: KdsTicket, item: KdsItem, kind: ItemOperation["kind"]) => void;
  onRefireItem: (ticket: KdsTicket, item: KdsItem) => void;
  onCourseState: (ticket: KdsTicket, course: KdsItem["course"], state: "held" | "fired") => void;
  onRecall: (ticket: KdsTicket) => void;
  onRequestCancel: (ticket: KdsTicket) => void;
}) {
  const [partialQuantities, setPartialQuantities] = useState<Record<string, number>>({});
  const items = itemsForTicket(data, ticket.id);
  const sla = kdsSla(ticket, now);
  const next = nextKdsState[ticket.status];
  const prefix = `ticket:${ticket.id}:`;
  const cardBusy = [...busyKeys].some((key) => key.startsWith(prefix));
  const cardError = Object.entries(errors).find(([key]) => key.startsWith(prefix))?.[1];
  const courses = [...new Set(items.map((item) => item.course))];
  const reference = kdsTicketReference(ticket);
  const secondaryReferences = [ticket.reference, ticket.tabLabel]
    .filter((value): value is string => Boolean(value) && value !== reference)
    .filter((value, index, values) => values.indexOf(value) === index);
  const blockedItems = items.filter((item) => item.blocked?.active);
  const attentionPending = items.filter(kdsHasUnacknowledgedAttention);
  const predictedReadyAt = ticket.eta?.predictedReadyAt
    ? Date.parse(ticket.eta.predictedReadyAt)
    : Number.NaN;
  const etaRemainingMinutes = Number.isFinite(predictedReadyAt)
    ? Math.max(0, Math.ceil((predictedReadyAt - now) / 60_000))
    : (ticket.eta?.remainingMinutes ?? ticket.eta?.p50Minutes ?? null);
  const ticketAdvanceBlocked =
    blockedItems.length > 0 || (next === "ready" && attentionPending.length > 0);
  return (
    <article
      aria-label={`Ticket ${reference}`}
      className="real-kds-ticket"
      data-kds-ticket={ticket.id}
    >
      <Card
        className={`real-kds-card real-kds-card--${ticket.status} ${sla.isOverdue ? "real-kds-card--overdue" : ""}`}
      >
        <header className="real-kds-card__header">
          <div>
            <span className="real-kds-card__station">{kdsStationLabel(ticket)}</span>
            <h3>{reference}</h3>
            <span className="real-kds-card__order">
              {secondaryReferences.length > 0
                ? secondaryReferences.join(" · ")
                : `Pedido #${ticket.orderId.slice(0, 6)}`}
            </span>
          </div>
          <div className="real-kds-card__badges">
            {ticket.rush && <Badge tone="danger">RUSH</Badge>}
            <Badge tone={statusTone(ticket.status)}>{KDS_STATUS_LABEL[ticket.status]}</Badge>
          </div>
        </header>

        <div className="real-kds-card__meta">
          <strong className={sla.isOverdue ? "kds-timer kds-timer--overdue" : "kds-timer"}>
            {sla.elapsedMinutes} min
          </strong>
          <span>Meta {sla.targetMinutes} min</span>
          {sla.isOverdue && <span>{sla.overdueMinutes} min atrasado</span>}
          {kdsChannelLabel(ticket.channel) && <span>{kdsChannelLabel(ticket.channel)}</span>}
          {ticket.customerName && <span>{ticket.customerName}</span>}
          {formatTime(ticket.promisedAt) && <span>Prometido {formatTime(ticket.promisedAt)}</span>}
          {etaRemainingMinutes !== null && (
            <span>
              ETA {etaRemainingMinutes} min
              {formatTime(ticket.eta?.predictedReadyAt ?? null)
                ? ` · ${formatTime(ticket.eta?.predictedReadyAt ?? null)}`
                : ""}
            </span>
          )}
          {ticket.eta && ticket.eta.p50Minutes !== null && ticket.eta.p90Minutes !== null && (
            <span>
              Faixa {ticket.eta.p50Minutes}–{ticket.eta.p90Minutes} min
              {ticket.eta.sampleSize !== null ? ` · ${ticket.eta.sampleSize} amostras` : ""}
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="kds-inline-alert" role="alert">
            Ticket sem itens. Atualize a produção; ações bloqueadas para evitar avanço indevido.
          </p>
        ) : (
          <ul className="real-kds-items">
            {items.map((item) => {
              const itemPrefix = `${prefix}item:${item.id}:`;
              const itemBusy = [...busyKeys].some((key) => key.startsWith(itemPrefix));
              const itemError = Object.entries(errors).find(([key]) =>
                key.startsWith(itemPrefix),
              )?.[1];
              const nextItemState = ["pending", "queued", "fired"].includes(item.kdsState)
                ? "preparing"
                : item.kdsState === "preparing"
                  ? "ready"
                  : null;
              const remainingQuantity = Math.max(0, item.quantity - item.readyQuantity);
              const partialQuantity = Math.min(
                remainingQuantity,
                Math.max(1, partialQuantities[item.id] ?? 1),
              );
              const canMarkPartial =
                data.capabilities.partialReady &&
                item.kdsState === "preparing" &&
                remainingQuantity > 1 &&
                !item.blocked?.active &&
                !kdsHasUnacknowledgedAttention(item);
              const itemReadyBlocked =
                nextItemState === "ready" &&
                (Boolean(item.blocked?.active) || kdsHasUnacknowledgedAttention(item));
              return (
                <li
                  className={`real-kds-item real-kds-item--${item.kdsState} ${item.blocked?.active ? "real-kds-item--blocked" : ""}`}
                  key={item.id}
                >
                  <div className="real-kds-item__title">
                    <span>
                      <strong>{item.quantity}×</strong> {item.productName}
                    </span>
                    <Badge tone={itemTone(item)}>{itemStateLabel(item)}</Badge>
                  </div>
                  <div className="real-kds-item__meta">
                    {item.seatNumber && <span>Pessoa {item.seatNumber}</span>}
                    <span>{courseLabel(item.course)}</span>
                    {item.readyQuantity > 0 && item.readyQuantity < item.quantity && (
                      <span>
                        {item.readyQuantity}/{item.quantity} prontos
                      </span>
                    )}
                  </div>
                  {item.modifiers.length > 0 && (
                    <div className="kds-modifiers">
                      <span className="gm-sr-only">Modificadores:</span>
                      {item.modifiers.map((modifier) => (
                        <strong key={modifier}>{modifier}</strong>
                      ))}
                    </div>
                  )}
                  {item.blocked?.active && (
                    <div className="kds-item-blocked" role="alert">
                      <strong>
                        Item bloqueado
                        {item.blocked.code ? ` · ${KDS_BLOCK_LABEL[item.blocked.code]}` : ""}
                      </strong>
                      <span>{item.blocked.reason ?? "Motivo não informado pelo servidor."}</span>
                    </div>
                  )}
                  {item.attention.length > 0 && (
                    <section aria-label="Alertas críticos do item" className="kds-attention-list">
                      {item.attention.map((attention) => {
                        const acknowledged = attention.acknowledgedAt !== null;
                        const attentionBusy = busyKeys.has(
                          `${itemPrefix}attention:${attention.noteId}:${attention.revision ?? "missing"}`,
                        );
                        return (
                          <div
                            className={`kds-attention kds-attention--${attention.noteId}`}
                            key={`${attention.noteId}:${attention.revision ?? attention.text}`}
                          >
                            <strong>
                              <span aria-hidden="true">⚠</span>{" "}
                              {attention.noteId === "allergy" ? "Alergia" : "Observação"}:{" "}
                              {attention.text}
                            </strong>
                            {acknowledged ? (
                              <span>
                                Ciência confirmada
                                {attention.acknowledgedBy ? ` por ${attention.acknowledgedBy}` : ""}
                              </span>
                            ) : data.capabilities.attentionAcknowledgement && attention.revision ? (
                              <Button
                                aria-label={`Confirmar ciência de ${attention.noteId === "allergy" ? "alergia" : "observação"} em ${item.productName}`}
                                disabled={
                                  attentionBusy ||
                                  (cloudUnavailable &&
                                    !data.capabilities.offlineAttentionAcknowledgement)
                                }
                                onClick={() => onAcknowledgeAttention(ticket, item, attention)}
                                size="sm"
                                variant="danger"
                              >
                                {attentionBusy ? "Confirmando…" : "Confirmar ciência"}
                              </Button>
                            ) : (
                              <span>Ciência auditável indisponível; não marque o item pronto.</span>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  )}
                  {item.allergyNote && !item.attention.some((row) => row.noteId === "allergy") && (
                    <strong className="kds-allergy">
                      <span aria-hidden="true">⚠</span> Alergia: {item.allergyNote}
                    </strong>
                  )}
                  {item.notes && !item.attention.some((row) => row.noteId === "notes") && (
                    <strong className="kds-item-note">Observação: {item.notes}</strong>
                  )}
                  {((data.capabilities.itemState && nextItemState) ||
                    (item.kdsState === "ready" && canRefire)) && (
                    <div className="real-kds-item__actions">
                      {canMarkPartial && (
                        <span className="kds-partial-ready">
                          <label htmlFor={`kds-partial-${ticket.id}-${item.id}`}>
                            Quantidade pronta
                          </label>
                          <input
                            aria-label={`Quantidade pronta de ${item.productName}`}
                            id={`kds-partial-${ticket.id}-${item.id}`}
                            inputMode="numeric"
                            max={remainingQuantity}
                            min={1}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setPartialQuantities((current) => ({
                                ...current,
                                [item.id]: Number.isFinite(value)
                                  ? Math.min(remainingQuantity, Math.max(1, Math.floor(value)))
                                  : 1,
                              }));
                            }}
                            step={1}
                            type="number"
                            value={partialQuantity}
                          />
                          <Button
                            disabled={itemBusy}
                            onClick={() => onItemState(ticket, item, "ready", partialQuantity)}
                            size="sm"
                            variant="secondary"
                          >
                            Marcar {partialQuantity} pronto{partialQuantity > 1 ? "s" : ""}
                          </Button>
                        </span>
                      )}
                      {data.capabilities.itemState && nextItemState && (
                        <Button
                          aria-busy={itemBusy}
                          disabled={itemBusy || itemReadyBlocked || Boolean(item.blocked?.active)}
                          onClick={() => onItemState(ticket, item, nextItemState)}
                          size="sm"
                          variant="secondary"
                        >
                          {itemBusy
                            ? "Confirmando…"
                            : nextItemState === "preparing"
                              ? `Iniciar ${item.productName}`
                              : canMarkPartial
                                ? `Marcar os ${remainingQuantity} restantes prontos`
                                : `Marcar ${item.productName} pronto`}
                        </Button>
                      )}
                      {item.kdsState === "ready" && canRefire && (
                        <Button
                          disabled={itemBusy}
                          onClick={() => onRefireItem(ticket, item)}
                          size="sm"
                          variant="ghost"
                        >
                          Refazer item
                        </Button>
                      )}
                    </div>
                  )}
                  {(data.capabilities.block || data.capabilities.reroute) &&
                    !["done", "canceled"].includes(item.kdsState) && (
                      <details className="kds-item-operations">
                        <summary>Exceções do item</summary>
                        <div>
                          {data.capabilities.block && (
                            <Button
                              disabled={
                                itemBusy || (cloudUnavailable && !data.capabilities.offlineBlock)
                              }
                              onClick={() =>
                                onRequestItemOperation(
                                  ticket,
                                  item,
                                  item.blocked?.active ? "unblock" : "block",
                                )
                              }
                              size="sm"
                              variant={item.blocked?.active ? "secondary" : "ghost"}
                            >
                              {item.blocked?.active ? "Desbloquear item" : "Bloquear item"}
                            </Button>
                          )}
                          {data.capabilities.reroute && (
                            <Button
                              disabled={itemBusy || cloudUnavailable}
                              onClick={() => onRequestItemOperation(ticket, item, "reroute")}
                              size="sm"
                              variant="ghost"
                            >
                              Mudar de praça
                            </Button>
                          )}
                          {cloudUnavailable &&
                            ((!data.capabilities.offlineBlock && data.capabilities.block) ||
                              data.capabilities.reroute) && (
                              <small>Esta ação exige conexão com o servidor.</small>
                            )}
                        </div>
                      </details>
                    )}
                  {itemError && (
                    <p className="kds-action-error" role="alert">
                      {itemError}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {ticketAdvanceBlocked && (
          <p className="kds-inline-alert" id={`kds-blocker-${ticket.id}`} role="status">
            {blockedItems.length > 0
              ? `${blockedItems.length} item(ns) bloqueado(s). Resolva antes de avançar o ticket.`
              : `${attentionPending.length} alerta(s) crítico(s) aguardando ciência antes de marcar pronto.`}
          </p>
        )}

        {canSequenceCourses && data.capabilities.courseFire && items.length > 0 && (
          <details className="kds-course-actions">
            <summary>Fogo e espera por curso</summary>
            <div>
              {courses.map((course) => {
                const key = `${prefix}course:${course}:`;
                const busy = [...busyKeys].some((entry) => entry.startsWith(key));
                return (
                  <span className="kds-course-action" key={course}>
                    <strong>{courseLabel(course)}</strong>
                    <Button
                      disabled={busy}
                      onClick={() => onCourseState(ticket, course, "held")}
                      size="sm"
                      variant="ghost"
                    >
                      Segurar
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => onCourseState(ticket, course, "fired")}
                      size="sm"
                      variant="secondary"
                    >
                      Fogo
                    </Button>
                  </span>
                );
              })}
            </div>
          </details>
        )}

        {next && (
          <Button
            aria-busy={cardBusy}
            aria-describedby={ticketAdvanceBlocked ? `kds-blocker-${ticket.id}` : undefined}
            aria-keyshortcuts="Enter Space"
            data-kds-bump
            disabled={cardBusy || items.length === 0 || ticketAdvanceBlocked}
            onClick={() => onTicketState(ticket, next as "preparing" | "ready")}
          >
            {cardBusy ? "Confirmando…" : kdsActionLabel[ticket.status]}
          </Button>
        )}

        {((ticket.status === "ready" && data.capabilities.recall) || canCancel) && (
          <details className="kds-more-actions">
            <summary>Mais ações do ticket</summary>
            <div>
              {ticket.status === "ready" && data.capabilities.recall && (
                <Button
                  disabled={cardBusy || items.length === 0}
                  onClick={() => onRecall(ticket)}
                  size="sm"
                  variant="secondary"
                >
                  Reabrir ticket
                </Button>
              )}
              {canCancel && (
                <Button
                  aria-label={`Cancelar ticket ${reference}`}
                  disabled={cardBusy || items.length === 0}
                  onClick={() => onRequestCancel(ticket)}
                  size="sm"
                  variant="danger"
                >
                  Cancelar ticket
                </Button>
              )}
            </div>
          </details>
        )}
        {cardError && (
          <p className="kds-action-error" role="alert">
            {cardError}
          </p>
        )}
      </Card>
    </article>
  );
}

export function RealKdsPage({
  scope,
  area,
  canManageUnitSettings = false,
}: {
  scope: PilotScope;
  area?: KdsArea;
  canManageUnitSettings?: boolean;
}) {
  const remote = useRemote(
    scope,
    () => scope.load("kds", undefined, () => api.pilot.kds(scope.organizationId, scope.unitId)),
    parseKds,
  );
  const storagePrefix = kdsStoragePrefix(scope.unitId);
  const [terminalInstallationId] = useState(installationId);
  const [viewMode, setViewMode] = useState<KdsViewMode>(() =>
    area === "station" || area === "pass"
      ? area
      : persistentValue(`${storagePrefix}:mode`) === "pass"
        ? "pass"
        : "station",
  );
  const operationalViewMode = area === "station" || area === "pass" ? area : viewMode;
  const [stationId, setStationId] = useState(
    () => persistentValue(`${storagePrefix}:station`) ?? "all",
  );
  const [stationLocked, setStationLocked] = useState(
    () => persistentValue(`${storagePrefix}:station-locked`) === "true",
  );
  const [density, setDensity] = useState<KdsDensity>(() =>
    persistentValue(`${storagePrefix}:density`) === "comfortable" ? "comfortable" : "compact",
  );
  const [allDayExpanded, setAllDayExpanded] = useState(
    () => persistentValue(`${storagePrefix}:all-day-expanded`) === "true",
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => sessionValue(`${storagePrefix}:sound`) === "true",
  );
  const [terminalLabel, setTerminalLabel] = useState(
    () => persistentValue(`${storagePrefix}:terminal-label`) ?? "KDS principal",
  );
  const [fullscreenPreferred, setFullscreenPreferred] = useState(
    () => persistentValue(`${storagePrefix}:fullscreen-preferred`) === "true",
  );
  const [bumpMap, setBumpMap] = useState<KdsBumpBarMap>(() =>
    readKdsBumpBarMap(`${storagePrefix}:bump-map`),
  );
  const [printer, setPrinter] = useState<KdsPrinterPreferences>(() =>
    printerPreferences(`${storagePrefix}:printer`),
  );
  const [terminalProfileStatus, setTerminalProfileStatus] = useState<
    "local" | "loading" | "synced" | "error"
  >("local");
  const [terminalProfileMessage, setTerminalProfileMessage] = useState(
    "Preferências mantidas localmente neste terminal.",
  );
  const [terminalProfileBusy, setTerminalProfileBusy] = useState(false);
  const [availabilityProducts, setAvailabilityProducts] = useState<KdsProductAvailability[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [liveMessage, setLiveMessage] = useState("Produção carregando.");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [cancelAlerts, setCancelAlerts] = useState<KdsCancellationAlert[]>([]);
  const [acknowledgedCancellations, setAcknowledgedCancellations] = useState<Set<string>>(() => {
    const stored = persistentValue(`${storagePrefix}:cancellations`);
    try {
      const parsed = stored ? JSON.parse(stored) : [];
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string").slice(-100)
          : [],
      );
    } catch {
      return new Set();
    }
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [cancelTicketId, setCancelTicketId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelPin, setCancelPin] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [cancelFormError, setCancelFormError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [realtimeFreshness, setRealtimeFreshness] = useState<RealtimeFreshness | null>(null);
  const [readyNotices, setReadyNotices] = useState<ReadyNotice[]>([]);
  const [itemOperation, setItemOperation] = useState<ItemOperation | null>(null);
  const [itemOperationCode, setItemOperationCode] = useState<KdsBlockCode>("other");
  const [itemOperationReason, setItemOperationReason] = useState("");
  const [itemOperationStationId, setItemOperationStationId] = useState("");
  const [itemOperationError, setItemOperationError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<KdsAnalytics | null>(null);
  const [analyticsWindowHours, setAnalyticsWindowHours] = useState(24);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [focusedPrintTicketId, setFocusedPrintTicketId] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const confirmationsRef = useRef(new Map<string, PendingConfirmation>());
  const inFlightRef = useRef(new Set<string>());
  const previousAlertsRef = useRef<Set<string> | null>(null);
  const previousPendingRef = useRef<Set<string> | null>(null);
  const previousReadyOrdersRef = useRef<Set<string> | null>(null);
  const terminalProfileLoadedRef = useRef<string | null>(null);
  const availabilityLoadRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 30_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (area !== "station" && area !== "pass") return;
    setViewMode(area);
    savePersistentValue(`${storagePrefix}:mode`, area);
    saveKdsLastOperationalArea(scope.unitId, area);
  }, [area, scope.unitId, storagePrefix]);

  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const data = remote.state.data;
    if (data.productAvailability.length > 0) {
      setAvailabilityProducts(data.productAvailability);
    }
    if (!data.capabilities.availability) return;
    const loadKey = `${scope.organizationId}:${scope.unitId}`;
    if (availabilityLoadRef.current === loadKey) return;
    availabilityLoadRef.current = loadKey;
    let active = true;
    void api.pilot
      .kdsProductAvailability(scope.organizationId, scope.unitId)
      .then(parseKdsProductAvailability)
      .then((products) => {
        if (active) setAvailabilityProducts(products);
      })
      .catch(() => {
        // O snapshot legado continua sendo a fonte visível quando o endpoint dedicado não existe.
      });
    return () => {
      active = false;
    };
  }, [remote.state, scope.organizationId, scope.unitId]);

  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const data = remote.state.data;
    if (!data.capabilities.terminalProfileRead) {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Servidor sem perfil de terminal; fallback local ativo.");
      return;
    }
    const loadKey = `${scope.organizationId}:${scope.unitId}:${terminalInstallationId}`;
    if (terminalProfileLoadedRef.current === loadKey) return;
    terminalProfileLoadedRef.current = loadKey;
    setTerminalProfileStatus("loading");
    setTerminalProfileMessage("Consultando o perfil registrado para esta instalação.");
    let active = true;
    void api.pilot
      .kdsTerminalProfile(scope.organizationId, scope.unitId, terminalInstallationId)
      .then(parseKdsTerminalProfile)
      .then((profile) => {
        if (!active) return;
        setTerminalLabel(profile.label);
        setViewMode(profile.mode);
        setFullscreenPreferred(profile.fullscreenPreferred);
        setSoundEnabled(profile.soundEnabled);
        savePersistentValue(`${storagePrefix}:terminal-label`, profile.label);
        savePersistentValue(`${storagePrefix}:mode`, profile.mode);
        savePersistentValue(
          `${storagePrefix}:fullscreen-preferred`,
          String(profile.fullscreenPreferred),
        );
        saveSessionValue(`${storagePrefix}:sound`, String(profile.soundEnabled));
        if (profile.mode === "station" && profile.stationId) {
          setStationId(profile.stationId);
          setStationLocked(true);
          savePersistentValue(`${storagePrefix}:station`, profile.stationId);
          savePersistentValue(`${storagePrefix}:station-locked`, "true");
        }
        setTerminalProfileStatus("synced");
        setTerminalProfileMessage("Perfil sincronizado com a unidade.");
        if ((area === "station" || area === "pass") && area !== profile.mode) {
          window.location.hash = `#/kds/${profile.mode}`;
        }
      })
      .catch(() => {
        if (!active) return;
        setTerminalProfileStatus("error");
        setTerminalProfileMessage(
          "Perfil remoto indisponível; preferências locais permanecem ativas neste terminal.",
        );
      });
    return () => {
      active = false;
    };
  }, [
    area,
    remote.state,
    scope.organizationId,
    scope.unitId,
    storagePrefix,
    terminalInstallationId,
  ]);

  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const station = remote.state.data.stations.find((candidate) => candidate.id === stationId);
    saveKdsStationLabel(scope.unitId, station?.name ?? "Todas as praças");
  }, [remote.state, scope.unitId, stationId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      const ticket = element?.closest<HTMLElement>("[data-kds-ticket]");
      if (ticket?.dataset.kdsTicket) setFocusedPrintTicketId(ticket.dataset.kdsTicket);
    };
    workspace.addEventListener("focusin", onFocusIn);
    return () => workspace.removeEventListener("focusin", onFocusIn);
  }, []);

  const printTicket = useCallback(
    async (requestedTicketId?: string) => {
      const workspace = workspaceRef.current;
      if (!workspace || typeof window === "undefined") return;
      const ticketId = requestedTicketId ?? focusedPrintTicketId;
      const candidates = [...workspace.querySelectorAll<HTMLElement>("[data-kds-ticket]")];
      const target =
        candidates.find((candidate) => candidate.dataset.kdsTicket === ticketId) ?? candidates[0];
      if (!target) {
        setLiveMessage("Nenhum ticket disponível para impressão.");
        return;
      }
      if (remote.state.status === "ready") {
        const ticket = remote.state.data.tickets.find(
          (candidate) => candidate.id === target.dataset.kdsTicket,
        );
        if (ticket) {
          const request = createKdsThermalPrintRequest(
            ticket,
            itemsForTicket(remote.state.data, ticket.id),
            printer,
          );
          const result = await sendShellPrintJob(request.job, request.idempotencyKey);
          if (result?.success) {
            setLiveMessage(
              `Ticket ${ticket.reference ?? ticket.id.slice(0, 6)} impresso e confirmado.`,
            );
            return;
          }
          if (result) {
            setLiveMessage(
              `Impressora térmica indisponível (${result.errorCode ?? result.status ?? "erro"}). Abrindo contingência.`,
            );
          }
        }
      }
      target.classList.add("kds-print-target");
      workspace.classList.add("kds-printing");
      const cleanup = () => {
        target.classList.remove("kds-print-target");
        workspace.classList.remove("kds-printing");
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup, { once: true });
      window.setTimeout(cleanup, 60_000);
      setLiveMessage(
        "Diálogo de impressão aberto. O GiroMesa não confirma a conclusão na impressora.",
      );
      window.print();
    },
    [focusedPrintTicketId, printer, remote.state],
  );

  const refreshManually = useCallback(async () => {
    setManualRefreshing(true);
    setLiveMessage("Atualizando produção.");
    try {
      await remote.refresh();
    } finally {
      setManualRefreshing(false);
    }
  }, [remote.refresh]);

  useEffect(
    () =>
      subscribeScopeRealtime(
        { organizationId: scope.organizationId, unitId: scope.unitId },
        remote.refresh,
        setRealtimeStatus,
        15_000,
        {
          onFreshness: setRealtimeFreshness,
          shouldInvalidate: (event) =>
            shouldInvalidateKdsTopic(event.topic) ||
            ["kds", "kds_ticket", "kds_batch", "order", "pos_order", "order_item"].includes(
              event.aggregateType ?? "",
            ),
        },
      ),
    [remote.refresh, scope.organizationId, scope.unitId],
  );

  useEffect(() => {
    const onFullscreenChange = () =>
      setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (remote.state.status !== "ready") return;
    const data = remote.state.data;
    const confirmed: string[] = [];
    for (const [key, pending] of confirmationsRef.current) {
      if (!pending.confirmed(data)) continue;
      globalThis.clearTimeout(pending.timeout);
      confirmationsRef.current.delete(key);
      inFlightRef.current.delete(key);
      confirmed.push(key);
      setLiveMessage(`${pending.label} confirmada.`);
    }
    if (confirmed.length > 0) {
      setBusyKeys((current) => {
        const next = new Set(current);
        for (const key of confirmed) next.delete(key);
        return next;
      });
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) {
          document.querySelector<HTMLButtonElement>("[data-kds-bump]:not(:disabled)")?.focus();
        }
      });
    }

    const currentAlertIds = new Set(data.alerts.map((alert) => alert.id));
    const previousAlerts = previousAlertsRef.current;
    const newlyCanceled = data.alerts.filter(
      (alert) =>
        !acknowledgedCancellations.has(alert.id) &&
        (previousAlerts === null || !previousAlerts.has(alert.id)),
    );
    if (newlyCanceled.length > 0) {
      setCancelAlerts((current) => {
        const ids = new Set(current.map((alert) => alert.id));
        return [...current, ...newlyCanceled.filter((alert) => !ids.has(alert.id))];
      });
      setLiveMessage(`${newlyCanceled.length} pedido(s) cancelado(s).`);
    }
    previousAlertsRef.current = currentAlertIds;

    const pendingIds = new Set(
      data.tickets.filter((ticket) => ticket.status === "pending").map((ticket) => ticket.id),
    );
    const previousPending = previousPendingRef.current;
    const newTickets = previousPending
      ? [...pendingIds].filter((ticketId) => !previousPending.has(ticketId))
      : [];
    if (newTickets.length > 0) {
      setLiveMessage(`${newTickets.length} novo(s) ticket(s) aguardando preparo.`);
      if (soundEnabled) void playKdsSound();
    }
    previousPendingRef.current = pendingIds;

    const ticketsByOrder = new Map<string, KdsTicket[]>();
    for (const ticket of data.tickets.filter((ticket) => ticket.status !== "canceled")) {
      const current = ticketsByOrder.get(ticket.orderId) ?? [];
      current.push(ticket);
      ticketsByOrder.set(ticket.orderId, current);
    }
    const readyOrderIds = new Set(
      [...ticketsByOrder.entries()]
        .filter(([, tickets]) =>
          tickets.every(
            (ticket) =>
              ticket.status === "ready" && ticket.handedOffAt === null && ticket.servedAt === null,
          ),
        )
        .map(([orderId]) => orderId),
    );
    const previousReadyOrders = previousReadyOrdersRef.current;
    const newlyReady = previousReadyOrders
      ? [...readyOrderIds].filter((orderId) => !previousReadyOrders.has(orderId))
      : [];
    if (newlyReady.length > 0) {
      setReadyNotices((current) => {
        const known = new Set(current.map((notice) => notice.orderId));
        const notices = newlyReady.flatMap((orderId): ReadyNotice[] => {
          if (known.has(orderId)) return [];
          const ticket = ticketsByOrder.get(orderId)?.[0];
          if (!ticket) return [];
          const reference = kdsTicketReference(ticket);
          const context = [ticket.tableLabel, ticket.tabLabel]
            .filter((value): value is string => Boolean(value) && value !== reference)
            .join(" · ");
          return [
            {
              orderId,
              reference,
              context: context || null,
              readyAt: ticket.orderReadyNotifiedAt,
            },
          ];
        });
        return [...current, ...notices].slice(-8);
      });
      setLiveMessage(`${newlyReady.length} pedido(s) pronto(s) dentro do GiroMesa.`);
      if (soundEnabled) void playKdsSound();
    }
    previousReadyOrdersRef.current = readyOrderIds;
  }, [acknowledgedCancellations, remote.state, soundEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const bumpAction = kdsBumpActionForKey(bumpMap, event.key);
      if (bumpAction === "previous" || bumpAction === "next") {
        const buttons = [
          ...document.querySelectorAll<HTMLButtonElement>("[data-kds-bump]:not(:disabled)"),
        ];
        if (buttons.length === 0) return;
        const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const direction = bumpAction === "previous" ? -1 : 1;
        buttons[(activeIndex + direction + buttons.length) % buttons.length]?.focus();
        event.preventDefault();
        return;
      }
      if (bumpAction === "bump") {
        const active = document.activeElement;
        const button =
          active instanceof HTMLButtonElement && active.matches("[data-kds-bump]:not(:disabled)")
            ? active
            : document.querySelector<HTMLButtonElement>("[data-kds-bump]:not(:disabled)");
        button?.click();
        event.preventDefault();
      } else if (bumpAction === "refresh") {
        if (!manualRefreshing) void refreshManually();
        event.preventDefault();
      } else if (bumpAction === "print") {
        void printTicket();
        event.preventDefault();
      } else if (key === "m") {
        setSoundEnabled((enabled) => {
          const next = !enabled;
          saveSessionValue(`${storagePrefix}:sound`, String(next));
          if (next) void playKdsSound();
          return next;
        });
        event.preventDefault();
      } else if (key === "f") {
        if (document.fullscreenElement === workspaceRef.current) void document.exitFullscreen();
        else void workspaceRef.current?.requestFullscreen();
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [bumpMap, manualRefreshing, printTicket, refreshManually, storagePrefix]);

  useEffect(
    () => () => {
      for (const pending of confirmationsRef.current.values()) {
        globalThis.clearTimeout(pending.timeout);
      }
    },
    [],
  );

  function selectStation(value: string) {
    setStationId(value);
    savePersistentValue(`${storagePrefix}:station`, value);
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  function toggleStationLock() {
    setStationLocked((locked) => {
      const next = !locked;
      savePersistentValue(`${storagePrefix}:station-locked`, String(next));
      return next;
    });
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    saveSessionValue(`${storagePrefix}:sound`, String(next));
    if (next) void playKdsSound();
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch (error) {
      setErrors((current) => ({ ...current, global: errorMessage(error) }));
    }
  }

  async function runAction(input: KdsActionInput) {
    const actionScope = `${input.key.split(":").slice(0, 2).join(":")}:`;
    if ([...inFlightRef.current].some((key) => key.startsWith(actionScope))) return false;
    inFlightRef.current.add(input.key);
    setBusyKeys((current) => new Set(current).add(input.key));
    setErrors((current) => {
      const next = { ...current };
      delete next[input.key];
      return next;
    });
    setLiveMessage(`${input.label} em confirmação.`);
    try {
      const response = await scope.dispatch(
        input.eventType,
        pilotMutation(input.action, { operation: input.eventType, ...input.data }, input.delivery),
        input.execute,
      );
      input.accepted?.(response);
      const timeout = window.setTimeout(() => {
        confirmationsRef.current.delete(input.key);
        inFlightRef.current.delete(input.key);
        setBusyKeys((current) => {
          const next = new Set(current);
          next.delete(input.key);
          return next;
        });
        setErrors((current) => ({
          ...current,
          [input.key]:
            "A API recebeu a ação, mas o estado atualizado não chegou. Atualize antes de repetir.",
        }));
        setLiveMessage(`${input.label} ainda sem confirmação do estado atualizado.`);
      }, 12_000);
      confirmationsRef.current.set(input.key, {
        label: input.label,
        confirmed: input.confirmed,
        timeout,
      });
      remote.retry();
      return true;
    } catch (error) {
      inFlightRef.current.delete(input.key);
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(input.key);
        return next;
      });
      setErrors((current) => ({ ...current, [input.key]: errorMessage(error) }));
      setLiveMessage(`${input.label} não confirmada.`);
      return false;
    }
  }

  function ticketState(ticket: KdsTicket, state: "preparing" | "ready") {
    void runAction({
      action: KDS_PILOT_ACTIONS.ticketState,
      key: `ticket:${ticket.id}:state:${state}`,
      label: state === "preparing" ? "Início do preparo" : "Ticket pronto",
      eventType: "pos.kds.transition_requested",
      data: { ticketId: ticket.id, state },
      execute: (idempotencyKey) =>
        api.pilot.transitionKds(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          state,
          idempotencyKey,
        ),
      confirmed: (nextData) =>
        nextData.tickets.find((row) => row.id === ticket.id)?.status === state,
    });
  }

  function itemState(
    ticket: KdsTicket,
    item: KdsItem,
    state: "preparing" | "ready",
    quantity?: number,
  ) {
    const minimumReadyQuantity =
      state === "ready" && quantity !== undefined
        ? Math.min(item.quantity, item.readyQuantity + quantity)
        : undefined;
    void runAction({
      action: KDS_PILOT_ACTIONS.itemState,
      key: `ticket:${ticket.id}:item:${item.id}:state:${state}:${quantity ?? "all"}`,
      label:
        state === "ready" && quantity !== undefined
          ? `${quantity} unidade(s) de ${item.productName} pronta(s)`
          : `${item.productName} ${state === "ready" ? "pronto" : "em preparo"}`,
      eventType: "pos.kds.item_transition_requested",
      data: {
        ticketId: ticket.id,
        itemId: item.id,
        state,
        ...(quantity === undefined ? {} : { quantity }),
      },
      execute: (idempotencyKey) =>
        api.pilot.transitionKdsItem(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          item.id,
          state,
          quantity,
          idempotencyKey,
        ),
      confirmed: (nextData) =>
        isKdsItemTransitionConfirmed(nextData, ticket.id, item.id, state, minimumReadyQuantity),
    });
  }

  function acknowledgeAttention(
    ticket: KdsTicket,
    item: KdsItem,
    attention: KdsAttention,
    data: KdsData,
  ) {
    if (!attention.revision) {
      setErrors((current) => ({
        ...current,
        [`ticket:${ticket.id}:item:${item.id}:attention:${attention.noteId}:missing`]:
          "O servidor não forneceu a revisão necessária para uma ciência auditável.",
      }));
      return;
    }
    void runAction({
      action: KDS_PILOT_ACTIONS.acknowledgeAttention,
      key: `ticket:${ticket.id}:item:${item.id}:attention:${attention.noteId}:${attention.revision}`,
      label: attention.noteId === "allergy" ? "Ciência de alergia" : "Ciência de observação",
      eventType: "pos.kds.critical_note_acknowledgement_requested",
      data: {
        ticketId: ticket.id,
        itemId: item.id,
        noteId: attention.noteId,
        revision: attention.revision,
      },
      delivery: data.capabilities.offlineAttentionAcknowledgement ? "edge-capable" : "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.acknowledgeKdsAttention(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          item.id,
          attention.noteId,
          attention.revision as string,
          idempotencyKey,
        ),
      confirmed: (nextData) => {
        const assignment = findKdsItemAssignment(nextData, ticket.id, item.id);
        const current = assignment?.attention.find((row) => row.noteId === attention.noteId);
        return (
          assignment === null ||
          current === undefined ||
          (current.revision === attention.revision && current.acknowledgedAt !== null)
        );
      },
    });
  }

  function requestItemOperation(
    ticket: KdsTicket,
    item: KdsItem,
    kind: ItemOperation["kind"],
    stations: KdsData["stations"],
  ) {
    setItemOperation({ kind, ticketId: ticket.id, itemId: item.id });
    setItemOperationCode(item.blocked?.code ?? "other");
    setItemOperationReason("");
    setItemOperationStationId(
      kind === "reroute"
        ? (stations.find((station) => station.id !== ticket.stationId)?.id ?? "")
        : "",
    );
    setItemOperationError(null);
  }

  function closeItemOperation() {
    setItemOperation(null);
    setItemOperationReason("");
    setItemOperationStationId("");
    setItemOperationError(null);
  }

  function submitItemOperation(event: FormEvent<HTMLFormElement>, data: KdsData) {
    event.preventDefault();
    if (!itemOperation) return;
    const reason = itemOperationReason.trim();
    if (reason.length < 3) {
      setItemOperationError("Informe um motivo com pelo menos 3 caracteres.");
      return;
    }
    const currentRow = data.items.find(
      (row) => row.ticketId === itemOperation.ticketId && row.item.id === itemOperation.itemId,
    );
    const ticket = data.tickets.find((row) => row.id === itemOperation.ticketId);
    if (!currentRow || !ticket) {
      setItemOperationError("O item não está mais neste ticket. Atualize a produção.");
      return;
    }
    const item = currentRow.item;
    if (itemOperation.kind === "reroute") {
      const targetStationId = itemOperationStationId;
      if (!targetStationId || targetStationId === ticket.stationId) {
        setItemOperationError("Escolha uma praça diferente da atual.");
        return;
      }
      void runAction({
        action: KDS_PILOT_ACTIONS.rerouteItem,
        key: `ticket:${ticket.id}:item:${item.id}:reroute:${targetStationId}`,
        label: `Mudança de praça de ${item.productName}`,
        eventType: "pos.kds.item_reroute_requested",
        data: { ticketId: ticket.id, itemId: item.id, stationId: targetStationId, reason },
        delivery: "cloud-only",
        execute: (idempotencyKey) =>
          api.pilot.rerouteKdsItem(
            scope.organizationId,
            scope.unitId,
            ticket.id,
            item.id,
            targetStationId,
            reason,
            idempotencyKey,
          ),
        confirmed: (nextData) =>
          isKdsRerouteConfirmed(nextData, ticket.id, item.id, targetStationId),
      });
      closeItemOperation();
      return;
    }
    const block = itemOperation.kind === "block";
    void runAction({
      action: block ? KDS_PILOT_ACTIONS.blockItem : KDS_PILOT_ACTIONS.unblockItem,
      key: `ticket:${ticket.id}:item:${item.id}:${block ? "block" : "unblock"}`,
      label: `${item.productName} ${block ? "bloqueado" : "desbloqueado"}`,
      eventType: `pos.kds.item_${block ? "block" : "unblock"}_requested`,
      data: {
        ticketId: ticket.id,
        itemId: item.id,
        ...(block ? { code: itemOperationCode } : {}),
        reason,
      },
      delivery: data.capabilities.offlineBlock ? "edge-capable" : "cloud-only",
      execute: (idempotencyKey) =>
        block
          ? api.pilot.blockKdsItem(
              scope.organizationId,
              scope.unitId,
              ticket.id,
              item.id,
              { code: itemOperationCode, reason },
              idempotencyKey,
            )
          : api.pilot.unblockKdsItem(
              scope.organizationId,
              scope.unitId,
              ticket.id,
              item.id,
              reason,
              idempotencyKey,
            ),
      confirmed: (nextData) => {
        const assignment = findKdsItemAssignment(nextData, ticket.id, item.id);
        return assignment !== null && Boolean(assignment.blocked?.active) === block;
      },
    });
    closeItemOperation();
  }

  function refireItem(ticket: KdsTicket, item: KdsItem) {
    void runAction({
      action: KDS_PILOT_ACTIONS.refireItem,
      key: `ticket:${ticket.id}:item:${item.id}:refire`,
      label: `Refação de ${item.productName}`,
      eventType: "pos.kds.item_refire_requested",
      data: { ticketId: ticket.id, itemId: item.id, reason: "Refação solicitada no KDS" },
      execute: (idempotencyKey) =>
        api.pilot.refireKdsItem(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          item.id,
          "Refação solicitada no KDS",
          idempotencyKey,
        ),
      confirmed: (nextData) =>
        nextData.items.find((row) => row.ticketId === ticket.id && row.item.id === item.id)?.item
          .kdsState === "preparing",
    });
  }

  function courseState(ticket: KdsTicket, course: KdsItem["course"], state: "held" | "fired") {
    void runAction({
      action: KDS_PILOT_ACTIONS.courseState,
      key: `ticket:${ticket.id}:course:${course}:${state}`,
      label: state === "held" ? "Curso segurado" : "Fogo liberado",
      eventType: "pos.kds.course_state_requested",
      data: { ticketId: ticket.id, course, state },
      execute: (idempotencyKey) =>
        api.pilot.setKdsCourseState(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          course,
          state,
          idempotencyKey,
        ),
      confirmed: (nextData) =>
        itemsForTicket(nextData, ticket.id)
          .filter((item) => item.course === course)
          .every((item) => (state === "held" ? item.held : !item.held && item.firedAt !== null)),
    });
  }

  function orderPriority(orderId: string, tickets: KdsTicket[]) {
    const prioritized = tickets.some((ticket) => ticket.rush || ticket.priority >= 50);
    const nextPriority = prioritized ? 0 : 100;
    const reason = prioritized
      ? "Prioridade removida no passe do KDS"
      : "Pedido priorizado no passe do KDS";
    void runAction({
      action: KDS_PILOT_ACTIONS.orderPriority,
      key: `order:${orderId}:priority`,
      label: prioritized ? "Prioridade removida" : "Pedido priorizado",
      eventType: "pos.kds.order_priority_requested",
      data: { orderId, priority: nextPriority, reason, installationId: terminalInstallationId },
      delivery: "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.setKdsOrderPriority(
          scope.organizationId,
          scope.unitId,
          orderId,
          nextPriority,
          reason,
          idempotencyKey,
          terminalInstallationId,
        ),
      confirmed: (nextData) =>
        nextData.tickets
          .filter((ticket) => ticket.orderId === orderId)
          .every((ticket) => (ticket.rush || ticket.priority >= 50) === nextPriority >= 50),
    });
  }

  function recall(ticket: KdsTicket) {
    void runAction({
      action: KDS_PILOT_ACTIONS.recall,
      key: `ticket:${ticket.id}:recall`,
      label: "Ticket reaberto",
      eventType: "pos.kds.recall_requested",
      data: { ticketId: ticket.id, reason: "Refação solicitada no KDS" },
      execute: (idempotencyKey) =>
        api.pilot.recallKds(
          scope.organizationId,
          scope.unitId,
          ticket.id,
          "Refação solicitada no KDS",
          idempotencyKey,
        ),
      confirmed: (nextData) =>
        nextData.tickets.find((row) => row.id === ticket.id)?.status === "preparing",
    });
  }

  function handoff(orderId: string, target: "expedition" | "served") {
    void runAction({
      action: KDS_PILOT_ACTIONS.handoff,
      key: `order:${orderId}:handoff:${target}`,
      label: target === "expedition" ? "Pedido recebido no passe" : "Entrega do pedido",
      eventType: "pos.kds.handoff_requested",
      data: { orderId, target },
      execute: (idempotencyKey) =>
        api.pilot.handoffKds(
          scope.organizationId,
          scope.unitId,
          orderId,
          target,
          undefined,
          idempotencyKey,
        ),
      confirmed: (nextData) => {
        const orderTickets = nextData.tickets.filter((ticket) => ticket.orderId === orderId);
        return target === "served"
          ? orderTickets.length === 0 || orderTickets.every((ticket) => ticket.servedAt !== null)
          : orderTickets.length > 0 &&
              orderTickets.every(
                (ticket) =>
                  ticket.status === "done" &&
                  ticket.handedOffAt !== null &&
                  ticket.servedAt === null,
              );
      },
    });
  }

  function createBatch(
    data: KdsData,
    input: { stationId: string; productId?: string; maxAssignments: number },
  ) {
    const previousIds = new Set(data.batches.map((batch) => batch.id));
    void runAction({
      action: KDS_PILOT_ACTIONS.createBatch,
      key: `batch:new:${input.stationId}:${input.productId ?? "mixed"}`,
      label: "Lote de produção criado",
      eventType: "pos.kds.batch_create_requested",
      data: input,
      delivery: "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.createKdsBatch(scope.organizationId, scope.unitId, input, idempotencyKey),
      confirmed: (nextData) => nextData.batches.some((batch) => !previousIds.has(batch.id)),
    });
  }

  function completeBatch(batch: KdsBatch) {
    void runAction({
      action: KDS_PILOT_ACTIONS.completeBatch,
      key: `batch:${batch.id}:complete`,
      label: "Lote concluído",
      eventType: "pos.kds.batch_complete_requested",
      data: { batchId: batch.id },
      delivery: "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.completeKdsBatch(scope.organizationId, scope.unitId, batch.id, idempotencyKey),
      confirmed: (nextData) => {
        const current = nextData.batches.find((row) => row.id === batch.id);
        return current === undefined || current.status === "completed";
      },
    });
  }

  function cancelBatch(batch: KdsBatch, reason: string) {
    void runAction({
      action: KDS_PILOT_ACTIONS.cancelBatch,
      key: `batch:${batch.id}:cancel`,
      label: "Lote cancelado",
      eventType: "pos.kds.batch_cancel_requested",
      data: { batchId: batch.id, reason },
      delivery: "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.cancelKdsBatch(
          scope.organizationId,
          scope.unitId,
          batch.id,
          reason,
          idempotencyKey,
        ),
      confirmed: (nextData) => {
        const current = nextData.batches.find((row) => row.id === batch.id);
        return current === undefined || current.status === "canceled";
      },
    });
  }

  async function loadAnalytics(stationFilter: string) {
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const value = await api.pilot.kdsAnalytics(scope.organizationId, scope.unitId, {
        ...(stationFilter === "all" ? {} : { stationId: stationFilter }),
        windowHours: analyticsWindowHours,
      });
      setAnalytics(parseKdsAnalytics(value));
    } catch (error) {
      setAnalyticsError(errorMessage(error));
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function testSound(): Promise<boolean> {
    const succeeded = await playKdsSound();
    if (succeeded) {
      setSoundEnabled(true);
      saveSessionValue(`${storagePrefix}:sound`, "true");
      setLiveMessage("Teste sonoro concluído neste terminal.");
    } else {
      setLiveMessage("O navegador não conseguiu reproduzir o teste sonoro.");
    }
    return succeeded;
  }

  function changeProductAvailability(change: KdsAvailabilityChange): Promise<boolean> {
    const extendedLifecycle =
      Object.hasOwn(change, "resetAt") || Object.hasOwn(change, "dailyStock");
    const offlineCapability =
      remote.state.status === "ready" &&
      (extendedLifecycle
        ? remote.state.data.capabilities.offlineAvailabilityLifecycle
        : remote.state.data.capabilities.offlineAvailability);
    return runAction({
      action: KDS_PILOT_ACTIONS.availability,
      key: `product:${change.productId}:availability`,
      label: change.available
        ? change.dailyStock === null
          ? `${change.productName} disponível`
          : `${change.productName} com limite atualizado`
        : `${change.productName} esgotado`,
      eventType: "pos.kds.product_availability_requested",
      data: {
        productId: change.productId,
        available: change.available,
        reason: change.reason,
        ...(Object.hasOwn(change, "resetAt") ? { resetAt: change.resetAt } : {}),
        ...(Object.hasOwn(change, "dailyStock") ? { dailyStock: change.dailyStock } : {}),
      },
      delivery: offlineCapability ? "edge-capable" : "cloud-only",
      execute: (idempotencyKey) =>
        api.pilot.setKdsProductAvailability(
          scope.organizationId,
          scope.unitId,
          change.productId,
          change.available,
          change.reason,
          idempotencyKey,
          {
            ...(Object.hasOwn(change, "resetAt") ? { resetAt: change.resetAt } : {}),
            ...(Object.hasOwn(change, "dailyStock") ? { dailyStock: change.dailyStock } : {}),
          },
        ),
      accepted: (response) => {
        try {
          const [product] = parseKdsProductAvailability({ products: [response] });
          if (!product) return;
          setAvailabilityProducts((current) => [
            ...current.filter((item) => item.productId !== product.productId),
            product,
          ]);
        } catch {
          // O snapshot seguinte continua sendo a confirmação autoritativa.
        }
      },
      confirmed: (nextData) => {
        const product = nextData.productAvailability.find(
          (item) => item.productId === change.productId,
        );
        if (!product) return nextData.productAvailability.length === 0;
        if (product.available !== change.available) return false;
        if (Object.hasOwn(change, "dailyStock") && product.dailyStock !== change.dailyStock) {
          return false;
        }
        return true;
      },
    });
  }

  function changeTerminalLabel(label: string) {
    setTerminalLabel(label);
    savePersistentValue(`${storagePrefix}:terminal-label`, label);
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  function changePreferredMode(mode: KdsViewMode) {
    setViewMode(mode);
    savePersistentValue(`${storagePrefix}:mode`, mode);
    saveKdsLastOperationalArea(scope.unitId, mode);
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  function changeFullscreenPreference(preferred: boolean) {
    setFullscreenPreferred(preferred);
    savePersistentValue(`${storagePrefix}:fullscreen-preferred`, String(preferred));
    if (terminalProfileStatus === "synced") {
      setTerminalProfileStatus("local");
      setTerminalProfileMessage("Alterações locais aguardam sincronização com a unidade.");
    }
  }

  async function syncTerminalProfile() {
    if (remote.state.status !== "ready") return;
    const data = remote.state.data;
    if (!data.capabilities.terminalProfileManage) {
      setTerminalProfileStatus("error");
      setTerminalProfileMessage("O servidor não autorizou a gestão deste perfil de terminal.");
      return;
    }
    const selectedStationId =
      stationId !== "all" && data.stations.some((station) => station.id === stationId)
        ? stationId
        : null;
    if (viewMode === "station" && selectedStationId === null) {
      setTerminalProfileStatus("error");
      setTerminalProfileMessage("Escolha uma praça específica antes de sincronizar o modo Praça.");
      return;
    }
    if (terminalLabel.trim().length === 0) {
      setTerminalProfileStatus("error");
      setTerminalProfileMessage("Informe um nome para identificar este terminal.");
      return;
    }
    setTerminalProfileBusy(true);
    setTerminalProfileMessage("Sincronizando preferências deste terminal.");
    try {
      const response = await api.pilot.updateKdsTerminalProfile(
        scope.organizationId,
        scope.unitId,
        terminalInstallationId,
        {
          mode: viewMode,
          stationId: viewMode === "station" ? selectedStationId : null,
          label: terminalLabel.trim(),
          soundEnabled,
          fullscreenPreferred,
        },
      );
      const profile = parseKdsTerminalProfile(response);
      setTerminalLabel(profile.label);
      setTerminalProfileStatus("synced");
      setTerminalProfileMessage("Perfil sincronizado com a unidade.");
      setLiveMessage("Perfil do terminal sincronizado.");
    } catch (error) {
      setTerminalProfileStatus("error");
      setTerminalProfileMessage(
        `${errorMessage(error)} Preferências locais foram preservadas neste terminal.`,
      );
    } finally {
      setTerminalProfileBusy(false);
    }
  }

  function requestTicketCancellation(ticket: KdsTicket) {
    setCancelReason("");
    setCancelPin("");
    setCancelConfirmed(false);
    setCancelFormError(null);
    setCancelTicketId(ticket.id);
  }

  function closeTicketCancellation() {
    setCancelTicketId(null);
    setCancelReason("");
    setCancelPin("");
    setCancelConfirmed(false);
    setCancelFormError(null);
  }

  function submitTicketCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticketId = cancelTicketId;
    const reason = cancelReason.trim();
    if (!ticketId) return;
    if (reason.length < 3) {
      setCancelFormError("Informe um motivo com pelo menos 3 caracteres.");
      return;
    }
    if (!/^\d{4,8}$/.test(cancelPin)) {
      setCancelFormError("Informe um PIN gerencial de 4 a 8 dígitos.");
      return;
    }
    if (!cancelConfirmed) {
      setCancelFormError("Confirme que a produção deste ticket será interrompida.");
      return;
    }
    const approval = {
      approverMembershipId: scope.membershipId,
      pin: cancelPin,
      reason,
    };
    void runAction({
      action: KDS_PILOT_ACTIONS.cancelTicket,
      key: `ticket:${ticketId}:cancel`,
      label: "Cancelamento do ticket",
      eventType: "pos.kds.cancel_requested",
      data: { ticketId, approval },
      execute: (idempotencyKey) =>
        api.pilot.cancelKdsTicket(
          scope.organizationId,
          scope.unitId,
          ticketId,
          approval,
          idempotencyKey,
        ),
      confirmed: (nextData) => {
        const ticket = nextData.tickets.find((row) => row.id === ticketId);
        return (
          ticket?.status === "canceled" ||
          nextData.alerts.some((alert) => alert.ticketId === ticketId) ||
          ticket === undefined
        );
      },
    });
    closeTicketCancellation();
  }

  function acknowledgeCancellation(alert: KdsCancellationAlert) {
    setCancelAlerts((current) => current.filter((row) => row.id !== alert.id));
    setAcknowledgedCancellations((current) => {
      const ordered = [...current].filter((id) => id !== alert.id);
      ordered.push(alert.id);
      const pruned = ordered.slice(-100);
      savePersistentValue(`${storagePrefix}:cancellations`, JSON.stringify(pruned));
      return new Set(pruned);
    });
    setLiveMessage(`Ciência registrada neste terminal para ${cancellationReference(alert)}.`);
  }

  return (
    <RemoteGate remote={remote}>
      {(data) => {
        const stationExists = data.stations.some((station) => station.id === stationId);
        const effectiveStationId = stationId === "all" || stationExists ? stationId : "all";
        const stationName =
          data.stations.find((station) => station.id === effectiveStationId)?.name ??
          "Todas as praças";
        const operationalStationId = operationalViewMode === "pass" ? "all" : effectiveStationId;
        const cloudUnavailable =
          data.freshness.status === "offline" || data.freshness.projectionBlocked;
        const connectionReady =
          !cloudUnavailable &&
          remote.refreshError === null &&
          (realtimeStatus === "live" ||
            remote.lastSuccessfulAt !== null ||
            data.capturedAt !== null);
        const openingDay = kdsOperatingDay(new Date(now));
        const checklistKey = `${storagePrefix}:opening:${openingDay}:${effectiveStationId}`;
        const activeTickets = sortKdsTickets(
          data.tickets.filter(
            (ticket) =>
              ["pending", "preparing", "ready"].includes(ticket.status) &&
              (operationalStationId === "all" || ticket.stationId === operationalStationId),
          ),
          now,
        );
        const derivedAllDay = deriveKdsAllDay(data, activeTickets);
        const publishedAllDay = data.allDay.filter(
          (item) =>
            operationalStationId === "all" ||
            item.stationId === null ||
            item.stationId === operationalStationId,
        );
        const allDay = productiveKdsAllDay(
          derivedAllDay.length > 0 ? derivedAllDay : publishedAllDay,
        );
        const freshnessAge = kdsFreshnessAgeMinutes(data, now);
        const stale = freshnessAge !== null && freshnessAge >= 2;
        const freshness = data.freshness.projectionBlocked
          ? { label: "Projeção bloqueada", tone: "danger" as const, alert: true }
          : data.freshness.status === "offline"
            ? { label: "Operação offline", tone: "danger" as const, alert: true }
            : remote.refreshError
              ? { label: "Sincronização degradada", tone: "warning" as const, alert: false }
              : data.freshness.status === "degraded"
                ? { label: "Sincronização degradada", tone: "warning" as const, alert: false }
                : data.freshness.status === "stale" || stale
                  ? { label: "Dados atrasados", tone: "warning" as const, alert: false }
                  : data.capturedAt
                    ? { label: "Dados atualizados", tone: "success" as const, alert: false }
                    : { label: "Origem sem telemetria", tone: "neutral" as const, alert: false };
        const leaseExpiresAt = data.freshness.leaseExpiresAt
          ? Date.parse(data.freshness.leaseExpiresAt)
          : Number.NaN;
        const leaseRemainingMinutes = Number.isFinite(leaseExpiresAt)
          ? Math.ceil((leaseExpiresAt - now) / 60_000)
          : null;
        const leaseAtRisk = leaseRemainingMinutes !== null && leaseRemainingMinutes <= 60;
        const freshnessNeedsDetail = freshness.alert || freshness.tone === "warning" || leaseAtRisk;
        const canSequenceCourses = ["full_service", "hybrid"].includes(
          data.operationServiceMode ?? "",
        );
        const canAuthorizeCancellation =
          data.capabilities.authorizedCancellation &&
          (scope.profileId === "owner" || scope.profileId === "manager");
        const canManagePriority =
          data.capabilities.orderPriority &&
          operationalViewMode === "pass" &&
          (terminalProfileStatus === "synced" || canManageUnitSettings);
        const cancellationTicket = cancelTicketId
          ? data.tickets.find((ticket) => ticket.id === cancelTicketId)
          : null;
        const itemOperationTicket = itemOperation
          ? data.tickets.find((ticket) => ticket.id === itemOperation.ticketId)
          : null;
        const itemOperationItem = itemOperation
          ? data.items.find(
              (row) =>
                row.ticketId === itemOperation.ticketId && row.item.id === itemOperation.itemId,
            )?.item
          : null;
        const passTickets = sortKdsTickets(
          data.tickets.filter(
            (ticket) =>
              ["pending", "preparing", "ready"].includes(ticket.status) ||
              (ticket.status === "done" && ticket.handedOffAt !== null && ticket.servedAt === null),
          ),
          now,
        );
        const orders = new Map<string, KdsTicket[]>();
        for (const ticket of passTickets) {
          const current = orders.get(ticket.orderId) ?? [];
          current.push(ticket);
          orders.set(ticket.orderId, current);
        }
        const count = (status: KdsTicketStatus) =>
          activeTickets.filter((ticket) => ticket.status === status).length;
        const overdueCount = activeTickets.filter((ticket) => kdsSla(ticket, now).isOverdue).length;
        const capacityAttention = data.capabilities.recommendation
          ? (data.stations
              .filter(
                (station) => operationalStationId === "all" || station.id === operationalStationId,
              )
              .filter(
                (station) =>
                  station.capacity?.recommendation &&
                  station.capacity.recommendation.state !== "normal",
              )
              .sort(
                (left, right) =>
                  Number(right.capacity?.recommendation?.state === "overloaded") -
                  Number(left.capacity?.recommendation?.state === "overloaded"),
              )[0] ?? null)
          : null;
        return (
          <div
            className={`kds-workspace kds-workspace--density-${density} ${fullscreen ? "kds-workspace--fullscreen" : ""}`}
            ref={workspaceRef}
          >
            <p aria-atomic="true" aria-live="polite" className="kds-sr-live">
              {liveMessage}
            </p>

            {area === "settings" && !canManageUnitSettings ? (
              <EmptyState
                description="As configurações da produção exigem permissão de gestão do Cardápio."
                icon="◇"
                title="Configurações KDS restritas"
              />
            ) : area === "settings" ? (
              <KdsSettingsPage
                allDayExpanded={allDayExpanded}
                analytics={analytics}
                analyticsError={analyticsError}
                analyticsLoading={analyticsLoading}
                analyticsWindowHours={analyticsWindowHours}
                availabilityProducts={
                  availabilityProducts.length > 0 ? availabilityProducts : data.productAvailability
                }
                bumpMap={bumpMap}
                busyKeys={busyKeys}
                canManageUnitSettings={canManageUnitSettings}
                checklistKey={checklistKey}
                connectionReady={connectionReady}
                data={data}
                density={density}
                errors={errors}
                fullscreen={fullscreen}
                fullscreenPreferred={fullscreenPreferred}
                installationId={terminalInstallationId}
                operationalProducts={allDay}
                onAllDayExpandedChange={(expanded) => {
                  setAllDayExpanded(expanded);
                  savePersistentValue(`${storagePrefix}:all-day-expanded`, String(expanded));
                }}
                onAnalyticsWindowChange={(hours) => {
                  setAnalyticsWindowHours(hours);
                  setAnalytics(null);
                }}
                onDensityChange={(nextDensity) => {
                  setDensity(nextDensity);
                  savePersistentValue(`${storagePrefix}:density`, nextDensity);
                }}
                onAvailabilityChange={changeProductAvailability}
                onBumpMapChange={(nextMap) => {
                  setBumpMap(nextMap);
                  saveKdsBumpBarMap(`${storagePrefix}:bump-map`, nextMap);
                }}
                onFullscreenPreferredChange={changeFullscreenPreference}
                onLoadAnalytics={() => void loadAnalytics(effectiveStationId)}
                onPrint={() => void printTicket()}
                onPrinterPreferencesChange={(preferences) => {
                  setPrinter(preferences);
                  savePersistentValue(`${storagePrefix}:printer`, JSON.stringify(preferences));
                }}
                onSelectStation={selectStation}
                onTestSound={testSound}
                onToggleFullscreen={() => void toggleFullscreen()}
                onToggleSound={toggleSound}
                onToggleStationLock={toggleStationLock}
                onTerminalLabelChange={changeTerminalLabel}
                onTerminalProfileSync={() => void syncTerminalProfile()}
                onViewModeChange={changePreferredMode}
                operatingDay={openingDay}
                printerPreferences={printer}
                realtimeStatus={realtimeStatus}
                soundEnabled={soundEnabled}
                stationId={effectiveStationId}
                stationLocked={stationLocked}
                terminalLabel={terminalLabel}
                terminalProfileBusy={terminalProfileBusy}
                terminalProfileCanManage={
                  data.capabilities.terminalProfileManage &&
                  (scope.profileId === "owner" || scope.profileId === "manager")
                }
                terminalProfileMessage={terminalProfileMessage}
                terminalProfileStatus={terminalProfileStatus}
                viewMode={viewMode}
                cloudUnavailable={cloudUnavailable}
              />
            ) : (
              <>
                <div className="kds-command-bar">
                  <div className="kds-operational-context">
                    <span className="gm-pill">Área operacional</span>
                    {operationalViewMode === "station" && (
                      <div className="kds-station-context">
                        <strong>{stationName}</strong>
                        <Badge tone={stationLocked ? "info" : "warning"}>
                          {stationLocked ? "Praça fixada" : "Praça não fixada"}
                        </Badge>
                      </div>
                    )}
                    {operationalViewMode === "pass" && (
                      <div className="kds-pass-context">
                        <strong>Passe / expedição</strong>
                        <small>Todos os pedidos e praças</small>
                      </div>
                    )}
                  </div>
                  <div className="kds-toolbar-actions">
                    <Button
                      aria-keyshortcuts="R"
                      aria-busy={manualRefreshing}
                      data-kds-refresh
                      disabled={manualRefreshing}
                      onClick={() => void refreshManually()}
                      size="sm"
                      variant="secondary"
                    >
                      {manualRefreshing ? "Atualizando…" : "Atualizar produção"}
                    </Button>
                    <details className="kds-terminal-actions">
                      <summary>Ações do terminal</summary>
                      <div>
                        <Button
                          aria-keyshortcuts="M"
                          aria-pressed={soundEnabled}
                          onClick={toggleSound}
                          size="sm"
                          variant="ghost"
                        >
                          {soundEnabled ? "Desativar som" : "Ativar som"}
                        </Button>
                        <Button
                          aria-keyshortcuts="F"
                          aria-pressed={fullscreen}
                          onClick={() => void toggleFullscreen()}
                          size="sm"
                          variant="ghost"
                        >
                          {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
                        </Button>
                        <Button
                          aria-keyshortcuts="P"
                          onClick={() => printTicket()}
                          size="sm"
                          variant="ghost"
                        >
                          Imprimir ticket focado
                        </Button>
                      </div>
                    </details>
                  </div>
                </div>

                <div
                  className={`kds-freshness kds-freshness--${freshness.tone}`}
                  role={freshness.alert || leaseAtRisk ? "alert" : "status"}
                >
                  <Badge tone={freshness.tone}>{freshness.label}</Badge>
                  <span>
                    {freshnessNeedsDetail
                      ? (data.freshness.message ??
                        remote.refreshError ??
                        (data.capturedAt
                          ? `Captura ${formatTime(data.capturedAt)}${freshnessAge ? ` · há ${freshnessAge} min` : ""}`
                          : remote.lastSuccessfulAt
                            ? `Recebido neste terminal às ${formatTime(remote.lastSuccessfulAt)}`
                            : "O servidor não informou horário de captura."))
                      : data.capturedAt
                        ? `Atualizado às ${formatTime(data.capturedAt)}`
                        : "Leitura operacional disponível"}
                  </span>
                  {freshnessNeedsDetail && leaseRemainingMinutes !== null && (
                    <strong className={leaseAtRisk ? "kds-lease--danger" : ""}>
                      {leaseRemainingMinutes <= 0
                        ? "Autorização offline expirada"
                        : leaseAtRisk
                          ? `Autorização offline expira em ${leaseRemainingMinutes} min`
                          : `Autorização offline: ${Math.ceil(leaseRemainingMinutes / 60)} h restantes`}
                    </strong>
                  )}
                  {freshnessNeedsDetail && data.revision && (
                    <small>Revisão {data.revision.slice(0, 10)}</small>
                  )}
                  {freshnessNeedsDetail && (
                    <small>
                      Atualização:{" "}
                      {realtimeStatus === "live"
                        ? "tempo real"
                        : realtimeStatus === "polling"
                          ? "polling de contingência"
                          : "conectando"}
                      {realtimeFreshness?.lastConfirmedAt
                        ? ` · confirmação ${formatTime(realtimeFreshness.lastConfirmedAt)}`
                        : ""}
                    </small>
                  )}
                </div>

                <KdsReadyNotices
                  notices={readyNotices}
                  onDismiss={(orderId) =>
                    setReadyNotices((current) =>
                      current.filter((notice) => notice.orderId !== orderId),
                    )
                  }
                />

                {cancelAlerts.length > 0 && (
                  <section
                    aria-label="Cancelamentos que exigem ciência"
                    className="kds-cancellations"
                  >
                    {cancelAlerts.map((alert) => (
                      <Card className="kds-cancellation" key={alert.id} role="alert">
                        <div>
                          <h2>Pedido cancelado — {cancellationReference(alert)}</h2>
                          <span>
                            {cancellationStation(alert)}
                            {alert.reason ? ` · ${alert.reason}` : ""}
                          </span>
                          {alert.items.length > 0 && (
                            <small>
                              {alert.items
                                .map((item) => `${item.quantity}× ${item.productName}`)
                                .join(" · ")}
                            </small>
                          )}
                        </div>
                        <Button
                          aria-label={`Confirmar ciência do cancelamento de ${cancellationReference(alert)}`}
                          onClick={() => acknowledgeCancellation(alert)}
                          size="sm"
                          variant="danger"
                        >
                          Ciente neste terminal
                        </Button>
                      </Card>
                    ))}
                  </section>
                )}

                <section aria-label="Indicadores da produção" className="kds-metrics">
                  <span>
                    <strong>{count("pending")}</strong> aguardando
                  </span>
                  <span>
                    <strong>{count("preparing")}</strong> em preparo
                  </span>
                  <span>
                    <strong>{count("ready")}</strong> prontos
                  </span>
                  <span className={overdueCount > 0 ? "kds-metric--danger" : ""}>
                    <strong>{overdueCount}</strong> atrasados
                  </span>
                </section>

                {capacityAttention?.capacity?.recommendation && (
                  <aside
                    aria-label={`Recomendação de capacidade — ${capacityAttention.name}`}
                    className={`kds-capacity-alert kds-capacity-alert--${capacityAttention.capacity.recommendation.state}`}
                  >
                    <span>
                      <strong>Capacidade em atenção · {capacityAttention.name}</strong>
                      <small>
                        {capacityAttention.capacity.queuedQuantity !== null
                          ? `${capacityAttention.capacity.queuedQuantity} unidade(s) na fila`
                          : "Fila acima do ritmo esperado"}
                        {capacityAttention.capacity.recommendation.suggestedDelayMinutes !== null
                          ? ` · recomendação: acrescentar ${capacityAttention.capacity.recommendation.suggestedDelayMinutes} min à promessa`
                          : " · revise bloqueios e distribuição da praça"}
                      </small>
                    </span>
                    {canManageUnitSettings && (
                      <a className="gm-button gm-button--ghost gm-button--sm" href="#/kds/settings">
                        Revisar operação
                      </a>
                    )}
                  </aside>
                )}

                <div className="kds-main-layout">
                  <section aria-label="Fila da produção" className="kds-board-area">
                    {operationalViewMode === "station" ? (
                      activeTickets.length === 0 ? (
                        <EmptyState
                          icon="✓"
                          title="Praça em dia"
                          description="Nenhum ticket ativo nesta seleção."
                        />
                      ) : (
                        <div className="real-kds-ticket-grid">
                          {activeTickets.map((ticket) => (
                            <TicketCard
                              busyKeys={busyKeys}
                              canCancel={canAuthorizeCancellation}
                              canRefire={
                                data.capabilities.refire &&
                                (scope.profileId === "owner" || scope.profileId === "manager")
                              }
                              canSequenceCourses={canSequenceCourses}
                              cloudUnavailable={cloudUnavailable}
                              data={data}
                              errors={errors}
                              key={ticket.id}
                              now={now}
                              onAcknowledgeAttention={(currentTicket, item, attention) =>
                                acknowledgeAttention(currentTicket, item, attention, data)
                              }
                              onCourseState={courseState}
                              onItemState={itemState}
                              onRecall={recall}
                              onRefireItem={refireItem}
                              onRequestItemOperation={(currentTicket, item, kind) =>
                                requestItemOperation(currentTicket, item, kind, data.stations)
                              }
                              onRequestCancel={requestTicketCancellation}
                              onTicketState={ticketState}
                              ticket={ticket}
                            />
                          ))}
                        </div>
                      )
                    ) : orders.size === 0 ? (
                      <EmptyState
                        icon="✓"
                        title="Passe liberado"
                        description="Nenhum pedido aguardando expedição ou entrega."
                      />
                    ) : (
                      <div className="kds-pass-board">
                        {[...orders.entries()].map(([orderId, tickets]) => {
                          const first = tickets[0];
                          if (!first) return null;
                          const inPass = tickets.every(
                            (ticket) =>
                              ticket.status === "done" &&
                              ticket.handedOffAt !== null &&
                              ticket.servedAt === null,
                          );
                          const readyForPass = tickets.every((ticket) => ticket.status === "ready");
                          const target = inPass ? "served" : "expedition";
                          const key = `order:${orderId}:handoff:${target}`;
                          const priorityKey = `order:${orderId}:priority`;
                          const orderBusy = busyKeys.has(key);
                          const priorityBusy = busyKeys.has(priorityKey);
                          const prioritized = tickets.some(
                            (ticket) => ticket.rush || ticket.priority >= 50,
                          );
                          const passReference = first.reference ?? kdsTicketReference(first);
                          const passContext = [first.tableLabel, first.tabLabel]
                            .filter(
                              (value): value is string => Boolean(value) && value !== passReference,
                            )
                            .filter((value, index, values) => values.indexOf(value) === index);
                          return (
                            <article
                              aria-label={`Pedido ${passReference}`}
                              className="kds-pass-order"
                              data-kds-ticket={orderId}
                              key={orderId}
                            >
                              <Card>
                                <header>
                                  <div>
                                    <span>Passe / expedição</span>
                                    <h2>{passReference}</h2>
                                    <small>
                                      {passContext.length > 0
                                        ? passContext.join(" · ")
                                        : `Pedido #${orderId.slice(0, 6)}`}
                                    </small>
                                  </div>
                                  <span className="real-kds-card__badges">
                                    {prioritized && <Badge tone="danger">RUSH</Badge>}
                                    <Badge
                                      tone={inPass ? "success" : readyForPass ? "info" : "warning"}
                                    >
                                      {inPass
                                        ? "No passe"
                                        : readyForPass
                                          ? "Pronto para o passe"
                                          : "Aguardando praças"}
                                    </Badge>
                                  </span>
                                </header>
                                <div className="kds-pass-stations">
                                  {tickets.map((ticket) => (
                                    <span key={ticket.id}>
                                      <strong>{kdsStationLabel(ticket)}</strong>
                                      <Badge tone={statusTone(ticket.status)}>
                                        {inPass ? "No passe" : KDS_STATUS_LABEL[ticket.status]}
                                      </Badge>
                                    </span>
                                  ))}
                                </div>
                                <ul className="kds-pass-items">
                                  {tickets.flatMap((ticket) =>
                                    itemsForTicket(data, ticket.id).map((item) => (
                                      <li key={`${ticket.id}:${item.id}`}>
                                        <strong>{item.quantity}×</strong> {item.productName}
                                        {item.allergyNote && <span>⚠ {item.allergyNote}</span>}
                                        {item.notes && <span>{item.notes}</span>}
                                      </li>
                                    )),
                                  )}
                                </ul>
                                <div className="kds-pass-order__actions">
                                  {canManagePriority && (
                                    <Button
                                      aria-busy={priorityBusy}
                                      disabled={priorityBusy || orderBusy}
                                      onClick={() => orderPriority(orderId, tickets)}
                                      size="sm"
                                      variant={prioritized ? "secondary" : "danger"}
                                    >
                                      {priorityBusy
                                        ? "Confirmando…"
                                        : prioritized
                                          ? "Remover prioridade"
                                          : "Priorizar pedido"}
                                    </Button>
                                  )}
                                  {data.capabilities.handoff && (
                                    <Button
                                      aria-busy={orderBusy}
                                      aria-keyshortcuts="Enter Space"
                                      data-kds-bump
                                      disabled={
                                        orderBusy || priorityBusy || (!readyForPass && !inPass)
                                      }
                                      onClick={() => handoff(orderId, target)}
                                    >
                                      {orderBusy
                                        ? "Confirmando…"
                                        : inPass
                                          ? "Confirmar entrega do pedido"
                                          : readyForPass
                                            ? "Receber pedido no passe"
                                            : "Aguardando todas as praças"}
                                    </Button>
                                  )}
                                </div>
                                {errors[priorityKey] && (
                                  <p className="kds-action-error" role="alert">
                                    {errors[priorityKey]}
                                  </p>
                                )}
                                {errors[key] && (
                                  <p className="kds-action-error" role="alert">
                                    {errors[key]}
                                  </p>
                                )}
                              </Card>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <details
                    aria-label="Produção total"
                    className="kds-all-day"
                    onToggle={(event) => {
                      const expanded = event.currentTarget.open;
                      if (expanded === allDayExpanded) return;
                      setAllDayExpanded(expanded);
                      savePersistentValue(`${storagePrefix}:all-day-expanded`, String(expanded));
                    }}
                    open={allDayExpanded}
                  >
                    <summary>
                      <strong>All-day</strong>
                      <span>
                        {allDay.reduce((sum, item) => sum + item.quantity, 0)} unidades na produção
                      </span>
                    </summary>
                    {allDay.length === 0 ? (
                      <p>Nenhum item ativo.</p>
                    ) : (
                      <ol>
                        {allDay.slice(0, 12).map((item) => (
                          <li key={item.productId ?? item.productName}>
                            <strong>{item.productName}</strong>
                            <span className="kds-all-day__counts">
                              {item.queuedQuantity > 0 && (
                                <span>
                                  <strong>{item.queuedQuantity}</strong> A produzir
                                </span>
                              )}
                              {item.preparingQuantity > 0 && (
                                <span>
                                  <strong>{item.preparingQuantity}</strong> Em preparo
                                </span>
                              )}
                              {item.readyQuantity > 0 && (
                                <span>
                                  <strong>{item.readyQuantity}</strong> Prontos
                                </span>
                              )}
                              {item.heldQuantity > 0 && (
                                <span>
                                  <strong>{item.heldQuantity}</strong> Segurados
                                </span>
                              )}
                            </span>
                            <details className="kds-all-day__actions">
                              <summary>Ações</summary>
                              <Button
                                onClick={() => {
                                  const assignment = data.items.find(
                                    ({ ticketId, item: ticketItem }) =>
                                      activeTickets.some((ticket) => ticket.id === ticketId) &&
                                      (item.productId
                                        ? ticketItem.productId === item.productId
                                        : ticketItem.productName === item.productName),
                                  );
                                  const ticket = assignment
                                    ? data.tickets.find((row) => row.id === assignment.ticketId)
                                    : null;
                                  const targetId =
                                    operationalViewMode === "pass"
                                      ? ticket?.orderId
                                      : assignment?.ticketId;
                                  const target = targetId
                                    ? [
                                        ...(workspaceRef.current?.querySelectorAll<HTMLElement>(
                                          "[data-kds-ticket]",
                                        ) ?? []),
                                      ].find((element) => element.dataset.kdsTicket === targetId)
                                    : null;
                                  if (!target) {
                                    setLiveMessage(
                                      `Nenhum pedido visível para ${item.productName}.`,
                                    );
                                    return;
                                  }
                                  target.scrollIntoView({ behavior: "smooth", block: "center" });
                                  target
                                    .querySelector<HTMLButtonElement>(
                                      "[data-kds-bump]:not(:disabled)",
                                    )
                                    ?.focus();
                                  setLiveMessage(
                                    `Pedidos de ${item.productName} destacados na fila.`,
                                  );
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                Ver pedidos
                              </Button>
                            </details>
                          </li>
                        ))}
                      </ol>
                    )}
                  </details>
                </div>

                {data.capabilities.batches && (
                  <KdsBatchesPanel
                    batches={data.batches}
                    busyKeys={busyKeys}
                    cloudUnavailable={cloudUnavailable}
                    errors={errors}
                    onCancel={cancelBatch}
                    onComplete={completeBatch}
                    onCreate={(input) => createBatch(data, input)}
                    products={allDay}
                    stations={data.stations}
                  />
                )}
              </>
            )}

            <Modal
              isOpen={itemOperation !== null}
              onClose={closeItemOperation}
              size="sm"
              title={
                itemOperation?.kind === "block"
                  ? "Bloquear item"
                  : itemOperation?.kind === "unblock"
                    ? "Desbloquear item"
                    : "Mudar item de praça"
              }
            >
              <form
                className="kds-item-operation-form"
                onSubmit={(event) => submitItemOperation(event, data)}
              >
                <p>
                  <strong>{itemOperationItem?.productName ?? "Item da produção"}</strong>
                  {itemOperationTicket
                    ? ` · ${kdsTicketReference(itemOperationTicket)} · ${kdsStationLabel(itemOperationTicket)}`
                    : ""}
                </p>
                {itemOperation?.kind === "block" && (
                  <label>
                    Tipo de bloqueio
                    <select
                      onChange={(event) => setItemOperationCode(event.target.value as KdsBlockCode)}
                      required
                      value={itemOperationCode}
                    >
                      {Object.entries(KDS_BLOCK_LABEL).map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {itemOperation?.kind === "reroute" && (
                  <label>
                    Praça de destino
                    <select
                      onChange={(event) => setItemOperationStationId(event.target.value)}
                      required
                      value={itemOperationStationId}
                    >
                      <option value="">Escolha outra praça</option>
                      {data.stations
                        .filter((station) => station.id !== itemOperationTicket?.stationId)
                        .map((station) => (
                          <option key={station.id} value={station.id}>
                            {station.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Motivo
                  <textarea
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setItemOperationReason(event.target.value)}
                    required
                    rows={3}
                    value={itemOperationReason}
                  />
                </label>
                {itemOperationError && (
                  <p className="kds-action-error" role="alert">
                    {itemOperationError}
                  </p>
                )}
                {cloudUnavailable &&
                  (itemOperation?.kind === "reroute" || !data.capabilities.offlineBlock) && (
                    <p className="kds-inline-alert" role="status">
                      Esta ação exige conexão com o servidor e não será simulada localmente.
                    </p>
                  )}
                <div className="kds-item-operation-form__actions">
                  <Button onClick={closeItemOperation} type="button" variant="ghost">
                    Voltar
                  </Button>
                  <Button
                    disabled={
                      cloudUnavailable &&
                      (itemOperation?.kind === "reroute" || !data.capabilities.offlineBlock)
                    }
                    type="submit"
                    variant={itemOperation?.kind === "block" ? "danger" : "primary"}
                  >
                    {itemOperation?.kind === "block"
                      ? "Confirmar bloqueio"
                      : itemOperation?.kind === "unblock"
                        ? "Confirmar desbloqueio"
                        : "Confirmar nova praça"}
                  </Button>
                </div>
              </form>
            </Modal>

            <Modal
              isOpen={cancelTicketId !== null}
              onClose={closeTicketCancellation}
              size="sm"
              title={`Cancelar ticket — ${cancellationTicket ? kdsTicketReference(cancellationTicket) : "produção"}`}
            >
              <form className="kds-cancel-form" onSubmit={submitTicketCancellation}>
                <p>
                  Esta ação interrompe a produção do ticket e fica registrada na auditoria. A
                  cozinha verá um alerta até confirmar ciência.
                </p>
                <label>
                  Motivo do cancelamento
                  <textarea
                    maxLength={500}
                    minLength={3}
                    onChange={(event) => setCancelReason(event.target.value)}
                    required
                    rows={3}
                    value={cancelReason}
                  />
                </label>
                <label>
                  PIN gerencial
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                    minLength={4}
                    onChange={(event) => setCancelPin(event.target.value.replace(/\D/g, ""))}
                    pattern="[0-9]{4,8}"
                    required
                    type="password"
                    value={cancelPin}
                  />
                </label>
                <label className="kds-cancel-confirmation">
                  <input
                    checked={cancelConfirmed}
                    onChange={(event) => setCancelConfirmed(event.target.checked)}
                    required
                    type="checkbox"
                  />
                  <span>Confirmo o cancelamento deste ticket e a interrupção da produção.</span>
                </label>
                {cancelFormError && (
                  <p className="kds-action-error" role="alert">
                    {cancelFormError}
                  </p>
                )}
                <div className="kds-cancel-form__actions">
                  <Button onClick={closeTicketCancellation} type="button" variant="ghost">
                    Voltar
                  </Button>
                  <Button type="submit" variant="danger">
                    Confirmar cancelamento
                  </Button>
                </div>
              </form>
            </Modal>

            <details className="kds-shortcuts">
              <summary>Atalhos de teclado</summary>
              <p>
                Setas ← ↑ → ↓ movem o foco entre as ações principais (bump bar). Enter ou Espaço
                executa a ação focada. R atualiza, M alterna o som, F alterna a tela cheia e P
                imprime somente o ticket focado. Atalhos não atuam durante digitação.
              </p>
            </details>
            {errors.global && (
              <p className="kds-action-error" role="alert">
                {errors.global}
              </p>
            )}
          </div>
        );
      }}
    </RemoteGate>
  );
}
