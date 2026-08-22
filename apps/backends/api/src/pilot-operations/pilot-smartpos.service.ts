import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import {
  auditEvents,
  type Database,
  deviceEnrollments,
  outboxEvents,
  posPaymentAttempts,
  posPaymentDeviceCredentials,
  posPaymentDeviceDiagnostics,
  posPaymentDevicePairingCodes,
  posPaymentDeviceRequestNonces,
  posPaymentHomologationRuns,
  posPaymentReconciliations,
  posPaymentReversals,
  posPaymentTerminalCertifications,
  posTabPayments,
  posTerminalProfiles,
} from "@giromesa/db";
import type { SystemRole } from "@giromesa/domain";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import type { PaymentDeviceSignature } from "./pilot-pos.service.js";
import { smartPosCanonicalRequest } from "./pilot-rules.js";
import type {
  PaymentDeviceCredentialRotateInput,
  PaymentDeviceDiagnosticsInput,
  PaymentDevicePairingCreateInput,
  PaymentDevicePairingRedeemInput,
  PaymentHomologationRunInput,
  PaymentReconciliationInput,
  PaymentReconciliationQueryInput,
  PaymentTerminalCertificationInput,
} from "./pilot-schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;
const CREDENTIAL_ROTATE_AFTER_MS = 30 * 24 * 60 * 60 * 1_000;
const CREDENTIAL_ROTATION_GRACE_MS = 10 * 60 * 1_000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function credentialDates(now = new Date()) {
  return {
    expiresAt: new Date(now.getTime() + CREDENTIAL_LIFETIME_MS),
    rotateAfter: new Date(now.getTime() + CREDENTIAL_ROTATE_AFTER_MS),
  };
}

function pairingCode() {
  return [...randomBytes(8)].map((byte) => PAIRING_ALPHABET[byte & 31]).join("");
}

function codeHash(value: string) {
  return createHash("sha256").update(value.trim().toUpperCase()).digest("hex");
}

function p256PublicKey(value: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("wrong curve");
    }
    return key;
  } catch {
    throw new BadRequestException({
      code: "PAYMENT_DEVICE_PUBLIC_KEY_INVALID",
      message: "A chave pública deve ser P-256 em SPKI DER base64.",
    });
  }
}

function signatureSkewSeconds() {
  const configured = Number(process.env.SMARTPOS_SIGNATURE_MAX_SKEW_SECONDS ?? 300);
  return Number.isInteger(configured) && configured >= 30 && configured <= 900 ? configured : 300;
}

function smartPosApiBaseUrl() {
  const value = process.env.API_URL ?? "http://localhost:3200";
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("API_URL must use HTTPS for SmartPOS pairing in production");
  }
  return url.origin;
}

export function smartPosInstallationLockKey(
  organizationId: string,
  unitId: string,
  installationId: string,
) {
  return `smartpos-installation:${organizationId}:${unitId}:${installationId}`;
}

