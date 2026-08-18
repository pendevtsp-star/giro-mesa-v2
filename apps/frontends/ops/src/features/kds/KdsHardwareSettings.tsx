import { Badge, Button, Card } from "@giromesa/ui";
import { useState } from "react";
import {
  DEFAULT_KDS_BUMP_BAR_MAP,
  type KdsBumpAction,
  type KdsBumpBarMap,
  normalizeKdsBumpKey,
} from "./kds.bumpbar";

export interface KdsPrinterPreferences {
  printerId: string;
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
  onTestPrint,
  printerPreferences,
}: {
  bumpMap: KdsBumpBarMap;
  hardwarePrinting: boolean;
  onBumpMapChange: (map: KdsBumpBarMap) => void;
  onPrinterPreferencesChange: (preferences: KdsPrinterPreferences) => void;
  onTestPrint: () => void;
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
          <p>Configure a impressora térmica pareada ao Edge e as teclas do bump bar HID.</p>
        </div>
        <Badge tone={hardwarePrinting ? "success" : "warning"}>
          {hardwarePrinting ? "Impressora pronta" : "Contingência do navegador"}
        </Badge>
      </header>

      <fieldset className="gm-form-grid">
        <legend>Impressora térmica</legend>
        <label className="gm-form-field">
          <span>Identificador no Edge</span>
          <input
            className="gm-form-control"
            maxLength={80}
            onChange={(event) =>
              onPrinterPreferencesChange({ ...printerPreferences, printerId: event.target.value })
            }
            value={printerPreferences.printerId}
          />
        </label>
        <label className="gm-form-field">
          <span>Vias</span>
          <input
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
        <Button onClick={onTestPrint} size="sm" variant="secondary">
          {hardwarePrinting ? "Imprimir ticket focado" : "Abrir impressão de contingência"}
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
            <input
              aria-label={`Tecla para ${ACTION_LABEL[action as KdsBumpAction]}`}
              onKeyDown={(event) => {
                event.preventDefault();
                if (!event.ctrlKey && !event.altKey && !event.metaKey) {
                  assign(action as KdsBumpAction, event.key);
                }
              }}
              readOnly
              value={key}
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
