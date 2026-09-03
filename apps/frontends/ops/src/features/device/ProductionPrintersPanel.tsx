import {
  Badge,
  Button,
  Callout,
  Card,
  FormField,
  Input,
  Modal,
  NativeSelect,
  Textarea,
  Toast,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type EdgeHubPairing,
  type EdgeHubPilotExperience,
  edgeHubInstallerDownloadUrl,
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
  type ProductionPrinterProbeState,
  productionPrinterInput,
} from "./ProductionPrinterForm";
import { ProductionRoutingSetup } from "./ProductionRoutingSetup";
import { ProductionStationPolicies } from "./ProductionStationPolicies";
import {
  type LocalPrintQueueJob,
  type PrinterDiagnostic,
  parseLocalPrintQueue,
  parsePrinterDiagnostics,
} from "./printer-diagnostics";
import { productionPrintJobAction } from "./production-print-job-actions";
import {
  firstIncompleteProductionStep,
  type ProductionSetupStep,
  productionSetupReadiness,
  productionSetupSteps,
} from "./production-setup";

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
    accepted: "Recebida pelo computador",
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
  const [printerProbe, setPrinterProbe] = useState<{
    state: ProductionPrinterProbeState;
    message: string | null;
  }>({ state: "idle", message: null });
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
  const [routingReady, setRoutingReady] = useState(false);
  const [setupStep, setSetupStep] = useState<ProductionSetupStep | null>(null);
  const [computerLabel, setComputerLabel] = useState("Computador da unidade");
  const [pairing, setPairing] = useState<EdgeHubPairing | null>(null);
  const [installerDownloadStarted, setInstallerDownloadStarted] = useState(false);
  const [pilotExperience, setPilotExperience] = useState<EdgeHubPilotExperience>("easy");
  const [pilotComment, setPilotComment] = useState("");
  const [pilotFeedbackSent, setPilotFeedbackSent] = useState(false);
  const inFlightRef = useRef(new Set<string>());
  const printerProbeRequestRef = useRef(0);

  const loadCloud = useCallback(
    async (silent = false) => {
      if (!canManage) {
        setCloud({ status: "restricted" });
        return;
      }
      if (!silent) setCloud({ status: "loading" });
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
        if (!silent) {
          setCloud({
            status: "error",
            message: errorMessage(
              error,
              "Não foi possível carregar as impressoras de produção desta unidade.",
            ),
          });
        }
      }
    },
    [canManage, organizationId, unitId],
  );

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
          message: "O computador não entregou a conferência das impressoras.",
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
        message: errorMessage(error, "Não foi possível consultar este computador."),
      });
    }
  }, [runtime.embedded]);

  useEffect(() => {
    void loadCloud();
  }, [loadCloud]);

  useEffect(() => {
    void loadEdge();
  }, [loadEdge]);

  useEffect(() => {
    if (
      !pairing ||
      Date.parse(pairing.expiresAt) <= Date.now() ||
      (cloud.status === "ready" && cloud.hubs.some((hub) => hub.online))
    )
      return;
    const refresh = window.setInterval(() => void loadCloud(true), 5_000);
    return () => window.clearInterval(refresh);
  }, [cloud, loadCloud, pairing]);

  const failedJobs = useMemo(
    () =>
      cloud.status === "ready"
        ? cloud.jobs.filter(
            (job) => job.status === "failed" || job.status === "confirmation_required",
          ).length
        : 0,
    [cloud],
  );
  const setupReadiness = useMemo(
    () =>
      cloud.status === "ready"
        ? productionSetupReadiness(cloud.hubs, cloud.printers, cloud.stations, routingReady)
        : productionSetupReadiness([], [], [], false),
    [cloud, routingReady],
  );
  const testedPrinter =
    cloud.status === "ready"
      ? cloud.printers.find((printer) => Boolean(printer.lastTestAt))
      : undefined;
  const pilotDeviceId =
    testedPrinter?.hubId ??
    (cloud.status === "ready"
      ? (cloud.hubs.find((hub) => hub.online)?.id ?? cloud.hubs[0]?.id)
      : undefined);
  const installationMilestones =
    cloud.status === "ready"
      ? [
          {
            complete: installerDownloadStarted || cloud.hubs.length > 0,
            label: "Download iniciado",
          },
          { complete: cloud.hubs.length > 0, label: "Conector instalado" },
          { complete: cloud.printers.length > 0, label: "Impressora configurada" },
          { complete: Boolean(testedPrinter), label: "Teste impresso" },
        ]
      : [];

  useEffect(() => {
    if (cloud.status === "ready" && setupStep === null) {
      setSetupStep(firstIncompleteProductionStep(setupReadiness));
    }
  }, [cloud.status, setupReadiness, setupStep]);

  const activeStep = setupStep ?? "computer";
  const activeStepIndex = productionSetupSteps.findIndex((step) => step.id === activeStep);

  const beginAction = (key: string): boolean => {
    if (inFlightRef.current.has(key)) return false;
    inFlightRef.current.add(key);
    setBusyAction(key);
    return true;
  };

  async function createComputerPairing() {
    const label = computerLabel.trim();
    if (label.length < 2) {
      setToast({ tone: "danger", message: "Informe um nome para identificar o computador." });
      return;
    }
    const actionKey = "edge-hub-pairing";
    if (!beginAction(actionKey)) return;
    try {
      setPairing(await api.createEdgeHubPairing(organizationId, unitId, label));
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível criar o código de conexão."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  async function copyPairingCode() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setToast({ tone: "success", message: "Código copiado." });
    } catch {
      setToast({ tone: "info", message: "Selecione o código e copie manualmente." });
    }
  }

  function downloadInstaller() {
    if (!pairing) return;
    const url =
      pairing.installerUrl ??
      edgeHubInstallerDownloadUrl(organizationId, unitId, pairing.pairingId);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setInstallerDownloadStarted(true);
  }

  async function submitPilotFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pilotDeviceId) return;
    const actionKey = `edge-hub-pilot-feedback:${pilotDeviceId}`;
    if (!beginAction(actionKey)) return;
    try {
      await api.submitEdgeHubPilotFeedback(organizationId, unitId, {
        deviceId: pilotDeviceId,
        experience: pilotExperience,
        ...(pilotComment.trim() ? { comment: pilotComment.trim() } : {}),
      });
      setPilotFeedbackSent(true);
      setPilotComment("");
      setToast({ tone: "success", message: "Obrigado. O retorno do teste foi registrado." });
    } catch (error) {
      setToast({
        tone: "danger",
        message: errorMessage(error, "Não foi possível registrar o retorno do teste."),
      });
    } finally {
      finishAction(actionKey);
    }
  }

  const finishAction = (key: string) => {
    inFlightRef.current.delete(key);
    setBusyAction((current) => (current === key ? null : current));
  };

  function openPrinterForm(printer?: ProductionPrinter) {
    printerProbeRequestRef.current += 1;
    setPrinterProbe({ state: "idle", message: null });
    setPrinterDraft(
      createProductionPrinterDraft(
        printer,
        cloud.status === "ready" ? cloud.hubs : [],
        cloud.status === "ready" ? cloud.printers : [],
      ),
    );
    setPrinterMutationKey(crypto.randomUUID());
  }

  function changePrinterDraft(nextDraft: ProductionPrinterDraft) {
    if (
      !printerDraft ||
      nextDraft.hubId !== printerDraft.hubId ||
      nextDraft.host !== printerDraft.host ||
      nextDraft.port !== printerDraft.port
    ) {
      printerProbeRequestRef.current += 1;
      setPrinterProbe({ state: "idle", message: null });
    }
    setPrinterDraft(nextDraft);
  }

  function closePrinterForm() {
    printerProbeRequestRef.current += 1;
    setPrinterProbe({ state: "idle", message: null });
    setPrinterDraft(null);
  }

  async function probePrinterConnection() {
    if (!printerDraft || !canManage) return;
    const actionKey = "printer-connection-probe";
    if (!beginAction(actionKey)) return;
    const requestToken = ++printerProbeRequestRef.current;
    setPrinterProbe({ state: "checking", message: "O computador está verificando a impressora…" });
    try {
      const probe = await api.pilot.probeProductionPrinterConnection(
        organizationId,
        unitId,
        {
          hubId: printerDraft.hubId,
          host: printerDraft.host.trim(),
          port: Math.trunc(printerDraft.port),
        },
        `production-printer/probe/${crypto.randomUUID()}`,
      );
      const deadline = Date.parse(probe.expiresAt);
      while (Date.now() < deadline) {
        if (requestToken !== printerProbeRequestRef.current) return;
        const status = await api.pilot.productionPrinterConnectionProbeStatus(
          organizationId,
          unitId,
          probe.commandId,
        );
        if (status.state === "reachable") {
          setPrinterProbe({
            state: "reachable",
            message: "Conexão confirmada. A impressora está acessível por este computador.",
          });
          return;
        }
        if (status.state === "unreachable" || status.state === "timeout") {
          setPrinterProbe({
            state: "unreachable",
            message:
              status.state === "timeout"
                ? "A verificação expirou. Confirme se o computador continua online e tente novamente."
                : "A impressora não respondeu. Confira o IP, a porta e se ela está na mesma rede.",
          });
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (requestToken !== printerProbeRequestRef.current) return;
      setPrinterProbe({
        state: "unreachable",
        message:
          "A verificação expirou. Confirme se o computador continua online e tente novamente.",
      });
    } catch (error) {
      if (requestToken === printerProbeRequestRef.current) {
        setPrinterProbe({
          state: "unreachable",
          message: errorMessage(error, "Não foi possível verificar a conexão com a impressora."),
        });
      }
    } finally {
      finishAction(actionKey);
    }
  }

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
          ? "Alteração salva e enviada ao computador da unidade."
          : "Impressora cadastrada e enviada ao computador da unidade.",
      });
      closePrinterForm();
      await loadCloud(true);
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
      setToast({ tone: "success", message: "Impressora arquivada." });
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
          <p className="eyebrow">Configuração guiada</p>
          <h2 id="production-printers-title">Preparar pedidos na tela e na impressora</h2>
          <p>Conecte os equipamentos e escolha para onde cada pedido deve ir.</p>
        </div>
        <div className="production-printers__header-actions">
          {cloud.status === "ready" && (
            <Badge tone={failedJobs > 0 ? "danger" : "success"}>
              {failedJobs > 0 ? `${failedJobs} falha(s) pendente(s)` : "Fila sem falhas"}
            </Badge>
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
            Cadastro, áreas de preparo, testes e reimpressões exigem gestão da unidade. A
            conferência abaixo continua limitada a este dispositivo.
          </p>
        </Callout>
      )}

      {cloud.status === "loading" && <p role="status">Carregando impressoras e fila…</p>}
      {cloud.status === "error" && (
        <Callout tone="danger">
          <strong>Configuração indisponível</strong>
          <p>{cloud.message}</p>
          <Button onClick={() => void loadCloud()} size="sm" variant="secondary">
            Tentar novamente
          </Button>
        </Callout>
      )}

      {cloud.status === "ready" && (
        <>
          <nav className="production-setup-steps" aria-label="Etapas da configuração">
            <ol>
              {productionSetupSteps.map((step, index) => (
                <li key={step.id}>
                  <button
                    aria-current={activeStep === step.id ? "step" : undefined}
                    data-complete={setupReadiness[step.id]}
                    onClick={() => setSetupStep(step.id)}
                    type="button"
                  >
                    <span aria-hidden="true" className="production-setup-step__index">
                      {setupReadiness[step.id] ? "✓" : index + 1}
                    </span>
                    {step.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <section className="production-printers__summary" aria-label="Resumo da impressão">
            <Card>
              <span>Computadores conectados</span>
              <strong>{cloud.hubs.filter((hub) => hub.online).length}</strong>
            </Card>
            <Card>
              <span>Impressoras ativas</span>
              <strong>{cloud.printers.filter((printer) => printer.active !== false).length}</strong>
            </Card>
            <Card>
              <span>Áreas prontas</span>
              <strong>
                {cloud.stations.filter((station) => station.readiness.ready).length}/
                {cloud.stations.filter((station) => station.active).length}
              </strong>
            </Card>
            <Card>
              <span>Pedidos que precisam de atenção</span>
              <strong>{failedJobs}</strong>
            </Card>
          </section>

          {(pairing || cloud.hubs.length > 0) && (
            <Card className="production-installation-progress">
              <div>
                <strong>Progresso da instalação</strong>
                <small>O GiroMesa confirma automaticamente cada etapa concluída.</small>
              </div>
              <ol aria-label="Etapas da instalação do Conector GiroMesa">
                {installationMilestones.map((milestone, index) => (
                  <li data-complete={milestone.complete} key={milestone.label}>
                    <span aria-hidden="true">{milestone.complete ? "✓" : index + 1}</span>
                    {milestone.label}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {activeStep === "computer" && (
            <section className="production-setup-panel" aria-labelledby="production-computer-title">
              <div className="production-printers__section-heading">
                <div>
                  <h3 id="production-computer-title">Conecte o computador da unidade</h3>
                  <p>
                    Ele mantém a comunicação com as impressoras mesmo quando esta página está
                    fechada.
                  </p>
                </div>
                <Badge tone={setupReadiness.computer ? "success" : "warning"}>
                  {setupReadiness.computer ? "Conectado" : "Aguardando conexão"}
                </Badge>
              </div>
              {cloud.hubs.length === 0 ? (
                <Card className="production-pairing">
                  <div className="production-pairing__heading">
                    <div>
                      <strong>Instale o Conector GiroMesa</strong>
                      <p>
                        Baixe no computador que ficará ligado na unidade. O instalador pedirá apenas
                        o código mostrado aqui.
                      </p>
                    </div>
                    {pairing?.installer?.channel === "pilot" && (
                      <Badge tone="warning">Versão piloto</Badge>
                    )}
                  </div>
                  {pairing?.installer?.channel === "pilot" && (
                    <Callout tone="warning">
                      Esta versão é exclusiva para o teste autorizado desta unidade. O Windows pode
                      informar que o editor ainda não é reconhecido publicamente; prossiga somente
                      com o arquivo baixado por esta tela.
                    </Callout>
                  )}
                  {!pairing && (
                    <p>
                      Primeiro gere o código. Depois, use o botão de download que aparecerá aqui.
                    </p>
                  )}
                  <FormField htmlFor="production-computer-label" label="Nome do computador">
                    <Input
                      id="production-computer-label"
                      maxLength={120}
                      onChange={(event) => setComputerLabel(event.target.value)}
                      value={computerLabel}
                    />
                  </FormField>
                  <div className="production-pairing__actions">
                    {pairing?.installer || pairing?.installerUrl ? (
                      <Button onClick={downloadInstaller}>
                        {pairing.installer?.channel === "pilot"
                          ? "Baixar versão piloto"
                          : "Baixar para Windows"}
                      </Button>
                    ) : null}
                    <Button
                      disabled={busyAction === "edge-hub-pairing"}
                      onClick={() => void createComputerPairing()}
                      variant={pairing ? "secondary" : "primary"}
                    >
                      {busyAction === "edge-hub-pairing" ? "Criando…" : "Gerar código de conexão"}
                    </Button>
                  </div>
                  {pairing ? (
                    <div className="production-pairing__code" role="status">
                      <span>Código válido até {dateTime(pairing.expiresAt)}</span>
                      <strong>{pairing.code}</strong>
                      <Button onClick={() => void copyPairingCode()} size="sm" variant="secondary">
                        Copiar código
                      </Button>
                      {pairing.installer && (
                        <dl className="production-installer-details">
                          <div>
                            <dt>Versão</dt>
                            <dd>{pairing.installer.version}</dd>
                          </div>
                          <div>
                            <dt>Código de verificação (SHA-256)</dt>
                            <dd>{pairing.installer.sha256}</dd>
                          </div>
                        </dl>
                      )}
                      {!pairing.installerUrl && !pairing.installer && (
                        <small>
                          O download ainda não está disponível. Entre em contato com o suporte.
                        </small>
                      )}
                    </div>
                  ) : (
                    <small>O código vale por 5 minutos e funciona uma única vez.</small>
                  )}
                  {pairing?.installer?.channel === "pilot" && (
                    <div className="production-pilot-instructions">
                      <strong>Depois do download</strong>
                      <ol>
                        <li>Abra o arquivo GiroMesa-Conector-Setup-PILOTO.exe.</li>
                        <li>
                          Se o Windows mostrar um aviso, confira se o arquivo veio desta tela e se o
                          código de verificação corresponde ao informado acima.
                        </li>
                        <li>Autorize a instalação e informe o código de conexão.</li>
                        <li>Aguarde esta página confirmar que o computador está conectado.</li>
                      </ol>
                    </div>
                  )}
                </Card>
              ) : (
                <div className="production-computers">
                  {cloud.hubs.map((hub) => (
                    <Card key={hub.id}>
                      <span className="production-computer__info">
                        <strong>{hub.label}</strong>
                        <small>Último contato: {dateTime(hub.lastSeenAt)}</small>
                      </span>
                      <Badge tone={hub.online ? "success" : "warning"}>
                        {hub.online ? "Conectado" : "Sem contato"}
                      </Badge>
                    </Card>
                  ))}
                </div>
              )}
              <Card className="production-connection-guide">
                <strong>Como ligar uma impressora compatível?</strong>
                <ul>
                  <li>
                    <b>Cabo de rede ou Wi-Fi:</b> impressora e computador ficam na mesma rede; não
                    precisam de cabo direto entre eles.
                  </li>
                  <li>
                    <b>USB:</b> ainda não está disponível nesta versão. Para evitar interrupções,
                    use uma impressora com conexão de rede.
                  </li>
                </ul>
              </Card>
            </section>
          )}

          {activeStep === "printer" && (
            <section aria-labelledby="production-printer-list-title">
              <div className="production-printers__section-heading">
                <div>
                  <h3 id="production-printer-list-title">Adicione e teste as impressoras</h3>
                  <p>Use um nome fácil, como “Cozinha quente” ou “Bar”.</p>
                </div>
                {canManage && (
                  <Button onClick={() => openPrinterForm()} size="sm">
                    Adicionar impressora
                  </Button>
                )}
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
                          <dt>Computador</dt>
                          <dd>
                            {cloud.hubs.find((hub) => hub.id === printer.hubId)?.label ??
                              printer.hubId}
                          </dd>
                        </div>
                        <div>
                          <dt>Sincronização</dt>
                          <dd>
                            {printer.appliedRevision === printer.revision
                              ? "Atualizada"
                              : "Aguardando atualização"}
                          </dd>
                        </div>
                        <div>
                          <dt>Setores</dt>
                          <dd>{printer.stationIds?.length || "Definidos nas políticas"}</dd>
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
                              onClick={() => openPrinterForm(printer)}
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
              {pairing?.installer?.channel === "pilot" && testedPrinter && pilotDeviceId && (
                <Card className="production-pilot-feedback">
                  <div>
                    <strong>Como foi instalar e imprimir o teste?</strong>
                    <p>
                      Seu retorno fica registrado para melhorarmos a instalação antes da versão
                      oficial.
                    </p>
                  </div>
                  {pilotFeedbackSent && (
                    <Callout tone="success">
                      Retorno registrado. Você pode enviar novamente se encontrar outra dificuldade.
                    </Callout>
                  )}
                  <form onSubmit={(event) => void submitPilotFeedback(event)}>
                    <FormField htmlFor="production-pilot-experience" label="Experiência">
                      <NativeSelect
                        id="production-pilot-experience"
                        onChange={(event) =>
                          setPilotExperience(event.target.value as EdgeHubPilotExperience)
                        }
                        value={pilotExperience}
                      >
                        <option value="easy">Consegui sem dificuldade</option>
                        <option value="minor_difficulty">Consegui, mas tive dificuldade</option>
                        <option value="blocked">Não consegui concluir</option>
                      </NativeSelect>
                    </FormField>
                    <FormField
                      htmlFor="production-pilot-comment"
                      label="Conte onde teve dificuldade (opcional)"
                    >
                      <Textarea
                        id="production-pilot-comment"
                        maxLength={1000}
                        onChange={(event) => setPilotComment(event.target.value)}
                        rows={3}
                        value={pilotComment}
                      />
                    </FormField>
                    <Button
                      disabled={busyAction === `edge-hub-pilot-feedback:${pilotDeviceId}`}
                      size="sm"
                      type="submit"
                    >
                      {busyAction === `edge-hub-pilot-feedback:${pilotDeviceId}`
                        ? "Enviando…"
                        : "Enviar retorno"}
                    </Button>
                  </form>
                </Card>
              )}
            </section>
          )}

          {activeStep === "stations" && (
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
          )}

          {activeStep === "routing" && (
            <ProductionRoutingSetup
              canManage={canManage}
              onReadinessChange={setRoutingReady}
              organizationId={organizationId}
              stations={cloud.stations}
              unitId={unitId}
            />
          )}

          {activeStep === "check" && (
            <section aria-labelledby="production-print-queue-title">
              <div className="production-printers__section-heading">
                <div>
                  <h3 id="production-print-queue-title">Últimos pedidos enviados para impressão</h3>
                  <p>Use esta lista para confirmar testes, falhas e reimpressões.</p>
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
          )}

          <div className="production-setup-navigation">
            <Button
              disabled={activeStepIndex <= 0}
              onClick={() =>
                setSetupStep(productionSetupSteps[activeStepIndex - 1]?.id ?? "computer")
              }
              variant="secondary"
            >
              Voltar
            </Button>
            {activeStepIndex < productionSetupSteps.length - 1 ? (
              <Button
                onClick={() =>
                  setSetupStep(productionSetupSteps[activeStepIndex + 1]?.id ?? "check")
                }
              >
                Continuar
              </Button>
            ) : (
              <Badge tone={setupReadiness.check ? "success" : "warning"}>
                {setupReadiness.check ? "Produção pronta" : "Revise as etapas pendentes"}
              </Badge>
            )}
          </div>
        </>
      )}

      {activeStep === "check" && (
        <section className="production-edge" aria-labelledby="production-edge-title">
          <div className="production-printers__section-heading">
            <div>
              <h3 id="production-edge-title">Conferência deste computador</h3>
              <p>Mostra o que está realmente disponível neste equipamento.</p>
            </div>
            {runtime.embedded && (
              <Button
                disabled={edge.status === "loading"}
                onClick={() => void loadEdge()}
                size="sm"
                variant="secondary"
              >
                Atualizar conferência
              </Button>
            )}
          </div>
          {edge.status === "unavailable" && (
            <Callout tone="info">
              <strong>Conferência disponível somente no aplicativo GiroMesa</strong>
              <p>
                Abra o aplicativo no computador da unidade para conferir impressoras e pedidos
                pendentes.
              </p>
            </Callout>
          )}
          {edge.status === "loading" && <p role="status">Conferindo este computador…</p>}
          {edge.status === "error" && (
            <Callout tone="warning">
              <strong>O computador não respondeu</strong>
              <p>{edge.message}</p>
            </Callout>
          )}
          {edge.status === "ready" && (
            <div className="production-edge__grid">
              <Card>
                <strong>Impressoras efetivas</strong>
                {edge.printers.length === 0 ? (
                  <p>Nenhuma impressora foi recebida por este computador.</p>
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
      )}

      <ProductionPrinterForm
        busy={busyAction?.startsWith("printer:") === true}
        draft={printerDraft}
        hubs={cloud.status === "ready" ? cloud.hubs : []}
        onChange={changePrinterDraft}
        onClose={closePrinterForm}
        onProbe={() => void probePrinterConnection()}
        onSubmit={savePrinter}
        printers={cloud.status === "ready" ? cloud.printers : []}
        probeMessage={printerProbe.message}
        probeState={printerProbe.state}
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
                Confira a impressora. O envio começou, mas o sistema não conseguiu confirmar se o
                papel saiu.
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
