// biome-ignore-all lint/a11y/noLabelWithoutControl: labels intentionally wrap native controls
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import { dateTime, type GrowthScope, RemoteGate, useRemote } from "../../growth.shared";
import { type RealtimeStatus, subscribeScopeRealtime } from "../../realtime";
import {
  type CrmAutomationExecution,
  type CrmAutomationRule,
  type CrmWhatsappConversation,
  type CrmWhatsappMessage,
  parseCrmAutomationExecutions,
  parseCrmAutomations,
  parseCrmEvolutionIntegration,
  parseCrmEvolutionQr,
  parseCrmQuickReplies,
  parseCrmWhatsappAssignees,
  parseCrmWhatsappConversation,
  parseCrmWhatsappInbox,
  parseCrmWhatsappMedia,
  parseCrmWhatsappMessages,
} from "./crm.model";
import { crmError } from "./crm.ui";

const automationDefaults: Record<
  CrmAutomationRule["trigger"],
  { label: string; message: string; delay: number; inactiveDays?: number }
> = {
  birthday: {
    label: "Aniversário",
    message: "Feliz aniversário, {nome}! Preparamos uma condição especial para você.",
    delay: 0,
  },
  inactive: {
    label: "Cliente inativo",
    message: "Olá, {nome}! Sentimos sua falta. Que tal voltar esta semana?",
    delay: 0,
    inactiveDays: 45,
  },
  post_visit: {
    label: "Pós-visita",
    message: "Obrigado pela visita, {nome}! Esperamos receber você novamente.",
    delay: 120,
  },
  no_show: {
    label: "No-show",
    message: "Olá, {nome}. Podemos ajudar a remarcar sua reserva?",
    delay: 30,
  },
  survey: {
    label: "Pesquisa",
    message: "Olá, {nome}! Como foi sua experiência conosco?",
    delay: 180,
  },
};

export async function requestEvolutionQr(
  configured: boolean,
  configure: () => Promise<unknown>,
  load: () => Promise<unknown>,
) {
  if (!configured) await configure();
  return parseCrmEvolutionQr(await load());
}

