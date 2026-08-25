// biome-ignore-all lint/a11y/noLabelWithoutControl: UI Checkbox renders the native control inside each label
import { Button, Checkbox, FormField, Input, Modal, NativeSelect } from "@giromesa/ui";
import type { FormEvent } from "react";
import type { ProductionPrinter, ProductionPrinterHub, ProductionPrinterInput } from "../../api";

export type ProductionPrinterDraft = ProductionPrinterInput & {
  id: string | null;
  revision: number | null;
};

const documentTypes = [
  { value: "kds_ticket", label: "Ticket de produção" },
  { value: "partial_statement", label: "Conta parcial" },
  { value: "payment_statement", label: "Comprovante de pagamento" },
  { value: "final_receipt", label: "Recibo final" },
] as const;

export function createProductionPrinterDraft(
  printer?: ProductionPrinter,
  hubs: ProductionPrinterHub[] = [],
  printers: ProductionPrinter[] = [],
): ProductionPrinterDraft {
  if (printer) {
    return {
      id: printer.id,
      revision: printer.revision,
      hubId: printer.hubId,
      label: printer.label,
      host: printer.host,
      port: printer.port,
      paperWidthMm: printer.paperWidthMm,
      charactersPerLine: printer.charactersPerLine,
      codeTable: printer.codeTable,
      cut: printer.cut,
      supportsRasterGraphics: printer.supportsRasterGraphics,
      isDefault: printer.isDefault,
      documentTypes: printer.documentTypes,
      fallbackPrinterId: printer.fallbackPrinterId ?? null,
      active: printer.active,
    };
  }
  const selectedHubId = hubs.length === 1 ? (hubs[0]?.id ?? "") : "";
  return {
    id: null,
    revision: null,
    hubId: selectedHubId,
    label: "",
    host: "",
    port: 9100,
    paperWidthMm: 80,
    charactersPerLine: 48,
    codeTable: 16,
    cut: true,
    supportsRasterGraphics: false,
    isDefault:
      selectedHubId.length > 0 &&
      !printers.some(
        (candidate) => candidate.hubId === selectedHubId && candidate.active !== false,
      ),
    documentTypes: ["kds_ticket"],
    fallbackPrinterId: null,
    active: true,
  };
}

export function productionPrinterDefaultIsLocked(
  draft: ProductionPrinterDraft,
  printers: ProductionPrinter[],
): boolean {
  return (
    draft.isDefault &&
    draft.hubId.length > 0 &&
    !printers.some(
      (printer) =>
        printer.id !== draft.id &&
        printer.hubId === draft.hubId &&
        printer.active !== false &&
        printer.isDefault,
    )
  );
}

export function productionPrinterInput(draft: ProductionPrinterDraft): ProductionPrinterInput {
  return {
    hubId: draft.hubId,
    label: draft.label.trim(),
    host: draft.host.trim(),
    port: Math.trunc(draft.port),
    paperWidthMm: draft.paperWidthMm,
    charactersPerLine: Math.trunc(draft.charactersPerLine),
    codeTable: Math.trunc(draft.codeTable),
    cut: draft.cut,
    supportsRasterGraphics: draft.supportsRasterGraphics,
    isDefault: draft.isDefault,
    documentTypes: [...new Set(draft.documentTypes)],
    fallbackPrinterId: draft.fallbackPrinterId || null,
    active: draft.active,
  };
}

