import { Badge, Button, Input, Label } from "@giromesa/ui";
import { useRef, useState } from "react";
import { api } from "../../api";
import { currencyToCents, formatCurrencyInput } from "../../management.shared";
import { pilotMutation } from "../../operational-dispatch";
import type { PilotScope, PosTab } from "../../operations.shared";
import { formatMoney } from "../../rules";

export function AccountChargesPanel({
  scope,
  tab,
  busy,
  online,
  pendingDiscount,
  remainingCents,
  onMutate,
}: {
  scope: PilotScope;
  tab: PosTab;
  busy: boolean;
  online: boolean;
  pendingDiscount: boolean;
  remainingCents: number;
  onMutate: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [tipDraft, setTipDraft] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const inFlight = useRef(false);
  const discountRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const isManager = ["owner", "manager"].includes(scope.profileId);
  const canAdjustCharges = isManager || scope.profileId === "cashier";
  const tipValue = tipDraft ?? formatCurrencyInput(String(tab.tipCents));
  const tipCents = currencyToCents(tipValue);
  const discountCents = currencyToCents(discount);
  const availableDiscountCents = Math.max(
    0,
    Math.min(remainingCents, tab.subtotalCents - tab.discountCents),
  );
  const serviceApplied = tab.serviceChargeBasisPoints > 0;
  const suggestedRate = tab.suggestedServiceChargeBasisPoints ?? 0;
  const locked = busy || tab.status !== "open";
  const validDiscount =
    Number.isSafeInteger(discountCents) &&
    discountCents > 0 &&
    discountCents <= availableDiscountCents &&
    reason.trim().length >= 3 &&
    (!isManager || (/^\d{4,8}$/.test(pin) && Boolean(scope.membershipId)));

  async function run(action: () => Promise<unknown>, success: string) {
    if (inFlight.current || locked) return false;
    inFlight.current = true;
    try {
      return await onMutate(action, success);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <div className="account-charge-panel">
      {canAdjustCharges && (serviceApplied || suggestedRate > 0) && (
        <div className="account-service-charge">
          <div>
            <strong>
              {serviceApplied
                ? `Serviço ${(tab.serviceChargeBasisPoints / 100).toLocaleString("pt-BR")}% · ${formatMoney(tab.serviceChargeCents)}`
                : "Serviço não aplicado"}
            </strong>
            <small>
              {serviceApplied
                ? "Taxa opcional desta conta."
                : `Taxa configurada: ${(suggestedRate / 100).toLocaleString("pt-BR")}%`}
            </small>
          </div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={locked || (serviceApplied && remainingCents < tab.serviceChargeCents)}
            onClick={() => {
              const rate = serviceApplied ? 0 : suggestedRate;
              void run(
                () =>
                  scope.dispatch(
                    "pos.tab.service_charge_requested",
                    pilotMutation("service-charge", { tabId: tab.id, basisPoints: rate }),
                    (key) =>
                      api.pilot.serviceCharge(
                        scope.organizationId,
                        scope.unitId,
                        tab.id,
                        rate,
                        key,
                      ),
                  ),
                serviceApplied ? "Serviço retirado da conta." : "Serviço configurado aplicado.",
              );
            }}
          >
            {serviceApplied ? "Retirar serviço" : "Aplicar serviço configurado"}
          </Button>
        </div>
      )}
      <div className="account-charge-grid">
        {canAdjustCharges && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!Number.isSafeInteger(tipCents) || tipCents < 0 || !tipValue) return;
              void run(
                () =>
                  scope.dispatch(
                    "pos.tab.tip_requested",
                    pilotMutation("tip", { tabId: tab.id, tipCents }),
                    (key) =>
                      api.pilot.tip(scope.organizationId, scope.unitId, tab.id, tipCents, key),
                  ),
                "Gorjeta atualizada.",
              ).then((ok) => {
                if (ok) setTipDraft(null);
              });
            }}
          >
            <strong>Gorjeta</strong>
            <Label>
              Valor (R$)
              <Input
                data-currency="brl"
                inputMode="numeric"
                maxLength={15}
                required
                value={tipValue}
                onChange={(event) => setTipDraft(event.target.value)}
                disabled={locked}
              />
            </Label>
            <small>Valor atual: {formatMoney(tab.tipCents)}. Use zero para retirar.</small>
            <Button
              size="sm"
              disabled={locked || !tipValue || tipCents < 0 || tipCents === tab.tipCents}
              type="submit"
            >
              Salvar gorjeta
            </Button>
          </form>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!validDiscount || !online || pendingDiscount) return;
            const fingerprint = JSON.stringify({ discountCents, reason: reason.trim(), pin });
            if (discountRequest.current?.fingerprint !== fingerprint)
              discountRequest.current = { fingerprint, key: crypto.randomUUID() };
            const key = discountRequest.current.key;
            void run(
              () =>
                isManager
                  ? api.pilot.discountTab(
                      scope.organizationId,
                      scope.unitId,
                      tab.id,
                      {
                        discountCents,
                        approval: {
                          approverMembershipId: scope.membershipId,
                          pin,
                          reason: reason.trim(),
                        },
                      },
                      key,
                    )
                  : api.pilot.requestApproval(
                      scope.organizationId,
                      scope.unitId,
                      tab.id,
                      {
                        action: "tab_discount",
                        discountCents,
                        reason: reason.trim(),
                      },
                      key,
                    ),
              isManager
                ? "Desconto aplicado à conta."
                : "Desconto enviado ao gerente para aprovação.",
            ).then((ok) => {
              if (ok) {
                setDiscount("");
                setPin("");
                setReason("");
                discountRequest.current = null;
              }
            });
          }}
        >
          <strong>Desconto na conta</strong>
          {remainingCents <= 0 && (
            <small>A conta já está paga. Corrija o pagamento antes de reduzir o total.</small>
          )}
          <small>
            Já aplicado: {formatMoney(tab.discountCents)}. O novo valor é adicional, somente sobre o
            consumo.
          </small>
          {pendingDiscount && <Badge tone="warning">Aguardando gerente</Badge>}
          <Label>
            Desconto adicional (R$)
            <Input
              data-currency="brl"
              inputMode="numeric"
              maxLength={15}
              required
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              disabled={locked || pendingDiscount}
            />
          </Label>
          <Label>
            Motivo do desconto
            <Input
              minLength={3}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={locked || pendingDiscount}
            />
          </Label>
          {isManager ? (
            <Label>
              Seu código gerencial
              <Input
                type="password"
                autoComplete="one-time-code"
                inputMode="numeric"
                minLength={4}
                maxLength={8}
                pattern="[0-9]{4,8}"
                required
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                disabled={locked || pendingDiscount}
              />
            </Label>
          ) : (
            <small>
              O gerente aprova no próprio dispositivo. O total só muda após a aprovação.
            </small>
          )}
          {discountCents > availableDiscountCents && (
            <small role="alert">Máximo disponível: {formatMoney(availableDiscountCents)}.</small>
          )}
          <Button
            size="sm"
            type="submit"
            disabled={locked || !online || pendingDiscount || !validDiscount}
          >
            {isManager ? "Aplicar desconto" : "Solicitar desconto"}
          </Button>
        </form>
      </div>
    </div>
  );
}
