import { updateTableQrSettingsSchema } from "@giromesa/contracts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Label,
  NativeSelect,
  SearchField,
  Textarea,
} from "@giromesa/ui";
import QRCode from "qrcode";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type CatalogTableQr,
  type TableQrLifecycle,
  type TableQrOutput,
  type TableQrPrintBatch,
  type TableQrPrintFormat,
  type TableQrSettings,
  type TableQrTestResult,
  type TableQrVisualTemplate,
} from "../../api";
import type { ManagementScope } from "../../management.shared";
import { logoFileError, mediaPayload } from "../settings/settings";
import {
  canReprintTableQrBatch,
  selectedTableQrs,
  sortTableQrs,
  tableQrActorLabel,
  tableQrContrast,
  tableQrFilename,
  tableQrTestMessage,
} from "./table-qrs";
import {
  buildTableQrPrintHtml,
  createTableQrPdf,
  downloadTableQrBlob,
  type RenderedTableQr,
  TABLE_QR_FORMATS,
  TABLE_QR_TEMPLATES,
} from "./table-qrs.print";
import "./table-qrs.css";

type Feedback = { message: string; tone: "success" | "danger" | "warning" };

function dateTimeLabel(value: string | null) {
  if (!value) return "Ainda não registrado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function settingsFingerprint(settings: TableQrSettings | null) {
  if (!settings) return "";
  const { revision: _revision, updatedAt: _updatedAt, ...fields } = settings;
  return JSON.stringify(fields);
}

function batchSettings(batch: TableQrPrintBatch): TableQrSettings {
  return {
    ...batch.settings,
    primaryColor: tableQrContrast(batch.settings.primaryColor).effectiveColor,
    revision: batch.settingsRevision,
    updatedAt: null,
    wifiNotice: batch.includeWifi ? batch.settings.wifiNotice : null,
  };
}

