// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, Input, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { KdsAllDayItem, KdsBatch, KdsStation } from "../../operations.shared";
import type { RealtimeStatus } from "../../realtime";
import type { KdsAnalytics } from "./kds.model";

interface OpeningChecklistState {
  soundTested: boolean;
  fullscreenChecked: boolean;
  printerChecked: boolean;
}

const emptyChecklist: OpeningChecklistState = {
  soundTested: false,
  fullscreenChecked: false,
  printerChecked: false,
};

function readChecklist(key: string): OpeningChecklistState {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(key) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyChecklist;
    const value = parsed as Record<string, unknown>;
    return {
      soundTested: value.soundTested === true,
      fullscreenChecked: value.fullscreenChecked === true,
      printerChecked: value.printerChecked === true,
    };
  } catch {
    return emptyChecklist;
  }
}

function persistChecklist(key: string, value: OpeningChecklistState) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // O checklist permanece em memória; a interface identifica que é local ao terminal.
  }
}

export function KdsOpeningChecklist({
  checklistKey,
  connectionReady,
  fullscreen,
  onPrint,
  onTestSound,
  onToggleFullscreen,
  operatingDay,
  realtimeStatus,
  soundEnabled,
  stationLocked,
  stationName,
}: {
  checklistKey: string;
  connectionReady: boolean;
  fullscreen: boolean;
  onPrint: () => void;
  onTestSound: () => Promise<boolean>;
  onToggleFullscreen: () => void;
  operatingDay: string;
  realtimeStatus: RealtimeStatus;
  soundEnabled: boolean;
  stationLocked: boolean;
  stationName: string;
}) {
  const [state, setState] = useState(() => readChecklist(checklistKey));
  const [testingSound, setTestingSound] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  useEffect(() => setState(readChecklist(checklistKey)), [checklistKey]);

  const update = (next: Partial<OpeningChecklistState>) => {
    setState((current) => {
      const value = { ...current, ...next };
      persistChecklist(checklistKey, value);
      return value;
    });
  };
  const soundReady = soundEnabled && state.soundTested;
  const requiredDone = [connectionReady, soundReady, stationLocked].filter(Boolean).length;

  return (
    <details className="kds-support-panel kds-opening-checklist">
      <summary>
        Abertura do terminal
        <Badge tone={requiredDone === 3 ? "success" : "warning"}>{requiredDone}/3 essenciais</Badge>
      </summary>
      <div className="kds-support-panel__body">
        <p>
          Checklist local de {operatingDay} para <strong>{stationName}</strong>. Não é compartilhado
          com outros terminais.
        </p>
        <ul className="kds-checklist-items">
          <li>
            <Badge tone={connectionReady ? "success" : "danger"}>
              {connectionReady ? "OK" : "Pendente"}
            </Badge>
            <span>
              Conexão operacional ·{" "}
              {realtimeStatus === "live" ? "tempo real" : "polling de contingência"}
            </span>
          </li>
          <li>
            <Badge tone={soundReady ? "success" : "warning"}>
              {soundReady ? "OK" : "Pendente"}
            </Badge>
            <span>Som ativado e testado neste turno</span>
            <Button
              disabled={testingSound}
              onClick={async () => {
                setTestingSound(true);
                setSoundError(null);
                const succeeded = await onTestSound();
                if (succeeded) update({ soundTested: true });
                else setSoundError("Não foi possível reproduzir som neste terminal.");
                setTestingSound(false);
              }}
              size="sm"
              variant="secondary"
            >
              {testingSound ? "Testando…" : "Testar som"}
            </Button>
            {soundError && (
              <small className="kds-action-error" role="alert">
                {soundError}
              </small>
            )}
          </li>
          <li>
            <Badge tone={stationLocked ? "success" : "warning"}>
              {stationLocked ? "OK" : "Pendente"}
            </Badge>
            <span>Estação específica fixada neste terminal</span>
          </li>
        </ul>
        <fieldset className="kds-optional-checks">
          <legend>Verificações opcionais</legend>
          <label>
            <input
              checked={state.fullscreenChecked}
              onChange={(event) => update({ fullscreenChecked: event.target.checked })}
              type="checkbox"
            />
            Tela cheia conferida
          </label>
          <Button onClick={onToggleFullscreen} size="sm" variant="ghost">
            {fullscreen ? "Sair da tela cheia" : "Abrir tela cheia"}
          </Button>
          <label>
            <input
              checked={state.printerChecked}
              onChange={(event) => update({ printerChecked: event.target.checked })}
              type="checkbox"
            />
            Impressora do sistema conferida
          </label>
          <Button onClick={onPrint} size="sm" variant="ghost">
            Abrir impressão de contingência
          </Button>
        </fieldset>
      </div>
    </details>
  );
}