function AutomationEditor({
  scope,
  trigger,
  current,
  onSaved,
}: {
  scope: GrowthScope;
  trigger: CrmAutomationRule["trigger"];
  current?: CrmAutomationRule;
  onSaved: () => void;
}) {
  const defaults = automationDefaults[trigger];
  const [message, setMessage] = useState(current?.messageTemplate ?? defaults.message);
  const [delay, setDelay] = useState(String(current?.delayMinutes ?? defaults.delay));
  const [inactiveDays, setInactiveDays] = useState(
    String(current?.inactiveDays ?? defaults.inactiveDays ?? 45),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!current) return;
    setMessage(current.messageTemplate);
    setDelay(String(current.delayMinutes));
    setInactiveDays(String(current.inactiveDays ?? 45));
  }, [current]);
  async function save(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.growth.upsertCrmAutomation(scope.organizationId, {
        unitId: scope.unitId,
        trigger,
        enabled,
        delayMinutes: Number(delay),
        inactiveDays: trigger === "inactive" ? Number(inactiveDays) : null,
        messageTemplate: message.trim(),
      });
      onSaved();
    } catch (cause) {
      setError(crmError(cause, "Não foi possível salvar a automação."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="crm-automation-row">
      <summary>
        <span>
          <strong>{defaults.label}</strong>
          <small>{current?.enabled ? "Ativa" : "Desativada"}</small>
        </span>
        <Badge tone={current?.enabled ? "success" : "neutral"}>
          {current?.enabled ? "Ativa" : "Inativa"}
        </Badge>
      </summary>
      <div className="crm-automation-form">
        <label>
          Mensagem{" "}
          <Textarea
            value={message}
            maxLength={4096}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="crm-inline-fields">
          <label>
            Atraso (min){" "}
            <Input
              type="number"
              min="0"
              max="525600"
              value={delay}
              onChange={(event) => setDelay(event.target.value)}
            />
          </label>
          {trigger === "inactive" ? (
            <label>
              Sem visitar (dias){" "}
              <Input
                type="number"
                min="1"
                max="3650"
                value={inactiveDays}
                onChange={(event) => setInactiveDays(event.target.value)}
              />
            </label>
          ) : null}
        </div>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <div className="crm-button-row">
          <Button size="sm" disabled={busy || !message.trim()} onClick={() => void save(true)}>
            {busy ? "Salvando…" : "Salvar e ativar"}
          </Button>
          {current?.enabled ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save(false)}>
              Desativar
            </Button>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function CrmWhatsappWorkspace({ scope }: { scope: GrowthScope }) {
  const [inboxStatus, setInboxStatus] = useState<"open" | "pending" | "closed">("open");
  const [assignmentFilter, setAssignmentFilter] = useState<"any" | "me" | "unassigned">("any");
  const [search, setSearch] = useState("");
  const integration = useRemote(
    scope,
    () => api.growth.evolutionIntegration(scope.organizationId, scope.unitId),
    parseCrmEvolutionIntegration,
  );
  const inbox = useRemote(
    scope,
    () =>
      api.growth.whatsappInbox(scope.organizationId, scope.unitId, {
        status: inboxStatus,
        assignedTo: assignmentFilter,
        search: search.trim() || undefined,
      }),
    parseCrmWhatsappInbox,
    `${inboxStatus}:${assignmentFilter}:${search.trim()}`,
  );
  const automations = useRemote(
    scope,
    () => api.growth.crmAutomations(scope.organizationId, scope.unitId),
    parseCrmAutomations,
  );
  const executions = useRemote(
    scope,
    () => api.growth.crmAutomationExecutions(scope.organizationId, scope.unitId),
    parseCrmAutomationExecutions,
  );
  const quickReplies = useRemote(
    scope,
    () => api.growth.crmQuickReplies(scope.organizationId, scope.unitId),
    parseCrmQuickReplies,
  );
  const assignees = useRemote(
    scope,
    () => api.growth.whatsappAssignees(scope.organizationId, scope.unitId),
    parseCrmWhatsappAssignees,
  );
  const [selected, setSelected] = useState<CrmWhatsappConversation | null>(null);
  const [messages, setMessages] = useState<CrmWhatsappMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<{ at: string; id: string } | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [quickReplyTitle, setQuickReplyTitle] = useState("");
  const [quickReplyBody, setQuickReplyBody] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testRuleId, setTestRuleId] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [cap, setCap] = useState("4");

  useEffect(() => {
    if (integration.state.status !== "ready") return;
    setQuietStart(integration.state.data.config.quietHoursStart);
    setQuietEnd(integration.state.data.config.quietHoursEnd);
    setCap(String(integration.state.data.config.maxMessagesPer30Days));
  }, [integration.state]);

  const selectedId = selected?.id;
  useEffect(
    () =>
      subscribeScopeRealtime(
        { organizationId: scope.organizationId, unitId: scope.unitId },
        async () => {
          inbox.retry();
          executions.retry();
          if (selectedId) {
            const page = parseCrmWhatsappMessages(
              await api.growth.whatsappMessages(scope.organizationId, selectedId),
            );
            setMessages(page.items);
            setMessageCursor(page.nextCursor);
          }
          return true;
        },
        setRealtimeStatus,
        15_000,
        { shouldInvalidate: (event) => event.topic?.startsWith("growth.whatsapp_") === true },
      ),
    [scope.organizationId, scope.unitId, selectedId, inbox.retry, executions.retry],
  );

  async function openConversation(conversation: CrmWhatsappConversation) {
    setSelected(conversation);
    setBusy("messages");
    setFeedback("");
    try {
      const page = parseCrmWhatsappMessages(
        await api.growth.whatsappMessages(scope.organizationId, conversation.id),
      );
      setMessages(page.items);
      setMessageCursor(page.nextCursor);
      if (conversation.unreadCount > 0) {
        await api.growth.markWhatsappRead(scope.organizationId, conversation.id);
        inbox.retry();
      }
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível abrir a conversa."));
    } finally {
      setBusy("");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || (!messageBody.trim() && !attachment)) return;
    setBusy("send");
    setFeedback("");
    try {
      let media: { fileName: string; mimeType: string; base64: string } | undefined;
      if (attachment) {
        if (attachment.size > 3 * 1024 * 1024) throw new Error("O anexo deve ter no máximo 3 MB.");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Não foi possível ler o anexo."));
          reader.readAsDataURL(attachment);
        });
        media = {
          fileName: attachment.name,
          mimeType: attachment.type,
          base64: dataUrl.split(",", 2)[1] ?? "",
        };
      }
      await api.growth.sendWhatsappMessage(scope.organizationId, {
        unitId: scope.unitId,
        conversationId: selected.id,
        body: messageBody.trim() || undefined,
        media,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessageBody("");
      setAttachment(null);
      await openConversation(selected);
      inbox.retry();
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível enfileirar a mensagem."));
    } finally {
      setBusy("");
    }
  }

  async function loadOlderMessages() {
    if (!selected || !messageCursor) return;
    setBusy("older");
    try {
      const page = parseCrmWhatsappMessages(
        await api.growth.whatsappMessages(scope.organizationId, selected.id, messageCursor),
      );
      setMessages((current) => [...page.items, ...current]);
      setMessageCursor(page.nextCursor);
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível carregar mensagens anteriores."));
    } finally {
      setBusy("");
    }
  }

  async function updateConversation(
    patch: Omit<Parameters<typeof api.growth.updateWhatsappConversation>[2], "expectedUpdatedAt">,
  ) {
    if (!selected) return;
    setBusy("conversation");
    try {
      const updated = parseCrmWhatsappConversation(
        await api.growth.updateWhatsappConversation(scope.organizationId, selected.id, {
          ...patch,
          expectedUpdatedAt: selected.updatedAt,
        }),
      );
      const assignedIdentityName =
        assignees.state.status === "ready"
          ? (assignees.state.data.find((person) => person.id === updated.assignedIdentityId)
              ?.name ?? null)
          : selected.assignedIdentityName;
      setSelected({ ...updated, customerName: selected.customerName, assignedIdentityName });
      inbox.retry();
    } catch (error) {
      setFeedback(crmError(error, "A conversa mudou; atualize e tente novamente."));
      inbox.retry();
    } finally {
      setBusy("");
    }
  }

  async function openMedia(message: CrmWhatsappMessage) {
    if (!selected) return;
    try {
      const media = parseCrmWhatsappMedia(
        await api.growth.whatsappMessageMedia(scope.organizationId, selected.id, message.id),
      );
      const link = document.createElement("a");
      link.href = `data:${media.mimeType};base64,${media.base64}`;
      link.download = media.fileName;
      link.rel = "noopener";
      link.click();
    } catch (error) {
      setFeedback(crmError(error, "A mídia não está disponível."));
    }
  }

  async function saveQuickReply() {
    if (!quickReplyTitle.trim() || !quickReplyBody.trim()) return;
    setBusy("quick-reply");
    try {
      await api.growth.upsertCrmQuickReply(scope.organizationId, {
        unitId: scope.unitId,
        title: quickReplyTitle.trim(),
        body: quickReplyBody.trim(),
        active: true,
      });
      setQuickReplyTitle("");
      setQuickReplyBody("");
      quickReplies.retry();
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível salvar a resposta rápida."));
    } finally {
      setBusy("");
    }
  }

  async function retryExecution(execution: CrmAutomationExecution) {
    setBusy(`retry:${execution.id}`);
    try {
      await api.growth.retryCrmAutomationExecution(scope.organizationId, execution.id);
      executions.retry();
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível reenfileirar a automação."));
    } finally {
      setBusy("");
    }
  }

  async function loadMoreInbox() {
    if (inbox.state.status !== "ready" || !inbox.state.data.nextCursor) return;
    setBusy("inbox-more");
    try {
      const page = parseCrmWhatsappInbox(
        await api.growth.whatsappInbox(scope.organizationId, scope.unitId, {
          status: inboxStatus,
          assignedTo: assignmentFilter,
          search: search.trim() || undefined,
          cursorAt: inbox.state.data.nextCursor.at,
          cursorId: inbox.state.data.nextCursor.id,
        }),
      );
      inbox.update((current) => ({
        items: [...current.items, ...page.items],
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível carregar mais conversas."));
    } finally {
      setBusy("");
    }
  }

  async function testAutomation() {
    if (!testRuleId || !testPhone.trim()) return;
    setBusy("automation-test");
    try {
      await api.growth.testCrmAutomation(scope.organizationId, testRuleId, {
        unitId: scope.unitId,
        phone: testPhone.trim(),
      });
      setFeedback("Mensagem de teste enfileirada.");
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível enviar o teste."));
    } finally {
      setBusy("");
    }
  }

  async function configure() {
    setBusy("configure");
    setFeedback("");
    try {
      await api.growth.configureEvolution(scope.organizationId, {
        unitId: scope.unitId,
        enabled: true,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        maxMessagesPer30Days: Number(cap),
      });
      integration.retry();
      setFeedback("Configuração salva. Leia o QR Code para concluir o login.");
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível configurar a Evolution Go."));
    } finally {
      setBusy("");
    }
  }

  async function loadQr(configured: boolean) {
    setBusy("qr");
    setFeedback("");
    try {
      const result = await requestEvolutionQr(
        configured,
        () =>
          api.growth.configureEvolution(scope.organizationId, {
            unitId: scope.unitId,
            enabled: true,
            quietHoursStart: quietStart,
            quietHoursEnd: quietEnd,
            maxMessagesPer30Days: Number(cap),
          }),
        () => api.growth.evolutionQr(scope.organizationId, scope.unitId),
      );
      setQr(result.qrDataUrl);
      integration.retry();
      if (result.ready) setFeedback("WhatsApp conectado; nenhum QR Code é necessário.");
    } catch (error) {
      setFeedback(crmError(error, "Não foi possível obter o QR Code."));
    } finally {
      setBusy("");
    }
  }

  async function connectionAction(action: "reconnect" | "logout") {
    setBusy(action);
    setFeedback("");
    try {
      await api.growth.evolutionAction(scope.organizationId, scope.unitId, action);
      setQr(null);
      integration.retry();
      setFeedback(action === "logout" ? "Sessão desconectada." : "Reconexão solicitada.");
    } catch (error) {
      setFeedback(crmError(error, "A Evolution Go não concluiu a ação."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="crm-whatsapp-section" aria-labelledby="crm-whatsapp-title">
      <div className="crm-section-heading">
        <div>
          <p className="eyebrow">WhatsApp operacional</p>
          <h2 id="crm-whatsapp-title">Inbox e automações</h2>
          <p>
            Mensagens persistidas por unidade, com consentimento, limites e rastreio de campanha.
          </p>
        </div>
        <Badge tone={realtimeStatus === "live" ? "success" : "warning"}>
          {realtimeStatus === "live"
            ? "Tempo real"
            : realtimeStatus === "polling"
              ? "Atualização periódica"
              : "Conectando"}
        </Badge>
      </div>
      {feedback ? (
        <Callout tone={feedback.includes("não") || feedback.includes("Não") ? "danger" : "info"}>
          {feedback}
        </Callout>
      ) : null}
      <div className="crm-whatsapp-grid">
        <Card className="crm-evolution-card">
          <RemoteGate remote={integration}>
            {(value) => (
              <>
                <div className="crm-card-heading">
                  <div>
                    <strong>Evolution Go</strong>
                    <small>
                      {value.connectedNumber
                        ? `+${value.connectedNumber}`
                        : "Nenhum número conectado"}
                    </small>
                  </div>
                  <Badge
                    tone={value.ready ? "success" : value.status === "error" ? "danger" : "warning"}
                  >
                    {value.ready ? "Conectado" : value.status}
                  </Badge>
                </div>
                {value.config.lastErrorCode ? (
                  <Callout tone="danger">Falha registrada: {value.config.lastErrorCode}</Callout>
                ) : null}
                {scope.profileId === "owner" ? (
                  <>
                    <div className="crm-inline-fields">
                      <label>
                        Silêncio inicia{" "}
                        <Input
                          type="time"
                          value={quietStart}
                          onChange={(event) => setQuietStart(event.target.value)}
                        />
                      </label>
                      <label>
                        Silêncio termina{" "}
                        <Input
                          type="time"
                          value={quietEnd}
                          onChange={(event) => setQuietEnd(event.target.value)}
                        />
                      </label>
                      <label>
                        Limite/30 dias{" "}
                        <Input
                          type="number"
                          min="1"
                          max="30"
                          value={cap}
                          onChange={(event) => setCap(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="crm-button-row">
                      <Button
                        size="sm"
                        disabled={busy === "configure"}
                        onClick={() => void configure()}
                      >
                        {busy === "configure" ? "Salvando…" : "Salvar conexão"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === "qr"}
                        onClick={() => void loadQr(value.configured)}
                      >
                        {busy === "qr" ? "Carregando…" : "Exibir QR Code"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.growth
                            .evolutionStatus(scope.organizationId, scope.unitId)
                            .then(() => integration.retry())
                            .catch((error) =>
                              setFeedback(crmError(error, "Não foi possível atualizar o status.")),
                            )
                        }
                      >
                        Atualizar status
                      </Button>
                      {value.configured ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === "reconnect"}
                          onClick={() => void connectionAction("reconnect")}
                        >
                          {busy === "reconnect" ? "Reconectando…" : "Reconectar"}
                        </Button>
                      ) : null}
                      {value.configured ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy === "logout"}
                          onClick={() => void connectionAction("logout")}
                        >
                          {busy === "logout" ? "Desconectando…" : "Desconectar"}
                        </Button>
                      ) : null}
                    </div>
                    {qr ? (
                      <div className="crm-qr">
                        <img src={qr} alt="QR Code para conectar o WhatsApp desta unidade" />
                        <p>
                          Abra o WhatsApp no celular, acesse aparelhos conectados e leia este
                          código.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Callout tone="info">
                    Somente o proprietário pode conectar ou trocar o número.
                  </Callout>
                )}
              </>
            )}
          </RemoteGate>
        </Card>
        <Card className="crm-inbox-card">
          <h3>Conversas</h3>
          <div className="crm-inbox-filters">
            <Input
              aria-label="Buscar conversas"
              placeholder="Nome ou telefone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <NativeSelect
              aria-label="Status da conversa"
              value={inboxStatus}
              onChange={(event) =>
                setInboxStatus(event.target.value as "open" | "pending" | "closed")
              }
            >
              <option value="open">Abertas</option>
              <option value="pending">Pendentes</option>
              <option value="closed">Encerradas</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Responsável pela conversa"
              value={assignmentFilter}
              onChange={(event) =>
                setAssignmentFilter(event.target.value as "any" | "me" | "unassigned")
              }
            >
              <option value="any">Toda a equipe</option>
              <option value="me">Minhas</option>
              <option value="unassigned">Sem responsável</option>
            </NativeSelect>
          </div>
          <RemoteGate remote={inbox}>
            {(page) =>
              page.items.length === 0 ? (
                <EmptyState
                  title="Nenhuma conversa"
                  description="As mensagens recebidas aparecerão aqui após a conexão."
                  icon={<Icon name="crm" size={28} />}
                />
              ) : (
                <div className="crm-inbox-list">
                  {page.items.map((conversation) => (
                    <button
                      type="button"
                      className={selected?.id === conversation.id ? "is-selected" : ""}
                      key={conversation.id}
                      onClick={() => void openConversation(conversation)}
                    >
                      <span>
                        <strong>{conversation.customerName ?? `+${conversation.phone}`}</strong>
                        <small>
                          {conversation.lastMessageAt
                            ? dateTime(conversation.lastMessageAt)
                            : "Sem mensagem"}
                          {conversation.assignedIdentityName
                            ? ` · ${conversation.assignedIdentityName}`
                            : " · sem responsável"}
                        </small>
                      </span>
                      <span>
                        {conversation.priority !== "normal" ? (
                          <Badge tone={conversation.priority === "urgent" ? "danger" : "warning"}>
                            {conversation.priority}
                          </Badge>
                        ) : null}
                        {conversation.unreadCount > 0 ? (
                          <Badge tone="info">{conversation.unreadCount}</Badge>
                        ) : null}
                      </span>
                    </button>
                  ))}
                  {page.nextCursor ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === "inbox-more"}
                      onClick={() => void loadMoreInbox()}
                    >
                      {busy === "inbox-more" ? "Carregando…" : "Carregar mais"}
                    </Button>
                  ) : null}
                </div>
              )
            }
          </RemoteGate>
        </Card>
        <Card className="crm-thread-card">
          <h3>
            {selected ? (selected.customerName ?? `+${selected.phone}`) : "Selecione uma conversa"}
          </h3>
          {busy === "messages" ? (
            <p role="status">Carregando mensagens…</p>
          ) : selected ? (
            <>
              <div className="crm-conversation-controls">
                <NativeSelect
                  aria-label="Status"
                  disabled={busy === "conversation"}
                  value={selected.status}
                  onChange={(event) =>
                    void updateConversation({
                      status: event.target.value as "open" | "pending" | "closed",
                    })
                  }
                >
                  <option value="open">Aberta</option>
                  <option value="pending">Pendente</option>
                  <option value="closed">Encerrada</option>
                </NativeSelect>
                <NativeSelect
                  aria-label="Prioridade"
                  disabled={busy === "conversation"}
                  value={selected.priority}
                  onChange={(event) =>
                    void updateConversation({
                      priority: event.target.value as "low" | "normal" | "high" | "urgent",
                    })
                  }
                >
                  <option value="low">Baixa</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </NativeSelect>
                <RemoteGate remote={assignees}>
                  {(people) => (
                    <NativeSelect
                      aria-label="Responsável"
                      disabled={busy === "conversation"}
                      value={selected.assignedIdentityId ?? ""}
                      onChange={(event) =>
                        void updateConversation({
                          assignedIdentityId: event.target.value || null,
                        })
                      }
                    >
                      <option value="">Sem responsável</option>
                      {people.map((person) => (
                        <option value={person.id} key={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </RemoteGate>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "conversation"}
                  onClick={() => void updateConversation({ slaMinutes: 15 })}
                >
                  SLA 15 min
                </Button>
                {selected.slaDueAt ? (
                  <small className={new Date(selected.slaDueAt) < new Date() ? "is-overdue" : ""}>
                    SLA {dateTime(selected.slaDueAt)}
                  </small>
                ) : null}
              </div>
              <div className="crm-thread" aria-live="polite">
                {messageCursor ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === "older"}
                    onClick={() => void loadOlderMessages()}
                  >
                    {busy === "older" ? "Carregando…" : "Mensagens anteriores"}
                  </Button>
                ) : null}
                {messages.map((message) => (
                  <article
                    className={message.direction === "outbound" ? "is-outbound" : "is-inbound"}
                    key={message.id}
                  >
                    <p>{message.body || `[${message.contentKind}]`}</p>
                    {message.mediaMimeType ? (
                      <Button size="sm" variant="ghost" onClick={() => void openMedia(message)}>
                        Baixar {message.mediaFileName ?? message.contentKind}
                      </Button>
                    ) : message.mediaErrorCode ? (
                      <small>Mídia indisponível: {message.mediaErrorCode}</small>
                    ) : null}
                    <small>
                      {dateTime(message.occurredAt)} · {message.status}
                    </small>
                  </article>
                ))}
              </div>
              <form className="crm-reply" onSubmit={sendMessage}>
                <label htmlFor="crm-reply-body">Responder</label>
                <RemoteGate remote={quickReplies}>
                  {(replies) => (
                    <NativeSelect
                      aria-label="Resposta rápida"
                      defaultValue=""
                      onChange={(event) => {
                        const reply = replies.find((item) => item.id === event.target.value);
                        if (reply) setMessageBody(reply.body);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Usar resposta rápida…</option>
                      {replies
                        .filter((reply) => reply.active)
                        .map((reply) => (
                          <option value={reply.id} key={reply.id}>
                            {reply.title}
                          </option>
                        ))}
                    </NativeSelect>
                  )}
                </RemoteGate>
                <Textarea
                  id="crm-reply-body"
                  value={messageBody}
                  maxLength={4096}
                  onChange={(event) => setMessageBody(event.target.value)}
                />
                <label>
                  Anexo (imagem, áudio, vídeo ou PDF; até 3 MB)
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4,audio/ogg,audio/wav,video/mp4,application/pdf"
                    onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                  />
                </label>
                <Button
                  type="submit"
                  disabled={busy === "send" || (!messageBody.trim() && !attachment)}
                >
                  {busy === "send" ? "Enfileirando…" : "Enfileirar envio"}
                </Button>
              </form>
            </>
          ) : (
            <EmptyState
              title="Inbox persistida"
              description="Escolha uma conversa para consultar a linha do tempo e responder."
              icon={<Icon name="crm" size={28} />}
            />
          )}
        </Card>
      </div>
      <Card className="crm-automations-card">
        <div className="crm-card-heading">
          <div>
            <strong>Automações</strong>
            <small>
              Frequência máxima e horário de silêncio são aplicados antes de cada disparo.
            </small>
          </div>
        </div>
        <RemoteGate remote={automations}>
          {(rules) => (
            <div className="crm-automation-list">
              {(Object.keys(automationDefaults) as CrmAutomationRule["trigger"][]).map(
                (trigger) => (
                  <AutomationEditor
                    key={trigger}
                    scope={scope}
                    trigger={trigger}
                    current={rules.find((rule) => rule.trigger === trigger)}
                    onSaved={automations.retry}
                  />
                ),
              )}
            </div>
          )}
        </RemoteGate>
        <div className="crm-automation-tools">
          <h3>Teste controlado</h3>
          <RemoteGate remote={automations}>
            {(rules) => (
              <NativeSelect
                aria-label="Automação para testar"
                value={testRuleId}
                onChange={(event) => setTestRuleId(event.target.value)}
              >
                <option value="">Selecione uma automação</option>
                {rules.map((rule) => (
                  <option value={rule.id} key={rule.id}>
                    {automationDefaults[rule.trigger].label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </RemoteGate>
          <Input
            aria-label="Telefone do teste"
            inputMode="tel"
            placeholder="Telefone com DDD"
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === "automation-test" || !testRuleId || !testPhone.trim()}
            onClick={() => void testAutomation()}
          >
            {busy === "automation-test" ? "Enfileirando…" : "Enviar teste identificado"}
          </Button>
        </div>
        <div className="crm-automation-tools">
          <h3>Execuções recentes</h3>
          <RemoteGate remote={executions}>
            {(value) => (
              <>
                <div className="crm-execution-summary">
                  {Object.entries(value.summary).map(([status, total]) => (
                    <Badge
                      tone={
                        status === "failed" ? "danger" : status === "sent" ? "success" : "neutral"
                      }
                      key={status}
                    >
                      {status}: {total}
                    </Badge>
                  ))}
                </div>
                {value.items.length ? (
                  <div className="crm-execution-list">
                    {value.items.map((execution) => (
                      <article key={execution.id}>
                        <span>
                          <strong>{execution.customerName}</strong>
                          <small>
                            {automationDefaults[execution.trigger].label} ·{" "}
                            {dateTime(execution.createdAt)}
                          </small>
                          {execution.reason ? <small>{execution.reason}</small> : null}
                        </span>
                        <Badge
                          tone={
                            execution.status === "failed"
                              ? "danger"
                              : execution.status === "sent"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {execution.status}
                        </Badge>
                        {execution.status === "failed" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy === `retry:${execution.id}`}
                            onClick={() => void retryExecution(execution)}
                          >
                            Tentar novamente
                          </Button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>Nenhuma execução registrada.</p>
                )}
              </>
            )}
          </RemoteGate>
        </div>
        <div className="crm-automation-tools">
          <h3>Respostas rápidas</h3>
          <div className="crm-inline-fields">
            <Input
              aria-label="Título da resposta rápida"
              placeholder="Ex.: Horário de funcionamento"
              value={quickReplyTitle}
              onChange={(event) => setQuickReplyTitle(event.target.value)}
            />
            <Textarea
              aria-label="Texto da resposta rápida"
              placeholder="Mensagem pronta"
              value={quickReplyBody}
              onChange={(event) => setQuickReplyBody(event.target.value)}
            />
            <Button
              size="sm"
              disabled={busy === "quick-reply" || !quickReplyTitle.trim() || !quickReplyBody.trim()}
              onClick={() => void saveQuickReply()}
            >
              Salvar resposta
            </Button>
          </div>
          <RemoteGate remote={quickReplies}>
            {(replies) => (
              <div className="crm-execution-list">
                {replies.map((reply) => (
                  <article key={reply.id}>
                    <span>
                      <strong>{reply.title}</strong>
                      <small>{reply.body}</small>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setQuickReplyTitle(reply.title);
                        setQuickReplyBody(reply.body);
                      }}
                    >
                      Duplicar
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        void api.growth
                          .deleteCrmQuickReply(scope.organizationId, reply.id)
                          .then(() => quickReplies.retry())
                          .catch((error) =>
                            setFeedback(crmError(error, "Não foi possível excluir a resposta.")),
                          )
                      }
                    >
                      Excluir
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </RemoteGate>
        </div>
      </Card>
    </section>
  );
}
