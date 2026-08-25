import {
  Badge,
  Button,
  Callout,
  Card,
  FormField,
  Modal,
  NativeSelect,
  Textarea,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ProductionPrinter,
  type ProductionPrinterHub,
  type ProductionPrintingPolicy,
  type ProductionPrintingStation,
  type ProductionPrintJob,
  type ProductionPrintResolutionOutcome,
} from "../../api";
import {
  type DeviceContext,
  loadShellLocalPrintQueue,
  loadShellPrinterDiagnostics,
} from "../../bridge";
import {
  createProductionPrinterDraft,
  type ProductionPrinterDraft,
  ProductionPrinterForm,
  productionPrinterInput,
} from "./ProductionPrinterForm";
import { ProductionStationPolicies } from "./ProductionStationPolicies";
import {
  type LocalPrintQueueJob,
  type PrinterDiagnostic,
  parseLocalPrintQueue,
  parsePrinterDiagnostics,
} from "./printer-diagnostics";
import { productionPrintJobAction } from "./production-print-job-actions";

type CloudState =
  | { status: "restricted" }
  | { status: "loading" }
  | {
      status: "ready";
      printers: ProductionPrinter[];
      stations: ProductionPrintingStation[];
      jobs: ProductionPrintJob[];
      hubs: ProductionPrinterHub[];
    }
  | { status: "error"; message: string };

type EdgeState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "ready"; printers: PrinterDiagnostic[]; jobs: LocalPrintQueueJob[] }
  | { status: "error"; message: string };

