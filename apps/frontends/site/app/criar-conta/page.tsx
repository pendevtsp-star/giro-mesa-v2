"use client";

import { Button, Input, Label } from "@giromesa/ui";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  prepareGoogleRedirect,
  resolveLocalReturnTo,
  resolveOpsUrl,
} from "../../lib/auth-navigation";

export default function CreateAccountPage() {
  const [message, setMessage] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setReturnTo(
      resolveLocalReturnTo(
        fragment.get("returnTo") ?? parameters.get("returnTo"),
        window.location.origin,
      ),
    );
  }, []);

  async function startGoogleSignup() {
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
    const target = await prepareGoogleRedirect(apiUrl, {
      intent: "signup",
      termsAccepted: true,
      ...(returnTo ? { returnTo } : {}),
    });
    if (target) window.location.assign(target);
    else setMessage("Não foi possível iniciar a criação com Google.");
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
    const destination = returnTo
      ? new URL(returnTo, window.location.origin).toString()
      : resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
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
      const response = await fetch(`${apiUrl}/v1/auth/register`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Cadastro recusado");
      window.location.assign(destination);
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
        <Label className="check-label">
          <Input
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
            type="checkbox"
          />
          <span>
            Li os <Link href="/termos">Termos</Link> e a{" "}
            <Link href="/privacidade">Política de Privacidade</Link>.
          </span>
        </Label>
        <Button
          className="button google-button"
          type="button"
          variant="secondary"
          onClick={() => void startGoogleSignup()}
          disabled={!termsAccepted}
        >
          <span aria-hidden="true">G</span> Criar com Google
        </Button>
        <div className="divider">
          <span>ou com e-mail</span>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <Label>
            Nome completo
            <Input name="displayName" autoComplete="name" required />
          </Label>
          <Label>
            E-mail
            <Input name="email" type="email" autoComplete="email" required />
          </Label>
          <Label>
            Senha
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </Label>
          <Button className="button button-primary" type="submit">
            Criar conta
          </Button>
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
