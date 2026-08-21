import { Button, Card, Icon, type IconName, Modal, SearchField } from "@giromesa/ui";
import { type ChangeEvent, Suspense, useCallback, useEffect, useState } from "react";
import { api, type TerminalProfile } from "../../api";
import { PageContent, PageHeading, pageMeta } from "../../app/PageContent";
import type { Session, SyncState } from "../../app/types";
import { connectShell, type DeviceContext, loadShellOperationalState } from "../../bridge";
import { queuedCommandCount } from "../../commands";
import type { RouteId } from "../../domain";
import { parseReservations, parseWaitlist } from "../../growth.shared";
import { parsePeopleCapabilities } from "../../management.shared";
import {
  dispatchOperationalMutation,
  loadOperationalResource,
  type PilotDispatcher,
  type PilotLoader,
  replayOperationalQueue,
} from "../../operational-dispatch";
import { type RealtimeStatus, subscribeScopeRealtime } from "../../realtime";
import { parseRoute, routeHref } from "../../router";
import { canAccess } from "../../rules";
import { Brand } from "../auth/AuthScreens";
import { CustomerDisplayPage, customerDisplayTabIdFromHash } from "../counter/CustomerDisplayPage";
import {
  KDS_NAVIGATION_EVENT,
  type KdsArea,
  kdsAreaHref,
  kdsStationMenuLabel,
  parseKdsArea,
  readKdsLastOperationalArea,
  resolveKdsAreaPermission,
  saveKdsLastOperationalArea,
} from "../kds/kds.navigation";
import { TimeClockBanner } from "../people/TimeClockBanner";
import { HelpDrawer } from "./HelpDrawer";
import { ManagerApprovalInbox } from "./ManagerApprovalInbox";
import { OperationalAttentionInbox } from "./OperationalAttentionInbox";
import {
  ProfileAvatar as Avatar,
  profileAvatarFileError,
  profileAvatarStorageKey,
} from "./ProfileAvatar";
import { TerminalProfileSettings } from "./TerminalProfileSettings";
import { readActiveTerminalProfile, saveTerminalProfile } from "./terminal-profile";

const browserInstallationId = () => {
  if (typeof window === "undefined") return "00000000-0000-4000-8000-000000000000";
  const key = "giromesa:browser-installation-id";
  try {
    const stored = window.localStorage.getItem(key);
    if (
      stored &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)
    ) {
      return stored;
    }
    const created = crypto.randomUUID();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
};

const browserRuntime: DeviceContext = {
  embedded: false,
  deviceId: browserInstallationId(),
  deviceName: "Navegador atual",
  platform: "web",
};

const navItems: { route: RouteId; label: string; icon: IconName; group: string }[] = [
  { route: "dashboard", label: "Visão geral", icon: "dashboard", group: "Operação" },
  { route: "salon", label: "Mesas e comandas", icon: "salon", group: "Operação" },
  { route: "counter", label: "Balcão e retirada", icon: "counter", group: "Operação" },
  { route: "catalog", label: "Cardápio", icon: "catalog", group: "Operação" },
  { route: "kds", label: "Produção KDS", icon: "kds", group: "Operação" },
  { route: "cash", label: "Contas e caixa", icon: "cash", group: "Operação" },
  { route: "delivery", label: "Delivery", icon: "delivery", group: "Operação" },
  {
    route: "reservations",
    label: "Recepção e espera",
    icon: "reservations",
    group: "Operação",
  },
  { route: "inventory", label: "Estoque", icon: "inventory", group: "Gestão" },
  { route: "purchases", label: "Compras", icon: "purchases", group: "Gestão" },
  { route: "finance", label: "Financeiro", icon: "finance", group: "Gestão" },
  { route: "reports", label: "Relatórios", icon: "dashboard", group: "Gestão" },
  { route: "fiscal", label: "Fiscal", icon: "finance", group: "Gestão" },
  { route: "accountant", label: "Contador", icon: "people", group: "Gestão" },
  { route: "people", label: "Pessoas", icon: "people", group: "Gestão" },
  {
    route: "waiter-settlements",
    label: "Fechamento da equipe",
    icon: "people",
    group: "Gestão",
  },
  { route: "crm", label: "Clientes & CRM", icon: "crm", group: "Gestão" },
  { route: "multiunit", label: "Multiunidade", icon: "multiunit", group: "Sistema" },
  { route: "platform", label: "Plataforma", icon: "platform", group: "Sistema" },
  { route: "alerts", label: "Alertas", icon: "alerts", group: "Sistema" },
];

const centralOperationalRoutes: RouteId[] = ["reservations", "salon", "counter", "cash"];

function isCentralOperationalRoute(route: RouteId) {
  return centralOperationalRoutes.includes(route);
}

function lastOperationalRouteStorageKey(session: Pick<Session, "identityId" | "unitId">) {
  return `giromesa:last-route:${session.identityId}:${session.unitId}`;
}

export function resolveInitialOperationalRoute(
  hash: string,
  storedRoute: string | null,
  session: Session,
): RouteId {
  if (session.platformAdmin) return "platform";
  const candidate =
    hash.length > 1
      ? parseRoute(hash)
      : storedRoute
        ? parseRoute(storedRoute.startsWith("#") ? storedRoute : `#/${storedRoute}`)
        : "dashboard";
  return canAccess(session.profile, candidate) && pageMeta[candidate] !== undefined
    ? candidate
    : "dashboard";
}

