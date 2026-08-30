import { Badge, Button, Card, Input, Label, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { ApiClientError, api } from "../../api";
import { Brand } from "./Brand";

export function CreateOrganizationScreen({
  identityName,
  onBack,
  onCreated,
}: {
  identityName: string;
  onBack: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const document = String(data.get("document") ?? "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();
    try {
      await api.createSelfServiceOrganization({
        legalName: String(data.get("legalName") ?? "").trim(),
        tradeName: String(data.get("tradeName") ?? "").trim(),
        document,
        unitName: String(data.get("unitName") ?? "").trim(),
        timezone: String(data.get("timezone") ?? "America/Sao_Paulo"),
        planSlug: "operacao",
      });
      await onCreated();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError
          ? cause.message
          : "Não foi possível criar o estabelecimento. Tente novamente.",
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
        <Badge tone="success">14 dias grátis</Badge>
        <h1>Cadastre seu estabelecimento</h1>
        <p className="muted">
          Olá, {identityName}. Preencha os dados básicos e comece a usar o GiroMesa agora. Você
          escolhe o pacote depois do período de teste.
        </p>
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <Label>
            Razão social
            <Input name="legalName" autoComplete="organization" minLength={2} required />
          </Label>
          <Label>
            Nome do estabelecimento
            <Input name="tradeName" autoComplete="organization" minLength={2} required />
          </Label>
          <Label>
            CNPJ
            <Input
              name="document"
              inputMode="numeric"
              maxLength={18}
              pattern="[0-9A-Za-z./-]{14,18}"
              placeholder="00.000.000/0000-00"
              required
            />
          </Label>
          <Label>
            Nome da primeira unidade
            <Input name="unitName" autoComplete="organization" minLength={2} required />
          </Label>
          <Label>
            Fuso horário
            <NativeSelect defaultValue="America/Sao_Paulo" name="timezone">
              <option value="America/Sao_Paulo">Brasília (America/Sao_Paulo)</option>
              <option value="America/Manaus">Manaus (America/Manaus)</option>
              <option value="America/Belem">Belém (America/Belem)</option>
            </NativeSelect>
          </Label>
          {error && (
            <p className="auth-message auth-message--error" role="alert">
              {error}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? "Criando estabelecimento…" : "Começar meu teste grátis"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
