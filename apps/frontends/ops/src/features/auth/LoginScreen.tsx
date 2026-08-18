import { Badge, Button } from "@giromesa/ui";
import { type FormEvent, useState } from "react";
import { api, type LoginResponse, type MfaChallengeProof } from "../../api";
import { Brand } from "./Brand";
export function LoginScreen({
  onLogin,
  onVerifyMfa,
}: {
  onLogin: (input: {
    email: string;
    password: string;
    trustedDevice: boolean;
  }) => Promise<LoginResponse>;
  onVerifyMfa: (proof: MfaChallengeProof) => Promise<void>;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [proofMode, setProofMode] = useState<"totp" | "recovery">("totp");
  const [mfaProof, setMfaProof] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (challengeToken) {
        const proof =
          proofMode === "totp"
            ? { challengeToken, code: mfaProof }
            : { challengeToken, recoveryCode: mfaProof };
        await onVerifyMfa(proof);
        return;
      }
      const result = await onLogin({ email, password, trustedDevice });
      if (result.mfaRequired) {
        setChallengeToken(result.challengeToken);
        setPassword("");
        setNotice("Confirme o segundo fator para concluir o acesso.");
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  async function requestReset() {
    setError("");
    if (!email.trim()) {
      setError("Informe seu e-mail para solicitar a redefinição.");
      return;
    }
    try {
      await api.requestPasswordReset(email);
      setNotice("Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Não foi possível solicitar a redefinição.",
      );
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Brand />
        <Badge tone="info">Ambiente operacional</Badge>
        <div>
          <p className="eyebrow">O turno inteiro em um só lugar</p>
          <h1>O ritmo da casa, sem perder o controle.</h1>
          <p>
            Atendimento, produção, caixa e gestão conectados — mesmo quando a internet não
            acompanha.
          </p>
        </div>
        <ol className="auth-story__flow" aria-label="Fluxo operacional">
          <li>Pedido recebido</li>
          <li>Produção acompanhada</li>
          <li>Caixa conferido</li>
        </ol>
        <small>GiroMesa V2 · Acesso protegido à sua organização</small>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <p className="eyebrow">Acesso seguro</p>
          <h2>{challengeToken ? "Confirmar segundo fator" : "Entrar na operação"}</h2>
          <p className="muted">Use o e-mail vinculado à sua organização.</p>
          <form onSubmit={handleSubmit} className="form-stack">
            {!challengeToken && (
              <label>
                E-mail
                <input
                  autoComplete="username"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
            )}
            {!challengeToken && (
              <label>
                Senha
                <span className="password-field">
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword(!showPassword)}
                    type="button"
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </span>
              </label>
            )}
            {!challengeToken && (
              <div className="form-inline">
                <label className="check-label">
                  <input
                    checked={trustedDevice}
                    onChange={(event) => setTrustedDevice(event.target.checked)}
                    type="checkbox"
                  />{" "}
                  Confiar neste dispositivo pessoal
                </label>
                <button className="link-button" onClick={() => void requestReset()} type="button">
                  Esqueci minha senha
                </button>
              </div>
            )}
            {challengeToken && (
              <>
                <fieldset className="segmented mfa-method">
                  <legend className="gm-sr-only">Método do segundo fator</legend>
                  <button
                    aria-pressed={proofMode === "totp"}
                    onClick={() => {
                      setProofMode("totp");
                      setMfaProof("");
                    }}
                    type="button"
                  >
                    Aplicativo autenticador
                  </button>
                  <button
                    aria-pressed={proofMode === "recovery"}
                    onClick={() => {
                      setProofMode("recovery");
                      setMfaProof("");
                    }}
                    type="button"
                  >
                    Código de recuperação
                  </button>
                </fieldset>
                <label>
                  {proofMode === "totp" ? "Código de 6 dígitos" : "Código de recuperação"}
                  <input
                    autoComplete="one-time-code"
                    inputMode={proofMode === "totp" ? "numeric" : "text"}
                    maxLength={proofMode === "totp" ? 6 : 64}
                    minLength={proofMode === "totp" ? 6 : 12}
                    onChange={(event) =>
                      setMfaProof(
                        proofMode === "totp"
                          ? event.target.value.replace(/\D/g, "")
                          : event.target.value,
                      )
                    }
                    pattern={proofMode === "totp" ? "[0-9]{6}" : undefined}
                    required
                    value={mfaProof}
                  />
                </label>
                <button
                  className="link-button"
                  onClick={() => {
                    setChallengeToken("");
                    setMfaProof("");
                    setError("");
                    setNotice("");
                  }}
                  type="button"
                >
                  Voltar ao login
                </button>
              </>
            )}
            {error && (
              <p className="auth-message auth-message--error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="auth-message" role="status">
                {notice}
              </p>
            )}
            <Button disabled={submitting} type="submit">
              {submitting
                ? "Validando acesso…"
                : challengeToken
                  ? "Confirmar acesso"
                  : "Entrar no GiroMesa"}{" "}
              <span aria-hidden="true">→</span>
            </Button>
            {!challengeToken && (
              <Button
                disabled={submitting}
                onClick={() => window.location.assign(`${api.baseUrl}/v1/auth/google/login`)}
                variant="secondary"
                type="button"
              >
                Continuar com Google
              </Button>
            )}
          </form>
          <p className="auth-footnote">
            Terminal compartilhado? Entre normalmente e cadastre o dispositivo na unidade.
          </p>
        </div>
      </section>
    </main>
  );
}
