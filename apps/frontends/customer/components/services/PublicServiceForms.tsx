import { Button, Input, Label, Textarea } from "@giromesa/ui";
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
        <Label>
          Nome
          <Input name="guestName" minLength={2} maxLength={160} required />
        </Label>
        <Label>
          Telefone para retorno
          <Input name="guestPhone" type="tel" minLength={8} maxLength={40} required />
        </Label>
        <div className="public-service-fields">
          <Label>
            Pessoas
            <Input name="partySize" type="number" min={1} max={100} defaultValue={2} required />
          </Label>
          <Label>
            Data e hora
            <Input name="scheduledAt" type="datetime-local" required />
          </Label>
        </div>
        <Label>
          Observações opcionais
          <Textarea name="notes" maxLength={500} rows={3} />
        </Label>
        <ConsentField />
        <Button type="submit" disabled={!configured || busy !== null}>
          {busy === "reservation" ? "Registrando…" : "Registrar solicitação de reserva"}
        </Button>
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
        <Label>
          Nome
          <Input name="guestName" minLength={2} maxLength={160} required />
        </Label>
        <Label>
          Telefone para retorno
          <Input name="guestPhone" type="tel" minLength={8} maxLength={40} required />
        </Label>
        <Label>
          Pessoas
          <Input name="partySize" type="number" min={1} max={100} defaultValue={2} required />
        </Label>
        <ConsentField />
        <Button type="submit" disabled={!configured || busy !== null}>
          {busy === "waitlist" ? "Registrando…" : "Registrar solicitação de fila"}
        </Button>
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
        <Label>
          Código
          <Input name="code" minLength={3} maxLength={64} autoComplete="off" required />
        </Label>
        <Label>
          Total estimado do pedido
          <Input name="orderTotal" type="number" min={0} step="0.01" inputMode="decimal" required />
        </Label>
        <Button type="submit" disabled={!configured || busy !== null}>
          {busy === "coupon" ? "Validando…" : "Validar sem consumir"}
        </Button>
      </form>
    </section>
  );
}

function ConsentField() {
  return (
    <Label className="public-consent">
      <Input name="privacyAccepted" type="checkbox" required />
      <span>
        Autorizo o uso destes dados para registrar a solicitação e permitir o retorno da unidade,
        conforme o aviso de privacidade.
      </span>
    </Label>
  );
}
