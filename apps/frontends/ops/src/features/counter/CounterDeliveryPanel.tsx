import { Badge, Button, Input, Label, NativeSelect, Textarea } from "@giromesa/ui";
import { useRef, useState } from "react";
import { api } from "../../api";
import {
  type DeliveryOrder,
  parseDeliveryCouriers,
  parseDeliveryOrders,
} from "../../growth.shared";
import { type PilotScope, type PosTab, useRemote } from "../../operations.shared";
import { formatMoney } from "../../rules";

export function counterDeliveryDispatchInput(
  delivery: Pick<DeliveryOrder, "fulfillment" | "addressValidationStatus">,
  reference: string,
  coverageReason: string,
) {
  const courierReference = reference.trim();
  if (courierReference.length < 2 || courierReference.length > 160)
    throw new Error(
      "Informe o nome ou a referência do responsável pela entrega (2 a 160 caracteres).",
    );
  const coverageOverrideReason = coverageReason.trim();
  const requiresCoverage =
    delivery.fulfillment === "delivery" && delivery.addressValidationStatus !== "covered";
  if (
    requiresCoverage &&
    (coverageOverrideReason.length < 10 || coverageOverrideReason.length > 500)
  )
    throw new Error("Explique como a cobertura foi confirmada manualmente (10 a 500 caracteres).");
  return {
    courierReference,
    ...(requiresCoverage ? { coverageOverrideReason } : {}),
  };
}

