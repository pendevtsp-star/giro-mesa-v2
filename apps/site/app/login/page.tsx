"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { resolveLocalReturnTo, resolveOpsUrl } from "../../lib/auth-navigation";
import { buildMfaProof, readMfaChallenge } from "../../lib/mfa";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [oauthMfa, setOauthMfa] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const google = parameters.get("google");
    setReturnTo(resolveLocalReturnTo(parameters.get("returnTo"), window.location.origin));
    if (google === "mfa") {
      setOauthMfa(true);
      setMessage("Confirme o segundo fator para concluir o acesso com Google.");
    } else if (google === "failed") {
      setMessage("Não foi possível concluir o acesso com Google. Tente novamente ou use e-mail.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      setMessage("O serviço de autenticação ainda não está configurado neste ambiente.");
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
    try {
      const response = await fetch(`${apiUrl}/v1/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
          trustedDevice: data.has("trustedDevice"),
        }),
      });
      if (!response.ok) throw new Error("Falha de acesso");
      const payload: unknown = await response.json();
      const mfaChallenge = readMfaChallenge(payload);
      const mfaRequired =
        typeof payload === "object" &&
        payload !== null &&
        "mfaRequired" in payload &&
        payload.mfaRequired === true;
      if (mfaRequired) {
        if (!mfaChallenge) throw new Error("Desafio MFA inválido");
        setChallengeToken(mfaChallenge);
        setMessage("Confirme o segundo fator para concluir o acesso.");
        return;
      }
      window.location.assign(destination);
    } catch {
      setMessage("Não foi possível entrar. Revise os dados ou recupere sua senha.");
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const destination = returnTo
      ? new URL(returnTo, window.location.origin).toString()
      : resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (!apiUrl || !destination) {
      setMessage("O acesso seguro ainda não está configurado neste ambiente.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const value = String(data.get("mfaProof") ?? "").trim();
    try {
      const response = await fetch(
        `${apiUrl}/v1/auth/${oauthMfa ? "mfa/oauth/verify" : "mfa/challenge/verify"}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(oauthMfa ? {} : { challengeToken }),
            ...buildMfaProof(value, useRecoveryCode),
          }),
        },
      );
      if (!response.ok) throw new Error("Falha de MFA");
      window.location.assign(destination);
    } catch {
      setMessage("Código inválido ou expirado. Tente novamente.");
    }
  }

  function startGoogleLogin() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const opsUrl = resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (!apiUrl || !opsUrl || process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true") {
      setMessage("O Google ainda não está configurado neste ambiente.");
      return;
    }
    const target = new URL(`${apiUrl}/v1/auth/google/login`);
    if (returnTo) target.searchParams.set("returnTo", returnTo);
    window.location.assign(target.toString());
  }

  return (
    <main id="conteudo" className="auth-page">
      <section className="auth-story">
        <div>
          <p className="eyebrow">Seu turno em contexto</p>
          <h1>Entre para conduzir a operação.</h1>
          <p>
            A mesma identidade pode acessar suas empresas e unidades com permissões específicas.
          </p>
        </div>
        <blockquote>
          “O painel certo para cada função, sem esconder o que precisa de atenção.”
          <small>Princípio de produto · não é depoimento de cliente</small>
        </blockquote>
      </section>
      <section className="auth-panel" aria-labelledby="login-title">
        <div className="auth-box">
          <p className="eyebrow">Acesso seguro</p>
          <h2 id="login-title">Entrar no GiroMesa</h2>
          <p>
            Use sua conta pessoal. Em terminais compartilhados, acesse pelo dispositivo cadastrado.
          </p>
          {!challengeToken && !oauthMfa && (
            <>
              <button className="button google-button" type="button" onClick={startGoogleLogin}>
                <span aria-hidden="true">G</span> Continuar com Google
              </button>
              <div className="divider">
                <span>ou com e-mail</span>
              </div>
            </>
          )}
          {challengeToken || oauthMfa ? (
            <form onSubmit={verifyMfa} className="auth-form">
              <label>
                {useRecoveryCode ? "Código de recuperação" : "Código do autenticador"}
                <input
                  type="text"
                  name="mfaProof"
                  inputMode={useRecoveryCode ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  pattern={useRecoveryCode ? undefined : "[0-9]{6}"}
                  minLength={useRecoveryCode ? 12 : 6}
                  maxLength={useRecoveryCode ? 64 : 6}
                  required
                />
              </label>
              <button className="button button-primary" type="submit">
                Confirmar acesso →
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setUseRecoveryCode((value) => !value)}
              >
                {useRecoveryCode ? "Usar autenticador" : "Usar código de recuperação"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setChallengeToken("");
                  setOauthMfa(false);
                  setUseRecoveryCode(false);
                  setMessage("");
                }}
              >
                Voltar
              </button>
            </form>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <label>
                E-mail
                <input type="email" name="email" autoComplete="email" required />
              </label>
              <label>
                Senha
                <span className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </span>
              </label>
              <div className="auth-options">
                <label className="check-label">
                  <input type="checkbox" name="trustedDevice" />
                  <span>Confiar neste dispositivo pessoal</span>
                </label>
                <Link href="/recuperar-senha">Esqueci minha senha</Link>
              </div>
              <button className="button button-primary" type="submit">
                Entrar →
              </button>
            </form>
          )}
          <p className="form-status" role="status">
            {message}
          </p>
          {!challengeToken && !oauthMfa && (
            <div className="auth-footer">
              <p>
                Ainda não usa? <Link href="/criar-conta">Crie sua identidade</Link> ou solicite um{" "}
                <Link href="/teste-gratis">teste assistido</Link>.
              </p>
              <p>
                <Link href="/seguranca">Segurança da conta, MFA e recuperação</Link>
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