@Injectable()
export class PilotSmartPosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly scope: ScopeService,
  ) {}

  async lockPaymentInstallation(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${smartPosInstallationLockKey(organizationId, unitId, installationId)}))`,
    );
  }

  private async assertNoActivePaymentOperations(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    const now = new Date();
    const [[activeAttempt], [activeReversal]] = await Promise.all([
      tx
        .select({ id: posPaymentAttempts.id })
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, organizationId),
            eq(posPaymentAttempts.unitId, unitId),
            eq(posPaymentAttempts.installationId, installationId),
            or(
              and(eq(posPaymentAttempts.status, "created"), gt(posPaymentAttempts.expiresAt, now)),
              inArray(posPaymentAttempts.status, ["processing", "unknown"]),
            ),
          ),
        )
        .limit(1),
      tx
        .select({ id: posPaymentReversals.id })
        .from(posPaymentReversals)
        .where(
          and(
            eq(posPaymentReversals.organizationId, organizationId),
            eq(posPaymentReversals.unitId, unitId),
            eq(posPaymentReversals.installationId, installationId),
            inArray(posPaymentReversals.status, ["pending", "processing", "unknown"]),
          ),
        )
        .limit(1),
    ]);
    if (activeAttempt || activeReversal) {
      throw new ConflictException({ code: "PAYMENT_DEVICE_HAS_ACTIVE_OPERATIONS" });
    }
  }

  async authenticatePaymentDevice(tx: Transaction, request: PaymentDeviceSignature) {
    const { credentialId, timestamp, nonce, signature, method, path, body } = request;
    if (
      !credentialId ||
      !/^\d{10}$/.test(timestamp ?? "") ||
      !/^[A-Za-z0-9_-]{16,96}$/.test(nonce ?? "") ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(signature ?? "") ||
      !method ||
      !path.startsWith("/")
    ) {
      throw new UnauthorizedException({ code: "PAYMENT_DEVICE_SIGNATURE_INVALID" });
    }
    const requestTime = Number(timestamp) * 1_000;
    if (Math.abs(Date.now() - requestTime) > signatureSkewSeconds() * 1_000) {
      throw new UnauthorizedException({ code: "PAYMENT_DEVICE_SIGNATURE_EXPIRED" });
    }
    const [candidateCredential] = await tx
      .select()
      .from(posPaymentDeviceCredentials)
      .where(
        and(
          eq(posPaymentDeviceCredentials.id, credentialId),
          isNull(posPaymentDeviceCredentials.revokedAt),
          gt(posPaymentDeviceCredentials.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!candidateCredential) {
      throw new UnauthorizedException({ code: "PAYMENT_DEVICE_CREDENTIAL_INVALID" });
    }
    const signedTimestamp = timestamp as string;
    const signedNonce = nonce as string;
    const signedSignature = signature as string;
    const canonical = smartPosCanonicalRequest(method, path, signedTimestamp, signedNonce, body);
    let valid = false;
    try {
      const signatureBytes = Buffer.from(signedSignature, "base64url");
      valid =
        signatureBytes.length === 64 &&
        verifySignature(
          "sha256",
          Buffer.from(canonical, "utf8"),
          { key: p256PublicKey(candidateCredential.publicKeySpki), dsaEncoding: "ieee-p1363" },
          signatureBytes,
        );
    } catch {
      valid = false;
    }
    if (!valid) throw new UnauthorizedException({ code: "PAYMENT_DEVICE_SIGNATURE_INVALID" });
    await this.lockPaymentInstallation(
      tx,
      candidateCredential.organizationId,
      candidateCredential.unitId,
      candidateCredential.installationId,
    );
    const [credential] = await tx
      .select()
      .from(posPaymentDeviceCredentials)
      .where(
        and(
          eq(posPaymentDeviceCredentials.id, candidateCredential.id),
          isNull(posPaymentDeviceCredentials.revokedAt),
          gt(posPaymentDeviceCredentials.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!credential) {
      throw new UnauthorizedException({ code: "PAYMENT_DEVICE_CREDENTIAL_INVALID" });
    }
    const [device] = await tx
      .select({
        id: deviceEnrollments.id,
        organizationId: deviceEnrollments.organizationId,
        unitId: deviceEnrollments.unitId,
      })
      .from(deviceEnrollments)
      .where(
        and(
          eq(deviceEnrollments.organizationId, credential.organizationId),
          eq(deviceEnrollments.unitId, credential.unitId),
          eq(deviceEnrollments.id, credential.installationId),
          isNull(deviceEnrollments.revokedAt),
        ),
      )
      .limit(1);
    if (!device) throw new UnauthorizedException({ code: "PAYMENT_DEVICE_REVOKED" });
    const [acceptedNonce] = await tx
      .insert(posPaymentDeviceRequestNonces)
      .values({
        credentialId: credential.id,
        nonce: signedNonce,
        requestTimestamp: new Date(requestTime),
      })
      .onConflictDoNothing()
      .returning({ nonce: posPaymentDeviceRequestNonces.nonce });
    if (!acceptedNonce) {
      throw new UnauthorizedException({ code: "PAYMENT_DEVICE_REQUEST_REPLAYED" });
    }
    const now = new Date();
    await Promise.all([
      tx
        .delete(posPaymentDeviceRequestNonces)
        .where(lt(posPaymentDeviceRequestNonces.createdAt, new Date(now.getTime() - 86_400_000))),
      tx
        .update(posPaymentDeviceCredentials)
        .set({ lastUsedAt: now })
        .where(eq(posPaymentDeviceCredentials.id, credential.id)),
      tx
        .update(posPaymentDeviceDiagnostics)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(
          and(
            eq(posPaymentDeviceDiagnostics.organizationId, device.organizationId),
            eq(posPaymentDeviceDiagnostics.unitId, device.unitId),
            eq(posPaymentDeviceDiagnostics.installationId, device.id),
          ),
        ),
    ]);
    return { ...device, credentialId: credential.id };
  }

  async paymentCapability(
    tx: Transaction,
    organizationId: string,
    unitId: string,
    installationId: string,
  ) {
    const now = new Date();
    const [[device], [profile], [diagnostics], [credential]] = await Promise.all([
      tx
        .select({ id: deviceEnrollments.id, revokedAt: deviceEnrollments.revokedAt })
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.organizationId, organizationId),
            eq(deviceEnrollments.unitId, unitId),
            eq(deviceEnrollments.id, installationId),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(posTerminalProfiles)
        .where(
          and(
            eq(posTerminalProfiles.organizationId, organizationId),
            eq(posTerminalProfiles.unitId, unitId),
            eq(posTerminalProfiles.installationId, installationId),
          ),
        )
        .limit(1),
      tx
        .select()
        .from(posPaymentDeviceDiagnostics)
        .where(
          and(
            eq(posPaymentDeviceDiagnostics.organizationId, organizationId),
            eq(posPaymentDeviceDiagnostics.unitId, unitId),
            eq(posPaymentDeviceDiagnostics.installationId, installationId),
          ),
        )
        .limit(1),
      tx
        .select({ id: posPaymentDeviceCredentials.id })
        .from(posPaymentDeviceCredentials)
        .where(
          and(
            eq(posPaymentDeviceCredentials.organizationId, organizationId),
            eq(posPaymentDeviceCredentials.unitId, unitId),
            eq(posPaymentDeviceCredentials.installationId, installationId),
            isNull(posPaymentDeviceCredentials.revokedAt),
            gt(posPaymentDeviceCredentials.expiresAt, now),
          ),
        )
        .limit(1),
    ]);
    const [certification] = profile?.paymentCertificationId
      ? await tx
          .select()
          .from(posPaymentTerminalCertifications)
          .where(
            and(
              eq(posPaymentTerminalCertifications.organizationId, organizationId),
              eq(posPaymentTerminalCertifications.unitId, unitId),
              eq(posPaymentTerminalCertifications.id, profile.paymentCertificationId),
            ),
          )
          .limit(1)
      : [];
    const diagnosticsMatch = Boolean(
      diagnostics &&
        certification &&
        diagnostics.manufacturer === certification.manufacturer &&
        diagnostics.model === certification.model &&
        diagnostics.androidVersion === certification.androidVersion &&
        diagnostics.firmwareVersion === certification.firmwareVersion &&
        diagnostics.appVersion === certification.appVersion &&
        diagnostics.packageName === certification.packageName &&
        diagnostics.signingCertificateSha256 === certification.signingCertificateSha256,
    );
    const certifiedMethods = new Set(certification?.methods ?? []);
    const methods = (profile?.paymentMethods ?? []).filter(
      (method): method is "credit_card" | "debit_card" | "pix" =>
        (method === "credit_card" || method === "debit_card" || method === "pix") &&
        certifiedMethods.has(method),
    );
    const provider = profile?.paymentProvider as
      | "rede"
      | "paygo"
      | "stone"
      | "getnet"
      | "cielo"
      | "pagbank"
      | null
      | undefined;
    const configuredStatus = (profile?.paymentStatus ?? "disabled") as
      | "disabled"
      | "pending"
      | "homologated"
      | "suspended";
    const providerMismatch = Boolean(
      provider && certification && certification.provider !== provider,
    );
    const status =
      certification?.killSwitchEnabled || certification?.status === "suspended"
        ? ("suspended" as const)
        : configuredStatus === "homologated" &&
            (!certification || !diagnosticsMatch || providerMismatch)
          ? ("pending" as const)
          : configuredStatus;
    const available = Boolean(
      device &&
        !device.revokedAt &&
        credential &&
        provider &&
        certification?.provider === provider &&
        certification.status === "approved" &&
        !certification.killSwitchEnabled &&
        diagnosticsMatch &&
        status === "homologated" &&
        methods.length,
    );
    const reason = !device
      ? "PAYMENT_DEVICE_NOT_ENROLLED"
      : device.revokedAt
        ? "PAYMENT_DEVICE_REVOKED"
        : !credential
          ? "PAYMENT_DEVICE_CREDENTIAL_MISSING"
          : !profile
            ? "PAYMENT_TERMINAL_NOT_CONFIGURED"
            : !certification
              ? "PAYMENT_CERTIFICATION_MISSING"
              : providerMismatch
                ? "PAYMENT_PROVIDER_CERTIFICATION_MISMATCH"
                : certification.killSwitchEnabled
                  ? "PAYMENT_TERMINAL_KILL_SWITCHED"
                  : certification.status !== "approved"
                    ? "PAYMENT_CERTIFICATION_SUSPENDED"
                    : !diagnosticsMatch
                      ? "PAYMENT_REPORTED_DIAGNOSTICS_MISMATCH"
                      : status !== "homologated"
                        ? `PAYMENT_TERMINAL_${status.toUpperCase()}`
                        : !provider || methods.length === 0
                          ? "PAYMENT_TERMINAL_CONFIGURATION_INCOMPLETE"
                          : null;
    return {
      installationId,
      available,
      status,
      provider: provider ?? null,
      methods,
      maxInstallments: Math.min(
        profile?.maxPaymentInstallments ?? 1,
        certification?.maxInstallments ?? 1,
      ),
      supports: {
        cancel: Boolean(profile?.paymentSupportsCancel && certification?.supportsCancel),
        recover: Boolean(profile?.paymentSupportsRecover && certification?.supportsRecover),
        reversal: Boolean(profile?.paymentSupportsReversal && certification?.supportsReversal),
      },
      reason,
      certificationId: certification?.id ?? null,
      diagnosticsMatch,
      killSwitch: {
        enabled: certification?.killSwitchEnabled ?? false,
        reason: certification?.killSwitchReason ?? null,
      },
      certification: certification
        ? {
            id: certification.id,
            provider: certification.provider as NonNullable<typeof provider>,
            status: certification.status,
            killSwitchEnabled: certification.killSwitchEnabled,
            killSwitchReason: certification.killSwitchReason,
          }
        : null,
    };
  }

  async createPairingCode(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: PaymentDevicePairingCreateInput,
  ) {
    const roles = await this.scope.requireOrganizationRole(identityId, organizationId, [
      "owner",
      "manager",
    ]);
    if (!roles.some((role) => role.unitId === null || role.unitId === unitId)) {
      throw new NotFoundException();
    }
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1_000);
    return this.database.db.transaction(async (tx) => {
      const [pairing] = await tx
        .insert(posPaymentDevicePairingCodes)
        .values({
          organizationId,
          unitId,
          label: input.label,
          codeHash: codeHash(code),
          createdByIdentityId: identityId,
          expiresAt,
        })
        .returning({ id: posPaymentDevicePairingCodes.id });
      if (!pairing) throw new Error("Payment device pairing insert did not return a row");
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.payment_device_pairing_created",
        entityType: "payment_device_pairing",
        entityId: pairing.id,
        metadata: { label: input.label, expiresAt },
      });
      return {
        pairingId: pairing.id,
        code,
        qrPayload: `giromesa://smartpos/pair?v=1&apiBaseUrl=${encodeURIComponent(smartPosApiBaseUrl())}&code=${code}`,
        expiresAt,
      };
    });
  }

  async redeemPairing(input: PaymentDevicePairingRedeemInput) {
    p256PublicKey(input.publicKeySpki);
    return this.database.db.transaction(async (tx) => {
      const hash = codeHash(input.code);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`smartpos-pair:${hash}`}))`);
      const [pairing] = await tx
        .select()
        .from(posPaymentDevicePairingCodes)
        .where(
          and(
            eq(posPaymentDevicePairingCodes.codeHash, hash),
            isNull(posPaymentDevicePairingCodes.consumedAt),
            gt(posPaymentDevicePairingCodes.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pairing) throw new ConflictException({ code: "PAYMENT_PAIRING_INVALID_OR_EXPIRED" });
      await this.lockPaymentInstallation(
        tx,
        pairing.organizationId,
        pairing.unitId,
        input.installationId,
      );
      const [existingDevice] = await tx
        .select()
        .from(deviceEnrollments)
        .where(eq(deviceEnrollments.id, input.installationId))
        .limit(1);
      if (
        existingDevice &&
        (existingDevice.organizationId !== pairing.organizationId ||
          existingDevice.unitId !== pairing.unitId ||
          existingDevice.revokedAt)
      ) {
        throw new ConflictException({ code: "PAYMENT_INSTALLATION_ID_UNAVAILABLE" });
      }
      if (existingDevice) {
        await this.assertNoActivePaymentOperations(
          tx,
          pairing.organizationId,
          pairing.unitId,
          input.installationId,
        );
      }
      if (existingDevice) {
        await tx
          .update(deviceEnrollments)
          .set({ label: pairing.label })
          .where(eq(deviceEnrollments.id, input.installationId));
      } else {
        await tx.insert(deviceEnrollments).values({
          id: input.installationId,
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          label: pairing.label,
        });
      }
      const [existingProfile] = await tx
        .select({ installationId: posTerminalProfiles.installationId })
        .from(posTerminalProfiles)
        .where(
          and(
            eq(posTerminalProfiles.organizationId, pairing.organizationId),
            eq(posTerminalProfiles.unitId, pairing.unitId),
            eq(posTerminalProfiles.installationId, input.installationId),
          ),
        )
        .limit(1);
      if (!existingProfile) {
        await tx.insert(posTerminalProfiles).values({
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          installationId: input.installationId,
          label: pairing.label,
          mode: "waiter_mobile",
          defaultRoute: "counter",
          createdByIdentityId: pairing.createdByIdentityId,
          updatedByIdentityId: pairing.createdByIdentityId,
        });
      } else {
        await tx
          .update(posTerminalProfiles)
          .set({
            label: pairing.label,
            paymentProvider: null,
            paymentStatus: "pending",
            paymentCertificationId: null,
            paymentMethods: [],
            maxPaymentInstallments: 1,
            paymentSupportsCancel: false,
            paymentSupportsRecover: false,
            paymentSupportsReversal: false,
            updatedByIdentityId: pairing.createdByIdentityId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posTerminalProfiles.organizationId, pairing.organizationId),
              eq(posTerminalProfiles.unitId, pairing.unitId),
              eq(posTerminalProfiles.installationId, input.installationId),
            ),
          );
      }
      const now = new Date();
      await tx
        .insert(posPaymentDeviceDiagnostics)
        .values({
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          installationId: input.installationId,
          ...input.diagnostics,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            posPaymentDeviceDiagnostics.organizationId,
            posPaymentDeviceDiagnostics.unitId,
            posPaymentDeviceDiagnostics.installationId,
          ],
          set: { ...input.diagnostics, lastSeenAt: now, updatedAt: now },
        });
      await tx
        .update(posPaymentDeviceCredentials)
        .set({ revokedAt: now })
        .where(
          and(
            eq(posPaymentDeviceCredentials.organizationId, pairing.organizationId),
            eq(posPaymentDeviceCredentials.unitId, pairing.unitId),
            eq(posPaymentDeviceCredentials.installationId, input.installationId),
            isNull(posPaymentDeviceCredentials.revokedAt),
          ),
        );
      const dates = credentialDates(now);
      const [credential] = await tx
        .insert(posPaymentDeviceCredentials)
        .values({
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          installationId: input.installationId,
          publicKeySpki: input.publicKeySpki,
          ...dates,
        })
        .returning({ id: posPaymentDeviceCredentials.id });
      if (!credential) throw new Error("Payment device credential insert did not return a row");
      const [consumed] = await tx
        .update(posPaymentDevicePairingCodes)
        .set({ consumedAt: now, consumedByInstallationId: input.installationId })
        .where(
          and(
            eq(posPaymentDevicePairingCodes.id, pairing.id),
            isNull(posPaymentDevicePairingCodes.consumedAt),
          ),
        )
        .returning({ id: posPaymentDevicePairingCodes.id });
      if (!consumed) throw new ConflictException({ code: "PAYMENT_PAIRING_ALREADY_USED" });
      await Promise.all([
        tx.insert(auditEvents).values({
          organizationId: pairing.organizationId,
          unitId: pairing.unitId,
          actorIdentityId: pairing.createdByIdentityId,
          action: "pos.payment_device_paired",
          entityType: "device",
          entityId: input.installationId,
          metadata: {
            pairingId: pairing.id,
            credentialId: credential.id,
            financialCapabilityReset: Boolean(existingProfile),
          },
        }),
        tx.insert(outboxEvents).values({
          topic: "pos.payment_device_paired",
          aggregateType: "device",
          aggregateId: input.installationId,
          payload: {
            organizationId: pairing.organizationId,
            unitId: pairing.unitId,
            installationId: input.installationId,
          },
        }),
      ]);
      return {
        installationId: input.installationId,
        credentialId: credential.id,
        credentialExpiresAt: dates.expiresAt,
        rotateAfter: dates.rotateAfter,
        capabilities: await this.paymentCapability(
          tx,
          pairing.organizationId,
          pairing.unitId,
          input.installationId,
        ),
      };
    });
  }

  async rotateCredential(
    request: PaymentDeviceSignature,
    input: PaymentDeviceCredentialRotateInput,
  ) {
    p256PublicKey(input.newPublicKeySpki);
    return this.database.db.transaction(async (tx) => {
      const device = await this.authenticatePaymentDevice(tx, request);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`smartpos-credential:${device.id}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(posPaymentDeviceCredentials)
        .where(
          and(
            eq(posPaymentDeviceCredentials.organizationId, device.organizationId),
            eq(posPaymentDeviceCredentials.unitId, device.unitId),
            eq(posPaymentDeviceCredentials.installationId, device.id),
            eq(posPaymentDeviceCredentials.rotationId, input.rotationId),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.publicKeySpki !== input.newPublicKeySpki) {
          throw new ConflictException({
            code: "PAYMENT_DEVICE_CREDENTIAL_ROTATION_CONFLICT",
            message: "O identificador da rotação já foi usado com outra chave pública.",
          });
        }
        const [signingCredential] = await tx
          .select({ expiresAt: posPaymentDeviceCredentials.expiresAt })
          .from(posPaymentDeviceCredentials)
          .where(eq(posPaymentDeviceCredentials.id, device.credentialId))
          .limit(1);
        return {
          credentialId: existing.id,
          credentialExpiresAt: existing.expiresAt,
          rotateAfter: existing.rotateAfter,
          previousCredentialValidUntil: signingCredential?.expiresAt ?? existing.createdAt,
        };
      }
      const now = new Date();
      const previousCredentialValidUntil = new Date(now.getTime() + CREDENTIAL_ROTATION_GRACE_MS);
      await tx
        .update(posPaymentDeviceCredentials)
        .set({ expiresAt: previousCredentialValidUntil })
        .where(eq(posPaymentDeviceCredentials.id, device.credentialId));
      const dates = credentialDates(now);
      const [credential] = await tx
        .insert(posPaymentDeviceCredentials)
        .values({
          organizationId: device.organizationId,
          unitId: device.unitId,
          installationId: device.id,
          publicKeySpki: input.newPublicKeySpki,
          rotationId: input.rotationId,
          ...dates,
        })
        .returning({ id: posPaymentDeviceCredentials.id });
      if (!credential) throw new Error("Rotated payment credential insert did not return a row");
      await Promise.all([
        tx.insert(auditEvents).values({
          organizationId: device.organizationId,
          unitId: device.unitId,
          action: "pos.payment_device_credential_rotated",
          entityType: "payment_device_credential",
          entityId: credential.id,
          metadata: {
            installationId: device.id,
            previousCredentialId: device.credentialId,
            rotationId: input.rotationId,
          },
        }),
        tx.insert(outboxEvents).values({
          topic: "pos.payment_device_credential_rotated",
          aggregateType: "device",
          aggregateId: device.id,
          payload: {
            organizationId: device.organizationId,
            unitId: device.unitId,
            installationId: device.id,
            previousCredentialId: device.credentialId,
            credentialId: credential.id,
            rotationId: input.rotationId,
          },
        }),
      ]);
      return {
        credentialId: credential.id,
        credentialExpiresAt: dates.expiresAt,
        rotateAfter: dates.rotateAfter,
        previousCredentialValidUntil,
      };
    });
  }

  async reportDiagnostics(request: PaymentDeviceSignature, input: PaymentDeviceDiagnosticsInput) {
    return this.database.db.transaction(async (tx) => {
      const device = await this.authenticatePaymentDevice(tx, request);
      const now = new Date();
      await tx
        .insert(posPaymentDeviceDiagnostics)
        .values({
          organizationId: device.organizationId,
          unitId: device.unitId,
          installationId: device.id,
          ...input,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            posPaymentDeviceDiagnostics.organizationId,
            posPaymentDeviceDiagnostics.unitId,
            posPaymentDeviceDiagnostics.installationId,
          ],
          set: { ...input, lastSeenAt: now, updatedAt: now },
        });
      return this.paymentCapability(tx, device.organizationId, device.unitId, device.id);
    });
  }

  async configureCertification(
    organizationId: string,
    unitId: string,
    certificationId: string,
    input: PaymentTerminalCertificationInput,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`smartpos-certification:${certificationId}`}))`,
      );
      const [existing] = await tx
        .select({
          organizationId: posPaymentTerminalCertifications.organizationId,
          unitId: posPaymentTerminalCertifications.unitId,
        })
        .from(posPaymentTerminalCertifications)
        .where(eq(posPaymentTerminalCertifications.id, certificationId))
        .limit(1);
      if (existing && (existing.organizationId !== organizationId || existing.unitId !== unitId)) {
        throw new ConflictException({ code: "PAYMENT_CERTIFICATION_SCOPE_MISMATCH" });
      }
      const [certification] = await tx
        .insert(posPaymentTerminalCertifications)
        .values({
          id: certificationId,
          organizationId,
          unitId,
          provider: input.provider,
          status: input.status,
          ...input.diagnostics,
          methods: input.methods,
          maxInstallments: input.maxInstallments,
          supportsCancel: input.supports.cancel,
          supportsRecover: input.supports.recover,
          supportsReversal: input.supports.reversal,
          killSwitchEnabled: input.killSwitchEnabled,
          killSwitchReason: input.killSwitchReason,
        })
        .onConflictDoUpdate({
          target: posPaymentTerminalCertifications.id,
          set: {
            provider: input.provider,
            status: input.status,
            ...input.diagnostics,
            methods: input.methods,
            maxInstallments: input.maxInstallments,
            supportsCancel: input.supports.cancel,
            supportsRecover: input.supports.recover,
            supportsReversal: input.supports.reversal,
            killSwitchEnabled: input.killSwitchEnabled,
            killSwitchReason: input.killSwitchReason,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!certification) throw new Error("Payment certification upsert did not return a row");
      await Promise.all([
        tx.insert(auditEvents).values({
          organizationId,
          unitId,
          action: "pos.payment_certification_configured",
          entityType: "payment_certification",
          entityId: certification.id,
          metadata: {
            provider: input.provider,
            status: input.status,
            killSwitchEnabled: input.killSwitchEnabled,
            killSwitchReason: input.killSwitchReason,
          },
        }),
        tx.insert(outboxEvents).values({
          topic: "pos.payment_certification_configured",
          aggregateType: "payment_certification",
          aggregateId: certification.id,
          payload: {
            organizationId,
            unitId,
            certificationId: certification.id,
            provider: input.provider,
            status: input.status,
            killSwitchEnabled: input.killSwitchEnabled,
          },
        }),
      ]);
      return { certification };
    });
  }

  async ingestReconciliation(
    organizationId: string,
    unitId: string,
    input: PaymentReconciliationInput,
  ) {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`smartpos-reconciliation:${organizationId}:${unitId}:${input.provider}:${input.providerSettlementId}:${input.providerReference}`}))`,
      );
      const [payment] = await tx
        .select({
          id: posTabPayments.id,
          amountCents: posTabPayments.amountCents,
          provider: posPaymentAttempts.provider,
        })
        .from(posTabPayments)
        .innerJoin(posPaymentAttempts, eq(posPaymentAttempts.id, posTabPayments.paymentAttemptId))
        .where(
          and(
            eq(posTabPayments.organizationId, organizationId),
            eq(posTabPayments.unitId, unitId),
            eq(posTabPayments.reference, input.providerReference),
            eq(posPaymentAttempts.provider, input.provider),
            eq(posTabPayments.source, "terminal"),
            eq(posTabPayments.verified, true),
          ),
        )
        .limit(1);
      if (!payment)
        throw new NotFoundException({ code: "PAYMENT_RECONCILIATION_PAYMENT_NOT_FOUND" });
      const [existing] = await tx
        .select()
        .from(posPaymentReconciliations)
        .where(
          and(
            eq(posPaymentReconciliations.organizationId, organizationId),
            eq(posPaymentReconciliations.unitId, unitId),
            eq(posPaymentReconciliations.provider, input.provider),
            eq(posPaymentReconciliations.providerSettlementId, input.providerSettlementId),
            eq(posPaymentReconciliations.providerReference, input.providerReference),
          ),
        )
        .limit(1);
      const effectiveStatus =
        payment.amountCents === input.grossCents ? input.status : ("divergent" as const);
      const normalized = {
        paymentId: payment.id,
        provider: input.provider,
        providerSettlementId: input.providerSettlementId,
        providerReference: input.providerReference,
        grossCents: input.grossCents,
        feeCents: input.feeCents,
        netCents: input.netCents,
        expectedSettlementAt: new Date(input.expectedSettlementAt),
        settledAt: input.settledAt ? new Date(input.settledAt) : null,
        status: effectiveStatus,
        source: input.source,
      };
      if (existing) {
        const sameIdentityAndAmounts =
          existing.paymentId === normalized.paymentId &&
          existing.grossCents === normalized.grossCents &&
          existing.feeCents === normalized.feeCents &&
          existing.netCents === normalized.netCents &&
          existing.expectedSettlementAt.getTime() === normalized.expectedSettlementAt.getTime() &&
          existing.source === normalized.source;
        if (!sameIdentityAndAmounts) {
          throw new ConflictException({ code: "PAYMENT_RECONCILIATION_CONFLICT" });
        }
        if (
          existing.status === normalized.status &&
          existing.settledAt?.getTime() === normalized.settledAt?.getTime()
        ) {
          return { reconciliation: existing, idempotentReplay: true };
        }
        const transitions: Record<typeof existing.status, readonly (typeof existing.status)[]> = {
          pending: ["matched", "divergent", "settled", "reversed"],
          matched: ["settled", "reversed"],
          divergent: ["matched", "settled", "reversed"],
          settled: ["reversed"],
          reversed: [],
        };
        if (!transitions[existing.status].includes(normalized.status)) {
          throw new ConflictException({ code: "PAYMENT_RECONCILIATION_STATUS_REGRESSION" });
        }
        const [updated] = await tx
          .update(posPaymentReconciliations)
          .set({
            status: normalized.status,
            settledAt: normalized.settledAt,
            updatedAt: new Date(),
          })
          .where(eq(posPaymentReconciliations.id, existing.id))
          .returning();
        if (!updated) throw new Error("Payment reconciliation update did not return a row");
        await Promise.all([
          tx.insert(auditEvents).values({
            organizationId,
            unitId,
            action: "pos.payment_reconciliation_updated",
            entityType: "payment_reconciliation",
            entityId: existing.id,
            metadata: { from: existing.status, to: normalized.status },
          }),
          tx.insert(outboxEvents).values({
            topic: "pos.payment_reconciliation.updated",
            aggregateType: "payment_reconciliation",
            aggregateId: existing.id,
            payload: {
              organizationId,
              unitId,
              paymentId: existing.paymentId,
              status: updated.status,
            },
          }),
        ]);
        return { reconciliation: updated, idempotentReplay: false };
      }
      const [reconciliation] = await tx
        .insert(posPaymentReconciliations)
        .values({ organizationId, unitId, ...normalized })
        .returning();
      if (!reconciliation) throw new Error("Payment reconciliation insert did not return a row");
      await Promise.all([
        tx.insert(auditEvents).values({
          organizationId,
          unitId,
          action: "pos.payment_reconciliation_ingested",
          entityType: "payment_reconciliation",
          entityId: reconciliation.id,
          metadata: { paymentId: payment.id, status: effectiveStatus, source: input.source },
        }),
        tx.insert(outboxEvents).values({
          topic: "pos.payment_reconciliation.ingested",
          aggregateType: "payment_reconciliation",
          aggregateId: reconciliation.id,
          payload: { organizationId, unitId, paymentId: payment.id, status: effectiveStatus },
        }),
      ]);
      return { reconciliation, idempotentReplay: false };
    });
  }

  async listDevices(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const devices = await tx
        .select()
        .from(deviceEnrollments)
        .where(
          and(
            eq(deviceEnrollments.organizationId, organizationId),
            eq(deviceEnrollments.unitId, unitId),
          ),
        )
        .orderBy(desc(deviceEnrollments.enrolledAt));
      return {
        devices: await Promise.all(
          devices.map(async (device) => {
            const [reportedDiagnostics] = await tx
              .select()
              .from(posPaymentDeviceDiagnostics)
              .where(
                and(
                  eq(posPaymentDeviceDiagnostics.organizationId, organizationId),
                  eq(posPaymentDeviceDiagnostics.unitId, unitId),
                  eq(posPaymentDeviceDiagnostics.installationId, device.id),
                ),
              )
              .limit(1);
            const capabilities = await this.paymentCapability(
              tx,
              organizationId,
              unitId,
              device.id,
            );
            return {
              installationId: device.id,
              label: device.label,
              enrolledAt: device.enrolledAt,
              revokedAt: device.revokedAt,
              lastSeenAt: reportedDiagnostics?.lastSeenAt ?? null,
              reportedDiagnostics: reportedDiagnostics ?? null,
              capabilities,
              certification: capabilities.certification,
            };
          }),
        ),
      };
    });
  }

  async health(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    const now = new Date();
    const staleAt = new Date(now.getTime() - 5 * 60 * 1_000);
    const offlineAt = new Date(now.getTime() - 10 * 60 * 1_000);
    const [unknown, stale, offline, divergences] = await Promise.all([
      this.database.db
        .select({ id: posPaymentAttempts.id, occurredAt: posPaymentAttempts.updatedAt })
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, organizationId),
            eq(posPaymentAttempts.unitId, unitId),
            eq(posPaymentAttempts.status, "unknown"),
          ),
        ),
      this.database.db
        .select({ id: posPaymentAttempts.id, occurredAt: posPaymentAttempts.processingAt })
        .from(posPaymentAttempts)
        .where(
          and(
            eq(posPaymentAttempts.organizationId, organizationId),
            eq(posPaymentAttempts.unitId, unitId),
            eq(posPaymentAttempts.status, "processing"),
            lte(posPaymentAttempts.processingAt, staleAt),
          ),
        ),
      this.database.db
        .select({
          id: posPaymentDeviceDiagnostics.installationId,
          occurredAt: posPaymentDeviceDiagnostics.lastSeenAt,
        })
        .from(posPaymentDeviceDiagnostics)
        .innerJoin(
          deviceEnrollments,
          and(
            eq(deviceEnrollments.organizationId, posPaymentDeviceDiagnostics.organizationId),
            eq(deviceEnrollments.unitId, posPaymentDeviceDiagnostics.unitId),
            eq(deviceEnrollments.id, posPaymentDeviceDiagnostics.installationId),
          ),
        )
        .where(
          and(
            eq(posPaymentDeviceDiagnostics.organizationId, organizationId),
            eq(posPaymentDeviceDiagnostics.unitId, unitId),
            lte(posPaymentDeviceDiagnostics.lastSeenAt, offlineAt),
            isNull(deviceEnrollments.revokedAt),
          ),
        ),
      this.database.db
        .select({
          id: posPaymentReconciliations.id,
          occurredAt: posPaymentReconciliations.updatedAt,
        })
        .from(posPaymentReconciliations)
        .where(
          and(
            eq(posPaymentReconciliations.organizationId, organizationId),
            eq(posPaymentReconciliations.unitId, unitId),
            eq(posPaymentReconciliations.status, "divergent"),
          ),
        ),
    ]);
    return {
      generatedAt: now,
      summary: {
        unknownAttempts: unknown.length,
        staleProcessingAttempts: stale.length,
        offlineDevices: offline.length,
        reconciliationDivergences: divergences.length,
      },
      incidents: [
        ...unknown.map((row) => ({
          kind: "unknown_attempt" as const,
          severity: "critical" as const,
          entityId: row.id,
          label: "Pagamento com resultado desconhecido",
          occurredAt: row.occurredAt,
        })),
        ...stale.map((row) => ({
          kind: "stale_processing" as const,
          severity: "critical" as const,
          entityId: row.id,
          label: "Pagamento processando há mais de 5 minutos",
          occurredAt: row.occurredAt ?? staleAt,
        })),
        ...offline.map((row) => ({
          kind: "offline_device" as const,
          severity: "warning" as const,
          entityId: row.id,
          label: "Terminal sem contato há mais de 10 minutos",
          occurredAt: row.occurredAt,
        })),
        ...divergences.map((row) => ({
          kind: "reconciliation_divergence" as const,
          severity: "critical" as const,
          entityId: row.id,
          label: "Divergência de conciliação",
          occurredAt: row.occurredAt,
        })),
      ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()),
    };
  }

  async listReconciliation(
    identityId: string,
    organizationId: string,
    unitId: string,
    query: PaymentReconciliationQueryInput,
  ) {
    await this.requireRoles(identityId, organizationId, unitId, ["owner", "manager", "finance"]);
    const entries = await this.database.db
      .select()
      .from(posPaymentReconciliations)
      .where(
        and(
          eq(posPaymentReconciliations.organizationId, organizationId),
          eq(posPaymentReconciliations.unitId, unitId),
          query.status ? eq(posPaymentReconciliations.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(posPaymentReconciliations.expectedSettlementAt))
      .limit(query.limit);
    return {
      entries,
      summary: {
        grossCents: entries.reduce((sum, row) => sum + row.grossCents, 0),
        feeCents: entries.reduce((sum, row) => sum + row.feeCents, 0),
        netCents: entries.reduce((sum, row) => sum + row.netCents, 0),
        divergences: entries.filter((row) => row.status === "divergent").length,
      },
    };
  }

  async recordHomologationRun(
    identityId: string,
    organizationId: string,
    unitId: string,
    input: PaymentHomologationRunInput,
  ) {
    await this.requireManager(identityId, organizationId, unitId);
    return this.database.db.transaction(async (tx) => {
      const capability = await this.paymentCapability(
        tx,
        organizationId,
        unitId,
        input.installationId,
      );
      if (capability.certificationId !== input.certificationId) {
        throw new ConflictException({ code: "PAYMENT_HOMOLOGATION_SCOPE_MISMATCH" });
      }
      const passed = capability.diagnosticsMatch && Object.values(input.checklist).every(Boolean);
      const [run] = await tx
        .insert(posPaymentHomologationRuns)
        .values({
          organizationId,
          unitId,
          ...input,
          passed,
          recordedByIdentityId: identityId,
        })
        .returning();
      if (!run) throw new Error("Payment homologation run insert did not return a row");
      await tx.insert(auditEvents).values({
        organizationId,
        unitId,
        actorIdentityId: identityId,
        action: "pos.payment_homologation_run_recorded",
        entityType: "payment_homologation_run",
        entityId: run.id,
        metadata: { certificationId: input.certificationId, passed },
      });
      return { run };
    });
  }

  async listHomologationRuns(identityId: string, organizationId: string, unitId: string) {
    await this.requireManager(identityId, organizationId, unitId);
    return {
      runs: await this.database.db
        .select()
        .from(posPaymentHomologationRuns)
        .where(
          and(
            eq(posPaymentHomologationRuns.organizationId, organizationId),
            eq(posPaymentHomologationRuns.unitId, unitId),
          ),
        )
        .orderBy(desc(posPaymentHomologationRuns.createdAt))
        .limit(100),
    };
  }

  private requireManager(identityId: string, organizationId: string, unitId: string) {
    return this.requireRoles(identityId, organizationId, unitId, ["owner", "manager"]);
  }

  private async requireRoles(
    identityId: string,
    organizationId: string,
    unitId: string,
    roles: readonly SystemRole[],
  ) {
    const scoped = await this.scope.requireOrganizationRole(identityId, organizationId, roles);
    if (!scoped.some((role) => role.unitId === null || role.unitId === unitId)) {
      throw new NotFoundException();
    }
  }
}
