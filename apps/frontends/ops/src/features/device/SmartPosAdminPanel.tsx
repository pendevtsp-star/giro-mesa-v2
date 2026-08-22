import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@giromesa/ui";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "../../rules";
import {
  type SmartPosDevice,
  type SmartPosHealth,
  type SmartPosHomologationChecklist,
  type SmartPosHomologationRun,
  type SmartPosPairing,
  type SmartPosReconciliation,
  type SmartPosReconciliationStatus,
  smartPosAdmin,
} from "./smartpos-admin";
import "./smartpos-admin.css";

type Resource<T> =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const incidentLabels: Record<SmartPosHealth["incidents"][number]["kind"], string> = {
  unknown_attempt: "Resultado desconhecido",
  stale_processing: "Processamento antigo",
  offline_device: "Terminal offline",
  reconciliation_divergence: "Divergência de conciliação",
};

const reconciliationLabels: Record<SmartPosReconciliationStatus, string> = {
  pending: "Pendente",
  matched: "Conciliado",
  divergent: "Divergente",
  settled: "Liquidado",
  reversed: "Estornado",
};

const checklistLabels: Record<keyof SmartPosHomologationChecklist, string> = {
  debitApproved: "Débito aprovado",
  creditApproved: "Crédito aprovado",
  installmentsApproved: "Parcelamento aprovado",
  pixApproved: "Pix aprovado",
  declinedHandled: "Recusa tratada",
  canceledHandled: "Cancelamento tratado",
  networkRecoveryHandled: "Recuperação de rede",
  reversalApproved: "Estorno aprovado",
  receiptValidated: "Comprovante validado",
};

const emptyChecklist: SmartPosHomologationChecklist = {
  debitApproved: false,
  creditApproved: false,
  installmentsApproved: false,
  pixApproved: false,
  declinedHandled: false,
  canceledHandled: false,
  networkRecoveryHandled: false,
  reversalApproved: false,
  receiptValidated: false,
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function shortDate(value: string | null) {
  if (!value) return "Nunca informado";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function providerLabel(provider: SmartPosDevice["capabilities"]["provider"]) {
  return provider?.toUpperCase() ?? "Sem provedor";
}

function statusTone(status: string) {
  if (["homologated", "approved", "matched", "settled"].includes(status)) return "success" as const;
  if (["suspended", "revoked", "divergent"].includes(status)) return "danger" as const;
  return "warning" as const;
}

function ResourceError({ message: error, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Callout tone="danger">
      <strong>Não foi possível carregar</strong>
      <p>{error}</p>
      <Button onClick={onRetry} size="sm" variant="secondary">
        Tentar novamente
      </Button>
    </Callout>
  );
}

function PairingCard({ organizationId, unitId }: { organizationId: string; unitId: string }) {
  const [label, setLabel] = useState("");
  const [pairing, setPairing] = useState<SmartPosPairing | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  useEffect(() => {
    if (!pairing) {
      setQrDataUrl("");
      return;
    }
    let active = true;
    void QRCode.toDataURL(pairing.qrPayload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#10231b", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setError("Não foi possível desenhar o QR Code temporário.");
      });
    return () => {
      active = false;
    };
  }, [pairing]);

  const secondsLeft = pairing
    ? Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - now) / 1_000))
    : 0;
  const expired = Boolean(pairing && secondsLeft === 0);

  async function createPairing() {
    if (!label.trim()) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      setPairing(
        await smartPosAdmin.createPairing(organizationId, unitId, {
          label: label.trim(),
          expiresInSeconds: 300,
        }),
      );
      setNow(Date.now());
    } catch (failure) {
      setError(message(failure, "Não foi possível gerar o pareamento."));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!pairing || expired) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setFeedback("Código copiado. Ele expira e deve ser usado somente no terminal identificado.");
    } catch {
      setError("O navegador não permitiu copiar. Digite o código diretamente no APK.");
    }
  }

  return (
    <Card className="smartpos-admin-card smartpos-pairing">
      <header className="smartpos-card-heading">
        <div>
          <p className="eyebrow">Pareamento</p>
          <h2>Adicionar SmartPOS</h2>
          <p>O código é temporário e não concede autoridade de aprovação ao navegador.</p>
        </div>
        <Badge tone={expired ? "danger" : pairing ? "warning" : "neutral"}>
          {expired ? "Expirado" : pairing ? `${secondsLeft}s` : "Não gerado"}
        </Badge>
      </header>

      {!pairing || expired ? (
        <form
          className="smartpos-pairing-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createPairing();
          }}
        >
          <Label htmlFor="smartpos-pairing-label">
            Nome operacional do terminal
            <Input
              autoComplete="off"
              id="smartpos-pairing-label"
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Ex.: POS Balcão 01"
              value={label}
            />
          </Label>
          <Button disabled={busy || !label.trim()} type="submit">
            {busy ? "Gerando…" : expired ? "Gerar novo código" : "Gerar pareamento"}
          </Button>
        </form>
      ) : (
        <div className="smartpos-pairing-result" aria-live="polite">
          {qrDataUrl ? (
            <img
              alt={`QR Code temporário para ${label}`}
              height="320"
              src={qrDataUrl}
              width="320"
            />
          ) : (
            <div className="smartpos-qr-placeholder" role="status">
              Preparando QR Code…
            </div>
          )}
          <div className="smartpos-pairing-code">
            <small>Código temporário</small>
            <strong>{pairing.code}</strong>
            <span>Expira em {secondsLeft} segundo(s).</span>
            <Button disabled={expired} onClick={() => void copyCode()} variant="secondary">
              Copiar código
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="smartpos-admin-error" role="alert">
          {error}
        </p>
      )}
      {feedback && (
        <p className="smartpos-admin-feedback" role="status">
          {feedback}
        </p>
      )}
    </Card>
  );
}

