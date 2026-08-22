import { Badge, Button, Callout, Input, Label, Modal, NativeSelect } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "../../rules";
import {
  cancelShellPayment,
  getShellPaymentCapabilities,
  recoverShellPayment,
  type ShellPaymentCapabilities,
  shellPaymentAvailable,
  startShellPayment,
} from "./pos-payment-bridge";
import {
  type IntegratedPaymentMethod,
  type PaymentAttempt,
  type PaymentCapabilities,
  posPayments,
} from "./pos-payments";

const methodLabels: Record<IntegratedPaymentMethod, string> = {
  credit_card: "Crédito",
  debit_card: "Débito",
  pix: "Pix",
};

function statusTone(status: PaymentAttempt["status"]) {
  if (status === "approved") return "success" as const;
  if (status === "declined") return "danger" as const;
  if (status === "unknown") return "warning" as const;
  return "neutral" as const;
}

function statusLabel(status: PaymentAttempt["status"]) {
  if (status === "approved") return "Aprovado";
  if (status === "declined") return "Recusado";
  if (status === "canceled") return "Cancelado";
  if (status === "unknown") return "Resultado não confirmado";
  if (status === "reversed") return "Estornado";
  return "Processando";
}

export function SmartPosPaymentModal({
  embedded,
  installationId,
  isOpen,
  onApproved,
  onAttemptChange,
  onClose,
  organizationId,
  remainingCents,
  tabId,
  unitId,
}: {
  embedded: boolean;
  installationId: string;
  isOpen: boolean;
  onApproved: () => void;
  onAttemptChange: (attempt: PaymentAttempt | null) => void;
  onClose: () => void;
  organizationId: string;
  remainingCents: number;
  tabId: string;
  unitId: string;
}) {
  const [capabilities, setCapabilities] = useState<PaymentCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [shellLoading, setShellLoading] = useState(false);
  const [shellCapabilities, setShellCapabilities] = useState<ShellPaymentCapabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amountCents, setAmountCents] = useState(remainingCents);
  const [method, setMethod] = useState<IntegratedPaymentMethod>("debit_card");
  const [installments, setInstallments] = useState(1);
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const approvedRef = useRef(new Set<string>());

  const updateAttempt = useCallback(
    (next: PaymentAttempt | null) => {
      setAttempt(next);
      onAttemptChange(next);
      if (next?.status === "approved" && !approvedRef.current.has(next.id)) {
        approvedRef.current.add(next.id);
        onApproved();
      }
    },
    [onApproved, onAttemptChange],
  );

  useEffect(() => {
    if (!isOpen) return;
    setAmountCents((current) => (attempt ? current : remainingCents));
    if (capabilities) return;
    let active = true;
    setLoading(true);
    setError("");
    void posPayments
      .capabilities(organizationId, unitId, installationId)
      .then((data) => {
        if (!active) return;
        setCapabilities(data);
        const first = data.methods[0];
        if (first) {
          setMethod((current) => (data.methods.includes(current) ? current : first));
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Não foi possível verificar esta maquininha.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, capabilities, installationId, isOpen, organizationId, remainingCents, unitId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!embedded || !shellPaymentAvailable()) {
      setShellCapabilities(null);
      setShellLoading(false);
      return;
    }
    let active = true;
    setShellLoading(true);
    void getShellPaymentCapabilities()
      .then((data) => {
        if (active) setShellCapabilities(data);
      })
      .finally(() => {
        if (active) setShellLoading(false);
      });
    return () => {
      active = false;
    };
  }, [embedded, isOpen]);

  useEffect(() => {
    if (!isOpen || !capabilities?.available || attempt) return;
    const frame = window.requestAnimationFrame(() => {
      amountRef.current?.focus({ preventScroll: true });
      amountRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attempt, capabilities?.available, isOpen]);

  useEffect(() => {
    if (!attempt || !["created", "processing"].includes(attempt.status)) return;
    let active = true;
    const poll = window.setInterval(() => {
      void posPayments
        .get(organizationId, unitId, attempt.id)
        .then((next) => {
          if (active) updateAttempt(next);
        })
        .catch(() => undefined);
    }, 2_500);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [attempt, organizationId, unitId, updateAttempt]);

  const bridgeReady =
    embedded &&
    shellPaymentAvailable() &&
    shellCapabilities?.available === true &&
    shellCapabilities.configured &&
    shellCapabilities?.canStart === true &&
    shellCapabilities.homologated &&
    shellCapabilities.provider === capabilities?.provider &&
    capabilities.methods.every((availableMethod) =>
      shellCapabilities.methods.includes(availableMethod),
    );
  const bridgeMismatchReason =
    embedded && capabilities?.available && shellCapabilities
      ? !shellCapabilities.configured || !shellCapabilities.homologated
        ? "O aplicativo nativo ainda não está configurado e homologado."
        : shellCapabilities.provider !== capabilities.provider
          ? "O provedor certificado no aplicativo diverge da configuração do servidor."
          : capabilities.methods.some(
                (availableMethod) => !shellCapabilities.methods.includes(availableMethod),
              )
            ? "Os métodos certificados no aplicativo divergem da configuração do servidor."
            : null
      : null;
  const canStart =
    capabilities?.available === true &&
    bridgeReady &&
    capabilities.methods.includes(method) &&
    shellCapabilities?.methods.includes(method) === true &&
    amountCents > 0 &&
    amountCents <= remainingCents;

  async function start() {
    if (!canStart) return;
    setBusy(true);
    setError("");
    try {
      const response = await posPayments.create(
        organizationId,
        unitId,
        tabId,
        { method, amountCents, installments, installationId },
        crypto.randomUUID(),
      );
      updateAttempt(response.attempt);
      if (response.action) {
        const result = await startShellPayment(response.attempt, response.action);
        if (!result.launched) {
          setError(
            result.requiresReconciliation
              ? "A maquininha não confirmou a abertura. Verifique o pagamento antes de repetir."
              : "A maquininha não conseguiu abrir o pagamento.",
          );
        }
      }
      updateAttempt(await posPayments.get(organizationId, unitId, response.attempt.id));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível iniciar o pagamento.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!attempt || !capabilities?.supports.recover || shellCapabilities?.canRecover !== true)
      return;
    setBusy(true);
    setError("");
    try {
      const response = await posPayments.recover(
        organizationId,
        unitId,
        attempt.id,
        crypto.randomUUID(),
      );
      updateAttempt(response.attempt);
      if (response.action) await recoverShellPayment(response.attempt.id);
      updateAttempt(await posPayments.get(organizationId, unitId, attempt.id));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível verificar o pagamento.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (
      !attempt ||
      (attempt.status !== "created" &&
        (!capabilities?.supports.cancel || shellCapabilities?.canCancel !== true))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await posPayments.cancel(
        organizationId,
        unitId,
        attempt.id,
        crypto.randomUUID(),
      );
      updateAttempt(response.attempt);
      if (response.action) await cancelShellPayment(response.attempt.id);
      updateAttempt(await posPayments.get(organizationId, unitId, attempt.id));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Não foi possível cancelar a tentativa.",
      );
    } finally {
      setBusy(false);
    }
  }

  function newAttempt() {
    updateAttempt(null);
    setError("");
    setAmountCents(remainingCents);
    setInstallments(1);
  }

  return (
    <Modal
      className="smart-pos-payment"
      description={
        <span>
          A maquininha recebe somente o identificador da tentativa validada pelo servidor.
        </span>
      }
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      title="Cobrar na maquininha"
    >
      {loading || shellLoading ? (
        <p className="smart-pos-payment__loading" role="status">
          Verificando esta maquininha…
        </p>
      ) : !capabilities?.available || !bridgeReady ? (
        <Callout tone="warning">
          <strong>Pagamento direto indisponível</strong>
          <p>
            {capabilities?.reason ??
              bridgeMismatchReason ??
              (embedded && shellCapabilities?.errorCode
                ? `O aplicativo bloqueou a cobrança (${shellCapabilities.errorCode}).`
                : embedded
                  ? "O aplicativo desta maquininha não oferece uma integração homologada e pronta."
                  : "A PWA está pronta para atendimento, mas o pagamento exige o aplicativo homologado do terminal.")}
          </p>
          <p>Cartão e Pix não serão registrados manualmente.</p>
        </Callout>
      ) : attempt ? (
        <section className="smart-pos-result" aria-live="polite">
          <div className="smart-pos-result__heading">
            <div>
              <small>{methodLabels[attempt.method]}</small>
              <strong>{formatMoney(attempt.amountCents)}</strong>
            </div>
            <Badge tone={statusTone(attempt.status)}>{statusLabel(attempt.status)}</Badge>
          </div>
          {["created", "processing"].includes(attempt.status) && (
            <Callout tone="info">
              <strong>Conclua na maquininha</strong>
              <p>Não feche a conta nem repita a cobrança enquanto aguardamos o resultado.</p>
            </Callout>
          )}
          {attempt.status === "approved" && (
            <Callout tone="success">
              <strong>Pagamento aprovado</strong>
              <p>
                A conta foi atualizada uma única vez
                {attempt.providerReference ? ` · referência ${attempt.providerReference}` : ""}.
              </p>
            </Callout>
          )}
          {attempt.status === "declined" && (
            <Callout tone="danger">
              <strong>Pagamento recusado</strong>
              <p>{attempt.failureMessage ?? "A adquirente não aprovou esta tentativa."}</p>
            </Callout>
          )}
          {attempt.status === "canceled" && (
            <Callout tone="warning">
              <strong>Pagamento cancelado</strong>
              <p>Nenhum valor foi confirmado nesta tentativa.</p>
            </Callout>
          )}
          {attempt.status === "unknown" && (
            <Callout tone="warning">
              <strong>Resultado não confirmado</strong>
              <p>Verifique a tentativa antes de cobrar novamente para evitar duplicidade.</p>
            </Callout>
          )}
          {error && (
            <p className="smart-pos-payment__error" role="alert">
              {error}
            </p>
          )}
          <div className="smart-pos-payment__actions">
            {attempt.status === "unknown" &&
              capabilities.supports.recover &&
              shellCapabilities?.canRecover === true && (
                <Button disabled={busy} onClick={() => void recover()}>
                  {busy ? "Verificando…" : "Verificar pagamento"}
                </Button>
              )}
            {(attempt.status === "created" ||
              (attempt.status === "processing" &&
                capabilities.supports.cancel &&
                shellCapabilities?.canCancel === true)) && (
              <Button disabled={busy} onClick={() => void cancel()} variant="secondary">
                Cancelar tentativa
              </Button>
            )}
            {["declined", "canceled"].includes(attempt.status) && (
              <Button disabled={busy} onClick={newAttempt}>
                Nova tentativa
              </Button>
            )}
            {["approved", "reversed"].includes(attempt.status) && (
              <Button onClick={onClose}>Voltar à conta</Button>
            )}
          </div>
        </section>
      ) : (
        <form
          className="smart-pos-form"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <div className="smart-pos-payment__amount">
            <small>Saldo da conta</small>
            <strong>{formatMoney(remainingCents)}</strong>
          </div>
          <Label htmlFor="smart-pos-amount">
            Valor a cobrar
            <Input
              id="smart-pos-amount"
              inputMode="decimal"
              max={remainingCents / 100}
              min={0.01}
              onChange={(event) => setAmountCents(Math.round(Number(event.target.value) * 100))}
              ref={amountRef}
              step="0.01"
              type="number"
              value={amountCents / 100}
            />
          </Label>
          <fieldset className="smart-pos-methods">
            <legend>Forma de pagamento</legend>
            <div>
              {capabilities.methods.map((item) => (
                <Button
                  aria-pressed={method === item}
                  key={item}
                  onClick={() => {
                    setMethod(item);
                    if (item !== "credit_card") setInstallments(1);
                  }}
                  type="button"
                  variant={method === item ? "primary" : "secondary"}
                >
                  {methodLabels[item]}
                </Button>
              ))}
            </div>
          </fieldset>
          {method === "credit_card" && capabilities.maxInstallments > 1 && (
            <Label htmlFor="smart-pos-installments">
              Parcelas
              <NativeSelect
                id="smart-pos-installments"
                onChange={(event) => setInstallments(Number(event.target.value))}
                value={installments}
              >
                {Array.from({ length: capabilities.maxInstallments }, (_, index) => index + 1).map(
                  (count) => (
                    <option key={count} value={count}>
                      {count === 1 ? "À vista" : `${count} parcelas`}
                    </option>
                  ),
                )}
              </NativeSelect>
            </Label>
          )}
          {error && (
            <p className="smart-pos-payment__error" role="alert">
              {error}
            </p>
          )}
          <div className="smart-pos-payment__submit">
            <Button disabled={!canStart || busy} type="submit">
              {busy ? "Abrindo pagamento…" : `Cobrar ${formatMoney(amountCents)}`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