function rejectedEventCount(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;
  const events = (payload as Record<string, unknown>).rejectedEvents;
  return Array.isArray(events) ? events.length : 0;
}

function formatClockPart(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { ...options, timeZone }).format(value);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", options).format(value);
  }
}

function OperationalClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = globalThis.setInterval(() => setNow(new Date()), 60_000);
    return () => globalThis.clearInterval(interval);
  }, []);

  const date = formatClockPart(now, timeZone, {
    day: "2-digit",
    month: "short",
    weekday: "short",
  });
  const time = formatClockPart(now, timeZone, {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  });

  return (
    <time
      className="topbar-clock"
      dateTime={now.toISOString()}
      title={`${date}, ${time} (${timeZone})`}
    >
      <span className="sr-only">Data e hora da unidade: </span>
      <Icon name="clock" size={14} />
      <span className="topbar-clock__date">{date}</span>
      <strong className="topbar-clock__time">{time}</strong>
    </time>
  );
}

export function OperationalApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const lastRouteStorageKey = lastOperationalRouteStorageKey(session);
  const canManageKdsUnitSettings =
    ["owner", "manager"].includes(session.profile.id) &&
    session.profile.permissions.includes("catalog.manage");
  const [route, setRoute] = useState<RouteId>(() => {
    if (typeof window === "undefined") return session.platformAdmin ? "platform" : "dashboard";
    let storedRoute: string | null = null;
    try {
      storedRoute =
        readActiveTerminalProfile(session.unitId)?.defaultRoute ??
        window.localStorage.getItem(lastRouteStorageKey);
    } catch {}
    return resolveInitialOperationalRoute(window.location.hash, storedRoute, session);
  });
  const [kdsArea, setKdsArea] = useState<KdsArea>(() =>
    typeof window === "undefined"
      ? "station"
      : parseKdsArea(window.location.hash, readKdsLastOperationalArea(session.unitId)),
  );
  const [kdsNavigationOpen, setKdsNavigationOpen] = useState(route === "kds");
  const [kdsStationLabel, setKdsStationLabel] = useState(() => kdsStationMenuLabel(session.unitId));
  const [navOpen, setNavOpen] = useState(false);
  const [centralOperationalOpen, setCentralOperationalOpen] = useState(true);
  const [centralMobileOpen, setCentralMobileOpen] = useState(false);
  const [receptionPendingCount, setReceptionPendingCount] = useState<number | null>(null);
  const [scopeRevision, setScopeRevision] = useState(0);
  const [profileMenu, setProfileMenu] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("giromesa_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void scopeRevision;
    if (!canAccess(session.profile, "reservations")) {
      setReceptionPendingCount(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        const to = new Date(from);
        to.setDate(to.getDate() + 2);
        const [reservationPayload, waitlistPayload] = await Promise.all([
          api.growth.reservations(session.organizationId, session.unitId, {
            scope: "active",
            from: from.toISOString(),
            to: to.toISOString(),
            limit: 100,
          }),
          api.growth.waitlist(session.organizationId, session.unitId, {
            scope: "active",
            limit: 100,
          }),
        ]);
        if (active) {
          setReceptionPendingCount(
            parseReservations(reservationPayload).length + parseWaitlist(waitlistPayload).length,
          );
        }
      } catch {
        if (active) setReceptionPendingCount(null);
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, [scopeRevision, session.organizationId, session.profile, session.unitId]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("giromesa_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  }, []);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [networkPopoverOpen, setNetworkPopoverOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(profileAvatarStorageKey(session.identityId));
    } catch {
      return null;
    }
  });

  function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const validationError = profileAvatarFileError(file);
    if (validationError) {
      setAvatarError(validationError);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => setAvatarError("Não foi possível ler a imagem.");
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setAvatarError("Não foi possível ler a imagem.");
        return;
      }
      try {
        window.localStorage.setItem(profileAvatarStorageKey(session.identityId), reader.result);
        setAvatarUrl(reader.result);
        setAvatarError("");
      } catch {
        setAvatarError("Não foi possível salvar a foto neste dispositivo.");
      }
    };
    reader.readAsDataURL(file);
  }

  function removeAvatar() {
    try {
      window.localStorage.removeItem(profileAvatarStorageKey(session.identityId));
      setAvatarUrl(null);
      setAvatarError("");
    } catch {
      setAvatarError("Não foi possível remover a foto deste dispositivo.");
    }
  }

  function togglePopover(name: "network" | "profile") {
    setNetworkPopoverOpen(name === "network" ? !networkPopoverOpen : false);
    setProfileMenu(name === "profile" ? !profileMenu : false);
  }

  function closeAllPopovers() {
    setNetworkPopoverOpen(false);
    setProfileMenu(false);
  }

  const hasAnyPopoverOpen = networkPopoverOpen || profileMenu;

  // Global Keyboard Shortcuts (Ctrl+K, F1-F4, Esc)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        setNetworkPopoverOpen(false);
        setProfileMenu(false);
        setShortcutsModalOpen(false);
        setNavOpen(false);
      } else if (e.key === "F1") {
        e.preventDefault();
        window.location.hash = routeHref("salon");
      } else if (e.key === "F2") {
        e.preventDefault();
        window.location.hash = routeHref("counter");
      } else if (e.key === "F3") {
        e.preventDefault();
        window.location.hash = kdsAreaHref(readKdsLastOperationalArea(session.unitId));
      } else if (e.key === "F4") {
        e.preventDefault();
        window.location.hash = routeHref("cash");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [session.unitId, toggleSidebar]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("giromesa-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [compactNavigation, setCompactNavigation] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 900px)").matches,
  );
  const [syncState, setSyncState] = useState<SyncState>("online");
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [peopleNavAllowed, setPeopleNavAllowed] = useState<boolean | null>(null);
  const [queuedCommands, setQueuedCommands] = useState(0);
  const [runtime, setRuntime] = useState<DeviceContext>(browserRuntime);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [reconciliationCount, setReconciliationCount] = useState(0);
  const [terminalProfile, setTerminalProfile] = useState<TerminalProfile | null>(() =>
    typeof window === "undefined" ? null : readActiveTerminalProfile(session.unitId),
  );
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  const organization = session.organization;
  const unit = session.unit;

  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (session.platformAdmin) return;
    let active = true;
    void api.pilot
      .terminalProfile(session.organizationId, session.unitId, runtime.deviceId)
      .then((profile) => {
        if (!active || !profile) return;
        saveTerminalProfile(profile);
        setTerminalProfile(profile);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [runtime.deviceId, session.organizationId, session.platformAdmin, session.unitId]);

  useEffect(() => {
    try {
      setAvatarUrl(window.localStorage.getItem(profileAvatarStorageKey(session.identityId)));
    } catch {
      setAvatarUrl(null);
    }
    setAvatarError("");
  }, [session.identityId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("giromesa-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!commandPaletteOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("shell-command-search")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [commandPaletteOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setCompactNavigation(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = parseRoute(window.location.hash);
      setRoute(nextRoute);
      if (nextRoute !== "kds") return;
      const parsedArea = parseKdsArea(
        window.location.hash,
        readKdsLastOperationalArea(session.unitId),
      );
      const nextArea = resolveKdsAreaPermission(
        parsedArea,
        canManageKdsUnitSettings,
        readKdsLastOperationalArea(session.unitId),
      );
      if (nextArea !== "settings") saveKdsLastOperationalArea(session.unitId, nextArea);
      setKdsArea(nextArea);
      setKdsNavigationOpen(true);
      if (window.location.hash !== kdsAreaHref(nextArea)) {
        window.history.replaceState(null, "", kdsAreaHref(nextArea));
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [canManageKdsUnitSettings, session.unitId]);

  useEffect(() => {
    if (route !== "kds") return;
    const parsedArea = parseKdsArea(
      window.location.hash,
      readKdsLastOperationalArea(session.unitId),
    );
    const nextArea = resolveKdsAreaPermission(
      parsedArea,
      canManageKdsUnitSettings,
      readKdsLastOperationalArea(session.unitId),
    );
    setKdsArea(nextArea);
    if (window.location.hash !== kdsAreaHref(nextArea)) {
      window.history.replaceState(null, "", kdsAreaHref(nextArea));
    }
  }, [canManageKdsUnitSettings, route, session.unitId]);

  useEffect(() => {
    const updateKdsNavigation = () => setKdsStationLabel(kdsStationMenuLabel(session.unitId));
    updateKdsNavigation();
    window.addEventListener(KDS_NAVIGATION_EVENT, updateKdsNavigation);
    window.addEventListener("storage", updateKdsNavigation);
    return () => {
      window.removeEventListener(KDS_NAVIGATION_EVENT, updateKdsNavigation);
      window.removeEventListener("storage", updateKdsNavigation);
    };
  }, [session.unitId]);

  useEffect(() => {
    if (isCentralOperationalRoute(route)) setCentralOperationalOpen(true);
    if (route === "kds") setKdsNavigationOpen(true);
  }, [route]);

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
    if (session.platformAdmin || !runtime.embedded) {
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
  }, [runtime.embedded, session.platformAdmin]);

  useEffect(() => {
    if (session.platformAdmin && route !== "platform") {
      window.location.hash = routeHref("platform");
    } else if (
      !canAccess(session.profile, route) ||
      (route === "people" && peopleNavAllowed === false)
    ) {
      window.location.hash = routeHref(session.platformAdmin ? "platform" : "dashboard");
    }
    setNavOpen(false);
  }, [peopleNavAllowed, route, session.platformAdmin, session.profile]);

  useEffect(() => {
    if (session.platformAdmin) return undefined;
    return subscribeScopeRealtime(
      { organizationId: session.organizationId, unitId: session.unitId },
      () => setScopeRevision((value) => value + 1),
      setRealtimeStatus,
    );
  }, [session.organizationId, session.platformAdmin, session.unitId]);

  useEffect(() => {
    if (session.platformAdmin || !canAccess(session.profile, "people")) {
      setPeopleNavAllowed(null);
      return;
    }
    let active = true;
    void api.management
      .peopleCapabilities(session.organizationId, session.unitId)
      .then(parsePeopleCapabilities)
      .then((value) => active && setPeopleNavAllowed(value.canView))
      .catch(() => active && setPeopleNavAllowed(null));
    return () => {
      active = false;
    };
  }, [session.organizationId, session.platformAdmin, session.profile, session.unitId]);

  useEffect(() => {
    if (session.platformAdmin || queuedCommands === 0) return undefined;
    let cancelled = false;
    let replaying = false;
    const replay = async () => {
      if (replaying) return;
      replaying = true;
      setSyncState("syncing");
      const remaining = await replayOperationalQueue(
        {
          organizationId: session.organizationId,
          unitId: session.unitId,
          actorId: session.identityId,
        },
        runtime,
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
        const result = await dispatchOperationalMutation({
          scope: {
            organizationId: session.organizationId,
            unitId: session.unitId,
            actorId: session.identityId,
          },
          runtime,
          type,
          payload,
          execute,
        });
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

  const visibleNav = navItems
    .filter((item) => canAccess(session.profile, item.route))
    .filter((item) => item.route !== "people" || peopleNavAllowed !== false)
    .filter((item) => item.route !== "alerts")
    .filter((item) => pageMeta[item.route] !== undefined);
  const authorizedCentralItems = centralOperationalRoutes
    .map((centralRoute) => visibleNav.find((item) => item.route === centralRoute))
    .filter((item): item is (typeof navItems)[number] => Boolean(item));
  const centralMobileNav =
    visibleNav.find((item) => item.route === route && isCentralOperationalRoute(item.route)) ??
    authorizedCentralItems[0];
  const orderedMobileNav = [
    "kds",
    "cash",
    "delivery",
    "inventory",
    "purchases",
    "finance",
    "reservations",
    "catalog",
    "platform",
    "dashboard",
  ]
    .map((candidate) => visibleNav.find((item) => item.route === candidate))
    .filter((item): item is (typeof navItems)[number] => Boolean(item))
    .filter((item) => !isCentralOperationalRoute(item.route));
  const dashboardNav = session.platformAdmin
    ? undefined
    : orderedMobileNav.find((item) => item.route === "dashboard");
  const mobileNav = [
    ...(centralMobileNav ? [centralMobileNav] : []),
    ...orderedMobileNav.filter((item) => item.route !== "dashboard").slice(0, 2),
    ...(dashboardNav ? [dashboardNav] : []),
  ].slice(0, 4);
  const safeRoute: RouteId = session.platformAdmin
    ? "platform"
    : canAccess(session.profile, route) &&
        pageMeta[route] !== undefined &&
        (route !== "people" || peopleNavAllowed !== false)
      ? route
      : "dashboard";
  const terminalQuickActions = (terminalProfile?.quickActions ?? []).flatMap((action) => {
    const definition =
      action === "open_tab"
        ? { label: "Abrir mesa", route: "salon" as const }
        : action === "new_order"
          ? { label: "Novo pedido", route: "counter" as const }
          : action === "receive"
            ? { label: "Receber", route: "counter" as const }
            : action === "waitlist"
              ? { label: "Fila", route: "reservations" as const }
              : action === "print"
                ? { label: "Imprimir", route: "counter" as const }
                : action === "search"
                  ? { label: "Buscar", route: null }
                  : null;
    if (!definition || (definition.route && !canAccess(session.profile, definition.route)))
      return [];
    return [{ action, ...definition }];
  });
  const lastKdsOperationalArea =
    kdsArea === "settings" ? readKdsLastOperationalArea(session.unitId) : kdsArea;

  function navigationHref(item: (typeof navItems)[number]): string {
    return item.route === "kds" ? kdsAreaHref(lastKdsOperationalArea) : routeHref(item.route);
  }

  useEffect(() => {
    if (session.platformAdmin || safeRoute !== route) return;
    try {
      window.localStorage.setItem(lastRouteStorageKey, route);
    } catch {}
    if (window.location.hash.length <= 1 && route !== "dashboard") {
      window.history.replaceState(null, "", routeHref(route));
    }
  }, [lastRouteStorageKey, route, safeRoute, session.platformAdmin]);

  const page =
    safeRoute === "kds"
      ? kdsArea === "settings"
        ? {
            title: "Configurações do KDS",
            description: "Terminal, praças, fluxo e aparência da produção.",
          }
        : kdsArea === "pass"
          ? {
              title: "Passe / expedição",
              description: "Conferência final e entrega de pedidos concluídos pelas praças.",
            }
          : pageMeta.kds
      : (pageMeta[safeRoute] ?? pageMeta.dashboard);
  const sidebarIsCollapsed = sidebarCollapsed && !navOpen;
  const realtimeLabel =
    realtimeStatus === "live"
      ? "Tempo real ativo"
      : realtimeStatus === "polling"
        ? "Atualização periódica"
        : "Conectando ao tempo real";
  const networkTone =
    syncState === "offline"
      ? "offline"
      : syncState === "syncing" || realtimeStatus === "connecting"
        ? "syncing"
        : realtimeStatus === "polling"
          ? "polling"
          : "online";
  const networkLabel =
    syncState === "offline"
      ? "Offline"
      : syncState === "syncing"
        ? "Sincronizando"
        : queuedCommands > 0
          ? `${queuedCommands} na fila`
          : realtimeStatus === "connecting"
            ? "Conectando"
            : realtimeStatus === "polling"
              ? "Atualização periódica"
              : "Online";
  const networkIcon: IconName =
    networkTone === "offline"
      ? "alert-circle"
      : networkTone === "syncing"
        ? "refresh"
        : networkTone === "polling"
          ? "clock"
          : "check";
  const normalizedCommandQuery = commandQuery.trim().toLocaleLowerCase("pt-BR");
  const commandResults = visibleNav.filter((item) => {
    if (!normalizedCommandQuery) return true;
    const meta = pageMeta[item.route];
    if (!meta) return false;
    return `${isCentralOperationalRoute(item.route) ? "Central Operacional " : ""}${item.label} ${meta.title} ${meta.description}`
      .toLocaleLowerCase("pt-BR")
      .includes(normalizedCommandQuery);
  });
  const customerDisplayTabId =
    safeRoute === "counter" && typeof window !== "undefined"
      ? customerDisplayTabIdFromHash(window.location.hash)
      : null;

  if (customerDisplayTabId) {
    return (
      <CustomerDisplayPage
        organizationId={session.organizationId}
        refreshToken={scopeRevision}
        tabId={customerDisplayTabId}
        unitId={session.unitId}
        unitName={session.unit.name}
      />
    );
  }

  function renderNavItem(item: (typeof navItems)[number]) {
    return (
      <a
        aria-current={route === item.route ? "page" : undefined}
        className={route === item.route ? "active" : ""}
        href={navigationHref(item)}
        key={item.route}
      >
        <span aria-hidden="true" className="nav-icon">
          <Icon name={item.icon} size={18} />
        </span>
        <span className="nav-label">{item.label}</span>
        {item.route === "reservations" &&
          receptionPendingCount !== null &&
          receptionPendingCount > 0 && <span className="nav-count">{receptionPendingCount}</span>}
      </a>
    );
  }

  function renderKdsNavigation(item: (typeof navItems)[number]) {
    const active = route === "kds";
    const children: Array<{ area: KdsArea; label: string }> = [
      { area: "station", label: kdsStationLabel },
      { area: "pass", label: "Passe / expedição" },
      ...(canManageKdsUnitSettings
        ? ([{ area: "settings", label: "Configurações" }] satisfies Array<{
            area: KdsArea;
            label: string;
          }>)
        : []),
    ];
    return (
      <div className={`nav-submenu ${active ? "nav-submenu--active" : ""}`} key={item.route}>
        <div className="nav-submenu__parent">
          <a
            aria-current={active && sidebarIsCollapsed ? "page" : undefined}
            className={active ? "active" : ""}
            href={kdsAreaHref(lastKdsOperationalArea)}
            title={sidebarIsCollapsed ? item.label : undefined}
          >
            <span aria-hidden="true" className="nav-icon">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="nav-label">{item.label}</span>
          </a>
          <Button
            aria-controls="kds-navigation-children"
            aria-expanded={kdsNavigationOpen}
            aria-label={`${kdsNavigationOpen ? "Recolher" : "Expandir"} áreas do Produção KDS`}
            className="nav-submenu__toggle"
            onClick={() => setKdsNavigationOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true">⌄</span>
          </Button>
        </div>
        <div
          className="nav-submenu__children"
          hidden={!kdsNavigationOpen || sidebarIsCollapsed}
          id="kds-navigation-children"
        >
          {children.map((child) => {
            const current = active && kdsArea === child.area;
            return (
              <a
                aria-current={current ? "page" : undefined}
                className={current ? "active" : ""}
                href={kdsAreaHref(child.area)}
                key={child.area}
              >
                <span className="nav-submenu__marker" aria-hidden="true" />
                <span className="nav-label">{child.label}</span>
              </a>
            );
          })}
        </div>
      </div>
    );
  }

  function renderNavigationItem(item: (typeof navItems)[number]) {
    return item.route === "kds" ? renderKdsNavigation(item) : renderNavItem(item);
  }

  return (
    <div className={`app-shell ${terminalProfile?.compact ? "app-shell--terminal-compact" : ""}`}>
      <a className="skip-link" href="#main-content">
        Ir para o conteúdo
      </a>
      <aside
        className={`sidebar ${sidebarIsCollapsed ? "sidebar--collapsed" : ""} ${navOpen ? "sidebar--open" : ""}`}
        id="primary-sidebar"
      >
        <div className="sidebar__brand">
          <Brand />
          <Button
            aria-controls="primary-sidebar"
            aria-label="Fechar menu"
            className="sidebar__close"
            onClick={() => setNavOpen(false)}
            type="button"
          >
            ×
          </Button>
        </div>
        <div className="unit-chip">
          <span
            aria-hidden="true"
            className={`unit-chip__signal unit-chip__signal--${networkTone}`}
          />
          <span>
            <strong>{unit?.name ?? "Unidade"}</strong>
            <small>Sessão operacional</small>
          </span>
        </div>
        {(!compactNavigation || navOpen) && (
          <nav aria-label="Navegação principal">
            {["Operação", "Gestão", "Sistema"].map((groupName) => {
              const itemsInGroup = visibleNav.filter((i) => i.group === groupName);
              if (itemsInGroup.length === 0) return null;
              const centralItems = centralOperationalRoutes
                .map((centralRoute) => itemsInGroup.find((item) => item.route === centralRoute))
                .filter((item): item is (typeof navItems)[number] => Boolean(item));
              const regularItems = itemsInGroup.filter(
                (item) => !isCentralOperationalRoute(item.route),
              );
              return (
                <div key={groupName} className="nav-group">
                  <div className="nav-group__title">{groupName}</div>
                  {regularItems
                    .filter((item) => item.route === "dashboard")
                    .map(renderNavigationItem)}
                  {centralItems.length > 0 && (
                    <details
                      aria-label="Central Operacional"
                      onToggle={(event) => setCentralOperationalOpen(event.currentTarget.open)}
                      open={centralOperationalOpen}
                    >
                      <summary className="nav-group__title">Central Operacional</summary>
                      {centralItems.map(renderNavigationItem)}
                    </details>
                  )}
                  {regularItems
                    .filter((item) => item.route !== "dashboard")
                    .map(renderNavigationItem)}
                </div>
              );
            })}
          </nav>
        )}
        <div className="sidebar__footer">
          <Button
            aria-pressed={sidebarIsCollapsed}
            className="sidebar__toggle-btn"
            onClick={toggleSidebar}
            size="sm"
            aria-label={sidebarIsCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={
              sidebarIsCollapsed
                ? "Expandir menu lateral (Ctrl+B)"
                : "Recolher menu lateral (Ctrl+B)"
            }
            variant="ghost"
          >
            <Icon name={sidebarIsCollapsed ? "arrow-down" : "arrow-up"} size={14} />
            {!sidebarIsCollapsed && <span>Recolher menu</span>}
          </Button>

          <Button
            className="support-link"
            onClick={() => setHelpOpen(true)}
            size="sm"
            title="Central de ajuda"
            variant="ghost"
          >
            <span aria-hidden="true" className="support-link__icon">
              ?
            </span>
            {!sidebarIsCollapsed && <span className="support-link__label">Central de ajuda</span>}
          </Button>
          {!sidebarIsCollapsed && <small>GiroMesa Operação</small>}
        </div>
      </aside>

      {navOpen && (
        <Button
          aria-label="Fechar menu"
          className="nav-backdrop"
          onClick={() => setNavOpen(false)}
          type="button"
        />
      )}

      <div className={`workspace ${sidebarIsCollapsed ? "workspace--collapsed" : ""}`}>
        {hasAnyPopoverOpen && (
          <Button
            aria-label="Fechar menu aberto"
            className="popover-backdrop"
            onClick={closeAllPopovers}
            type="button"
          />
        )}

        <header className="topbar">
          <div className="topbar__left">
            <Button
              aria-controls="primary-sidebar"
              aria-expanded={navOpen}
              aria-label="Abrir menu"
              className="menu-button"
              onClick={() => setNavOpen(true)}
              size="sm"
              variant="ghost"
            >
              ☰
            </Button>
            <div className="topbar__scope">
              <span className="org-label">{organization.name}</span>
              <strong className="unit-label">{unit.name}</strong>
            </div>
          </div>

          <div className="topbar__center">
            <Button
              className="topbar__command-bar"
              onClick={() => {
                closeAllPopovers();
                setCommandPaletteOpen(true);
              }}
              variant="secondary"
              title="Ir para módulo (Ctrl+K)"
            >
              <Icon name="search" size={14} />
              <span>Ir para módulo</span>
              <kbd>Ctrl + K</kbd>
            </Button>
          </div>

          <div className="topbar__actions">
            <OperationalAttentionInbox
              canCounter={canAccess(session.profile, "counter")}
              canSalon={canAccess(session.profile, "salon")}
              onChanged={() => setScopeRevision((value) => value + 1)}
              onNavigate={(target) => {
                window.location.hash = routeHref(target);
              }}
              organizationId={session.organizationId}
              realtimeStatus={realtimeStatus}
              refreshToken={scopeRevision}
              unitId={session.unitId}
            />
            <ManagerApprovalInbox
              disabled={session.platformAdmin}
              onChanged={() => setScopeRevision((value) => value + 1)}
              organizationId={session.organizationId}
              profileId={session.profile.id}
              unitId={session.unitId}
            />

            <OperationalClock timeZone={unit.timezone} />

            <div className="topbar__popover-anchor">
              <Button
                aria-label={`Conectividade: ${networkLabel}`}
                aria-controls="network-diagnostics"
                aria-expanded={networkPopoverOpen}
                className={`sync-pill sync-pill--${networkTone}`}
                onClick={() => togglePopover("network")}
                size="sm"
                title="Diagnóstico de conectividade e fila de contingência"
                variant="secondary"
              >
                <span aria-hidden="true" className="sync-pill__icon">
                  <Icon name={networkIcon} size={13} />
                </span>
                <span className="sync-pill__text">{networkLabel}</span>
              </Button>

              {networkPopoverOpen && (
                <section
                  aria-label="Diagnóstico de conectividade"
                  className="network-diagnostics-popover-box"
                  id="network-diagnostics"
                >
                  <div className="network-diagnostics__header">
                    <strong>Conectividade</strong>
                    <span
                      className={`network-diagnostics__status network-diagnostics__status--${networkTone}`}
                    >
                      {networkLabel}
                    </span>
                  </div>
                  <dl className="network-diagnostics__list">
                    <div>
                      <dt>Sincronização</dt>
                      <dd>
                        {syncState === "online"
                          ? "Em dia"
                          : syncState === "syncing"
                            ? "Em andamento"
                            : "Sem conexão"}
                      </dd>
                    </div>
                    <div>
                      <dt>Atualizações</dt>
                      <dd>{realtimeLabel}</dd>
                    </div>
                    <div>
                      <dt>Fila local</dt>
                      <dd>
                        {queuedCommands === 0
                          ? "Sem pendências"
                          : `${queuedCommands} pendente${queuedCommands === 1 ? "" : "s"}`}
                      </dd>
                    </div>
                    {reconciliationCount > 0 && (
                      <div>
                        <dt>Reconciliação</dt>
                        <dd>{reconciliationCount} para revisar</dd>
                      </div>
                    )}
                  </dl>
                  <Button variant="ghost" size="sm" onClick={() => setNetworkPopoverOpen(false)}>
                    Fechar
                  </Button>
                </section>
              )}
            </div>

            <div className="profile-menu">
              <Button
                aria-controls="profile-popover"
                aria-expanded={profileMenu}
                aria-label={`Abrir menu do perfil de ${session.profile.name}`}
                className="profile-button"
                onClick={() => togglePopover("profile")}
                size="sm"
                variant="ghost"
              >
                <Avatar imageUrl={avatarUrl} profile={session.profile} />
                <span>
                  <strong>{session.profile.name}</strong>
                  <small>{session.profile.role}</small>
                </span>
                <span aria-hidden="true">⌄</span>
              </Button>
              {profileMenu && (
                <section
                  aria-label="Menu do perfil"
                  className="profile-popover"
                  id="profile-popover"
                >
                  <div className="profile-popover__identity">
                    <Avatar imageUrl={avatarUrl} profile={session.profile} />
                    <span>
                      <strong>{session.profile.name}</strong>
                      <small>{session.profile.role}</small>
                      <span className="profile-avatar-actions">
                        <label className="profile-avatar-upload">
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            onChange={handleAvatarUpload}
                            type="file"
                          />
                          <Icon name="upload" size={11} />
                          {avatarUrl ? "Trocar foto" : "Adicionar foto"}
                        </label>
                        {avatarUrl && (
                          <Button onClick={removeAvatar} size="sm" variant="ghost" type="button">
                            Remover
                          </Button>
                        )}
                      </span>
                    </span>
                  </div>
                  <small className="profile-avatar-device-note">
                    Foto salva somente neste dispositivo.
                  </small>
                  {avatarError && (
                    <small className="profile-avatar-error" role="alert">
                      {avatarError}
                    </small>
                  )}

                  <div className="profile-popover__tools">
                    {["owner", "manager"].includes(session.profile.id) && (
                      <Button
                        className="theme-toggle"
                        onClick={() => {
                          closeAllPopovers();
                          setTerminalSettingsOpen(true);
                        }}
                        variant="ghost"
                      >
                        <span aria-hidden="true">
                          <Icon name="settings" size={14} />
                        </span>
                        <span>
                          <strong>Configurar terminal</strong>
                          <small>Tela inicial, impressora e atalhos</small>
                        </span>
                      </Button>
                    )}
                    <Button
                      aria-pressed={theme === "dark"}
                      className="theme-toggle"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                      variant="ghost"
                    >
                      <span aria-hidden="true" className="theme-toggle__glyph">
                        Aa
                      </span>
                      <span>
                        <strong>{theme === "dark" ? "Tema claro" : "Tema escuro"}</strong>
                        <small>Alternar aparência</small>
                      </span>
                    </Button>

                    <Button
                      className="theme-toggle"
                      onClick={() => {
                        closeAllPopovers();
                        setShortcutsModalOpen(true);
                      }}
                      variant="ghost"
                    >
                      <span aria-hidden="true">
                        <Icon name="list" size={14} />
                      </span>
                      <span>
                        <strong>Atalhos do teclado</strong>
                        <small>Ctrl + K e teclas F1–F4</small>
                      </span>
                    </Button>
                  </div>

                  <div className="profile-popover__session-actions">
                    <Button
                      className="profile-popover__logout"
                      onClick={onLogout}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon name="logout" size={14} />
                      Encerrar sessão
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </div>
        </header>

        <Modal
          className="shell-command-modal"
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
          size="md"
          title="Ir para módulo"
        >
          <SearchField
            aria-label="Buscar módulo"
            className="command-palette__search"
            id="shell-command-search"
            onChange={(event) => setCommandQuery(event.target.value)}
            placeholder="Digite o nome do módulo"
            value={commandQuery}
          />
          <div aria-live="polite" className="command-palette__results">
            <p className="command-palette__eyebrow">Navegação disponível</p>
            {commandResults.map((item) => (
              <Button
                className="command-palette__result"
                key={item.route}
                onClick={() => {
                  window.location.hash = navigationHref(item);
                  setCommandPaletteOpen(false);
                  setCommandQuery("");
                }}
                variant="ghost"
              >
                <span aria-hidden="true" className="command-palette__result-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{pageMeta[item.route]?.description}</small>
                </span>
              </Button>
            ))}
            {commandResults.length === 0 && (
              <p className="command-palette__empty">
                Nenhum módulo disponível corresponde à busca.
              </p>
            )}
          </div>
        </Modal>

        <Modal
          className="shell-shortcuts-modal"
          isOpen={shortcutsModalOpen}
          onClose={() => setShortcutsModalOpen(false)}
          size="sm"
          title="Atalhos do operador"
        >
          <div className="shortcut-list">
            {[
              { key: "Ctrl + K", label: "Ir para módulo" },
              { key: "Ctrl + B", label: "Recolher ou expandir o menu lateral" },
              { key: "F1", label: "Atendimento de mesas" },
              { key: "F2", label: "Atendimento de balcão" },
              { key: "F3", label: "Produção KDS" },
              { key: "F4", label: "Frente de caixa" },
              { key: "Esc", label: "Fechar menus e janelas" },
            ].map((shortcut) => (
              <div className="shortcut-list__item" key={shortcut.key}>
                <span>{shortcut.label}</span>
                <kbd>{shortcut.key}</kbd>
              </div>
            ))}
          </div>
        </Modal>

        {syncState === "offline" && (
          <div className="offline-banner" role="status">
            <strong>Conectividade com o Hub interrompida.</strong> Comandos ainda não aceitos
            permanecem na fila com a mesma chave idempotente; o cache criptografado e as operações
            já aceitas continuam preservados.
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
            <Button
              aria-label="Fechar aviso"
              onClick={() => setRuntimeError(null)}
              size="sm"
              variant="ghost"
              type="button"
            >
              ×
            </Button>
          </div>
        )}

        <main className={`main-content main-content--${safeRoute}`} id="main-content" tabIndex={-1}>
          <PageHeading
            title={page?.title ?? "Visão geral"}
            description={page?.description ?? "Resumo operacional da unidade."}
          />
          {compactNavigation && terminalQuickActions.length > 0 && (
            <nav aria-label="Atalhos deste terminal" className="terminal-quick-actions">
              {terminalQuickActions.map((item) => (
                <Button
                  key={item.action}
                  onClick={() => {
                    if (item.route) window.location.hash = routeHref(item.route);
                    else setCommandPaletteOpen(true);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {item.label}
                </Button>
              ))}
            </nav>
          )}
          <TimeClockBanner
            identityId={session.identityId}
            scope={{
              organizationId: session.organizationId,
              unitId: session.unitId,
              profileId: session.profile.id,
              refreshToken: scopeRevision,
            }}
            timeZone={unit.timezone}
          />
          <Suspense
            fallback={
              <Card className="remote-state" role="status">
                <span className="spinner" aria-hidden="true" />
                <strong>Preparando esta área…</strong>
                <p>Carregando apenas os recursos necessários.</p>
              </Card>
            }
          >
            <PageContent
              canManageKdsUnitSettings={canManageKdsUnitSettings}
              dispatchPilot={dispatchPilot}
              kdsArea={kdsArea}
              loadPilot={loadPilot}
              profile={session.profile}
              route={safeRoute}
              refreshToken={scopeRevision}
              session={session}
            />
          </Suspense>
        </main>
        {compactNavigation && !navOpen && (
          <nav aria-label="Navegação rápida mobile" className="mobile-bottom-nav">
            {mobileNav.map((item) =>
              isCentralOperationalRoute(item.route) ? (
                <Button
                  className={isCentralOperationalRoute(route) ? "active" : ""}
                  key="central-operational"
                  onClick={() => setCentralMobileOpen(true)}
                  type="button"
                >
                  <Icon name="salon" size={20} />
                  <span>Central</span>
                  {receptionPendingCount !== null && receptionPendingCount > 0 && (
                    <small>{receptionPendingCount}</small>
                  )}
                </Button>
              ) : (
                <a
                  className={route === item.route ? "active" : ""}
                  href={navigationHref(item)}
                  key={item.route}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{item.route === "dashboard" ? "Geral" : item.label}</span>
                </a>
              ),
            )}
          </nav>
        )}
      </div>
      {helpOpen && <HelpDrawer onClose={() => setHelpOpen(false)} route={route} />}
      <Modal
        isOpen={centralMobileOpen}
        onClose={() => setCentralMobileOpen(false)}
        size="sm"
        title="Central Operacional"
      >
        <nav aria-label="Áreas autorizadas da Central" className="central-mobile-sheet">
          {authorizedCentralItems.map((item) => (
            <a
              aria-current={route === item.route ? "page" : undefined}
              href={navigationHref(item)}
              key={item.route}
              onClick={() => setCentralMobileOpen(false)}
            >
              <Icon name={item.icon} size={22} />
              <span>
                <strong>{item.label}</strong>
                <small>{pageMeta[item.route]?.description}</small>
              </span>
              {item.route === "reservations" &&
                receptionPendingCount !== null &&
                receptionPendingCount > 0 && (
                  <span className="nav-count">{receptionPendingCount}</span>
                )}
            </a>
          ))}
        </nav>
      </Modal>
      <TerminalProfileSettings
        isOpen={terminalSettingsOpen}
        onClose={() => setTerminalSettingsOpen(false)}
        onSaved={(profile) => {
          setTerminalProfile(profile);
          if (canAccess(session.profile, profile.defaultRoute)) {
            window.location.hash = routeHref(profile.defaultRoute);
          }
        }}
        organizationId={session.organizationId}
        runtime={runtime}
        unitId={session.unitId}
      />
    </div>
  );
}
