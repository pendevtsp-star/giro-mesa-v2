import { startTelemetryFromEnv, type TelemetryRuntime } from "@giromesa/observability";

export type SupportedSignal = "SIGINT" | "SIGTERM";

interface ApiApplication {
  listen(port: number, host: string): Promise<unknown>;
  close(): Promise<unknown>;
}

interface ApiProcessDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly startTelemetry?: (
    serviceName: string,
    env: Readonly<Record<string, string | undefined>>,
  ) => Promise<TelemetryRuntime>;
  readonly createApplication?: () => Promise<{ app: ApiApplication }>;
  readonly registerSignal?: (signal: SupportedSignal, handler: () => Promise<void>) => void;
}

export interface ApiProcessRuntime {
  stop(): Promise<void>;
}

function registerProcessSignal(signal: SupportedSignal, handler: () => Promise<void>) {
  process.once(signal, () => {
    void handler().catch(() => {
      process.exitCode = 1;
    });
  });
}

export async function startApiProcess(
  dependencies: ApiProcessDependencies = {},
): Promise<ApiProcessRuntime> {
  const env = dependencies.env ?? process.env;
  const startTelemetry = dependencies.startTelemetry ?? startTelemetryFromEnv;
  const telemetry = await startTelemetry("giromesa.api", env);
  let app: ApiApplication;
  try {
    const createApplication =
      dependencies.createApplication ?? (await import("./app-factory.js")).createApplication;
    ({ app } = await createApplication());
    const port = Number(env.PORT ?? 3200);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("Invalid API port configuration");
    }
    await app.listen(port, env.HOST ?? "0.0.0.0");
  } catch (error) {
    try {
      await telemetry.forceFlush();
    } finally {
      await telemetry.shutdown();
    }
    throw error;
  }

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      try {
        await app.close();
      } finally {
        try {
          await telemetry.forceFlush();
        } finally {
          await telemetry.shutdown();
        }
      }
    })();
    return stopping;
  };
  const registerSignal = dependencies.registerSignal ?? registerProcessSignal;
  registerSignal("SIGINT", stop);
  registerSignal("SIGTERM", stop);
  return { stop };
}
