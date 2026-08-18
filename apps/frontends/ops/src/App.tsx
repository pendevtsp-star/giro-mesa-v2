import { useCallback, useEffect, useState } from "react";
import { ApiClientError, api, type LoginResponse, type MfaChallengeProof } from "./api";
import {
  loadAuthenticatedAccess,
  platformSession,
  sessionForScope,
  toScopeSource,
} from "./app/access";
import type { ScopeSource, Session } from "./app/types";
import {
  BootstrapError,
  LoadingScreen,
  LoginScreen,
  ScopeScreen,
} from "./features/auth/AuthScreens";
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
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");

  const restoreSession = useCallback(async () => {
    setBooting(true);
    setBootError("");
    try {
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
    try {
      await api.logout();
    } finally {
      forgetScope();
      setSession(null);
      setScopeSource(null);
    }
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
          onComplete={(nextSession) => {
            rememberScope(nextSession);
            setSession(nextSession);
          }}
        />
      );
    }
    return <LoginScreen onLogin={login} onVerifyMfa={verifyMfa} />;
  }

  return <OperationalApp session={session} onLogout={() => void logout()} />;
}
