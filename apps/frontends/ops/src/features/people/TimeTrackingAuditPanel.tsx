// biome-ignore-all lint/a11y/noLabelWithoutControl: UI controls render native inputs nested in their labels.
import { Button, Card, Input } from "@giromesa/ui";
import { useState } from "react";
import { api } from "../../api";
import type { ManagementScope } from "../../management.shared";
import { openStreetMapEmbedUrl } from "./time-tracking-location";

type HistoryEntry = {
  id: string;
  actorName: string;
  occurredAt: string;
  locationChangeReason: string | null;
};

type AnomalyPoint = {
  timeEntryId: string;
  personName: string;
  event: "clock-in" | "clock-out";
  occurredAt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  locationLabel: string | null;
  flags: string[];
};

function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function historyEntries(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const id = string(row?.id);
    const actorName = string(row?.actorName);
    const occurredAt = string(row?.occurredAt);
    if (!id || !actorName || !occurredAt) return [];
    return [
      {
        id,
        actorName,
        occurredAt,
        locationChangeReason: string(row?.locationChangeReason),
      },
    ];
  });
}

function anomalyPoints(value: unknown): AnomalyPoint[] {
  const payload = record(value);
  if (!Array.isArray(payload?.points)) return [];
  return payload.points.flatMap((item) => {
    const row = record(item);
    const timeEntryId = string(row?.timeEntryId);
    const personName = string(row?.personName);
    const event = string(row?.event);
    const occurredAt = string(row?.occurredAt);
    const latitude = number(row?.latitude);
    const longitude = number(row?.longitude);
    if (
      !timeEntryId ||
      !personName ||
      !occurredAt ||
      (event !== "clock-in" && event !== "clock-out") ||
      latitude === null ||
      longitude === null
    ) {
      return [];
    }
    return [
      {
        timeEntryId,
        personName,
        event,
        occurredAt,
        latitude,
        longitude,
        accuracyMeters: number(row?.accuracyMeters),
        locationLabel: string(row?.locationLabel),
        flags: Array.isArray(row?.flags)
          ? row.flags.filter((flag): flag is string => typeof flag === "string")
          : [],
      },
    ];
  });
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TimeTrackingAuditPanel({ scope }: { scope: ManagementScope }) {
  const [from, setFrom] = useState(() =>
    dateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  );
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [points, setPoints] = useState<AnomalyPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<AnomalyPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setMessage("");
    try {
      const [historyPayload, anomaliesPayload] = await Promise.all([
        api.management.timeTrackingSettingsHistory(scope.organizationId, scope.unitId),
        api.management.timeTrackingLocationAnomalies(scope.organizationId, scope.unitId, {
          from,
          to,
        }),
      ]);
      setHistory(historyEntries(historyPayload));
      const nextPoints = anomalyPoints(anomaliesPayload);
      setPoints(nextPoints);
      setSelectedPoint(nextPoints[0] ?? null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível consultar a auditoria.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="time-tracking-audit" aria-label="Auditoria de localização do ponto">
      <div className="time-tracking-audit__header">
        <div>
          <strong>Auditoria de localização</strong>
          <p className="form-hint">
            Coordenadas são visíveis somente ao proprietário e deixam de aparecer após a retenção
            configurada.
          </p>
        </div>
        <div className="time-tracking-audit__filters">
          <label>
            De
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Até
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <Button
            disabled={busy || from > to}
            onClick={() => void load()}
            type="button"
            variant="secondary"
          >
            {busy ? "Consultando…" : "Consultar auditoria"}
          </Button>
        </div>
      </div>
      {message && (
        <p className="form-hint" role="alert">
          {message}
        </p>
      )}
      {(history.length > 0 || points.length > 0) && (
        <div className="time-tracking-audit__grid">
          <Card>
            <strong>Alterações de política</strong>
            <ul className="time-tracking-audit__list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.actorName}</strong> · {dateTime(entry.occurredAt)}
                  <small>
                    {entry.locationChangeReason ??
                      "Alteração registrada sem mudança de localização."}
                  </small>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <strong>Marcações sinalizadas</strong>
            {selectedPoint ? (
              <>
                <iframe
                  className="time-tracking-audit__map"
                  src={openStreetMapEmbedUrl(selectedPoint.latitude, selectedPoint.longitude, 100)}
                  title={`Mapa da marcação de ${selectedPoint.personName}`}
                />
                <p className="form-hint">
                  {selectedPoint.personName} ·{" "}
                  {selectedPoint.event === "clock-in" ? "entrada" : "saída"} ·{" "}
                  {dateTime(selectedPoint.occurredAt)}
                  {selectedPoint.accuracyMeters !== null
                    ? ` · precisão ${selectedPoint.accuracyMeters} m`
                    : ""}
                </p>
              </>
            ) : (
              <p className="form-hint">Nenhuma coordenada sinalizada no período.</p>
            )}
            <ul className="time-tracking-audit__list">
              {points.map((point) => (
                <li key={`${point.timeEntryId}-${point.event}`}>
                  <Button onClick={() => setSelectedPoint(point)} type="button" variant="ghost">
                    {point.personName} · {point.event === "clock-in" ? "entrada" : "saída"}
                  </Button>
                  <small>
                    {point.locationLabel ?? "Local não identificado"} · {point.flags.join(", ")}
                  </small>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </section>
  );
}
