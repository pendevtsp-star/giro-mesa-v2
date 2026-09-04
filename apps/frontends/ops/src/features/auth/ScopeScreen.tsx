import { Badge, Button, Card, Label, NativeSelect } from "@giromesa/ui";
import { useEffect, useState } from "react";
import { ApiClientError } from "../../api";
import { sessionForScope } from "../../app/access";
import type { ScopeSource, Session } from "../../app/types";
import { profileIdForScope } from "../../auth";
import { ProfileAvatar as Avatar } from "../shell/ProfileAvatar";
import { Brand } from "./Brand";
import { type ConfigureTerminalPin, TerminalPinSetupForm } from "./TerminalPinSetupForm";
export function ScopeScreen({
  source,
  onBack,
  onComplete,
  onConfigurePin,
}: {
  source: ScopeSource;
  onBack: () => void;
  onComplete: (session: Session) => Promise<void> | void;
  onConfigurePin: ConfigureTerminalPin;
}) {
  const [organizationId, setOrganizationId] = useState(
    source.organizations[0]?.organization.id ?? "",
  );
  const access =
    source.organizations.find((item) => item.organization.id === organizationId) ??
    source.organizations[0];
  const accessibleUnits =
    access?.organization.units.filter((unit) => profileIdForScope(access, unit.id)) ?? [];
  const firstAccessibleUnitId = accessibleUnits[0]?.id ?? "";
  const [unitId, setUnitId] = useState(firstAccessibleUnitId);
  const [terminalMode, setTerminalMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedSession = sessionForScope(source, organizationId, unitId, terminalMode);
  const profile = selectedSession?.profile;

  useEffect(() => {
    setUnitId(firstAccessibleUnitId);
  }, [firstAccessibleUnitId]);

  async function openOperation() {
    if (!selectedSession) return;
    setBusy(true);
    setError("");
    try {
      await onComplete(selectedSession);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError ? cause.message : "Não foi possível abrir a operação.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="scope-screen">
      <div className="scope-screen__header">
        <Brand />
        <Button variant="ghost" onClick={onBack}>
          Sair
        </Button>
      </div>
      <Card className="scope-card">
        <Badge tone="success">Identidade verificada</Badge>
        <h1>Onde você vai trabalhar?</h1>
        <p className="muted">O GiroMesa limita dados e ações à empresa e unidade selecionadas.</p>
        <div className="scope-profile">
          {profile && <Avatar profile={profile} />}
          <span>
            <strong>{source.identityName}</strong>
            <small>{profile?.role ?? "Sem acesso nesta unidade"}</small>
          </span>
        </div>
        <div className="form-stack">
          <Label>
            Organização
            <NativeSelect
              value={organizationId}
              onChange={(event) => {
                const nextOrganizationId = event.target.value;
                const nextAccess = source.organizations.find(
                  (item) => item.organization.id === nextOrganizationId,
                );
                const nextUnit = nextAccess?.organization.units.find((unit) =>
                  profileIdForScope(nextAccess, unit.id),
                );
                setOrganizationId(nextOrganizationId);
                setUnitId(nextUnit?.id ?? "");
              }}
            >
              {source.organizations.map((item) => (
                <option key={item.organization.id} value={item.organization.id}>
                  {item.organization.name} · {item.organization.document}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            Unidade
            <NativeSelect value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              {accessibleUnits.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.city ? ` · ${item.city}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <label className="terminal-option">
            <input
              checked={terminalMode}
              onChange={(event) => setTerminalMode(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Este é um terminal compartilhado</strong>
              <small>
                Escolha do colaborador + PIN, bloqueio após 5 minutos e acesso apenas à operação
                desta unidade.
              </small>
            </span>
          </label>
          <details className="terminal-pin-setup">
            <summary>Configurar meu PIN de terminal</summary>
            <TerminalPinSetupForm
              membershipId={selectedSession?.membershipId ?? ""}
              onConfigure={onConfigurePin}
            />
          </details>
          {error && (
            <p className="auth-message auth-message--error" role="alert">
              {error}
            </p>
          )}
          <Button disabled={!selectedSession || busy} onClick={() => void openOperation()}>
            {busy ? "Abrindo..." : "Abrir operação"}
          </Button>
        </div>
      </Card>
    </main>
  );
}
