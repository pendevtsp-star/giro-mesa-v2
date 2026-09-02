import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  Input,
  Modal,
  NativeSelect,
  SegmentedTabs,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import {
  currencyToCents,
  dateLabel,
  type ManagementScope,
  operationalKey,
  RemoteGate,
  useRemote,
} from "../../management.shared";
import { formatMoney } from "../../rules";
import {
  defaultSettlementPeriod,
  type LossCandidate,
  type LossStatus,
  type OperationalLoss,
  type PartnershipPlan,
  type PartnershipTier,
  parseLossCandidates,
  parseSettlement,
  parseWaiterSettlementsOverview,
  type SettlementConfiguration,
  type SettlementStatus,
  type WaiterSettlement,
  type WaiterSettlementsOverview,
} from "./waiter-settlements";

type Area = "settlements" | "losses" | "partnership" | "settings";
type SettlementAction = "approve" | "pay" | "cancel";
type LossAction = "approve" | "reject" | "reverse";

const areaItems = [
  { id: "settlements", label: "Apurações" },
  { id: "losses", label: "Perdas" },
  { id: "partnership", label: "Partnership" },
  { id: "settings", label: "Regras" },
] satisfies Array<{ id: Area; label: string }>;

export function RealWaiterSettlementsPage({ scope }: { scope: ManagementScope }) {
  const remote = useRemote(scope, api.management.waiterSettlements, parseWaiterSettlementsOverview);
  const [area, setArea] = useState<Area>("settlements");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SegmentedTabs
        active={area}
        items={areaItems}
        label="Área do fechamento da equipe"
        onChange={setArea}
      />
      <RemoteGate remote={remote}>
        {(data) => (
          <>
            {area === "settlements" && (
              <SettlementsArea data={data} onRefresh={remote.retry} scope={scope} />
            )}
            {area === "losses" && <LossesArea data={data} onRefresh={remote.retry} scope={scope} />}
            {area === "partnership" && (
              <PartnershipArea data={data} onRefresh={remote.retry} scope={scope} />
            )}
            {area === "settings" && (
              <SettingsArea data={data} onRefresh={remote.retry} scope={scope} />
            )}
          </>
        )}
      </RemoteGate>
    </div>
  );
}

