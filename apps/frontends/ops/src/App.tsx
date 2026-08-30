import { useCallback, useEffect, useState } from "react";
import { ApiClientError, api, type LoginResponse, type MfaChallengeProof } from "./api";
import {
  loadAuthenticatedAccess,
  platformSession,
  sessionForScope,
  terminalSessionForView,
  toScopeSource,
} from "./app/access";
import type { ScopeSource, Session } from "./app/types";
import {
  BootstrapError,
  CreateOrganizationScreen,
  LoadingScreen,
  LoginScreen,
  ScopeScreen,
  TerminalLockScreen,
} from "./features/auth/AuthScreens";
import {
  type TerminalSessionView,
  terminalApi,
  terminalDeviceId,
} from "./features/auth/terminal-api";
import { OperationalApp } from "./features/shell/OperationalApp";

const scopeStorageKey = "giromesa_operational_scope_v1";

export function linkedReportScope(search = window.location.search) {
  const params = new URLSearchParams(search);
  const organizationId = params.get("reportOrganization");
  const unitId = params.get("reportUnit");
  return organizationId && unitId ? { organizationId, unitId } : null;
}

function forgetScope() {
  try {
    localStorage.removeItem(scopeStorageKey);
  } catch {}
}

function readScope(identityId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(scopeStorageKey) ?? "null") as unknown;
    if (
      !value ||
      typeof value !== "object" ||
      !("identityId" in value) ||
      !("organizationId" in value) ||
      !("unitId" in value) ||
      value.identityId !== identityId ||
      typeof value.organizationId !== "string" ||
      typeof value.unitId !== "string"
    ) {
      forgetScope();
      return null;
    }
    return { organizationId: value.organizationId, unitId: value.unitId };
  } catch {
    forgetScope();
    return null;
  }
}

function rememberScope(session: Session) {
  if (session.terminalMode || session.platformAdmin) {
    forgetScope();
    return;
  }
  try {
    localStorage.setItem(
      scopeStorageKey,
      JSON.stringify({
        identityId: session.identityId,
        organizationId: session.organizationId,
        unitId: session.unitId,
      }),
    );
  } catch {}
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [scopeSource, setScopeSource] = useState<ScopeSource | null>(null);
  const [terminalView, setTerminalView] = useState<TerminalSessionView | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");

  const restoreSession = useCallback(async () => {
    setBooting(true);
    setBootError("");
    try {
      await api.assertCompatibility();
      try {
        const view = await terminalApi.status();
        setTerminalView(view);
        setSession(terminalSessionForView(view));
        setScopeSource(null);
        return;
      } catch (error) {
        if (!(error instanceof ApiClientError && error.status === 401)) throw error;
      }
      const access = await loadAuthenticatedAccess();
      if (access.platformAdmin) setSession(platformSession(access));
      else {
        const source = toScopeSource(access);
        const linked = linkedReportScope();
        const remembered = readScope(source.identityId);
        const restored = linked
          ? sessionForScope(source, linked.organizationId, linked.unitId, false)
          : remembered
            ? sessionForScope(source, remembered.organizationId, remembered.unitId, false)
            : null;
        if (restored) setSession(restored);
        else {
          forgetScope();
          setScopeSource(source);
        }
      }
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

  async function login(input: {
    email: string;
    password: string;
    trustedDevice: boolean;
  }): Promise<LoginResponse> {
    const result = await api.login(input);
    if (result.mfaRequired) return result;
    const access = await loadAuthenticatedAccess();
    if (access.platformAdmin) setSession(platformSession(access));
    else {
      const source = toScopeSource(access);
      const linked = linkedReportScope();
      const restored = linked
        ? sessionForScope(source, linked.organizationId, linked.unitId, false)
        : null;
      if (restored) setSession(restored);
      else setScopeSource(source);
    }
    return result;
  }

  async function verifyMfa(proof: MfaChallengeProof) {
    await api.verifyMfaChallenge(proof);
    const access = await loadAuthenticatedAccess();
    if (access.platformAdmin) setSession(platformSession(access));
    else {
      const source = toScopeSource(access);
      const linked = linkedReportScope();
      const restored = linked
        ? sessionForScope(source, linked.organizationId, linked.unitId, false)
        : null;
      if (restored) setSession(restored);
      else setScopeSource(source);
    }
  }

  async function logout() {
    if (terminalView) await terminalApi.close();
    else await api.logout();
    forgetScope();
    setSession(null);
    setScopeSource(null);
    setTerminalView(null);
  }

  async function unlockTerminal(membershipId: string, pin: string) {
    const view = await terminalApi.unlock({ membershipId, pin });
    const nextSession = terminalSessionForView(view);
    if (!nextSession) throw new Error("O operador não possui perfil operacional nesta unidade.");
    setTerminalView(view);
    setSession(nextSession);
  }

  const lockTerminal = useCallback(async (reason: "idle" | "switch" = "idle") => {
    if (reason === "idle") setSession(null);
    try {
      const view = await terminalApi.lock(reason);
      setTerminalView(view);
      setSession(null);
    } catch (error) {
      if (reason === "switch") throw error;
    }
  }, []);

  useEffect(() => {
    if (!session?.terminalMode || session.actorEpoch === undefined || !terminalView) return;
    const actorEpoch = session.actorEpoch;
    const idleMs = terminalView.idleTimeoutSeconds * 1_000;
    let timeout = globalThis.setTimeout(() => void lockTerminal(), idleMs);
    let lastPingAt = Date.now();
    const registerActivity = () => {
      globalThis.clearTimeout(timeout);
      timeout = globalThis.setTimeout(() => void lockTerminal(), idleMs);
      if (Date.now() - lastPingAt < 30_000) return;
      lastPingAt = Date.now();
      void terminalApi.activity(actorEpoch).catch(() => void lockTerminal());
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const event of events) window.addEventListener(event, registerActivity, { passive: true });
    return () => {
      globalThis.clearTimeout(timeout);
      for (const event of events) window.removeEventListener(event, registerActivity);
    };
  }, [session, terminalView, lockTerminal]);

  if (booting) return <LoadingScreen />;
  if (bootError)
    return <BootstrapError message={bootError} onRetry={() => void restoreSession()} />;

  if (!session) {
    if (terminalView) {
      return <TerminalLockScreen onClose={logout} onUnlock={unlockTerminal} view={terminalView} />;
    }
    if (scopeSource) {
      if (scopeSource.organizations.length === 0) {
        return (
          <CreateOrganizationScreen
            identityName={scopeSource.identityName}
            onBack={logout}
            onCreated={restoreSession}
          />
        );
      }
      return (
        <ScopeScreen
          source={scopeSource}
          onBack={() => setScopeSource(null)}
          onConfigurePin={async (input) => {
            await terminalApi.configurePin(input);
          }}
          onComplete={async (nextSession) => {
            if (nextSession.terminalMode) {
              const view = await terminalApi.create({
                organizationId: nextSession.organizationId,
                unitId: nextSession.unitId,
                deviceId: terminalDeviceId(),
              });
              forgetScope();
              setScopeSource(null);
              setTerminalView(view);
              setSession(null);
              return;
            }
            rememberScope(nextSession);
            setSession(nextSession);
          }}
        />
      );
    }
    return <LoginScreen onLogin={login} onVerifyMfa={verifyMfa} />;
  }

  return (
    <OperationalApp
      session={session}
      onLogout={logout}
      onSwitchUser={session.terminalMode ? () => lockTerminal("switch") : undefined}
    />
  );
}
