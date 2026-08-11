"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { resolveLocalReturnTo, resolveOpsUrl } from "../../lib/auth-navigation";
import { siteFetch } from "../../lib/pwa-fetch";

export default function CreateAccountPage() {
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    setReturnTo(resolveLocalReturnTo(parameters.get("returnTo"), window.location.origin));
  }, []);

  function startGoogleSignup() {
    if (!termsAccepted) {
      setMessage("Aceite os Termos e a Política de Privacidade para criar a conta.");
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const opsUrl = resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (!apiUrl || !opsUrl || process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true") {
      setMessage("A criação com Google ainda não está configurada neste ambiente.");
      return;
    }
    const target = new URL(`${apiUrl}/v1/auth/google/signup`);
    target.searchParams.set("termsAccepted", "true");
    if (returnTo) target.searchParams.set("returnTo", returnTo);
    window.location.assign(target.toString());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted) {
      setMessage("Aceite os Termos e a Política de Privacidade para criar a conta.");
      return;
    }
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      setMessage("A criação de conta ainda não está configurada neste ambiente.");
      return;
    }
    const destination =
      returnTo ?? resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (!destination) {
      setMessage("O destino seguro do aplicativo operacional ainda não está configurado.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const payload = {
      name: data.get("displayName"),
      email: data.get("email"),
      password: data.get("password"),
      termsAccepted: true,
    };
    try {
      const response = await siteFetch(`${apiUrl}/v1/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Cadastro recusado");
      const result = (await response.json()) as {
        email?: unknown;
        verificationRequired?: unknown;
      };
      if (result.verificationRequired !== true || typeof result.email !== "string") {
        throw new Error("Resposta de cadastro inválida");
      }
      window.sessionStorage.setItem("giromesa.pendingVerificationEmail", result.email);
      const verification = new URL("/verificar-email", window.location.origin);
      if (returnTo) verification.searchParams.set("returnTo", returnTo);
      window.location.assign(verification.toString());
    } catch {
      setMessage("Não foi possível criar a conta. Revise os dados ou tente novamente mais tarde.");
    }
  }

  return (
    <main id="conteudo" className="single-auth-page">
      <section className="auth-box">
        <p className="eyebrow">Identidade GiroMesa</p>
        <h1>Criar sua conta</h1>
        <p>A conta identifica você. A empresa só será criada após o fluxo de onboarding.</p>
        <label className="check-label">
          <input
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            type="checkbox"
          />
          <span>
            Li os <Link href="/termos">Termos</Link> e a{" "}
            <Link href="/privacidade">Política de Privacidade</Link>.
          </span>
        </label>
        <button
          className="button google-button"
          type="button"
          onClick={startGoogleSignup}
          disabled={!termsAccepted}
        >
          <span aria-hidden="true">G</span> Criar com Google
        </button>
        <div className="divider">
          <span>ou com e-mail</span>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            Nome completo
            <input name="displayName" autoComplete="name" required />
          </label>
          <label>
            E-mail
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <button className="button button-primary" type="submit">
            Criar conta
          </button>
        </form>
        <p className="form-status" role="status">
          {message}
        </p>
        <p className="auth-footer">
          Já possui conta? <Link href="/login">Entrar</Link>
        </p>
      </section>
    </main>
  );
}