function SettlementsArea({
  data,
  onRefresh,
  scope,
}: {
  data: WaiterSettlementsOverview;
  onRefresh: () => void;
  scope: ManagementScope;
}) {
  const initial = defaultSettlementPeriod(data.configuration);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [operationalShiftId, setOperationalShiftId] = useState("");
  const [preview, setPreview] = useState<WaiterSettlement | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [transition, setTransition] = useState<{
    settlement: WaiterSettlement;
    action: SettlementAction;
  } | null>(null);

  async function loadPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const payload = await api.management.previewWaiterSettlement(
        scope.organizationId,
        scope.unitId,
        { from, to, operationalShiftId: operationalShiftId || undefined },
      );
      setPreview(parseSettlement(payload, true));
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createSettlement() {
    setBusy(true);
    setFeedback("");
    try {
      await api.management.createWaiterSettlement(
        scope.organizationId,
        scope.unitId,
        { from, to, operationalShiftId: operationalShiftId || undefined },
        operationalKey("waiter-settlement"),
      );
      setPreview(null);
      setFeedback("Fechamento gerado e registrado para conferência.");
      onRefresh();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCsv(settlement: WaiterSettlement) {
    if (!settlement.id) return;
    setBusy(true);
    setFeedback("");
    try {
      const file = await api.management.waiterSettlementExport(
        scope.organizationId,
        scope.unitId,
        settlement.id,
      );
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        file.filename ?? `fechamento-equipe-${settlement.periodFrom}-${settlement.periodTo}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setFeedback("CSV do fechamento baixado.");
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Conferir período</CardTitle>
          <CardDescription>
            Pré-visualize os valores antes de registrar o fechamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end"
            onSubmit={loadPreview}
          >
            <FormField htmlFor="settlement-from" label="Data inicial" required>
              <Input
                id="settlement-from"
                max={to}
                onChange={(event) => setFrom(event.target.value)}
                required
                type="date"
                value={from}
              />
            </FormField>
            <FormField htmlFor="settlement-to" label="Data final" required>
              <Input
                id="settlement-to"
                min={from}
                onChange={(event) => setTo(event.target.value)}
                required
                type="date"
                value={to}
              />
            </FormField>
            <FormField htmlFor="settlement-shift" label="Turno (opcional)">
              <NativeSelect
                id="settlement-shift"
                onChange={(event) => setOperationalShiftId(event.target.value)}
                value={operationalShiftId}
              >
                <option value="">Todos os turnos</option>
                {data.operationalShifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.label} ·{" "}
                    {shift.status === "active" ? "aberto" : dateLabel(shift.startsAt)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <Button disabled={busy || from > to} type="submit">
              {busy ? "Calculando…" : "Pré-visualizar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {feedback && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}

      {preview && (
        <SettlementCard
          actions={
            data.capabilities.canGenerate ? (
              <Button disabled={busy} onClick={() => void createSettlement()} size="sm">
                Gerar fechamento
              </Button>
            ) : null
          }
          settlement={preview}
          title="Prévia não persistida"
        />
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle>Fechamentos registrados</CardTitle>
            <CardDescription>
              Aprovação e pagamento usam a fotografia das regras vigente na geração.
            </CardDescription>
          </div>
          <Button className="print:hidden" onClick={() => window.print()} size="sm" variant="ghost">
            Imprimir / PDF
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.settlements.length ? (
            data.settlements.map((settlement) => (
              <SettlementCard
                actions={
                  <div className="flex flex-wrap gap-2 print:hidden">
                    {data.capabilities.canExport && (
                      <Button
                        disabled={busy}
                        onClick={() => void downloadCsv(settlement)}
                        size="sm"
                        variant="secondary"
                      >
                        CSV
                      </Button>
                    )}
                    {data.capabilities.canApprove && settlement.status === "closed" && (
                      <Button
                        onClick={() => setTransition({ settlement, action: "approve" })}
                        size="sm"
                      >
                        Aprovar
                      </Button>
                    )}
                    {data.capabilities.canPay && settlement.status === "approved" && (
                      <Button
                        onClick={() => setTransition({ settlement, action: "pay" })}
                        size="sm"
                      >
                        Marcar pago
                      </Button>
                    )}
                    {data.capabilities.canCancel &&
                      settlement.status !== "paid" &&
                      settlement.status !== "canceled" && (
                        <Button
                          onClick={() => setTransition({ settlement, action: "cancel" })}
                          size="sm"
                          variant="danger"
                        >
                          Cancelar
                        </Button>
                      )}
                  </div>
                }
                key={settlement.id ?? `${settlement.periodFrom}:${settlement.periodTo}`}
                settlement={settlement}
              />
            ))
          ) : (
            <EmptyState
              description="Faça uma prévia e gere o primeiro fechamento da equipe."
              icon="◇"
              title="Nenhum fechamento registrado"
            />
          )}
        </CardContent>
      </Card>

      <TransitionModal
        action={transition?.action ?? null}
        isOpen={transition !== null}
        onClose={() => setTransition(null)}
        onConfirm={async (note) => {
          if (!transition?.settlement.id) return;
          setBusy(true);
          try {
            await api.management.transitionWaiterSettlement(
              scope.organizationId,
              scope.unitId,
              transition.settlement.id,
              { action: transition.action, note },
              operationalKey(`waiter-settlement-${transition.action}`),
            );
            setFeedback("Situação do fechamento atualizada.");
            setTransition(null);
            onRefresh();
          } catch (error) {
            setFeedback(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
        target="fechamento"
      />
    </div>
  );
}

function SettlementCard({
  actions,
  settlement,
  title,
}: {
  actions?: React.ReactNode;
  settlement: WaiterSettlement;
  title?: string;
}) {
  const payable = settlement.lines.reduce((total, line) => total + line.payableCents, 0);
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle>
            {title ?? `${dateLabel(settlement.periodFrom)} a ${dateLabel(settlement.periodTo)}`}
          </CardTitle>
          <CardDescription>
            {settlement.lines.length} profissional(is) · Total {formatMoney(payable)}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SettlementStatusBadge status={settlement.status} />
          {actions}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {settlement.warnings.length > 0 && (
          <Alert className="mb-3">
            <AlertTitle>Confira antes de continuar</AlertTitle>
            <AlertDescription>{settlement.warnings.join(" ")}</AlertDescription>
          </Alert>
        )}
        {settlement.lines.length ? (
          <Table className="min-w-[1120px]">
            <TableHeader>
              <TableRow>
                <TableHead>Profissional</TableHead>
                <TableHead>Comandas / pedidos</TableHead>
                <TableHead>Venda bruta</TableHead>
                <TableHead>Descontos</TableHead>
                <TableHead>Venda líquida</TableHead>
                <TableHead>Recebido</TableHead>
                <TableHead>Serviço calculado</TableHead>
                <TableHead>Rateio do serviço</TableHead>
                <TableHead>Gorjetas</TableHead>
                <TableHead>Partnership</TableHead>
                <TableHead>Perdas (informativo)</TableHead>
                <TableHead>A pagar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlement.lines.map((line) => (
                <TableRow key={line.personId ?? line.personIdentityId}>
                  <TableCell>
                    <strong className="block font-medium">{line.personName}</strong>
                    <small className="text-muted-foreground">
                      {line.roleLabel ?? "Função não informada"}
                    </small>
                    {!line.eligibleForPayment && <Badge tone="neutral">Somente informativo</Badge>}
                  </TableCell>
                  <TableCell>
                    {line.tabCount} / {line.orderCount}
                  </TableCell>
                  <TableCell>{formatMoney(line.grossSalesCents)}</TableCell>
                  <TableCell>{formatMoney(line.discountCents)}</TableCell>
                  <TableCell>
                    {formatMoney(
                      Math.max(0, line.grossSalesCents - line.discountCents - line.canceledCents),
                    )}
                  </TableCell>
                  <TableCell>{formatMoney(line.receivedCents)}</TableCell>
                  <TableCell>{formatMoney(line.serviceChargeCents)}</TableCell>
                  <TableCell>{formatMoney(line.serviceShareCents)}</TableCell>
                  <TableCell>{formatMoney(line.tipCents)}</TableCell>
                  <TableCell>{formatMoney(line.partnershipCents)}</TableCell>
                  <TableCell>{formatMoney(line.operationalLossCents)}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(line.payableCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            description="Não há vendas atribuíveis no período selecionado."
            icon="◇"
            title="Apuração sem linhas"
          />
        )}
      </CardContent>
    </Card>
  );
}

function LossesArea({ data, onRefresh, scope }: AreaProps) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LossCandidate[]>([]);
  const [tabId, setTabId] = useState("");
  const [type, setType] = useState<"unpaid_tab" | "refund" | "chargeback" | "other">("unpaid_tab");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [decision, setDecision] = useState<{ loss: OperationalLoss; action: LossAction } | null>(
    null,
  );

  async function searchCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = await api.management.waiterSettlementLossCandidates(
        scope.organizationId,
        scope.unitId,
        query.trim(),
      );
      const items = parseLossCandidates(payload);
      setCandidates(items);
      setTabId(items[0]?.tabId ?? "");
      setFeedback(items.length ? "" : "Nenhuma comanda elegível encontrada.");
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createLoss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = amount.trim() ? currencyToCents(amount) : undefined;
    if (amountCents !== undefined && amountCents <= 0)
      return setFeedback("Informe um valor válido.");
    setBusy(true);
    try {
      await api.management.createWaiterOperationalLoss(
        scope.organizationId,
        scope.unitId,
        {
          tabId,
          type,
          reason: reason.trim(),
          ...(amountCents === undefined ? {} : { amountCents }),
        },
        operationalKey("operational-loss"),
      );
      setReason("");
      setAmount("");
      setFeedback("Perda operacional registrada para revisão.");
      onRefresh();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      {data.capabilities.canRecordLoss && (
        <Card>
          <CardHeader>
            <CardTitle>Registrar perda operacional</CardTitle>
            <CardDescription>
              Localize a comanda real; valores permanecem informativos na apuração.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={searchCandidates}>
              <Input
                aria-label="Buscar comanda ou mesa"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Comanda, mesa ou cliente"
                value={query}
              />
              <Button disabled={busy} type="submit" variant="secondary">
                Buscar
              </Button>
            </form>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={createLoss}>
              <FormField htmlFor="loss-tab" label="Comanda" required>
                <NativeSelect
                  id="loss-tab"
                  onChange={(event) => setTabId(event.target.value)}
                  required
                  value={tabId}
                >
                  <option value="">Selecione</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.tabId} value={candidate.tabId}>
                      {candidate.label} · saldo {formatMoney(candidate.unpaidCents)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField htmlFor="loss-type" label="Tipo" required>
                <NativeSelect
                  id="loss-type"
                  onChange={(event) => setType(event.target.value as typeof type)}
                  value={type}
                >
                  <option value="unpaid_tab">Mesa/comanda não paga</option>
                  <option value="refund">Estorno</option>
                  <option value="chargeback">Contestação</option>
                  <option value="other">Outro</option>
                </NativeSelect>
              </FormField>
              <FormField htmlFor="loss-amount" label="Valor específico (opcional)">
                <Input
                  id="loss-amount"
                  inputMode="decimal"
                  data-currency="brl"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="Usa o saldo da comanda quando vazio"
                  value={amount}
                />
              </FormField>
              <FormField htmlFor="loss-reason" label="Motivo" required>
                <Textarea
                  id="loss-reason"
                  minLength={3}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  value={reason}
                />
              </FormField>
              <Button
                className="md:col-span-2 md:justify-self-start"
                disabled={busy || !tabId || reason.trim().length < 3}
                type="submit"
              >
                Registrar perda
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      {feedback && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Perdas operacionais</CardTitle>
          <CardDescription>Ocorrências vinculadas à comanda, responsável e motivo.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {data.operationalLosses.length ? (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Comanda</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.operationalLosses.map((loss) => (
                  <TableRow key={loss.id}>
                    <TableCell>{loss.tabLabel}</TableCell>
                    <TableCell>{loss.responsibleName ?? "Não atribuído"}</TableCell>
                    <TableCell>{loss.reason}</TableCell>
                    <TableCell>{formatMoney(loss.amountCents)}</TableCell>
                    <TableCell>
                      <LossStatusBadge status={loss.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {data.capabilities.canReviewLoss && loss.status === "pending" && (
                          <>
                            <Button
                              onClick={() => setDecision({ loss, action: "approve" })}
                              size="sm"
                              variant="ghost"
                            >
                              Aprovar
                            </Button>
                            <Button
                              onClick={() => setDecision({ loss, action: "reject" })}
                              size="sm"
                              variant="ghost"
                            >
                              Rejeitar
                            </Button>
                          </>
                        )}
                        {data.capabilities.canReviewLoss && loss.status === "approved" && (
                          <Button
                            onClick={() => setDecision({ loss, action: "reverse" })}
                            size="sm"
                            variant="ghost"
                          >
                            Reverter
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              description="As ocorrências aprovadas ou pendentes aparecerão aqui."
              icon="◇"
              title="Nenhuma perda operacional"
            />
          )}
        </CardContent>
      </Card>
      <TransitionModal
        action={decision?.action ?? null}
        isOpen={decision !== null}
        onClose={() => setDecision(null)}
        onConfirm={async (note) => {
          if (!decision) return;
          setBusy(true);
          try {
            await api.management.decideWaiterOperationalLoss(
              scope.organizationId,
              scope.unitId,
              decision.loss.id,
              { action: decision.action, note },
              operationalKey(`operational-loss-${decision.action}`),
            );
            setDecision(null);
            setFeedback("Situação da perda atualizada.");
            onRefresh();
          } catch (error) {
            setFeedback(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
        target="perda operacional"
      />
    </div>
  );
}

function PartnershipArea({ data, onRefresh, scope }: AreaProps) {
  const initial: PartnershipPlan = data.partnershipPlan ?? {
    id: null,
    name: "Partnership",
    effectiveFrom: defaultSettlementPeriod(data.configuration).from,
    active: true,
    tiers: [{ minimumCents: 0, maximumCents: null, rewardType: "percentage", rewardValue: 0 }],
  };
  const [plan, setPlan] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  function updateTier(index: number, patch: Partial<PartnershipTier>) {
    setPlan((current) => ({
      ...current,
      tiers: current.tiers.map((tier, position) =>
        position === index ? { ...tier, ...patch } : tier,
      ),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      await api.management.updateWaiterPartnershipPlan(
        scope.organizationId,
        scope.unitId,
        { name: plan.name.trim(), effectiveFrom: plan.effectiveFrom, tiers: plan.tiers },
        operationalKey("partnership-plan"),
      );
      setFeedback("Plano de partnership salvo com nova vigência.");
      onRefresh();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plano de partnership</CardTitle>
        <CardDescription>Faixas contínuas e versionadas por data de vigência.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={save}>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="plan-name" label="Nome" required>
              <Input
                id="plan-name"
                minLength={2}
                onChange={(event) =>
                  setPlan((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={plan.name}
              />
            </FormField>
            <FormField htmlFor="plan-effective" label="Vigência inicial" required>
              <Input
                id="plan-effective"
                onChange={(event) =>
                  setPlan((current) => ({ ...current, effectiveFrom: event.target.value }))
                }
                required
                type="date"
                value={plan.effectiveFrom}
              />
            </FormField>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Início da faixa</TableHead>
                  <TableHead>Fim da faixa</TableHead>
                  <TableHead>Recompensa</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.tiers.map((tier, index) => (
                  <TableRow key={`tier-${tier.minimumCents}`}>
                    <TableCell>
                      <Input
                        aria-label={`Início da faixa ${index + 1}`}
                        inputMode="decimal"
                        data-currency="brl"
                        onChange={(event) =>
                          updateTier(index, {
                            minimumCents: Math.max(0, currencyToCents(event.target.value)),
                          })
                        }
                        value={formatMoney(tier.minimumCents).replace(/^R\$\s*/, "")}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Fim da faixa ${index + 1}`}
                        inputMode="decimal"
                        data-currency="brl"
                        onChange={(event) =>
                          updateTier(index, {
                            maximumCents: event.target.value.trim()
                              ? Math.max(0, currencyToCents(event.target.value))
                              : null,
                          })
                        }
                        placeholder="Sem limite"
                        value={
                          tier.maximumCents === null
                            ? ""
                            : formatMoney(tier.maximumCents).replace(/^R\$\s*/, "")
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        aria-label={`Tipo de recompensa ${index + 1}`}
                        onChange={(event) =>
                          updateTier(index, {
                            rewardType: event.target.value as PartnershipTier["rewardType"],
                          })
                        }
                        value={tier.rewardType}
                      >
                        <option value="percentage">Percentual</option>
                        <option value="fixed">Valor fixo</option>
                      </NativeSelect>
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Valor da recompensa ${index + 1}`}
                        inputMode="decimal"
                        data-currency={tier.rewardType === "fixed" ? "brl" : undefined}
                        onChange={(event) =>
                          updateTier(index, {
                            rewardValue:
                              tier.rewardType === "percentage"
                                ? Math.round(Number(event.target.value.replace(",", ".")) * 100)
                                : Math.max(0, currencyToCents(event.target.value)),
                          })
                        }
                        value={
                          tier.rewardType === "percentage"
                            ? String(tier.rewardValue / 100)
                            : formatMoney(tier.rewardValue).replace(/^R\$\s*/, "")
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        disabled={plan.tiers.length === 1}
                        onClick={() =>
                          setPlan((current) => ({
                            ...current,
                            tiers: current.tiers.filter((_, position) => position !== index),
                          }))
                        }
                        size="sm"
                        variant="ghost"
                      >
                        Remover
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={plan.tiers.at(-1)?.maximumCents === null}
              onClick={() =>
                setPlan((current) => {
                  const maximum = current.tiers.at(-1)?.maximumCents;
                  return maximum === null || maximum === undefined
                    ? current
                    : {
                        ...current,
                        tiers: [
                          ...current.tiers,
                          {
                            minimumCents: maximum + 1,
                            maximumCents: null,
                            rewardType: "percentage",
                            rewardValue: 0,
                          },
                        ],
                      };
                })
              }
              size="sm"
              variant="secondary"
            >
              Adicionar faixa
            </Button>
            {data.capabilities.canConfigure && (
              <Button disabled={busy || plan.name.trim().length < 2} size="sm" type="submit">
                Salvar plano
              </Button>
            )}
          </div>
          {feedback && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {feedback}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function SettingsArea({ data, onRefresh, scope }: AreaProps) {
  const [settings, setSettings] = useState<SettlementConfiguration>(data.configuration);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const update = <K extends keyof SettlementConfiguration>(
    key: K,
    value: SettlementConfiguration[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      await api.management.updateWaiterSettlementSettings(
        scope.organizationId,
        scope.unitId,
        settings,
        operationalKey("waiter-settlement-settings"),
      );
      setFeedback("Configurações do fechamento salvas.");
      onRefresh();
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Regras do fechamento</CardTitle>
        <CardDescription>
          Escolhas simples, aplicadas e fotografadas em cada apuração.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={save}>
          <div className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex min-h-10 items-center justify-between gap-3">
              <span>
                <strong className="block text-sm">Sugerir taxa de serviço</strong>
                <small className="text-muted-foreground">
                  Afeta somente novas comandas de mesa; retirada, balcão e delivery permanecem sem
                  taxa.
                </small>
              </span>
              <Switch
                aria-label="Sugerir taxa de serviço"
                checked={settings.serviceChargeEnabled}
                onCheckedChange={(checked) => update("serviceChargeEnabled", checked)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField htmlFor="default-service-charge" label="Percentual sugerido (%)">
                <Input
                  disabled={!settings.serviceChargeEnabled}
                  id="default-service-charge"
                  max={100}
                  min={0.01}
                  onChange={(event) =>
                    update(
                      "defaultServiceChargeBasisPoints",
                      Math.round(Number(event.target.value) * 100),
                    )
                  }
                  step="0.01"
                  type="number"
                  value={settings.defaultServiceChargeBasisPoints / 100}
                />
              </FormField>
              <SelectSetting
                id="service-charge-application"
                label="Aplicação em novas comandas"
                onChange={(value) =>
                  update(
                    "serviceChargeApplication",
                    value as SettlementConfiguration["serviceChargeApplication"],
                  )
                }
                value={settings.serviceChargeApplication}
                options={[
                  ["manual", "Somente quando aplicada manualmente"],
                  ["suggest_dine_in", "Sugerir automaticamente nas mesas"],
                ]}
              />
            </div>
            <small className="text-muted-foreground">
              A taxa é opcional para o cliente e pode ser retirada da comanda por usuário
              autorizado.
            </small>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <SelectSetting
              id="attribution-mode"
              label="Atribuir vendas por"
              onChange={(value) =>
                update("attributionMode", value as SettlementConfiguration["attributionMode"])
              }
              value={settings.attributionMode}
              options={[
                ["final_responsible", "Responsável final da comanda"],
                ["order_creator", "Quem lançou cada pedido"],
              ]}
            />
            <SelectSetting
              id="transfer-mode"
              label="Ao transferir a mesa"
              onChange={(value) =>
                update("transferMode", value as SettlementConfiguration["transferMode"])
              }
              value={settings.transferMode}
              options={[
                ["move_to_final", "Transferir tudo ao responsável final"],
                ["preserve_origin", "Preservar a origem dos pedidos"],
              ]}
            />
            <SelectSetting
              id="service-base"
              label="Base da taxa de serviço"
              onChange={(value) =>
                update("serviceBase", value as SettlementConfiguration["serviceBase"])
              }
              value={settings.serviceBase}
              options={[
                ["net_after_discounts", "Líquido após descontos"],
                ["gross", "Venda bruta"],
              ]}
            />
            <SelectSetting
              id="eligible-tabs"
              label="Comandas consideradas"
              onChange={(value) =>
                update("eligibleTabs", value as SettlementConfiguration["eligibleTabs"])
              }
              value={settings.eligibleTabs}
              options={[
                ["fully_paid", "Fechadas e totalmente recebidas"],
                ["closed", "Todas as fechadas"],
              ]}
            />
            <SelectSetting
              id="service-distribution"
              label="Rateio coletivo do serviço"
              onChange={(value) =>
                update(
                  "serviceDistribution",
                  value as SettlementConfiguration["serviceDistribution"],
                )
              }
              value={settings.serviceDistribution}
              options={[
                ["individual_sales", "Pelas vendas atribuídas"],
                ["equal_pool", "Igual entre a equipe elegível"],
              ]}
            />
            <FormField htmlFor="team-share" label="Parcela destinada à equipe (%)">
              <Input
                id="team-share"
                max={100}
                min={0}
                onChange={(event) =>
                  update(
                    "serviceTeamShareBasisPoints",
                    Math.round(Number(event.target.value) * 100),
                  )
                }
                step="0.01"
                type="number"
                value={settings.serviceTeamShareBasisPoints / 100}
              />
            </FormField>
            <SelectSetting
              id="partnership-base"
              label="Base do partnership"
              onChange={(value) =>
                update("partnershipBase", value as SettlementConfiguration["partnershipBase"])
              }
              value={settings.partnershipBase}
              options={[
                ["gross", "Bruta"],
                ["net", "Líquida"],
                ["received", "Recebida"],
                ["net_excluding_service", "Líquida sem taxa de serviço"],
              ]}
            />
            <SelectSetting
              id="tier-application"
              label="Aplicação das faixas"
              onChange={(value) =>
                update("tierApplication", value as SettlementConfiguration["tierApplication"])
              }
              value={settings.tierApplication}
              options={[
                ["all_revenue", "Faixa sobre toda a base"],
                ["progressive", "Progressiva por excedente"],
              ]}
            />
            <SelectSetting
              id="discount-treatment"
              label="Descontos"
              onChange={(value) =>
                update("discountTreatment", value as SettlementConfiguration["discountTreatment"])
              }
              value={settings.discountTreatment}
              options={[
                ["deduct", "Deduzir da base"],
                ["ignore", "Ignorar"],
              ]}
            />
            <SelectSetting
              id="cancellation-treatment"
              label="Cancelamentos"
              onChange={(value) =>
                update(
                  "cancellationTreatment",
                  value as SettlementConfiguration["cancellationTreatment"],
                )
              }
              value={settings.cancellationTreatment}
              options={[
                ["exclude", "Excluir"],
                ["deduct", "Deduzir da base"],
              ]}
            />
            <SelectSetting
              id="refund-treatment"
              label="Estornos"
              onChange={(value) =>
                update("refundTreatment", value as SettlementConfiguration["refundTreatment"])
              }
              value={settings.refundTreatment}
              options={[
                ["deduct", "Deduzir da base"],
                ["informational", "Somente informativo"],
              ]}
            />
            <SelectSetting
              id="period-mode"
              label="Período padrão"
              onChange={(value) =>
                update("periodMode", value as SettlementConfiguration["periodMode"])
              }
              value={settings.periodMode}
              options={[
                ["calendar_month", "Mês civil"],
                ["custom", "Ciclo personalizado"],
              ]}
            />
            {settings.periodMode === "custom" && (
              <FormField htmlFor="period-start" label="Dia inicial do ciclo">
                <Input
                  id="period-start"
                  max={28}
                  min={1}
                  onChange={(event) => update("customPeriodStartDay", Number(event.target.value))}
                  type="number"
                  value={settings.customPeriodStartDay}
                />
              </FormField>
            )}
          </div>
          <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <strong className="block text-sm">Somar vendas de todas as unidades</strong>
              <small className="text-muted-foreground">
                A apuração respeita o mesmo vínculo de organização.
              </small>
            </span>
            <Switch
              aria-label="Somar vendas de todas as unidades"
              checked={settings.aggregateAcrossUnits}
              onCheckedChange={(checked) => update("aggregateAcrossUnits", checked)}
            />
          </div>
          {data.capabilities.canConfigure ? (
            <Button
              className="justify-self-start"
              disabled={
                busy ||
                (settings.serviceChargeEnabled && settings.defaultServiceChargeBasisPoints <= 0)
              }
              type="submit"
            >
              {busy ? "Salvando…" : "Salvar configurações"}
            </Button>
          ) : (
            <Alert>
              <AlertTitle>Somente leitura</AlertTitle>
              <AlertDescription>
                Seu perfil pode consultar as regras, mas não alterá-las.
              </AlertDescription>
            </Alert>
          )}
          {feedback && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {feedback}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function SelectSetting({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <FormField htmlFor={id} label={label}>
      <NativeSelect id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

function TransitionModal({
  action,
  isOpen,
  onClose,
  onConfirm,
  target,
}: {
  action: SettlementAction | LossAction | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
  target: string;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const close = () => {
    setNote("");
    onClose();
  };
  return (
    <Modal
      description={`Registre o motivo para ${actionLabel(action).toLowerCase()} este ${target}.`}
      isOpen={isOpen}
      onClose={close}
      title={`${actionLabel(action)} ${target}`}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onConfirm(note.trim()).finally(() => {
            setBusy(false);
            setNote("");
          });
        }}
      >
        <FormField htmlFor="transition-note" label="Observação" required>
          <Textarea
            id="transition-note"
            minLength={2}
            onChange={(event) => setNote(event.target.value)}
            required
            value={note}
          />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button onClick={close} variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={busy || note.trim().length < 2}
            type="submit"
            variant={
              action === "cancel" || action === "reject" || action === "reverse"
                ? "danger"
                : "primary"
            }
          >
            {actionLabel(action)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type AreaProps = { data: WaiterSettlementsOverview; onRefresh: () => void; scope: ManagementScope };

function SettlementStatusBadge({ status }: { status: SettlementStatus | "preview" }) {
  const labels = {
    preview: "Prévia",
    closed: "Fechado",
    approved: "Aprovado",
    paid: "Pago",
    canceled: "Cancelado",
  } as const;
  return (
    <Badge
      tone={
        status === "paid"
          ? "success"
          : status === "canceled"
            ? "danger"
            : status === "approved"
              ? "info"
              : "warning"
      }
    >
      {labels[status]}
    </Badge>
  );
}

function LossStatusBadge({ status }: { status: LossStatus }) {
  const labels = {
    pending: "Pendente",
    approved: "Aprovada",
    rejected: "Rejeitada",
    reversed: "Revertida",
  } as const;
  return (
    <Badge tone={status === "approved" ? "success" : status === "pending" ? "warning" : "neutral"}>
      {labels[status]}
    </Badge>
  );
}

function actionLabel(action: SettlementAction | LossAction) {
  return {
    approve: "Aprovar",
    pay: "Marcar pago",
    cancel: "Cancelar",
    reject: "Rejeitar",
    reverse: "Reverter",
  }[action];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}
