import type { BillPrintingPolicy } from "@giromesa/contracts";
import { Button, Callout, Card, FormField, NativeSelect } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { api, type ProductionPrinter } from "../../api";

export function BillPrintingSettingsPanel({
  organizationId,
  unitId,
}: {
  organizationId: string;
  unitId: string;
}) {
  const [policy, setPolicy] = useState<BillPrintingPolicy | null>(null);
  const [printers, setPrinters] = useState<ProductionPrinter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    void refresh;
    let active = true;
    setBusy(true);
    setError(null);
    void Promise.all([
      api.pilot.billPrintingPolicy(organizationId, unitId),
      api.pilot.productionPrinters(organizationId, unitId),
    ])
      .then(([result, available]) => {
        if (active) {
          setPolicy(result.policy);
          setPrinters(available.printers);
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível carregar a configuração.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, unitId, refresh]);
  async function save(next: BillPrintingPolicy) {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const result = await api.pilot.updateBillPrintingPolicy(organizationId, unitId, next);
      setPolicy(result.policy);
      setSaved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Não foi possível salvar. Recarregue a configuração e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="device-setup__card">
      <BillPrintingSettings
        policy={policy}
        printers={printers}
        busy={busy}
        error={error}
        onSave={(next) => void save(next)}
      />
      {saved && <p role="status">Destino da pré-conta salvo para esta unidade.</p>}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setSaved(false);
          setRefresh((value) => value + 1);
        }}
      >
        Recarregar configuração e impressoras
      </Button>
    </Card>
  );
}

export function BillPrintingSettings({
  policy,
  printers,
  busy,
  error,
  onSave,
}: {
  policy: BillPrintingPolicy | null;
  printers: ProductionPrinter[];
  busy: boolean;
  error: string | null;
  onSave: (policy: BillPrintingPolicy) => void;
}) {
  const [draft, setDraft] = useState(policy);
  useEffect(() => setDraft(policy), [policy]);
  const eligible = printers.filter(
    (printer) => printer.active && printer.documentTypes.includes("partial_statement"),
  );
  return (
    <section aria-labelledby="bill-printing-title" className="gm-form-stack">
      <div>
        <h3 id="bill-printing-title">Pedido de pré-conta</h3>
        <p>Escolha o destino ao solicitar a conta no atendimento.</p>
      </div>
      {error && <Callout tone="danger">{error}</Callout>}
      {!draft ? (
        <p role="status">Carregando configuração de pré-conta…</p>
      ) : (
        <>
          <FormField htmlFor="bill-printing-mode" label="Ao pedir a conta">
            <NativeSelect
              id="bill-printing-mode"
              disabled={busy}
              value={draft.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  mode: event.target.value as BillPrintingPolicy["mode"],
                  printerId: null,
                })
              }
            >
              <option value="notify_cashier">Avisar o caixa</option>
              <option value="cashier_printer">Imprimir automaticamente no caixa</option>
              <option value="local_terminal">Imprimir no terminal do atendimento</option>
            </NativeSelect>
          </FormField>
          {draft.mode === "cashier_printer" && (
            <FormField htmlFor="bill-printing-printer" label="Impressora do caixa">
              <NativeSelect
                id="bill-printing-printer"
                disabled={busy}
                value={draft.printerId ?? ""}
                onChange={(event) => setDraft({ ...draft, printerId: event.target.value || null })}
              >
                <option value="">Selecione a impressora</option>
                {draft.printerId && !eligible.some((printer) => printer.id === draft.printerId) && (
                  <option disabled value={draft.printerId}>
                    Impressora atual indisponível
                  </option>
                )}
                {eligible.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.label}
                  </option>
                ))}
              </NativeSelect>
              <small>
                O Conector recebe o documento automaticamente. Confira alertas de conexão e o
                resultado da fila.
              </small>
            </FormField>
          )}
          {draft.mode === "local_terminal" && (
            <p>
              Exige um terminal com impressão habilitada. Sem esse recurso, o pedido fica para o
              caixa.
            </p>
          )}
          {draft.mode === "notify_cashier" && (
            <p>O caixa recebe o chamado e escolhe quando imprimir.</p>
          )}
          <div>
            <Button
              disabled={
                busy ||
                (draft.mode === "cashier_printer" &&
                  !eligible.some((printer) => printer.id === draft.printerId))
              }
              onClick={() => onSave(draft)}
            >
              {busy ? "Salvando…" : "Salvar destino da pré-conta"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
