"use client";

import { Icon } from "@giromesa/ui";
import { type FormEvent, useRef, useState } from "react";
import { formatMoney } from "../lib/menu";
import {
  isPublicSubmissionAccepted,
  type MutationAttempt,
  readCouponValidation,
  resolveMutationAttempt,
} from "../lib/public-contracts";
import { customerFetch } from "../lib/pwa-fetch";

type MutationKind = "reservation" | "waitlist";
type Message = { tone: "success" | "warning"; text: string } | null;

const policyVersion = "2026-08-public-services";

export function PublicServicesExperience({ menuSlug, demo }: { menuSlug: string; demo: boolean }) {
  const [busy, setBusy] = useState<MutationKind | "coupon" | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const attempts = useRef<Record<MutationKind, MutationAttempt | null>>({
    reservation: null,
    waitlist: null,
  });
  const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
  const configured =
    !demo && Boolean(apiUrl) && process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED === "true";

  async function submitMutation(
    kind: MutationKind,
    path: string,
    body: Record<string, unknown>,
    form: HTMLFormElement,
    successMessage: string,
  ) {
    if (!apiUrl || !configured || busy) return;
    const serializedBody = JSON.stringify(body);
    const attempt = resolveMutationAttempt(attempts.current[kind], serializedBody, () =>
      crypto.randomUUID(),
    );
    attempts.current[kind] = attempt;
    setBusy(kind);
    setMessage(null);
    try {
      const response = await customerFetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/${path}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": attempt.key,
          },
          body: serializedBody,
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        attempts.current[kind] = null;
        throw new Error("Solicitação recusada");
      }
      if (!isPublicSubmissionAccepted(payload)) throw new Error("Resposta inválida");
      attempts.current[kind] = null;
      form.reset();
      setMessage({ tone: "success", text: successMessage });
    } catch {
      setMessage({
        tone: "warning",
        text: "Não foi possível comprovar a persistência. Tente novamente sem alterar os dados ou fale com a unidade.",
      });
    } finally {
      setBusy(null);
    }
  }

  function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const scheduledAt = new Date(String(data.get("scheduledAt") ?? ""));
    if (Number.isNaN(scheduledAt.getTime())) {
      setMessage({ tone: "warning", text: "Informe uma data e hora válidas." });
      return;
    }
    void submitMutation(
      "reservation",
      "reservations",
      {
        guestName: data.get("guestName"),
        guestPhone: data.get("guestPhone"),
        partySize: Number(data.get("partySize")),
        scheduledAt: scheduledAt.toISOString(),
        notes: String(data.get("notes") ?? "").trim() || null,
        privacyAccepted: data.has("privacyAccepted"),
        policyVersion,
      },
      form,
      "Solicitação registrada. O horário ainda depende da confirmação da unidade.",
    );
  }

  function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void submitMutation(
      "waitlist",
      "waitlist",
      {
        guestName: data.get("guestName"),
        guestPhone: data.get("guestPhone"),
        partySize: Number(data.get("partySize")),
        privacyAccepted: data.has("privacyAccepted"),
        policyVersion,
      },
      form,
      "Entrada registrada. A posição e o tempo de espera serão informados pela unidade.",
    );
  }

  async function submitCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiUrl || !configured || busy) return;
    const data = new FormData(event.currentTarget);
    const totalReais = Number(data.get("orderTotal"));
    const orderTotalCents = Math.round(totalReais * 100);
    if (!Number.isFinite(orderTotalCents) || orderTotalCents < 0) {
      setMessage({ tone: "warning", text: "Informe um total válido para estimar o desconto." });
      return;
    }
    setBusy("coupon");
    setMessage(null);
    try {
      const response = await customerFetch(
        `${apiUrl}/public/v1/menus/${encodeURIComponent(menuSlug)}/coupons/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: data.get("code"),
            orderTotalCents,
            channel: "qr",
          }),
        },
      );
      const validation = readCouponValidation(await response.json());
      if (!response.ok || !validation) throw new Error("Validação recusada");
      setMessage(
        validation.valid
          ? {
              tone: "success",
              text: `Cupom aplicável nesta estimativa: ${formatMoney(validation.discountCents)}. A aplicação final ocorre na comanda.`,
            }
          : {
              tone: "warning",
              text: "Cupom não aplicável a esta estimativa. Nenhum dado de campanha foi exposto.",
            },
      );
    } catch {
      setMessage({ tone: "warning", text: "Não foi possível validar o cupom agora." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="public-service-page">
      <a className="preference-back" href={`/m/${menuSlug}`}>
        <Icon name="arrow-left" /> Voltar ao cardápio
      </a>
      <p className="preference-eyebrow">Serviços da unidade</p>
      <h1>Solicite sem perder o contexto.</h1>
      <p className="preference-intro">
        Reserva e fila são registradas como solicitações, não como confirmação automática. O cupom é
        apenas estimado e não é consumido nesta página.
      </p>

      <div className={`service-runtime-status ${configured ? "ready" : "blocked"}`} role="status">
        <strong>
          {configured ? "Canal público disponível" : "Canal real indisponível neste ambiente"}
        </strong>
        <span>
          {demo
            ? "Este slug é demonstrativo e não envia dados."
            : configured
              ? "As respostas só aparecem após aceite e persistência da API."
              : "A configuração da API pública é necessária para enviar solicitações."}
        </span>
      </div>

      {message && (
        <div className={`public-service-message ${message.tone}`} role="status" aria-live="polite">
          {message.text}
        </div>
      )}

      <section id="reserva" className="public-service-card" aria-labelledby="reservation-title">
        <p className="preference-eyebrow">Horário desejado</p>
        <h2 id="reservation-title">Solicitar reserva</h2>
        <form className="public-service-form" onSubmit={submitReservation}>
          <label>
            Nome
            <input name="guestName" minLength={2} maxLength={160} required />
          </label>
          <label>
            Telefone para retorno
            <input name="guestPhone" type="tel" minLength={8} maxLength={40} required />
          </label>
          <div className="public-service-fields">
            <label>
              Pessoas
              <input name="partySize" type="number" min={1} max={100} defaultValue={2} required />
            </label>
            <label>
              Data e hora
              <input name="scheduledAt" type="datetime-local" required />
            </label>
          </div>
          <label>
            Observações opcionais
            <textarea name="notes" maxLength={500} rows={3} />
          </label>
          <ConsentField />
          <button type="submit" disabled={!configured || busy !== null}>
            {busy === "reservation" ? "Registrando…" : "Registrar solicitação de reserva"}
          </button>
        </form>
      </section>

      <section id="fila" className="public-service-card" aria-labelledby="waitlist-title">
        <p className="preference-eyebrow">Atendimento presencial</p>
        <h2 id="waitlist-title">Solicitar entrada na fila</h2>
        <form className="public-service-form" onSubmit={submitWaitlist}>
          <label>
            Nome
            <input name="guestName" minLength={2} maxLength={160} required />
          </label>
          <label>
            Telefone para retorno
            <input name="guestPhone" type="tel" minLength={8} maxLength={40} required />
          </label>
          <label>
            Pessoas
            <input name="partySize" type="number" min={1} max={100} defaultValue={2} required />
          </label>
          <ConsentField />
          <button type="submit" disabled={!configured || busy !== null}>
            {busy === "waitlist" ? "Registrando…" : "Registrar solicitação de fila"}
          </button>
        </form>
      </section>

      <section id="cupom" className="public-service-card" aria-labelledby="coupon-title">
        <p className="preference-eyebrow">Sem consumo</p>
        <h2 id="coupon-title">Estimar cupom</h2>
        <form className="public-service-form" onSubmit={submitCoupon}>
          <label>
            Código
            <input name="code" minLength={3} maxLength={64} autoComplete="off" required />
          </label>
          <label>
            Total estimado do pedido
            <input
              name="orderTotal"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              required
            />
          </label>
          <button type="submit" disabled={!configured || busy !== null}>
            {busy === "coupon" ? "Validando…" : "Validar sem consumir"}
          </button>
        </form>
      </section>

      <aside className="public-service-dependencies">
        <h2>Por que outros recursos continuam bloqueados?</h2>
        <p>
          Delivery e retirada exigem uma comanda operacional persistida com itens e totais reais.
          Saldo de fidelidade exige prova de posse por OTP em e-mail ou WhatsApp. Esses requisitos
          evitam pedidos fictícios e exposição de dados de terceiros.
        </p>
      </aside>
    </main>
  );
}

function ConsentField() {
  return (
    <label className="public-consent">
      <input name="privacyAccepted" type="checkbox" required />
      <span>
        Autorizo o uso destes dados para registrar a solicitação e permitir o retorno da unidade,
        conforme o aviso de privacidade.
      </span>
    </label>
  );
}
