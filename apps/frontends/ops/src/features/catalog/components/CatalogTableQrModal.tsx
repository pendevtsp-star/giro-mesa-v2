import { Button, Icon, Input, Label, Modal, NativeSelect } from "@giromesa/ui";
import QRCode from "qrcode";
import { useEffect, useEffectEvent, useState } from "react";
import { api, type CatalogTableQr } from "../../../api";
import type { CatalogBrandingSettings, PilotScope } from "../../../operations.shared";
import { buildTableQrPrintHtml } from "../catalog.print";

type FeedbackTone = "danger" | "success";
type TableQr = CatalogTableQr & { dataUrl: string };

type CatalogTableQrModalProps = {
  branding?: CatalogBrandingSettings;
  isOpen: boolean;
  onClose: () => void;
  scope: PilotScope;
  setFeedback: (message: string, tone?: FeedbackTone) => void;
};

export function CatalogTableQrModal({
  branding,
  isOpen,
  onClose,
  scope,
  setFeedback,
}: CatalogTableQrModalProps) {
  const [startTable, setStartTable] = useState(1);
  const [endTable, setEndTable] = useState(15);
  const [customLabels, setCustomLabels] = useState("Balcão 01, Balcão 02, Deck 01, Deck 02");
  const [mode, setMode] = useState<"range" | "custom">("range");
  const [includeWifi, setIncludeWifi] = useState(true);
  const [tableQrs, setTableQrs] = useState<TableQr[]>([]);
  const [loading, setLoading] = useState(false);
  const reportFeedback = useEffectEvent(setFeedback);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setLoading(true);
    setTableQrs([]);

    void api.pilot
      .catalogTableQrs(scope.organizationId, scope.unitId)
      .then((rows) =>
        Promise.all(
          rows.map(async (row) => ({
            ...row,
            dataUrl: await QRCode.toDataURL(row.url, {
              errorCorrectionLevel: "M",
              margin: 1,
              width: 320,
            }),
          })),
        ),
      )
      .then((rows) => {
        if (active) setTableQrs(rows);
      })
      .catch((error: unknown) => {
        if (!active) return;
        reportFeedback(
          error instanceof Error ? error.message : "Falha ao carregar QR Codes.",
          "danger",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, scope.organizationId, scope.unitId]);

  const previewQr = tableQrs[0];
  const total =
    mode === "range"
      ? Math.max(1, endTable - startTable + 1)
      : customLabels.split(",").filter(Boolean).length;

  function printTableQrs() {
    const selectedRows =
      mode === "range"
        ? tableQrs.slice(
            Math.max(0, Math.min(startTable, endTable) - 1),
            Math.max(startTable, endTable),
          )
        : tableQrs.filter((row) =>
            customLabels
              .split(",")
              .map((label) => label.trim().toLowerCase())
              .includes(row.label.toLowerCase()),
          );

    if (selectedRows.length === 0) {
      setFeedback("Nenhuma mesa publicada corresponde à seleção.", "danger");
      return;
    }

    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      setFeedback("Permita pop-ups no navegador para imprimir os QR Codes.", "danger");
      return;
    }

    printWindow.document.write(
      buildTableQrPrintHtml(selectedRows, {
        displayName: branding?.restaurantName,
        logoUrl: branding?.headerBannerUrl,
        primaryColor: branding?.brandColor,
      }),
    );
    printWindow.document.close();
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gerador de Placas & Displays de QR Code das Mesas"
      size="lg"
    >
      <div className="catalog-stack catalog-stack--16" aria-busy={loading}>
        <p className="catalog-muted-copy-085">
          Gere e imprima placas de mesa de alta resolução prontas para displays de acrílico ou
          adesivos. Cada placa possui o QR Code direto para o pedido na respectiva mesa e Wi-Fi da
          casa.
        </p>

        <div className="catalog-grid-2">
          <div className="catalog-stack catalog-stack--12">
            <Label className="gm-field">
              Modo de Seleção de Mesas
              <NativeSelect
                value={mode}
                onChange={(event) => setMode(event.target.value as "custom" | "range")}
                className="catalog-control-36"
              >
                <option value="range">Faixa Sequencial Numérica (Ex: Mesa 1 a 20)</option>
                <option value="custom">Nomes e Balcões Personalizados</option>
              </NativeSelect>
            </Label>

            {mode === "range" ? (
              <div className="catalog-grid-2 catalog-grid-2--compact">
                <Label className="gm-field">
                  Mesa Inicial
                  <Input
                    type="number"
                    min={1}
                    value={startTable}
                    onChange={(event) =>
                      setStartTable(Number.parseInt(event.target.value, 10) || 1)
                    }
                    className="catalog-control-36"
                  />
                </Label>
                <Label className="gm-field">
                  Mesa Final
                  <Input
                    type="number"
                    min={1}
                    value={endTable}
                    onChange={(event) => setEndTable(Number.parseInt(event.target.value, 10) || 1)}
                    className="catalog-control-36"
                  />
                </Label>
              </div>
            ) : (
              <Label className="gm-field">
                Lista de Mesas / Balcões (separados por vírgula)
                <Input
                  value={customLabels}
                  onChange={(event) => setCustomLabels(event.target.value)}
                  placeholder="Ex: Mesa 01, Mesa 02, Balcão 1, Deck VIP"
                  className="catalog-control-36"
                />
              </Label>
            )}

            <Label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "var(--gm-ink)",
                cursor: "pointer",
              }}
            >
              <input
                className="accent-primary"
                type="checkbox"
                checked={includeWifi}
                onChange={(event) => setIncludeWifi(event.target.checked)}
              />
              <span>Incluir dados do Wi-Fi no rodapé da placa</span>
            </Label>

            <div
              style={{
                padding: "10px 12px",
                background: "var(--gm-surface-sunken)",
                borderRadius: "6px",
                fontSize: "0.78rem",
                color: "var(--gm-muted)",
              }}
            >
              Total a imprimir: <strong>{total} placa(s)</strong> (Diagramadas 2 por folha A4 com
              marcações de corte).
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "var(--gm-muted)",
                marginBottom: "6px",
              }}
            >
              Prévia do Display de Mesa
            </span>
            <div
              style={{
                width: "190px",
                background: "#fff",
                borderRadius: "12px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                border: "1px solid var(--gm-border)",
                overflow: "hidden",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  background: branding?.brandColor || "#059669",
                  color: "#fff",
                  padding: "10px 8px",
                }}
              >
                <div
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    opacity: 0.9,
                  }}
                >
                  {branding?.restaurantName || "GiroMesa Bistrô"}
                </div>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, marginTop: "2px" }}>
                  {previewQr
                    ? previewQr.label.toUpperCase()
                    : mode === "range"
                      ? `MESA ${startTable.toString().padStart(2, "0")}`
                      : customLabels.split(",")[0]?.trim() || "MESA 01"}
                </div>
              </div>

              <div
                style={{
                  padding: "12px 10px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    width: "90px",
                    height: "90px",
                    background: "#f8fafc",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {previewQr ? (
                    <img
                      alt={`QR Code ${previewQr.label}`}
                      src={previewQr.dataUrl}
                      width={88}
                      height={88}
                    />
                  ) : (
                    <span role="status" className="catalog-muted-copy-tight">
                      {loading ? "Carregando QR…" : "Sem QR publicado"}
                    </span>
                  )}
                </div>
                <strong
                  style={{
                    fontSize: "0.68rem",
                    color: "#0f172a",
                    marginTop: "8px",
                    display: "block",
                  }}
                >
                  APONTE A CÂMERA
                </strong>
                <span
                  style={{
                    fontSize: "0.62rem",
                    color: "#64748b",
                    display: "block",
                    lineHeight: 1.2,
                    marginTop: "2px",
                  }}
                >
                  Peça pelo celular direto nesta mesa
                </span>
              </div>

              {includeWifi && branding?.wifiNotice && (
                <div
                  style={{
                    background: "#f1f5f9",
                    padding: "6px 8px",
                    fontSize: "0.6rem",
                    color: "#475569",
                    borderTop: "1px solid #e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  📶 {branding.wifiNotice}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="catalog-modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={printTableQrs} disabled={loading}>
            <Icon name="download" size={14} />
            <span>{loading ? "Carregando QR Codes…" : "Imprimir Placas A4"}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
