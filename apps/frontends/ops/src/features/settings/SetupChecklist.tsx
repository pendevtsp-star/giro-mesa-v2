import type { ChannelCheck, EstablishmentSpecializedSettingsSummary } from "@giromesa/contracts";
import { Badge, Button, Icon, Input, Label, Modal, NativeSelect, Textarea } from "@giromesa/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { routeHref } from "../../router";
import { kdsAreaHref } from "../kds/kds.navigation";
import { setupChannelChecks } from "./settings";

export function SetupChecklist({
  summary,
  status,
  organizationId,
  unitId,
  onRefresh,
}: {
  summary: EstablishmentSpecializedSettingsSummary | null;
  status: "loading" | "ready" | "error";
  organizationId: string;
  unitId: string;
  onRefresh: () => void;
}) {
  const [checks, setChecks] = useState<ChannelCheck[]>([]);
  const [checksStatus, setChecksStatus] = useState<"loading" | "ready" | "error">("loading");
  const [editingChannel, setEditingChannel] = useState<ChannelCheck["channel"] | null>(null);
  const [checkResult, setCheckResult] = useState<"passed" | "failed">("passed");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [note, setNote] = useState("");
  const [checkError, setCheckError] = useState("");
  const [savingCheck, setSavingCheck] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const loadChecks = useCallback(async () => {
    setChecksStatus("loading");
    try {
      const response = await api.settings.channelChecks(organizationId, unitId);
      setChecks(response.checks);
      setChecksStatus("ready");
    } catch {
      setChecksStatus("error");
    }
  }, [organizationId, unitId]);
  useEffect(() => {
    void loadChecks();
  }, [loadChecks]);
  const setup = summary?.setup;
  const steps = setup
    ? [
        {
          id: "products",
          label: "Produtos e adicionais",
          done: setup.activeProducts > 0,
          detail: `${setup.activeProducts} produtos ativos. Importe seu cardápio por planilha e confira preços e adicionais.`,
          href: routeHref("catalog"),
          action: "Abrir cardápio",
        },
        {
          id: "people",
          label: "Acessos da equipe",
          done: setup.activePeople > 0,
          detail: `${setup.activePeople} pessoas com acesso. Confira as funções de cada colaborador e o acesso ao terminal.`,
          href: routeHref("people"),
          action: "Conferir equipe",
        },
        {
          id: "production",
          label: "Praça de produção criada",
          done: summary.kds.activeStations > 0,
          detail: `${summary.kds.activeStations} praças ativas. Confira também o vínculo de cada produto à cozinha, bar ou outro destino.`,
          href: kdsAreaHref("settings"),
          action: "Configurar produção",
        },
        {
          id: "service",
          label: "Percorrer um atendimento",
          done: setup.completedService,
          detail: setup.completedService
            ? "Há pedido servido com conta encerrada nesta unidade. Confira também divisão, cancelamento e fechamento de caixa."
            : "Lance um pedido, acompanhe a produção, marque como servido e encerre a conta no fluxo real.",
          href: routeHref("salon"),
          action: "Abrir atendimento",
        },
      ]
    : [];
  const completed = steps.filter((step) => step.done).length;
  const channelChecks = summary ? setupChannelChecks(summary) : [];
  const openChannelCheck = (channel: ChannelCheck["channel"]) => {
    const existing = checks.find((item) => item.channel === channel);
    setEditingChannel(channel);
    setCheckResult(existing?.status === "failed" ? "failed" : "passed");
    setEvidenceReference(existing?.evidenceReference ?? "");
    setNote(existing?.note ?? "");
    setCheckError("");
    setIdempotencyKey(crypto.randomUUID());
  };
  const saveChannelCheck = async () => {
    if (!editingChannel || savingCheck) return;
    setSavingCheck(true);
    setCheckError("");
    try {
      const saved = await api.settings.recordChannelCheck(
        organizationId,
        unitId,
        {
          channel: editingChannel,
          status: checkResult,
          evidenceReference: evidenceReference.trim(),
          note: note.trim(),
        },
        idempotencyKey,
      );
      setChecks((current) => [saved, ...current.filter((item) => item.channel !== saved.channel)]);
      setEditingChannel(null);
    } catch (error) {
      setCheckError(
        error instanceof Error ? error.message : "Não foi possível registrar a conferência.",
      );
    } finally {
      setSavingCheck(false);
    }
  };
  const manualStatusLabel = (check: ChannelCheck | undefined) => {
    if (!check || check.status === "not_tested") return "Não testado";
    return check.status === "passed" ? "Teste aprovado" : "Teste com falha";
  };
  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="setup-checklist"
      id="settings-setup"
    >
      <header>
        <div>
          <h2 id="setup-checklist-title">Prepare o primeiro turno</h2>
          <p>Uma sequência curta, conferida pelos dados da unidade.</p>
        </div>
        <Button
          aria-busy={status === "loading"}
          disabled={status === "loading"}
          onClick={() => {
            onRefresh();
            void loadChecks();
          }}
          size="sm"
          type="button"
          variant="secondary"
        >
          <Icon name="refresh" size={14} />{" "}
          {status === "loading" ? "Conferindo…" : "Conferir novamente"}
        </Button>
      </header>
      {status === "error" ? (
        <p role="alert">
          Não foi possível conferir a preparação. Tente novamente; nenhum item foi considerado
          concluído.
        </p>
      ) : status === "loading" ? (
        <p role="status">Consultando cardápio, equipe, produção e atendimentos…</p>
      ) : !setup ? (
        <p role="status">
          O servidor ainda não fornece a conferência inicial. As configurações abaixo continuam
          disponíveis.
        </p>
      ) : (
        <>
          <p className="setup-checklist__summary">
            <strong>
              {completed} de {steps.length}
            </strong>{" "}
            etapas com registro no sistema
          </p>
          <ol className="setup-checklist__steps">
            {steps.map((step) => (
              <li key={step.id}>
                <Icon name={step.done ? "check" : "chevron-right"} size={18} />
                <div>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </div>
                <Badge tone={step.done ? "success" : "warning"}>
                  {step.done ? "Registrado" : "A preparar"}
                </Badge>
                <a className="gm-button gm-button--secondary gm-button--sm" href={step.href}>
                  {step.action}
                </a>
              </li>
            ))}
          </ol>
          <details className="gm-disclosure">
            <summary>Canais e continuidade</summary>
            <ul className="setup-checklist__extras">
              <li>
                <div>
                  <strong>Mesas e ambientes</strong>
                  <p>
                    {setup.activeTables} mesas ativas. Configure se a casa trabalha com atendimento
                    à mesa.
                  </p>
                </div>
                <a href={routeHref("salon")}>Organizar salão</a>
              </li>
              {channelChecks.map((channel) => (
                <li key={channel.id}>
                  <div>
                    <strong>{channel.label}</strong>
                    <p>{channel.detail}</p>
                    {(() => {
                      const check = checks.find((item) => item.channel === channel.id);
                      return check?.checkedAt ? (
                        <p className="setup-checklist__manual-evidence">
                          <strong>Evidência:</strong> {check.evidenceReference} · {check.note}
                          <br />
                          {check.actorDisplayName ?? "Responsável não identificado"} ·{" "}
                          {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(check.checkedAt))}
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <div className="setup-checklist__channel-status">
                    <Badge
                      tone={
                        channel.ready === true
                          ? "success"
                          : channel.ready === false
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {channel.ready === true
                        ? "Configuração registrada"
                        : channel.ready === false
                          ? "Configuração pendente"
                          : "Sem diagnóstico automático"}
                    </Badge>
                    {(() => {
                      const check = checks.find((item) => item.channel === channel.id);
                      return (
                        <Badge
                          tone={
                            check?.status === "passed"
                              ? "success"
                              : check?.status === "failed"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {manualStatusLabel(check)}
                        </Badge>
                      );
                    })()}
                  </div>
                  <div className="setup-checklist__channel-actions">
                    <a href={routeHref(channel.href)}>Abrir canal</a>
                    <Button
                      disabled={checksStatus === "loading"}
                      onClick={() => openChannelCheck(channel.id)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Registrar teste
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {checksStatus === "error" && (
              <p role="alert">Não foi possível carregar as conferências manuais.</p>
            )}
          </details>
          <p className="setup-checklist__note">
            Cadastro não é homologação: pagamentos, emissão fiscal, impressoras e operação sem
            internet precisam de teste real e das liberações dos fornecedores.
          </p>
        </>
      )}
      <Modal
        isOpen={editingChannel !== null}
        onClose={() => !savingCheck && setEditingChannel(null)}
        title="Registrar conferência manual"
      >
        <div className="setup-checklist__check-form">
          <p>
            Registre somente um teste realmente executado. A configuração automática continua
            aparecendo separadamente.
          </p>
          <Label>
            Resultado
            <NativeSelect
              onChange={(event) => setCheckResult(event.target.value as "passed" | "failed")}
              value={checkResult}
            >
              <option value="passed">Aprovado no teste</option>
              <option value="failed">Falhou no teste</option>
            </NativeSelect>
          </Label>
          <Label>
            Protocolo ou referência da evidência
            <Input
              minLength={10}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="Ex.: pedido TESTE-2026-091"
              value={evidenceReference}
            />
          </Label>
          <Label>
            O que foi testado e próximo passo
            <Textarea
              minLength={10}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Descreva o cenário e, se falhou, quem deve corrigir."
              value={note}
            />
          </Label>
          {checkError && <p role="alert">{checkError}</p>}
          <div className="setup-checklist__check-actions">
            <Button disabled={savingCheck} onClick={() => setEditingChannel(null)} variant="ghost">
              Cancelar
            </Button>
            <Button
              disabled={
                savingCheck || evidenceReference.trim().length < 10 || note.trim().length < 10
              }
              onClick={() => void saveChannelCheck()}
            >
              {savingCheck ? "Registrando…" : "Registrar conferência"}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
