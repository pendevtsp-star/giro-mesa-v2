"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import {
  buildMfaProof,
  type MfaSetup,
  readMfaSetup,
  readMfaStatus,
  readRecoveryCodes,
} from "../../lib/mfa";

export default function SecurityPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableWithRecovery, setDisableWithRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  useEffect(() => {
    let active = true;
    if (!apiUrl) {
      setMessage("O serviço de segurança não está configurado neste ambiente.");
      return () => {
        active = false;
      };
    }
    void fetch(`${apiUrl}/v1/auth/mfa`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sessão necessária");
        const status = readMfaStatus(await response.json());
        if (status === null) throw new Error("Resposta inválida");
        if (active) setEnabled(status);
      })
      .catch(() => {
        if (active) setMessage("Entre novamente para gerenciar a segurança da conta.");
      });
    return () => {
      active = false;
    };
  }, [apiUrl]);

  async function beginSetup() {
    if (!apiUrl || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/v1/auth/mfa/setup`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Setup recusado");
      const value = readMfaSetup(await response.json());
      if (!value) throw new Error("Setup inválido");
      setSetup(value);
      setMessage("Adicione a chave ao autenticador e confirme o código gerado.");
    } catch {
      setMessage("Não foi possível iniciar o MFA. Confirme se sua sessão continua ativa.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiUrl || busy) return;
    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/v1/auth/mfa/setup/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error("Código recusado");
      const codes = readRecoveryCodes(await response.json());
      if (!codes) throw new Error("Resposta inválida");
      form.reset();
      setRecoveryCodes(codes);
      setSetup(null);
      setEnabled(true);
      setMessage("MFA ativado. Guarde os códigos de recuperação agora.");
    } catch {
      setMessage("Código inválido. Confira o horário do dispositivo e tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiUrl || busy) return;
    const form = event.currentTarget;
    const proof = String(new FormData(form).get("mfaProof") ?? "");
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/v1/auth/mfa/disable`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMfaProof(proof, disableWithRecovery)),
      });
      if (!response.ok) throw new Error("Desativação recusada");
      form.reset();
      setEnabled(false);
      setRecoveryCodes([]);
      setDisableWithRecovery(false);
      setMessage("MFA desativado.");
    } catch {
      setMessage("Não foi possível desativar o MFA com essa comprovação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="conteudo" className="legal-page security-page container">
      <p className="eyebrow">Conta pessoal</p>
      <h1>Segurança da conta</h1>
      <p className="security-intro">
        Use um autenticador TOTP e mantenha os códigos de recuperação fora do dispositivo de
        trabalho. A sessão é protegida por cookie seguro; esta página não usa bearer token.
      </p>

      <section className="legal-card security-card" aria-labelledby="mfa-title">
        <div className="security-card-heading">
          <div>
            <p className="eyebrow">Segundo fator</p>
            <h2 id="mfa-title">Autenticação em dois fatores</h2>
          </div>
          <span className={`security-state ${enabled === true ? "enabled" : ""}`}>
            {enabled === null
              ? message
                ? "Acesso necessário"
                : "Verificando"
              : enabled
                ? "Ativo"
                : "Inativo"}
          </span>
        </div>

        {enabled === false && !setup && (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={beginSetup}
          >
            {busy ? "Preparando…" : "Ativar MFA"}
          </button>
        )}

        {setup && (
          <form className="auth-form security-form" onSubmit={confirmSetup}>
            <div className="security-secret">
              <span>Chave manual</span>
              <code>{setup.secret}</code>
              <small>Ela fica somente na memória desta página durante a configuração.</small>
            </div>
            <a className="security-authenticator-link" href={setup.otpauthUri} rel="noreferrer">
              Abrir no aplicativo autenticador
            </a>
            <label>
              Código de 6 dígitos
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
            <div className="security-actions">
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "Confirmando…" : "Confirmar e ativar"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSetup(null);
                  setMessage("Configuração descartada deste navegador.");
                }}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        {enabled === true && recoveryCodes.length === 0 && (
          <form className="auth-form security-form" onSubmit={disable}>
            <p className="security-form-copy">
              MFA ativo. Para desativar, confirme um código TOTP atual ou um código de recuperação.
            </p>
            <label>
              {disableWithRecovery ? "Código de recuperação" : "Código de 6 dígitos"}
              <input
                name="mfaProof"
                inputMode={disableWithRecovery ? "text" : "numeric"}
                autoComplete={disableWithRecovery ? "off" : "one-time-code"}
                pattern={disableWithRecovery ? undefined : "[0-9]{6}"}
                minLength={disableWithRecovery ? 12 : 6}
                maxLength={disableWithRecovery ? 64 : 6}
                required
              />
            </label>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setDisableWithRecovery((value) => !value)}
            >
              {disableWithRecovery ? "Usar código do autenticador" : "Usar código de recuperação"}
            </button>
            <button
              className="button button-secondary security-danger"
              type="submit"
              disabled={busy}
            >
              {busy ? "Validando…" : "Desativar MFA"}
            </button>
          </form>
        )}

        {recoveryCodes.length > 0 && (
          <div className="recovery-panel" role="status">
            <h3>Códigos de recuperação de uso único</h3>
            <p className="recovery-copy">
              Guarde em local seguro. Eles não serão exibidos novamente pelo servidor.
            </p>
            <ul>
              {recoveryCodes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setRecoveryCodes([]);
                setMessage("Códigos removidos da memória desta página.");
              }}
            >
              Já guardei — ocultar códigos
            </button>
          </div>
        )}

        <p className="form-status" role="status" aria-live="polite">
          {message}
        </p>
        {enabled === null && message && (
          <p className="security-login-link">
            <Link href="/login">Entrar para gerenciar a segurança</Link>
          </p>
        )}
      </section>

      <aside className="security-note">
        <strong>Sem persistência no navegador</strong>
        <p className="security-note-copy">
          O segredo TOTP, o desafio de login e os códigos de recuperação permanecem apenas em estado
          temporário da interface. Não usamos localStorage ou sessionStorage para esses dados.
        </p>
      </aside>
    </main>
  );
}
