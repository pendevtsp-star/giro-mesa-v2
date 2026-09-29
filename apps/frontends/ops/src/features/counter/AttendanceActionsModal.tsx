import { Button, Input, Label, Modal, NativeSelect } from "@giromesa/ui";
import { type FormEvent, useRef, useState } from "react";
import { api } from "../../api";
import { pilotMutation } from "../../operational-dispatch";
import type { PilotScope, PosItem, PosTab } from "../../operations.shared";
import { formatMoney } from "../../rules";
import "./attendance-actions.css";

export type AttendanceActionKind = "transfer" | "move" | "merge";
type MergeReason =
  | "sit_together"
  | "large_party"
  | "accessibility"
  | "operational_reorganization"
  | "other";

export function validTransferQuantity(
  item: Pick<PosItem, "status" | "quantity"> | undefined,
  quantity: number,
) {
  return Boolean(
    item &&
      item.status === "draft" &&
      Number.isSafeInteger(quantity) &&
      quantity > 0 &&
      quantity === item.quantity,
  );
}

export function AttendanceActionsModal({
  kind,
  scope,
  tab,
  activeItems,
  availableTables,
  mergeTargets,
  targetLabel,
  busy,
  onClose,
  onMutate,
}: {
  kind: AttendanceActionKind;
  scope: PilotScope;
  tab: PosTab;
  activeItems: PosItem[];
  availableTables: Array<{ id: string; label: string }>;
  mergeTargets: PosTab[];
  targetLabel: (tab: PosTab) => string;
  busy: boolean;
  onClose: () => void;
  onMutate: (
    action: () => Promise<unknown>,
    success: string,
    onSuccess?: (result: unknown) => void,
    onError?: (error: unknown) => void,
  ) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [itemId, setItemId] = useState("");
  const [reasonCode, setReasonCode] = useState<MergeReason>("sit_together");
  const [reasonNote, setReasonNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const locked = busy || saving || tab.status !== "open";
  const item = activeItems.find((candidate) => candidate.id === itemId);
  const quantity = item?.quantity ?? 0;
  const target = mergeTargets.find(
    (candidate) =>
      candidate.id === selectedId && candidate.status === "open" && candidate.id !== tab.id,
  );
  const table = availableTables.find((candidate) => candidate.id === selectedId);
  const title =
    kind === "transfer"
      ? tab.tableId
        ? "Transferir mesa"
        : "Vincular a uma mesa"
      : kind === "move"
        ? "Transferir item"
        : "Unificar comandas";
  const valid =
    kind === "transfer"
      ? Boolean(table)
      : kind === "move"
        ? Boolean(target) && validTransferQuantity(item, quantity)
        : Boolean(target) && (reasonCode !== "other" || reasonNote.trim().length >= 3);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !valid || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    const showError = (cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : "A alteração não foi confirmada. Tente novamente.",
      );
    try {
      let action: () => Promise<unknown>;
      let success: string;
      if (kind === "transfer") {
        const body = { tableId: selectedId, reason: "Transferência solicitada na operação" };
        action = () =>
          scope.dispatch(
            "pos.tab.transfer_requested",
            pilotMutation("transfer-tab", { tabId: tab.id, body }),
            (key) => api.pilot.transferTab(scope.organizationId, scope.unitId, tab.id, body, key),
          );
        success = "Comanda vinculada à mesa de destino.";
      } else if (kind === "move") {
        const body = { targetTabId: selectedId, items: [{ orderItemId: itemId, quantity }] };
        action = () =>
          scope.dispatch(
            "pos.items.move_requested",
            pilotMutation("move-items", { tabId: tab.id, body }),
            (key) => api.pilot.moveItems(scope.organizationId, scope.unitId, tab.id, body, key),
          );
        success = "Consumo transferido para a comanda de destino.";
      } else {
        const body = {
          targetTabId: tab.id,
          sourceTabIds: [selectedId],
          reasonCode,
          ...(reasonNote.trim() ? { reasonNote: reasonNote.trim() } : {}),
        };
        action = () =>
          scope.dispatch("pos.tabs.merge_requested", pilotMutation("merge-tabs", { body }), (key) =>
            api.pilot.mergeTabs(scope.organizationId, scope.unitId, body, key),
          );
        success = "Comandas unificadas.";
      }
      if (await onMutate(action, success, undefined, showError)) onClose();
    } catch (cause) {
      showError(cause);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal isOpen size="md" title={title} closeDisabled={busy || saving} onClose={onClose}>
      <form className="attendance-action-form" onSubmit={submit}>
        <p className="attendance-action-form__intro">
          {kind === "transfer"
            ? "Vincule este atendimento a uma mesa livre."
            : kind === "move"
              ? "Transfira itens em espera, antes de enviar para produção."
              : "Traga o consumo da origem para esta comanda. Confira os atendimentos antes de confirmar."}
        </p>
        <fieldset disabled={locked} className="attendance-action-form__fields">
          {kind === "move" && (
            <>
              <Label>
                Item a transferir
                <NativeSelect
                  value={itemId}
                  onChange={(event) => setItemId(event.target.value)}
                  required
                >
                  <option value="">Selecione um item em espera</option>
                  {activeItems
                    .filter((candidate) => candidate.status === "draft")
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.quantity}× {candidate.productName}
                      </option>
                    ))}
                </NativeSelect>
              </Label>
              <p className="attendance-action-form__intro">
                Toda a quantidade deste item será transferida. As duas comandas precisam estar sem
                pagamentos registrados.
              </p>
            </>
          )}
          <Label>
            {kind === "transfer"
              ? "Mesa de destino"
              : kind === "move"
                ? "Comanda de destino"
                : "Comanda de origem"}
            <NativeSelect
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              required
            >
              <option value="">
                {kind === "transfer" ? "Selecione uma mesa livre" : "Selecione a comanda"}
              </option>
              {kind === "transfer"
                ? availableTables.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))
                : mergeTargets
                    .filter((candidate) => candidate.status === "open" && candidate.id !== tab.id)
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {targetLabel(candidate)} · {formatMoney(candidate.totalCents)}
                      </option>
                    ))}
            </NativeSelect>
          </Label>
          {kind === "merge" && (
            <>
              <Label>
                Motivo
                <NativeSelect
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value as MergeReason)}
                >
                  <option value="sit_together">Clientes querem sentar juntos</option>
                  <option value="large_party">Grupo ou família grande</option>
                  <option value="accessibility">Necessidade de acessibilidade</option>
                  <option value="operational_reorganization">Reorganização operacional</option>
                  <option value="other">Outro</option>
                </NativeSelect>
              </Label>
              {reasonCode === "other" && (
                <Label>
                  Detalhe do motivo
                  <Input
                    required
                    minLength={3}
                    maxLength={500}
                    value={reasonNote}
                    onChange={(event) => setReasonNote(event.target.value)}
                  />
                </Label>
              )}
            </>
          )}
        </fieldset>
        {kind === "move" && !activeItems.some((candidate) => candidate.status === "draft") && (
          <p role="status">Nenhum item em espera disponível para transferência.</p>
        )}
        {kind === "transfer" && availableTables.length === 0 && (
          <p role="status">Nenhuma mesa livre disponível.</p>
        )}
        {kind !== "transfer" && mergeTargets.length === 0 && (
          <p role="status">Nenhuma outra comanda aberta disponível.</p>
        )}
        {(target || table) && (
          <div className="attendance-action-form__summary" aria-live="polite">
            <div>
              <span>Origem</span>
              <strong>{kind === "merge" && target ? targetLabel(target) : targetLabel(tab)}</strong>
              {kind === "merge" && target && <span>{formatMoney(target.totalCents)}</span>}
            </div>
            <div>
              <span>Destino</span>
              <strong>
                {kind === "merge"
                  ? targetLabel(tab)
                  : (table?.label ?? (target ? targetLabel(target) : ""))}
              </strong>
              {kind === "merge" && <span>{formatMoney(tab.totalCents)} antes da união</span>}
            </div>
            {kind === "move" && item && (
              <p>
                {validTransferQuantity(item, quantity) ? quantity : "—"}× {item.productName}
              </p>
            )}
            {kind === "merge" && (
              <p>
                O consumo da origem será incorporado ao destino. O serviço será recalculado pela
                taxa do destino; o saldo final será atualizado após a confirmação.
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="auth-message auth-message--error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" disabled={busy || saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={locked || !valid}>
            {saving
              ? "Salvando…"
              : kind === "merge"
                ? "Confirmar unificação"
                : kind === "move"
                  ? "Confirmar transferência"
                  : "Confirmar vínculo"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
