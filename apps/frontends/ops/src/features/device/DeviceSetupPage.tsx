import { Badge, Button, Callout, Card, Input, Label } from "@giromesa/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { configuredApiBaseUrl } from "../../api";
import type { DeviceContext } from "../../bridge";
import { applyPwaUpdate, requestPwaInstall, usePwaSnapshot } from "../../pwa";
import {
  consumePendingShellPaymentPairing,
  getShellPaymentCapabilities,
  redeemShellPaymentPairing,
  type ShellPaymentCapabilities,
  type ShellPaymentPairingResult,
} from "../counter/pos-payment-bridge";
import { type PaymentCapabilities, posPayments } from "../counter/pos-payments";
import { ProductionPrintersPanel } from "./ProductionPrintersPanel";
import { SmartPosAdminPanel } from "./SmartPosAdminPanel";
import "./device.css";

function installLabel(state: ReturnType<typeof usePwaSnapshot>["install"]) {
  if (state === "installed") return "Instalado";
  if (state === "installable") return "Pronto para instalar";
  if (state === "installing") return "Instalando…";
  if (state === "manual") return "Instalação pelo navegador";
  return "Não compatível";
}

function updateLabel(state: ReturnType<typeof usePwaSnapshot>["update"]) {
  if (state === "available") return "Atualização disponível";
  if (state === "applying") return "Atualizando…";
  if (state === "checking") return "Verificando…";
  if (state === "error") return "Indisponível";
  return "Atualizado";
}

