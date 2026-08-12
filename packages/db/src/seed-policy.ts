export type SeedEnvironment = Readonly<Record<string, string | undefined>>;

export function demoSeedConfiguration(environment: SeedEnvironment) {
  if (environment.GIROMESA_SEED_DEMO !== "true") {
    return { enabled: false as const, namespace: null };
  }
  if (environment.NODE_ENV === "production") {
    throw new Error("DEMO_SEED_REFUSED_IN_PRODUCTION");
  }
  const namespace = environment.GIROMESA_DEMO_NAMESPACE?.trim();
  if (!namespace || !/^demo-[a-z0-9-]{3,48}$/.test(namespace)) {
    throw new Error("DEMO_SEED_REQUIRES_EXPLICIT_NAMESPACE");
  }
  if (environment.GIROMESA_DEMO_PASSWORD) {
    throw new Error("DEMO_SEED_PASSWORDS_ARE_NOT_ACCEPTED");
  }
  return { enabled: true as const, namespace };
}
