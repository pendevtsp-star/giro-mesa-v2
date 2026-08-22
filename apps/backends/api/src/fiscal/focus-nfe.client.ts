import { Injectable } from "@nestjs/common";

const MANAGEMENT_BASE_URL = "https://api.focusnfe.com.br";
const HOMOLOGATION_BASE_URL = "https://homologacao.focusnfe.com.br";
const MAX_RESPONSE_BYTES = 512 * 1024;

export type FocusEnvironment = "homologation" | "production";
export type FocusDocumentModel = "nfce" | "nfe" | "nfse";

export interface FocusCompanyInput {
  nome: string;
  nome_fantasia: string;
  cnpj: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  regime_tributario: number;
  logradouro: string;
  numero: number;
  complemento?: string;
  municipio: string;
  bairro: string;
  cep: number;
  uf: string;
  telefone: string;
  email: string;
  cpf_cnpj_contabilidade?: string;
  habilita_nfe: boolean;
  habilita_nfce: boolean;
  habilita_nfse: boolean;
  discrimina_impostos: boolean;
  arquivo_certificado_base64: string;
  senha_certificado: string;
  csc_nfce_producao?: string;
  id_token_nfce_producao?: number;
  csc_nfce_homologacao?: string;
  id_token_nfce_homologacao?: number;
  serie_nfe_producao?: string;
  serie_nfe_homologacao?: string;
  serie_nfce_producao?: string;
  serie_nfce_homologacao?: string;
  serie_nfse_producao?: string;
  serie_nfse_homologacao?: string;
}

export interface FocusCompany {
  id: string;
  cnpj: string;
  tokenProduction: string | null;
  tokenHomologation: string | null;
  certificateValidUntil: string | null;
  enabled: { nfce: boolean; nfe: boolean; nfse: boolean };
}

export interface FocusDocumentResult {
  status: "processing" | "authorized" | "rejected" | "canceled" | "contingency";
  accessKey: string | null;
  number: number | null;
  series: string | null;
  taxCents: number | null;
  itemTaxCents: number[];
  xmlUrl: string | null;
  pdfUrl: string | null;
  code: string | null;
  message: string | null;
}

export interface FocusInvalidationResult {
  status: "invalidated" | "rejected";
  reference: string | null;
  xmlUrl: string | null;
  code: string | null;
  message: string | null;
}

export class FocusNfeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Array<{ field?: string; message: string }> = [],
  ) {
    super(message);
    this.name = "FocusNfeError";
  }
}

@Injectable()
export class FocusNfeClient {
  configured() {
    return Boolean(process.env.FOCUS_NFE_PRIMARY_TOKEN?.trim());
  }

  async listCompanies(cnpj: string) {
    const response = await this.request(`/v2/empresas?${new URLSearchParams({ cnpj })}`, {
      token: this.primaryToken(),
    });
    if (!Array.isArray(response))
      throw new FocusNfeError(502, "FOCUS_RESPONSE_INVALID", "Resposta inválida da Focus NFe.");
    return response.map(parseFocusCompany);
  }

  async company(id: string) {
    return parseFocusCompany(
      await this.request(`/v2/empresas/${encodeURIComponent(id)}`, {
        token: this.primaryToken(),
      }),
    );
  }

  async createCompany(input: FocusCompanyInput, dryRun = false) {
    const suffix = dryRun ? "?dry_run=1" : "";
    return parseFocusCompany(
      await this.request(`/v2/empresas${suffix}`, {
        method: "POST",
        token: this.primaryToken(),
        body: input,
      }),
    );
  }

  async updateCompany(id: string, input: FocusCompanyInput, dryRun = false) {
    const suffix = dryRun ? "?dry_run=1" : "";
    return parseFocusCompany(
      await this.request(`/v2/empresas/${encodeURIComponent(id)}${suffix}`, {
        method: "PUT",
        token: this.primaryToken(),
        body: input,
      }),
    );
  }

  async document(
    model: FocusDocumentModel,
    reference: string,
    environment: FocusEnvironment,
    token: string,
  ) {
    return parseFocusDocument(
      await this.request(`/v2/${model}/${encodeURIComponent(reference)}?completa=1`, {
        baseUrl: environment === "production" ? MANAGEMENT_BASE_URL : HOMOLOGATION_BASE_URL,
        token,
      }),
    );
  }

