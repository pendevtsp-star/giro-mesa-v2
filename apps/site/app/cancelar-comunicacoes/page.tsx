"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function MarketingOptOutPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    if (value.length >= 32 && value.length <= 256) setToken(value);
    else setMessage("Este link é inválido ou está incompleto.");
  }, []);

  async function optOut() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl || !token) {
      setMessage("O cancelamento não está disponível neste ambiente.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/v1/growth/opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("Cancelamento recusado");
      setCompleted(true);
      setMessage("Preferência atualizada. Você não receberá novas campanhas de marketing.");
    } catch {
      setMessage(
        "O link expirou ou já não é válido. Fale com o suporte para concluir o cancelamento.",
      );
    }
  }

  return (
    <main id="conteudo" className="single-auth-page">
      <section className="auth-box">
        <p className="eyebrow">Suas preferências</p>
        <h1>Cancelar comunicações</h1>
        <p>
          Esta ação interrompe campanhas de marketing. Mensagens operacionais da sua conta continuam
          ativas.
        </p>
        {!completed && (
          <button
            className="button button-primary"
            type="button"
            onClick={optOut}
            disabled={!token}
          >
            Confirmar cancelamento
          </button>
        )}
        <p className="form-status" role="status">
          {message}
        </p>
        <p className="auth-footer">
          <Link href="/privacidade">Política de Privacidade</Link> ·{" "}
          <Link href="/suporte">Suporte</Link>
        </p>
      </section>
    </main>
  );
}
