import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplication, shouldExposeOpenApi } from "./app-factory.js";

test("exposes OpenAPI only outside production", () => {
  assert.equal(shouldExposeOpenApi("development"), true);
  assert.equal(shouldExposeOpenApi("test"), true);
  assert.equal(shouldExposeOpenApi("production"), false);
});

test("boots the complete Nest application graph", async (context) => {
  if (!process.env.DATABASE_URL) {
    context.skip("DATABASE_URL not configured");
    return;
  }

  const { app, document } = await createApplication();
  assert.equal(document.paths["/api/v1/public/menus/{slug}"]?.get?.requestBody, undefined);
  assert.ok(document.paths["/api/v1/auth/register"]?.post?.requestBody);
  await app.close();
});
