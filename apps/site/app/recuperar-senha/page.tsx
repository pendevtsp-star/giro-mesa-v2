"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    if (token.length >= 32 && token.length <= 256) setResetToken(token);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      setMessage("A recuperação ainda não está configurada neste ambiente.");
      return;
    }
    const email = new FormData(event.currentTarget).get("email");
    try {
      const response = await fetch(`${apiUrl}/v1/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("Recuperação indisponível");
      setMessage("Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.");
    } catch {
      setMessage("Não foi possível solicitar a recuperação agora. Tente novamente mais tarde.");
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!apiUrl || !resetToken) {
      setMessage("O link de recuperação é inválido ou está incompleto.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("passwordConfirmation") ?? "")) {
      setMessage("As senhas não coincidem.");
      return;
    }
    try {
      const response = await fetch(`${apiUrl}/v1/auth/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, password }),
      });
      if (!response.ok) throw new Error("Recuperação recusada");
      setCompleted(true);
      setMessage("Senha atualizada. Todas as sessões anteriores foram encerradas.");
    } catch {
      setMessage("O link é inválido, expirou ou já foi utilizado. Solicite um novo.");
    }
  }

  return (
    <main id="conteudo" className="single-auth-page">
      <section className="auth-box">
        <p className="eyebrow">Recuperação segura</p>
        <h1>{resetToken ? "Criar nova senha" : "Redefinir senha"}</h1>
        {resetToken ? (
          <>
            <p>Use uma senha nova com pelo menos 12 caracteres.</p>
            {!completed && (
              <form className="auth-form" onSubmit={confirm}>
                <label>
                  Nova senha
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </label>
                <label>
                  Confirmar nova senha
                  <input
                    type="password"
                    name="passwordConfirmation"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </label>
                <button className="button button-primary" type="submit">
                  Atualizar senha
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <p>Informe seu e-mail. Por segurança, a resposta não confirma se existe uma conta.</p>
            <form className="auth-form" onSubmit={submit}>
              <label>
                E-mail
                <input type="email" name="email" autoComplete="email" required />
              </label>
              <button className="button button-primary" type="submit">
                Enviar instruções
              </button>
            </form>
          </>
        )}
        <p className="form-status" role="status">
          {message}
        </p>
        <p className="auth-footer">
          <Link href="/login">← Voltar para o login</Link>
        </p>
      </section>
    </main>
  );
}
