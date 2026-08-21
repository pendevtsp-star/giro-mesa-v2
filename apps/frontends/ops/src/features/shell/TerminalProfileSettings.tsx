import {
  Badge,
  Button,
  Checkbox,
  FormField,
  Input,
  Modal,
  NativeSelect,
  Separator,
} from "@giromesa/ui";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  type TerminalProfile,
  type TerminalProfileInput,
  type TerminalProfileMode,
  type TerminalProfileRoute,
  type TerminalQuickAction,
} from "../../api";
import { type DeviceContext, loadShellPrinters, testShellPrinter } from "../../bridge";
import { saveTerminalProfile } from "./terminal-profile";
import "./terminal-profile.css";

type PrinterStatus = {
  id: string;
  configured: boolean;
  available: boolean;
  isDefault: boolean;
  paperWidthMm: number;
  errorCode: string | null;
};

const modes: Array<{ value: TerminalProfileMode; label: string }> = [
  { value: "waiter_mobile", label: "Celular do garçom" },
  { value: "reception", label: "Recepção" },
  { value: "cashier", label: "Caixa" },
  { value: "kds", label: "Produção KDS" },
  { value: "expedition", label: "Expedição" },
  { value: "shared", label: "Terminal compartilhado" },
];
const routes: Array<{ value: TerminalProfileRoute; label: string }> = [
  { value: "dashboard", label: "Visão geral" },
  { value: "reservations", label: "Recepção e espera" },
  { value: "salon", label: "Mesas e comandas" },
  { value: "counter", label: "Balcão e retirada" },
  { value: "cash", label: "Contas e caixa" },
  { value: "kds", label: "Produção KDS" },
];
const actions: Array<{ value: TerminalQuickAction; label: string }> = [
  { value: "open_tab", label: "Abrir comanda" },
  { value: "new_order", label: "Novo pedido" },
  { value: "receive", label: "Receber" },
  { value: "waitlist", label: "Lista de espera" },
  { value: "print", label: "Imprimir" },
  { value: "search", label: "Buscar" },
];

const initialProfile = (runtime: DeviceContext): TerminalProfileInput => ({
  label: runtime.deviceName,
  mode: "shared",
  defaultRoute: "dashboard",
  printerId: null,
  stationId: null,
  compact: true,
  quickActions: ["search"],
});

function parsePrinters(value: unknown): PrinterStatus[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const candidates = (value as Record<string, unknown>).printers;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : typeof row.Id === "string" ? row.Id : null;
    if (!id) return [];
    return [
      {
        id,
        configured: row.configured === true || row.Configured === true,
        available: row.available === true || row.Available === true,
        isDefault: row.isDefault === true || row.IsDefault === true,
        paperWidthMm:
          typeof row.paperWidthMm === "number"
            ? row.paperWidthMm
            : typeof row.PaperWidthMm === "number"
              ? row.PaperWidthMm
              : 80,
        errorCode:
          typeof row.errorCode === "string"
            ? row.errorCode
            : typeof row.ErrorCode === "string"
              ? row.ErrorCode
              : null,
      },
    ];
  });
}

