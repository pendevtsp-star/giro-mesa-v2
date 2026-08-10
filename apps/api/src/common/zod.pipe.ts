import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        details: result.error.flatten(),
      });
    }
    return result.data;
  }
}
