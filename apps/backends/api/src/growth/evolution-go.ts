import { evolutionCredentialReference, evolutionInstanceToken } from "@giromesa/domain";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export class EvolutionGoError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly deliveryUncertain = false,
  ) {
    super(code);
  }
}

export interface EvolutionGoStatus {
  state: "ready" | "connecting" | "disconnected";
  ready: boolean;
  connectedNumber: string | null;
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new EvolutionGoError(`${name}_REQUIRED`, false);
  return value;
}

export class EvolutionGoClient {
  readonly token: string;
  readonly credentialReference: string;
  readonly instanceName: string;
  private readonly baseUrl: string;
  private readonly globalApiKey: string;
  private readonly webhookUrl: string;

  constructor(
    readonly integrationId: string,
    readonly unitId: string,
    private readonly options: {
      environment?: NodeJS.ProcessEnv;
      fetcher?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    const environment = options.environment ?? process.env;
    this.baseUrl = required(environment, "WHATSAPP_EVOLUTION_API_URL").replace(/\/$/, "");
    this.globalApiKey = required(environment, "WHATSAPP_EVOLUTION_GLOBAL_API_KEY");
    this.webhookUrl = required(environment, "WHATSAPP_EVOLUTION_WEBHOOK_URL");
    const url = new URL(this.baseUrl);
    if (!["http:", "https:"].includes(url.protocol))
      throw new EvolutionGoError("WHATSAPP_EVOLUTION_API_URL_INVALID", false);
    this.token = evolutionInstanceToken(
      integrationId,
      required(environment, "WHATSAPP_EVOLUTION_TOKEN_SECRET"),
    );
    this.credentialReference = evolutionCredentialReference(this.token);
    this.instanceName = `giromesa_${unitId.replaceAll("-", "")}`;
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    options: { admin?: boolean; sending?: boolean; maxResponseBytes?: number } = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await (this.options.fetcher ?? fetch)(`${this.baseUrl}${path}`, {
        method,
        headers: {
          apikey: options.admin ? this.globalApiKey : this.token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (Buffer.byteLength(raw) > (options.maxResponseBytes ?? MAX_RESPONSE_BYTES))
        throw new EvolutionGoError("EVOLUTION_RESPONSE_TOO_LARGE", false);
      let payload: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          payload = parsed as Record<string, unknown>;
        } catch {
          throw new EvolutionGoError(
            "EVOLUTION_RESPONSE_INVALID",
            response.status >= 500,
            Boolean(options.sending),
          );
        }
      }
      if (!response.ok) {
        const knownPreSendFailure =
          Boolean(options.sending) && [400, 401, 404, 503].includes(response.status);
        throw new EvolutionGoError(
          `EVOLUTION_HTTP_${response.status}`,
          knownPreSendFailure || (!options.sending && response.status >= 500),
          Boolean(options.sending) && !knownPreSendFailure,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof EvolutionGoError) throw error;
      throw new EvolutionGoError(
        "EVOLUTION_UNAVAILABLE",
        !options.sending,
        Boolean(options.sending),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async create() {
    return this.request(
      "POST",
      "/instance/create",
      { name: this.instanceName, token: this.token },
      { admin: true },
    );
  }

  async connect() {
    return this.request("POST", "/instance/connect", {
      webhookUrl: this.webhookUrl,
      subscribe: ["MESSAGE", "READ_RECEIPT"],
    });
  }

  async reconnect() {
    try {
      return await this.request("POST", "/instance/reconnect");
    } catch (error) {
      if (!(error instanceof EvolutionGoError) || error.code !== "EVOLUTION_HTTP_404") throw error;
      return this.connect();
    }
  }

  async logout() {
    return this.request("DELETE", "/instance/logout");
  }

  async status(): Promise<EvolutionGoStatus> {
    const payload = await this.request("GET", "/instance/status");
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const ready = Boolean(data.LoggedIn ?? data.loggedIn);
    const connected = Boolean(data.Connected ?? data.connected);
    const jid = String(data.myJid ?? data.jid ?? "");
    return {
      state: ready ? "ready" : connected ? "connecting" : "disconnected",
      ready,
      connectedNumber: jid ? (jid.split("@", 1)[0] ?? null) : null,
    };
  }

  async qr() {
    const status = await this.status();
    if (status.ready) return { ...status, qrDataUrl: null };
    const payload = await this.request("GET", "/instance/qr");
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const value = typeof data.qrcode === "string" ? data.qrcode : null;
    return { ...status, state: value ? ("qr_ready" as const) : status.state, qrDataUrl: value };
  }

  async downloadMedia(message: Record<string, unknown>) {
    let payload: Record<string, unknown>;
    try {
      payload = await this.request(
        "POST",
        "/message/downloadimage",
        { message },
        { maxResponseBytes: 4_300_000 },
      );
    } catch (error) {
      if (!(error instanceof EvolutionGoError) || error.code !== "EVOLUTION_HTTP_404") throw error;
      payload = await this.request(
        "POST",
        "/message/downloadmedia",
        { message },
        { maxResponseBytes: 4_300_000 },
      );
    }
    const data =
      payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : {};
    const value = data.base64;
    if (typeof value !== "string" || value.length < 8 || value.length > 4_200_000)
      throw new EvolutionGoError("EVOLUTION_MEDIA_RESPONSE_INVALID", false);
    return value;
  }
}
