import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodError, ZodType } from "zod";

export type ZodProblemFactory = (value: unknown, error: ZodError) => unknown;

@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(
    readonly schema: ZodType,
    private readonly problemFactory?: ZodProblemFactory,
  ) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        this.problemFactory?.(value, result.error) ?? {
          code: "VALIDATION_ERROR",
          message: "Dados inválidos.",
          details: result.error.flatten(),
        },
      );
    }
    return result.data;
  }
}
