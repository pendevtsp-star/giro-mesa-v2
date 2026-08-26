"use client";

import { useEffect, useState } from "react";
import { updateVisitorConsent, visitorConsentCookieName } from "../lib/visitor-consent";

function consentCookieValue() {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${visitorConsentCookieName}=`))
    ?.split("=")[1];
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle");

  useEffect(() => setVisible(!consentCookieValue()), []);

  async function choose(value: "accepted" | "rejected") {
    setStatus("sending");
    try {
      await updateVisitorConsent(value);
      window.location.reload();
    } catch {
      setStatus("error");
    }
  }

  if (!visible) return null;

  return (
    <section className="cookie-consent" aria-labelledby="cookie-consent-title">
      <div className="cookie-consent__content">
        <div>
          <h2 id="cookie-consent-title">Sua privacidade</h2>
          <p>
            Usamos um identificador opcional para medir a apresentação comercial e melhorar o
            conteúdo. Cookies necessários à segurança e à sessão continuam ativos.
          </p>
          <a href="/privacidade#cookies">Entenda os cookies</a>
        </div>
        <div className="cookie-consent__actions">
          <button
            className="button button-outline"
            type="button"
            disabled={status === "sending"}
            onClick={() => choose("rejected")}
          >
            Recusar opcionais
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={status === "sending"}
            onClick={() => choose("accepted")}
          >
            Aceitar opcionais
          </button>
        </div>
      </div>
      {status === "error" ? (
        <p className="cookie-consent__error" role="alert">
          Não foi possível salvar sua preferência. Tente novamente.
        </p>
      ) : null}
    </section>
  );
}
