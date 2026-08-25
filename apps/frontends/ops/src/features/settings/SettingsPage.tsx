import {
  type BusinessHoursDay,
  type BusinessHoursException,
  type EstablishmentSettings,
  type EstablishmentSettingsHistoryEntry,
  type EstablishmentSpecializedSettingsSummary,
  updateOrganizationSettingsSchema,
  updateUnitSettingsSchema,
} from "@giromesa/contracts";
import { getBusinessOpenState } from "@giromesa/domain/establishment-hours";
import { Badge, Button, Card, Icon, Input, Label, Modal, NativeSelect } from "@giromesa/ui";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, api } from "../../api";
import type { ProfileId, Unit } from "../../domain";
import { routeHref } from "../../router";
import {
  applyHoursTemplate,
  BRAZILIAN_TIMEZONES,
  contrastRatio,
  coverFileError,
  dirtySettingsSections,
  formatBrazilianPhone,
  formatPostalCode,
  hoursDayWithMode,
  hoursExceptionWithMode,
  logoFileError,
  mediaPayload,
  mergeSavedSection,
  normalizeInstagram,
  prepareCoverImage,
  prepareLogoVariants,
  readableForeground,
  sortBusinessHoursExceptions,
  unitSettingsInput,
  WEEKDAYS,
} from "./settings";
import "./settings.css";

type SettingsPageProps = {
  organizationId: string;
  profileId: ProfileId;
  unitId: string;
  units: Unit[];
  onSaved: (settings: EstablishmentSettings) => void;
};

type Feedback = { tone: "danger" | "success"; message: string } | null;

function useFilePreview(file: File | null, fallback: string | null | undefined) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : fallback), [fallback, file]);
  useEffect(
    () => () => {
      if (file && preview) URL.revokeObjectURL(preview);
    },
    [file, preview],
  );
  return preview;
}

const SPECIALIZED_SETTINGS = [
  {
    id: "catalog",
    label: "Cardápio e publicação",
    description: "Produtos, QR e versão pública",
    route: "catalog",
  },
  {
    id: "cash",
    label: "Contas e caixa",
    description: "Turnos, conferência e políticas",
    route: "cash",
  },
  {
    id: "people",
    label: "Pessoas e ponto",
    description: "Equipe, escalas e jornada",
    route: "people",
  },
  {
    id: "billing",
    label: "Assinatura e cobrança",
    description: "Plano, renovação e cobranças da organização",
    route: "billing",
    ownerOnly: true,
  },
  {
    id: "kds",
    label: "Produção KDS",
    description: "Praças, terminal e fluxo",
    href: "#/kds?area=settings",
  },
  { id: "fiscal", label: "Fiscal", description: "CNPJ, emissão e documentos", route: "fiscal" },
  {
    id: "devices",
    label: "SmartPOS e dispositivos",
    description: "Pareamento e impressoras",
    route: "device",
  },
] as const;

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function firstValidationMessage(result: ReturnType<typeof updateUnitSettingsSchema.safeParse>) {
  return result.error?.issues[0]?.message ?? "Revise os campos informados.";
}

function validationErrors(result: ReturnType<typeof updateUnitSettingsSchema.safeParse>) {
  return Object.fromEntries(
    (result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]),
  );
}

const PUBLIC_SECTION_LABELS = {
  brand: "marca",
  contacts: "contatos",
  hours: "funcionamento",
  timezone: "fuso horário",
} as const;

function specializedStatus(
  id: (typeof SPECIALIZED_SETTINGS)[number]["id"],
  summary: EstablishmentSpecializedSettingsSummary | null,
) {
  if (!summary) return "Carregando estado…";
  if (id === "catalog")
    return summary.catalog.active
      ? `Publicado · versão ${summary.catalog.publishedVersion ?? "—"}`
      : "Publicação pendente";
  if (id === "cash")
    return summary.cash.configured ? "Políticas configuradas" : "Configuração inicial";
  if (id === "people")
    return summary.people.timeTrackingConfigured ? "Ponto configurado" : "Ponto desativado";
  if (id === "kds") return `${summary.kds.activeStations} praça(s) ativa(s)`;
  if (id === "fiscal") return summary.fiscal.configured ? "Perfil configurado" : "Perfil pendente";
  if (id === "devices") return `${summary.devices.activeCount} dispositivo(s) ativo(s)`;
  return `Cobrança: ${summary.billing.state}`;
}

function nextChangeLabel(value: string | null, timezone: string) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function periodEndsNextDay(start: string, end: string) {
  return end < start;
}

