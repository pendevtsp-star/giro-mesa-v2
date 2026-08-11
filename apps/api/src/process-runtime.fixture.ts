import "reflect-metadata";
import type { TelemetryRuntime } from "@giromesa/observability";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { startApiProcess } from "./process-runtime.js";

@Module({})
class ShutdownFixtureModule {}

function report(event: string) {
  process.send?.({ event });
}

const telemetry: TelemetryRuntime = {
  async start() {},
  async forceFlush() {
    report("telemetry.flush");
    if (process.env.FIXTURE_FLUSH_FAILS === "true") throw new Error("fixture flush failed");
  },
  async shutdown() {
    report("telemetry.shutdown");
    setImmediate(() => process.disconnect?.());
  },
};

await startApiProcess({
  env: { PORT: "3200", HOST: "127.0.0.1" },
  startTelemetry: async () => telemetry,
  createApplication: async () => {
    const nest = await NestFactory.create(ShutdownFixtureModule, new FastifyAdapter(), {
      logger: false,
    });
    return {
      app: {
        async listen() {
          await nest.init();
          report("nest.started");
        },
        async close() {
          await nest.close();
          report("nest.closed");
        },
      },
    };
  },
});

process.on("message", (message: unknown) => {
  if (message && typeof message === "object" && Reflect.get(message, "command") === "SIGTERM") {
    process.emit("SIGTERM");
  }
});
report("ready");
