import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { edgeHubInstallerConfig } from "./edge-hub-installer-config.js";

const sha256 = "a".repeat(64);

describe("Edge Hub installer configuration", () => {
  it("exposes a pilot installer only to explicitly allowed organizations", () => {
    const environment = {
      NODE_ENV: "production",
      EDGE_HUB_WINDOWS_INSTALLER_PATH: "/pilot/GiroMesa-Conector-Setup.exe",
      EDGE_HUB_WINDOWS_INSTALLER_CHANNEL: "pilot",
      EDGE_HUB_WINDOWS_INSTALLER_VERSION: "2.0.0-pilot.1",
      EDGE_HUB_WINDOWS_INSTALLER_SHA256: sha256,
      EDGE_HUB_PILOT_ORGANIZATION_IDS: "organization-a, organization-b",
    };

    assert.equal(edgeHubInstallerConfig("organization-c", environment), null);
    assert.deepEqual(edgeHubInstallerConfig("organization-b", environment), {
      channel: "pilot",
      filePath: "/pilot/GiroMesa-Conector-Setup.exe",
      publicUrl: null,
      sha256,
      version: "2.0.0-pilot.1",
    });
  });

  it("fails closed when integrity metadata is missing or invalid", () => {
    assert.equal(
      edgeHubInstallerConfig("organization-a", {
        EDGE_HUB_WINDOWS_INSTALLER_PATH: "installer.exe",
        EDGE_HUB_WINDOWS_INSTALLER_CHANNEL: "pilot",
        EDGE_HUB_WINDOWS_INSTALLER_VERSION: "pilot",
        EDGE_HUB_WINDOWS_INSTALLER_SHA256: "invalid",
        EDGE_HUB_PILOT_ORGANIZATION_IDS: "organization-a",
      }),
      null,
    );
  });
});