function HoursRuleEditor({
  label,
  rule,
  onChange,
}: {
  label: string;
  rule: BusinessHoursDay | BusinessHoursException;
  onChange: (rule: BusinessHoursDay | BusinessHoursException) => void;
}) {
  const identity = "weekday" in rule ? { weekday: rule.weekday } : { date: rule.date };
  return (
    <div className="settings-hours-rule">
      <NativeSelect
        aria-label={`Modo de funcionamento de ${label}`}
        onChange={(event) => {
          const mode = event.target.value as BusinessHoursDay["mode"];
          onChange(
            "weekday" in rule ? hoursDayWithMode(rule, mode) : hoursExceptionWithMode(rule, mode),
          );
        }}
        value={rule.mode}
      >
        <option value="closed">Fechado</option>
        <option value="open24h">24 horas</option>
        <option value="periods">Horários definidos</option>
      </NativeSelect>
      {rule.mode === "periods" && (
        <div className="settings-periods">
          {rule.periods.map((period, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: controlled rows have no persisted identifier
            <div className="settings-period" key={index}>
              <Label>
                Abre
                <Input
                  aria-label={`Abertura do período ${index + 1} de ${label}`}
                  onChange={(event) => {
                    const start = event.target.value;
                    const periods = rule.periods.map((current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, start, endsNextDay: periodEndsNextDay(start, current.end) }
                        : current,
                    );
                    onChange({ ...identity, mode: "periods", periods });
                  }}
                  type="time"
                  value={period.start}
                />
              </Label>
              <Label>
                Fecha
                <Input
                  aria-label={`Fechamento do período ${index + 1} de ${label}`}
                  onChange={(event) => {
                    const end = event.target.value;
                    const periods = rule.periods.map((current, currentIndex) =>
                      currentIndex === index
                        ? { ...current, end, endsNextDay: periodEndsNextDay(current.start, end) }
                        : current,
                    );
                    onChange({ ...identity, mode: "periods", periods });
                  }}
                  type="time"
                  value={period.end}
                />
              </Label>
              <span className="settings-period__next-day">
                {period.endsNextDay ? "Fecha no dia seguinte" : "Mesmo dia"}
              </span>
              <Button
                aria-label={`Remover período ${index + 1} de ${label}`}
                disabled={rule.periods.length === 1}
                onClick={() =>
                  onChange({
                    ...identity,
                    mode: "periods",
                    periods: rule.periods.filter((_, currentIndex) => currentIndex !== index),
                  })
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icon name="x" size={14} />
              </Button>
            </div>
          ))}
          <Button
            disabled={rule.periods.length >= 8}
            onClick={() =>
              onChange({
                ...identity,
                mode: "periods",
                periods: [...rule.periods, { start: "19:00", end: "23:00", endsNextDay: false }],
              })
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Icon name="plus" size={14} /> Adicionar período
          </Button>
        </div>
      )}
    </div>
  );
}

export function SettingsPage({
  organizationId,
  profileId,
  unitId,
  units,
  onSaved,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<EstablishmentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<EstablishmentSettingsHistoryEntry | null>(
    null,
  );
  const [specializedSummary, setSpecializedSummary] =
    useState<EstablishmentSpecializedSettingsSummary | null>(null);
  const [history, setHistory] = useState<EstablishmentSettingsHistoryEntry[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [online, setOnline] = useState(() => globalThis.navigator?.onLine ?? true);
  const [now, setNow] = useState(() => new Date());
  const persistedSettings = useRef<EstablishmentSettings | null>(null);
  const isOwner = profileId === "owner";

  useEffect(() => {
    void reloadToken;
    let active = true;
    setLoading(true);
    setSettings(null);
    persistedSettings.current = null;
    setLogoFile(null);
    setCoverFile(null);
    setFieldErrors({});
    setFeedback(null);
    void api.settings
      .get(organizationId, unitId)
      .then((value) => {
        if (active) {
          persistedSettings.current = value;
          setSettings(value);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setFeedback({
            tone: "danger",
            message: messageFrom(error, "Falha ao carregar as configurações."),
          });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void Promise.allSettled([
      api.settings.specializedSummary(organizationId, unitId),
      api.settings.history(organizationId, unitId),
    ]).then(([summaryResult, historyResult]) => {
      if (!active) return;
      if (summaryResult.status === "fulfilled") setSpecializedSummary(summaryResult.value);
      if (historyResult.status === "fulfilled") setHistory(historyResult.value);
    });
    return () => {
      active = false;
    };
  }, [organizationId, reloadToken, unitId]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    globalThis.addEventListener("online", updateOnline);
    globalThis.addEventListener("offline", updateOnline);
    return () => {
      globalThis.removeEventListener("online", updateOnline);
      globalThis.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(new Date()), 60_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!settings || typeof window === "undefined") return;
    const section = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("section");
    if (!section) return;
    window.requestAnimationFrame(() =>
      document.getElementById(`settings-${section}`)?.scrollIntoView(),
    );
  }, [settings]);

  const openState = useMemo(() => {
    if (!settings) return null;
    try {
      return getBusinessOpenState(settings.businessHours, settings.unit.timezone, now);
    } catch {
      return null;
    }
  }, [now, settings]);
  const logoPreview = useFilePreview(logoFile, settings?.presentation.logoUrl);
  const coverPreview = useFilePreview(coverFile, settings?.presentation.coverImageUrl);
  const dirtySections = useMemo(
    () =>
      settings && persistedSettings.current
        ? dirtySettingsSections(settings, persistedSettings.current, Boolean(logoFile || coverFile))
        : [],
    [coverFile, logoFile, settings],
  );
  const hasDirtyChanges = dirtySections.length > 0;
  const brandOrHoursDirty = dirtySections.includes("brand") || dirtySections.includes("hours");

  useEffect(() => {
    if (!hasDirtyChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const beforeNavigation = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
      if (anchor && !window.confirm("Descartar as alterações ainda não salvas?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    globalThis.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeNavigation, true);
    return () => {
      globalThis.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeNavigation, true);
    };
  }, [hasDirtyChanges]);

  useEffect(
    () => () => {
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  function update(mutator: (current: EstablishmentSettings) => EstablishmentSettings) {
    setSettings((current) => (current ? mutator(current) : current));
    setFeedback(null);
    setFieldErrors({});
  }

  function updateAddressDetail(
    field: "postalCode" | "street" | "number" | "complement" | "district" | "city" | "state",
    value: string,
  ) {
    update((current) => ({
      ...current,
      presentation: {
        ...current.presentation,
        addressDetails: {
          postalCode: "",
          street: "",
          number: "",
          complement: null,
          district: "",
          city: "",
          state: "",
          ...current.presentation.addressDetails,
          [field]: field === "complement" ? value || null : value,
        },
      },
    }));
  }

  async function saveOrganization() {
    if (!settings || !isOwner || !online) return;
    const parsed = updateOrganizationSettingsSchema.safeParse({
      tradeName: settings.organization.tradeName,
      expectedRevision: settings.organization.revision,
    });
    if (!parsed.success) {
      setFieldErrors({
        "organization.tradeName": parsed.error.issues[0]?.message ?? "Nome inválido.",
      });
      setFeedback({ tone: "danger", message: "Revise o nome fantasia informado." });
      return;
    }
    setBusy("organization");
    setFeedback(null);
    try {
      const organization = await api.settings.updateOrganization(organizationId, parsed.data);
      const next = { ...settings, organization };
      persistedSettings.current = persistedSettings.current
        ? { ...persistedSettings.current, organization }
        : next;
      setSettings(next);
      onSaved(next);
      setFeedback({ tone: "success", message: "Organização atualizada." });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof ApiClientError && error.code === "SETTINGS_VERSION_CONFLICT"
            ? "Outra pessoa alterou estas configurações. Recarregue antes de salvar."
            : messageFrom(error, "Falha ao atualizar a organização."),
      });
    } finally {
      setBusy("");
    }
  }

  async function saveUnit(section: "unit" | "brand" | "hours") {
    if (!settings || !online) return;
    setBusy(section);
    setFeedback(null);
    setFieldErrors({});
    const uploadedKeys: string[] = [];
    try {
      const confirmed = persistedSettings.current ?? settings;
      let next: EstablishmentSettings =
        section === "unit"
          ? {
              ...confirmed,
              unit: settings.unit,
              presentation: {
                ...confirmed.presentation,
                address: settings.presentation.address,
                addressDetails: settings.presentation.addressDetails,
                phone: settings.presentation.phone,
                instagram: settings.presentation.instagram,
              },
            }
          : section === "brand"
            ? {
                ...confirmed,
                presentation: {
                  ...confirmed.presentation,
                  displayName: settings.presentation.displayName,
                  slogan: settings.presentation.slogan,
                  logoUrl: settings.presentation.logoUrl,
                  logoThumbnailUrl: settings.presentation.logoThumbnailUrl,
                  coverImageUrl: settings.presentation.coverImageUrl,
                  primaryColor: settings.presentation.primaryColor,
                  accentColor: settings.presentation.accentColor,
                },
              }
            : {
                ...confirmed,
                businessHours: sortBusinessHoursExceptions(settings.businessHours),
              };
      if (section === "brand" && logoFile) {
        const variants = await prepareLogoVariants(logoFile);
        const [main, thumbnail] = await Promise.all([
          api.pilot.uploadCatalogMedia(organizationId, unitId, await mediaPayload(variants.main)),
          api.pilot.uploadCatalogMedia(
            organizationId,
            unitId,
            await mediaPayload(variants.thumbnail),
          ),
        ]);
        uploadedKeys.push(main.key, thumbnail.key);
        next = {
          ...next,
          presentation: {
            ...next.presentation,
            logoUrl: main.url,
            logoThumbnailUrl: thumbnail.url,
          },
        };
      }
      if (section === "brand" && coverFile) {
        const cover = await api.pilot.uploadCatalogMedia(
          organizationId,
          unitId,
          await mediaPayload(await prepareCoverImage(coverFile)),
        );
        uploadedKeys.push(cover.key);
        next = {
          ...next,
          presentation: { ...next.presentation, coverImageUrl: cover.url },
        };
      }
      const parsed = updateUnitSettingsSchema.safeParse(unitSettingsInput(next));
      if (!parsed.success) {
        if (uploadedKeys.length > 0) {
          await Promise.allSettled(
            uploadedKeys.map((key) => api.pilot.deleteCatalogMedia(organizationId, unitId, key)),
          );
        }
        setFieldErrors(validationErrors(parsed));
        setFeedback({ tone: "danger", message: firstValidationMessage(parsed) });
        const firstPath = parsed.error.issues[0]?.path.join(".");
        if (firstPath) {
          window.requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`[data-field-path="${firstPath}"]`)?.focus(),
          );
        }
        return;
      }
      const persisted = await api.settings.updateUnit(organizationId, unitId, parsed.data);
      persistedSettings.current = persisted;
      setSettings((current) =>
        current ? mergeSavedSection(current, persisted, section) : persisted,
      );
      if (section === "brand") {
        setLogoFile(null);
        setCoverFile(null);
      }
      onSaved(persisted);
      setFeedback({
        tone: "success",
        message: "Configurações salvas. Publique o cardápio para atualizar os canais públicos.",
      });
    } catch (error) {
      if (uploadedKeys.length > 0) {
        await Promise.allSettled(
          uploadedKeys.map((key) => api.pilot.deleteCatalogMedia(organizationId, unitId, key)),
        );
      }
      setFeedback({
        tone: "danger",
        message:
          error instanceof ApiClientError && error.code === "SETTINGS_VERSION_CONFLICT"
            ? "Outra pessoa alterou estas configurações. Recarregue antes de salvar."
            : messageFrom(error, "Falha ao salvar as configurações."),
      });
    } finally {
      setBusy("");
    }
  }

  function chooseLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const error = logoFileError(file);
    if (error) {
      setFeedback({ tone: "danger", message: error });
      return;
    }
    setLogoFile(file);
    setFeedback(null);
  }

  function chooseCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const error = coverFileError(file);
    if (error) {
      setFeedback({ tone: "danger", message: error });
      return;
    }
    setCoverFile(file);
    setFeedback(null);
  }

  async function copySettings() {
    if (!settings || selectedTargets.length === 0 || brandOrHoursDirty || !online) return;
    const names = units
      .filter((unit) => selectedTargets.includes(unit.id))
      .map((unit) => unit.name);
    setBusy("copy");
    setFeedback(null);
    try {
      await api.settings.copy(organizationId, unitId, {
        expectedRevision: settings.revision,
        targetUnitIds: selectedTargets,
      });
      setSelectedTargets([]);
      setCopyModalOpen(false);
      setFeedback({ tone: "success", message: `Configurações copiadas para ${names.join(", ")}.` });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof ApiClientError && error.code === "SETTINGS_VERSION_CONFLICT"
            ? "A unidade de origem mudou. Recarregue antes de copiar."
            : messageFrom(error, "Falha ao copiar as configurações."),
      });
    } finally {
      setBusy("");
    }
  }

  async function restoreSettings() {
    if (!settings || !restoreTarget || hasDirtyChanges || !online) return;
    setBusy("restore");
    setFeedback(null);
    try {
      const restored = await api.settings.restore(organizationId, unitId, {
        auditEventId: restoreTarget.id,
        expectedRevision: settings.revision,
      });
      persistedSettings.current = restored;
      setSettings(restored);
      setRestoreTarget(null);
      onSaved(restored);
      setHistory(await api.settings.history(organizationId, unitId));
      setFeedback({
        tone: "success",
        message: `Configuração restaurada na revisão ${restored.revision}.`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message:
          error instanceof ApiClientError && error.code === "SETTINGS_VERSION_CONFLICT"
            ? "As configurações mudaram. Recarregue antes de restaurar."
            : messageFrom(error, "Falha ao restaurar as configurações."),
      });
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return (
      <Card className="remote-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <strong>Carregando configurações…</strong>
      </Card>
    );
  }
  if (!settings) {
    return (
      <Card className="remote-state" role="alert">
        <strong>Não foi possível abrir as configurações.</strong>
        <p>{feedback?.message}</p>
        <Button onClick={() => setReloadToken((value) => value + 1)} variant="primary">
          Tentar novamente
        </Button>
      </Card>
    );
  }

  const targetUnits = units.filter((unit) => unit.id !== unitId);
  const timezoneOptions = BRAZILIAN_TIMEZONES.includes(
    settings.unit.timezone as (typeof BRAZILIAN_TIMEZONES)[number],
  )
    ? BRAZILIAN_TIMEZONES
    : ([settings.unit.timezone, ...BRAZILIAN_TIMEZONES] as readonly string[]);

  return (
    <div className="settings-page" aria-busy={Boolean(busy)}>
      <div className="settings-status-bar">
        <div>
          <Badge tone={openState?.open ? "success" : "neutral"}>
            {openState
              ? openState.open
                ? "Aberto agora"
                : "Fechado agora"
              : "Status indisponível"}
          </Badge>
          <span>
            Horário calculado em {settings.unit.timezone}
            {openState?.nextChangeAt
              ? ` · próxima mudança ${nextChangeLabel(openState.nextChangeAt, settings.unit.timezone)}`
              : ""}
          </span>
          {!online && <Badge tone="warning">Offline · edição somente local</Badge>}
          {hasDirtyChanges && <Badge tone="warning">Alterações não salvas</Badge>}
        </div>
        {settings.publication.hasUnpublishedChanges && (
          <a className="settings-publication-alert" href={routeHref("catalog")}>
            <Icon name="alert-circle" size={15} /> Aguardando publicação:{" "}
            {settings.publication.pendingSections
              .map((section) => PUBLIC_SECTION_LABELS[section])
              .join(", ")}
          </a>
        )}
        {!settings.publication.hasUnpublishedChanges && settings.publication.publishedAt && (
          <span className="settings-publication-meta">
            Versão {settings.publication.publishedVersion ?? "—"} publicada em{" "}
            {new Intl.DateTimeFormat("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(settings.publication.publishedAt))}
            {settings.publication.publicUrl && (
              <a href={settings.publication.publicUrl} rel="noreferrer" target="_blank">
                Abrir cardápio público
              </a>
            )}
          </span>
        )}
      </div>

      {feedback && (
        <div
          className={`settings-feedback settings-feedback--${feedback.tone}`}
          role={feedback.tone === "danger" ? "alert" : "status"}
        >
          {feedback.message}
        </div>
      )}

      <section id="settings-organization" aria-labelledby="settings-organization-title">
        <Card className="settings-card">
          <header>
            <div>
              <h2 id="settings-organization-title">Organização</h2>
              <p>Identidade jurídica e nome usado na operação.</p>
            </div>
            {dirtySections.includes("organization") && <Badge tone="warning">Não salvo</Badge>}
          </header>
          <div className="gm-form-grid settings-grid">
            <Label className="gm-form-field">
              Nome fantasia
              <Input
                aria-invalid={Boolean(fieldErrors["organization.tradeName"])}
                data-field-path="organization.tradeName"
                disabled={!isOwner}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    organization: { ...current.organization, tradeName: event.target.value },
                  }))
                }
                value={settings.organization.tradeName}
              />
              {fieldErrors["organization.tradeName"] && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors["organization.tradeName"]}
                </small>
              )}
            </Label>
            <Label className="gm-form-field">
              Razão social
              <Input disabled readOnly value={settings.organization.legalName} />
            </Label>
            <Label className="gm-form-field">
              CNPJ
              <Input disabled readOnly value={settings.organization.document} />
            </Label>
          </div>
          <footer className="settings-card__actions">
            <a href={routeHref("fiscal")}>Abrir configurações fiscais</a>
            {isOwner ? (
              <Button
                disabled={
                  busy === "organization" || !online || !dirtySections.includes("organization")
                }
                onClick={() => void saveOrganization()}
                variant="primary"
              >
                {busy === "organization" ? "Salvando…" : "Salvar organização"}
              </Button>
            ) : (
              <small>Somente o proprietário altera o nome da organização.</small>
            )}
          </footer>
        </Card>
      </section>

      <section id="settings-unit" aria-labelledby="settings-unit-title">
        <Card className="settings-card">
          <header>
            <div>
              <h2 id="settings-unit-title">Unidade e contatos</h2>
              <p>Contexto interno e informações apresentadas ao cliente.</p>
            </div>
            {dirtySections.includes("unit") && <Badge tone="warning">Não salvo</Badge>}
          </header>
          <div className="gm-form-grid settings-grid">
            <Label className="gm-form-field">
              Nome interno da unidade
              <Input
                aria-invalid={Boolean(fieldErrors.name)}
                data-field-path="name"
                minLength={2}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    unit: { ...current.unit, name: event.target.value },
                  }))
                }
                required
                value={settings.unit.name}
              />
              {fieldErrors.name && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors.name}
                </small>
              )}
            </Label>
            <Label className="gm-form-field">
              Fuso horário
              <NativeSelect
                aria-invalid={Boolean(fieldErrors.timezone)}
                data-field-path="timezone"
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    unit: { ...current.unit, timezone: event.target.value },
                  }))
                }
                value={settings.unit.timezone}
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </NativeSelect>
              {fieldErrors.timezone && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors.timezone}
                </small>
              )}
            </Label>
            <Label className="gm-form-field settings-field--wide">
              Endereço
              <Input
                aria-invalid={Boolean(fieldErrors["presentation.address"])}
                data-field-path="presentation.address"
                maxLength={500}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    presentation: { ...current.presentation, address: event.target.value || null },
                  }))
                }
                value={settings.presentation.address ?? ""}
              />
              {fieldErrors["presentation.address"] && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors["presentation.address"]}
                </small>
              )}
            </Label>
            <Label className="gm-form-field">
              Telefone / WhatsApp
              <Input
                aria-invalid={Boolean(fieldErrors["presentation.phone"])}
                autoComplete="tel"
                data-field-path="presentation.phone"
                inputMode="tel"
                maxLength={15}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    presentation: {
                      ...current.presentation,
                      phone: formatBrazilianPhone(event.target.value) || null,
                    },
                  }))
                }
                placeholder="(82) 99999-9999"
                type="tel"
                value={formatBrazilianPhone(settings.presentation.phone ?? "")}
              />
              {fieldErrors["presentation.phone"] && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors["presentation.phone"]}
                </small>
              )}
            </Label>
            <Label className="gm-form-field">
              Instagram
              <Input
                aria-invalid={Boolean(fieldErrors["presentation.instagram"])}
                data-field-path="presentation.instagram"
                maxLength={120}
                onBlur={(event) => {
                  const normalized = normalizeInstagram(event.target.value);
                  update((current) => ({
                    ...current,
                    presentation: { ...current.presentation, instagram: normalized },
                  }));
                }}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    presentation: {
                      ...current.presentation,
                      instagram: event.target.value || null,
                    },
                  }))
                }
                value={settings.presentation.instagram ?? ""}
              />
              {fieldErrors["presentation.instagram"] && (
                <small className="settings-field-error" role="alert">
                  {fieldErrors["presentation.instagram"]}
                </small>
              )}
            </Label>
          </div>
          <details className="settings-address-details">
            <summary>Endereço estruturado para mapas e impressão</summary>
            <div className="gm-form-grid settings-grid">
              <Label className="gm-form-field">
                CEP
                <Input
                  inputMode="numeric"
                  maxLength={9}
                  onChange={(event) =>
                    updateAddressDetail("postalCode", formatPostalCode(event.target.value))
                  }
                  placeholder="00000-000"
                  value={formatPostalCode(settings.presentation.addressDetails?.postalCode ?? "")}
                />
              </Label>
              <Label className="gm-form-field">
                Logradouro
                <Input
                  maxLength={180}
                  onChange={(event) => updateAddressDetail("street", event.target.value)}
                  value={settings.presentation.addressDetails?.street ?? ""}
                />
              </Label>
              <Label className="gm-form-field">
                Número
                <Input
                  maxLength={30}
                  onChange={(event) => updateAddressDetail("number", event.target.value)}
                  value={settings.presentation.addressDetails?.number ?? ""}
                />
              </Label>
              <Label className="gm-form-field">
                Complemento
                <Input
                  maxLength={120}
                  onChange={(event) => updateAddressDetail("complement", event.target.value)}
                  value={settings.presentation.addressDetails?.complement ?? ""}
                />
              </Label>
              <Label className="gm-form-field">
                Bairro
                <Input
                  maxLength={120}
                  onChange={(event) => updateAddressDetail("district", event.target.value)}
                  value={settings.presentation.addressDetails?.district ?? ""}
                />
              </Label>
              <Label className="gm-form-field">
                Cidade
                <Input
                  maxLength={120}
                  onChange={(event) => updateAddressDetail("city", event.target.value)}
                  value={settings.presentation.addressDetails?.city ?? ""}
                />
              </Label>
              <Label className="gm-form-field">
                UF
                <Input
                  maxLength={2}
                  onChange={(event) =>
                    updateAddressDetail("state", event.target.value.toUpperCase())
                  }
                  value={settings.presentation.addressDetails?.state ?? ""}
                />
              </Label>
            </div>
            {settings.presentation.addressDetails && (
              <Button
                onClick={() =>
                  update((current) => ({
                    ...current,
                    presentation: { ...current.presentation, addressDetails: null },
                  }))
                }
                size="sm"
                variant="ghost"
              >
                Remover endereço estruturado
              </Button>
            )}
          </details>
          <footer className="settings-card__actions">
            <Button
              disabled={busy === "unit" || !online || !dirtySections.includes("unit")}
              onClick={() => void saveUnit("unit")}
              variant="primary"
            >
              {busy === "unit" ? "Salvando…" : "Salvar unidade"}
            </Button>
          </footer>
        </Card>
      </section>

      <section id="settings-brand" aria-labelledby="settings-brand-title">
        <Card className="settings-card">
          <header>
            <div>
              <h2 id="settings-brand-title">Marca</h2>
              <p>Logo, capa, nome público e cores aplicados após publicar o cardápio.</p>
            </div>
            <div className="settings-header-badges">
              {settings.publication.active && <Badge tone="success">Publicada</Badge>}
              {dirtySections.includes("brand") && <Badge tone="warning">Não salvo</Badge>}
            </div>
          </header>
          <div className="settings-brand-layout">
            <div className="gm-form-stack">
              <Label className="gm-form-field">
                Nome exibido
                <Input
                  aria-invalid={Boolean(fieldErrors["presentation.displayName"])}
                  data-field-path="presentation.displayName"
                  maxLength={160}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      presentation: { ...current.presentation, displayName: event.target.value },
                    }))
                  }
                  required
                  value={settings.presentation.displayName}
                />
                {fieldErrors["presentation.displayName"] && (
                  <small className="settings-field-error" role="alert">
                    {fieldErrors["presentation.displayName"]}
                  </small>
                )}
              </Label>
              <Label className="gm-form-field">
                Slogan
                <Input
                  maxLength={300}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      presentation: { ...current.presentation, slogan: event.target.value || null },
                    }))
                  }
                  value={settings.presentation.slogan ?? ""}
                />
              </Label>
              <div className="settings-colors">
                <Label>
                  Cor principal
                  <input
                    aria-label="Cor principal"
                    type="color"
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        presentation: { ...current.presentation, primaryColor: event.target.value },
                      }))
                    }
                    value={settings.presentation.primaryColor}
                  />
                </Label>
                <Label>
                  Cor de destaque
                  <input
                    aria-label="Cor de destaque"
                    type="color"
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        presentation: { ...current.presentation, accentColor: event.target.value },
                      }))
                    }
                    value={settings.presentation.accentColor}
                  />
                </Label>
              </div>
              <Label className="settings-upload">
                Logo (JPG, PNG ou WEBP até 2 MB)
                <input accept="image/jpeg,image/png,image/webp" onChange={chooseLogo} type="file" />
              </Label>
              {(settings.presentation.logoUrl || logoFile) && (
                <Button
                  onClick={() => {
                    setLogoFile(null);
                    update((current) => ({
                      ...current,
                      presentation: {
                        ...current.presentation,
                        logoUrl: null,
                        logoThumbnailUrl: null,
                      },
                    }));
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Remover logo
                </Button>
              )}
              <Label className="settings-upload">
                {settings.presentation.coverImageUrl || coverFile
                  ? "Trocar foto de capa do cardápio"
                  : "Foto de capa do cardápio"}{" "}
                (JPG, PNG ou WEBP até 2 MB)
                <input
                  accept="image/jpeg,image/png,image/webp"
                  onChange={chooseCover}
                  type="file"
                />
              </Label>
              <small className="settings-upload-hint">
                A imagem será otimizada e recortada pelo centro em celulares. Mínimo de 640 × 240
                pixels.
              </small>
              {(settings.presentation.coverImageUrl || coverFile) && (
                <Button
                  onClick={() => {
                    setCoverFile(null);
                    update((current) => ({
                      ...current,
                      presentation: { ...current.presentation, coverImageUrl: null },
                    }));
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Remover foto de capa
                </Button>
              )}
            </div>
            <div className="settings-brand-previews">
              <div
                className="settings-brand-preview"
                style={{
                  backgroundColor: settings.presentation.primaryColor,
                  borderColor: settings.presentation.accentColor,
                }}
              >
                {coverPreview && (
                  <>
                    <img
                      alt=""
                      aria-hidden="true"
                      className="settings-brand-preview__cover"
                      src={coverPreview}
                    />
                    <div className="settings-brand-preview__shade" aria-hidden="true" />
                  </>
                )}
                <div className="settings-brand-preview__content">
                  {logoPreview ? (
                    <img alt="Prévia da logo do estabelecimento" src={logoPreview} />
                  ) : (
                    <span className="settings-brand-preview__fallback" aria-hidden="true">
                      {settings.presentation.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <strong>{settings.presentation.displayName}</strong>
                  {settings.presentation.slogan && <small>{settings.presentation.slogan}</small>}
                  <span
                    style={{
                      backgroundColor: settings.presentation.primaryColor,
                      color: readableForeground(settings.presentation.primaryColor),
                    }}
                  >
                    Ver cardápio
                  </span>
                </div>
              </div>
              <fieldset className="settings-brand-channels">
                <legend className="gm-sr-only">Prévia em outros canais</legend>
                <span style={{ borderColor: settings.presentation.accentColor }}>Placa de QR</span>
                <span>Comprovante</span>
                <span className="settings-brand-channels__dark">Modo escuro</span>
              </fieldset>
              {(contrastRatio(settings.presentation.primaryColor, "#ffffff") < 4.5 ||
                contrastRatio(settings.presentation.accentColor, "#ffffff") < 3) && (
                <p className="settings-contrast-warning" role="status">
                  A prévia ajusta o texto automaticamente; confira o contraste das cores antes de
                  publicar.
                </p>
              )}
            </div>
          </div>
          <footer className="settings-card__actions">
            <Button
              disabled={busy === "brand" || !online || !dirtySections.includes("brand")}
              onClick={() => void saveUnit("brand")}
              variant="primary"
            >
              {busy === "brand" ? "Enviando e salvando…" : "Salvar marca"}
            </Button>
          </footer>
        </Card>
      </section>

      <section id="settings-hours" aria-labelledby="settings-hours-title">
        <Card className="settings-card">
          <header>
            <div>
              <h2 id="settings-hours-title">Funcionamento</h2>
              <p>Horários informativos; pedidos não serão bloqueados automaticamente.</p>
            </div>
            {dirtySections.includes("hours") && <Badge tone="warning">Não salvo</Badge>}
          </header>
          <fieldset className="settings-hours-tools">
            <legend className="gm-sr-only">Atalhos de funcionamento</legend>
            <span>Usar a segunda-feira como modelo:</span>
            <Button
              onClick={() =>
                update((current) => ({
                  ...current,
                  businessHours: applyHoursTemplate(current.businessHours, 1, [1, 2, 3, 4, 5]),
                }))
              }
              size="sm"
              variant="secondary"
            >
              Aplicar de segunda a sexta
            </Button>
            <Button
              onClick={() =>
                update((current) => ({
                  ...current,
                  businessHours: applyHoursTemplate(
                    current.businessHours,
                    1,
                    [1, 2, 3, 4, 5, 6, 7],
                  ),
                }))
              }
              size="sm"
              variant="secondary"
            >
              Aplicar à semana toda
            </Button>
          </fieldset>
          <div className="settings-weekly">
            {WEEKDAYS.map(({ weekday, label }) => {
              const rule = settings.businessHours.weekly.find((day) => day.weekday === weekday);
              if (!rule) return null;
              return (
                <div className="settings-day" key={weekday}>
                  <strong>{label}</strong>
                  <HoursRuleEditor
                    label={label}
                    rule={rule}
                    onChange={(next) =>
                      update((current) => ({
                        ...current,
                        businessHours: {
                          ...current.businessHours,
                          weekly: current.businessHours.weekly.map((day) =>
                            day.weekday === weekday ? (next as BusinessHoursDay) : day,
                          ),
                        },
                        publication: { ...current.publication, hasUnpublishedChanges: true },
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="settings-exceptions">
            <header>
              <div>
                <h3>Feriados e exceções</h3>
                <p>A data especial substitui o horário semanal.</p>
              </div>
              <Button
                onClick={() =>
                  update((current) => ({
                    ...current,
                    businessHours: {
                      ...current.businessHours,
                      exceptions: [
                        ...current.businessHours.exceptions,
                        { date: "", label: "", mode: "closed" },
                      ],
                    },
                  }))
                }
                size="sm"
                variant="secondary"
              >
                <Icon name="plus" size={14} /> Adicionar data
              </Button>
            </header>
            {settings.businessHours.exceptions.length === 0 && (
              <p className="settings-empty">Nenhuma exceção cadastrada.</p>
            )}
            {settings.businessHours.exceptions.map((exception, index) => (
              <div
                className="settings-exception" /* biome-ignore lint/suspicious/noArrayIndexKey: controlled rows have no persisted identifier */
                key={`${index}:${exception.date}`}
              >
                <Input
                  aria-label={`Data da exceção ${index + 1}`}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      businessHours: {
                        ...current.businessHours,
                        exceptions: current.businessHours.exceptions.map((item, currentIndex) =>
                          currentIndex === index ? { ...item, date: event.target.value } : item,
                        ),
                      },
                    }))
                  }
                  type="date"
                  value={exception.date}
                />
                <Input
                  aria-label={`Descrição da exceção ${index + 1}`}
                  maxLength={80}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      businessHours: {
                        ...current.businessHours,
                        exceptions: current.businessHours.exceptions.map((item, currentIndex) =>
                          currentIndex === index
                            ? { ...item, label: event.target.value || undefined }
                            : item,
                        ),
                      },
                    }))
                  }
                  placeholder="Ex.: Natal"
                  value={exception.label ?? ""}
                />
                <HoursRuleEditor
                  label={exception.label || exception.date || `exceção ${index + 1}`}
                  rule={exception}
                  onChange={(next) =>
                    update((current) => ({
                      ...current,
                      businessHours: {
                        ...current.businessHours,
                        exceptions: current.businessHours.exceptions.map((item, currentIndex) =>
                          currentIndex === index ? (next as BusinessHoursException) : item,
                        ),
                      },
                    }))
                  }
                />
                {exception.date && exception.date < new Date().toISOString().slice(0, 10) && (
                  <small className="settings-exception__past">Data passada</small>
                )}
                <Button
                  aria-label={`Remover exceção ${index + 1}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      businessHours: {
                        ...current.businessHours,
                        exceptions: current.businessHours.exceptions.filter(
                          (_, currentIndex) => currentIndex !== index,
                        ),
                      },
                    }))
                  }
                  size="sm"
                  variant="ghost"
                >
                  <Icon name="x" size={14} />
                </Button>
              </div>
            ))}
          </div>
          <footer className="settings-card__actions">
            <Button
              disabled={busy === "hours" || !online || !dirtySections.includes("hours")}
              onClick={() => void saveUnit("hours")}
              variant="primary"
            >
              {busy === "hours" ? "Salvando…" : "Salvar funcionamento"}
            </Button>
          </footer>
        </Card>
      </section>

      {targetUnits.length > 0 && (
        <Card className="settings-card">
          <header>
            <div>
              <h2>Copiar para outras unidades</h2>
              <p>
                Copia somente apresentação e funcionamento. Nome, fuso e dados fiscais não mudam.
              </p>
            </div>
          </header>
          <fieldset className="settings-copy">
            <legend>Unidades de destino</legend>
            {targetUnits.map((unit) => (
              <Label key={unit.id}>
                <input
                  checked={selectedTargets.includes(unit.id)}
                  onChange={(event) =>
                    setSelectedTargets((current) =>
                      event.target.checked
                        ? [...current, unit.id]
                        : current.filter((id) => id !== unit.id),
                    )
                  }
                  type="checkbox"
                />
                {unit.name}
              </Label>
            ))}
          </fieldset>
          <footer className="settings-card__actions">
            {brandOrHoursDirty && <small>Salve marca e funcionamento antes de copiar.</small>}
            <Button
              disabled={
                busy === "copy" || selectedTargets.length === 0 || brandOrHoursDirty || !online
              }
              onClick={() => setCopyModalOpen(true)}
              variant="secondary"
            >
              <Icon name="copy" size={14} />{" "}
              {busy === "copy" ? "Copiando…" : "Copiar marca e horários"}
            </Button>
          </footer>
        </Card>
      )}

      <section aria-labelledby="settings-specialized-title">
        <div className="settings-section-heading">
          <h2 id="settings-specialized-title">Configurações especializadas</h2>
          <p>Cada área mantém suas regras e permissões próprias.</p>
        </div>
        <div className="settings-shortcuts">
          {SPECIALIZED_SETTINGS.filter(
            (item) => !("ownerOnly" in item && item.ownerOnly) || profileId === "owner",
          ).map((item) => (
            <a href={"href" in item ? item.href : routeHref(item.route)} key={item.label}>
              <Icon name="settings" size={18} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
                <Badge tone="neutral">{specializedStatus(item.id, specializedSummary)}</Badge>
              </span>
              <Icon name="chevron-right" size={16} />
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="settings-history-title">
        <Card className="settings-card settings-history">
          <header>
            <div>
              <h2 id="settings-history-title">Histórico de alterações</h2>
              <p>Últimas mudanças auditadas desta unidade. A senha do Wi-Fi não é versionada.</p>
            </div>
            <Badge tone="neutral">Revisão {settings.revision}</Badge>
          </header>
          {history.length === 0 ? (
            <p className="settings-empty">Nenhuma alteração auditada encontrada.</p>
          ) : (
            <ol>
              {history.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>
                      {entry.action === "restored"
                        ? "Restauração"
                        : entry.action === "copied"
                          ? "Cópia entre unidades"
                          : "Configuração atualizada"}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(entry.occurredAt))}
                      {entry.actorDisplayName ? ` · ${entry.actorDisplayName}` : ""} · revisão{" "}
                      {entry.revision}
                    </small>
                    <span>
                      {entry.changedSections.length > 0
                        ? entry.changedSections.join(", ")
                        : "alteração geral"}
                    </span>
                  </div>
                  <Button
                    disabled={hasDirtyChanges || !online || busy === "restore"}
                    onClick={() => setRestoreTarget(entry)}
                    size="sm"
                    variant="secondary"
                  >
                    Restaurar
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {hasDirtyChanges && <small>Salve ou descarte as alterações locais para restaurar.</small>}
        </Card>
      </section>

      <Modal
        description="A operação valida todas as unidades antes de gravar e não altera nome, fuso, fiscal ou módulos especializados."
        isOpen={copyModalOpen}
        onClose={() => busy !== "copy" && setCopyModalOpen(false)}
        size="sm"
        title="Confirmar cópia de marca e horários"
      >
        <div className="gm-form-stack">
          <p>
            A apresentação pública e o funcionamento atuais substituirão os dados de{" "}
            <strong>
              {units
                .filter((unit) => selectedTargets.includes(unit.id))
                .map((unit) => unit.name)
                .join(", ")}
            </strong>
            .
          </p>
          <div className="settings-modal-actions">
            <Button
              disabled={busy === "copy"}
              onClick={() => setCopyModalOpen(false)}
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button
              disabled={busy === "copy"}
              onClick={() => void copySettings()}
              variant="primary"
            >
              {busy === "copy" ? "Copiando…" : "Confirmar cópia"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        description="A restauração cria uma nova revisão e preserva a senha de Wi-Fi atual."
        isOpen={Boolean(restoreTarget)}
        onClose={() => busy !== "restore" && setRestoreTarget(null)}
        size="sm"
        title="Restaurar configuração anterior"
      >
        <div className="gm-form-stack">
          <p>
            Restaurar o estado auditado em{" "}
            <strong>
              {restoreTarget
                ? new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(restoreTarget.occurredAt))
                : ""}
            </strong>
            ?
          </p>
          <div className="settings-modal-actions">
            <Button
              disabled={busy === "restore"}
              onClick={() => setRestoreTarget(null)}
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button
              disabled={busy === "restore"}
              onClick={() => void restoreSettings()}
              variant="primary"
            >
              {busy === "restore" ? "Restaurando…" : "Restaurar como nova revisão"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
