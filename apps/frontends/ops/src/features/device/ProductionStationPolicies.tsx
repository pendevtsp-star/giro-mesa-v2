import { Badge, Button, Card, FormField, Input, NativeSelect } from "@giromesa/ui";
import type {
  ProductionPrinter,
  ProductionPrintingPolicy,
  ProductionPrintingStation,
  ProductionPrintMode,
} from "../../api";

const deliveryModes: Array<{
  value: ProductionPrintMode;
  label: string;
  description: string;
}> = [
  {
    value: "kds_only",
    label: "Somente na tela",
    description: "Os pedidos aparecem na tela da produção, sem impressão automática.",
  },
  {
    value: "printer_only",
    label: "Somente no papel",
    description: "Os pedidos são impressos e não precisam ser concluídos na tela.",
  },
  {
    value: "both",
    label: "Na tela e no papel",
    description: "Os pedidos aparecem na tela e também são impressos.",
  },
  {
    value: "disabled",
    label: "Desativada",
    description: "Não entrega itens a esta estação até a política ser reativada.",
  },
];

const readinessIssueLabels: Record<string, string> = {
  DELIVERY_DISABLED: "Entrega desativada para esta estação.",
  KDS_NOT_CONFIGURED: "Nenhuma tela está preparada para esta área.",
  PRINT_PRINTER_NOT_CONFIGURED: "Escolha uma impressora para esta estação.",
  PRINT_POLICY_INVALID: "A impressora escolhida não atende esta estação.",
  EDGE_HUB_OFFLINE: "O computador ligado à impressora está sem conexão.",
};

export function productionStationPolicyCanBeSaved(
  policy: ProductionPrintingPolicy,
  printers: ProductionPrinter[],
): boolean {
  if (policy.deliveryMode !== "printer_only" && policy.deliveryMode !== "both") return true;
  return printers.some(
    (printer) =>
      printer.id === policy.printerId &&
      printer.active !== false &&
      printer.documentTypes.includes("kds_ticket"),
  );
}

export function ProductionStationPolicies({
  busyAction,
  canManage,
  drafts,
  onChange,
  onSave,
  printers,
  stations,
}: {
  busyAction: string | null;
  canManage: boolean;
  drafts: Record<string, ProductionPrintingPolicy>;
  onChange: (stationId: string, policy: ProductionPrintingPolicy) => void;
  onSave: (station: ProductionPrintingStation) => void;
  printers: ProductionPrinter[];
  stations: ProductionPrintingStation[];
}) {
  return (
    <section aria-labelledby="production-station-policy-title">
      <div className="production-printers__section-heading">
        <div>
          <h3 id="production-station-policy-title">Como cada área recebe os pedidos?</h3>
          <p>Escolha tela, papel ou os dois para cada área de preparo.</p>
        </div>
      </div>
      {stations.length === 0 ? (
        <Card className="production-printers__empty">
          <strong>Nenhuma estação de produção ativa</strong>
          <p>Crie setores de preparo no Cardápio para configurar a entrega.</p>
          <a className="gm-button gm-button--secondary gm-button--sm" href="#/catalog">
            Abrir Cardápio
          </a>
        </Card>
      ) : (
        <div className="production-printers__cards">
          {stations.map((station) => {
            const policy = drafts[station.id] ?? {
              deliveryMode: station.deliveryMode,
              copies: station.copies,
              printerId: station.printerId,
            };
            const prints = policy.deliveryMode === "printer_only" || policy.deliveryMode === "both";
            const eligiblePrinters = printers.filter(
              (printer) => printer.active !== false && printer.documentTypes.includes("kds_ticket"),
            );
            const selectedPrinterIsValid = productionStationPolicyCanBeSaved(policy, printers);
            return (
              <Card className="production-station-card" key={station.id}>
                <header>
                  <div>
                    <strong>{station.name}</strong>
                    <small>{station.code ?? "Sem código"}</small>
                  </div>
                  <Badge
                    tone={
                      !station.active ? "neutral" : station.readiness.ready ? "success" : "warning"
                    }
                  >
                    {!station.active
                      ? "Inativa"
                      : station.readiness.ready
                        ? "Pronta"
                        : "Requer atenção"}
                  </Badge>
                </header>
                <div className="gm-form-grid">
                  <FormField htmlFor={`production-mode-${station.id}`} label="Receber pedidos">
                    <NativeSelect
                      disabled={!canManage}
                      id={`production-mode-${station.id}`}
                      onChange={(event) =>
                        onChange(station.id, {
                          ...policy,
                          deliveryMode: event.target.value as ProductionPrintMode,
                          printerId:
                            event.target.value === "printer_only" || event.target.value === "both"
                              ? policy.printerId
                              : null,
                        })
                      }
                      value={policy.deliveryMode}
                    >
                      {deliveryModes.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <small>
                      {
                        deliveryModes.find((mode) => mode.value === policy.deliveryMode)
                          ?.description
                      }
                    </small>
                  </FormField>
                  <FormField htmlFor={`production-printer-${station.id}`} label="Impressora">
                    <NativeSelect
                      disabled={!canManage || !prints}
                      id={`production-printer-${station.id}`}
                      onChange={(event) =>
                        onChange(station.id, {
                          ...policy,
                          printerId: event.target.value || null,
                        })
                      }
                      value={policy.printerId ?? ""}
                    >
                      <option value="">Selecione a impressora</option>
                      {policy.printerId &&
                        !eligiblePrinters.some((printer) => printer.id === policy.printerId) && (
                          <option disabled value={policy.printerId}>
                            Vínculo atual indisponível
                          </option>
                        )}
                      {eligiblePrinters.map((printer) => (
                        <option key={printer.id} value={printer.id}>
                          {printer.label}
                        </option>
                      ))}
                    </NativeSelect>
                    {prints && eligiblePrinters.length === 0 && (
                      <small role="alert">
                        Cadastre uma impressora ativa que aceite tickets de produção.
                      </small>
                    )}
                  </FormField>
                  <FormField htmlFor={`production-copies-${station.id}`} label="Vias">
                    <Input
                      disabled={!canManage || !prints}
                      id={`production-copies-${station.id}`}
                      max={5}
                      min={1}
                      onChange={(event) =>
                        onChange(station.id, {
                          ...policy,
                          copies: Math.min(
                            5,
                            Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                          ),
                        })
                      }
                      type="number"
                      value={policy.copies}
                    />
                  </FormField>
                </div>
                <ul className="production-readiness" aria-label={`Prontidão de ${station.name}`}>
                  <li data-ready={station.readiness.kdsConfigured}>Tela preparada</li>
                  <li data-ready={station.readiness.printerConfigured}>Impressão configurada</li>
                  <li data-ready={station.readiness.hubOnline}>Computador conectado</li>
                </ul>
                {station.readiness.issues.length > 0 && (
                  <ul className="production-readiness__issues">
                    {station.readiness.issues.map((issue) => (
                      <li key={issue}>{readinessIssueLabels[issue] ?? issue}</li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <Button
                    disabled={busyAction !== null || !selectedPrinterIsValid}
                    onClick={() => onSave(station)}
                    size="sm"
                  >
                    {busyAction === `policy:${station.id}` ? "Salvando…" : "Salvar esta área"}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
