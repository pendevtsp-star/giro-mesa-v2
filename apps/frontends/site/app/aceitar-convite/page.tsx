"use client";

import { Button } from "@giromesa/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { resolveOpsUrl } from "../../lib/auth-navigation";

export default function AcceptInvitationPage() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [authenticationRequired, setAuthenticationRequired] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [platformInvitation, setPlatformInvitation] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const platformToken = new URLSearchParams(window.location.hash.replace(/^#/, ""))
      .get("platform")
      ?.trim();
    const value =
      platformToken ?? new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    setPlatformInvitation(Boolean(platformToken));
    if (value.length >= 32 && value.length <= 256) setToken(value);
    else setMessage("Este link de convite é inválido ou está incompleto.");
  }, []);

  async function accept() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl || !token) {
      setMessage("O serviço de convites ainda não está configurado neste ambiente.");
      return;
    }
    setMessage("Validando convite…");
    try {
      const endpoint = platformInvitation
        ? "/v1/platform/invitations/accept"
        : "/v1/organizations/membership-invitations/accept";
      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.status === 401) {
        setAuthenticationRequired(true);
        setMessage("Entre ou crie uma conta com este mesmo e-mail para aceitar o convite.");
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { code?: string } | null;
        if (payload?.code === "PLATFORM_INVITATION_MFA_REQUIRED") {
          setMfaRequired(true);
          setMessage("Ative a autenticação em dois fatores para concluir o acesso ao backoffice.");
          return;
        }
        throw new Error("Convite recusado");
      }
      setCompleted(true);
      setMessage(
        platformInvitation
          ? "Convite aceito. Seu acesso ao backoffice já está disponível."
          : "Convite aceito. Seu acesso já está disponível.",
      );
    } catch {
      setMessage("O convite expirou, já foi utilizado ou pertence a outro e-mail.");
    }
  }

  function openOperations() {
    const base = resolveOpsUrl(process.env.NEXT_PUBLIC_OPS_URL, window.location.origin);
    const destination = base && platformInvitation ? `${base.replace(/\/$/, "")}#/platform` : base;
    if (destination) window.location.assign(destination);
    else setMessage("O destino operacional ainda não está configurado.");
  }

  const returnTo = token
    ? platformInvitation
      ? `/aceitar-convite#platform=${encodeURIComponent(token)}`
      : `/aceitar-convite?token=${encodeURIComponent(token)}`
    : "";
  const authQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  const authTarget = platformInvitation ? `#returnTo=${encodeURIComponent(returnTo)}` : authQuery;

  return (
    <main id="conteudo" className="single-auth-page">
      <section className="auth-box">
        <p className="eyebrow">Equipe GiroMesa</p>
        <h1>Aceitar convite</h1>
        <p>O convite é pessoal e só funciona com a conta vinculada ao e-mail que o recebeu.</p>
        {!completed && !authenticationRequired && !mfaRequired && (
          <Button
            className="button button-primary"
            type="button"
            onClick={accept}
            disabled={!token}
          >
            Validar e aceitar convite
          </Button>
        )}
        {authenticationRequired && (
          <div className="auth-form">
            <Link className="button button-primary" href={`/login${authTarget}`}>
              Entrar para continuar
            </Link>
            <Link className="button button-secondary" href={`/criar-conta${authTarget}`}>
              Criar conta
            </Link>
          </div>
        )}
        {mfaRequired && returnTo && (
          <Link
            className="button button-primary"
            href={`/seguranca#returnTo=${encodeURIComponent(returnTo)}`}
          >
            Ativar MFA para continuar
          </Link>
        )}
        {completed && (
          <Button className="button button-primary" type="button" onClick={openOperations}>
            {platformInvitation ? "Abrir backoffice" : "Abrir GiroMesa"}
          </Button>
        )}
        <p className="form-status" role="status">
          {message}
        </p>
        <p className="auth-footer">
          <Link href="/suporte">Precisa de ajuda?</Link>
        </p>
      </section>
    </main>
  );
}
