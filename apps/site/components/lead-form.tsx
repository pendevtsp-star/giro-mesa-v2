"use client";

import { type FormEvent, useState } from "react";
import { withSitePwaMutation } from "./pwa-client";

type PlanSlug = "operacao" | "crescimento" | "rede";
type LeadFormProps = { kind: "trial" | "contact"; initialPlan?: PlanSlug };

export function LeadForm({ kind, initialPlan = "operacao" }: LeadFormProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const endpoint = `${apiUrl ?? ""}/public/v1/${kind === "trial" ? "trial-applications" : "contact"}`;

    if (!apiUrl) {
      setStatus("error");
      return;
    }

    try {
      const payload =
        kind === "trial"
          ? {
              name: form.get("name"),
              email: form.get("email"),
              phone: form.get("phone"),
              businessName: form.get("businessName"),
              segment: form.get("segment"),
              planSlug: form.get("planSlug"),
              consent: form.has("consent"),
            }
          : {
              name: form.get("name"),
              email: form.get("email"),
              phone: form.get("phone"),
              message: form.get("message"),
              privacyAccepted: form.has("consent"),
            };
      const response = await withSitePwaMutation(() =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setStatus(response.ok ? "success" : "error");
      if (response.ok) formElement.reset();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="field-row">
        <label>
          Nome completo
          <input name="name" autoComplete="name" required />
        </label>
        <label>
          WhatsApp
          <input name="phone" inputMode="tel" autoComplete="tel" required />
        </label>
      </div>
      <label>
        E-mail profissional
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {kind === "trial" ? (
        <>
          <label>
            Nome do estabelecimento
            <input name="businessName" autoComplete="organization" required />
          </label>
          <div className="field-row">
            <label>
              Tipo de operação
              <select name="segment" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                <option>Restaurante</option>
                <option>Bar</option>
                <option>Lanchonete</option>
                <option>Cafeteria</option>
                <option>Pizzaria</option>
                <option>Outro food service</option>
              </select>
            </label>
            <label>
              Plano de interesse
              <select name="planSlug" defaultValue={initialPlan}>
                <option value="operacao">Operação</option>
                <option value="crescimento">Crescimento</option>
                <option value="rede">Rede</option>
              </select>
            </label>
          </div>
        </>
      ) : (
        <label>
          Como podemos ajudar?
          <textarea name="message" rows={5} required />
        </label>
      )}
      <label className="check-label">
        <input type="checkbox" name="consent" required />
        <span>
          Li a <a href="/privacidade">Política de Privacidade</a> e autorizo contato sobre esta
          solicitação.
        </span>
      </label>
      <button className="button button-primary" disabled={status === "sending"} type="submit">
        {status === "sending"
          ? "Enviando…"
          : kind === "trial"
            ? "Solicitar teste assistido"
            : "Enviar mensagem"}
      </button>
      <p className="form-status" role="status">
        {status === "success" && "Solicitação recebida. Nossa equipe entrará em contato."}
        {status === "error" &&
          "O canal de envio ainda não está configurado neste ambiente. Nenhum dado foi enviado."}
      </p>
    </form>
  );
}
