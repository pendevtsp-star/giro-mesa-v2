import { isAbsolute } from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type EdgeHubInstallerChannel = "pilot" | "stable";

export interface EdgeHubInstallerConfig {
  channel: EdgeHubInstallerChannel;
  filePath: string | null;
  publicUrl: string | null;
  sha256: string;
  version: string;
}

function organizationAllowlist(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function edgeHubInstallerConfig(
  organizationId: string,
  environment: NodeJS.ProcessEnv = process.env,
): EdgeHubInstallerConfig | null {
  const filePath = environment.EDGE_HUB_WINDOWS_INSTALLER_PATH?.trim() || null;
  const publicUrl = environment.EDGE_HUB_WINDOWS_INSTALLER_URL?.trim() || null;
  if (!filePath && !publicUrl) return null;

  const channel = environment.EDGE_HUB_WINDOWS_INSTALLER_CHANNEL?.trim();
  const version = environment.EDGE_HUB_WINDOWS_INSTALLER_VERSION?.trim();
  const sha256 = environment.EDGE_HUB_WINDOWS_INSTALLER_SHA256?.trim().toLowerCase();
  if ((channel !== "pilot" && channel !== "stable") || !version || !sha256) return null;
  if (!SHA256_PATTERN.test(sha256)) return null;

  if (channel === "pilot") {
    const allowedOrganizations = organizationAllowlist(environment.EDGE_HUB_PILOT_ORGANIZATION_IDS);
    if (!allowedOrganizations.has(organizationId)) return null;
  }

  if (filePath && environment.NODE_ENV === "production" && !isAbsolute(filePath)) return null;
  if (publicUrl) {
    let parsed: URL;
    try {
      parsed = new URL(publicUrl);
    } catch {
      return null;
    }
    if (environment.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
  }

  return { channel, filePath, publicUrl, sha256, version };
}

export function publicEdgeHubInstaller(config: EdgeHubInstallerConfig) {
  return {
    channel: config.channel,
    sha256: config.sha256,
    version: config.version,
  };
}
