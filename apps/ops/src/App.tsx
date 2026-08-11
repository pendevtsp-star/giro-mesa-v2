import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  type IconName,
  Progress,
  VisuallyHidden,
} from "@giromesa/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  ApiClientError,
  api,
  type LoginResponse,
  type MfaChallengeProof,
  resolveSecurityUrl,
} from "./api";
import {
  type AccessOrganization,
  type AuthenticatedAccess,
  parseAuthenticatedAccess,
  profileIdForScope,
} from "./auth";
import {
  connectShell,
  type DeviceContext,
  loadShellOperationalState,
  sendShellCommand,
} from "./bridge";
import { createCommand, enqueueCommand, queuedCommandCount } from "./commands";
import {
  alerts,
  initialTables,
  initialTickets,
  organizations,
  products,
  profileMetrics,
  profiles,
  stock,
} from "./demo-data";
import type {
  CartItem,
  DiningTable,
  KitchenTicket,
  Organization,
  Product,
  Profile,
  RouteId,
  TableStatus,
  Unit,
} from "./domain";
import {
  RealCrmPage,
  RealDeliveryPage,
  RealMultiunitPage,
  RealReservationsPage,
} from "./growth-pages";
import {
  RealCashPage,
  RealDashboard,
  RealFinancePage,
  RealInventoryPage,
  RealPeoplePage,
  RealPurchasesPage,
} from "./management";
import { OnboardingPage } from "./onboarding";
import {
  dispatchOperationalMutation,
  loadOperationalResource,
  type PilotDispatcher,
  type PilotLoader,
  replayOperationalQueue,
} from "./operational-dispatch";
import { RealCatalogPage, RealCounterPage, RealKdsPage, RealSalonPage } from "./operations";
import { RealPlatformPage } from "./platform";
import { clearPwaRuntimeState, withPwaMutation } from "./pwa-update";
import { type RealtimeStatus, subscribeScopeRealtime } from "./realtime";
import { parseRoute, routeHref } from "./router";
import {
  calculateCartTotal,
  canAccess,
  formatMoney,
  isValidTerminalPin,
  nextTicketStatus,
} from "./rules";

type Session = {
  identityId: string;
  profile: Profile;
  organization: Organization;
  unit: Unit;
  membershipId: string;
  organizationId: string;
  unitId: string;
  terminalMode: boolean;
  demo: boolean;
  platformAdmin: boolean;
};

type ScopeSource = {
  identityId: string;
  identityName: string;
  organizations: AccessOrganization[];
  demoProfile?: Profile;
  platformAdmin: boolean;
};

type SyncState = "online" | "offline" | "syncing";
type CommandRecorder = (type?: string, payload?: Record<string, unknown>) => void;

const browserRuntime: DeviceContext = {
  embedded: false,
  deviceId: "00000000-0000-4000-8000-000000000000",
  deviceName: "Navegador atual",
  platform: "web",
};

const navItems: { route: RouteId; label: string; icon: IconName }[] = [
  { route: "dashboard", label: "Visão geral", icon: "home" },
  { route: "onboarding", label: "Configurar operação", icon: "clipboard" },
  { route: "salon", label: "Salão", icon: "dish" },
  { route: "counter", label: "Balcão", icon: "counter" },
  { route: "catalog", label: "Cardápio", icon: "menu" },
  { route: "kds", label: "Produção", icon: "kitchen" },
  { route: "cash", label: "Caixa", icon: "wallet" },
  { route: "inventory", label: "Estoque", icon: "box" },
  { route: "purchases", label: "Compras", icon: "package" },
  { route: "finance", label: "Financeiro", icon: "trend-up" },
  { route: "people", label: "Pessoas", icon: "users" },
  { route: "delivery", label: "Delivery", icon: "truck" },
  { route: "reservations", label: "Reservas e espera", icon: "calendar" },
  { route: "crm", label: "Clientes e campanhas", icon: "heart" },
  { route: "multiunit", label: "Multiunidade", icon: "building" },
  { route: "platform", label: "Plataforma", icon: "platform" },
  { route: "alerts", label: "Alertas", icon: "alert" },
];

function rejectedEventCount(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;
  const events = (payload as Record<string, unknown>).rejectedEvents;
  return Array.isArray(events) ? events.length : 0;
}

