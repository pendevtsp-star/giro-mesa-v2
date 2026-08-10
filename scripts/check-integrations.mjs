const present = (name) => Boolean(process.env[name]?.trim());

const checks = [
  {
    name: "Google OIDC",
    ready:
      present("GOOGLE_OAUTH_CLIENT_ID") &&
      present("GOOGLE_OAUTH_CLIENT_SECRET") &&
      present("GOOGLE_OAUTH_REDIRECT_URI") &&
      present("SESSION_SECRET") &&
      process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
    required: [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "SESSION_SECRET",
      "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true",
    ],
  },
  {
    name: "Resend",
    ready:
      process.env.EMAIL_PROVIDER_ENABLED === "true" &&
      process.env.EMAIL_PROVIDER_CREDENTIAL_REFERENCE?.toLowerCase() === "resend" &&
      present("RESEND_API_KEY") &&
      present("RESEND_FROM") &&
      present("APP_URL") &&
      present("API_URL") &&
      present("OUTBOX_ENCRYPTION_KEY"),
    required: [
      "EMAIL_PROVIDER_ENABLED=true",
      "EMAIL_PROVIDER_CREDENTIAL_REFERENCE=resend",
      "RESEND_API_KEY",
      "RESEND_FROM",
      "APP_URL",
      "API_URL",
      "OUTBOX_ENCRYPTION_KEY",
    ],
  },
  {
    name: "Focus NFC-e no Edge Hub",
    ready:
      process.env.Hub__Focus__Enabled === "true" &&
      present("Hub__Focus__Environment") &&
      present("Hub__Focus__Token"),
    required: ["Hub__Focus__Enabled=true", "Hub__Focus__Environment", "Hub__Focus__Token"],
  },
];

for (const check of checks) {
  const missing = check.required.filter((requirement) => {
    const [name, expected] = requirement.split("=");
    return expected ? process.env[name] !== expected : !present(name);
  });
  console.log(`${check.ready ? "READY" : "PENDING"}  ${check.name}`);
  if (missing.length > 0) console.log(`         missing: ${missing.join(", ")}`);
}

if (process.argv.includes("--strict") && checks.some((check) => !check.ready)) process.exitCode = 1;
