import {
  type BusinessHoursDay,
  type BusinessHoursException,
  type EstablishmentSettings,
  updateUnitSettingsSchema,
} from "@giromesa/contracts";
import { getBusinessOpenState } from "@giromesa/domain/establishment-hours";
import { Badge, Button, Card, Icon, Input, Label, NativeSelect } from "@giromesa/ui";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { ProfileId, Unit } from "../../domain";
import { routeHref } from "../../router";
import {
  formatBrazilianPhone,
  hoursDayWithMode,
  hoursExceptionWithMode,
  logoFileError,
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

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Cuiaba",
  "America/Porto_Velho",
  "America/Rio_Branco",
  "America/Noronha",
] as const;

const SPECIALIZED_SETTINGS = [
  {
    label: "Cardápio e publicação",
    description: "Produtos, QR e versão pública",
    route: "catalog",
  },
  { label: "Contas e caixa", description: "Turnos, conferência e políticas", route: "cash" },
  { label: "Pessoas e ponto", description: "Equipe, escalas e jornada", route: "people" },
  { label: "Produção KDS", description: "Praças, terminal e fluxo", href: "#/kds?area=settings" },
  { label: "Fiscal", description: "CNPJ, emissão e documentos", route: "fiscal" },
  { label: "SmartPOS e dispositivos", description: "Pareamento e impressoras", route: "device" },
] as const;

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function firstValidationMessage(result: ReturnType<typeof updateUnitSettingsSchema.safeParse>) {
  return result.error?.issues[0]?.message ?? "Revise os campos informados.";
}

function periodEndsNextDay(start: string, end: string) {
  return end < start;
}

