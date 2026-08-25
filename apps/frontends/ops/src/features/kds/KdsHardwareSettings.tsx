// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, Input } from "@giromesa/ui";
import { useState } from "react";
import {
  DEFAULT_KDS_BUMP_BAR_MAP,
  type KdsBumpAction,
  type KdsBumpBarMap,
  kdsBumpKeyLabel,
  normalizeKdsBumpKey,
} from "./kds.bumpbar";

export interface KdsPrinterPreferences {
  copies: number;
}

const ACTION_LABEL: Record<KdsBumpAction, string> = {
  previous: "Ação anterior",
  next: "Próxima ação",
  bump: "Executar ação",
  print: "Imprimir ticket",
  refresh: "Atualizar produção",
};

export function KdsHardwareSettings({
  bumpMap,
  hardwarePrinting,
  onBumpMapChange,
  onPrinterPreferencesChange,
  onReprint,
  onTestPrint,
  printBusy,
  printerLabel,
  printerPreferences,
}: {
  bumpMap: KdsBumpBarMap;
  hardwarePrinting: boolean;
  onBumpMapChange: (map: KdsBumpBarMap) => void;
  onPrinterPreferencesChange: (preferences: KdsPrinterPreferences) => void;
  onReprint: () => void;
  onTestPrint: () => void;
  printBusy: boolean;
  printerLabel: string;
  printerPreferences: KdsPrinterPreferences;
}) {
  const [mappingError, setMappingError] = useState<string | null>(null);
  const assign = (action: KdsBumpAction, key: string) => {
    const normalized = normalizeKdsBumpKey(key);
    if (
      Object.entries(bumpMap).some(
        ([candidate, mappedKey]) => candidate !== action && mappedKey === normalized,
      )
    ) {
      setMappingError("Cada tecla deve executar uma única ação.");
      return;
    }
    setMappingError(null);
    onBumpMapChange({ ...bumpMap, [action]: normalized });
  };

  return (
    <Card className="kds-settings-card">
      <header className="kds-settings-card__header">
        <div>
          <span className="gm-pill" data-tone="info">
            Somente este terminal
          </span>
          <h2>Hardware</h2>
          <p>A impressora vem do perfil persistido do terminal ou do roteamento automático.</p>
        </div>
        <Badge tone={hardwarePrinting ? "success" : "warning"}>
          {hardwarePrinting ? "Roteamento disponível" : "Saúde não confirmada"}
        </Badge>
      </header>

      <fieldset className="gm-form-grid kds-printer-settings">
        <legend>Impressora térmica</legend>
        <div className="gm-form-field">
          <span>Destino efetivo</span>
          <strong>{printerLabel}</strong>
          <small>
            Sem vínculo no terminal, o sistema aplica a política persistida da estação e o tipo do
            documento.
          </small>
          <a className="gm-button gm-button--ghost gm-button--sm" href="#/device">
            Abrir Dispositivos
          </a>
        </div>
        <label className="gm-form-field">
          <span>Vias</span>
          <Input
            className="gm-form-control"
            max={3}
            min={1}
            onChange={(event) =>
              onPrinterPreferencesChange({
                ...printerPreferences,
                copies: Math.min(3, Math.max(1, Number(event.target.value))),
              })
            }
            type="number"
            value={printerPreferences.copies}
          />
        </label>
        <Button disabled={printBusy} onClick={onTestPrint} size="sm" variant="secondary">
          Solicitar primeira via do ticket focado
        </Button>
        <Button disabled={printBusy} onClick={onReprint} size="sm" variant="ghost">
          Reimprimir com motivo…
        </Button>
        <small>
          A largura de 58/80 mm, tabela de caracteres e guilhotina são calibradas no Edge.
        </small>
      </fieldset>

      <fieldset className="kds-bump-map">
        <legend>Bump bar USB/HID</legend>
        {Object.entries(bumpMap).map(([action, key]) => (
          <label key={action}>
            <span>{ACTION_LABEL[action as KdsBumpAction]}</span>
            <Input
              aria-label={`Tecla para ${ACTION_LABEL[action as KdsBumpAction]}`}
              onKeyDown={(event) => {
                event.preventDefault();
                if (!event.ctrlKey && !event.altKey && !event.metaKey) {
                  assign(action as KdsBumpAction, event.key);
                }
              }}
              readOnly
              value={kdsBumpKeyLabel(key)}
            />
          </label>
        ))}
        {mappingError && <small role="alert">{mappingError}</small>}
        <Button
          onClick={() => {
            setMappingError(null);
            onBumpMapChange(DEFAULT_KDS_BUMP_BAR_MAP);
          }}
          size="sm"
          variant="ghost"
        >
          Restaurar teclas padrão
        </Button>
        <small>
          Conecte um bump bar que opere como teclado USB. Clique no campo e pressione a tecla
          física.
        </small>
      </fieldset>
    </Card>
  );
}
