"use client";

import { Button, Input, Label } from "@giromesa/ui";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  prepareGoogleRedirect,
  resolveLocalReturnTo,
  resolveOpsUrl,
} from "../../lib/auth-navigation";
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
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const google = parameters.get("google");
    setReturnTo(
      resolveLocalReturnTo(
        fragment.get("returnTo") ?? parameters.get("returnTo"),
        window.location.origin,
      ),
    );
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

  async function startGoogleLogin() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    const opsUrl = resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    if (!apiUrl || !opsUrl || process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true") {
      setMessage("O Google ainda não está configurado neste ambiente.");
      return;
    }
    const target = await prepareGoogleRedirect(apiUrl, {
      intent: "login",
      ...(returnTo ? { returnTo } : {}),
    });
    if (target) window.location.assign(target);
    else setMessage("Não foi possível iniciar o acesso com Google.");
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
              <Button
                className="button google-button"
                type="button"
                variant="secondary"
                onClick={() => void startGoogleLogin()}
              >
                <span aria-hidden="true">G</span> Continuar com Google
              </Button>
              <div className="divider">
                <span>ou com e-mail</span>
              </div>
            </>
          )}
          {challengeToken || oauthMfa ? (
            <form onSubmit={verifyMfa} className="auth-form">
              <Label>
                {useRecoveryCode ? "Código de recuperação" : "Código do autenticador"}
                <Input
                  type="text"
                  name="mfaProof"
                  inputMode={useRecoveryCode ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  pattern={useRecoveryCode ? undefined : "[0-9]{6}"}
                  minLength={useRecoveryCode ? 12 : 6}
                  maxLength={useRecoveryCode ? 64 : 6}
                  required
                />
              </Label>
              <Button className="button button-primary" type="submit">
                Confirmar acesso →
              </Button>
              <Button
                className="button button-secondary"
                type="button"
                onClick={() => setUseRecoveryCode((value) => !value)}
              >
                {useRecoveryCode ? "Usar autenticador" : "Usar código de recuperação"}
              </Button>
              <Button
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
              </Button>
            </form>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <Label>
                E-mail
                <Input type="email" name="email" autoComplete="email" required />
              </Label>
              <Label>
                Senha
                <span className="password-field">
                  <Input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                  <Button
                    type="button"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword((value) => !value)}
                    size="sm"
                    variant="ghost"
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </Button>
                </span>
              </Label>
              <div className="auth-options">
                <Label className="check-label">
                  <Input type="checkbox" name="trustedDevice" />
                  <span>Confiar neste dispositivo pessoal</span>
                </Label>
                <Link href="/recuperar-senha">Esqueci minha senha</Link>
              </div>
              <Button className="button button-primary" type="submit">
                Entrar →
              </Button>
            </form>
          )}
          <p className="form-status" role="status">
            {message}
          </p>
          {!challengeToken && !oauthMfa && (
            <div className="auth-footer">
              <p>
                Ainda não usa? <Link href="/criar-conta">Crie sua conta grátis</Link> e cadastre seu
                estabelecimento.
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
