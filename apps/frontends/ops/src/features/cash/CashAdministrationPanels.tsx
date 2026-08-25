// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, Input, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useEffect, useState } from "react";
import { api } from "../../api";
import {
  type CashData,
  type CashShift,
  currencyToCents,
  dateLabel,
  type ManagementScope,
  operationalKey,
} from "../../management.shared";
import { formatMoney } from "../../rules";

function approvalLabel(kind: "supply" | "withdrawal" | "transfer") {
  return kind === "supply" ? "Suprimento" : kind === "transfer" ? "Transferência" : "Sangria";
}

export function CashAdministrationPanels({
  data,
  online,
  openShift,
  scope,
  onChanged,
}: {
  data: CashData;
  online: boolean;
  openShift: CashShift | undefined;
  scope: ManagementScope;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [handoverIdentityId, setHandoverIdentityId] = useState("");
  const [handoverReason, setHandoverReason] = useState("");
  const [approvalNote, setApprovalNote] = useState("");
  const [transferDecisionNote, setTransferDecisionNote] = useState("");
  const [movementThreshold, setMovementThreshold] = useState("");
  const [differenceThreshold, setDifferenceThreshold] = useState("");
  const [maxShiftMinutes, setMaxShiftMinutes] = useState("");

  useEffect(() => {
    setMovementThreshold((data.settings.movementApprovalThresholdCents / 100).toFixed(2));
    setDifferenceThreshold((data.settings.discrepancyCriticalThresholdCents / 100).toFixed(2));
    setMaxShiftMinutes(String(data.settings.maxShiftMinutes));
  }, [data.settings]);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    if (!online) {
      setNotice("Reconecte para alterar os controles do caixa.");
      return false;
    }
    setBusy(key);
    setNotice("");
    try {
      await action();
      setNotice(success);
      onChanged();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir a ação.");
      return false;
    } finally {
      setBusy("");
    }
  }

  function handover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openShift || !handoverIdentityId || handoverReason.trim().length < 3) return;
    void run(
      "handover",
      () =>
        api.management.handoverCashShift(
          scope.organizationId,
          scope.unitId,
          openShift.id,
          { toIdentityId: handoverIdentityId, reason: handoverReason.trim() },
          operationalKey("cash-handover"),
        ),
      "Responsabilidade transferida e auditada.",
    ).then((changed) => {
      if (changed) {
        setHandoverIdentityId("");
        setHandoverReason("");
      }
    });
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const movementApprovalThresholdCents = currencyToCents(movementThreshold);
    const discrepancyCriticalThresholdCents = currencyToCents(differenceThreshold);
    const parsedMaxShiftMinutes = Number.parseInt(maxShiftMinutes, 10);
    if (
      movementApprovalThresholdCents < 0 ||
      discrepancyCriticalThresholdCents < 0 ||
      !Number.isInteger(parsedMaxShiftMinutes) ||
      parsedMaxShiftMinutes < 30
    ) {
      setNotice("Revise os limites informados.");
      return;
    }
    void run(
      "settings",
      () =>
        api.management.updateCashSettings(
          scope.organizationId,
          scope.unitId,
          {
            movementApprovalThresholdCents,
            discrepancyCriticalThresholdCents,
            maxShiftMinutes: parsedMaxShiftMinutes,
          },
          operationalKey("cash-settings"),
        ),
      "Política de caixa atualizada.",
    );
  }

  function decideTransfer(cashTransferId: string, decision: "accept" | "reject") {
    const note = transferDecisionNote.trim();
    if (decision === "reject" && note.length < 3) {
      setNotice("Informe o motivo da rejeição.");
      return;
    }
    void run(
      `transfer:${decision}:${cashTransferId}`,
      () =>
        api.management.decideCashTransfer(
          scope.organizationId,
          scope.unitId,
          cashTransferId,
          { decision, note: note || undefined },
          operationalKey(`cash-transfer-${decision}`),
        ),
      decision === "accept"
        ? "Transferência aceita e registrada nas duas gavetas."
        : "Transferência rejeitada.",
    ).then((changed) => {
      if (changed) setTransferDecisionNote("");
    });
  }

  const pendingApprovals = data.approvals.filter((approval) => approval.status === "pending");
  return (
    <>
      {data.alerts.length > 0 && (
        <Card className="cash-alerts">
          <div className="card-header">
            <div>
              <p className="eyebrow">Atenção operacional</p>
              <h2>Alertas do caixa</h2>
            </div>
            <Badge tone="warning">{data.alerts.length}</Badge>
          </div>
          <div className="cash-alert-list">
            {data.alerts.map((alert) => (
              <p key={`${alert.code}:${alert.cashShiftId ?? alert.installationId ?? "unit"}`}>
                <Badge tone={alert.severity === "critical" ? "danger" : "warning"}>
                  {alert.severity === "critical" ? "Crítico" : "Atenção"}
                </Badge>
                <span>{alert.message}</span>
              </p>
            ))}
          </div>
        </Card>
      )}

      {openShift && data.capabilities.canHandover && (
        <details className="action-panel">
          <summary>
            <span>
              <strong>Transferir responsabilidade</strong>
              <small>
                Responsável atual: {openShift.responsibleName ?? openShift.operatorName}.
              </small>
            </span>
            <span aria-hidden="true">+</span>
          </summary>
          <form className="action-form" onSubmit={handover}>
            <label>
              Novo responsável
              <NativeSelect
                onChange={(event) => setHandoverIdentityId(event.target.value)}
                required
                value={handoverIdentityId}
              >
                <option value="">Selecione</option>
                {data.operators
                  .filter(
                    (operator) => operator.identityId !== openShift.currentResponsibleIdentityId,
                  )
                  .map((operator) => (
                    <option key={operator.identityId} value={operator.identityId}>
                      {operator.name}
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label className="action-form__wide">
              Motivo
              <Input
                minLength={3}
                onChange={(event) => setHandoverReason(event.target.value)}
                required
                value={handoverReason}
              />
            </label>
            <Button disabled={Boolean(busy) || !online} type="submit">
              {busy === "handover" ? "Transferindo…" : "Confirmar transferência"}
            </Button>
          </form>
        </details>
      )}

      {data.pendingTransfers.length > 0 && (
        <Card className="cash-approvals">
          <div className="card-header">
            <div>
              <p className="eyebrow">Custódia entre gavetas</p>
              <h2>Transferências aguardando aceite</h2>
            </div>
            <Badge tone="warning">{data.pendingTransfers.length}</Badge>
          </div>
          <label>
            Observação da decisão
            <Input
              onChange={(event) => setTransferDecisionNote(event.target.value)}
              value={transferDecisionNote}
            />
          </label>
          <div className="cash-approval-list">
            {data.pendingTransfers.map((transfer) => (
              <div className="cash-approval" key={transfer.id}>
                <span>
                  <strong>
                    {transfer.fromCashRegisterName} → {transfer.toCashRegisterName} ·{" "}
                    {formatMoney(transfer.amountCents)}
                  </strong>
                  <small>
                    {transfer.requestedByName} · {dateLabel(transfer.requestedAt)} ·{" "}
                    {transfer.reason}
                  </small>
                </span>
                {transfer.canDecide ? (
                  <span className="cash-approval__actions">
                    <Button
                      disabled={Boolean(busy) || !online}
                      onClick={() => decideTransfer(transfer.id, "accept")}
                      size="sm"
                      type="button"
                    >
                      Aceitar
                    </Button>
                    <Button
                      disabled={Boolean(busy) || !online || transferDecisionNote.trim().length < 3}
                      onClick={() => decideTransfer(transfer.id, "reject")}
                      size="sm"
                      type="button"
                      variant="danger"
                    >
                      Rejeitar
                    </Button>
                  </span>
                ) : (
                  <Badge tone="neutral">Aguardando responsável do destino</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.capabilities.canApproveCashRequests && pendingApprovals.length > 0 && (
        <Card className="cash-approvals">
          <div className="card-header">
            <div>
              <p className="eyebrow">Alçada gerencial</p>
              <h2>Movimentos aguardando decisão</h2>
            </div>
            <Badge tone="warning">{pendingApprovals.length}</Badge>
          </div>
          <label>
            Observação da decisão
            <Input onChange={(event) => setApprovalNote(event.target.value)} value={approvalNote} />
          </label>
          <div className="cash-approval-list">
            {pendingApprovals.map((approval) => (
              <div className="cash-approval" key={approval.id}>
                <span>
                  <strong>
                    {approvalLabel(approval.kind)} · {formatMoney(approval.amountCents)}
                  </strong>
                  <small>
                    {approval.requestedByName} · {dateLabel(approval.requestedAt)} ·{" "}
                    {approval.reason}
                  </small>
                </span>
                <span className="cash-approval__actions">
                  <Button
                    disabled={Boolean(busy) || !online}
                    onClick={() =>
                      void run(
                        `approve:${approval.id}`,
                        () =>
                          api.management.decideCashApproval(
                            scope.organizationId,
                            scope.unitId,
                            approval.id,
                            { decision: "approve", note: approvalNote.trim() || undefined },
                            operationalKey("cash-approval"),
                          ),
                        approval.kind === "transfer"
                          ? "Transferência aprovada; aguardando aceite do destino."
                          : "Movimento aprovado e executado.",
                      )
                    }
                    size="sm"
                    type="button"
                  >
                    Aprovar
                  </Button>
                  <Button
                    disabled={Boolean(busy) || !online}
                    onClick={() =>
                      void run(
                        `reject:${approval.id}`,
                        () =>
                          api.management.decideCashApproval(
                            scope.organizationId,
                            scope.unitId,
                            approval.id,
                            { decision: "reject", note: approvalNote.trim() || undefined },
                            operationalKey("cash-rejection"),
                          ),
                        "Solicitação rejeitada.",
                      )
                    }
                    size="sm"
                    type="button"
                    variant="danger"
                  >
                    Rejeitar
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.capabilities.canManageCashSettings || data.capabilities.canManageTerminals) && (
        <details className="action-panel cash-controls">
          <summary>
            <span>
              <strong>Controles e terminais</strong>
              <small>Alçadas, alertas e vínculo autoritativo das gavetas.</small>
            </span>
            <span aria-hidden="true">+</span>
          </summary>
          {data.capabilities.canManageCashSettings && (
            <form className="action-form" onSubmit={saveSettings}>
              <label>
                Aprovação acima de (R$)
                <Input
                  inputMode="decimal"
                  onChange={(event) => setMovementThreshold(event.target.value)}
                  value={movementThreshold}
                />
              </label>
              <label>
                Divergência crítica acima de (R$)
                <Input
                  inputMode="decimal"
                  onChange={(event) => setDifferenceThreshold(event.target.value)}
                  value={differenceThreshold}
                />
              </label>
              <label>
                Alerta após (minutos)
                <Input
                  min={30}
                  onChange={(event) => setMaxShiftMinutes(event.target.value)}
                  type="number"
                  value={maxShiftMinutes}
                />
              </label>
              <Button disabled={Boolean(busy) || !online} type="submit">
                {busy === "settings" ? "Salvando…" : "Salvar política"}
              </Button>
            </form>
          )}
          {data.capabilities.canManageTerminals && data.availableTerminals.length > 0 && (
            <div className="cash-terminal-list">
              {data.availableTerminals.map((terminal) => (
                <label key={terminal.installationId}>
                  <span className="cash-terminal__header">
                    <span>
                      <strong>{terminal.label}</strong>
                      <small>
                        {terminal.lastSeenAt
                          ? `Último contato ${dateLabel(terminal.lastSeenAt)}`
                          : "Sem comunicação registrada"}
                      </small>
                    </span>
                    <Badge
                      tone={
                        terminal.status === "online"
                          ? "success"
                          : terminal.status === "offline"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {terminal.status === "online"
                        ? "Online"
                        : terminal.status === "offline"
                          ? "Offline"
                          : "Não pareado"}
                    </Badge>
                  </span>
                  <NativeSelect
                    disabled={Boolean(busy) || !online}
                    onChange={(event) =>
                      void run(
                        `terminal:${terminal.installationId}`,
                        () =>
                          api.management.bindCashTerminal(
                            scope.organizationId,
                            scope.unitId,
                            terminal.installationId,
                            event.target.value || null,
                            operationalKey("cash-terminal-binding"),
                          ),
                        "Vínculo do terminal atualizado.",
                      )
                    }
                    value={terminal.cashRegisterId ?? ""}
                  >
                    <option value="">Sem gaveta</option>
                    {data.registers
                      .filter((cashRegister) => cashRegister.active)
                      .map((cashRegister) => (
                        <option key={cashRegister.id} value={cashRegister.id}>
                          {cashRegister.name}
                        </option>
                      ))}
                  </NativeSelect>
                </label>
              ))}
            </div>
          )}
        </details>
      )}
      {notice && (
        <p aria-live="polite" className="form-feedback">
          {notice}
        </p>
      )}
    </>
  );
}
