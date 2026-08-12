import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type Database,
  type PublicTableCapability,
  publicMenus,
  publicTableServiceSettings,
  publicTableSessionNonces,
  publicTableSessionRateLimits,
  publicTableSessions,
  tableOccupancies,
} from "@giromesa/db";
import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface TableQrClaims {
  type: "table-qr";
  organizationId: string;
  unitId: string;
  menuId: string;
  tableId: string;
}

export interface TableSessionClaims {
  type: "table-session";
  sessionId: string;
  organizationId: string;
  unitId: string;
  menuId: string;
  tableId: string;
  occupancyId: string;
  occupancyEpoch: string;
  capabilities: PublicTableCapability[];
  nonce: string;
  expiresAt: number;
}

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TOKEN");
  return value as Record<string, unknown>;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || value.length === 0) throw new Error("INVALID_TOKEN");
  return value;
}

export class TableSessionCodec {
  private readonly secret: string | undefined;

  constructor(secret = process.env.PUBLIC_TABLE_SESSION_SIGNING_KEY) {
    this.secret = secret;
  }

  issueTableQr(claims: Omit<TableQrClaims, "type">) {
    return this.sign("q1", { type: "table-qr", ...claims });
  }

  verifyTableQr(token: string): TableQrClaims {
    const value = this.verify("q1", token);
    if (value.type !== "table-qr") throw new Error("INVALID_TABLE_QR");
    return {
      type: "table-qr",
      organizationId: requiredText(value.organizationId),
      unitId: requiredText(value.unitId),
      menuId: requiredText(value.menuId),
      tableId: requiredText(value.tableId),
    };
  }

  issueSession(claims: Omit<TableSessionClaims, "type" | "nonce" | "expiresAt">, expiresAt: Date) {
    const nonce = randomBytes(24).toString("base64url");
    const payload: TableSessionClaims = {
      type: "table-session",
      ...claims,
      nonce,
      expiresAt: Math.floor(expiresAt.getTime() / 1_000),
    };
    return { token: this.sign("v1", payload), nonceHash: this.hash(nonce), claims: payload };
  }

  verifySession(token: string, now = new Date()): TableSessionClaims {
    const value = this.verify("v1", token);
    const capabilities = value.capabilities;
    if (
      value.type !== "table-session" ||
      !Array.isArray(capabilities) ||
      !capabilities.every((item) =>
        ["call_waiter", "request_bill", "view_partial"].includes(String(item)),
      ) ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Math.floor(now.getTime() / 1_000)
    ) {
      throw new Error("TABLE_SESSION_EXPIRED");
    }
    return {
      type: "table-session",
      sessionId: requiredText(value.sessionId),
      organizationId: requiredText(value.organizationId),
      unitId: requiredText(value.unitId),
      menuId: requiredText(value.menuId),
      tableId: requiredText(value.tableId),
      occupancyId: requiredText(value.occupancyId),
      occupancyEpoch: requiredText(value.occupancyEpoch),
      capabilities: capabilities as PublicTableCapability[],
      nonce: requiredText(value.nonce),
      expiresAt: value.expiresAt,
    };
  }

  hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private sign(prefix: "q1" | "v1", payload: unknown) {
    const body = encoded(payload);
    const signature = createHmac("sha256", this.key())
      .update(`${prefix}.${body}`)
      .digest("base64url");
    return `${prefix}.${body}.${signature}`;
  }

  private verify(prefix: "q1" | "v1", token: string) {
    const [actualPrefix, body, suppliedSignature, extra] = token.split(".");
    if (actualPrefix !== prefix || !body || !suppliedSignature || extra)
      throw new Error("INVALID_TOKEN");
    const expectedSignature = createHmac("sha256", this.key())
      .update(`${prefix}.${body}`)
      .digest("base64url");
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("INVALID_TOKEN_SIGNATURE");
    }
    try {
      return object(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    } catch {
      throw new Error("INVALID_TOKEN_PAYLOAD");
    }
  }

  private key() {
    if (!this.secret || Buffer.byteLength(this.secret) < 32) {
      throw new Error("PUBLIC_TABLE_SESSION_SIGNING_KEY must have at least 32 bytes");
    }
    return Buffer.from(this.secret);
  }
}

