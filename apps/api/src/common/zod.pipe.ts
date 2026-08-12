import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodError, ZodIssue, ZodType } from "zod";

export type ZodProblemFactory = (value: unknown, error: ZodError) => unknown;

type SafeIssue = { path: PropertyKey[]; message: string };

function safeIssueMessage(code: string) {
  if (code === "invalid_type") return "Tipo inválido.";
  if (code === "too_small") return "Valor abaixo do mínimo permitido.";
  if (code === "too_big") return "Valor acima do máximo permitido.";
  if (code === "invalid_format") return "Formato inválido.";
  if (code === "unrecognized_keys") return "Campo não permitido.";
  return "Valor inválido.";
}

function safeIssuePath(path: PropertyKey[]) {
  if (path.length === 0 || path.length > 8) return null;
  const segments = path.flatMap((segment) => {
    if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) {
      return [String(segment)];
    }
    if (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(segment)) {
      return [segment];
    }
    return [];
  });
  if (segments.length !== path.length) return null;
  const joined = segments.join(".");
  return joined.length <= 120 ? joined : null;
}

function safeLeafIssues(issue: ZodIssue, prefix: PropertyKey[] = []): SafeIssue[] {
  const path = [...prefix, ...issue.path];
  if (issue.code === "invalid_union") {
    const candidates = issue.errors
      .map((branch) => branch.flatMap((nested) => safeLeafIssues(nested, path)))
      .filter((branch) => branch.length > 0)
      .sort((left, right) => left.length - right.length);
    if (candidates[0]) return candidates[0];
  }
  return [{ path, message: safeIssueMessage(issue.code) }];
}

function safeZodDetails(error: ZodError) {
  const fieldErrors = new Map<string, string[]>();
  const formErrors: string[] = [];
  for (const issue of error.issues.flatMap((candidate) => safeLeafIssues(candidate))) {
    const path = safeIssuePath(issue.path);
    if (!path) {
      if (formErrors.length < 10 && !formErrors.includes("Dados inválidos.")) {
        formErrors.push("Dados inválidos.");
      }
      continue;
    }
    if (!fieldErrors.has(path) && fieldErrors.size >= 30) continue;
    const messages = fieldErrors.get(path) ?? [];
    if (messages.length < 5 && !messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors.set(path, messages);
  }
  return {
    ...(fieldErrors.size > 0 ? { fieldErrors: Object.fromEntries(fieldErrors) } : {}),
    ...(formErrors.length > 0 ? { formErrors } : {}),
  };
}

@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(
    readonly schema: ZodType,
    private readonly problemFactory?: ZodProblemFactory,
    readonly openApiSchema?: ZodType,
  ) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        this.problemFactory?.(value, result.error) ?? {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: safeZodDetails(result.error),
        },
      );
    }
    return result.data;
  }
}
