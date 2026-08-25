import { createConnection } from "node:net";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";

type AttachmentSecurityEnvironment = NodeJS.ProcessEnv;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("INVALID_POSITIVE_INTEGER");
  return parsed;
}

export function accountantAttachmentRetentionUntil(
  now = new Date(),
  environment: AttachmentSecurityEnvironment = process.env,
) {
  let days: number;
  try {
    days = positiveInteger(
      environment.ACCOUNTANT_ATTACHMENT_RETENTION_DAYS,
      environment.NODE_ENV === "production" ? Number.NaN : 1827,
    );
  } catch {
    throw new ServiceUnavailableException({
      code: "ACCOUNTANT_ATTACHMENT_RETENTION_NOT_CONFIGURED",
      message: "A política de retenção de anexos ainda não foi configurada.",
    });
  }
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export async function scanAccountantAttachment(
  content: Buffer,
  environment: AttachmentSecurityEnvironment = process.env,
) {
  const mode =
    environment.ACCOUNTANT_ATTACHMENT_SCAN_MODE?.trim() ||
    (environment.NODE_ENV === "production" ? "clamd" : "disabled");
  if (mode === "disabled") {
    if (environment.NODE_ENV === "production")
      throw new ServiceUnavailableException({ code: "ACCOUNTANT_ATTACHMENT_SCAN_REQUIRED" });
    return;
  }
  if (mode !== "clamd")
    throw new ServiceUnavailableException({ code: "ACCOUNTANT_ATTACHMENT_SCAN_MODE_INVALID" });

  const host = environment.ACCOUNTANT_ATTACHMENT_CLAMD_HOST?.trim();
  let port: number;
  let timeoutMs: number;
  try {
    if (!host) throw new Error("MISSING_HOST");
    port = positiveInteger(environment.ACCOUNTANT_ATTACHMENT_CLAMD_PORT, 3310);
    timeoutMs = positiveInteger(environment.ACCOUNTANT_ATTACHMENT_SCAN_TIMEOUT_MS, 10_000);
  } catch {
    throw new ServiceUnavailableException({ code: "ACCOUNTANT_ATTACHMENT_SCAN_NOT_CONFIGURED" });
  }

  const response = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host, port });
    const chunks: Buffer[] = [];
    const fail = (error: unknown) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error("CLAMD_TIMEOUT")));
    socket.on("error", fail);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "")));
    socket.on("connect", () => {
      const size = Buffer.allocUnsafe(4);
      size.writeUInt32BE(content.length);
      socket.end(Buffer.concat([Buffer.from("zINSTREAM\0"), size, content, Buffer.alloc(4)]));
    });
  }).catch(() => {
    throw new ServiceUnavailableException({
      code: "ACCOUNTANT_ATTACHMENT_SCAN_UNAVAILABLE",
      message: "Não foi possível verificar a segurança do anexo. Tente novamente.",
    });
  });

  if (/\bFOUND$/i.test(response))
    throw new ConflictException({
      code: "ACCOUNTANT_ATTACHMENT_MALWARE_DETECTED",
      message: "O anexo foi bloqueado pela verificação de segurança.",
    });
  if (!/\bOK$/i.test(response))
    throw new ServiceUnavailableException({ code: "ACCOUNTANT_ATTACHMENT_SCAN_UNAVAILABLE" });
}
