export const MAX_RESOURCE_VERSION = 2_147_483_647;
export const MAX_AGGREGATE_SEQUENCE = 2_147_483_647;
export const MAX_SYNC_RESOURCE_PRECONDITIONS = 128;
export const MAX_SYNC_PRICE_REFERENCES = 2_048;
export const MAX_SYNC_PAYLOAD_BYTES = 65_536;
export const MAX_SYNC_EVENT_BYTES = 950_000;
export const MAX_SYNC_BATCH_BYTES = 1_000_000;
export const MAX_SYNC_BATCH_EVENTS = 100;
export const MAX_OFFLINE_COMMAND_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const PRICE_REFERENCE_VALIDITY_MS = 35 * 24 * 60 * 60 * 1_000;
export const PRICE_REFERENCE_DELIVERY_GRACE_MS = 5 * 24 * 60 * 60 * 1_000;
export const PRICE_REFERENCE_KEY_RETENTION_MS =
  PRICE_REFERENCE_VALIDITY_MS + PRICE_REFERENCE_DELIVERY_GRACE_MS;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export type CommandAggregate = Readonly<{
  type: string;
  id: string;
}>;

export type ResourcePrecondition = Readonly<{
  type: string;
  id: string;
  occupancyEpoch: string;
  resourceVersion: number;
}>;

export type PriceReference = Readonly<{
  kind: "product" | "modifier-option";
  entityId: string;
  priceRevision: string;
  token: string;
}>;

export type EdgeCommandInput<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  Readonly<{
    commandId: string;
    idempotencyKey: string;
    actorId: string;
    deviceId: string;
    type: string;
    aggregate: CommandAggregate;
    occupancyEpoch: string;
    resourceVersion: number;
    aggregateSequence: number;
    resourcePreconditions?: readonly ResourcePrecondition[];
    priceReferences?: readonly PriceReference[];
    occurredAt: string;
    payload: TPayload;
  }>;

export type TrustedCommandContext = Readonly<{
  organizationId: string;
  unitId: string;
  receivedAt: string;
}>;

export type CommandEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> =
  EdgeCommandInput<TPayload> & TrustedCommandContext;

function requiredUuid(value: string, field: string) {
  if (!uuidPattern.test(value)) throw new TypeError(`${field} must be a UUID`);
  return value;
}

function boundedText(value: string, field: string, minimum: number, maximum: number) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new TypeError(`${field} must contain between ${minimum} and ${maximum} characters`);
  }
  return normalized;
}

function timestamp(value: string, field: string) {
  if (!isoTimestampPattern.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be an ISO 8601 timestamp with an offset`);
  }
  return value;
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function createCommandEnvelope<TPayload extends Record<string, unknown>>(
  input: EdgeCommandInput<TPayload>,
  context: TrustedCommandContext,
): Readonly<CommandEnvelope<TPayload>> {
  const aggregate = Object.freeze({
    type: boundedText(input.aggregate.type, "aggregate.type", 1, 80),
    id: requiredUuid(input.aggregate.id, "aggregate.id"),
  });
  const resourcePreconditions = Object.freeze(
    (input.resourcePreconditions ?? []).map((resource) =>
      Object.freeze({
        type: boundedText(resource.type, "resourcePreconditions.type", 1, 80),
        id: requiredUuid(resource.id, "resourcePreconditions.id"),
        occupancyEpoch: requiredUuid(
          resource.occupancyEpoch,
          "resourcePreconditions.occupancyEpoch",
        ),
        resourceVersion: boundedInteger(
          resource.resourceVersion,
          "resourcePreconditions.resourceVersion",
          0,
          MAX_RESOURCE_VERSION,
        ),
      }),
    ),
  );
  if (resourcePreconditions.length > MAX_SYNC_RESOURCE_PRECONDITIONS) {
    throw new TypeError(
      `resourcePreconditions must contain at most ${MAX_SYNC_RESOURCE_PRECONDITIONS} entries`,
    );
  }
  const priceReferences = Object.freeze(
    (input.priceReferences ?? []).map((reference) =>
      Object.freeze({
        kind: reference.kind,
        entityId: requiredUuid(reference.entityId, "priceReferences.entityId"),
        priceRevision: boundedText(
          reference.priceRevision,
          "priceReferences.priceRevision",
          1,
          100,
        ),
        token: boundedText(reference.token, "priceReferences.token", 32, 2_048),
      }),
    ),
  );
  if (priceReferences.length > MAX_SYNC_PRICE_REFERENCES) {
    throw new TypeError(`priceReferences must contain at most ${MAX_SYNC_PRICE_REFERENCES} entries`);
  }
  if (Buffer.byteLength(JSON.stringify(input.payload), "utf8") > MAX_SYNC_PAYLOAD_BYTES) {
    throw new TypeError(`payload must not exceed ${MAX_SYNC_PAYLOAD_BYTES} bytes`);
  }
  const envelope = {
    commandId: requiredUuid(input.commandId, "commandId"),
    idempotencyKey: boundedText(input.idempotencyKey, "idempotencyKey", 8, 160),
    organizationId: requiredUuid(context.organizationId, "organizationId"),
    unitId: requiredUuid(context.unitId, "unitId"),
    actorId: requiredUuid(input.actorId, "actorId"),
    deviceId: requiredUuid(input.deviceId, "deviceId"),
    type: boundedText(input.type, "type", 3, 100),
    aggregate,
    occupancyEpoch: requiredUuid(input.occupancyEpoch, "occupancyEpoch"),
    resourceVersion: boundedInteger(
      input.resourceVersion,
      "resourceVersion",
      0,
      MAX_RESOURCE_VERSION,
    ),
    aggregateSequence: boundedInteger(
      input.aggregateSequence,
      "aggregateSequence",
      1,
      MAX_AGGREGATE_SEQUENCE,
    ),
    resourcePreconditions,
    priceReferences,
    occurredAt: timestamp(input.occurredAt, "occurredAt"),
    receivedAt: timestamp(context.receivedAt, "receivedAt"),
    payload: input.payload,
  };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_SYNC_EVENT_BYTES) {
    throw new TypeError(`command event must not exceed ${MAX_SYNC_EVENT_BYTES} bytes`);
  }
  return Object.freeze(envelope);
}
