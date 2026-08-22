"use client";

import { Input, Label, NativeSelect } from "@giromesa/ui";
import { useEffect, useMemo, useState } from "react";
import { resolveSmartPosInstallDestination, type SmartPosVendor } from "../lib/smartpos-install";

type InstallDiagnosticProps = {
  opsUrl?: string;
  redeStoreUrl?: string;
  paygoStoreUrl?: string;
  stoneStoreUrl?: string;
};

export function InstallDiagnostic({
  opsUrl,
  redeStoreUrl,
  paygoStoreUrl,
  stoneStoreUrl,
}: InstallDiagnosticProps) {
  const [vendor, setVendor] = useState<SmartPosVendor>("browser");
  const [model, setModel] = useState("");
  const [firmware, setFirmware] = useState("");
  const [browserSummary, setBrowserSummary] = useState("Verificando este dispositivo…");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const android = /Android/i.test(navigator.userAgent);
    const serviceWorker = "serviceWorker" in navigator;
    setBrowserSummary(
      [
        android ? "Android detectado" : "navegador comum",
        serviceWorker ? "PWA compatível" : "sem suporte a PWA",
        standalone ? "GiroMesa já aberto como aplicativo" : "aberto no navegador",
      ].join(" · "),
    );
  }, []);

  const destination = useMemo(
    () =>
      resolveSmartPosInstallDestination({
        vendor,
        currentOrigin:
          typeof window === "undefined" ? "https://giromesa.invalid" : window.location.origin,
        opsUrl,
        storeUrls: {
          rede: redeStoreUrl,
          paygo: paygoStoreUrl,
          stone: stoneStoreUrl,
        },
      }),
    [opsUrl, paygoStoreUrl, redeStoreUrl, stoneStoreUrl, vendor],
  );

  const smartPos = vendor !== "browser";
  const href =
    destination.kind === "homologation" && smartPos
      ? `${destination.href}&fornecedor=${encodeURIComponent(vendor)}&modelo=${encodeURIComponent(model.trim())}&firmware=${encodeURIComponent(firmware.trim())}`
      : destination.href;

  return (
    <section className="install-diagnostic" aria-labelledby="install-diagnostic-title">
      <div className="install-diagnostic-heading">
        <div>
          <p className="eyebrow">Diagnóstico local</p>
          <h2 id="install-diagnostic-title">Onde você vai instalar?</h2>
        </div>
        <span className="install-capability">{browserSummary}</span>
      </div>

      <div className="install-form">
        <div className="install-field">
          <Label htmlFor="install-device-type">Tipo de equipamento</Label>
          <NativeSelect
            id="install-device-type"
            value={vendor}
            onChange={(event) => setVendor(event.target.value as SmartPosVendor)}
          >
            <option value="browser">Celular, tablet ou computador</option>
            <option value="rede">SmartPOS Rede / Itaú</option>
            <option value="paygo">SmartPOS com PayGo</option>
            <option value="stone">SmartPOS Stone</option>
            <option value="other">Outra maquininha</option>
          </NativeSelect>
        </div>

        {smartPos && (
          <div className="install-device-fields">
            <div className="install-field">
              <Label htmlFor="install-device-model">Modelo impresso no equipamento</Label>
              <Input
                id="install-device-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Ex.: Gertec GPOS700"
                autoComplete="off"
              />
            </div>
            <div className="install-field">
              <Label htmlFor="install-device-firmware">Versão Android ou firmware</Label>
              <Input
                id="install-device-firmware"
                value={firmware}
                onChange={(event) => setFirmware(event.target.value)}
                placeholder="Ex.: Android 10 / versão 1.2.3"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <div className={`install-result install-result-${destination.kind}`} role="status">
          <strong>
            {destination.kind === "pwa" && "Instalação pelo navegador"}
            {destination.kind === "store" && "Canal oficial configurado"}
            {destination.kind === "homologation" && "Compatibilidade ainda não confirmada"}
          </strong>
          <p>
            {destination.kind === "pwa" &&
              "O aplicativo operacional mostrará a opção de instalar. Pagamento integrado exige o APK da maquininha."}
            {destination.kind === "store" &&
              "A instalação continuará no canal oficial do fornecedor. A loja controla assinatura e atualizações."}
            {destination.kind === "homologation" &&
              "Vamos validar modelo, firmware e regras da adquirente antes de liberar cobranças integradas."}
          </p>
          <a className="button button-primary install-primary-action" href={href}>
            {destination.label}
          </a>
        </div>
      </div>

      <p className="install-privacy-note">
        Este diagnóstico não envia modelo ou firmware automaticamente. Nenhuma PWA pode confirmar
        pagamentos sem o aplicativo homologado da maquininha.
      </p>
    </section>
  );
}