function NativePairingCard({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(configuredApiBaseUrl());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShellPaymentPairingResult | null>(null);
  const [error, setError] = useState("");
  const consumeStarted = useRef(false);

  const redeem = useCallback(
    async (nextCode: string, nextApiBaseUrl: string) => {
      setBusy(true);
      setError("");
      try {
        const next = await redeemShellPaymentPairing(nextApiBaseUrl, nextCode);
        setResult(next);
        if (!next.success) {
          setError(
            next.errorCode
              ? `O aplicativo não concluiu o pareamento (${next.errorCode}).`
              : "O aplicativo não concluiu o pareamento.",
          );
          return;
        }
        onPaired();
      } finally {
        setBusy(false);
      }
    },
    [onPaired],
  );

  useEffect(() => {
    if (consumeStarted.current) return;
    consumeStarted.current = true;
    setBusy(true);
    void consumePendingShellPaymentPairing()
      .then(async (pending) => {
        if (!pending.available || !pending.apiBaseUrl || !pending.code) {
          if (
            pending.errorCode &&
            !pending.errorCode.endsWith("NOT_AVAILABLE") &&
            pending.errorCode !== "PAYMENT_PAIRING_BRIDGE_UNAVAILABLE"
          ) {
            setError(`O aplicativo não conseguiu ler o pareamento (${pending.errorCode}).`);
          }
          return;
        }
        setCode(pending.code);
        setApiBaseUrl(pending.apiBaseUrl);
        await redeem(pending.code, pending.apiBaseUrl);
      })
      .finally(() => {
        setBusy(false);
      });
  }, [redeem]);

  return (
    <Card className="device-setup__card device-pairing-card">
      <div className="device-setup__heading">
        <div>
          <p className="eyebrow">Ativar este APK</p>
          <h2>Pareamento do SmartPOS</h2>
        </div>
        <Badge tone={result?.success ? "success" : error ? "danger" : "info"}>
          {busy ? "Verificando" : result?.success ? "Pareado" : "Aguardando código"}
        </Badge>
      </div>
      <p>
        Ao abrir o QR Code pelo sistema do terminal, o APK consome o deep link uma vez e executa o
        pareamento P-256. Se isso não ocorrer, digite o código temporário abaixo.
      </p>
      <form
        className="device-pairing-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 8) void redeem(code, apiBaseUrl);
        }}
      >
        <Label htmlFor="device-pairing-code">
          Código temporário
          <Input
            autoComplete="one-time-code"
            id="device-pairing-code"
            inputMode="text"
            maxLength={8}
            onChange={(event) =>
              setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
            }
            placeholder="AB12CD34"
            value={code}
          />
        </Label>
        <Button disabled={busy || code.length !== 8} type="submit">
          {busy ? "Ativando…" : "Ativar neste terminal"}
        </Button>
      </form>
      {result?.success && (
        <Callout tone={result.available ? "success" : "warning"}>
          <strong>{result.available ? "Terminal pronto" : "Pareamento concluído"}</strong>
          <p>
            {result.available
              ? `Pagamento disponível${result.provider ? ` via ${result.provider.toUpperCase()}` : ""}.`
              : "O terminal foi identificado, mas pagamento continua bloqueado até certificação e capabilities confirmadas pelo servidor."}
          </p>
        </Callout>
      )}
      {error && (
        <p className="device-pairing-error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

export function DeviceSetupPage({
  canManage,
  canReconcile,
  organizationId,
  runtime,
  unitId,
}: {
  canManage: boolean;
  canReconcile: boolean;
  organizationId: string;
  runtime: DeviceContext;
  unitId: string;
}) {
  const pwa = usePwaSnapshot();
  const [pairingRevision, setPairingRevision] = useState(0);
  const [payment, setPayment] = useState<
    | { status: "loading" }
    | { status: "ready"; data: PaymentCapabilities }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [nativePayment, setNativePayment] = useState<ShellPaymentCapabilities | null>(null);

  useEffect(() => {
    void pairingRevision;
    let active = true;
    setPayment({ status: "loading" });
    void posPayments
      .capabilities(organizationId, unitId, runtime.deviceId)
      .then((data) => {
        if (active) setPayment({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (active) {
          setPayment({
            status: "error",
            message:
              error instanceof Error ? error.message : "Não foi possível consultar a maquininha.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId, pairingRevision, runtime.deviceId, unitId]);

  useEffect(() => {
    if (!runtime.embedded) {
      setNativePayment(null);
      return;
    }
    let active = true;
    void getShellPaymentCapabilities().then((data) => {
      if (active) setNativePayment(data);
    });
    return () => {
      active = false;
    };
  }, [runtime.embedded]);

  const nativeMatchesBackend =
    payment.status === "ready" &&
    nativePayment?.available === true &&
    nativePayment.configured &&
    nativePayment.homologated &&
    nativePayment.provider === payment.data.provider &&
    payment.data.methods.every((method) => nativePayment.methods.includes(method));
  const paymentReady =
    payment.status === "ready" &&
    payment.data.available &&
    runtime.embedded &&
    nativeMatchesBackend &&
    nativePayment?.canStart === true;
  return (
    <section className="device-setup" aria-label="Instalação e diagnóstico do dispositivo">
      <Callout tone={runtime.embedded ? "success" : "info"}>
        <strong>
          {runtime.embedded ? "Aplicativo do terminal conectado" : "Executando como PWA"}
        </strong>
        <p>
          {runtime.embedded
            ? "O GiroMesa pode entregar cobranças ao adaptador homologado desta maquininha."
            : "A PWA instala o atendimento, sem pagamento direto. O navegador não recebe dados de cartão."}
        </p>
      </Callout>

      <ProductionPrintersPanel
        canManage={canManage}
        organizationId={organizationId}
        runtime={runtime}
        unitId={unitId}
      />

      {runtime.embedded && (
        <NativePairingCard onPaired={() => setPairingRevision((value) => value + 1)} />
      )}

      <SmartPosAdminPanel
        canManage={canManage}
        canReconcile={canReconcile}
        key={pairingRevision}
        organizationId={organizationId}
        unitId={unitId}
      />

      <div className="device-setup__grid">
        <Card className="device-setup__card">
          <div className="device-setup__heading">
            <div>
              <p className="eyebrow">Aplicativo</p>
              <h2>{runtime.embedded ? "Aplicativo SmartPOS" : "Instalar neste dispositivo"}</h2>
            </div>
            <Badge tone={runtime.embedded || pwa.install === "installed" ? "success" : "info"}>
              {runtime.embedded ? "APK conectado" : installLabel(pwa.install)}
            </Badge>
          </div>
          <p>
            {runtime.embedded
              ? "Este APK deve ser iniciado pelo portal público e instalado pela loja ou pelo processo homologado do fabricante."
              : "Instale a PWA pelo navegador para deixar o atendimento na tela inicial, em modo retrato. Ela não substitui o APK de pagamento."}
          </p>
          <dl className="device-diagnostics">
            {runtime.embedded ? (
              <>
                <div>
                  <dt>Instalação</dt>
                  <dd>{runtime.deviceName}</dd>
                </div>
                <div>
                  <dt>Plataforma</dt>
                  <dd>{runtime.platform}</dd>
                </div>
                <div>
                  <dt>Distribuição</dt>
                  <dd>Portal e loja homologada</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>Conexão segura</dt>
                  <dd>{pwa.secureContext ? "Pronta" : "HTTPS obrigatório"}</dd>
                </div>
                <div>
                  <dt>Uso sem rede</dt>
                  <dd>{pwa.serviceWorker ? "Shell preparado" : "Ainda não preparado"}</dd>
                </div>
                <div>
                  <dt>Atualização</dt>
                  <dd>{updateLabel(pwa.update)}</dd>
                </div>
              </>
            )}
          </dl>
          {!runtime.embedded && (
            <div className="device-setup__actions">
              {pwa.install === "installable" || pwa.install === "installing" ? (
                <Button
                  disabled={pwa.install === "installing"}
                  onClick={() => void requestPwaInstall()}
                >
                  {pwa.install === "installing" ? "Instalando…" : "Instalar GiroMesa"}
                </Button>
              ) : (
                <Button
                  disabled={pwa.install === "installed"}
                  onClick={() => void requestPwaInstall()}
                >
                  {pwa.install === "installed" ? "GiroMesa instalado" : "Como instalar"}
                </Button>
              )}
              {pwa.update === "available" && (
                <Button onClick={applyPwaUpdate} variant="secondary">
                  Atualizar agora
                </Button>
              )}
            </div>
          )}
          {!runtime.embedded && pwa.install === "manual" && (
            <small>
              No Chrome Android, abra o menu ⋮ e escolha “Instalar app”. Se a opção não aparecer,
              confirme HTTPS e a política do fabricante da maquininha.
            </small>
          )}
          {!runtime.embedded && pwa.message && <small role="status">{pwa.message}</small>}
        </Card>

        <Card className="device-setup__card">
          <div className="device-setup__heading">
            <div>
              <p className="eyebrow">Pagamento</p>
              <h2>Maquininha integrada</h2>
            </div>
            <Badge
              tone={paymentReady ? "success" : payment.status === "error" ? "danger" : "warning"}
            >
              {payment.status === "loading"
                ? "Verificando"
                : paymentReady
                  ? "Homologada"
                  : "Não disponível"}
            </Badge>
          </div>
          {payment.status === "ready" ? (
            <>
              <dl className="device-diagnostics">
                <div>
                  <dt>Provedor</dt>
                  <dd>{payment.data.provider?.toUpperCase() ?? "Não configurado"}</dd>
                </div>
                <div>
                  <dt>Métodos</dt>
                  <dd>
                    {payment.data.methods.length > 0
                      ? payment.data.methods
                          .map((method) =>
                            method === "credit_card"
                              ? "Crédito"
                              : method === "debit_card"
                                ? "Débito"
                                : "Pix",
                          )
                          .join(", ")
                      : "Nenhum"}
                  </dd>
                </div>
                <div>
                  <dt>Instalação</dt>
                  <dd title={runtime.deviceId}>{runtime.deviceName}</dd>
                </div>
              </dl>
              {(!payment.data.available || !runtime.embedded) && (
                <Callout tone="warning">
                  <strong>Pagamento direto bloqueado</strong>
                  <p>
                    {!runtime.embedded
                      ? "A PWA operacional não acessa o SDK da maquininha. Cartão e Pix não serão registrados manualmente."
                      : (payment.data.reason ??
                        "Esta instalação ainda não possui provedor homologado. Cartão e Pix não serão registrados manualmente.")}
                  </p>
                </Callout>
              )}
              {payment.data.available && runtime.embedded && !paymentReady && (
                <Callout tone="warning">
                  <strong>Aplicativo ainda não pode cobrar</strong>
                  <p>
                    {!nativeMatchesBackend
                      ? "Configuração, provedor ou métodos do aplicativo divergem do servidor."
                      : nativePayment?.errorCode
                        ? `O shell bloqueou o início (${nativePayment.errorCode}).`
                        : "A integração do servidor está homologada, mas o adaptador nativo ainda não confirmou prontidão."}
                  </p>
                </Callout>
              )}
            </>
          ) : payment.status === "error" ? (
            <Callout tone="danger">
              <strong>Diagnóstico indisponível</strong>
              <p>{payment.message}</p>
            </Callout>
          ) : (
            <p role="status">Consultando a configuração desta instalação…</p>
          )}
        </Card>
      </div>

      <Callout tone="warning">
        <strong>Limite importante</strong>
        <p>
          Instalar a PWA não instala o SDK bancário. O pagamento só é liberado pela certificação
          interna e pelo APK homologado para o terminal; nunca pela PWA.
        </p>
      </Callout>
    </section>
  );
}