function HoursRuleEditor({
  rule,
  onChange,
}: {
  rule: BusinessHoursDay | BusinessHoursException;
  onChange: (rule: BusinessHoursDay | BusinessHoursException) => void;
}) {
  const identity = "weekday" in rule ? { weekday: rule.weekday } : { date: rule.date };
  return (
    <div className="settings-hours-rule">
      <NativeSelect
        aria-label="Modo de funcionamento"
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
            <div className="settings-period" key={`${index}:${period.start}:${period.end}`}>
              <Label>
                Abre
                <Input
                  aria-label={`Abertura do período ${index + 1}`}
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
                  aria-label={`Fechamento do período ${index + 1}`}
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
                aria-label={`Remover período ${index + 1}`}
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
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  const persistedSettings = useRef<EstablishmentSettings | null>(null);
  const isOwner = profileId === "owner";

  useEffect(() => {
    let active = true;
    setLoading(true);
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
    return () => {
      active = false;
    };
  }, [organizationId, unitId]);

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
  const logoPreview = useMemo(
    () => (logoFile ? URL.createObjectURL(logoFile) : settings?.presentation.logoUrl),
    [logoFile, settings?.presentation.logoUrl],
  );

  useEffect(
    () => () => {
      if (logoPreview?.startsWith("blob:")) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  function update(mutator: (current: EstablishmentSettings) => EstablishmentSettings) {
    setSettings((current) => (current ? mutator(current) : current));
    setFeedback(null);
  }

  async function saveOrganization() {
    if (!settings || !isOwner) return;
    setBusy("organization");
    setFeedback(null);
    try {
      const organization = await api.settings.updateOrganization(organizationId, {
        tradeName: settings.organization.tradeName.trim(),
      });
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
        message: messageFrom(error, "Falha ao atualizar a organização."),
      });
    } finally {
      setBusy("");
    }
  }

  async function saveUnit(section: "unit" | "brand" | "hours") {
    if (!settings) return;
    setBusy(section);
    setFeedback(null);
    try {
      const confirmed = persistedSettings.current ?? settings;
      let next =
        section === "unit"
          ? {
              ...confirmed,
              unit: settings.unit,
              presentation: {
                ...confirmed.presentation,
                address: settings.presentation.address,
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
                  primaryColor: settings.presentation.primaryColor,
                  accentColor: settings.presentation.accentColor,
                },
              }
            : { ...confirmed, businessHours: settings.businessHours };
      if (section === "brand" && logoFile) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("Não foi possível ler a logo."));
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error("Não foi possível ler a logo."));
          reader.readAsDataURL(logoFile);
        });
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
        if (!match?.[1] || !match[2]) throw new Error("Formato de imagem não suportado.");
        const uploaded = await api.pilot.uploadCatalogMedia(organizationId, unitId, {
          fileName: logoFile.name,
          mimeType: match[1] as "image/jpeg" | "image/png" | "image/webp",
          base64: match[2],
        });
        next = { ...next, presentation: { ...next.presentation, logoUrl: uploaded.url } };
      }
      const parsed = updateUnitSettingsSchema.safeParse(unitSettingsInput(next));
      if (!parsed.success) throw new Error(firstValidationMessage(parsed));
      const persisted = await api.settings.updateUnit(organizationId, unitId, parsed.data);
      persistedSettings.current = persisted;
      setSettings(persisted);
      setLogoFile(null);
      onSaved(persisted);
      setFeedback({
        tone: "success",
        message: "Configurações salvas. Publique o cardápio para atualizar os canais públicos.",
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: messageFrom(error, "Falha ao salvar as configurações."),
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

  async function copySettings() {
    if (!settings || selectedTargets.length === 0) return;
    const names = units
      .filter((unit) => selectedTargets.includes(unit.id))
      .map((unit) => unit.name);
    if (!window.confirm(`Substituir marca e horários em ${names.join(", ")}?`)) return;
    setBusy("copy");
    setFeedback(null);
    try {
      await api.settings.copy(organizationId, unitId, { targetUnitIds: selectedTargets });
      setSelectedTargets([]);
      setFeedback({ tone: "success", message: `Configurações copiadas para ${names.join(", ")}.` });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: messageFrom(error, "Falha ao copiar as configurações."),
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
      </Card>
    );
  }

  const targetUnits = units.filter((unit) => unit.id !== unitId);
  const timezoneOptions = TIMEZONES.includes(settings.unit.timezone as (typeof TIMEZONES)[number])
    ? TIMEZONES
    : ([settings.unit.timezone, ...TIMEZONES] as readonly string[]);

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
          <span>Horário calculado em {settings.unit.timezone}</span>
        </div>
        {settings.publication.hasUnpublishedChanges && (
          <a className="settings-publication-alert" href={routeHref("catalog")}>
            <Icon name="alert-circle" size={15} /> Alterações aguardando publicação
          </a>
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
          </header>
          <div className="gm-form-grid settings-grid">
            <Label className="gm-form-field">
              Nome fantasia
              <Input
                disabled={!isOwner}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    organization: { ...current.organization, tradeName: event.target.value },
                  }))
                }
                value={settings.organization.tradeName}
              />
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
                disabled={busy === "organization"}
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
          </header>
          <div className="gm-form-grid settings-grid">
            <Label className="gm-form-field">
              Nome interno da unidade
              <Input
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
            </Label>
            <Label className="gm-form-field">
              Fuso horário
              <NativeSelect
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
            </Label>
            <Label className="gm-form-field settings-field--wide">
              Endereço
              <Input
                maxLength={500}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    presentation: { ...current.presentation, address: event.target.value || null },
                  }))
                }
                value={settings.presentation.address ?? ""}
              />
            </Label>
            <Label className="gm-form-field">
              Telefone / WhatsApp
              <Input
                autoComplete="tel"
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
            </Label>
            <Label className="gm-form-field">
              Instagram
              <Input
                maxLength={120}
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
            </Label>
          </div>
          <footer className="settings-card__actions">
            <Button
              disabled={busy === "unit"}
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
              <p>Logo, nome público e cores aplicados após publicar o cardápio.</p>
            </div>
            {settings.publication.active && <Badge tone="success">Publicada</Badge>}
          </header>
          <div className="settings-brand-layout">
            <div className="gm-form-stack">
              <Label className="gm-form-field">
                Nome exibido
                <Input
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
                      presentation: { ...current.presentation, logoUrl: null },
                    }));
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Remover logo
                </Button>
              )}
            </div>
            <div
              className="settings-brand-preview"
              style={{ borderColor: settings.presentation.primaryColor }}
            >
              {logoPreview ? (
                <img alt="Prévia da logo do estabelecimento" src={logoPreview} />
              ) : (
                <span className="settings-brand-preview__fallback" aria-hidden="true">
                  {settings.presentation.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <strong>{settings.presentation.displayName}</strong>
              {settings.presentation.slogan && <small>{settings.presentation.slogan}</small>}
              <span style={{ backgroundColor: settings.presentation.primaryColor }}>
                Ver cardápio
              </span>
            </div>
          </div>
          <footer className="settings-card__actions">
            <Button
              disabled={busy === "brand"}
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
          </header>
          <div className="settings-weekly">
            {WEEKDAYS.map(({ weekday, label }) => {
              const rule = settings.businessHours.weekly.find((day) => day.weekday === weekday);
              if (!rule) return null;
              return (
                <div className="settings-day" key={weekday}>
                  <strong>{label}</strong>
                  <HoursRuleEditor
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
                        { date: "", mode: "closed" },
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
                <HoursRuleEditor
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
              disabled={busy === "hours"}
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
            <Button
              disabled={busy === "copy" || selectedTargets.length === 0}
              onClick={() => void copySettings()}
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
          {SPECIALIZED_SETTINGS.map((item) => (
            <a href={"href" in item ? item.href : routeHref(item.route)} key={item.label}>
              <Icon name="settings" size={18} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
                <Badge tone="neutral">Configuração própria</Badge>
              </span>
              <Icon name="chevron-right" size={16} />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