export function CounterDeliveryPanel({
  scope,
  tab,
  courierId,
  onCourierChange,
  onChanged,
  onEdit,
  onPrint,
}: {
  scope: PilotScope;
  tab: PosTab;
  courierId: string;
  onCourierChange: (id: string) => void;
  onChanged: () => void;
  onEdit: () => void;
  onPrint: () => void;
}) {
  const orders = useRemote(
    scope,
    () => api.growth.deliveryOrders(scope.organizationId, scope.unitId, { orderRef: tab.id }),
    parseDeliveryOrders,
    `${tab.id}:${tab.version}`,
  );
  const couriers = useRemote(
    scope,
    () => api.growth.deliveryCouriers(scope.organizationId, scope.unitId),
    parseDeliveryCouriers,
  );
  const delivery =
    orders.state.status === "ready"
      ? orders.state.data.find((order) => order.orderRef === tab.id)
      : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualCourierReference, setManualCourierReference] = useState("");
  const [coverageOverrideReason, setCoverageOverrideReason] = useState("");
  const keys = useRef(new Map<string, string>());
  const selectedId = courierId || delivery?.courierId || "";
  const candidates =
    couriers.state.status === "ready"
      ? couriers.state.data.filter(
          (courier) => courier.status === "available" || courier.id === selectedId,
        )
      : [];
  async function act(action: string, run: (key: string) => Promise<unknown>) {
    setBusy(true);
    setError("");
    const attempt = `${delivery?.id ?? tab.id}:${action}`;
    const key = keys.current.get(attempt) ?? crypto.randomUUID();
    keys.current.set(attempt, key);
    try {
      await run(key);
      keys.current.delete(attempt);
      await orders.refresh();
      await couriers.refresh();
      onChanged();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível atualizar a entrega.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="counter-delivery-panel" aria-label="Entrega do pedido">
      <div className="counter-delivery-panel__heading">
        <strong>Entrega</strong>
        <Badge tone={delivery?.status === "completed" ? "success" : "info"}>
          {delivery
            ? {
                draft: "Em espera",
                placed: "Confirmada",
                confirmed: "Confirmada",
                preparing: "Em preparo",
                ready: "Pronta",
                dispatched: "Em rota",
                delivery_failed: "Falha na entrega",
                returned: "Retornou",
                completed: "Entregue",
                canceled: "Cancelada",
              }[delivery.status]
            : orders.state.status === "loading"
              ? "Consultando entrega…"
              : orders.state.status === "error"
                ? "Consulta indisponível"
                : "A confirmar no envio"}
        </Badge>
        {!delivery && orders.state.status === "ready" && tab.status === "open" && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Editar dados
          </Button>
        )}
      </div>
      <p>
        {tab.customerName || "Cliente avulso"}
        {tab.customerPhone ? ` · ${tab.customerPhone}` : ""}
      </p>
      <p className="counter-delivery-panel__address">
        {tab.deliveryAddress || "Endereço pendente"}
      </p>
      {Boolean(tab.deliveryFeeCents) && (
        <small>Taxa de entrega: {formatMoney(tab.deliveryFeeCents ?? 0)}</small>
      )}
      <Label>
        Entregador · opcional
        <NativeSelect
          value={selectedId}
          disabled={
            busy ||
            orders.state.status !== "ready" ||
            ["dispatched", "completed", "canceled", "returned"].includes(delivery?.status ?? "")
          }
          onChange={(event) => {
            const next = event.target.value;
            if (!delivery) {
              onCourierChange(next);
              return;
            }
            if (!next) return;
            void act(`assign:${next}`, async (key) => {
              await api.growth.assignDeliveryCourier(scope.organizationId, delivery.id, {
                courierId: next,
                idempotencyKey: key,
              });
              onCourierChange("");
            });
          }}
        >
          <option value="" disabled={Boolean(delivery?.courierId)}>
            Definir depois
          </option>
          {selectedId && !candidates.some((courier) => courier.id === selectedId) && (
            <option value={selectedId}>
              {delivery?.courierReference ?? "Entregador selecionado"}
            </option>
          )}
          {candidates.map((courier) => (
            <option key={courier.id} value={courier.id}>
              {courier.name}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {!delivery && selectedId && <small>O responsável será confirmado ao enviar o pedido.</small>}
      {orders.state.status === "error" && <p role="alert">{orders.state.message}</p>}
      {couriers.state.status === "error" && <p role="alert">{couriers.state.message}</p>}
      {error && <p role="alert">{error}</p>}
      {delivery?.status === "ready" && (
        <form
          className="gm-form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const input = counterDeliveryDispatchInput(
                delivery,
                delivery.courierReference || manualCourierReference,
                coverageOverrideReason,
              );
              void act(`dispatch:${JSON.stringify(input)}`, (key) =>
                api.growth.dispatchDelivery(scope.organizationId, delivery.id, {
                  ...input,
                  idempotencyKey: key,
                }),
              );
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Revise os dados do despacho.");
            }
          }}
        >
          {!delivery.courierReference && (
            <Label>
              Responsável avulso pela entrega
              <Input
                disabled={busy}
                minLength={2}
                maxLength={160}
                required
                value={manualCourierReference}
                onChange={(event) => setManualCourierReference(event.target.value)}
                placeholder="Nome ou referência do responsável"
              />
              <small>Preencha ao despachar sem um entregador cadastrado.</small>
            </Label>
          )}
          {delivery.addressValidationStatus !== "covered" && (
            <>
              <p role="status">
                A cobertura deste endereço não foi validada automaticamente. Confirme antes de
                liberar a entrega.
              </p>
              <Label>
                Motivo da confirmação manual de cobertura
                <Textarea
                  disabled={busy}
                  minLength={10}
                  maxLength={500}
                  required
                  rows={3}
                  value={coverageOverrideReason}
                  onChange={(event) => setCoverageOverrideReason(event.target.value)}
                  placeholder="Ex.: endereço confirmado por telefone com o cliente"
                />
              </Label>
            </>
          )}
          <Button disabled={busy} size="sm" type="submit">
            {busy ? "Atualizando…" : "Saiu para entrega"}
          </Button>
        </form>
      )}
      {delivery && (
        <div className="counter-delivery-panel__actions">
          <Button disabled={busy} size="sm" variant="secondary" onClick={onPrint}>
            Imprimir via de entrega
          </Button>
          {delivery.status === "dispatched" && (
            <Button
              disabled={busy}
              size="sm"
              onClick={() =>
                void act("complete", () =>
                  api.growth.transitionDelivery(scope.organizationId, delivery.id, "completed"),
                )
              }
            >
              Confirmar entrega
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
