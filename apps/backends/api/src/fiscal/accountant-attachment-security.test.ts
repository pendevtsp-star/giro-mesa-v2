import assert from "node:assert/strict";
import { createServer } from "node:net";
import { it } from "node:test";
import {
  accountantAttachmentRetentionUntil,
  scanAccountantAttachment,
} from "./accountant-attachment-security.js";

async function clamd(response: string, check: (port: number) => Promise<void>) {
  const server = createServer((socket) => {
    socket.on("data", () => undefined);
    socket.on("end", () => socket.end(`${response}\0`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await check(address.port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

it("fails closed in production and accepts only clean ClamAV responses", async () => {
  await assert.rejects(
    scanAccountantAttachment(Buffer.from("safe"), {
      NODE_ENV: "production",
      ACCOUNTANT_ATTACHMENT_SCAN_MODE: "disabled",
    }),
  );
  await clamd("stream: OK", async (port) => {
    await scanAccountantAttachment(Buffer.from("safe"), {
      NODE_ENV: "production",
      ACCOUNTANT_ATTACHMENT_SCAN_MODE: "clamd",
      ACCOUNTANT_ATTACHMENT_CLAMD_HOST: "127.0.0.1",
      ACCOUNTANT_ATTACHMENT_CLAMD_PORT: String(port),
    });
  });
  await clamd("stream: Eicar-Test-Signature FOUND", async (port) => {
    await assert.rejects(
      scanAccountantAttachment(Buffer.from("unsafe"), {
        NODE_ENV: "production",
        ACCOUNTANT_ATTACHMENT_SCAN_MODE: "clamd",
        ACCOUNTANT_ATTACHMENT_CLAMD_HOST: "127.0.0.1",
        ACCOUNTANT_ATTACHMENT_CLAMD_PORT: String(port),
      }),
      (error: unknown) => JSON.stringify(error).includes("ACCOUNTANT_ATTACHMENT_MALWARE_DETECTED"),
    );
  });
  assert.equal(
    accountantAttachmentRetentionUntil(new Date("2026-01-01T00:00:00.000Z"), {
      NODE_ENV: "production",
      ACCOUNTANT_ATTACHMENT_RETENTION_DAYS: "30",
    }),
    "2026-01-31T00:00:00.000Z",
  );
});
