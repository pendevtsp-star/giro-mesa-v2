import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import type { DatabaseService } from "./database.module.js";
import { TenantContextInterceptor } from "./tenant-context.interceptor.js";

describe("TenantContextInterceptor public menu", () => {
  it("maps an unknown public menu slug to a stable 404 response", async () => {
    const database = {
      withPublicMenuContext: async () => {
        throw new Error("PUBLIC_MENU_SCOPE_NOT_FOUND");
      },
    } as unknown as DatabaseService;
    const reflector = {
      getAllAndOverride: () => "public-menu",
    } as unknown as Reflector;
    const request = { params: { slug: "missing-menu" } };
    const executionContext = {
      getClass: () => class TestController {},
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({}) } as CallHandler;
    const interceptor = new TenantContextInterceptor(database, reflector);

    await assert.rejects(lastValueFrom(interceptor.intercept(executionContext, next)), (error) => {
      assert.ok(error instanceof NotFoundException);
      assert.deepEqual(error.getResponse(), {
        statusCode: 404,
        code: "PUBLIC_MENU_NOT_FOUND",
        message: "O cardapio solicitado nao foi encontrado.",
      });
      return true;
    });
  });
});
