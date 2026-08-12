"use client";

import { type FormEvent, useState } from "react";
import { normalizeOptOutToken } from "../lib/public-contracts";
import { customerFetch } from "../lib/pwa-fetch";

export function OptOutForm({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedToken = normalizeOptOutToken(token);
    if (!normalizedToken) {
      setMessage("Use o link completo recebido na comunicação ou informe um token válido.");
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_CUSTOMER_API_URL?.replace(/\/$/, "");
    if (!apiUrl || process.env.NEXT_PUBLIC_CUSTOMER_API_ENABLED !== "true") {
      setMessage("O serviço de preferências não está configurado neste ambiente.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await customerFetch(`${apiUrl}/v1/growth/opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: normalizedToken }),
      });
      if (!response.ok) throw new Error("Opt-out recusado");
      setCompleted(true);
      setToken("");
      setMessage("Preferência registrada. O estabelecimento não deve enviar novas campanhas.");
    } catch {
      setMessage("Não foi possível validar esse link. Solicite uma nova opção de saída à unidade.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="preference-form" onSubmit={submit}>
      <label htmlFor="opt-out-token">Token do link de descadastro</label>
      <input
        id="opt-out-token"
        name="token"
        type="text"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        minLength={32}
        maxLength={256}
        autoComplete="off"
        disabled={completed}
        required
      />
      <small>O token é usado apenas nesta solicitação e não é salvo neste navegador.</small>
      <button type="submit" disabled={submitting || completed}>
        {completed ? "Preferência registrada" : submitting ? "Registrando…" : "Parar comunicações"}
      </button>
      <p className="preference-status" role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