export function ProductionPrinterForm({
  busy,
  draft,
  hubs,
  onChange,
  onClose,
  onSubmit,
  printers,
}: {
  busy: boolean;
  draft: ProductionPrinterDraft | null;
  hubs: ProductionPrinterHub[];
  onChange: (draft: ProductionPrinterDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  printers: ProductionPrinter[];
}) {
  const defaultLocked = draft ? productionPrinterDefaultIsLocked(draft, printers) : false;
  return (
    <Modal
      isOpen={draft !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
      title={draft?.id ? "Editar impressora de produção" : "Cadastrar impressora de produção"}
    >
      {draft && (
        <form className="production-printer-form" onSubmit={onSubmit}>
          <p>
            O endereço é salvo pela API da unidade e publicado ao Edge por comando auditável. A tela
            web não acessa a rede da impressora diretamente.
          </p>
          <div className="gm-form-grid production-printer-form__grid">
            <FormField htmlFor="production-printer-hub" label="Servidor local (Edge)" required>
              <NativeSelect
                id="production-printer-hub"
                onChange={(event) => {
                  const hubId = event.target.value;
                  const hubHasAnotherActivePrinter = printers.some(
                    (printer) =>
                      printer.id !== draft.id &&
                      printer.hubId === hubId &&
                      printer.active !== false,
                  );
                  onChange({
                    ...draft,
                    hubId,
                    isDefault: hubHasAnotherActivePrinter ? draft.isDefault : hubId.length > 0,
                    fallbackPrinterId:
                      printers.find((printer) => printer.id === draft.fallbackPrinterId)?.hubId ===
                      hubId
                        ? draft.fallbackPrinterId
                        : null,
                  });
                }}
                required
                value={draft.hubId}
              >
                <option value="">Selecione o Edge</option>
                {hubs.map((hub) => (
                  <option key={hub.id} value={hub.id}>
                    {hub.label} · {hub.online ? "online" : "offline"}
                  </option>
                ))}
              </NativeSelect>
              <small>
                {hubs.length === 0
                  ? "Nenhum dispositivo ativo está disponível para receber a configuração."
                  : "O vínculo é explícito; o sistema nunca escolhe outro Edge em silêncio."}
              </small>
            </FormField>
            <FormField htmlFor="production-printer-label" label="Nome" required>
              <Input
                id="production-printer-label"
                maxLength={120}
                onChange={(event) => onChange({ ...draft, label: event.target.value })}
                required
                value={draft.label}
              />
            </FormField>
            <FormField htmlFor="production-printer-host" label="IP privado" required>
              <Input
                autoComplete="off"
                id="production-printer-host"
                maxLength={45}
                onChange={(event) => onChange({ ...draft, host: event.target.value })}
                placeholder="192.168.1.50"
                required
                value={draft.host}
              />
              <small>Use apenas o IPv4 ou IPv6 privado fixo da rede local.</small>
            </FormField>
            <FormField htmlFor="production-printer-port" label="Porta" required>
              <Input
                id="production-printer-port"
                max={65535}
                min={1}
                onChange={(event) => onChange({ ...draft, port: Number(event.target.value) })}
                required
                type="number"
                value={draft.port}
              />
            </FormField>
            <FormField htmlFor="production-printer-width" label="Bobina" required>
              <NativeSelect
                id="production-printer-width"
                onChange={(event) =>
                  onChange({ ...draft, paperWidthMm: Number(event.target.value) as 58 | 80 })
                }
                value={draft.paperWidthMm}
              >
                <option value={58}>58 mm</option>
                <option value={80}>80 mm</option>
              </NativeSelect>
            </FormField>
            <FormField htmlFor="production-printer-columns" label="Caracteres por linha" required>
              <Input
                id="production-printer-columns"
                max={64}
                min={24}
                onChange={(event) =>
                  onChange({ ...draft, charactersPerLine: Number(event.target.value) })
                }
                required
                type="number"
                value={draft.charactersPerLine}
              />
            </FormField>
            <FormField
              htmlFor="production-printer-code-table"
              label="Tabela de caracteres"
              required
            >
              <Input
                id="production-printer-code-table"
                max={255}
                min={0}
                onChange={(event) => onChange({ ...draft, codeTable: Number(event.target.value) })}
                required
                type="number"
                value={draft.codeTable}
              />
            </FormField>
            <FormField htmlFor="production-printer-fallback" label="Fallback">
              <NativeSelect
                id="production-printer-fallback"
                onChange={(event) =>
                  onChange({ ...draft, fallbackPrinterId: event.target.value || null })
                }
                value={draft.fallbackPrinterId ?? ""}
              >
                <option value="">Sem fallback</option>
                {printers
                  .filter(
                    (printer) =>
                      printer.id !== draft.id &&
                      printer.active !== false &&
                      printer.hubId === draft.hubId,
                  )
                  .map((printer) => (
                    <option key={printer.id} value={printer.id}>
                      {printer.label}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
          </div>

          <fieldset className="production-printer-form__options">
            <legend>Comportamento físico</legend>
            <label>
              <Checkbox
                checked={draft.cut}
                onChange={(event) => onChange({ ...draft, cut: event.target.checked })}
              />
              Guilhotina automática
            </label>
            <label>
              <Checkbox
                checked={draft.supportsRasterGraphics}
                onChange={(event) =>
                  onChange({ ...draft, supportsRasterGraphics: event.target.checked })
                }
              />
              Suporta logomarca rasterizada
            </label>
            <label>
              <Checkbox
                checked={draft.isDefault}
                disabled={defaultLocked}
                onChange={(event) => onChange({ ...draft, isDefault: event.target.checked })}
              />
              Impressora padrão deste Edge
            </label>
            {defaultLocked && (
              <small>
                Este Edge precisa manter uma impressora padrão. Marque outra impressora deste Edge
                como padrão antes de remover este vínculo.
              </small>
            )}
          </fieldset>

          <fieldset className="production-printer-form__checks">
            <legend>Tipos de documento</legend>
            {documentTypes.map((documentType) => (
              <label key={documentType.value}>
                <Checkbox
                  checked={draft.documentTypes.includes(documentType.value)}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      documentTypes: event.target.checked
                        ? [...new Set([...draft.documentTypes, documentType.value])]
                        : draft.documentTypes.filter((value) => value !== documentType.value),
                    })
                  }
                />
                {documentType.label}
              </label>
            ))}
          </fieldset>

          <div className="production-printer-form__actions">
            <Button disabled={busy} onClick={onClose} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button
              disabled={
                busy ||
                !draft.hubId ||
                draft.label.trim().length < 2 ||
                draft.host.trim().length < 3 ||
                draft.documentTypes.length === 0
              }
              type="submit"
            >
              {busy ? "Salvando…" : "Salvar impressora"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
