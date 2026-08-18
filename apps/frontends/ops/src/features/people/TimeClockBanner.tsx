import { Button } from "@giromesa/ui";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, api } from "../../api";
import {
  type ManagementScope,
  parseSelfTimeTracking,
  type SelfTimeTrackingData,
} from "../../management.shared";
import {
  clearRejectedTimeClockActions,
  enqueueTimeClockAction,
  queuedTimeClockActions,
  rejectedTimeClockActions,
  replayTimeClockQueue,
  type TimeClockOfflineActionInput,
  timeClockDeviceId,
} from "../../time-clock-offline";

function location(): Promise<{ latitude: number; longitude: number; accuracyMeters?: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este dispositivo não disponibilizou a localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : undefined,
        }),
      () => reject(new Error("Autorize a localização para registrar o ponto.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
    );
  });
}

function key(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function clock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function dateTimeLocal(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function workedMinutes(
  entry: { id: string; clockedInAt: string; clockedOutAt: string | null },
  breaks: Array<{ timeEntryId: string; startedAt: string; endedAt: string | null }>,
) {
  const end = entry.clockedOutAt ? new Date(entry.clockedOutAt).getTime() : Date.now();
  const paused = breaks
    .filter((item) => item.timeEntryId === entry.id && item.endedAt)
    .reduce(
      (total, item) =>
        total + new Date(item.endedAt as string).getTime() - new Date(item.startedAt).getTime(),
      0,
    );
  return Math.max(0, Math.round((end - new Date(entry.clockedInAt).getTime() - paused) / 60_000));
}

export function TimeClockBanner({
  scope,
  timeZone,
  identityId,
}: {
  scope: ManagementScope;
  timeZone: string;
  identityId: string;
}) {
  const offlineScope = useMemo(
    () => ({
      organizationId: scope.organizationId,
      unitId: scope.unitId,
      identityId,
    }),
    [identityId, scope.organizationId, scope.unitId],
  );
  const deviceId = useMemo(() => timeClockDeviceId(offlineScope), [offlineScope]);
  const [state, setState] = useState<{
    status: "loading" | "ready" | "hidden" | "error";
    data?: SelfTimeTrackingData;
    message?: string;
  }>({ status: "loading" });
  const [busy, setBusy] = useState("");
  const [offlineCount, setOfflineCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [correction, setCorrection] = useState<{
    entryId: string;
    clockedInAt: string;
    clockedOutAt: string;
    reason: string;
  } | null>(null);

  const refreshOfflineState = useCallback(() => {
    setOfflineCount(queuedTimeClockActions(offlineScope).length);
    setRejectedCount(rejectedTimeClockActions(offlineScope).length);
  }, [offlineScope]);

  const refresh = useCallback(async () => {
    try {
      const data = parseSelfTimeTracking(
        await api.management.peopleSelf(scope.organizationId, scope.unitId),
      );
      setState({ status: data.enabled ? "ready" : "hidden", data });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Não foi possível carregar o ponto.",
      });
    }
  }, [scope.organizationId, scope.unitId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    refreshOfflineState();
    const replay = async () => {
      if (!navigator.onLine) return;
      await replayTimeClockQueue(offlineScope);
      refreshOfflineState();
      await refresh();
    };
    const timer = globalThis.setInterval(() => void replay(), 15_000);
    window.addEventListener("online", replay);
    return () => {
      globalThis.clearInterval(timer);
      window.removeEventListener("online", replay);
    };
  }, [offlineScope, refresh, refreshOfflineState]);

  const openBreak = useMemo(
    () =>
      state.data?.breaks.find(
        (item) => item.timeEntryId === state.data?.current?.id && !item.endedAt,
      ),
    [state.data],
  );

  async function requestCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correction) return;
    setBusy("correction");
    try {
      await api.management.requestTimeCorrection(
        scope.organizationId,
        scope.unitId,
        {
          timeEntryId: correction.entryId,
          clockedInAt: new Date(correction.clockedInAt).toISOString(),
          clockedOutAt: correction.clockedOutAt
            ? new Date(correction.clockedOutAt).toISOString()
            : undefined,
          reason: correction.reason,
        },
        key("correction"),
      );
      setCorrection(null);
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Não foi possível solicitar a correção.",
      }));
    } finally {
      setBusy("");
    }
  }

  type OfflineAction = TimeClockOfflineActionInput;
  type ActionPlan = { online: () => Promise<unknown>; offline?: OfflineAction };

  async function act(action: string, operation: () => Promise<ActionPlan>) {
    setBusy(action);
    let plan: ActionPlan | undefined;
    try {
      plan = await operation();
      if (!navigator.onLine && plan.offline) {
        enqueueTimeClockAction(offlineScope, plan.offline);
        refreshOfflineState();
        setState((current) => ({
          ...current,
          status: "error",
          message: "Ponto salvo neste dispositivo e aguardando conexão para validação.",
        }));
        return;
      }
      await plan.online();
      await refresh();
    } catch (error) {
      if (
        plan?.offline &&
        (error instanceof ApiClientError && error.retryable ? true : !navigator.onLine)
      ) {
        enqueueTimeClockAction(offlineScope, plan.offline);
        refreshOfflineState();
        setState((current) => ({
          ...current,
          status: "error",
          message: "Ponto salvo neste dispositivo e aguardando conexão para validação.",
        }));
        return;
      }
      setState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Não foi possível registrar o ponto.",
      }));
    } finally {
      setBusy("");
    }
  }

  if (state.status === "loading" || state.status === "hidden" || !state.data?.enabled) return null;

  const data = state.data;
  const current = state.data.current;
  const settings = state.data.settings;
  const recentEntries = state.data.entries.slice(0, 5);
  return (
    <section className="time-clock-banner" aria-label="Ponto do funcionário">
      <div>
        <span className="eyebrow">Ponto do turno</span>
        <strong>
          {openBreak
            ? openBreak.type === "meal"
              ? "Pausa para almoço em andamento"
              : "Saída temporária em andamento"
            : current
              ? `Turno aberto desde ${clock(current.clockedInAt, timeZone)}`
              : "Registre sua entrada antes de iniciar a operação"}
        </strong>
        <small>
          {settings.locationLabel ?? "Localização verificada no evento"} · raio{" "}
          {settings.radiusMeters} m
        </small>
        {offlineCount > 0 && (
          <small role="status">{offlineCount} marcação(ões) aguardando conexão.</small>
        )}
        {rejectedCount > 0 && (
          <small role="alert">
            {rejectedCount} marcação(ões) offline precisam de revisão.{" "}
            <button
              onClick={() => {
                clearRejectedTimeClockActions(offlineScope);
                refreshOfflineState();
              }}
              type="button"
            >
              Limpar avisos
            </button>
          </small>
        )}
      </div>
      <div className="time-clock-banner__actions">
        {!current ? (
          <Button
            disabled={busy === "in"}
            onClick={() =>
              void act("in", async () => {
                const capturedAt = new Date().toISOString();
                const body = { ...(await location()), capturedAt, deviceId };
                const idempotencyKey = key("clock-in");
                return {
                  online: () =>
                    api.management.selfClockIn(
                      scope.organizationId,
                      scope.unitId,
                      body,
                      idempotencyKey,
                    ),
                  offline: { kind: "clock-in", body, idempotencyKey },
                };
              })
            }
          >
            {busy === "in" ? "Localizando…" : "Bater entrada"}
          </Button>
        ) : openBreak ? (
          <Button
            disabled={busy === "break-end"}
            onClick={() =>
              void act("break-end", async () => ({
                online: async () =>
                  api.management.selfCompleteBreak(
                    scope.organizationId,
                    scope.unitId,
                    openBreak.id,
                    { ...(await location()), capturedAt: new Date().toISOString(), deviceId },
                    key("break-end"),
                  ),
              }))
            }
          >
            {busy === "break-end" ? "Localizando…" : "Voltar ao trabalho"}
          </Button>
        ) : (
          <>
            <Button
              disabled={busy === "meal"}
              onClick={() =>
                void act("meal", async () => {
                  const capturedAt = new Date().toISOString();
                  const body = {
                    ...(await location()),
                    type: "meal" as const,
                    capturedAt,
                    deviceId,
                  };
                  const idempotencyKey = key("meal");
                  return {
                    online: () =>
                      api.management.selfStartBreak(
                        scope.organizationId,
                        scope.unitId,
                        body,
                        idempotencyKey,
                      ),
                    offline: { kind: "break-start", body, idempotencyKey },
                  };
                })
              }
              variant="secondary"
            >
              Almoço
            </Button>
            <Button
              disabled={busy === "temporary"}
              onClick={() =>
                void act("temporary", async () => {
                  const capturedAt = new Date().toISOString();
                  const body = {
                    ...(await location()),
                    type: "temporary" as const,
                    capturedAt,
                    deviceId,
                  };
                  const idempotencyKey = key("temporary");
                  return {
                    online: () =>
                      api.management.selfStartBreak(
                        scope.organizationId,
                        scope.unitId,
                        body,
                        idempotencyKey,
                      ),
                    offline: { kind: "break-start", body, idempotencyKey },
                  };
                })
              }
              variant="secondary"
            >
              Saída temporária
            </Button>
            <Button
              disabled={busy === "out"}
              onClick={() =>
                void act("out", async () => {
                  const capturedAt = new Date().toISOString();
                  const body = { ...(await location()), capturedAt, deviceId };
                  const idempotencyKey = key("clock-out");
                  return {
                    online: () =>
                      api.management.selfClockOut(
                        scope.organizationId,
                        scope.unitId,
                        body,
                        idempotencyKey,
                      ),
                    offline: { kind: "clock-out", body, idempotencyKey },
                  };
                })
              }
              variant="danger"
            >
              {busy === "out" ? "Localizando…" : "Finalizar turno"}
            </Button>
          </>
        )}
      </div>
      {recentEntries.length > 0 && (
        <details className="time-clock-banner__history">
          <summary>Meus últimos registros</summary>
          <ul>
            {recentEntries.map((entry) => (
              <li key={entry.id}>
                {new Intl.DateTimeFormat("pt-BR", {
                  timeZone,
                  day: "2-digit",
                  month: "2-digit",
                }).format(new Date(entry.clockedInAt))}{" "}
                · {clock(entry.clockedInAt, timeZone)} →{" "}
                {entry.clockedOutAt ? clock(entry.clockedOutAt, timeZone) : "aberto"} ·{" "}
                {Math.floor(workedMinutes(entry, data.breaks) / 60)}h{" "}
                {String(workedMinutes(entry, data.breaks) % 60).padStart(2, "0")}min
                {entry.clockedOutAt && (
                  <button
                    onClick={() =>
                      setCorrection({
                        entryId: entry.id,
                        clockedInAt: dateTimeLocal(entry.clockedInAt),
                        clockedOutAt: dateTimeLocal(entry.clockedOutAt as string),
                        reason: "",
                      })
                    }
                    type="button"
                  >
                    Corrigir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {correction && (
        <form
          className="time-clock-banner__correction"
          onSubmit={(event) => void requestCorrection(event)}
        >
          <strong>Solicitar correção</strong>
          <label>
            Entrada
            <input
              required
              type="datetime-local"
              value={correction.clockedInAt}
              onChange={(event) =>
                setCorrection({ ...correction, clockedInAt: event.target.value })
              }
            />
          </label>
          <label>
            Saída
            <input
              type="datetime-local"
              value={correction.clockedOutAt}
              onChange={(event) =>
                setCorrection({ ...correction, clockedOutAt: event.target.value })
              }
            />
          </label>
          <label>
            Motivo
            <textarea
              required
              minLength={5}
              value={correction.reason}
              onChange={(event) => setCorrection({ ...correction, reason: event.target.value })}
            />
          </label>
          <div className="time-clock-banner__actions">
            <Button disabled={busy === "correction"} type="submit">
              {busy === "correction" ? "Enviando…" : "Enviar pedido"}
            </Button>
            <Button onClick={() => setCorrection(null)} type="button" variant="secondary">
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {state.status === "error" && (
        <p className="time-clock-banner__error" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}
