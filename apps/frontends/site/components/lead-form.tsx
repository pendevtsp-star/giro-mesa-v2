"use client";

import { Button, Input, Label, NativeSelect, Textarea } from "@giromesa/ui";
import { type FormEvent, useState } from "react";

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
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(response.ok ? "success" : "error");
      if (response.ok) formElement.reset();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="field-row">
        <Label>
          Nome completo
          <Input name="name" autoComplete="name" required />
        </Label>
        <Label>
          WhatsApp
          <Input name="phone" inputMode="tel" autoComplete="tel" required />
        </Label>
      </div>
      <Label>
        E-mail profissional
        <Input name="email" type="email" autoComplete="email" required />
      </Label>
      {kind === "trial" ? (
        <>
          <Label>
            Nome do estabelecimento
            <Input name="businessName" autoComplete="organization" required />
          </Label>
          <div className="field-row">
            <Label>
              Tipo de operação
              <NativeSelect name="segment" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                <option>Restaurante</option>
                <option>Bar</option>
                <option>Lanchonete</option>
                <option>Cafeteria</option>
                <option>Pizzaria</option>
                <option>Outro food service</option>
              </NativeSelect>
            </Label>
            <Label>
              Plano de interesse
              <NativeSelect name="planSlug" defaultValue={initialPlan}>
                <option value="operacao">Operação</option>
                <option value="crescimento">Crescimento</option>
                <option value="rede">Rede</option>
              </NativeSelect>
            </Label>
          </div>
        </>
      ) : (
        <Label>
          Como podemos ajudar?
          <Textarea name="message" rows={5} required />
        </Label>
      )}
      <Label className="check-label">
        <Input type="checkbox" name="consent" required />
        <span>
          Li a <a href="/privacidade">Política de Privacidade</a> e autorizo contato sobre esta
          solicitação.
        </span>
      </Label>
      <Button className="button button-primary" disabled={status === "sending"} type="submit">
        {status === "sending"
          ? "Enviando…"
          : kind === "trial"
            ? "Solicitar teste assistido"
            : "Enviar mensagem"}
      </Button>
      <p className="form-status" role="status">
        {status === "success" && "Solicitação recebida. Nossa equipe entrará em contato."}
        {status === "error" &&
          "O canal de envio ainda não está configurado neste ambiente. Nenhum dado foi enviado."}
      </p>
    </form>
  );
}
