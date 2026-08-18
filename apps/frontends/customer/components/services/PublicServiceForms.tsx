import type { FormEventHandler } from "react";

type Busy = "reservation" | "waitlist" | "coupon" | null;

export function ReservationForm({
  configured,
  busy,
  onSubmit,
}: {
  configured: boolean;
  busy: Busy;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <section id="reserva" className="public-service-card" aria-labelledby="reservation-title">
      <p className="preference-eyebrow">Horário desejado</p>
      <h2 id="reservation-title">Solicitar reserva</h2>
      <form className="public-service-form" onSubmit={onSubmit}>
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
  );
}

export function WaitlistForm({
  configured,
  busy,
  onSubmit,
}: {
  configured: boolean;
  busy: Busy;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <section id="fila" className="public-service-card" aria-labelledby="waitlist-title">
      <p className="preference-eyebrow">Atendimento presencial</p>
      <h2 id="waitlist-title">Solicitar entrada na fila</h2>
      <form className="public-service-form" onSubmit={onSubmit}>
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
  );
}

export function CouponForm({
  configured,
  busy,
  onSubmit,
}: {
  configured: boolean;
  busy: Busy;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <section id="cupom" className="public-service-card" aria-labelledby="coupon-title">
      <p className="preference-eyebrow">Sem consumo</p>
      <h2 id="coupon-title">Estimar cupom</h2>
      <form className="public-service-form" onSubmit={onSubmit}>
        <label>
          Código
          <input name="code" minLength={3} maxLength={64} autoComplete="off" required />
        </label>
        <label>
          Total estimado do pedido
          <input name="orderTotal" type="number" min={0} step="0.01" inputMode="decimal" required />
        </label>
        <button type="submit" disabled={!configured || busy !== null}>
          {busy === "coupon" ? "Validando…" : "Validar sem consumir"}
        </button>
      </form>
    </section>
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
