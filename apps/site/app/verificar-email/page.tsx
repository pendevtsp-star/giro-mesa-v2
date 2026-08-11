"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { resolveLocalReturnTo, resolveOpsUrl } from "../../lib/auth-navigation";
import {
  buildEmailVerificationRequest,
  consumeEmailVerificationFragment,
} from "../../lib/email-verification";

type VerificationState =
  | "waiting"
  | "checking"
  | "mfa_required"
  | "success"
  | "already_verified"
  | "invalid";

const pendingEmailKey = "giromesa.pendingVerificationEmail";

export default function VerifyEmailPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<VerificationState>("waiting");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);

  const continueToApplication = useCallback(() => {
    window.sessionStorage.removeItem(pendingEmailKey);
    setState("success");
    setMessage("E-mail confirmado. Estamos abrindo a configuração da sua operação.");
    const parameters = new URLSearchParams(window.location.search);
    const returnTo = resolveLocalReturnTo(parameters.get("returnTo"), window.location.origin);
    const destination =
      returnTo ?? resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (destination) window.setTimeout(() => window.location.assign(destination), 1_200);
  }, []);

  useEffect(() => {
    setEmail(window.sessionStorage.getItem(pendingEmailKey) ?? "");
    const { token, sanitizedUrl } = consumeEmailVerificationFragment(window.location.href);
    window.history.replaceState(null, "", sanitizedUrl);
    if (!token) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      setMessage("A verificação ainda não está configurada neste ambiente.");
      setState("invalid");
      return;
    }
    setState("checking");
    let request: ReturnType<typeof buildEmailVerificationRequest>;
    try {
      request = buildEmailVerificationRequest(apiUrl, token);
    } catch {
      setMessage("A verificação exige uma conexão segura com a API.");
      setState("invalid");
      return;
    }
    void fetch(request.url, request.init)
      .then(async (response) => {
        if (!response.ok) throw new Error("invalid verification");
        return (await response.json()) as {
          status?: unknown;
          mfaRequired?: unknown;
          challengeToken?: unknown;
        };
      })
      .then((result) => {
        if (result.status === "already_verified") {
          setState("already_verified");
          setMessage("Este e-mail já foi verificado. Entre para continuar.");
          return;
        }
        if (
          result.status === "mfa_required" &&
          result.mfaRequired === true &&
          typeof result.challengeToken === "string"
        ) {
          setMfaChallenge(result.challengeToken);
          setState("mfa_required");
          setMessage("Confirme o segundo fator para concluir o acesso.");
          return;
        }
        if (result.status !== "verified") throw new Error("invalid verification response");
        continueToApplication();
      })
      .catch(() => {
        setState("invalid");
        setMessage("Este link é inválido, expirou ou foi substituído por um envio mais recente.");
      });
  }, [continueToApplication]);

  async function verifySecondFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code") ?? "");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) return;
    setMessage("Validando o segundo fator.");
    try {
      const response = await fetch(`${apiUrl}/v1/auth/mfa/challenge/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ challengeToken: mfaChallenge, code }),
      });
      if (!response.ok) throw new Error("invalid second factor");
      setMfaChallenge(null);
      continueToApplication();
    } catch {
      setMessage("Código inválido ou expirado. Confira o autenticador e tente novamente.");
    }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      setMessage("O reenvio ainda não está configurado neste ambiente.");
      return;
    }
    setMessage("Enviando uma nova mensagem, se a conta estiver pendente.");
    try {
      const response = await fetch(`${apiUrl}/v1/auth/email-verification/request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setMessage("Aguarde alguns instantes antes de solicitar outro envio.");
        return;
      }
      if (!response.ok) throw new Error("resend refused");
      window.sessionStorage.setItem(pendingEmailKey, email);
      setState("waiting");
      setMessage("Se o endereço estiver pendente, uma nova mensagem foi enviada.");
    } catch {
      setMessage("Não foi possível solicitar o reenvio agora. Tente novamente mais tarde.");
    }
  }

  return (
    <main id="conteudo" className="single-auth-page">
      <section className="auth-box" aria-labelledby="verification-title">
        <p className="eyebrow">Segurança da conta</p>
        <h1 id="verification-title">
          {state === "checking" ? "Verificando seu e-mail" : "Confirme seu e-mail"}
        </h1>
        {state === "waiting" && <p>Enviamos um link de uso único. Ele expira em 24 horas.</p>}
        {state === "checking" && <p aria-live="polite">Validando o link com segurança.</p>}
        <p className="form-status" role="status" aria-live="polite">
          {message}
        </p>
        {state === "mfa_required" && (
          <form className="auth-form" onSubmit={verifySecondFactor}>
            <label>
              Código do autenticador
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
              />
            </label>
            <button className="button button-primary" type="submit">
              Confirmar acesso
            </button>
          </form>
        )}
        {(state === "waiting" || state === "invalid") && (
          <form className="auth-form" onSubmit={resend}>
            <label>
              E-mail da conta
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button className="button button-secondary" type="submit">
              Reenviar verificação
            </button>
          </form>
        )}
        {(state === "already_verified" || state === "invalid") && (
          <p className="auth-footer">
            <Link href="/login">Entrar na conta</Link>
          </p>
        )}
      </section>
    </main>
  );
}