function HealthPanel({ health }: { health: SmartPosHealth }) {
  const metrics = [
    ["Desconhecidos", health.summary.unknownAttempts],
    ["Processando há muito tempo", health.summary.staleProcessingAttempts],
    ["Terminais offline", health.summary.offlineDevices],
    ["Divergências", health.summary.reconciliationDivergences],
  ] as const;
  return (
    <Card className="smartpos-admin-card smartpos-health">
      <header className="smartpos-card-heading">
        <div>
          <p className="eyebrow">Saúde operacional</p>
          <h2>Exceções que exigem conferência</h2>
        </div>
        <small>{shortDate(health.generatedAt)}</small>
      </header>
      <div className="smartpos-health-metrics">
        {metrics.map(([label, value]) => (
          <span data-alert={value > 0} key={label}>
            <strong>{value}</strong>
            <small>{label}</small>
          </span>
        ))}
      </div>
      {health.incidents.length === 0 ? (
        <Callout tone="success">
          <strong>Nenhuma exceção aberta</strong>
          <p>A leitura do servidor não encontrou pendências operacionais.</p>
        </Callout>
      ) : (
        <ul className="smartpos-incident-list" aria-label="Incidentes de pagamento">
          {health.incidents.map((incident) => (
            <li key={`${incident.kind}:${incident.entityId}`}>
              <span>
                <strong>{incident.label}</strong>
                <small>
                  {incidentLabels[incident.kind]} · {shortDate(incident.occurredAt)}
                </small>
              </span>
              <Badge tone={incident.severity === "critical" ? "danger" : "warning"}>
                {incident.severity === "critical" ? "Crítico" : "Atenção"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DevicesPanel({ devices }: { devices: SmartPosDevice[] }) {
  return (
    <Card className="smartpos-admin-card smartpos-devices">
      <header className="smartpos-card-heading">
        <div>
          <p className="eyebrow">Terminais</p>
          <h2>Diagnóstico e certificação</h2>
          <p>
            Kill switch e certificação são informados pelo servidor e não podem ser alterados aqui.
          </p>
        </div>
        <Badge tone="neutral">{devices.length} cadastrado(s)</Badge>
      </header>
      {devices.length === 0 ? (
        <p className="smartpos-empty">Nenhum SmartPOS foi pareado nesta unidade.</p>
      ) : (
        <div className="smartpos-device-list">
          {devices.map((device) => {
            const blocked =
              Boolean(device.revokedAt) ||
              device.capabilities.killSwitch.enabled ||
              device.certification?.killSwitchEnabled === true ||
              device.certification?.status === "suspended";
            return (
              <article key={device.installationId}>
                <header>
                  <span>
                    <strong>{device.label}</strong>
                    <small title={device.installationId}>
                      {device.installationId.slice(0, 8)} · visto {shortDate(device.lastSeenAt)}
                    </small>
                  </span>
                  <Badge tone={blocked ? "danger" : statusTone(device.capabilities.status)}>
                    {blocked
                      ? "Bloqueado"
                      : device.capabilities.available
                        ? "Pronto"
                        : "Indisponível"}
                  </Badge>
                </header>
                <dl>
                  <div>
                    <dt>Provedor</dt>
                    <dd>{providerLabel(device.capabilities.provider)}</dd>
                  </div>
                  <div>
                    <dt>Certificação</dt>
                    <dd>{device.certification?.status === "approved" ? "Aprovada" : "Pendente"}</dd>
                  </div>
                  <div>
                    <dt>Diagnóstico</dt>
                    <dd>{device.capabilities.diagnosticsMatch ? "Confere" : "Divergente"}</dd>
                  </div>
                  <div>
                    <dt>Modelo</dt>
                    <dd>
                      {device.reportedDiagnostics
                        ? `${device.reportedDiagnostics.manufacturer} ${device.reportedDiagnostics.model}`
                        : "Não reportado"}
                    </dd>
                  </div>
                  <div>
                    <dt>App / firmware</dt>
                    <dd>
                      {device.reportedDiagnostics
                        ? `${device.reportedDiagnostics.appVersion} / ${device.reportedDiagnostics.firmwareVersion}`
                        : "Não reportado"}
                    </dd>
                  </div>
                  <div>
                    <dt>Métodos</dt>
                    <dd>{device.capabilities.methods.join(", ") || "Nenhum"}</dd>
                  </div>
                  <div>
                    <dt>Kill switch</dt>
                    <dd>
                      {device.capabilities.killSwitch.enabled ||
                      device.certification?.killSwitchEnabled
                        ? "Ativo pelo servidor"
                        : "Desligado"}
                    </dd>
                  </div>
                </dl>
                {(device.capabilities.reason ||
                  device.capabilities.killSwitch.reason ||
                  device.certification?.killSwitchReason) && (
                  <Callout tone="warning">
                    <strong>Motivo informado pelo servidor</strong>
                    <p>
                      {device.capabilities.killSwitch.reason ??
                        device.certification?.killSwitchReason ??
                        device.capabilities.reason}
                    </p>
                  </Callout>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ReconciliationPanel({
  onStatusChange,
  reconciliation,
  status,
}: {
  onStatusChange: (status: SmartPosReconciliationStatus | "all") => void;
  reconciliation: SmartPosReconciliation;
  status: SmartPosReconciliationStatus | "all";
}) {
  return (
    <Card className="smartpos-admin-card smartpos-reconciliation">
      <header className="smartpos-card-heading">
        <div>
          <p className="eyebrow">Conciliação</p>
          <h2>Recebimentos do provedor</h2>
          <p>Consulta financeira; divergências não são confirmadas pelo navegador.</p>
        </div>
        <Label htmlFor="smartpos-reconciliation-filter">
          Status
          <NativeSelect
            id="smartpos-reconciliation-filter"
            onChange={(event) =>
              onStatusChange(event.target.value as SmartPosReconciliationStatus | "all")
            }
            value={status}
          >
            <option value="all">Todos</option>
            {Object.entries(reconciliationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Label>
      </header>
      <div className="smartpos-reconciliation-summary">
        <span>
          <small>Bruto</small>
          <strong>{formatMoney(reconciliation.summary.grossCents)}</strong>
        </span>
        <span>
          <small>Taxas</small>
          <strong>{formatMoney(reconciliation.summary.feeCents)}</strong>
        </span>
        <span>
          <small>Líquido</small>
          <strong>{formatMoney(reconciliation.summary.netCents)}</strong>
        </span>
        <span data-alert={reconciliation.summary.divergences > 0}>
          <small>Divergências</small>
          <strong>{reconciliation.summary.divergences}</strong>
        </span>
      </div>
      {reconciliation.entries.length === 0 ? (
        <p className="smartpos-empty">Nenhum lançamento encontrado para este filtro.</p>
      ) : (
        <div className="smartpos-reconciliation-list">
          {reconciliation.entries.map((entry) => (
            <article key={entry.id}>
              <span>
                <strong>{formatMoney(entry.grossCents)}</strong>
                <small>
                  {entry.provider.toUpperCase()} · taxa {formatMoney(entry.feeCents)} ·{" "}
                  {entry.source}
                </small>
                <small>{shortDate(entry.settledAt ?? entry.expectedSettlementAt)}</small>
              </span>
              <Badge tone={statusTone(entry.status)}>{reconciliationLabels[entry.status]}</Badge>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function HomologationPanel({
  devices,
  onRecorded,
  organizationId,
  runs,
  unitId,
}: {
  devices: SmartPosDevice[];
  onRecorded: (run: SmartPosHomologationRun) => void;
  organizationId: string;
  runs: SmartPosHomologationRun[];
  unitId: string;
}) {
  const certifiable = useMemo(() => devices.filter((device) => device.certification), [devices]);
  const [installationId, setInstallationId] = useState("");
  const [serialHash, setSerialHash] = useState("");
  const [environment, setEnvironment] =
    useState<SmartPosHomologationRun["environment"]>("homologation");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState(emptyChecklist);
  const [executionConfirmed, setExecutionConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = certifiable.find((device) => device.installationId === installationId);
  const validSerialHash = /^[a-fA-F0-9]{64}$/.test(serialHash.trim());

  async function submit() {
    if (!selected?.certification || !serialHash.trim() || !evidenceReference.trim()) return;
    setBusy(true);
    setError("");
    try {
      const run = await smartPosAdmin.recordHomologation(organizationId, unitId, {
        certificationId: selected.certification.id,
        installationId: selected.installationId,
        terminalSerialHash: serialHash.trim(),
        environment,
        checklist,
        evidenceReference: evidenceReference.trim(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onRecorded(run);
      setChecklist(emptyChecklist);
      setEvidenceReference("");
      setNotes("");
      setExecutionConfirmed(false);
    } catch (failure) {
      setError(message(failure, "Não foi possível registrar a homologação."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="smartpos-admin-card smartpos-homologation">
      <header className="smartpos-card-heading">
        <div>
          <p className="eyebrow">Homologação</p>
          <h2>Execução e evidência</h2>
          <p>
            Execute os cenários no terminal e registre o resultado. Roteiro completo não significa
            terminal homologado: certificação e liberação continuam separadas e internas.
          </p>
        </div>
        <Badge tone="neutral">{runs.length} execução(ões)</Badge>
      </header>
      {certifiable.length === 0 ? (
        <Callout tone="warning">
          <strong>Nenhuma certificação atribuída</strong>
          <p>O suporte precisa vincular uma certificação antes de registrar a execução.</p>
        </Callout>
      ) : (
        <form
          className="smartpos-homologation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="smartpos-form-grid">
            <Label htmlFor="smartpos-homologation-device">
              Terminal
              <NativeSelect
                id="smartpos-homologation-device"
                onChange={(event) => setInstallationId(event.target.value)}
                value={installationId}
              >
                <option value="">Selecione</option>
                {certifiable.map((device) => (
                  <option key={device.installationId} value={device.installationId}>
                    {device.label}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label htmlFor="smartpos-homologation-environment">
              Ambiente
              <NativeSelect
                id="smartpos-homologation-environment"
                onChange={(event) =>
                  setEnvironment(event.target.value as SmartPosHomologationRun["environment"])
                }
                value={environment}
              >
                <option value="sandbox">Sandbox</option>
                <option value="homologation">Homologação</option>
                <option value="production">Produção</option>
              </NativeSelect>
            </Label>
            <Label htmlFor="smartpos-terminal-hash">
              Hash do serial do terminal
              <Input
                autoComplete="off"
                id="smartpos-terminal-hash"
                maxLength={64}
                onChange={(event) => setSerialHash(event.target.value)}
                pattern="[A-Fa-f0-9]{64}"
                value={serialHash}
              />
              <small>SHA-256 hexadecimal com 64 caracteres; não informe o serial bruto.</small>
            </Label>
            <Label htmlFor="smartpos-evidence-reference">
              Referência da evidência
              <Input
                id="smartpos-evidence-reference"
                maxLength={500}
                onChange={(event) => setEvidenceReference(event.target.value)}
                placeholder="Ticket, documento ou URL controlada"
                value={evidenceReference}
              />
            </Label>
          </div>
          <fieldset className="smartpos-checklist">
            <legend>Resultado dos cenários executados</legend>
            <div>
              {(Object.keys(checklistLabels) as Array<keyof SmartPosHomologationChecklist>).map(
                (key) => (
                  <Label className="smartpos-check-item" key={key}>
                    <Checkbox
                      checked={checklist[key]}
                      onChange={(event) =>
                        setChecklist((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    {checklistLabels[key]}
                  </Label>
                ),
              )}
            </div>
          </fieldset>
          <Label htmlFor="smartpos-homologation-notes">
            Observações
            <Textarea
              id="smartpos-homologation-notes"
              maxLength={1_000}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              value={notes}
            />
          </Label>
          <Label className="smartpos-execution-confirmation">
            <Checkbox
              checked={executionConfirmed}
              onChange={(event) => setExecutionConfirmed(event.target.checked)}
            />
            Confirmo que todos os cenários foram executados; itens desmarcados falharam.
          </Label>
          {error && (
            <p className="smartpos-admin-error" role="alert">
              {error}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !selected?.certification ||
              !validSerialHash ||
              !evidenceReference.trim() ||
              !executionConfirmed
            }
            type="submit"
          >
            {busy ? "Registrando…" : "Registrar execução"}
          </Button>
        </form>
      )}
      {runs.length > 0 && (
        <ul className="smartpos-run-list" aria-label="Histórico de homologação">
          {runs.slice(0, 8).map((run) => (
            <li key={run.id}>
              <span>
                <strong>
                  {run.environment} · {run.evidenceReference}
                </strong>
                <small>
                  {shortDate(run.createdAt)} · terminal {run.installationId.slice(0, 8)}
                </small>
              </span>
              <Badge tone={run.passed ? "success" : "danger"}>
                {run.passed ? "Roteiro completo" : "Roteiro com falhas"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SmartPosAdminPanel({
  canManage,
  canReconcile,
  organizationId,
  unitId,
}: {
  canManage: boolean;
  canReconcile: boolean;
  organizationId: string;
  unitId: string;
}) {
  const [revision, setRevision] = useState(0);
  const [reconciliationStatus, setReconciliationStatus] = useState<
    SmartPosReconciliationStatus | "all"
  >("all");
  const [devices, setDevices] = useState<Resource<SmartPosDevice[]>>({ status: "idle" });
  const [health, setHealth] = useState<Resource<SmartPosHealth>>({ status: "idle" });
  const [reconciliation, setReconciliation] = useState<Resource<SmartPosReconciliation>>({
    status: "idle",
  });
  const [runs, setRuns] = useState<Resource<SmartPosHomologationRun[]>>({ status: "idle" });

  useEffect(() => {
    if (!canManage) return;
    void revision;
    let active = true;
    setDevices({ status: "loading" });
    setHealth({ status: "loading" });
    setRuns({ status: "loading" });
    void smartPosAdmin.devices(organizationId, unitId).then(
      (data) => active && setDevices({ status: "ready", data }),
      (failure) =>
        active &&
        setDevices({ status: "error", message: message(failure, "Falha nos terminais.") }),
    );
    void smartPosAdmin.health(organizationId, unitId).then(
      (data) => active && setHealth({ status: "ready", data }),
      (failure) =>
        active && setHealth({ status: "error", message: message(failure, "Falha na saúde.") }),
    );
    void smartPosAdmin.homologationRuns(organizationId, unitId).then(
      (data) => active && setRuns({ status: "ready", data }),
      (failure) =>
        active && setRuns({ status: "error", message: message(failure, "Falha na homologação.") }),
    );
    return () => {
      active = false;
    };
  }, [canManage, organizationId, revision, unitId]);

  useEffect(() => {
    if (!canReconcile) return;
    void revision;
    let active = true;
    setReconciliation({ status: "loading" });
    void smartPosAdmin
      .reconciliation(organizationId, unitId, {
        ...(reconciliationStatus === "all" ? {} : { status: reconciliationStatus }),
        limit: 50,
      })
      .then(
        (data) => active && setReconciliation({ status: "ready", data }),
        (failure) =>
          active &&
          setReconciliation({
            status: "error",
            message: message(failure, "Falha na conciliação."),
          }),
      );
    return () => {
      active = false;
    };
  }, [canReconcile, organizationId, reconciliationStatus, revision, unitId]);

  if (!canManage && !canReconcile) {
    return (
      <Callout tone="warning">
        <strong>Acesso gerencial necessário</strong>
        <p>
          Terminais e saúde exigem gerente ou proprietário. A conciliação também aceita o perfil
          financeiro.
        </p>
      </Callout>
    );
  }

  return (
    <section className="smartpos-admin" aria-label="Administração SmartPOS">
      <div className="smartpos-admin-intro">
        <div>
          <p className="eyebrow">Gestão SmartPOS</p>
          <h2>Terminais, saúde e conciliação</h2>
          <p>
            Estado financeiro vem do servidor. O navegador não aprova, recusa ou suspende
            pagamentos.
          </p>
        </div>
        <Button onClick={() => setRevision((value) => value + 1)} size="sm" variant="secondary">
          Atualizar painel
        </Button>
      </div>

      {canManage && <PairingCard organizationId={organizationId} unitId={unitId} />}

      {canManage &&
        (health.status === "ready" ? (
          <HealthPanel health={health.data} />
        ) : health.status === "error" ? (
          <ResourceError
            message={health.message}
            onRetry={() => setRevision((value) => value + 1)}
          />
        ) : (
          <p className="smartpos-loading" role="status">
            Carregando saúde dos pagamentos…
          </p>
        ))}

      {canManage &&
        (devices.status === "ready" ? (
          <DevicesPanel devices={devices.data} />
        ) : devices.status === "error" ? (
          <ResourceError
            message={devices.message}
            onRetry={() => setRevision((value) => value + 1)}
          />
        ) : (
          <p className="smartpos-loading" role="status">
            Carregando terminais…
          </p>
        ))}

      {canReconcile &&
        (reconciliation.status === "ready" ? (
          <ReconciliationPanel
            onStatusChange={setReconciliationStatus}
            reconciliation={reconciliation.data}
            status={reconciliationStatus}
          />
        ) : reconciliation.status === "error" ? (
          <ResourceError
            message={reconciliation.message}
            onRetry={() => setRevision((value) => value + 1)}
          />
        ) : (
          <p className="smartpos-loading" role="status">
            Carregando conciliação…
          </p>
        ))}

      {canManage && devices.status === "ready" && runs.status === "ready" && (
        <HomologationPanel
          devices={devices.data}
          onRecorded={(run) => setRuns({ status: "ready", data: [run, ...runs.data] })}
          organizationId={organizationId}
          runs={runs.data}
          unitId={unitId}
        />
      )}
      {canManage && runs.status === "error" && (
        <ResourceError message={runs.message} onRetry={() => setRevision((value) => value + 1)} />
      )}
    </section>
  );
}