function statusTone(status: string): "neutral" | "info" | "warning" | "success" | "danger" {
  if (
    status === "applied" ||
    status === "online" ||
    status === "printed" ||
    status === "accepted"
  ) {
    return "success";
  }
  if (status === "pending" || status === "queued" || status === "printing") return "info";
  if (status === "confirmation_required") return "warning";
  if (status === "error" || status === "failed" || status === "rejected") return "danger";
  return "neutral";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    accepted: "Aceita pelo Edge",
    applied: "Aplicada",
    confirmation_required: "Confirmar saída física",
    error: "Com erro",
    failed: "Falhou",
    online: "Online",
    pending: "Pendente",
    printed: "Impressa",
    printing: "Imprimindo",
    queued: "Na fila",
    rejected: "Rejeitada",
    unknown: "Sem diagnóstico",
  };
  return labels[status] ?? status;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "Não informado";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(parsed);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ProductionPrintersPanel({
  canManage,
  organizationId,
  runtime,
  unitId,
}: {
  canManage: boolean;
  organizationId: string;
  runtime: DeviceContext;
  unitId: string;
}) {
  const [cloud, setCloud] = useState<CloudState>(
    canManage ? { status: "loading" } : { status: "restricted" },
  );
  const [edge, setEdge] = useState<EdgeState>(
    runtime.embedded ? { status: "loading" } : { status: "unavailable" },
  );
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, ProductionPrintingPolicy>>({});
  const [printerDraft, setPrinterDraft] = useState<ProductionPrinterDraft | null>(null);
  const [printerMutationKey, setPrinterMutationKey] = useState("");
  const [reprintJob, setReprintJob] = useState<ProductionPrintJob | null>(null);
  const [reprintReason, setReprintReason] = useState("");
  const [reprintKey, setReprintKey] = useState("");
  const [unknownResolution, setUnknownResolution] = useState<{
    job: ProductionPrintJob;
    outcome: ProductionPrintResolutionOutcome | "";
    reason: string;
    idempotencyKey: string;
  } | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "danger" | "info";
  } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const inFlightRef = useRef(new Set<string>());

  const loadCloud = useCallback(async () => {
    if (!canManage) {
      setCloud({ status: "restricted" });
      return;
    }
    setCloud({ status: "loading" });
    try {
      const [printerResponse, stationResponse, jobs] = await Promise.all([
        api.pilot.productionPrinters(organizationId, unitId),
        api.pilot.productionPrintingStations(organizationId, unitId),
        api.pilot.productionPrintJobs(organizationId, unitId, { limit: 40 }),
      ]);
      setCloud({
        status: "ready",
        printers: printerResponse.printers,
        stations: stationResponse.stations,
        jobs,
        hubs: printerResponse.hubs,
      });
      setPolicyDrafts(
        Object.fromEntries(
          stationResponse.stations.map((station) => [
            station.id,
            {
              deliveryMode: station.deliveryMode,
              copies: station.copies,
              printerId: station.printerId,
            },
          ]),
        ),
      );
    } catch (error) {
      setCloud({
        status: "error",
        message: errorMessage(
          error,
          "Não foi possível carregar as impressoras de produção desta unidade.",
        ),
      });
    }
  }, [canManage, organizationId, unitId]);

  const loadEdge = useCallback(async () => {
    if (!runtime.embedded) {
      setEdge({ status: "unavailable" });
      return;
    }
    setEdge({ status: "loading" });
    try {
      const [diagnostics, queue] = await Promise.all([
        loadShellPrinterDiagnostics(),
        loadShellLocalPrintQueue(undefined, 40),
      ]);
      if (!diagnostics?.success) {
        setEdge({
          status: "error",
          message: `O Edge não entregou o diagnóstico (${diagnostics?.errorCode ?? "indisponível"}).`,
        });
        return;
      }
      setEdge({
        status: "ready",
        printers: parsePrinterDiagnostics(diagnostics.payload),
        jobs: queue?.success ? parseLocalPrintQueue(queue.payload) : [],
      });
    } catch (error) {
      setEdge({
        status: "error",
        message: errorMessage(error, "Não foi possível consultar o Edge deste terminal."),
      });
    }
  }, [runtime.embedded]);

  useEffect(() => {
    void loadCloud();
  }, [loadCloud]);

  useEffect(() => {
    void loadEdge();
  }, [loadEdge]);

  const failedJobs = useMemo(
    () =>
      cloud.status === "ready"
        ? cloud.jobs.filter(
            (job) => job.status === "failed" || job.status === "confirmation_required",
          ).length
        : 0,
    [cloud],
  );

  const beginAction = (key: string): boolean => {
    if (inFlightRef.current.has(key)) return false;
    inFlightRef.current.add(key);
    setBusyAction(key);
    return true;
  };

  const finishAction = (key: string) => {
    inFlightRef.current.delete(key);
    setBusyAction((current) => (current === key ? null : current));
  };

  async function savePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!printerDraft || !canManage) return;
    const actionKey = `printer:${printerDraft.id ?? "new"}:${printerMutationKey}`;
    if (!beginAction(actionKey)) return;
    try {
      const input = productionPrinterInput(printerDraft);
      if (printerDraft.id && printerDraft.revision !== null) {
        await api.pilot.updateProductionPrinter(
          organizationId,
          unitId,
          printerDraft.id,
          { ...input, revision: printerDraft.revision },
          printerMutationKey,
        );
      } else {
        await api.pilot.createProductionPrinter(organizationId, unitId, input, printerMutationKey);
      }
      setToast({
        tone: "success",
        message: printerDraft.id
          ? "Alteração publicada; acompanhe o estado aplicado no Edge."
          : "Impressora cadastrada; a publicação para o Edge está pendente.",
      });
      setPrinterDraft(null);
      await loadCloud();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível salvar a impressora."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function archivePrinter(printer: ProductionPrinter) {
    if (!canManage) return;
    if (
      !window.confirm(
        `Arquivar ${printer.label}? Novos trabalhos deixarão de usar esta configuração.`,
      )
    ) {
      return;
    }
    const actionKey = `archive:${printer.id}:${printer.revision}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.pilot.archiveProductionPrinter(
        organizationId,
        unitId,
        printer.id,
        printer.revision,
        `production-printer/${printer.id}/archive/${printer.revision}`,
      );
      setToast({ tone: "success", message: "Impressora arquivada e comando enviado ao Edge." });
      await loadCloud();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível arquivar a impressora."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function testPrinter(printer: ProductionPrinter) {
    const actionKey = `test:${printer.id}:${printer.revision}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.pilot.testProductionPrinter(
        organizationId,
        unitId,
        printer.id,
        printer.revision,
        `production-printer/${printer.id}/test/${crypto.randomUUID()}`,
      );
      setToast({
        tone: "info",
        message: "Teste enfileirado. A confirmação física aparecerá no diagnóstico.",
      });
      await loadCloud();
      if (runtime.embedded) await loadEdge();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível solicitar o teste físico."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function savePolicy(station: ProductionPrintingStation) {
    const policy = policyDrafts[station.id];
    if (!policy || !canManage) return;
    const actionKey = `policy:${station.id}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.pilot.updateProductionPrintingStationPolicy(
        organizationId,
        unitId,
        station.id,
        policy,
        `production-station/${station.id}/policy/${crypto.randomUUID()}`,
      );
      setToast({ tone: "success", message: `Política de ${station.name} atualizada.` });
      await loadCloud();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível atualizar a política da estação."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function submitReprint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reprintJob || reprintReason.trim().length < 3 || !reprintKey) return;
    const actionKey = `reprint:${reprintKey}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.pilot.reprintProductionPrintJob(
        organizationId,
        unitId,
        reprintJob.id,
        { copies: reprintJob.copies, reason: reprintReason.trim() },
        reprintKey,
      );
      setToast({
        tone: "success",
        message:
          reprintJob.status === "failed"
            ? "Nova tentativa enviada à fila com o motivo informado."
            : "Reimpressão enviada à fila com o motivo informado.",
      });
      setReprintJob(null);
      setReprintReason("");
      setReprintKey("");
      await loadCloud();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível solicitar a reimpressão."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function submitUnknownResolution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unknownResolution?.outcome || unknownResolution.reason.trim().length < 3) {
      return;
    }
    const actionKey = `resolve-unknown:${unknownResolution.idempotencyKey}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.pilot.resolveUnknownProductionPrintJob(
        organizationId,
        unitId,
        unknownResolution.job.id,
        {
          outcome: unknownResolution.outcome,
          reason: unknownResolution.reason.trim(),
        },
        unknownResolution.idempotencyKey,
      );
      setToast({
        tone: "success",
        message:
          unknownResolution.outcome === "printed"
            ? "Saída física confirmada como impressa."
            : "Resultado marcado como falha. Agora é possível tentar novamente.",
      });
      setUnknownResolution(null);
      await loadCloud();
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível confirmar o resultado físico."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  return (
    <section className="production-printers" aria-labelledby="production-printers-title">
      <header className="production-printers__header">
        <div>
          <p className="eyebrow">Produção</p>
          <h2 id="production-printers-title">Impressoras de produção</h2>
          <p>
            Cadastre o estado desejado na unidade e acompanhe a aplicação e a saída física no Edge.
          </p>
        </div>
        <div className="production-printers__header-actions">
          {cloud.status === "ready" && (
            <Badge tone={failedJobs > 0 ? "danger" : "success"}>
              {failedJobs > 0 ? `${failedJobs} falha(s) pendente(s)` : "Fila sem falhas"}
            </Badge>
          )}
          {canManage && (
            <Button
              onClick={() => {
                setPrinterDraft(
                  createProductionPrinterDraft(
                    undefined,
                    cloud.status === "ready" ? cloud.hubs : [],
                    cloud.status === "ready" ? cloud.printers : [],
                  ),
                );
                setPrinterMutationKey(crypto.randomUUID());
              }}
              size="sm"
            >
              Cadastrar impressora
            </Button>
          )}
          {canManage && (
            <Button
              disabled={cloud.status === "loading"}
              onClick={() => void loadCloud()}
              size="sm"
              variant="secondary"
            >
              Atualizar
            </Button>
          )}
        </div>
      </header>

      {!canManage && (
        <Callout tone="info">
          <strong>Consulta operacional</strong>
          <p>
            Cadastro, política, fila cloud, teste e reimpressão exigem gestão da unidade. O
            diagnóstico local abaixo continua limitado a este dispositivo.
          </p>
        </Callout>
      )}

      {cloud.status === "loading" && <p role="status">Carregando impressoras e fila…</p>}
      {cloud.status === "error" && (
        <Callout tone="danger">
          <strong>Configuração cloud indisponível</strong>
          <p>{cloud.message}</p>
          <Button onClick={() => void loadCloud()} size="sm" variant="secondary">
            Tentar novamente
          </Button>
        </Callout>
      )}

      {cloud.status === "ready" && (
        <>
          <section className="production-printers__summary" aria-label="Resumo da impressão">
            <Card>
              <span>Impressoras ativas</span>
              <strong>{cloud.printers.filter((printer) => printer.active !== false).length}</strong>
            </Card>
            <Card>
              <span>Estações prontas</span>
              <strong>
                {cloud.stations.filter((station) => station.readiness.ready).length}/
                {cloud.stations.filter((station) => station.active).length}
              </strong>
            </Card>
            <Card>
              <span>Fila cloud</span>
              <strong>{cloud.jobs.length}</strong>
            </Card>
            <Card>
              <span>Falhas / confirmação</span>
              <strong>{failedJobs}</strong>
            </Card>
          </section>

          <div className="production-printers__layout">
            <section aria-labelledby="production-printer-list-title">
              <div className="production-printers__section-heading">
                <div>
                  <h3 id="production-printer-list-title">Cadastro e saúde</h3>
                  <p>O estado pendente ainda não garante que o Edge aplicou a configuração.</p>
                </div>
              </div>
              {cloud.printers.length === 0 ? (
                <Card className="production-printers__empty">
                  <strong>Nenhuma impressora cadastrada</strong>
                  <p>Cadastre a primeira impressora e depois vincule as estações de preparo.</p>
                </Card>
              ) : (
                <div className="production-printers__cards">
                  {cloud.printers.map((printer) => (
                    <Card className="production-printer-card" key={printer.id}>
                      <header>
                        <div>
                          <strong>{printer.label}</strong>
                          <small>
                            {printer.host}:{printer.port} · {printer.paperWidthMm} mm
                          </small>
                        </div>
                        <span className="production-printer-card__badges">
                          <Badge tone={statusTone(printer.applyStatus)}>
                            {statusLabel(printer.applyStatus)}
                          </Badge>
                          <Badge tone={statusTone(printer.lastStatus)}>
                            {statusLabel(printer.lastStatus)}
                          </Badge>
                        </span>
                      </header>
                      <dl>
                        <div>
                          <dt>Edge</dt>
                          <dd>
                            {cloud.hubs.find((hub) => hub.id === printer.hubId)?.label ??
                              printer.hubId}
                          </dd>
                        </div>
                        <div>
                          <dt>Revisão</dt>
                          <dd>
                            desejada {printer.revision} · aplicada {printer.appliedRevision ?? "—"}
                          </dd>
                        </div>
                        <div>
                          <dt>Setores</dt>
                          <dd>{printer.stationIds?.length || "Definidos nas políticas"}</dd>
                        </div>
                        <div>
                          <dt>Tipos</dt>
                          <dd>{printer.documentTypes.join(", ") || "Nenhum"}</dd>
                        </div>
                        <div>
                          <dt>Último teste</dt>
                          <dd>{dateTime(printer.lastTestAt)}</dd>
                        </div>
                      </dl>
                      {printer.lastError && (
                        <p className="production-printer-card__error" role="alert">
                          {printer.lastError}
                        </p>
                      )}
                      <div className="production-printer-card__actions">
                        <Button
                          disabled={!canManage || busyAction !== null}
                          onClick={() => void testPrinter(printer)}
                          size="sm"
                          variant="secondary"
                        >
                          {busyAction === `test:${printer.id}:${printer.revision}`
                            ? "Enfileirando…"
                            : "Imprimir teste"}
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              disabled={busyAction !== null}
                              onClick={() => {
                                setPrinterDraft(
                                  createProductionPrinterDraft(printer, cloud.hubs, cloud.printers),
                                );
                                setPrinterMutationKey(crypto.randomUUID());
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              Editar
                            </Button>
                            <Button
                              disabled={busyAction !== null}
                              onClick={() => void archivePrinter(printer)}
                              size="sm"
                              variant="ghost"
                            >
                              Arquivar
                            </Button>
                          </>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <ProductionStationPolicies
              busyAction={busyAction}
              canManage={canManage}
              drafts={policyDrafts}
              onChange={(stationId, policy) =>
                setPolicyDrafts((current) => ({ ...current, [stationId]: policy }))
              }
              onSave={(station) => void savePolicy(station)}
              printers={cloud.printers}
              stations={cloud.stations}
            />
          </div>

          <section aria-labelledby="production-print-queue-title">
            <div className="production-printers__section-heading">
              <div>
                <h3 id="production-print-queue-title">Fila e falhas</h3>
                <p>Reimpressão é sempre uma ação separada e exige motivo.</p>
              </div>
            </div>
            {cloud.jobs.length === 0 ? (
              <Card className="production-printers__empty">
                <strong>Fila vazia</strong>
                <p>Nenhum ticket de produção foi solicitado neste recorte.</p>
              </Card>
            ) : (
              <section className="production-print-queue" aria-label="Trabalhos de impressão">
                <table>
                  <thead>
                    <tr>
                      <th>Estação</th>
                      <th>Impressora</th>
                      <th>Status</th>
                      <th>Horário</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {cloud.jobs.map((job) => {
                      const action = productionPrintJobAction(job.status);
                      return (
                        <tr key={job.id}>
                          <td>{job.stationName ?? job.stationId ?? "Roteamento automático"}</td>
                          <td>{job.printerId ?? "Automática"}</td>
                          <td>
                            <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
                            {job.lastError && <small>{job.lastError}</small>}
                          </td>
                          <td>{dateTime(job.updatedAt)}</td>
                          <td>
                            {(action === "reprint" || action === "retry_failed") && (
                              <Button
                                disabled={!canManage || busyAction !== null}
                                onClick={() => {
                                  setReprintJob(job);
                                  setReprintReason("");
                                  setReprintKey(crypto.randomUUID());
                                }}
                                size="sm"
                                variant="ghost"
                              >
                                {action === "retry_failed" ? "Tentar novamente…" : "Reimprimir…"}
                              </Button>
                            )}
                            {action === "resolve_unknown" && (
                              <Button
                                disabled={!canManage || busyAction !== null}
                                onClick={() =>
                                  setUnknownResolution({
                                    job,
                                    outcome: "",
                                    reason: "",
                                    idempotencyKey: crypto.randomUUID(),
                                  })
                                }
                                size="sm"
                                variant="secondary"
                              >
                                Confirmar resultado…
                              </Button>
                            )}
                            {action === null && <small>Em processamento</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}
          </section>
        </>
      )}

      <section className="production-edge" aria-labelledby="production-edge-title">
        <div className="production-printers__section-heading">
          <div>
            <h3 id="production-edge-title">Diagnóstico deste dispositivo</h3>
            <p>Leitura local do Edge; não altera o cadastro da unidade.</p>
          </div>
          {runtime.embedded && (
            <Button
              disabled={edge.status === "loading"}
              onClick={() => void loadEdge()}
              size="sm"
              variant="secondary"
            >
              Atualizar Edge
            </Button>
          )}
        </div>
        {edge.status === "unavailable" && (
          <Callout tone="info">
            <strong>Diagnóstico local disponível somente no aplicativo</strong>
            <p>
              No navegador, a configuração cloud continua disponível. Abra o aplicativo do terminal
              para confirmar a saúde e a fila efetiva do Edge.
            </p>
          </Callout>
        )}
        {edge.status === "loading" && <p role="status">Consultando o Edge deste terminal…</p>}
        {edge.status === "error" && (
          <Callout tone="warning">
            <strong>Edge não respondeu</strong>
            <p>{edge.message}</p>
          </Callout>
        )}
        {edge.status === "ready" && (
          <div className="production-edge__grid">
            <Card>
              <strong>Impressoras efetivas</strong>
              {edge.printers.length === 0 ? (
                <p>Nenhuma configuração foi aplicada neste Edge.</p>
              ) : (
                <ul>
                  {edge.printers.map((printer) => (
                    <li key={printer.id}>
                      <span>
                        {printer.id} · {printer.paperWidthMm} mm
                      </span>
                      <Badge tone={printer.available ? "success" : "danger"}>
                        {printer.available ? "Disponível" : (printer.errorCode ?? "Indisponível")}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <strong>Fila local</strong>
              {edge.jobs.length === 0 ? (
                <p>Nenhum trabalho local neste recorte.</p>
              ) : (
                <ul>
                  {edge.jobs.slice(0, 12).map((job) => (
                    <li key={job.id}>
                      <span>{job.stationName ?? job.printerId ?? job.documentType}</span>
                      <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </section>

      <ProductionPrinterForm
        busy={busyAction?.startsWith("printer:") === true}
        draft={printerDraft}
        hubs={cloud.status === "ready" ? cloud.hubs : []}
        onChange={setPrinterDraft}
        onClose={() => setPrinterDraft(null)}
        onSubmit={savePrinter}
        printers={cloud.status === "ready" ? cloud.printers : []}
      />

      <Modal
        isOpen={reprintJob !== null}
        onClose={() => {
          if (busyAction) return;
          setReprintJob(null);
          setReprintReason("");
          setReprintKey("");
        }}
        size="sm"
        title={
          reprintJob?.status === "failed"
            ? "Tentar impressão novamente"
            : "Reimprimir ticket de produção"
        }
      >
        <form className="production-reprint-form" onSubmit={submitReprint}>
          <p>
            {reprintJob?.status === "failed"
              ? "Esta ação cria uma nova tentativa auditável. O trabalho com falha permanece no histórico."
              : "Esta ação cria um novo trabalho vinculado ao original. Ela não reutiliza o clique da primeira via."}
          </p>
          <FormField htmlFor="production-reprint-reason" label="Motivo" required>
            <Textarea
              autoFocus
              id="production-reprint-reason"
              maxLength={500}
              minLength={3}
              onChange={(event) => setReprintReason(event.target.value)}
              required
              rows={3}
              value={reprintReason}
            />
          </FormField>
          <div className="production-printer-form__actions">
            <Button
              disabled={busyAction !== null}
              onClick={() => {
                setReprintJob(null);
                setReprintReason("");
                setReprintKey("");
              }}
              type="button"
              variant="ghost"
            >
              Voltar
            </Button>
            <Button disabled={busyAction !== null || reprintReason.trim().length < 3} type="submit">
              {busyAction?.startsWith("reprint:")
                ? "Enviando…"
                : reprintJob?.status === "failed"
                  ? "Confirmar nova tentativa"
                  : "Confirmar reimpressão"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={unknownResolution !== null}
        onClose={() => {
          if (busyAction) return;
          setUnknownResolution(null);
        }}
        size="sm"
        title="Confirmar resultado da impressão"
      >
        {unknownResolution && (
          <form className="production-reprint-form" onSubmit={submitUnknownResolution}>
            <Callout tone="warning">
              <strong>Não reenvie este ticket agora</strong>
              <p>
                Verifique a impressora fisicamente. O Edge iniciou a escrita, mas não conseguiu
                confirmar se o papel saiu.
              </p>
            </Callout>
            <FormField htmlFor="production-unknown-outcome" label="Resultado físico" required>
              <NativeSelect
                autoFocus
                id="production-unknown-outcome"
                onChange={(event) =>
                  setUnknownResolution((current) =>
                    current
                      ? {
                          ...current,
                          outcome: event.target.value as ProductionPrintResolutionOutcome | "",
                        }
                      : null,
                  )
                }
                required
                value={unknownResolution.outcome}
              >
                <option value="">Selecione após conferir</option>
                <option value="printed">Saiu na impressora</option>
                <option value="failed">Não foi impresso</option>
              </NativeSelect>
            </FormField>
            <FormField htmlFor="production-unknown-reason" label="Motivo da confirmação" required>
              <Textarea
                id="production-unknown-reason"
                maxLength={500}
                minLength={3}
                onChange={(event) =>
                  setUnknownResolution((current) =>
                    current ? { ...current, reason: event.target.value } : null,
                  )
                }
                required
                rows={3}
                value={unknownResolution.reason}
              />
            </FormField>
            <div className="production-printer-form__actions">
              <Button
                disabled={busyAction !== null}
                onClick={() => setUnknownResolution(null)}
                type="button"
                variant="ghost"
              >
                Voltar
              </Button>
              <Button
                disabled={
                  busyAction !== null ||
                  !unknownResolution.outcome ||
                  unknownResolution.reason.trim().length < 3
                }
                type="submit"
              >
                {busyAction?.startsWith("resolve-unknown:")
                  ? "Registrando…"
                  : "Registrar resultado"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {toast && (
        <Toast
          message={toast.message}
          onDismiss={() => setToast(null)}
          title={toast.tone === "danger" ? "Não foi possível concluir" : "Impressão de produção"}
          tone={toast.tone}
        />
      )}
    </section>
  );
}
