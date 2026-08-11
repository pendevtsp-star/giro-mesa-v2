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

function componentName(prefix: string, definitionName: string) {
  const suffix = definitionName === "__schema0" ? "recursive" : definitionName;
  return `${prefix}_${suffix}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

function rewriteDefinitionRefs(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((child) => rewriteDefinitionRefs(child, names));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === "$ref" && typeof child === "string") {
        const match = child.match(/^#\/(?:definitions|\$defs)\/([^/]+)$/);
        const promotedName = match?.[1] ? names.get(match[1]) : undefined;
        if (promotedName) return [key, `#/components/schemas/${promotedName}`];
      }
      return [key, rewriteDefinitionRefs(child, names)];
    }),
  );
}

function promoteDiscriminatedUnion(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { [name]: value };
  const schema = value as Record<string, unknown>;
  if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2 || schema.discriminator) {
    return { [name]: value };
  }

  const tagGroups = schema.oneOf.map((branch) => {
    if (!branch || typeof branch !== "object" || Array.isArray(branch)) return undefined;
    const properties = (branch as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties))
      return undefined;
    const typeProperty = (properties as Record<string, unknown>).type;
    if (!typeProperty || typeof typeProperty !== "object" || Array.isArray(typeProperty)) {
      return undefined;
    }
    const values = (typeProperty as Record<string, unknown>).enum;
    return Array.isArray(values) &&
      values.length > 0 &&
      values.every((item) => typeof item === "string")
      ? (values as string[])
      : undefined;
  });
  if (tagGroups.some((tags) => !tags)) return { [name]: value };
  const tags = tagGroups.flatMap((group) => group ?? []);
  if (new Set(tags).size !== tags.length) return { [name]: value };

  const memberNames = tagGroups.map((group) => componentName(name, (group ?? []).join("_")));
  const mapping = Object.fromEntries(
    tagGroups.flatMap((group, index) =>
      (group ?? []).map((tag) => [tag, `#/components/schemas/${memberNames[index]}`]),
    ),
  );
  return {
    [name]: {
      ...schema,
      oneOf: memberNames.map((memberName) => ({ $ref: `#/components/schemas/${memberName}` })),
      discriminator: { propertyName: "type", mapping },
    },
    ...Object.fromEntries(
      schema.oneOf.map((branch, index) => [memberNames[index] as string, branch]),
    ),
  };
}

export function promoteOpenApiDefinitions(schema: Record<string, unknown>, prefix: string) {
  const definitions = (schema.definitions ?? schema.$defs) as Record<string, unknown> | undefined;
  if (!definitions) return { schema, components: {} as Record<string, unknown> };

  const names = new Map(
    Object.keys(definitions).map((name) => [name, componentName(prefix, name)] as const),
  );
  const requestSchema = { ...schema };
  delete requestSchema.definitions;
  delete requestSchema.$defs;

  const components: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const promotedName = names.get(name) as string;
    Object.assign(
      components,
      promoteDiscriminatedUnion(rewriteDefinitionRefs(definition, names), promotedName),
    );
  }

  return {
    schema: rewriteDefinitionRefs(requestSchema, names) as Record<string, unknown>,
    components,
  };
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
            if (!operation?.operationId?.startsWith(operationPrefix)) continue;
            const promoted = promoteOpenApiDefinitions(
              toOpenApiSchema(pipe.schema),
              `${operation.operationId}_request`,
            );
            document.components ??= {};
            document.components.schemas = {
              ...document.components.schemas,
              ...(promoted.components as NonNullable<
                NonNullable<OpenAPIObject["components"]>["schemas"]
              >),
            };
            operation.requestBody = {
              required: true,
              content: { "application/json": { schema: promoted.schema } },
            };
          }
        }
      }
    }
  }
}
