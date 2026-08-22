import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageSettingsUnit,
  closedBusinessHours,
  composeStoredSettings,
  copyStoredSettings,
  hasUnpublishedSettings,
  normalizeStoredBranding,
  projectPublicBranding,
} from "./establishment-settings.service.js";

describe("establishment settings projections", () => {
  it("publishes only the explicit public branding whitelist", () => {
    const businessHours = closedBusinessHours();
    const projected = projectPublicBranding(
      {
        displayName: "Mesa da Casa",
        slogan: "Comida boa",
        logoUrl: "https://cdn.example.test/logo.png",
        primaryColor: "#123456",
        accentColor: "#abcdef",
        address: "Rua Um, 10",
        phone: "11999999999",
        instagram: "@mesadacasa",
        openingHours: "Seg a sex, 9h às 18h",
        businessHours,
        notice: "Somente interno",
        serviceTaxNotice: "10%",
        wifi: { ssid: "Mesa", password: "segredo" },
        internal: { token: "nunca publicar" },
      },
      "Fallback",
      "America/Sao_Paulo",
    );

    assert.deepEqual(Object.keys(projected), [
      "displayName",
      "slogan",
      "logoUrl",
      "primaryColor",
      "accentColor",
      "address",
      "phone",
      "instagram",
      "openingHours",
      "businessHours",
      "timezone",
    ]);
    assert.equal("wifi" in projected, false);
    assert.equal(JSON.stringify(projected).includes("segredo"), false);
  });

  it("recovers malformed legacy branding with safe defaults", () => {
    const normalized = normalizeStoredBranding(
      { displayName: "", primaryColor: "red", wifi: { password: 123 } },
      "Unidade Centro",
    );
    assert.equal(normalized.presentation.displayName, "Unidade Centro");
    assert.equal(normalized.presentation.primaryColor, "#10b981");
    assert.equal(normalized.presentation.wifi, null);
    assert.equal(normalized.businessHours.weekly.length, 7);
  });

  it("marks settings pending only when they are newer than the publication", () => {
    const publishedAt = new Date("2026-08-22T12:00:00.000Z");
    assert.equal(hasUnpublishedSettings(null, new Date()), true);
    assert.equal(hasUnpublishedSettings(publishedAt, new Date("2026-08-22T11:59:00.000Z")), false);
    assert.equal(hasUnpublishedSettings(publishedAt, new Date("2026-08-22T12:01:00.000Z")), true);
  });

  it("does not combine a manager role in one unit with a staff role in another", () => {
    const roles = [
      { role: "manager", unitId: "unit-a" },
      { role: "waiter", unitId: "unit-b" },
    ];
    assert.equal(canManageSettingsUnit(roles, "unit-a"), true);
    assert.equal(canManageSettingsUnit(roles, "unit-b"), false);
  });

  it("copies public presentation and hours without copying the Wi-Fi password", () => {
    const hours = closedBusinessHours();
    hours.weekly[0] = {
      weekday: 1,
      mode: "periods",
      periods: [{ start: "18:00", end: "02:00", endsNextDay: true }],
    };
    const source = composeStoredSettings(
      {
        ...normalizeStoredBranding({}, "Origem").presentation,
        wifi: { ssid: "Origem", password: "senha-origem" },
        openingHours: "texto antigo",
      },
      hours,
    );
    const target = {
      ...normalizeStoredBranding({}, "Destino").presentation,
      wifi: { ssid: "Destino", password: "senha-destino" },
    };
    const copied = copyStoredSettings(source, "Origem", target, "Destino");
    assert.deepEqual(copied.wifi, target.wifi);
    assert.equal(copied.displayName, "Origem");
    assert.equal(
      copied.openingHours,
      "Seg: 18:00–02:00 (+1 dia); Ter: fechado; Qua: fechado; Qui: fechado; Sex: fechado; Sáb: fechado; Dom: fechado",
    );
  });
});