async function renderQrRows(
  rows: ReadonlyArray<Pick<CatalogTableQr, "tableId" | "label" | "tokenVersion" | "url">>,
  type: "svg" | "png",
): Promise<RenderedTableQr[]> {
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      dataUrl:
        type === "svg"
          ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
              await QRCode.toString(row.url, {
                errorCorrectionLevel: "H",
                margin: 4,
                type: "svg",
                width: 768,
              }),
            )}`
          : await QRCode.toDataURL(row.url, {
              errorCorrectionLevel: "H",
              margin: 4,
              type: "image/png",
              width: 1_024,
            }),
    })),
  );
}

function batchCurrentRows(batch: TableQrPrintBatch) {
  if (!canReprintTableQrBatch(batch)) {
    throw new Error("QR rotacionado — gere um novo lote com a versão atual das mesas.");
  }
  return batch.tables.map((table) => ({
    tableId: table.tableId,
    label: table.label,
    tokenVersion: table.tokenVersion,
    url: table.url as string,
  }));
}

function resultTone(result: TableQrTestResult) {
  return result.valid ? "success" : "danger";
}

export function TableQrsPage({ scope }: { scope: ManagementScope }) {
  const [lifecycle, setLifecycle] = useState<TableQrLifecycle | null>(null);
  const [draft, setDraft] = useState<TableQrSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<TableQrPrintFormat>("a4_4");
  const [includeWifi, setIncludeWifi] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  const [testResults, setTestResults] = useState<Record<string, TableQrTestResult>>({});
  const [lastGeneratedBatch, setLastGeneratedBatch] = useState<TableQrPrintBatch | null>(null);
  const attempts = useRef(new Map<string, { fingerprint: string; key: string }>());

  const idempotencyKey = useCallback((operation: string, fingerprint: string) => {
    const current = attempts.current.get(operation);
    if (current?.fingerprint === fingerprint) return current.key;
    const key = crypto.randomUUID();
    attempts.current.set(operation, { fingerprint, key });
    return key;
  }, []);

  const completeAttempt = useCallback((operation: string) => {
    attempts.current.delete(operation);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const value = await api.pilot.tableQrLifecycle(scope.organizationId, scope.unitId);
      setLifecycle(value);
      setDraft(value.settings);
      setSelectedIds((current) => {
        const activeIds = new Set(value.tables.map((table) => table.tableId));
        const retained = new Set([...current].filter((tableId) => activeIds.has(tableId)));
        return retained.size > 0 ? retained : activeIds;
      });
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Não foi possível carregar os QR das mesas.",
      );
    } finally {
      setLoading(false);
    }
  }, [scope.organizationId, scope.unitId]);

  useEffect(() => {
    void scope.refreshToken;
    void load();
  }, [load, scope.refreshToken]);

  const tables = useMemo(() => sortTableQrs(lifecycle?.tables ?? []), [lifecycle?.tables]);
  const filteredTables = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return normalized
      ? tables.filter((table) => table.label.toLocaleLowerCase("pt-BR").includes(normalized))
      : tables;
  }, [query, tables]);
  const selectedRows = useMemo(() => selectedTableQrs(tables, selectedIds), [selectedIds, tables]);
  const previewRow = selectedRows[0] ?? tables[0] ?? null;
  const dirty = settingsFingerprint(draft) !== settingsFingerprint(lifecycle?.settings ?? null);
  const contrast = tableQrContrast(draft?.primaryColor ?? "#047857");
  const allVisibleSelected =
    filteredTables.length > 0 && filteredTables.every((table) => selectedIds.has(table.tableId));
  const someVisibleSelected = filteredTables.some((table) => selectedIds.has(table.tableId));
  const totalScans = tables.reduce((total, table) => total + table.scanCount, 0);

  useEffect(() => {
    let active = true;
    setPreviewDataUrl("");
    if (!previewRow) return () => undefined;
    void QRCode.toString(previewRow.url, {
      errorCorrectionLevel: "H",
      margin: 4,
      type: "svg",
      width: 768,
    }).then((svg) => {
      if (active) setPreviewDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => {
      active = false;
    };
  }, [previewRow]);

  useEffect(() => {
    if (!dirty) return undefined;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    globalThis.addEventListener("beforeunload", preventUnload);
    return () => globalThis.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);

  function updateSetting<K extends keyof TableQrSettings>(field: K, value: TableQrSettings[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setFeedback(null);
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    const validation = logoFileError(file);
    if (validation) {
      setFeedback({ message: validation, tone: "danger" });
      return;
    }
    setBusy("logo");
    try {
      const uploaded = await api.pilot.uploadCatalogMedia(
        scope.organizationId,
        scope.unitId,
        await mediaPayload(file),
      );
      updateSetting("logoUrl", uploaded.url);
      setFeedback({
        message: "Logo enviada. Salve a personalização para aplicá-la às placas.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Não foi possível enviar a logo.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  function toggleTable(tableId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  }

  function toggleVisibleTables() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const table of filteredTables) {
        if (allVisibleSelected) next.delete(table.tableId);
        else next.add(table.tableId);
      }
      return next;
    });
  }

  async function saveSettings() {
    if (!draft || busy) return;
    const parsed = updateTableQrSettingsSchema.safeParse({
      expectedRevision: draft.revision,
      displayName: draft.displayName,
      headline: draft.headline,
      instructions: draft.instructions,
      logoUrl: draft.logoUrl,
      primaryColor: draft.primaryColor,
      wifiNotice: draft.wifiNotice,
      serviceChargeNotice: draft.serviceChargeNotice,
      template: draft.template,
      presenceProtection: draft.presenceProtection,
    });
    if (!parsed.success) {
      setFeedback({
        message: parsed.error.issues[0]?.message ?? "Revise os campos de personalização.",
        tone: "danger",
      });
      return;
    }
    const fingerprint = JSON.stringify(parsed.data);
    setBusy("settings");
    try {
      const saved = await api.pilot.updateTableQrSettings(
        scope.organizationId,
        scope.unitId,
        parsed.data,
        idempotencyKey("settings", fingerprint),
      );
      completeAttempt("settings");
      setLifecycle((current) => (current ? { ...current, settings: saved } : current));
      setDraft(saved);
      await load();
      setFeedback({ message: "Personalização dos QR salva nesta unidade.", tone: "success" });
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error ? error.message : "Não foi possível salvar a personalização.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  function upsertBatch(batch: TableQrPrintBatch) {
    setLifecycle((current) =>
      current
        ? {
            ...current,
            batches: [batch, ...current.batches.filter((candidate) => candidate.id !== batch.id)],
          }
        : current,
    );
    setLastGeneratedBatch(batch);
  }

  async function generateBatch(
    output: Extract<TableQrOutput, "print" | "pdf">,
    tableIds = selectedRows.map((table) => table.tableId),
    selectedFormat = format,
    selectedTemplate = draft?.template,
    selectedIncludeWifi = includeWifi,
  ) {
    if (!draft || busy) return;
    if (dirty) {
      setFeedback({ message: "Salve a personalização antes de gerar um lote.", tone: "warning" });
      return;
    }
    if (tableIds.length === 0) {
      setFeedback({ message: "Selecione ao menos uma mesa.", tone: "danger" });
      return;
    }
    const popup = output === "print" ? window.open("", "_blank", "width=980,height=900") : null;
    if (output === "print" && !popup) {
      setFeedback({ message: "Permita pop-ups para abrir a impressão.", tone: "danger" });
      return;
    }
    const body = {
      format: selectedFormat,
      includeWifi: selectedIncludeWifi,
      output,
      template: selectedTemplate,
      tableIds,
    };
    const operation = `batch:${output}`;
    const fingerprint = JSON.stringify(body);
    setBusy(operation);
    try {
      const batch = await api.pilot.createTableQrPrintBatch(
        scope.organizationId,
        scope.unitId,
        body,
        idempotencyKey(operation, fingerprint),
      );
      upsertBatch(batch);
      const currentRows = batchCurrentRows(batch);
      if (output === "print") {
        const rendered = await renderQrRows(currentRows, "svg");
        popup?.document.write(
          buildTableQrPrintHtml(rendered, batchSettings(batch), selectedFormat),
        );
        popup?.document.close();
        popup?.focus();
        setFeedback({
          message: "Lote gerado. Após concluir a impressão, marque-o explicitamente como impresso.",
          tone: "success",
        });
      } else {
        const rendered = await renderQrRows(currentRows, "png");
        const file = await createTableQrPdf(rendered, batchSettings(batch), selectedFormat);
        downloadTableQrBlob(file.blob, `qr-mesas-${batch.id}.pdf`);
        setFeedback({
          message:
            file.warnings[0] ??
            "PDF gerado. O download não marca o lote como fisicamente impresso.",
          tone: file.warnings.length > 0 ? "warning" : "success",
        });
      }
      completeAttempt(operation);
    } catch (error) {
      popup?.close();
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "O lote foi solicitado, mas o arquivo não pôde ser gerado.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  async function downloadIndividual(output: Extract<TableQrOutput, "svg" | "png">) {
    if (!previewRow || !draft || busy) return;
    if (dirty) {
      setFeedback({ message: "Salve a personalização antes de gerar o arquivo.", tone: "warning" });
      return;
    }
    const operation = `individual:${output}:${previewRow.tableId}`;
    const body = {
      format,
      includeWifi: false,
      output,
      template: draft.template,
      tableIds: [previewRow.tableId],
    };
    setBusy(operation);
    try {
      const batch = await api.pilot.createTableQrPrintBatch(
        scope.organizationId,
        scope.unitId,
        body,
        idempotencyKey(operation, JSON.stringify(body)),
      );
      const [row] = batchCurrentRows(batch);
      if (!row) throw new Error("A mesa não foi incluída no lote gerado.");
      if (output === "svg") {
        const svg = await QRCode.toString(row.url, {
          errorCorrectionLevel: "H",
          margin: 4,
          type: "svg",
          width: 1_024,
        });
        downloadTableQrBlob(
          new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
          tableQrFilename(row.label, "svg"),
        );
      } else {
        const dataUrl = await QRCode.toDataURL(row.url, {
          errorCorrectionLevel: "H",
          margin: 4,
          type: "image/png",
          width: 1_024,
        });
        downloadTableQrBlob(await (await fetch(dataUrl)).blob(), tableQrFilename(row.label, "png"));
      }
      completeAttempt(operation);
      upsertBatch(batch);
      setFeedback({
        message: `${output.toUpperCase()} individual gerado para ${row.label}.`,
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error ? error.message : "Não foi possível gerar o arquivo individual.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  async function testQr(row: CatalogTableQr) {
    if (busy) return;
    setBusy(`test:${row.tableId}`);
    try {
      const result = await api.pilot.testTableQr(scope.organizationId, scope.unitId, row.url);
      setTestResults((current) => ({ ...current, [row.tableId]: result }));
      setFeedback({ message: tableQrTestMessage(result), tone: resultTone(result) });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Não foi possível testar este QR.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  async function rotateQr(row: CatalogTableQr) {
    if (busy) return;
    if (!window.confirm(`Rotacionar o QR de ${row.label}? A placa anterior deixará de funcionar.`))
      return;
    const operation = `rotate:${row.tableId}`;
    setBusy(operation);
    try {
      const rotated = await api.pilot.rotateCatalogTableQr(
        scope.organizationId,
        scope.unitId,
        row.tableId,
        idempotencyKey(operation, `${row.tableId}:${row.tokenVersion}`),
      );
      completeAttempt(operation);
      setLifecycle((current) =>
        current
          ? {
              ...current,
              tables: current.tables.map((table) =>
                table.tableId === row.tableId ? { ...table, ...rotated } : table,
              ),
            }
          : current,
      );
      setTestResults((current) => {
        const next = { ...current };
        delete next[row.tableId];
        return next;
      });
      setFeedback({
        message: `QR de ${row.label} rotacionado. Gere e imprima imediatamente uma nova placa.`,
        tone: "warning",
      });
      await load();
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Não foi possível rotacionar o QR.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  async function markPrinted(batch: TableQrPrintBatch) {
    if (busy || batch.status === "printed") return;
    const operation = `printed:${batch.id}`;
    setBusy(operation);
    try {
      const saved = await api.pilot.markTableQrPrintBatchPrinted(
        scope.organizationId,
        scope.unitId,
        batch.id,
        idempotencyKey(operation, batch.id),
      );
      completeAttempt(operation);
      upsertBatch(saved);
      setFeedback({ message: "Lote marcado como impresso com autor e data.", tone: "success" });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Não foi possível marcar o lote.",
        tone: "danger",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading && !lifecycle) {
    return (
      <Card className="table-qrs-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando mesas e versões de QR…</strong>
        <p>Aguarde a fonte persistida desta unidade.</p>
      </Card>
    );
  }

  if (loadError && !lifecycle) {
    return (
      <Card className="table-qrs-state" role="alert">
        <strong>Não foi possível carregar QR das mesas</strong>
        <p>{loadError}</p>
        <Button onClick={() => void load()} size="sm" variant="secondary">
          Tentar novamente
        </Button>
      </Card>
    );
  }

  if (!lifecycle || !draft) return null;

  return (
    <div className="table-qrs-page" aria-busy={Boolean(busy) || loading}>
      <div className="gm-observability-row table-qrs-status">
        <div>
          <Badge tone="success">{tables.length} mesas ativas</Badge>
          <span>{totalScans} leituras confirmadas</span>
          <span>Configuração v{draft.revision}</span>
          <span>Atualizada {dateTimeLabel(draft.updatedAt)}</span>
        </div>
        <Button
          disabled={loading || Boolean(busy)}
          onClick={() => void load()}
          size="sm"
          variant="ghost"
        >
          <Icon name="refresh" size={14} />
          {loading ? "Atualizando…" : "Atualizar"}
        </Button>
      </div>

      {feedback && (
        <div
          className={`table-qrs-feedback table-qrs-feedback--${feedback.tone}`}
          role={feedback.tone === "danger" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      )}
      {loadError && lifecycle && (
        <div className="table-qrs-feedback table-qrs-feedback--warning" role="status">
          Exibindo a última leitura confirmada. {loadError}
        </div>
      )}

      <div className="table-qrs-workspace">
        <section aria-labelledby="table-qrs-tables-title">
          <Card className="table-qrs-card table-qrs-card--tables">
            <header>
              <div>
                <h2 id="table-qrs-tables-title">Mesas</h2>
                <p>Selecione registros reais desta unidade.</p>
              </div>
              <Badge tone={selectedRows.length > 0 ? "info" : "warning"}>
                {selectedRows.length} selecionadas
              </Badge>
            </header>
            <SearchField
              aria-label="Buscar mesa"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome da mesa"
              value={query}
            />
            <Label className="table-qrs-select-all">
              <input
                checked={allVisibleSelected}
                disabled={filteredTables.length === 0}
                onChange={toggleVisibleTables}
                ref={(element) => {
                  if (element) element.indeterminate = someVisibleSelected && !allVisibleSelected;
                }}
                type="checkbox"
              />
              <span>Selecionar mesas visíveis</span>
              <small>{filteredTables.length}</small>
            </Label>
            <div className="table-qrs-list">
              {filteredTables.map((row) => {
                const result = testResults[row.tableId];
                return (
                  <article className="table-qrs-row" key={row.tableId}>
                    <Label>
                      <input
                        checked={selectedIds.has(row.tableId)}
                        onChange={() => toggleTable(row.tableId)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{row.label}</strong>
                        <small>
                          QR v{row.tokenVersion} · {row.scanCount} leitura(s)
                          {row.lastScannedAt ? ` · última ${dateTimeLabel(row.lastScannedAt)}` : ""}
                        </small>
                      </span>
                    </Label>
                    <div className="table-qrs-row__actions">
                      {result && (
                        <Badge tone={resultTone(result)}>
                          {result.valid ? "Válido" : "Inválido"}
                        </Badge>
                      )}
                      <Button
                        disabled={Boolean(busy)}
                        onClick={() => void testQr(row)}
                        size="sm"
                        variant="ghost"
                      >
                        {busy === `test:${row.tableId}` ? "Testando…" : "Testar"}
                      </Button>
                      <Button
                        disabled={Boolean(busy)}
                        onClick={() => void rotateQr(row)}
                        size="sm"
                        variant="ghost"
                      >
                        {busy === `rotate:${row.tableId}` ? "Rotacionando…" : "Rotacionar"}
                      </Button>
                    </div>
                    {result && (
                      <p className={`table-qrs-test table-qrs-test--${resultTone(result)}`}>
                        {tableQrTestMessage(result)}
                      </p>
                    )}
                  </article>
                );
              })}
              {tables.length > 0 && filteredTables.length === 0 && (
                <p className="table-qrs-empty">Nenhuma mesa corresponde à busca.</p>
              )}
              {tables.length === 0 && (
                <EmptyState
                  icon="◇"
                  title="Nenhuma mesa ativa"
                  description="Cadastre mesas no Salão antes de gerar placas de QR."
                />
              )}
            </div>
          </Card>
        </section>

        <section aria-labelledby="table-qrs-preview-title">
          <Card className="table-qrs-card table-qrs-preview-card">
            <header>
              <div>
                <h2 id="table-qrs-preview-title">Prévia</h2>
                <p>
                  {previewRow
                    ? `${previewRow.label} · versão ${previewRow.tokenVersion}`
                    : "Selecione uma mesa"}
                </p>
              </div>
              <Badge tone={dirty ? "warning" : "success"}>
                {dirty ? "Não salvo" : "Persistido"}
              </Badge>
            </header>
            <div
              className={`table-qrs-plate table-qrs-plate--${draft.template}`}
              style={{ borderColor: contrast.effectiveColor }}
            >
              {draft.logoUrl && (
                <img alt="" className="table-qrs-plate__logo" src={draft.logoUrl} />
              )}
              <strong style={{ color: contrast.effectiveColor }}>{draft.displayName}</strong>
              <h3>{previewRow?.label ?? "Mesa"}</h3>
              <p className="table-qrs-plate__headline">{draft.headline}</p>
              {previewDataUrl ? (
                <img
                  alt={previewRow ? `QR Code da ${previewRow.label}` : "QR Code"}
                  className="table-qrs-plate__qr"
                  src={previewDataUrl}
                />
              ) : (
                <span className="table-qrs-plate__placeholder" role="status">
                  {previewRow ? "Gerando prévia…" : "Sem mesa disponível"}
                </span>
              )}
              {draft.template !== "minimal" && <p>{draft.instructions}</p>}
              {includeWifi && draft.template === "classic" && draft.wifiNotice && (
                <small>{draft.wifiNotice}</small>
              )}
              {draft.template === "classic" && draft.serviceChargeNotice && (
                <small>{draft.serviceChargeNotice}</small>
              )}
            </div>
            <div className="table-qrs-preview-actions">
              <Button
                disabled={!previewRow || Boolean(busy)}
                onClick={() => void downloadIndividual("svg")}
                size="sm"
                variant="secondary"
              >
                <Icon name="download" size={14} /> SVG individual
              </Button>
              <Button
                disabled={!previewRow || Boolean(busy)}
                onClick={() => void downloadIndividual("png")}
                size="sm"
                variant="secondary"
              >
                <Icon name="download" size={14} /> PNG individual
              </Button>
            </div>
          </Card>
        </section>
      </div>

      <section aria-labelledby="table-qrs-customize-title">
        <Card className="table-qrs-card">
          <header>
            <div>
              <h2 id="table-qrs-customize-title">Personalização das placas</h2>
              <p>Configuração independente, persistida por unidade.</p>
            </div>
            <Button
              disabled={!dirty || Boolean(busy)}
              onClick={() => void saveSettings()}
              variant="primary"
            >
              {busy === "settings" ? "Salvando…" : "Salvar personalização"}
            </Button>
          </header>
          <div className="gm-form-grid table-qrs-form-grid">
            <Label className="gm-form-field">
              Nome exibido
              <Input
                maxLength={120}
                minLength={2}
                onChange={(event) => updateSetting("displayName", event.target.value)}
                required
                value={draft.displayName}
              />
            </Label>
            <Label className="gm-form-field">
              Chamada principal
              <Input
                maxLength={160}
                minLength={2}
                onChange={(event) => updateSetting("headline", event.target.value)}
                required
                value={draft.headline}
              />
            </Label>
            <Label className="gm-form-field table-qrs-field--wide">
              Instruções
              <Textarea
                maxLength={500}
                minLength={2}
                onChange={(event) => updateSetting("instructions", event.target.value)}
                required
                rows={3}
                value={draft.instructions}
              />
            </Label>
            <Label className="gm-form-field">
              URL da logo
              <Input
                onChange={(event) => updateSetting("logoUrl", event.target.value || null)}
                placeholder="https://…"
                type="url"
                value={draft.logoUrl ?? ""}
              />
            </Label>
            <Label className="gm-form-field">
              Enviar logo
              <Input
                accept="image/jpeg,image/png,image/webp"
                disabled={Boolean(busy)}
                onChange={(event) => void uploadLogo(event)}
                type="file"
              />
              <small>JPG, PNG ou WEBP, até 2 MB.</small>
            </Label>
            <div className="gm-form-field table-qrs-logo-actions">
              <span>Logo das configurações gerais</span>
              <Button
                disabled={
                  !lifecycle.generalBranding.logoUrl ||
                  lifecycle.generalBranding.logoUrl === draft.logoUrl ||
                  Boolean(busy)
                }
                onClick={() => updateSetting("logoUrl", lifecycle.generalBranding.logoUrl)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Usar logo geral
              </Button>
              {!lifecycle.generalBranding.logoUrl && (
                <small>Nenhuma logo foi enviada nas configurações gerais.</small>
              )}
            </div>
            <Label className="gm-form-field">
              Modelo visual
              <NativeSelect
                onChange={(event) =>
                  updateSetting("template", event.target.value as TableQrVisualTemplate)
                }
                value={draft.template}
              >
                {TABLE_QR_TEMPLATES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} · {option.description}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="gm-form-field">
              Proteção contra foto remota
              <NativeSelect
                onChange={(event) =>
                  updateSetting(
                    "presenceProtection",
                    event.target.value as TableQrSettings["presenceProtection"],
                  )
                }
                value={draft.presenceProtection}
              >
                <option value="session_only">Sessão segura padrão</option>
                <option value="daily_code">Exigir código diário de presença</option>
              </NativeSelect>
              <small>
                O código diário não fica gravado no QR e reduz o uso de fotos fora do local.
              </small>
            </Label>
            {draft.presenceProtection === "daily_code" && (
              <div className="gm-form-field table-qrs-presence-code" role="status">
                <span>Código de presença de hoje</span>
                <strong>{lifecycle.presence.code ?? "Salve para gerar"}</strong>
                <small>Informe este código somente a clientes presentes na unidade.</small>
              </div>
            )}
            <Label className="gm-form-field">
              Cor principal
              <span className="table-qrs-color-field">
                <input
                  aria-label="Escolher cor principal"
                  onChange={(event) => updateSetting("primaryColor", event.target.value)}
                  type="color"
                  value={draft.primaryColor}
                />
                <Input
                  aria-label="Cor principal em hexadecimal"
                  maxLength={7}
                  onChange={(event) => updateSetting("primaryColor", event.target.value)}
                  pattern="^#[0-9A-Fa-f]{6}$"
                  value={draft.primaryColor}
                />
              </span>
              <small
                className={
                  contrast.passes ? "table-qrs-contrast--pass" : "table-qrs-contrast--fail"
                }
              >
                Contraste da cor sobre branco: {contrast.ratio.toFixed(1)}:1 ·{" "}
                {contrast.passes ? "WCAG AA" : "reprovado; a saída usará cinza escuro"}
              </small>
            </Label>
            <Label className="gm-form-field">
              Aviso de Wi-Fi
              <Input
                maxLength={200}
                onChange={(event) => updateSetting("wifiNotice", event.target.value || null)}
                placeholder="Ex.: Rede disponível no caixa"
                value={draft.wifiNotice ?? ""}
              />
            </Label>
            <Label className="gm-form-field table-qrs-field--wide">
              Aviso de taxa de serviço
              <Input
                maxLength={200}
                onChange={(event) =>
                  updateSetting("serviceChargeNotice", event.target.value || null)
                }
                placeholder="Ex.: Serviço opcional de 10%"
                value={draft.serviceChargeNotice ?? ""}
              />
            </Label>
          </div>
        </Card>
      </section>

      <section aria-labelledby="table-qrs-output-title">
        <Card className="table-qrs-card">
          <header>
            <div>
              <h2 id="table-qrs-output-title">Gerar lote</h2>
              <p>Escolha o formato físico; cada geração ficará no histórico.</p>
            </div>
            <Badge tone={selectedRows.length ? "info" : "warning"}>
              {selectedRows.length} placas
            </Badge>
          </header>
          <fieldset className="table-qrs-format-grid">
            <legend className="gm-sr-only">Formato de impressão</legend>
            {TABLE_QR_FORMATS.map((option) => (
              <label
                className="table-qrs-format"
                data-selected={format === option.value}
                key={option.value}
              >
                <input
                  checked={format === option.value}
                  name="table-qr-format"
                  onChange={() => setFormat(option.value)}
                  type="radio"
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <Label className="table-qrs-wifi-option">
            <input
              checked={includeWifi}
              disabled={!draft.wifiNotice}
              onChange={(event) => setIncludeWifi(event.target.checked)}
              type="checkbox"
            />
            <span>
              Incluir aviso de Wi-Fi neste lote
              <small>
                {draft.wifiNotice
                  ? "Desligado por padrão; não inclua senhas na placa."
                  : "Cadastre um aviso de Wi-Fi para habilitar."}
              </small>
            </span>
          </Label>
          <footer className="table-qrs-output-actions">
            <span>
              {dirty
                ? "Salve a personalização para liberar a geração."
                : "A marcação de impresso é sempre manual."}
            </span>
            <div>
              <Button
                disabled={dirty || selectedRows.length === 0 || Boolean(busy)}
                onClick={() => void generateBatch("pdf")}
                variant="secondary"
              >
                <Icon name="download" size={15} />{" "}
                {busy === "batch:pdf" ? "Gerando PDF…" : "Baixar PDF do lote"}
              </Button>
              <Button
                disabled={dirty || selectedRows.length === 0 || Boolean(busy)}
                onClick={() => void generateBatch("print")}
                variant="primary"
              >
                <Icon name="download" size={15} />{" "}
                {busy === "batch:print" ? "Preparando…" : "Imprimir lote"}
              </Button>
            </div>
          </footer>
          {lastGeneratedBatch?.status === "generated" && (
            <div className="table-qrs-print-confirmation" role="status">
              <div>
                <strong>Lote {lastGeneratedBatch.id.slice(0, 8)} aguardando confirmação</strong>
                <span>
                  Gerado em {dateTimeLabel(lastGeneratedBatch.generatedAt)}; confirme apenas após a
                  impressão física.
                </span>
              </div>
              <Button
                disabled={Boolean(busy)}
                onClick={() => void markPrinted(lastGeneratedBatch)}
                size="sm"
                variant="secondary"
              >
                {busy === `printed:${lastGeneratedBatch.id}`
                  ? "Confirmando…"
                  : "Marcar como impresso"}
              </Button>
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="table-qrs-history-title">
        <Card className="table-qrs-card">
          <header>
            <div>
              <h2 id="table-qrs-history-title">Histórico e versões</h2>
              <p>Gerações, impressões e rotações auditáveis.</p>
            </div>
          </header>
          <div className="table-qrs-history-grid">
            <div>
              <h3>Lotes</h3>
              <div className="table-qrs-history-list">
                {lifecycle.batches.map((batch) => {
                  const reprintable = canReprintTableQrBatch(batch);
                  return (
                    <article key={batch.id}>
                      <div>
                        <strong>
                          {TABLE_QR_FORMATS.find((item) => item.value === batch.format)?.label ??
                            batch.format}
                        </strong>
                        <Badge tone={batch.status === "printed" ? "success" : "warning"}>
                          {batch.status === "printed" ? "Impresso" : "Gerado"}
                        </Badge>
                      </div>
                      <p>
                        {batch.tables.length} mesas · {batch.output.toUpperCase()} · modelo{" "}
                        {batch.template}
                      </p>
                      <small>
                        Gerado por{" "}
                        {tableQrActorLabel(batch.createdByIdentityId, batch.createdByLabel)} em{" "}
                        {dateTimeLabel(batch.generatedAt)}
                      </small>
                      {batch.printedAt && (
                        <small>
                          Impresso por{" "}
                          {tableQrActorLabel(batch.printedByIdentityId, batch.printedByLabel)} em{" "}
                          {dateTimeLabel(batch.printedAt)}
                        </small>
                      )}
                      {!reprintable && (
                        <p className="table-qrs-stale">QR rotacionado — gere novo lote.</p>
                      )}
                      <div className="table-qrs-history-actions">
                        <Button
                          disabled={!reprintable || Boolean(busy)}
                          onClick={() =>
                            void generateBatch(
                              "print",
                              batch.tables.map((table) => table.tableId),
                              batch.format,
                              batch.template,
                              batch.includeWifi,
                            )
                          }
                          size="sm"
                          variant="ghost"
                        >
                          Reimprimir como novo lote
                        </Button>
                        {batch.status === "generated" && (
                          <Button
                            disabled={Boolean(busy)}
                            onClick={() => void markPrinted(batch)}
                            size="sm"
                            variant="ghost"
                          >
                            Marcar impresso
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {lifecycle.batches.length === 0 && (
                  <p className="table-qrs-empty">Nenhum lote foi gerado nesta unidade.</p>
                )}
              </div>
            </div>
            <div>
              <h3>Rotações</h3>
              <div className="table-qrs-history-list">
                {lifecycle.rotations.map((rotation) => (
                  <article key={rotation.id}>
                    <div>
                      <strong>
                        {tables.find((table) => table.tableId === rotation.tableId)?.label ??
                          "Mesa"}
                      </strong>
                      <Badge tone="info">v{rotation.tokenVersion}</Badge>
                    </div>
                    <small>
                      Por {tableQrActorLabel(rotation.actorIdentityId, rotation.actorLabel)} em{" "}
                      {dateTimeLabel(rotation.occurredAt)}
                    </small>
                  </article>
                ))}
                {lifecycle.rotations.length === 0 && (
                  <p className="table-qrs-empty">Nenhuma rotação registrada.</p>
                )}
              </div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
