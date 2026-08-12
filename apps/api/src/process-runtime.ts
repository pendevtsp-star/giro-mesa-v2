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

async function cleanupApiResources(
  app: ApiApplication | undefined,
  telemetry: TelemetryRuntime,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  if (app) await attempt(() => app.close());
  await attempt(() => telemetry.forceFlush());
  await attempt(() => telemetry.shutdown());
  return errors;
}

function throwCleanupErrors(errors: unknown[]) {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "API shutdown encountered multiple failures");
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
  let app: ApiApplication | undefined;
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
    const cleanupErrors = await cleanupApiResources(app, telemetry);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "API startup failed and cleanup was incomplete",
        { cause: error },
      );
    }
    throw error;
  }

  const runningApp = app;

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      const errors = await cleanupApiResources(runningApp, telemetry);
      throwCleanupErrors(errors);
    })();
    return stopping;
  };
  const registerSignal = dependencies.registerSignal ?? registerProcessSignal;
  registerSignal("SIGINT", stop);
  registerSignal("SIGTERM", stop);
  return { stop };
}