@Injectable()
export class TableSessionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly codec: TableSessionCodec,
  ) {}

  async issue(slug: string, qrToken: string, requestSource: string) {
    let qr: TableQrClaims;
    try {
      qr = this.codec.verifyTableQr(qrToken);
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_TABLE_QR",
        message: "QR da mesa inválido.",
      });
    }
    const [menu] = await this.database.db
      .select({
        id: publicMenus.id,
        organizationId: publicMenus.organizationId,
        unitId: publicMenus.unitId,
      })
      .from(publicMenus)
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicMenus.active, true),
          gt(publicMenus.publishedAt, new Date(0)),
        ),
      )
      .limit(1);
    if (
      !menu ||
      menu.id !== qr.menuId ||
      menu.organizationId !== qr.organizationId ||
      menu.unitId !== qr.unitId
    ) {
      throw new UnauthorizedException({
        code: "INVALID_TABLE_QR",
        message: "QR da mesa inválido.",
      });
    }
    await this.enforceRateLimit(menu.organizationId, menu.unitId, menu.id, requestSource);
    const [occupancy] = await this.database.db
      .select({ id: tableOccupancies.id, occupancyEpoch: tableOccupancies.occupancyEpoch })
      .from(tableOccupancies)
      .where(
        and(
          eq(tableOccupancies.organizationId, menu.organizationId),
          eq(tableOccupancies.unitId, menu.unitId),
          eq(tableOccupancies.tableId, qr.tableId),
          inArray(tableOccupancies.state, ["open", "paying"]),
        ),
      )
      .limit(1);
    if (!occupancy) {
      throw new UnauthorizedException({
        code: "TABLE_OCCUPANCY_REQUIRED",
        message: "A mesa não possui atendimento aberto.",
      });
    }
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1_000);
    const capabilities = await this.currentCapabilities(menu.organizationId, menu.unitId);
    const issued = this.codec.issueSession(
      {
        sessionId,
        organizationId: menu.organizationId,
        unitId: menu.unitId,
        menuId: menu.id,
        tableId: qr.tableId,
        occupancyId: occupancy.id,
        occupancyEpoch: occupancy.occupancyEpoch,
        capabilities,
      },
      expiresAt,
    );
    await this.database.db.insert(publicTableSessions).values({
      id: sessionId,
      organizationId: menu.organizationId,
      unitId: menu.unitId,
      menuId: menu.id,
      tableId: qr.tableId,
      occupancyId: occupancy.id,
      occupancyEpoch: occupancy.occupancyEpoch,
      nonceHash: issued.nonceHash,
      capabilities,
      expiresAt,
    });
    return { token: issued.token, expiresAt: expiresAt.toISOString(), capabilities };
  }

  async validate(slug: string, token: string, capability: PublicTableCapability, tx?: Transaction) {
    let claims: TableSessionClaims;
    try {
      claims = this.codec.verifySession(token);
    } catch {
      throw new UnauthorizedException({
        code: "INVALID_TABLE_SESSION",
        message: "Sessão da mesa inválida ou expirada.",
      });
    }
    const client = tx ?? this.database.db;
    if (tx) {
      await tx.execute(
        sql`select 1 from ${publicTableSessions} where ${publicTableSessions.id} = ${claims.sessionId} for share`,
      );
      await tx.execute(
        sql`select 1 from ${publicTableServiceSettings}
            where ${publicTableServiceSettings.organizationId} = ${claims.organizationId}
              and ${publicTableServiceSettings.unitId} = ${claims.unitId}
            for share`,
      );
      await tx.execute(
        sql`select 1 from ${tableOccupancies} where ${tableOccupancies.id} = ${claims.occupancyId} for share`,
      );
    }
    const [session] = await client
      .select({
        occupancyEpoch: publicTableSessions.occupancyEpoch,
        capabilities: publicTableSessions.capabilities,
      })
      .from(publicTableSessions)
      .innerJoin(publicMenus, eq(publicMenus.id, publicTableSessions.menuId))
      .where(
        and(
          eq(publicMenus.slug, slug),
          eq(publicTableSessions.id, claims.sessionId),
          eq(publicTableSessions.organizationId, claims.organizationId),
          eq(publicTableSessions.unitId, claims.unitId),
          eq(publicTableSessions.menuId, claims.menuId),
          eq(publicTableSessions.tableId, claims.tableId),
          eq(publicTableSessions.occupancyId, claims.occupancyId),
          eq(publicTableSessions.occupancyEpoch, claims.occupancyEpoch),
          eq(publicTableSessions.nonceHash, this.codec.hash(claims.nonce)),
          isNull(publicTableSessions.revokedAt),
          gt(publicTableSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session)
      throw new UnauthorizedException({
        code: "TABLE_SESSION_STALE",
        message: "TABLE_SESSION_STALE",
      });
    const currentCapabilities = await this.currentCapabilities(
      claims.organizationId,
      claims.unitId,
      client,
    );
    if (
      !session.capabilities.includes(capability) ||
      !claims.capabilities.includes(capability) ||
      !currentCapabilities.includes(capability)
    ) {
      throw new ForbiddenException({
        code: "TABLE_SESSION_CAPABILITY_DENIED",
        message: "Ação não permitida para esta mesa.",
      });
    }
    const [occupancy] = await client
      .select({ id: tableOccupancies.id })
      .from(tableOccupancies)
      .where(
        and(
          eq(tableOccupancies.id, claims.occupancyId),
          eq(tableOccupancies.organizationId, claims.organizationId),
          eq(tableOccupancies.unitId, claims.unitId),
          eq(tableOccupancies.tableId, claims.tableId),
          eq(tableOccupancies.occupancyEpoch, claims.occupancyEpoch),
          inArray(tableOccupancies.state, ["open", "paying"]),
        ),
      )
      .limit(1);
    if (!occupancy) {
      await client
        .update(publicTableSessions)
        .set({
          revokedAt: new Date(),
          revokeReason: "occupancy_epoch_changed",
          resourceVersion: sql`${publicTableSessions.resourceVersion} + 1`,
        })
        .where(eq(publicTableSessions.id, claims.sessionId));
      throw new UnauthorizedException({
        code: "TABLE_SESSION_STALE",
        message: "TABLE_SESSION_STALE",
      });
    }
    return claims;
  }

  async consumeRequestNonce(
    claims: TableSessionClaims,
    nonce: string,
    purpose: string,
    tx?: Transaction,
  ) {
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(nonce)) {
      throw new UnauthorizedException({
        code: "INVALID_REQUEST_NONCE",
        message: "Nonce inválido.",
      });
    }
    try {
      await (tx ?? this.database.db).insert(publicTableSessionNonces).values({
        organizationId: claims.organizationId,
        unitId: claims.unitId,
        sessionId: claims.sessionId,
        nonceHash: this.codec.hash(nonce),
        purpose,
        expiresAt: new Date(Math.min(claims.expiresAt * 1_000, Date.now() + 10 * 60 * 1_000)),
        consumedAt: new Date(),
      });
    } catch (error) {
      const databaseError = error as { code?: string; cause?: { code?: string } };
      if (databaseError.code === "23505" || databaseError.cause?.code === "23505") {
        throw new UnauthorizedException({
          code: "TABLE_SESSION_REPLAY",
          message: "Comando já consumido.",
        });
      }
      throw error;
    }
  }

  async currentCapabilities(
    organizationId: string,
    unitId: string,
    client: Database | Transaction = this.database.db,
  ) {
    const [settings] = await client
      .select()
      .from(publicTableServiceSettings)
      .where(
        and(
          eq(publicTableServiceSettings.organizationId, organizationId),
          eq(publicTableServiceSettings.unitId, unitId),
        ),
      )
      .limit(1);
    const capabilities: PublicTableCapability[] = [];
    if (settings?.callWaiterEnabled) capabilities.push("call_waiter");
    if (settings?.requestBillEnabled) capabilities.push("request_bill");
    if (settings?.viewPartialEnabled) capabilities.push("view_partial");
    return capabilities;
  }

  private async enforceRateLimit(
    organizationId: string,
    unitId: string,
    menuId: string,
    source: string,
  ) {
    const bucketHash = this.codec.hash(source.trim() || "unknown");
    const windowStartedAt = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const [bucket] = await this.database.db
      .insert(publicTableSessionRateLimits)
      .values({
        organizationId,
        unitId,
        menuId,
        bucketHash,
        windowStartedAt,
        expiresAt: new Date(windowStartedAt.getTime() + 2 * 60_000),
      })
      .onConflictDoUpdate({
        target: [
          publicTableSessionRateLimits.menuId,
          publicTableSessionRateLimits.bucketHash,
          publicTableSessionRateLimits.windowStartedAt,
        ],
        set: { requestCount: sql`${publicTableSessionRateLimits.requestCount} + 1` },
      })
      .returning({ requestCount: publicTableSessionRateLimits.requestCount });
    if (bucket && bucket.requestCount > 12) {
      throw new HttpException(
        { code: "TABLE_SESSION_RATE_LIMITED", message: "Muitas tentativas para este QR." },
        429,
      );
    }
  }
}