export function TerminalProfileSettings({
  isOpen,
  onClose,
  onSaved,
  organizationId,
  unitId,
  runtime,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (profile: TerminalProfile) => void;
  organizationId: string;
  unitId: string;
  runtime: DeviceContext;
}) {
  const [form, setForm] = useState<TerminalProfileInput>(() => initialProfile(runtime));
  const [printers, setPrinters] = useState<PrinterStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setNotice("");
    try {
      const [profile, printerResult] = await Promise.all([
        api.pilot.terminalProfile(organizationId, unitId, runtime.deviceId),
        loadShellPrinters(),
      ]);
      setForm(profile ?? initialProfile(runtime));
      setPrinters(printerResult?.success ? parsePrinters(printerResult.payload) : []);
      if (profile) saveTerminalProfile(profile);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Não foi possível carregar este terminal.",
      );
    } finally {
      setBusy(false);
    }
  }, [organizationId, runtime, unitId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      const profile = await api.pilot.updateTerminalProfile(
        organizationId,
        unitId,
        runtime.deviceId,
        form,
        crypto.randomUUID(),
      );
      saveTerminalProfile(profile);
      onSaved(profile);
      setNotice("Perfil do terminal atualizado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar este terminal.");
    } finally {
      setBusy(false);
    }
  }

  async function testPrinter() {
    if (!form.printerId) return;
    setTesting(true);
    setNotice("");
    const result = await testShellPrinter(form.printerId);
    setNotice(
      result?.success
        ? `Teste entregue à impressora ${result.printerId ?? form.printerId}.`
        : `Falha no teste: ${result?.errorCode ?? "impressora indisponível"}.`,
    );
    setTesting(false);
    void load();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" title="Configurar este terminal">
      <div className="terminal-profile-settings">
        <p>
          O perfil define a tela inicial e os equipamentos deste dispositivo. As permissões do
          funcionário continuam controlando o acesso.
        </p>
        <div className="gm-form-grid">
          <FormField htmlFor="terminal-profile-label" label="Nome do terminal" required>
            <Input
              id="terminal-profile-label"
              maxLength={120}
              onChange={(event) =>
                setForm((current) => ({ ...current, label: event.target.value }))
              }
              value={form.label}
            />
          </FormField>
          <FormField htmlFor="terminal-profile-mode" label="Posto de trabalho" required>
            <NativeSelect
              id="terminal-profile-mode"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  mode: event.target.value as TerminalProfileMode,
                }))
              }
              value={form.mode}
            >
              {modes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField htmlFor="terminal-profile-route" label="Tela inicial" required>
            <NativeSelect
              id="terminal-profile-route"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  defaultRoute: event.target.value as TerminalProfileRoute,
                }))
              }
              value={form.defaultRoute}
            >
              {routes.map((route) => (
                <option key={route.value} value={route.value}>
                  {route.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField htmlFor="terminal-profile-printer" label="Impressora padrão">
            <NativeSelect
              id="terminal-profile-printer"
              onChange={(event) =>
                setForm((current) => ({ ...current, printerId: event.target.value || null }))
              }
              value={form.printerId ?? ""}
            >
              <option value="">Roteamento automático</option>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printer.id} · {printer.paperWidthMm} mm ·{" "}
                  {printer.available ? "disponível" : "indisponível"}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        {form.printerId && (
          <div className="terminal-printer-health">
            {printers
              .filter((printer) => printer.id === form.printerId)
              .map((printer) => (
                <Badge key={printer.id} tone={printer.available ? "success" : "danger"}>
                  {printer.available
                    ? "Impressora disponível"
                    : (printer.errorCode ?? "Impressora indisponível")}
                </Badge>
              ))}
            <Button
              disabled={testing}
              onClick={() => void testPrinter()}
              size="sm"
              variant="secondary"
            >
              {testing ? "Testando…" : "Imprimir teste"}
            </Button>
          </div>
        )}
        <Separator />
        <label className="terminal-profile-toggle" htmlFor="terminal-profile-compact">
          <Checkbox
            checked={form.compact}
            id="terminal-profile-compact"
            onChange={(event) =>
              setForm((current) => ({ ...current, compact: event.target.checked }))
            }
          />
          <span>
            <strong>Interface compacta</strong>
            <small>Reduz espaços sem diminuir áreas de toque.</small>
          </span>
        </label>
        <fieldset className="terminal-profile-actions">
          <legend>Atalhos deste terminal</legend>
          {actions.map((action) => (
            <label htmlFor={`terminal-action-${action.value}`} key={action.value}>
              <Checkbox
                checked={form.quickActions.includes(action.value)}
                id={`terminal-action-${action.value}`}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    quickActions: event.target.checked
                      ? [...new Set([...current.quickActions, action.value])]
                      : current.quickActions.filter((candidate) => candidate !== action.value),
                  }))
                }
              />
              {action.label}
            </label>
          ))}
        </fieldset>
        {notice && (
          <p aria-live="polite" className="terminal-profile-notice">
            {notice}
          </p>
        )}
        <div className="terminal-profile-footer">
          <Button onClick={onClose} variant="ghost">
            Fechar
          </Button>
          <Button disabled={busy || form.label.trim().length === 0} onClick={() => void save()}>
            {busy ? "Salvando…" : "Salvar terminal"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