  async cancelDocument(
    model: FocusDocumentModel,
    reference: string,
    justification: string,
    environment: FocusEnvironment,
    token: string,
  ) {
    return parseFocusDocument(
      await this.request(`/v2/${model}/${encodeURIComponent(reference)}`, {
        baseUrl: environment === "production" ? MANAGEMENT_BASE_URL : HOMOLOGATION_BASE_URL,
        method: "DELETE",
        token,
        body: { justificativa: justification },
      }),
    );
  }

  async invalidateNfce(
    input: {
      cnpj: string;
      series: string;
      initialNumber: number;
      finalNumber: number;
      justification: string;
    },
    environment: FocusEnvironment,
    token: string,
  ): Promise<FocusInvalidationResult> {
    const value = record(
      await this.request("/v2/nfce/inutilizacao", {
        baseUrl: environment === "production" ? MANAGEMENT_BASE_URL : HOMOLOGATION_BASE_URL,
        method: "POST",
        token,
        body: {
          cnpj: input.cnpj,
          serie: input.series,
          numero_inicial: String(input.initialNumber),
          numero_final: String(input.finalNumber),
          justificativa: input.justification,
        },
      }),
    );
    const rawStatus = (
      optionalText(value.status) ??
      optionalText(value.codigo) ??
      ""
    ).toLowerCase();
    return {
      status:
        rawStatus.includes("autoriz") || rawStatus.includes("inutil") || rawStatus === "102"
          ? "invalidated"
          : "rejected",
      reference: optionalText(value.id) ?? optionalText(value.protocolo),
      xmlUrl: optionalText(value.caminho_xml) ?? optionalText(value.caminho_xml_inutilizacao),
      code: optionalText(value.codigo),
      message: optionalText(value.mensagem),
    };
  }

  async findNfceInvalidation(
    input: { cnpj: string; series: string; initialNumber: number; finalNumber: number },
    environment: FocusEnvironment,
    token: string,
  ): Promise<FocusInvalidationResult | null> {
    const query = new URLSearchParams({
      cnpj: input.cnpj,
      numero_inicial: String(input.initialNumber),
      numero_final: String(input.finalNumber),
    });
    const payload = await this.request(`/v2/nfce/inutilizacoes?${query}`, {
      baseUrl: environment === "production" ? MANAGEMENT_BASE_URL : HOMOLOGATION_BASE_URL,
      token,
    });
    const container = recordOrEmpty(payload);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(container.inutilizacoes)
        ? container.inutilizacoes
        : [];
    const match = rows.map(recordOrEmpty).find((row) => {
      const series = optionalText(row.serie);
      const initial = Number(row.numero_inicial);
      const final = Number(row.numero_final);
      return (
        series === input.series && initial === input.initialNumber && final === input.finalNumber
      );
    });
    if (!match) return null;
    return {
      status: "invalidated",
      reference: optionalText(match.id) ?? optionalText(match.protocolo),
      xmlUrl: optionalText(match.caminho_xml) ?? optionalText(match.caminho_xml_inutilizacao),
      code: optionalText(match.codigo),
      message: optionalText(match.mensagem),
    };
  }

  async artifact(url: string, environment: FocusEnvironment, token: string) {
    const baseUrl = environment === "production" ? MANAGEMENT_BASE_URL : HOMOLOGATION_BASE_URL;
    let parsed: URL;
    try {
      parsed = new URL(url, baseUrl);
    } catch {
      throw new FocusNfeError(400, "FOCUS_ARTIFACT_URL_INVALID", "URL fiscal inválida.");
    }
    if (
      parsed.protocol !== "https:" ||
      !["api.focusnfe.com.br", "homologacao.focusnfe.com.br"].includes(parsed.hostname)
    ) {
      throw new FocusNfeError(400, "FOCUS_ARTIFACT_URL_INVALID", "URL fiscal inválida.");
    }
    let response: Response;
    try {
      response = await fetch(parsed, {
        headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new FocusNfeError(503, "FOCUS_UNAVAILABLE", "Artefato fiscal indisponível.");
    }
    if (!response.ok)
      throw new FocusNfeError(
        response.status,
        "FOCUS_ARTIFACT_UNAVAILABLE",
        "Artefato fiscal indisponível.",
      );
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length === 0 || content.length > 15 * 1024 * 1024)
      throw new FocusNfeError(502, "FOCUS_RESPONSE_TOO_LARGE", "Artefato fiscal inválido.");
    return content;
  }

  private primaryToken() {
    const token = process.env.FOCUS_NFE_PRIMARY_TOKEN?.trim();
    if (!token) {
      throw new FocusNfeError(
        503,
        "FOCUS_PRIMARY_TOKEN_NOT_CONFIGURED",
        "A conta principal da Focus NFe ainda não foi configurada no ambiente.",
      );
    }
    return token;
  }

  private async request(
    path: string,
    options: {
      token: string;
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: unknown;
      baseUrl?: string;
    },
  ): Promise<unknown> {
    const configuredTimeout = Number(process.env.FOCUS_NFE_TIMEOUT_MS ?? 15_000);
    const timeout = Number.isFinite(configuredTimeout)
      ? Math.min(30_000, Math.max(1_000, configuredTimeout))
      : 15_000;
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl ?? MANAGEMENT_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          authorization: `Basic ${Buffer.from(`${options.token}:`).toString("base64")}`,
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new FocusNfeError(
        503,
        "FOCUS_UNAVAILABLE",
        "A Focus NFe não respondeu no prazo esperado.",
      );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new FocusNfeError(
        502,
        "FOCUS_RESPONSE_TOO_LARGE",
        "A resposta da Focus NFe excedeu o limite seguro.",
      );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      throw new FocusNfeError(
        502,
        "FOCUS_RESPONSE_TOO_LARGE",
        "A resposta da Focus NFe excedeu o limite seguro.",
      );
    }
    const text = new TextDecoder().decode(bytes);
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new FocusNfeError(
          502,
          "FOCUS_RESPONSE_INVALID",
          "A Focus NFe retornou uma resposta inválida.",
        );
      }
    }
    if (!response.ok) throw focusError(response.status, payload);
    return payload;
  }
}