export function clearSessionBeforeRemoteLogout(
  clearLocalSession: () => void,
  remoteLogout?: () => Promise<unknown>,
) {
  clearLocalSession();
  if (remoteLogout) void remoteLogout().catch(() => undefined);
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [scopeSource, setScopeSource] = useState<ScopeSource | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

  const restoreSession = useCallback(async () => {
    setBooting(true);
    setBootError("");
    if (demoMode) {
      setBooting(false);
      return;
    }
    try {
      const access = await loadAuthenticatedAccess();
      if (access.platformAdmin) setSession(platformSession(access));
      else setScopeSource(toScopeSource(access));
    } catch (error) {
      if (!(error instanceof ApiClientError && error.status === 401)) {
        setBootError(error instanceof Error ? error.message : "Não foi possível validar a sessão.");
      }
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  async function login(
    input: { email: string; password: string; trustedDevice: boolean },
    profile?: Profile,
  ): Promise<LoginResponse> {
    if (demoMode) {
      if (!profile) throw new Error("Selecione um perfil demonstrativo.");
      setScopeSource(demoScopeSource(profile));
      return { mfaRequired: false };
    }
    const result = await api.login(input);
    if (result.mfaRequired) return result;
    const access = await loadAuthenticatedAccess();
    if (access.platformAdmin) setSession(platformSession(access));
    else setScopeSource(toScopeSource(access));
    return result;
  }

  async function verifyMfa(proof: MfaChallengeProof) {
    await api.verifyMfaChallenge(proof);
    const access = await loadAuthenticatedAccess();
    if (access.platformAdmin) setSession(platformSession(access));
    else setScopeSource(toScopeSource(access));
  }

  function logout() {
    clearSessionBeforeRemoteLogout(
      () => {
        setSession(null);
        setScopeSource(null);
        void clearPwaRuntimeState();
      },
      session?.demo ? undefined : () => api.logout(),
    );
  }

  if (booting) return <LoadingScreen />;
  if (bootError)
    return <BootstrapError message={bootError} onRetry={() => void restoreSession()} />;

  if (!session) {
    if (scopeSource) {
      return (
        <ScopeScreen
          source={scopeSource}
          onBack={() => setScopeSource(null)}
          onComplete={setSession}
          onSourceChange={setScopeSource}
        />
      );
    }
    return <LoginScreen demoMode={demoMode} onLogin={login} onVerifyMfa={verifyMfa} />;
  }

  return (
    <OperationalApp session={session} onSessionChange={setSession} onLogout={() => void logout()} />
  );
}

async function loadAuthenticatedAccess(): Promise<AuthenticatedAccess> {
  const [me, scopedOrganizations] = await Promise.all([api.me(), api.organizations()]);
  return parseAuthenticatedAccess(me, scopedOrganizations);
}

function toScopeSource(access: AuthenticatedAccess): ScopeSource {
  return {
    identityId: access.identity.id,
    identityName: access.identity.displayName,
    organizations: access.organizations,
    platformAdmin: access.platformAdmin,
  };
}

function platformSession(access: AuthenticatedAccess): Session {
  const baseProfile = profiles.find((profile) => profile.id === "platform");
  if (!baseProfile) throw new Error("Perfil administrativo não configurado.");
  return {
    identityId: access.identity.id,
    profile: {
      ...baseProfile,
      name: access.identity.displayName,
      shortName: initials(access.identity.displayName),
      permissions: ["platform.manage"],
    },
    organization: {
      id: "",
      name: "Administração GiroMesa",
      document: "Escopo global",
      units: [],
    },
    unit: { id: "", name: "Visão global", timezone: "America/Sao_Paulo" },
    membershipId: "",
    organizationId: "",
    unitId: "",
    terminalMode: false,
    demo: false,
    platformAdmin: true,
  };
}

function demoScopeSource(profile: Profile): ScopeSource {
  return {
    identityId: "demo-identity",
    identityName: profile.name,
    demoProfile: profile,
    platformAdmin: false,
    organizations: organizations.map((organization) => ({
      membershipId: "demo-membership",
      organization,
      roles: [{ role: profile.id === "kitchen" ? "kds" : profile.id, unitId: null }],
    })),
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Brand() {
  return (
    <div className="brand" aria-label="GiroMesa" role="img">
      <span aria-hidden="true" className="brand__mark">
        G
      </span>
      <span>
        <strong>Giro</strong>Mesa
      </span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <Brand />
      <span className="loading-spinner" />
      <strong>Validando sua sessão…</strong>
    </main>
  );
}

function BootstrapError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="fatal-state">
      <Card>
        <Icon className="action-icon action-icon--danger" name="alert" />
        <h1>Não foi possível iniciar o GiroMesa</h1>
        <p>{message}</p>
        <Button onClick={onRetry}>Tentar novamente</Button>
      </Card>
    </main>
  );
}

function LoginScreen({
  demoMode,
  onLogin,
  onVerifyMfa,
}: {
  demoMode: boolean;
  onLogin: (
    input: { email: string; password: string; trustedDevice: boolean },
    profile?: Profile,
  ) => Promise<LoginResponse>;
  onVerifyMfa: (proof: MfaChallengeProof) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "owner");
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState(demoMode ? "demo@giromesa.com.br" : "");
  const [password, setPassword] = useState(demoMode ? "giromesa-demo" : "");
  const [trustedDevice, setTrustedDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [proofMode, setProofMode] = useState<"totp" | "recovery">("totp");
  const [mfaProof, setMfaProof] = useState("");
  const profile = profiles.find((item) => item.id === selectedId) ?? profiles[0];

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
      const result = await onLogin(
        { email, password, trustedDevice },
        demoMode ? profile : undefined,
      );
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
        <Badge tone={demoMode ? "success" : "info"}>
          {demoMode ? "Ambiente demonstrativo" : "Ambiente operacional"}
        </Badge>
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
        <small>
          {demoMode
            ? "GiroMesa V2 · Demonstração local sem integrações externas"
            : "GiroMesa V2 · Acesso protegido à sua organização"}
        </small>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          <p className="eyebrow">Acesso seguro</p>
          <h2>{challengeToken ? "Confirmar segundo fator" : "Entrar na operação"}</h2>
          <p className="muted">
            {demoMode
              ? "Use qualquer perfil demonstrativo para conhecer sua experiência."
              : "Use o e-mail vinculado à sua organização."}
          </p>
          <form onSubmit={handleSubmit} className="form-stack">
            {!challengeToken && demoMode && (
              <label>
                Perfil demonstrativo
                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value as Profile["id"])}
                >
                  {profiles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.role} — {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
              <Icon name="arrow-right" />
            </Button>
            {!challengeToken && (
              <Button
                disabled={demoMode || submitting}
                onClick={() => window.location.assign(`${api.baseUrl}/v1/auth/google/login`)}
                title={demoMode ? "Google não é usado no modo demonstrativo" : undefined}
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

function ScopeScreen({
  source,
  onBack,
  onComplete,
  onSourceChange,
}: {
  source: ScopeSource;
  onBack: () => void;
  onComplete: (session: Session) => void;
  onSourceChange: (source: ScopeSource) => void;
}) {
  const [organizationId, setOrganizationId] = useState(
    source.organizations[0]?.organization.id ?? "",
  );
  const access =
    source.organizations.find((item) => item.organization.id === organizationId) ??
    source.organizations[0];
  const accessibleUnits =
    access?.organization.units.filter(
      (unit) => source.demoProfile || profileIdForScope(access, unit.id),
    ) ?? [];
  const firstAccessibleUnitId = accessibleUnits[0]?.id ?? "";
  const [unitId, setUnitId] = useState(firstAccessibleUnitId);
  const selectedUnit = accessibleUnits.find((unit) => unit.id === unitId);
  const [terminalMode, setTerminalMode] = useState(false);
  const baseProfile =
    source.demoProfile ??
    profiles.find((item) => item.id === (access ? profileIdForScope(access, unitId) : null));
  const profile = baseProfile
    ? source.demoProfile
      ? baseProfile
      : { ...baseProfile, name: source.identityName, shortName: initials(source.identityName) }
    : null;

  useEffect(() => {
    setUnitId(firstAccessibleUnitId);
  }, [firstAccessibleUnitId]);

  if (source.organizations.length === 0) {
    return (
      <FirstOrganizationSetup
        identityName={source.identityName}
        onBack={onBack}
        onCreated={onSourceChange}
      />
    );
  }

  return (
    <main className="scope-screen">
      <div className="scope-screen__header">
        <Brand />
        <Button variant="ghost" onClick={onBack}>
          Sair
        </Button>
      </div>
      <Card className="scope-card">
        <Badge tone="success">Identidade verificada</Badge>
        <h1>Onde você vai trabalhar?</h1>
        <p className="muted">O GiroMesa limita dados e ações à empresa e unidade selecionadas.</p>
        <div className="scope-profile">
          {profile && <Avatar profile={profile} />}
          <span>
            <strong>{source.identityName}</strong>
            <small>{profile?.role ?? "Sem acesso nesta unidade"}</small>
          </span>
        </div>
        <div className="form-stack">
          <label>
            Organização
            <select
              value={organizationId}
              onChange={(event) => {
                const nextOrganizationId = event.target.value;
                const nextAccess = source.organizations.find(
                  (item) => item.organization.id === nextOrganizationId,
                );
                const nextUnit = nextAccess?.organization.units.find(
                  (unit) => source.demoProfile || profileIdForScope(nextAccess, unit.id),
                );
                setOrganizationId(nextOrganizationId);
                setUnitId(nextUnit?.id ?? "");
              }}
            >
              {source.organizations.map((item) => (
                <option key={item.organization.id} value={item.organization.id}>
                  {item.organization.name} · {item.organization.document}
                </option>
              ))}
            </select>
          </label>
          <label>
            Unidade
            <select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              {accessibleUnits.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.city ? ` · ${item.city}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="terminal-option">
            <input
              checked={terminalMode}
              onChange={(event) => setTerminalMode(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Este é um terminal compartilhado</strong>
              <small>
                Permite troca rápida de colaborador por PIN e encerra dados pessoais após
                inatividade.
              </small>
            </span>
          </label>
          <Button
            disabled={!access || !selectedUnit || !profile}
            onClick={() =>
              access &&
              selectedUnit &&
              profile &&
              onComplete({
                identityId: source.identityId,
                profile,
                organization: access.organization,
                unit: selectedUnit,
                membershipId: access.membershipId,
                organizationId: access.organization.id,
                unitId,
                terminalMode,
                demo: Boolean(source.demoProfile),
                platformAdmin: false,
              })
            }
          >
            Abrir operação
          </Button>
        </div>
      </Card>
    </main>
  );
}

function FirstOrganizationSetup({
  identityName,
  onBack,
  onCreated,
}: {
  identityName: string;
  onBack: () => void;
  onCreated: (source: ScopeSource) => void;
}) {
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [document, setDocument] = useState("");
  const [unitName, setUnitName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.createOrganization({
        legalName,
        tradeName,
        document: document.replace(/\D/g, ""),
        unitName,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
      });
      const access = await loadAuthenticatedAccess();
      onCreated(toScopeSource(access));
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 401) onBack();
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Não foi possível criar a organização e a unidade.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="scope-screen">
      <div className="scope-screen__header">
        <Brand />
        <Button variant="ghost" onClick={onBack}>
          Sair
        </Button>
      </div>
      <Card className="scope-card scope-card--first-organization">
        <Badge tone="success">Identidade verificada</Badge>
        <h1>Prepare sua primeira unidade</h1>
        <p className="muted">
          Olá, {identityName}. A organização e a unidade serão criadas juntas no servidor; o trial
          ainda não começa nesta etapa.
        </p>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Razão social
            <input
              autoComplete="organization"
              maxLength={160}
              minLength={2}
              onChange={(event) => setLegalName(event.target.value)}
              required
              value={legalName}
            />
          </label>
          <label>
            Nome do estabelecimento
            <input
              maxLength={120}
              minLength={2}
              onChange={(event) => setTradeName(event.target.value)}
              required
              value={tradeName}
            />
          </label>
          <label>
            CNPJ
            <input
              autoComplete="off"
              inputMode="numeric"
              maxLength={18}
              onChange={(event) => setDocument(event.target.value)}
              pattern="[0-9./-]*"
              required
              value={document}
            />
          </label>
          <label>
            Nome da primeira unidade
            <input
              maxLength={120}
              minLength={2}
              onChange={(event) => setUnitName(event.target.value)}
              required
              value={unitName}
            />
          </label>
          {error && (
            <p className="auth-message auth-message--error" role="alert">
              {error}
            </p>
          )}
          <Button disabled={submitting || document.replace(/\D/g, "").length !== 14} type="submit">
            {submitting ? "Criando organização..." : "Criar organização e unidade"}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function Avatar({ profile }: { profile: Profile }) {
  return (
    <span className="avatar" aria-hidden="true">
      {profile.shortName}
    </span>
  );
}

function OperationalApp({
  session,
  onSessionChange,
  onLogout,
}: {
  session: Session;
  onSessionChange: (session: Session) => void;
  onLogout: () => void;
}) {
  const [route, setRoute] = useState<RouteId>(() =>
    typeof window === "undefined" ? "dashboard" : parseRoute(window.location.hash),
  );
  const [navOpen, setNavOpen] = useState(false);
  const [profileMenu, setProfileMenu] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("online");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [scopeRevision, setScopeRevision] = useState(0);
  const [queuedCommands, setQueuedCommands] = useState(0);
  const [runtime, setRuntime] = useState<DeviceContext>(browserRuntime);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [reconciliationCount, setReconciliationCount] = useState(0);
  const [tables, setTables] = useState(initialTables);
  const [tickets, setTickets] = useState(initialTickets);
  const organization = session.organization;
  const unit = session.unit;
  const securityUrl = resolveSecurityUrl();

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    try {
      setQueuedCommands(queuedCommandCount());
      return connectShell(setRuntime);
    } catch {
      setRuntimeError(
        "O contexto do dispositivo não pôde ser carregado; a operação local continua disponível.",
      );
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (session.demo || session.platformAdmin || !runtime.embedded) {
      setReconciliationCount(0);
      return undefined;
    }
    let cancelled = false;
    const refresh = async () => {
      const state = await loadShellOperationalState("reconciliation");
      if (!cancelled && state?.success) {
        setReconciliationCount(rejectedEventCount(state.payload));
      }
    };
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [runtime.embedded, session.demo, session.platformAdmin]);

  useEffect(() => {
    if (!canAccess(session.profile, route) && route !== "onboarding") {
      window.location.hash = routeHref(session.platformAdmin ? "platform" : "dashboard");
    }
    setNavOpen(false);
  }, [route, session.platformAdmin, session.profile]);

  useEffect(() => {
    if (session.demo || session.platformAdmin) return undefined;
    return subscribeScopeRealtime(
      { organizationId: session.organizationId, unitId: session.unitId },
      () => setScopeRevision((value) => value + 1),
      setRealtimeStatus,
    );
  }, [session.demo, session.organizationId, session.platformAdmin, session.unitId]);

  useEffect(() => {
    if (session.demo || session.platformAdmin || queuedCommands === 0) return undefined;
    let cancelled = false;
    let replaying = false;
    const replay = async () => {
      if (replaying) return;
      replaying = true;
      setSyncState("syncing");
      const remaining = await withPwaMutation(() =>
        replayOperationalQueue(
          {
            organizationId: session.organizationId,
            unitId: session.unitId,
            actorId: session.identityId,
          },
          runtime,
        ),
      );
      replaying = false;
      if (cancelled) return;
      setQueuedCommands(remaining);
      if (remaining === 0) {
        setSyncState("online");
        setRuntimeError(null);
        setScopeRevision((value) => value + 1);
      } else {
        setSyncState("offline");
        setRuntimeError(
          "Há comandos preservados aguardando ACK do Hub. O aplicativo tentará entregá-los novamente sem trocar a chave idempotente.",
        );
      }
    };
    void replay();
    const timer = globalThis.setInterval(() => void replay(), 15_000);
    const online = () => void replay();
    window.addEventListener("online", online);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [queuedCommands, runtime, session]);

  const dispatchPilot = useCallback<PilotDispatcher>(
    async (type, payload, execute) => {
      try {
        const result = await withPwaMutation(() =>
          dispatchOperationalMutation({
            scope: {
              organizationId: session.organizationId,
              unitId: session.unitId,
              actorId: session.identityId,
            },
            runtime,
            type,
            payload,
            execute,
          }),
        );
        setRuntimeError(null);
        return result;
      } catch (error) {
        const count = queuedCommandCount();
        setQueuedCommands(count);
        if (count > 0) {
          setSyncState("offline");
          setRuntimeError(
            "A ação ficou na fila idempotente porque o Hub não estava acessível. O replay preservará o mesmo comando.",
          );
        }
        throw error;
      }
    },
    [runtime, session.identityId, session.organizationId, session.unitId],
  );

  const loadPilot = useCallback<PilotLoader>(
    (resource, resourceId, cloudLoader) =>
      loadOperationalResource(runtime, resource, resourceId, cloudLoader),
    [runtime],
  );

  async function recordLocalCommand(
    type = "demo.action_recorded",
    payload: Record<string, unknown> = { route },
  ) {
    try {
      const command = createCommand(runtime.deviceId, type, payload);
      if (syncState === "offline") {
        setQueuedCommands(enqueueCommand(command));
        return;
      }
      if (runtime.embedded) {
        const result = await withPwaMutation(() =>
          sendShellCommand(session.organizationId, session.unitId, session.identityId, command),
        );
        if (!result?.success) {
          setQueuedCommands(enqueueCommand(command));
          setSyncState("offline");
          setRuntimeError("O hub não confirmou a ação. Ela foi preservada na fila local.");
          return;
        }
      }
      setRuntimeError(null);
    } catch {
      setRuntimeError("A ação foi mantida na tela, mas não pôde ser enviada ao hub.");
    }
  }

  function toggleOffline() {
    if (syncState === "online") {
      setSyncState("offline");
      return;
    }
    setSyncState("syncing");
    window.setTimeout(() => {
      setSyncState("online");
    }, 900);
  }

  const visibleNav = navItems.filter((item) => canAccess(session.profile, item.route));
  const page = pageMeta[route];
  const visibleAlertCount = session.demo ? 3 : reconciliationCount;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <aside className={`sidebar ${navOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__brand">
          <Brand />
          <button
            aria-label="Fechar menu"
            className="sidebar__close"
            onClick={() => setNavOpen(false)}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="unit-chip">
          <span className="unit-chip__signal" />
          <span>
            <strong>{unit?.name ?? "Unidade"}</strong>
            <small>{runtime.embedded ? runtime.deviceName : "Navegador"} · turno desde 17:30</small>
          </span>
        </div>
        <nav aria-label="Navegação principal">
          {visibleNav.map((item) => (
            <a
              aria-current={route === item.route ? "page" : undefined}
              className={route === item.route ? "active" : ""}
              href={routeHref(item.route)}
              key={item.route}
              onClick={() => setNavOpen(false)}
            >
              <span aria-hidden="true" className="nav-icon">
                <Icon className="nav-icon__svg" name={item.icon} />
              </span>
              {item.label}
              {item.route === "alerts" && visibleAlertCount > 0 && (
                <span className="nav-count">{visibleAlertCount}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button className="support-link" onClick={() => setHelpOpen(true)} type="button">
            <Icon name="help" /> Central de ajuda
          </button>
          <small>GiroMesa Operação · {session.demo ? "demo local" : "ambiente seguro"}</small>
        </div>
      </aside>

      {navOpen && (
        <button
          aria-label="Fechar menu"
          className="nav-backdrop"
          onClick={() => setNavOpen(false)}
          type="button"
        />
      )}

      <div className="workspace">
        <header className="topbar">
          <button
            aria-label="Abrir menu"
            className="menu-button"
            onClick={() => setNavOpen(true)}
            type="button"
          >
            <Icon name="menu" />
          </button>
          <div className="topbar__title">
            <span>{organization?.name}</span>
            <strong>{page.title}</strong>
          </div>
          <div className="topbar__actions">
            <button
              className={`sync-pill sync-pill--${syncState}`}
              onClick={session.demo ? toggleOffline : undefined}
              title={`${runtime.embedded ? "Aplicativo" : "Web"} · ${runtime.deviceName}`}
              type="button"
            >
              <span />
              {!session.demo &&
                queuedCommands > 0 &&
                `Fila segura · ${queuedCommands} aguardando ACK`}
              {!session.demo &&
                queuedCommands === 0 &&
                realtimeStatus === "live" &&
                "Tempo real ativo"}
              {!session.demo &&
                queuedCommands === 0 &&
                realtimeStatus === "connecting" &&
                "Conectando tempo real…"}
              {!session.demo &&
                queuedCommands === 0 &&
                realtimeStatus === "polling" &&
                "Atualização periódica"}
              {session.demo &&
                syncState === "online" &&
                (queuedCommands
                  ? `Online · ${queuedCommands} pendente(s)`
                  : "Online · demonstrativo")}
              {session.demo && syncState === "offline" && `Offline · ${queuedCommands} na fila`}
              {session.demo && syncState === "syncing" && "Sincronizando…"}
            </button>
            <a aria-label="Ver alertas" className="alert-button" href={routeHref("alerts")}>
              <Icon name="alert" />
              {visibleAlertCount > 0 && <span>{visibleAlertCount}</span>}
            </a>
            <div className="profile-menu">
              <button
                aria-expanded={profileMenu}
                aria-label={`Abrir menu do perfil de ${session.profile.name}`}
                className="profile-button"
                onClick={() => setProfileMenu(!profileMenu)}
                type="button"
              >
                <Avatar profile={session.profile} />
                <span>
                  <strong>{session.profile.name}</strong>
                  <small>{session.profile.role}</small>
                </span>
                <Icon name="chevron-down" />
              </button>
              {profileMenu && (
                <div className="profile-popover">
                  <strong>{session.profile.name}</strong>
                  <small>{session.profile.description}</small>
                  {!session.demo && securityUrl && (
                    <a className="profile-security-link" href={securityUrl}>
                      Segurança da conta
                    </a>
                  )}
                  {session.terminalMode && (
                    <Button
                      onClick={() => {
                        setPinOpen(true);
                        setProfileMenu(false);
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Trocar colaborador por PIN
                    </Button>
                  )}
                  <Button onClick={onLogout} size="sm" variant="ghost">
                    Encerrar sessão
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>

        {syncState === "offline" && (
          <div className="offline-banner" role="status">
            {session.demo ? (
              <>
                <strong>Modo offline demonstrativo.</strong> Ações ficam preservadas neste
                dispositivo.
              </>
            ) : (
              <>
                <strong>Conectividade com o Hub interrompida.</strong> Comandos ainda não aceitos
                permanecem na fila com a mesma chave idempotente; o cache criptografado e as
                operações já aceitas continuam preservados.
              </>
            )}
          </div>
        )}

        {reconciliationCount > 0 && (
          <div className="runtime-error" role="alert">
            <strong>Reconciliação necessária:</strong> {reconciliationCount} comando(s) offline
            foram recusados pelo servidor e precisam de revisão gerencial.
          </div>
        )}

        {runtimeError && (
          <div className="runtime-error" role="alert">
            <strong>Atenção:</strong> {runtimeError}
            <button aria-label="Fechar aviso" onClick={() => setRuntimeError(null)} type="button">
              <Icon name="close" />
            </button>
          </div>
        )}

        <main className="main-content" id="main-content">
          <PageHeading title={page.title} description={page.description} />
          <PageContent
            dispatchPilot={dispatchPilot}
            loadPilot={loadPilot}
            onCommand={recordLocalCommand}
            onSessionChange={onSessionChange}
            onUnauthorized={onLogout}
            profile={session.profile}
            route={route}
            refreshToken={scopeRevision}
            session={session}
            setTables={setTables}
            setTickets={setTickets}
            tables={tables}
            tickets={tickets}
          />
        </main>
      </div>
      {pinOpen && (
        <PinDialog
          currentProfile={session.profile}
          onClose={() => setPinOpen(false)}
          onSwitch={(profile) => {
            onSessionChange({ ...session, profile });
            setPinOpen(false);
            window.location.hash = routeHref("dashboard");
          }}
        />
      )}
      {helpOpen && <HelpDrawer onClose={() => setHelpOpen(false)} route={route} />}
    </div>
  );
}

const pageMeta: Record<RouteId, { title: string; description: string }> = {
  dashboard: {
    title: "Visão geral",
    description: "O que precisa da sua atenção agora.",
  },
  onboarding: {
    title: "Configurar operação",
    description: "Do primeiro acesso a uma unidade verificável, sem iniciar o trial antes da hora.",
  },
  salon: {
    title: "Salão",
    description: "Mesas, comandas e chamados em tempo real.",
  },
  counter: {
    title: "Balcão",
    description: "Lançamento rápido para consumo local ou retirada.",
  },
  catalog: {
    title: "Cardápio operacional",
    description: "Produtos, preços, disponibilidade e complementos desta unidade.",
  },
  kds: { title: "Produção", description: "Fila de preparo por estação." },
  cash: {
    title: "Caixa",
    description: "Recebimentos, conferência e turno.",
  },
  inventory: {
    title: "Estoque",
    description: "Saldos, rupturas, consumo e reposição.",
  },
  purchases: {
    title: "Compras",
    description: "Pedidos, aprovações e recebimentos.",
  },
  finance: {
    title: "Financeiro",
    description: "Contas, conciliação e caixa projetado.",
  },
  people: {
    title: "Pessoas",
    description: "Equipe, escalas, ponto e comissões.",
  },
  delivery: {
    title: "Delivery",
    description: "Zonas próprias persistidas e limites atuais das integrações.",
  },
  reservations: {
    title: "Reservas e espera",
    description: "Agenda, recepção e transições operacionais confirmadas.",
  },
  crm: {
    title: "Clientes e campanhas",
    description: "Relacionamento, fidelidade, consentimento e status de campanhas.",
  },
  multiunit: {
    title: "Multiunidade",
    description: "Resumo consolidado dos registros persistidos na organização.",
  },
  platform: {
    title: "Plataforma",
    description: "Organizações, unidades e saúde operacional.",
  },
  alerts: {
    title: "Central de alertas",
    description: "Exceções priorizadas com ação recomendada.",
  },
};

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

function PageContent({
  dispatchPilot,
  loadPilot,
  route,
  refreshToken,
  session,
  profile,
  tables,
  setTables,
  tickets,
  setTickets,
  onCommand,
  onSessionChange,
  onUnauthorized,
}: {
  dispatchPilot: PilotDispatcher;
  loadPilot: PilotLoader;
  route: RouteId;
  refreshToken: number;
  session: Session;
  profile: Profile;
  tables: DiningTable[];
  setTables: (tables: DiningTable[]) => void;
  tickets: KitchenTicket[];
  setTickets: (tickets: KitchenTicket[]) => void;
  onCommand: CommandRecorder;
  onSessionChange: (session: Session) => void;
  onUnauthorized: () => void;
}) {
  const managementScope = {
    organizationId: session.organizationId,
    unitId: session.unitId,
    profileId: session.profile.id,
    refreshToken,
  };
  const pilotScope = {
    ...managementScope,
    membershipId: session.membershipId,
    dispatch: dispatchPilot,
    load: loadPilot,
  };
  switch (route) {
    case "dashboard":
      return session.demo ? (
        <Dashboard profile={profile} tables={tables} tickets={tickets} />
      ) : (
        <RealDashboard scope={managementScope} />
      );
    case "onboarding":
      return (
        <OnboardingPage
          onUnauthorized={onUnauthorized}
          onUnitSelected={(selectedUnitId) => {
            const selectedUnit = session.organization.units.find(
              (unit) => unit.id === selectedUnitId,
            );
            if (selectedUnit) {
              onSessionChange({ ...session, unit: selectedUnit, unitId: selectedUnit.id });
            }
          }}
          organizationId={session.organizationId}
          profileId={session.profile.id}
          unitId={session.unitId}
          units={session.organization.units}
        />
      );
    case "salon":
      return session.demo ? (
        <SalonPage onCommand={onCommand} setTables={setTables} tables={tables} />
      ) : (
        <RealSalonPage scope={pilotScope} />
      );
    case "counter":
      return session.demo ? (
        <OrderWorkspace mode="counter" onCommand={onCommand} />
      ) : (
        <RealCounterPage scope={pilotScope} />
      );
    case "catalog":
      return session.demo ? <DemoCatalogPage /> : <RealCatalogPage scope={pilotScope} />;
    case "kds":
      return session.demo ? (
        <KdsPage onCommand={onCommand} setTickets={setTickets} tickets={tickets} />
      ) : (
        <RealKdsPage scope={pilotScope} />
      );
    case "cash":
      return session.demo ? (
        <CashPage onCommand={onCommand} />
      ) : (
        <RealCashPage scope={managementScope} />
      );
    case "inventory":
      return session.demo ? <InventoryPage /> : <RealInventoryPage scope={managementScope} />;
    case "purchases":
      return session.demo ? <DemoPurchasesPage /> : <RealPurchasesPage scope={managementScope} />;
    case "finance":
      return session.demo ? <FinancePage /> : <RealFinancePage scope={managementScope} />;
    case "people":
      return session.demo ? <DemoPeoplePage /> : <RealPeoplePage scope={managementScope} />;
    case "delivery":
      return session.demo ? <DeliveryPage /> : <RealDeliveryPage scope={managementScope} />;
    case "reservations":
      return session.demo ? (
        <DemoFeaturePage title="Reservas e espera" />
      ) : (
        <RealReservationsPage scope={managementScope} />
      );
    case "crm":
      return session.demo ? (
        <DemoFeaturePage title="Clientes e campanhas" />
      ) : (
        <RealCrmPage scope={managementScope} />
      );
    case "multiunit":
      return session.demo ? (
        <DemoFeaturePage title="Visão multiunidade" />
      ) : (
        <RealMultiunitPage scope={managementScope} />
      );
    case "platform":
      return session.demo ? (
        <PlatformPage />
      ) : session.platformAdmin ? (
        <RealPlatformPage refreshToken={refreshToken} />
      ) : (
        <UnavailableRealPage title="Administração da plataforma" />
      );
    case "alerts":
      return session.demo ? <AlertsPage /> : <UnavailableRealPage title="Central de alertas" />;
  }
}

function DemoCatalogPage() {
  return (
    <div className="ops-grid ops-grid--catalog">
      {Array.from(new Set(products.map((product) => product.category))).map((category) => (
        <Card key={category}>
          <div className="section-title">
            <div>
              <p className="eyebrow">Dados demonstrativos</p>
              <h2>{category}</h2>
            </div>
          </div>
          <div className="data-list">
            {products
              .filter((product) => product.category === category)
              .map((product) => (
                <article className="data-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.description}</small>
                  </div>
                  <div className="data-row__end">
                    <strong>{formatMoney(product.priceCents)}</strong>
                    <Badge tone={product.available ? "success" : "danger"}>
                      {product.available ? "Disponível" : "Indisponível"}
                    </Badge>
                  </div>
                </article>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function DemoFeaturePage({ title }: { title: string }) {
  return (
    <Card className="honest-limit">
      <Badge tone="info">Demonstração local</Badge>
      <h2>{title}</h2>
      <p>
        Esta rota está disponível para validar navegação e permissões. Os dados reais aparecem
        apenas após autenticação em uma organização configurada.
      </p>
    </Card>
  );
}

function UnavailableRealPage({ title }: { title: string }) {
  return (
    <EmptyState
      icon={<Icon name="box" />}
      title={`${title} sem fonte autenticada`}
      description="Esta V2 não exibe fixtures em sessões reais. A tela será ativada quando houver um endpoint autenticado correspondente."
    />
  );
}

const helpTopics: Record<RouteId, { title: string; steps: string[]; warning?: string }> = {
  dashboard: {
    title: "Entender a visão geral",
    steps: [
      "Use os indicadores como atalhos para a área correspondente.",
      "Dados reais são atualizados por evento ou pela atualização periódica de segurança.",
    ],
  },
  onboarding: {
    title: "Concluir a configuração operacional",
    steps: [
      "Siga os quatro blocos e use cada atalho para configurar o recurso na tela correta.",
      "Retorne ao onboarding e atualize o status; somente o servidor confirma cada requisito.",
      "Depois dos 12 requisitos, o proprietário confirma e inicia o trial uma única vez.",
    ],
    warning:
      "KDS, impressão, QR e fiscal não ficam prontos sem evidência real ou dispensa permitida.",
  },
  salon: {
    title: "Atender uma mesa",
    steps: [
      "Selecione uma mesa livre e informe o número de pessoas.",
      "Adicione produtos e complementos; salve o pedido como rascunho.",
      "Revise o rascunho e envie à produção.",
    ],
    warning: "Transferências, divisões e cancelamentos só valem após confirmação do servidor.",
  },
  counter: {
    title: "Abrir pedido no balcão",
    steps: [
      "Informe uma identificação curta para retirada ou consumo local.",
      "Monte o pedido, salve e envie à produção.",
    ],
  },
  catalog: {
    title: "Consultar o cardápio operacional",
    steps: [
      "Confirme preço e disponibilidade antes de lançar o pedido.",
      "Produtos sem preço ou indisponíveis ficam bloqueados na operação.",
    ],
  },
  kds: {
    title: "Movimentar a produção",
    steps: [
      "Inicie apenas tickets realmente assumidos pela estação.",
      "Marque como pronto ao concluir e como retirado após a entrega.",
    ],
  },
  cash: {
    title: "Operar o caixa",
    steps: ["Confira o turno aberto.", "Registre valores somente após a confirmação física."],
  },
  inventory: {
    title: "Consultar estoque",
    steps: [
      "Priorize itens abaixo do mínimo.",
      "Use saldos persistidos como referência operacional.",
    ],
  },
  purchases: {
    title: "Acompanhar compras",
    steps: ["Revise total e prazo.", "Aprovações ficam registradas no servidor."],
  },
  finance: {
    title: "Ler o financeiro",
    steps: ["Separe contas a pagar e receber.", "Conciliação exige fonte bancária homologada."],
  },
  people: {
    title: "Acompanhar equipe",
    steps: ["Confira pessoas ativas e ponto aberto.", "Saídas registram o horário no servidor."],
  },
  delivery: {
    title: "Configurar delivery próprio",
    steps: [
      "Confira zonas, taxas e pedido mínimo.",
      "Use somente provedores explicitamente homologados.",
    ],
    warning: "Ainda não existe uma lista autenticada de pedidos de delivery nesta versão.",
  },
  reservations: {
    title: "Recepcionar clientes",
    steps: [
      "Confirme a reserva antes da chegada.",
      "Use notificar e sentar para manter a fila consistente.",
    ],
  },
  crm: {
    title: "Relacionamento responsável",
    steps: [
      "Consulte o consentimento antes de campanhas.",
      "Status bloqueado não significa mensagem enviada.",
    ],
  },
  multiunit: {
    title: "Interpretar o consolidado",
    steps: [
      "Compare unidades usando registros persistidos.",
      "Use conciliação financeira para números contábeis.",
    ],
  },
  platform: {
    title: "Administração da plataforma",
    steps: ["Use apenas ferramentas autenticadas e auditadas."],
  },
  alerts: {
    title: "Tratar alertas",
    steps: ["Priorize exceções críticas.", "Confirme a resolução na fonte operacional."],
  },
};

function HelpDrawer({ route, onClose }: { route: RouteId; onClose: () => void }) {
  const topic = helpTopics[route];
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="help-layer">
      <button aria-label="Fechar ajuda" className="help-backdrop" onClick={onClose} type="button" />
      <aside aria-labelledby="help-title" aria-modal="true" className="help-drawer" role="dialog">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Ajuda local</p>
            <h2 id="help-title">{topic.title}</h2>
          </div>
          <button
            aria-label="Fechar ajuda"
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">
          Orientações determinísticas desta versão; nenhuma resposta é gerada por IA.
        </p>
        <ol className="help-steps">
          {topic.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {topic.warning && (
          <div className="help-warning" role="note">
            <strong>Atenção</strong>
            <p>{topic.warning}</p>
          </div>
        )}
        <Button onClick={onClose}>Entendi</Button>
      </aside>
    </div>
  );
}

function Dashboard({
  profile,
  tables,
  tickets,
}: {
  profile: Profile;
  tables: DiningTable[];
  tickets: KitchenTicket[];
}) {
  const metrics = profileMetrics[profile.id] ?? [];
  const urgentTable = tables.find((table) => table.status === "attention");
  const lateTicket = tickets.find(
    (ticket) => ticket.elapsedMinutes >= 20 && ticket.status !== "ready",
  );
  return (
    <div className="dashboard-grid">
      <div className="metrics-grid">
        {metrics.map((metric, index) => (
          <Card className="metric-card" key={metric.label}>
            <span className={`metric-card__spark metric-card__spark--${index + 1}`} />
            <p>{metric.label}</p>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </Card>
        ))}
      </div>

      <Card className="attention-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Prioridades</p>
            <h2>Faça agora</h2>
          </div>
          <Badge tone="danger">3 pendências</Badge>
        </div>
        <div className="action-list">
          {urgentTable && (
            <a className="action-link" href={routeHref("salon")}>
              <Icon className="action-icon action-icon--danger" name="alert" />
              <span>
                <strong>Atender chamado da {urgentTable.name}</strong>
                <small>
                  Aberta há {urgentTable.openedMinutes} min · responsável {urgentTable.server}
                </small>
              </span>
              <Icon name="arrow-right" />
            </a>
          )}
          {lateTicket && (
            <a className="action-link" href={routeHref("kds")}>
              <Icon className="action-icon action-icon--warning" name="clock" />
              <span>
                <strong>Produção acima do tempo</strong>
                <small>
                  {lateTicket.reference} · {lateTicket.elapsedMinutes} minutos
                </small>
              </span>
              <Icon name="arrow-right" />
            </a>
          )}
          <a
            className="action-link"
            href={routeHref(canAccess(profile, "inventory") ? "inventory" : "alerts")}
          >
            <Icon className="action-icon" name="box" />
            <span>
              <strong>Repor três insumos críticos</strong>
              <small>Um item está zerado e afeta o cardápio</small>
            </span>
            <Icon name="arrow-right" />
          </a>
        </div>
      </Card>

      <Card className="pulse-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Operação ao vivo</p>
            <h2>Pulso do turno</h2>
          </div>
          <Badge tone="success">Atualizado agora</Badge>
        </div>
        <div className="pulse-grid">
          <div className="donut" aria-label="56% das mesas ocupadas" role="img">
            <span>
              <strong>56%</strong>
              <small>ocupação</small>
            </span>
          </div>
          <div className="pulse-stats">
            <div>
              <span>Mesas livres</span>
              <strong>{tables.filter((item) => item.status === "free").length}</strong>
            </div>
            <div>
              <span>Em produção</span>
              <strong>{tickets.filter((item) => item.status === "preparing").length}</strong>
            </div>
            <div>
              <span>Prontos</span>
              <strong>{tickets.filter((item) => item.status === "ready").length}</strong>
            </div>
            <div>
              <span>Chamados</span>
              <strong>{tables.filter((item) => item.status === "attention").length}</strong>
            </div>
          </div>
        </div>
      </Card>

      <Card className="shift-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Meta do turno</p>
            <h2>Vendas</h2>
          </div>
          <strong>R$ 8.742</strong>
        </div>
        <Progress label="R$ 8.742 de R$ 12.000" value={73} />
        <div className="hour-bars" aria-label="Vendas por horário" role="img">
          {[
            { time: "18h", height: 18 },
            { time: "19h", height: 31 },
            { time: "20h", height: 46 },
            { time: "21h", height: 64 },
            { time: "22h", height: 84 },
            { time: "23h", height: 72 },
            { time: "00h", height: 48 },
            { time: "01h", height: 28 },
          ].map((item) => (
            <span key={item.time} style={{ height: `${item.height}%` }}>
              <VisuallyHidden>{item.time}</VisuallyHidden>
            </span>
          ))}
        </div>
        <div className="hour-labels">
          <span>18h</span>
          <span>22h</span>
          <span>01h</span>
        </div>
      </Card>
    </div>
  );
}

const tableStatus: Record<
  TableStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  free: { label: "Livre", tone: "success" },
  occupied: { label: "Ocupada", tone: "info" },
  attention: { label: "Chamando", tone: "danger" },
  closing: { label: "Pediu conta", tone: "warning" },
  reserved: { label: "Reservada", tone: "neutral" },
};

function SalonPage({
  tables,
  setTables,
  onCommand,
}: {
  tables: DiningTable[];
  setTables: (tables: DiningTable[]) => void;
  onCommand: CommandRecorder;
}) {
  const [area, setArea] = useState<DiningTable["area"] | "Todas">("Todas");
  const [selected, setSelected] = useState<DiningTable | null>(null);
  const visible = tables.filter((table) => area === "Todas" || table.area === area);

  function occupy(table: DiningTable) {
    const updated = {
      ...table,
      status: "occupied" as const,
      server: "Lia",
      openedMinutes: 0,
      totalCents: 0,
    };
    setTables(tables.map((item) => (item.id === table.id ? updated : item)));
    setSelected(updated);
    onCommand("table.opened", { tableId: table.id });
  }

  return (
    <div className="salon-layout">
      <section>
        <div className="filters-row">
          <fieldset className="segmented">
            <legend className="gm-sr-only">Filtrar área</legend>
            {(["Todas", "Salão principal", "Varanda", "Balcão"] as const).map((item) => (
              <button
                aria-pressed={area === item}
                key={item}
                onClick={() => setArea(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </fieldset>
          <div className="legend">
            <span className="dot dot--free" />
            Livre <span className="dot dot--busy" />
            Ocupada <span className="dot dot--attention" />
            Atenção
          </div>
        </div>
        <div className="table-grid">
          {visible.map((table) => (
            <button
              className={`table-tile table-tile--${table.status} ${selected?.id === table.id ? "selected" : ""}`}
              key={table.id}
              onClick={() => setSelected(table)}
              type="button"
            >
              <span className="table-tile__top">
                <strong>{table.name}</strong>
                <Badge tone={tableStatus[table.status].tone}>
                  {tableStatus[table.status].label}
                </Badge>
              </span>
              <span className="table-tile__seats" aria-label={`${table.seats} lugares`} role="img">
                {Array.from({ length: Math.min(table.seats, 6) }, (_, index) => (
                  <Icon key={`${table.id}-seat-${index}`} name="user" />
                ))}
              </span>
              {table.status === "free" || table.status === "reserved" ? (
                <small>
                  {table.seats} lugares · {table.area}
                </small>
              ) : (
                <>
                  <strong>{formatMoney(table.totalCents ?? 0)}</strong>
                  <small>
                    {table.server} · {table.openedMinutes} min
                  </small>
                </>
              )}
            </button>
          ))}
        </div>
      </section>
      <Card className="table-drawer">
        {!selected ? (
          <EmptyState
            icon={<Icon name="dish" />}
            title="Selecione uma mesa"
            description="Veja a comanda, lance itens ou atenda chamados."
          />
        ) : (
          <>
            <div className="card-header">
              <div>
                <p className="eyebrow">{selected.area}</p>
                <h2>{selected.name}</h2>
              </div>
              <Badge tone={tableStatus[selected.status].tone}>
                {tableStatus[selected.status].label}
              </Badge>
            </div>
            {selected.status === "free" ? (
              <EmptyState
                icon={<Icon name="plus" />}
                title="Mesa disponível"
                description={`${selected.seats} lugares prontos para atendimento.`}
                action={<Button onClick={() => occupy(selected)}>Abrir comanda</Button>}
              />
            ) : selected.status === "reserved" ? (
              <>
                <div className="reservation-info">
                  <span>Reserva</span>
                  <strong>Camila · 20:30</strong>
                  <small>2 pessoas · confirmação por telefone</small>
                </div>
                <Button onClick={() => occupy(selected)}>Confirmar chegada</Button>
              </>
            ) : (
              <TableTab table={selected} onCommand={onCommand} />
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function TableTab({ table, onCommand }: { table: DiningTable; onCommand: CommandRecorder }) {
  const [ordering, setOrdering] = useState(false);
  if (ordering)
    return (
      <OrderWorkspace
        compact
        mode="table"
        onBack={() => setOrdering(false)}
        onCommand={onCommand}
        reference={table.name}
      />
    );
  return (
    <div className="tab-detail">
      {table.status === "attention" && (
        <div className="callout callout--danger">
          <strong>Cliente chamou há 4 min</strong>
          <span>Confirme o atendimento para retirar o alerta.</span>
          <Button
            size="sm"
            onClick={() => onCommand("table.call_acknowledged", { tableId: table.id })}
          >
            Assumir chamado
          </Button>
        </div>
      )}
      <div className="tab-summary">
        <span>
          <small>Responsável</small>
          <strong>{table.server}</strong>
        </span>
        <span>
          <small>Aberta há</small>
          <strong>{table.openedMinutes} min</strong>
        </span>
        <span>
          <small>Total</small>
          <strong>{formatMoney(table.totalCents ?? 0)}</strong>
        </span>
      </div>
      <div className="tab-items">
        <div>
          <span>2× Burger Aurora</span>
          <strong>{formatMoney(7780)}</strong>
        </div>
        <div>
          <span>2× Limonada da casa</span>
          <strong>{formatMoney(2900)}</strong>
        </div>
        <div>
          <span>1× Croquete de costela</span>
          <strong>{formatMoney(2990)}</strong>
        </div>
      </div>
      <div className="drawer-actions">
        <Button onClick={() => setOrdering(true)}>Adicionar itens</Button>
        <Button variant="secondary">Transferir</Button>
        <Button variant="secondary">Dividir conta</Button>
      </div>
    </div>
  );
}

function OrderWorkspace({
  mode,
  reference = "Balcão #185",
  compact = false,
  onBack,
  onCommand,
}: {
  mode: "table" | "counter";
  reference?: string;
  compact?: boolean;
  onBack?: () => void;
  onCommand: CommandRecorder;
}) {
  const [category, setCategory] = useState("Todos");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sent, setSent] = useState(false);
  const categories = ["Todos", ...new Set(products.map((product) => product.category))];
  const visible = products.filter(
    (product) =>
      (category === "Todos" || product.category === category) &&
      product.name.toLowerCase().includes(search.toLowerCase()),
  );
  const total = calculateCartTotal(cart);

  function addProduct(product: Product, modifierId?: string, note?: string) {
    const modifier = product.modifiers.find((item) => item.id === modifierId);
    setCart((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPriceCents: product.priceCents,
        modifier,
        note,
      },
    ]);
    setSelectedProduct(null);
  }

  function changeQuantity(id: string, delta: number) {
    setCart((items) =>
      items.flatMap((item) =>
        item.id === id
          ? item.quantity + delta > 0
            ? [{ ...item, quantity: item.quantity + delta }]
            : []
          : [item],
      ),
    );
  }

  function submitOrder() {
    if (!cart.length) return;
    onCommand("order.submitted", { reference, itemCount: cart.length, totalCents: total });
    setSent(true);
    setCart([]);
    window.setTimeout(() => setSent(false), 2500);
  }

  return (
    <div className={`order-workspace ${compact ? "order-workspace--compact" : ""}`}>
      <section className="catalog-panel">
        {compact && (
          <Button onClick={onBack} size="sm" variant="ghost">
            <Icon name="arrow-left" /> Voltar para comanda
          </Button>
        )}
        <div className="catalog-toolbar">
          <label className="search-field">
            <VisuallyHidden>Buscar produto</VisuallyHidden>
            <Icon name="search" />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar produto"
              value={search}
            />
          </label>
          <div className="segmented segmented--scroll">
            {categories.map((item) => (
              <button
                aria-pressed={category === item}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="product-grid">
          {visible.map((product) => (
            <button
              className="product-card"
              disabled={!product.available}
              key={product.id}
              onClick={() =>
                product.modifiers.length ? setSelectedProduct(product) : addProduct(product)
              }
              type="button"
            >
              <span
                className={`product-card__visual product-card__visual--${product.category.toLowerCase()}`}
                aria-hidden="true"
              >
                {product.name.slice(0, 1)}
              </span>
              <span>
                <strong>{product.name}</strong>
                <small>{product.description}</small>
              </span>
              <span className="product-card__price">
                <strong>{formatMoney(product.priceCents)}</strong>
                <small>{product.available ? `~${product.prepMinutes} min` : "Indisponível"}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
      <Card className={`cart-panel ${compact ? "cart-panel--compact" : ""}`}>
        <div className="card-header">
          <div>
            <p className="eyebrow">Novo pedido</p>
            <h2>{reference}</h2>
          </div>
          <Badge tone={mode === "counter" ? "info" : "success"}>
            {mode === "counter" ? "Balcão" : "Salão"}
          </Badge>
        </div>
        {sent && (
          <div className="callout callout--success" role="status">
            <strong>Pedido registrado localmente</strong>
            <span>Encaminhado para as estações de produção.</span>
          </div>
        )}
        {!cart.length ? (
          <EmptyState
            icon={<Icon name="plus" />}
            title="Comanda vazia"
            description="Toque em um produto para começar o pedido."
          />
        ) : (
          <div className="cart-items">
            {cart.map((item) => (
              <div className="cart-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  {item.modifier && (
                    <small>
                      {item.modifier.name} · {formatMoney(item.modifier.priceCents)}
                    </small>
                  )}
                  {item.note && <small>Obs.: {item.note}</small>}
                </div>
                <div className="quantity">
                  <button
                    aria-label={`Remover uma unidade de ${item.name}`}
                    onClick={() => changeQuantity(item.id, -1)}
                    type="button"
                  >
                    <Icon name="minus" />
                  </button>
                  <strong>{item.quantity}</strong>
                  <button
                    aria-label={`Adicionar uma unidade de ${item.name}`}
                    onClick={() => changeQuantity(item.id, 1)}
                    type="button"
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                <strong>
                  {formatMoney(
                    (item.unitPriceCents + (item.modifier?.priceCents ?? 0)) * item.quantity,
                  )}
                </strong>
              </div>
            ))}
          </div>
        )}
        <div className="cart-footer">
          <div>
            <span>Subtotal</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <div>
            <span>Taxa de serviço</span>
            <strong>{mode === "table" ? "Calculada no fechamento" : "—"}</strong>
          </div>
          <div className="cart-total">
            <span>Total do pedido</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <Button disabled={!cart.length} onClick={submitOrder}>
            Enviar para produção
          </Button>
          <Button variant="secondary">Salvar sem enviar</Button>
        </div>
      </Card>
      {selectedProduct && (
        <ModifierDialog
          product={selectedProduct}
          onAdd={addProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}

function ModifierDialog({
  product,
  onAdd,
  onClose,
}: {
  product: Product;
  onAdd: (product: Product, modifierId?: string, note?: string) => void;
  onClose: () => void;
}) {
  const [modifierId, setModifierId] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="modal-backdrop">
      <div aria-labelledby="modifier-title" aria-modal="true" className="dialog" role="dialog">
        <div className="card-header">
          <div>
            <p className="eyebrow">Personalizar item</p>
            <h2 id="modifier-title">{product.name}</h2>
          </div>
          <button aria-label="Fechar" className="close-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>
        <fieldset className="modifier-list">
          <legend>Escolha uma opção</legend>
          <label>
            <input
              checked={!modifierId}
              name="modifier"
              onChange={() => setModifierId("")}
              type="radio"
            />{" "}
            Padrão <strong>Incluso</strong>
          </label>
          {product.modifiers.map((modifier) => (
            <label key={modifier.id}>
              <input
                checked={modifierId === modifier.id}
                name="modifier"
                onChange={() => setModifierId(modifier.id)}
                type="radio"
              />{" "}
              {modifier.name}
              <strong>
                {modifier.priceCents ? `+ ${formatMoney(modifier.priceCents)}` : "Sem custo"}
              </strong>
            </label>
          ))}
        </fieldset>
        <label className="note-field">
          Observação
          <textarea
            maxLength={120}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Ex.: ponto da carne, alergia informada…"
            value={note}
          />
          <small>{note.length}/120</small>
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onAdd(product, modifierId || undefined, note || undefined)}>
            Adicionar ·{" "}
            {formatMoney(
              product.priceCents +
                (product.modifiers.find((item) => item.id === modifierId)?.priceCents ?? 0),
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function KdsPage({
  tickets,
  setTickets,
  onCommand,
}: {
  tickets: KitchenTicket[];
  setTickets: (tickets: KitchenTicket[]) => void;
  onCommand: CommandRecorder;
}) {
  const [station, setStation] = useState<"Todas" | KitchenTicket["station"]>("Todas");
  const visible = tickets.filter((ticket) => station === "Todas" || ticket.station === station);
  function advance(ticket: KitchenTicket) {
    setTickets(
      tickets.map((item) =>
        item.id === ticket.id ? { ...item, status: nextTicketStatus(item.status) } : item,
      ),
    );
    onCommand("kds.ticket_advanced", {
      ticketId: ticket.id,
      status: nextTicketStatus(ticket.status),
    });
  }
  const columns = ["new", "preparing", "ready"] as const;
  return (
    <div>
      <div className="filters-row">
        <div className="segmented">
          {(["Todas", "Cozinha", "Bar"] as const).map((item) => (
            <button
              aria-pressed={station === item}
              key={item}
              onClick={() => setStation(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="kds-clock">
          <span className="dot dot--free" /> Turno 18:42 · média 17 min
        </div>
      </div>
      <div className="kds-board">
        {columns.map((status) => (
          <section className={`kds-column kds-column--${status}`} key={status}>
            <header>
              <h2>
                {status === "new" ? "Novos" : status === "preparing" ? "Em preparo" : "Prontos"}
              </h2>
              <Badge
                tone={status === "new" ? "info" : status === "preparing" ? "warning" : "success"}
              >
                {visible.filter((item) => item.status === status).length}
              </Badge>
            </header>
            <div>
              {visible
                .filter((item) => item.status === status)
                .map((ticket) => (
                  <Card
                    className={`ticket ${ticket.elapsedMinutes >= 20 && status !== "ready" ? "ticket--late" : ""}`}
                    key={ticket.id}
                  >
                    <div className="ticket__header">
                      <span>
                        <Badge tone={ticket.station === "Bar" ? "info" : "neutral"}>
                          {ticket.station}
                        </Badge>
                        {ticket.priority && <Badge tone="danger">Prioridade</Badge>}
                      </span>
                      <strong>{ticket.elapsedMinutes} min</strong>
                    </div>
                    <h3>{ticket.reference}</h3>
                    <ul>
                      {ticket.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {status !== "ready" ? (
                      <Button onClick={() => advance(ticket)}>
                        {status === "new" ? "Iniciar preparo" : "Marcar pronto"}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setTickets(tickets.filter((item) => item.id !== ticket.id));
                          onCommand("kds.ticket_collected", { ticketId: ticket.id });
                        }}
                        variant="secondary"
                      >
                        Confirmar retirada
                      </Button>
                    )}
                  </Card>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CashPage({ onCommand }: { onCommand: CommandRecorder }) {
  const [received, setReceived] = useState<string[]>([]);
  const tabs = [
    { id: "c1", reference: "Mesa 04", total: 9230, age: "Pediu a conta há 6 min" },
    { id: "c2", reference: "Comanda 128", total: 6840, age: "Balcão · retirada" },
    { id: "c3", reference: "Mesa 03", total: 28740, age: "Aberta há 1h16" },
  ];
  return (
    <div className="cash-layout">
      <section className="cash-main">
        <div className="metrics-grid metrics-grid--three">
          <Card className="metric-card">
            <p>Saldo esperado</p>
            <strong>{formatMoney(536020)}</strong>
            <small>Dinheiro + cartões + Pix</small>
          </Card>
          <Card className="metric-card">
            <p>A receber</p>
            <strong>{formatMoney(44810)}</strong>
            <small>{tabs.length - received.length} comandas abertas</small>
          </Card>
          <Card className="metric-card">
            <p>Pendente de conferência</p>
            <strong>{formatMoney(42850)}</strong>
            <small>3 lançamentos</small>
          </Card>
        </div>
        <Card className="cash-list">
          <div className="card-header">
            <div>
              <p className="eyebrow">Próximos recebimentos</p>
              <h2>Comandas abertas</h2>
            </div>
            <Button size="sm" variant="secondary">
              Buscar comanda
            </Button>
          </div>
          {tabs.map((tab) => (
            <div
              className={`cash-row ${received.includes(tab.id) ? "cash-row--done" : ""}`}
              key={tab.id}
            >
              <Icon className="action-icon" name="wallet" />
              <span>
                <strong>{tab.reference}</strong>
                <small>
                  {received.includes(tab.id) ? "Recebimento demonstrativo concluído" : tab.age}
                </small>
              </span>
              <strong>{formatMoney(tab.total)}</strong>
              <Button
                disabled={received.includes(tab.id)}
                onClick={() => {
                  setReceived([...received, tab.id]);
                  onCommand("payment.completed", { tabId: tab.id, totalCents: tab.total });
                }}
                size="sm"
              >
                {received.includes(tab.id) ? "Recebido" : "Receber"}
              </Button>
            </div>
          ))}
        </Card>
      </section>
      <Card className="shift-summary">
        <div className="card-header">
          <div>
            <p className="eyebrow">Caixa 01</p>
            <h2>Turno aberto</h2>
          </div>
          <Badge tone="success">Online</Badge>
        </div>
        <div className="summary-list">
          <div>
            <span>Responsável</span>
            <strong>Bruno Luz</strong>
          </div>
          <div>
            <span>Abertura</span>
            <strong>17:30</strong>
          </div>
          <div>
            <span>Fundo de caixa</span>
            <strong>R$ 300,00</strong>
          </div>
          <div>
            <span>Sangrias</span>
            <strong>R$ 600,00</strong>
          </div>
        </div>
        <div className="callout">
          <strong>Integrações externas não configuradas</strong>
          <span>TEF e NFC-e aparecem somente após credenciais e homologação da unidade.</span>
        </div>
        <Button variant="secondary">Conferir caixa</Button>
      </Card>
    </div>
  );
}

function InventoryPage() {
  const [query, setQuery] = useState("");
  const visible = stock.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="inventory-layout">
      <Card className="inventory-table-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Posição atual</p>
            <h2>Itens de estoque</h2>
          </div>
          <label className="search-field search-field--small">
            <VisuallyHidden>Buscar insumo</VisuallyHidden>
            <Icon name="search" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar insumo"
              value={query}
            />
          </label>
        </div>
        <table className="data-table">
          <caption className="gm-sr-only">Estoque atual</caption>
          <thead>
            <tr className="data-table__head">
              <th>Insumo</th>
              <th>Quantidade</th>
              <th>Mínimo</th>
              <th>Custo</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const low = item.quantity <= item.minimum;
              return (
                <tr className="data-table__row" key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.supplier}</small>
                  </td>
                  <td>
                    <strong>
                      {item.quantity.toLocaleString("pt-BR")} {item.unit}
                    </strong>
                  </td>
                  <td>
                    {item.minimum} {item.unit}
                  </td>
                  <td>
                    {formatMoney(item.costCents)}/{item.unit}
                  </td>
                  <td>
                    <Badge tone={item.quantity === 0 ? "danger" : low ? "warning" : "success"}>
                      {item.quantity === 0 ? "Zerado" : low ? "Repor" : "Normal"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="inventory-side">
        <Card className="side-card">
          <div className="card-header">
            <h2>Reposição sugerida</h2>
            <Badge tone="warning">3 itens</Badge>
          </div>
          <div className="summary-list">
            <div>
              <span>Estimativa</span>
              <strong>R$ 642,80</strong>
            </div>
            <div>
              <span>Fornecedores</span>
              <strong>3</strong>
            </div>
            <div>
              <span>Impacto no cardápio</span>
              <strong>2 produtos</strong>
            </div>
          </div>
          <Button>Revisar pedido de compra</Button>
        </Card>
        <Card className="side-card">
          <p className="eyebrow">Contagem cíclica</p>
          <h2>82% concluída</h2>
          <Progress label="82 de 100 itens" value={82} />
          <Button variant="secondary">Continuar contagem</Button>
        </Card>
      </div>
    </div>
  );
}

function DemoPurchasesPage() {
  const [approved, setApproved] = useState<string[]>([]);
  const orders = [
    { id: "PC-1042", supplier: "Hortifruti Serra", total: 64280, status: "draft" },
    { id: "PC-1041", supplier: "Carnes Minas", total: 284000, status: "approved" },
  ];
  return (
    <Card>
      <div className="card-header">
        <div>
          <p className="eyebrow">Demonstração</p>
          <h2>Pedidos de compra</h2>
        </div>
        <Badge tone="info">Dados locais</Badge>
      </div>
      <div className="management-list">
        {orders.map((order) => {
          const isApproved = order.status === "approved" || approved.includes(order.id);
          return (
            <div className="management-row" key={order.id}>
              <span>
                <strong>{order.id}</strong>
                <small>{order.supplier}</small>
              </span>
              <strong>{formatMoney(order.total)}</strong>
              <Badge tone={isApproved ? "success" : "warning"}>
                {isApproved ? "Aprovado" : "Rascunho"}
              </Badge>
              {!isApproved && (
                <Button onClick={() => setApproved([...approved, order.id])} size="sm">
                  Aprovar demonstração
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DemoPeoplePage() {
  const team = profiles.filter((profile) => !["owner", "platform"].includes(profile.id));
  return (
    <Card>
      <div className="card-header">
        <div>
          <p className="eyebrow">Demonstração</p>
          <h2>Equipe da unidade</h2>
        </div>
        <Badge tone="success">{team.length} pessoas</Badge>
      </div>
      <div className="management-list">
        {team.map((person) => (
          <div className="management-row" key={person.id}>
            <Avatar profile={person} />
            <span>
              <strong>{person.name}</strong>
              <small>{person.role}</small>
            </span>
            <Badge tone="success">Ativa</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function FinancePage() {
  const entries = [
    {
      name: "Fornecedor Carnes Minas",
      type: "Conta a pagar",
      date: "Hoje",
      value: -284000,
      status: "Aprovação pendente",
    },
    {
      name: "Repasse delivery próprio",
      type: "Conta a receber",
      date: "Amanhã",
      value: 192040,
      status: "Previsto",
    },
    {
      name: "Energia elétrica",
      type: "Conta a pagar",
      date: "12 ago",
      value: -164730,
      status: "Agendado",
    },
    {
      name: "Eventos corporativos",
      type: "Conta a receber",
      date: "15 ago",
      value: 380000,
      status: "Vencido",
    },
  ];
  return (
    <div>
      <div className="metrics-grid">
        <Card className="metric-card">
          <p>Saldo atual</p>
          <strong>R$ 31.480</strong>
          <small>Contas conectadas manualmente</small>
        </Card>
        <Card className="metric-card">
          <p>Projetado em 30 dias</p>
          <strong>R$ 48.220</strong>
          <small>+ R$ 16.740</small>
        </Card>
        <Card className="metric-card">
          <p>A pagar</p>
          <strong>R$ 18.440</strong>
          <small>R$ 4.220 nesta semana</small>
        </Card>
        <Card className="metric-card">
          <p>A receber</p>
          <strong>R$ 9.820</strong>
          <small>3 valores vencidos</small>
        </Card>
      </div>
      <div className="finance-grid">
        <Card className="cashflow-card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Próximos 30 dias</p>
              <h2>Fluxo projetado</h2>
            </div>
            <div className="segmented">
              <button aria-pressed="true" type="button">
                30 dias
              </button>
              <button type="button">90 dias</button>
            </div>
          </div>
          <div
            className="cashflow-chart"
            aria-label="Gráfico demonstrativo de fluxo projetado"
            role="img"
          >
            <div className="chart-grid" />
            <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 600 180">
              <path
                d="M0 142 C70 112 105 131 162 95 S270 110 330 68 S445 105 600 28"
                fill="none"
                stroke="var(--gm-brand)"
                strokeWidth="5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d="M0 142 C70 112 105 131 162 95 S270 110 330 68 S445 105 600 28 L600 180 L0 180 Z"
                fill="url(#area)"
                opacity=".5"
              />
              <defs>
                <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
                  <stop stopColor="#7ac1a5" />
                  <stop offset="1" stopColor="#fff" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="hour-labels">
            <span>Hoje</span>
            <span>15 dias</span>
            <span>30 dias</span>
          </div>
        </Card>
        <Card className="finance-entries">
          <div className="card-header">
            <div>
              <p className="eyebrow">Agenda</p>
              <h2>Próximos lançamentos</h2>
            </div>
            <Button size="sm" variant="secondary">
              Ver todos
            </Button>
          </div>
          {entries.map((entry) => (
            <div className="finance-row" key={entry.name}>
              <Icon
                className={`action-icon ${entry.value < 0 ? "action-icon--warning" : ""}`}
                name={entry.value < 0 ? "arrow-down" : "arrow-up"}
              />
              <span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.type} · {entry.date}
                </small>
              </span>
              <span>
                <strong className={entry.value < 0 ? "negative" : "positive"}>
                  {formatMoney(Math.abs(entry.value))}
                </strong>
                <small>{entry.status}</small>
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function DeliveryPage() {
  const orders = [
    {
      id: "#D-094",
      customer: "Fernanda Lima",
      channel: "Canal próprio",
      value: 7460,
      time: "6 min",
      status: "Recebido",
    },
    {
      id: "#D-093",
      customer: "André Souza",
      channel: "Canal próprio",
      value: 11290,
      time: "18 min",
      status: "Em preparo",
    },
    {
      id: "#D-092",
      customer: "Beatriz Reis",
      channel: "Telefone",
      value: 5840,
      time: "31 min",
      status: "A despachar",
    },
    {
      id: "#D-091",
      customer: "Gustavo Dias",
      channel: "Canal próprio",
      value: 9630,
      time: "38 min",
      status: "Em rota",
    },
  ];
  return (
    <div>
      <div className="channel-notice">
        <Icon className="action-icon" name="info" />
        <span>
          <strong>Modo demonstrativo</strong> Marketplaces e pagamento online só serão exibidos após
          credenciais e homologação.
        </span>
      </div>
      <div className="delivery-board">
        {["Recebido", "Em preparo", "A despachar", "Em rota"].map((status) => (
          <section className="delivery-column" key={status}>
            <header>
              <h2>{status}</h2>
              <Badge
                tone={
                  status === "Em rota" ? "success" : status === "A despachar" ? "warning" : "info"
                }
              >
                {orders.filter((item) => item.status === status).length}
              </Badge>
            </header>
            {orders
              .filter((item) => item.status === status)
              .map((order) => (
                <Card className="delivery-order" key={order.id}>
                  <div>
                    <Badge>{order.channel}</Badge>
                    <strong>{order.time}</strong>
                  </div>
                  <h3>{order.id}</h3>
                  <p>{order.customer}</p>
                  <strong>{formatMoney(order.value)}</strong>
                  <Button size="sm" variant="secondary">
                    Abrir pedido
                  </Button>
                </Card>
              ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function PlatformPage() {
  const tenants = [
    { name: "Grupo Aurora", units: 2, stage: "Piloto ativo", health: "Normal" },
    { name: "Quintal da Serra", units: 1, stage: "Onboarding 72%", health: "Atenção" },
    { name: "Casa Macunaíma", units: 3, stage: "Trial ativo", health: "Normal" },
    { name: "Bistrô Horizonte", units: 1, stage: "Configuração", health: "Pendente" },
  ];
  return (
    <div>
      <div className="metrics-grid">
        <Card className="metric-card">
          <p>Organizações</p>
          <strong>18</strong>
          <small>3 em onboarding</small>
        </Card>
        <Card className="metric-card">
          <p>Unidades online</p>
          <strong>22 de 23</strong>
          <small>1 em manutenção</small>
        </Card>
        <Card className="metric-card">
          <p>Incidentes críticos</p>
          <strong>0</strong>
          <small>Últimas 24 horas</small>
        </Card>
        <Card className="metric-card">
          <p>Trials ativos</p>
          <strong>4</strong>
          <small>2 ativam esta semana</small>
        </Card>
      </div>
      <Card className="tenant-list">
        <div className="card-header">
          <div>
            <p className="eyebrow">Administração</p>
            <h2>Organizações recentes</h2>
          </div>
          <Button variant="secondary" size="sm">
            Ver catálogo comercial
          </Button>
        </div>
        {tenants.map((tenant) => (
          <div className="tenant-row" key={tenant.name}>
            <span className="tenant-logo">{tenant.name.slice(0, 1)}</span>
            <span>
              <strong>{tenant.name}</strong>
              <small>
                {tenant.units} {tenant.units === 1 ? "unidade" : "unidades"}
              </small>
            </span>
            <Badge tone={tenant.stage.includes("Onboarding") ? "warning" : "info"}>
              {tenant.stage}
            </Badge>
            <Badge
              tone={
                tenant.health === "Normal"
                  ? "success"
                  : tenant.health === "Atenção"
                    ? "warning"
                    : "neutral"
              }
            >
              {tenant.health}
            </Badge>
            <Button size="sm" variant="ghost">
              Abrir
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function AlertsPage() {
  const [resolved, setResolved] = useState<string[]>([]);
  return (
    <div className="alerts-layout">
      <Card className="alerts-list">
        <div className="card-header">
          <div>
            <p className="eyebrow">Prioridade operacional</p>
            <h2>Pendências abertas</h2>
          </div>
          <Badge tone="danger">{alerts.length - resolved.length}</Badge>
        </div>
        {alerts.map((alert) => (
          <div
            className={`alert-row ${resolved.includes(alert.id) ? "alert-row--resolved" : ""}`}
            key={alert.id}
          >
            <Icon
              className={`action-icon action-icon--${alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}`}
              name={alert.severity === "info" ? "info" : "alert"}
            />
            <span>
              <strong>{alert.title}</strong>
              <small>{resolved.includes(alert.id) ? "Resolvido nesta sessão" : alert.detail}</small>
            </span>
            <Button
              disabled={resolved.includes(alert.id)}
              onClick={() => setResolved([...resolved, alert.id])}
              size="sm"
              variant={alert.severity === "critical" ? "primary" : "secondary"}
            >
              {resolved.includes(alert.id) ? "Resolvido" : alert.action}
            </Button>
          </div>
        ))}
      </Card>
      <Card className="alert-settings">
        <p className="eyebrow">Resumo</p>
        <h2>Saúde do turno</h2>
        <div className="health-score">
          <strong>84</strong>
          <span>de 100</span>
        </div>
        <Progress label="Operação saudável" value={84} />
        <p className="muted">
          O índice considera tempo de atendimento, produção, estoque e conferência do caixa.
        </p>
        <Button variant="secondary">Revisar regras de alerta</Button>
      </Card>
    </div>
  );
}

function PinDialog({
  currentProfile,
  onClose,
  onSwitch,
}: {
  currentProfile: Profile;
  onClose: () => void;
  onSwitch: (profile: Profile) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const candidates = profiles.filter((profile) => profile.id !== "platform");
  function submit() {
    if (!isValidTerminalPin(pin)) {
      setError("Informe os quatro dígitos do PIN.");
      return;
    }
    const profile = candidates.find((item) => item.pin === pin);
    if (!profile) {
      setError("PIN demonstrativo não reconhecido.");
      return;
    }
    onSwitch(profile);
  }
  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby="pin-title"
        aria-modal="true"
        className="dialog dialog--pin"
        role="dialog"
      >
        <div className="card-header">
          <div>
            <p className="eyebrow">Terminal compartilhado</p>
            <h2 id="pin-title">Trocar colaborador</h2>
          </div>
          <button aria-label="Fechar" className="close-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className="scope-profile">
          <Avatar profile={currentProfile} />
          <span>
            <small>Sessão atual</small>
            <strong>{currentProfile.name}</strong>
          </span>
        </div>
        <label className="pin-field">
          PIN de 4 dígitos
          <input
            aria-describedby={error ? "pin-error" : undefined}
            inputMode="numeric"
            maxLength={4}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, ""));
              setError("");
            }}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            type="password"
            value={pin}
          />
        </label>
        {error && (
          <p className="field-error" id="pin-error" role="alert">
            {error}
          </p>
        )}
        <div className="demo-pin">
          <strong>PINs da demonstração</strong>
          <span>1024 proprietária · 2468 gerente · 1357 garçom · 9090 caixa</span>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pin.length !== 4} onClick={submit}>
            Trocar acesso
          </Button>
        </div>
      </div>
    </div>
  );
}
