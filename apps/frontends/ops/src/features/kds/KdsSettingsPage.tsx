// biome-ignore-all lint/a11y/noLabelWithoutControl: shadcn-compatible controls render native form elements nested by these labels
import { Badge, Button, Card, Input, NativeSelect } from "@giromesa/ui";
import { type KdsAllDayItem, type KdsData, serviceModeLabel } from "../../operations.shared";
import type { RealtimeStatus } from "../../realtime";
import { type KdsAvailabilityChange, KdsAvailabilityPanel } from "./KdsAvailabilityPanel";
import { KdsHardwareSettings, type KdsPrinterPreferences } from "./KdsHardwareSettings";
import { KdsAnalyticsPanel, KdsOpeningChecklist } from "./KdsSupportPanels";
import type { KdsBumpBarMap } from "./kds.bumpbar";
import type { KdsAnalytics } from "./kds.model";

export type KdsDensity = "compact" | "comfortable";

function numberLabel(value: number | null, suffix: string): string | null {
  return value === null ? null : `${value} ${suffix}`;
}

export function KdsSettingsPage({
  allDayExpanded,
  analytics,
  analyticsError,
  analyticsLoading,
  analyticsWindowHours,
  availabilityProducts,
  bumpMap,
  busyKeys,
  canManageUnitSettings,
  checklistKey,
  connectionReady,
  data,
  density,
  errors,
  fullscreen,
  fullscreenPreferred,
  installationId,
  operationalProducts,
  onAllDayExpandedChange,
  onAnalyticsWindowChange,
  onDensityChange,
  onAvailabilityChange,
  onBumpMapChange,
  onFullscreenPreferredChange,
  onLoadAnalytics,
  onPrint,
  onPrinterPreferencesChange,
  onReprint,
  onSelectStation,
  onTestSound,
  onToggleFullscreen,
  onToggleSound,
  onToggleStationLock,
  onTerminalLabelChange,
  onTerminalProfileSync,
  onViewModeChange,
  operatingDay,
  printerPreferences,
  printerLabel,
  printBusy,
  realtimeStatus,
  soundEnabled,
  stationId,
  stationLocked,
  terminalLabel,
  terminalProfileBusy,
  terminalProfileCanManage,
  terminalProfileMessage,
  terminalProfileStatus,
  viewMode,
  cloudUnavailable,
}: {
  allDayExpanded: boolean;
  analytics: KdsAnalytics | null;
  analyticsError: string | null;
  analyticsLoading: boolean;
  analyticsWindowHours: number;
  availabilityProducts: KdsData["productAvailability"];
  bumpMap: KdsBumpBarMap;
  busyKeys: Set<string>;
  canManageUnitSettings: boolean;
  checklistKey: string;
  connectionReady: boolean;
  data: KdsData;
  density: KdsDensity;
  errors: Record<string, string>;
  fullscreen: boolean;
  fullscreenPreferred: boolean;
  installationId: string;
  operationalProducts: KdsAllDayItem[];
  onAllDayExpandedChange: (expanded: boolean) => void;
  onAnalyticsWindowChange: (hours: number) => void;
  onDensityChange: (density: KdsDensity) => void;
  onAvailabilityChange: (change: KdsAvailabilityChange) => Promise<boolean>;
  onBumpMapChange: (map: KdsBumpBarMap) => void;
  onFullscreenPreferredChange: (preferred: boolean) => void;
  onLoadAnalytics: () => void;
  onPrint: () => void;
  onPrinterPreferencesChange: (preferences: KdsPrinterPreferences) => void;
  onReprint: () => void;
  onSelectStation: (stationId: string) => void;
  onTestSound: () => Promise<boolean>;
  onToggleFullscreen: () => void;
  onToggleSound: () => void;
  onToggleStationLock: () => void;
  onTerminalLabelChange: (label: string) => void;
  onTerminalProfileSync: () => void;
  onViewModeChange: (mode: "station" | "pass") => void;
  operatingDay: string;
  printerPreferences: KdsPrinterPreferences;
  printerLabel: string;
  printBusy: boolean;
  realtimeStatus: RealtimeStatus;
  soundEnabled: boolean;
  stationId: string;
  stationLocked: boolean;
  terminalLabel: string;
  terminalProfileBusy: boolean;
  terminalProfileCanManage: boolean;
  terminalProfileMessage: string;
  terminalProfileStatus: "local" | "loading" | "synced" | "error";
  viewMode: "station" | "pass";
  cloudUnavailable: boolean;
}) {
  const selectedStation = data.stations.find((station) => station.id === stationId);
  const stationName = selectedStation?.name ?? "Todas as estações";
  const stationIsSpecific = stationId !== "all" && selectedStation !== undefined;
  const serviceMode = data.operationServiceMode
    ? serviceModeLabel(data.operationServiceMode)
    : "Não informado pelo servidor";

  return (
    <div className="kds-settings" data-kds-settings>
      <div className="kds-settings__intro gm-observability-row">
        <div>
          <strong>Configuração com escopo explícito</strong>
          <p>
            Preferências do terminal ficam neste navegador. Regras da unidade permanecem na fonte
            operacional e não são simuladas localmente.
          </p>
        </div>
        <Badge tone="info">Terminal ≠ unidade</Badge>
      </div>

      <div className="kds-settings__grid">
        <Card className="kds-settings-card">
          <header className="kds-settings-card__header">
            <div>
              <Badge tone="info">Somente este terminal</Badge>
              <h2>Terminal</h2>
              <p>Defina a estação, confira conexão e prepare este equipamento para o turno.</p>
            </div>
            <Badge tone={connectionReady ? "success" : "warning"}>
              {connectionReady ? "Conectado" : "Requer atenção"}
            </Badge>
          </header>

          <div className="gm-form-grid kds-settings-terminal-controls">
            <label className="gm-form-field" htmlFor="kds-terminal-label">
              <span>Nome deste terminal</span>
              <Input
                className="gm-form-control"
                id="kds-terminal-label"
                maxLength={80}
                onChange={(event) => onTerminalLabelChange(event.target.value)}
                value={terminalLabel}
              />
              <small>Instalação {installationId.slice(0, 8)} · identificação local estável.</small>
            </label>
            <fieldset>
              <legend>Área ao abrir</legend>
              <div className="segmented">
                <Button
                  aria-pressed={viewMode === "station"}
                  onClick={() => onViewModeChange("station")}
                  type="button"
                >
                  Estação
                </Button>
                <Button
                  aria-pressed={viewMode === "pass"}
                  onClick={() => onViewModeChange("pass")}
                  type="button"
                >
                  Passe / expedição
                </Button>
              </div>
            </fieldset>
            <label className="gm-form-field" htmlFor="kds-settings-station">
              <span>Estação deste terminal</span>
              <NativeSelect
                className="gm-form-control"
                data-kds-station
                disabled={stationLocked || viewMode === "pass"}
                id="kds-settings-station"
                onChange={(event) => onSelectStation(event.target.value)}
                value={stationId}
              >
                <option value="all">Todas as estações</option>
                {data.stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </NativeSelect>
              <small>Seleção local deste navegador; não altera o roteamento dos produtos.</small>
            </label>
            <div className="kds-settings-lock">
              <Button
                aria-pressed={stationLocked}
                disabled={!stationLocked && !stationIsSpecific}
                onClick={onToggleStationLock}
                size="sm"
                variant={stationLocked ? "secondary" : "primary"}
              >
                {stationLocked ? "Liberar estação" : "Fixar estação neste terminal"}
              </Button>
              {!stationLocked && !stationIsSpecific && (
                <small>Escolha uma estação específica para fixar o terminal.</small>
              )}
            </div>
            <div className="kds-terminal-profile-state" role="status">
              <Badge
                tone={
                  terminalProfileStatus === "synced"
                    ? "success"
                    : terminalProfileStatus === "error"
                      ? "warning"
                      : "neutral"
                }
              >
                {terminalProfileStatus === "synced"
                  ? "Sincronizado"
                  : terminalProfileStatus === "loading"
                    ? "Consultando perfil"
                    : "Fallback local"}
              </Badge>
              <small>{terminalProfileMessage}</small>
              {terminalProfileCanManage && (
                <Button
                  disabled={
                    terminalProfileBusy || cloudUnavailable || terminalLabel.trim().length < 1
                  }
                  onClick={onTerminalProfileSync}
                  size="sm"
                  variant="secondary"
                >
                  {terminalProfileBusy ? "Sincronizando…" : "Sincronizar perfil do terminal"}
                </Button>
              )}
            </div>
          </div>

          <KdsOpeningChecklist
            checklistKey={checklistKey}
            connectionReady={connectionReady}
            fullscreen={fullscreen}
            onPrint={onPrint}
            onTestSound={onTestSound}
            onToggleFullscreen={onToggleFullscreen}
            operatingDay={operatingDay}
            realtimeStatus={realtimeStatus}
            soundEnabled={soundEnabled}
            stationLocked={stationLocked && stationIsSpecific}
            stationName={stationName}
          />
        </Card>

        <Card className="kds-settings-card">
          <header className="kds-settings-card__header">
            <div>
              <Badge tone="neutral">Configuração da unidade</Badge>
              <h2>Estações e roteamento</h2>
              <p>Leitura das estações publicadas para esta unidade e da capacidade informada.</p>
            </div>
          </header>

          {data.stations.length === 0 ? (
            <p className="kds-settings-empty">Nenhuma estação foi publicada pelo servidor.</p>
          ) : (
            <ul className="kds-settings-stations">
              {data.stations.map((station) => {
                const capacity = station.capacity;
                const details = capacity
                  ? [
                      numberLabel(capacity.activeAssignments, "atribuições ativas"),
                      numberLabel(capacity.blockedAssignments, "bloqueadas"),
                      numberLabel(capacity.queuedQuantity, "na fila"),
                      numberLabel(capacity.preparingQuantity, "preparando"),
                    ].filter((value): value is string => value !== null)
                  : [];
                return (
                  <li key={station.id}>
                    <span>
                      <strong>{station.name}</strong>
                      {station.code && <small>{station.code}</small>}
                    </span>
                    <small>
                      {details.length > 0
                        ? details.join(" · ")
                        : "Sem capacidade quantitativa nos dados atuais"}
                    </small>
                    {capacity?.recommendation && capacity.recommendation.state !== "normal" && (
                      <Badge
                        tone={capacity.recommendation.state === "overloaded" ? "danger" : "warning"}
                      >
                        {capacity.recommendation.suggestedDelayMinutes
                          ? `Sugerir +${capacity.recommendation.suggestedDelayMinutes} min`
                          : "Revisar capacidade"}
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="kds-settings-unit-action">
            {canManageUnitSettings ? (
              <>
                <a className="gm-button gm-button--secondary gm-button--sm" href="#/catalog">
                  Configurar produtos no Cardápio
                </a>
                <small>
                  Em “Estações de produção”, cada estação selecionada recebe o item e precisa
                  concluí-lo.
                </small>
              </>
            ) : (
              <small>
                Você pode consultar estas estações. Alterações de roteamento exigem permissão de
                gestão do Cardápio.
              </small>
            )}
          </div>
        </Card>

        <KdsHardwareSettings
          bumpMap={bumpMap}
          hardwarePrinting={data.capabilities.hardwarePrinting}
          onBumpMapChange={onBumpMapChange}
          onPrinterPreferencesChange={onPrinterPreferencesChange}
          onReprint={onReprint}
          onTestPrint={onPrint}
          printBusy={printBusy}
          printerLabel={printerLabel}
          printerPreferences={printerPreferences}
        />

        {data.capabilities.availability && (
          <KdsAvailabilityPanel
            busyKeys={busyKeys}
            canManage={canManageUnitSettings}
            cloudUnavailable={cloudUnavailable && !data.capabilities.offlineAvailabilityLifecycle}
            errors={errors}
            fallbackProducts={operationalProducts}
            onChange={onAvailabilityChange}
            products={availabilityProducts}
          />
        )}

        <Card className="kds-settings-card">
          <header className="kds-settings-card__header">
            <div>
              <Badge tone="neutral">Configuração da unidade</Badge>
              <h2>Fluxo</h2>
              <p>Comportamentos habilitados pelo contrato operacional atual.</p>
            </div>
          </header>
          <dl className="kds-settings-flow">
            <div>
              <dt>Modelo de atendimento</dt>
              <dd>{serviceMode}</dd>
            </div>
            <div>
              <dt>Sequência de cursos</dt>
              <dd>{data.capabilities.courseFire ? "Disponível" : "Não habilitada"}</dd>
            </div>
            <div>
              <dt>Pronto parcial</dt>
              <dd>{data.capabilities.partialReady ? "Disponível" : "Não habilitado"}</dd>
            </div>
            <div>
              <dt>Entrega no passe</dt>
              <dd>{data.capabilities.handoff ? "Disponível" : "Não habilitado"}</dd>
            </div>
            <div>
              <dt>Lotes de produção</dt>
              <dd>{data.capabilities.batches ? "Disponíveis" : "Não habilitados"}</dd>
            </div>
          </dl>
          <small className="kds-settings-scope-note">
            Esta tela só grava regras quando o serviço está disponível; ela reflete a configuração
            recebida.
          </small>
        </Card>

        <Card className="kds-settings-card">
          <header className="kds-settings-card__header">
            <div>
              <Badge tone="info">Somente este terminal</Badge>
              <h2>Aparência</h2>
              <p>Preferências visuais e de atenção deste navegador.</p>
            </div>
          </header>

          <div className="kds-settings-options">
            <div>
              <span>
                <strong>Alertas sonoros</strong>
                <small>Válido nesta sessão do navegador.</small>
              </span>
              <Button
                aria-pressed={soundEnabled}
                onClick={onToggleSound}
                size="sm"
                variant="secondary"
              >
                {soundEnabled ? "Desativar som" : "Ativar som"}
              </Button>
            </div>

            <fieldset>
              <legend>Densidade dos tickets</legend>
              <div className="segmented">
                <Button
                  aria-pressed={density === "compact"}
                  onClick={() => onDensityChange("compact")}
                  type="button"
                >
                  Compacta
                </Button>
                <Button
                  aria-pressed={density === "comfortable"}
                  onClick={() => onDensityChange("comfortable")}
                  type="button"
                >
                  Confortável
                </Button>
              </div>
            </fieldset>

            <label>
              <input
                checked={allDayExpanded}
                onChange={(event) => onAllDayExpandedChange(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Abrir All-day por padrão</strong>
                <small>O resumo continua secundário à fila de tickets.</small>
              </span>
            </label>

            <div>
              <span>
                <strong>Tela cheia</strong>
                <small>A preferência é sincronizável; entrar exige gesto neste navegador.</small>
              </span>
              <span className="kds-settings-inline-actions">
                <label>
                  <input
                    checked={fullscreenPreferred}
                    onChange={(event) => onFullscreenPreferredChange(event.target.checked)}
                    type="checkbox"
                  />
                  Preferir ao abrir
                </label>
                <Button onClick={onToggleFullscreen} size="sm" variant="ghost">
                  {fullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
                </Button>
              </span>
            </div>
          </div>
        </Card>
      </div>

      {canManageUnitSettings && data.capabilities.analytics && (
        <section aria-label="Métricas gerenciais da produção" className="kds-settings-analytics">
          <KdsAnalyticsPanel
            analytics={analytics}
            error={analyticsError}
            loading={analyticsLoading}
            onLoad={onLoadAnalytics}
            onWindowChange={onAnalyticsWindowChange}
            windowHours={analyticsWindowHours}
          />
        </section>
      )}
    </div>
  );
}