export function parseFocusCompany(value: unknown): FocusCompany {
  const company = record(value);
  const id = typeof company.id === "number" ? String(company.id) : requiredText(company.id);
  return {
    id,
    cnpj: requiredText(company.cnpj),
    tokenProduction: optionalText(company.token_producao),
    tokenHomologation: optionalText(company.token_homologacao),
    certificateValidUntil: optionalText(company.certificado_valido_ate),
    enabled: {
      nfce: company.habilita_nfce === true,
      nfe: company.habilita_nfe === true,
      nfse: company.habilita_nfse === true || company.habilita_nfsen_producao === true,
    },
  };
}

export function parseFocusDocument(value: unknown): FocusDocumentResult {
  const document = record(value);
  const rawStatus = optionalText(document.status) ?? "";
  const status = rawStatus.includes("cancel")
    ? "canceled"
    : rawStatus.includes("autoriz")
      ? "authorized"
      : rawStatus.includes("process")
        ? "processing"
        : rawStatus.includes("conting")
          ? "contingency"
          : "rejected";
  const requested = recordOrEmpty(document.requisicao_nota_fiscal);
  const items = Array.isArray(document.items)
    ? document.items
    : Array.isArray(requested.items)
      ? requested.items
      : [];
  return {
    status,
    accessKey: optionalText(document.chave_nfe),
    number: optionalInteger(document.numero),
    series: optionalText(document.serie),
    taxCents: decimalToCents(document.valor_total_tributos),
    itemTaxCents: items.map(
      (item) => decimalToCents(recordOrEmpty(item).valor_total_tributos) ?? 0,
    ),
    xmlUrl:
      optionalText(document.caminho_xml_nota_fiscal) ??
      optionalText(document.caminho_xml_cancelamento),
    pdfUrl: optionalText(document.caminho_danfe) ?? optionalText(document.caminho_danfe_url),
    code: optionalText(document.codigo),
    message: optionalText(document.mensagem),
  };
}

function focusError(status: number, value: unknown) {
  const payload =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const code = optionalText(payload.codigo) ?? `FOCUS_HTTP_${status}`;
  const message = optionalText(payload.mensagem) ?? "A Focus NFe rejeitou a operação.";
  const details = Array.isArray(payload.erros)
    ? payload.erros.slice(0, 20).flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const error = item as Record<string, unknown>;
        const detailMessage = optionalText(error.mensagem);
        return detailMessage
          ? [{ field: optionalText(error.campo) ?? undefined, message: detailMessage }]
          : [];
      })
    : [];
  return new FocusNfeError(status, code, message, details);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FocusNfeError(
      502,
      "FOCUS_RESPONSE_INVALID",
      "A Focus NFe retornou dados incompletos.",
    );
  }
  return value as Record<string, unknown>;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredText(value: unknown) {
  const text = optionalText(value);
  if (!text)
    throw new FocusNfeError(
      502,
      "FOCUS_RESPONSE_INVALID",
      "A Focus NFe retornou dados incompletos.",
    );
  return text;
}

function optionalText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function optionalInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decimalToCents(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}