export function KdsReadyNotices({
  notices,
  onDismiss,
}: {
  notices: Array<{
    orderId: string;
    reference: string;
    context: string | null;
    readyAt: string | null;
  }>;
  onDismiss: (orderId: string) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="Pedidos prontos neste aplicativo" className="kds-ready-notices">
      {notices.map((notice) => (
        <Card key={notice.orderId} role="status">
          <div>
            <strong>Pedido pronto · {notice.reference}</strong>
            <span>{notice.context ?? "Todas as estações concluíram o pedido."}</span>
          </div>
          <Button onClick={() => onDismiss(notice.orderId)} size="sm" variant="secondary">
            Dispensar aviso
          </Button>
        </Card>
      ))}
      <p className="gm-sr-only">
        Estes avisos existem somente dentro do GiroMesa e não confirmam mensagem externa ao cliente.
      </p>
    </section>
  );
}

export function KdsAnalyticsPanel({
  analytics,
  error,
  loading,
  onLoad,
  onWindowChange,
  windowHours,
}: {
  analytics: KdsAnalytics | null;
  error: string | null;
  loading: boolean;
  onLoad: () => void;
  onWindowChange: (hours: number) => void;
  windowHours: number;
}) {
  return (
    <details className="kds-support-panel kds-analytics-panel">
      <summary>Histórico e desempenho</summary>
      <div className="kds-support-panel__body">
        <div className="kds-analytics-controls">
          <label>
            Período
            <NativeSelect
              onChange={(event) => onWindowChange(Number(event.target.value))}
              value={windowHours}
            >
              <option value={24}>Últimas 24 horas</option>
              <option value={72}>Últimas 72 horas</option>
              <option value={168}>Últimos 7 dias</option>
              <option value={672}>Últimos 28 dias</option>
            </NativeSelect>
          </label>
          <Button disabled={loading} onClick={onLoad} size="sm" variant="secondary">
            {loading ? "Carregando…" : "Carregar histórico"}
          </Button>
        </div>
        {error && (
          <p className="kds-action-error" role="alert">
            {error}
          </p>
        )}
        {analytics && (
          <>
            <div className="kds-analytics-metrics">
              <span>
                <strong>{analytics.prep.p50Minutes ?? "—"}</strong> min p50
              </span>
              <span>
                <strong>{analytics.prep.p90Minutes ?? "—"}</strong> min p90
              </span>
              <span>
                <strong>{analytics.counts.blocked ?? "—"}</strong> bloqueios
              </span>
              <span>
                <strong>{analytics.counts.refired ?? "—"}</strong> refações
              </span>
              <span>
                <strong>{analytics.counts.availability86 ?? "—"}</strong> marcações 86
              </span>
              {analytics.counts.completed !== null && (
                <span>
                  <strong>{analytics.counts.completed}</strong> concluídos
                </span>
              )}
              {analytics.counts.rerouted !== null && (
                <span>
                  <strong>{analytics.counts.rerouted}</strong> desvios
                </span>
              )}
              {analytics.counts.canceled !== null && (
                <span>
                  <strong>{analytics.counts.canceled}</strong> cancelados
                </span>
              )}
            </div>
            {analytics.slowProducts.length > 0 && (
              <div className="kds-slow-products">
                <h3>Itens mais lentos</h3>
                <ol>
                  {analytics.slowProducts.slice(0, 8).map((product) => (
                    <li key={product.productId ?? product.productName}>
                      <span>{product.productName}</span>
                      <strong>p90 {product.p90Minutes ?? "—"} min</strong>
                      <small>{product.count} amostra(s)</small>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

export function KdsBatchesPanel({
  batches,
  busyKeys,
  cloudUnavailable,
  errors,
  onCancel,
  onComplete,
  onCreate,
  products,
  stations,
}: {
  batches: KdsBatch[];
  busyKeys: Set<string>;
  cloudUnavailable: boolean;
  errors: Record<string, string>;
  onCancel: (batch: KdsBatch, reason: string) => void;
  onComplete: (batch: KdsBatch) => void;
  onCreate: (input: { stationId: string; productId?: string; maxAssignments: number }) => void;
  products: KdsAllDayItem[];
  stations: KdsStation[];
}) {
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [maxAssignments, setMaxAssignments] = useState(8);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const availableProducts = useMemo(() => {
    const hasStationMetadata = products.some((item) => item.stationId !== null);
    const compatible = products.filter(
      (item) => item.productId !== null && (!hasStationMetadata || item.stationId === stationId),
    );
    return [...new Map(compatible.map((item) => [item.productId, item])).values()];
  }, [products, stationId]);
  useEffect(() => {
    if (!stations.some((station) => station.id === stationId)) setStationId(stations[0]?.id ?? "");
  }, [stationId, stations]);
  useEffect(() => {
    if (productId && !availableProducts.some((item) => item.productId === productId)) {
      setProductId("");
    }
  }, [availableProducts, productId]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stationId) return;
    onCreate({
      stationId,
      ...(productId ? { productId } : {}),
      maxAssignments: Math.min(50, Math.max(1, Math.floor(maxAssignments))),
    });
  };

  return (
    <details className="kds-support-panel kds-batches-panel">
      <summary>
        Lotes de produção
        <Badge tone={batches.some((batch) => batch.status === "active") ? "info" : "neutral"}>
          {batches.filter((batch) => batch.status === "active").length} ativos
        </Badge>
      </summary>
      <div className="kds-support-panel__body">
        <form className="kds-batch-form" onSubmit={submit}>
          <label>
            Estação
            <NativeSelect
              onChange={(event) => setStationId(event.target.value)}
              required
              value={stationId}
            >
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Produto opcional
            <NativeSelect onChange={(event) => setProductId(event.target.value)} value={productId}>
              <option value="">Qualquer item compatível</option>
              {availableProducts.map((item) => (
                <option key={item.productId} value={item.productId ?? ""}>
                  {item.productName}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Máximo de itens
            <Input
              inputMode="numeric"
              max={50}
              min={1}
              onChange={(event) => setMaxAssignments(Number(event.target.value))}
              required
              type="number"
              value={maxAssignments}
            />
          </label>
          <Button disabled={cloudUnavailable || !stationId} type="submit">
            Criar lote
          </Button>
          {cloudUnavailable && (
            <small>Criação e gestão de lotes exigem conexão com o servidor.</small>
          )}
        </form>
        <div className="kds-batch-list">
          {batches.length === 0 ? (
            <p>Nenhum lote neste snapshot.</p>
          ) : (
            batches.map((batch) => {
              const completeKey = `batch:${batch.id}:complete`;
              const cancelKey = `batch:${batch.id}:cancel`;
              const busy = busyKeys.has(completeKey) || busyKeys.has(cancelKey);
              const productName =
                batch.productName ??
                products.find((product) => product.productId === batch.productId)?.productName ??
                "Lote misto";
              return (
                <Card key={batch.id}>
                  <header>
                    <div>
                      <strong>{productName}</strong>
                      <small>
                        {batch.assignmentCount} atribuições · {batch.totalQuantity} unidade(s)
                        {batch.maxAssignments !== null ? ` · limite ${batch.maxAssignments}` : ""}
                      </small>
                    </div>
                    <Badge
                      tone={
                        batch.status === "completed"
                          ? "success"
                          : batch.status === "canceled"
                            ? "danger"
                            : "info"
                      }
                    >
                      {batch.status === "completed"
                        ? "Concluído"
                        : batch.status === "canceled"
                          ? "Cancelado"
                          : "Ativo"}
                    </Badge>
                  </header>
                  {batch.status === "active" && cancelingId !== batch.id && (
                    <div className="kds-batch-actions">
                      <Button
                        disabled={busy || cloudUnavailable}
                        onClick={() => onComplete(batch)}
                        size="sm"
                      >
                        Concluir lote
                      </Button>
                      <Button
                        disabled={busy || cloudUnavailable}
                        onClick={() => setCancelingId(batch.id)}
                        size="sm"
                        variant="ghost"
                      >
                        Cancelar lote
                      </Button>
                    </div>
                  )}
                  {batch.status === "active" && cancelingId === batch.id && (
                    <form
                      className="kds-batch-cancel"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (cancelReason.trim().length < 3) return;
                        onCancel(batch, cancelReason.trim());
                        setCancelingId(null);
                        setCancelReason("");
                      }}
                    >
                      <label>
                        Motivo do cancelamento
                        <Input
                          minLength={3}
                          onChange={(event) => setCancelReason(event.target.value)}
                          required
                          value={cancelReason}
                        />
                      </label>
                      <Button disabled={busy} size="sm" type="submit" variant="danger">
                        Confirmar
                      </Button>
                      <Button
                        onClick={() => setCancelingId(null)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Voltar
                      </Button>
                    </form>
                  )}
                  {(errors[completeKey] || errors[cancelKey]) && (
                    <p className="kds-action-error" role="alert">
                      {errors[completeKey] ?? errors[cancelKey]}
                    </p>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </details>
  );
}
