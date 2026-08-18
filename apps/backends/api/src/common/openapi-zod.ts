import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum.js";
import { ModulesContainer } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { OpenAPIObject } from "@nestjs/swagger";
import { type ZodType, z } from "zod";
import { ZodPipe } from "./zod.pipe.js";

const httpMethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

function openApi30(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApi30);
  if (!value || typeof value !== "object") return value;

  const schema = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, openApi30(child)]),
  ) as Record<string, unknown>;
  delete schema.propertyNames;
  if ("const" in schema) {
    schema.enum = [schema.const];
    delete schema.const;
  }
  for (const bound of ["Minimum", "Maximum"] as const) {
    const exclusive = `exclusive${bound}`;
    if (typeof schema[exclusive] === "number") {
      schema[bound.toLowerCase()] = schema[exclusive];
      schema[exclusive] = true;
    }
  }
  return schema;
}

export function toOpenApiSchema(schema: ZodType) {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete jsonSchema.$schema;
  return openApi30(jsonSchema) as Record<string, unknown>;
}

export function matchesOperationId(operationId: string, prefix: string) {
  return operationId === prefix || operationId.startsWith(`${prefix}[`);
}

export function addZodRequestBodies(app: NestFastifyApplication, document: OpenAPIObject) {
  const modules = app.get(ModulesContainer);
  for (const module of modules.values()) {
    for (const controller of module.controllers.values()) {
      const controllerType = controller.metatype;
      if (!controllerType) continue;
      for (const methodName of Object.getOwnPropertyNames(controllerType.prototype)) {
        const argumentsMetadata = Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          controllerType,
          methodName,
        ) as Record<string, { pipes?: unknown[] }> | undefined;
        const pipe = Object.entries(argumentsMetadata ?? {})
          .filter(([key]) => Number(key.split(":", 1)[0]) === RouteParamtypes.BODY)
          .map(([, argument]) => argument)
          .flatMap((argument) => argument.pipes ?? [])
          .find((candidate): candidate is ZodPipe => candidate instanceof ZodPipe);
        if (!pipe) continue;

        const operationPrefix = `${controllerType.name}_${methodName}`;
        for (const path of Object.values(document.paths)) {
          for (const method of httpMethods) {
            const operation = path?.[method];
            if (
              !operation?.operationId ||
              !matchesOperationId(operation.operationId, operationPrefix)
            )
              continue;
            operation.requestBody = {
              required: true,
              content: { "application/json": { schema: toOpenApiSchema(pipe.schema) } },
            };
          }
        }
      }
    }
  }
}
