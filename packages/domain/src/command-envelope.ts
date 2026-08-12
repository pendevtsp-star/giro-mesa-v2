import envelopeContract from "./fixtures/sync-envelope-contract.json" with { type: "json" };

export const SYNC_ENVELOPE_CONTRACT = Object.freeze(envelopeContract);
export const MAX_RESOURCE_VERSION = envelopeContract.resourceVersionMax;
export const MAX_AGGREGATE_SEQUENCE = envelopeContract.aggregateSequenceMax;
export const MAX_SYNC_RESOURCE_PRECONDITIONS = envelopeContract.resourcePreconditionsMax;
export const MAX_SYNC_PRICE_REFERENCES = envelopeContract.priceReferencesMax;
export const MAX_SYNC_PAYLOAD_BYTES = envelopeContract.payloadBytesMax;
export const MAX_SYNC_EVENT_BYTES = envelopeContract.eventBytesMax;
export const MAX_SYNC_BATCH_BYTES = envelopeContract.batchBytesMax;
export const MAX_SYNC_HTTP_BODY_BYTES = envelopeContract.httpBodyBytesMax;
export const MAX_SYNC_BATCH_EVENTS = envelopeContract.batchEventsMax;
export const MAX_SYNC_ACKNOWLEDGEMENTS = envelopeContract.acknowledgementsMax;
export const MAX_OFFLINE_COMMAND_AGE_MS =
  envelopeContract.offlineCommandAgeDays * 24 * 60 * 60 * 1_000;
export const MAX_FUTURE_CLOCK_SKEW_MS = envelopeContract.futureClockSkewSeconds * 1_000;
export const PRICE_REFERENCE_OCCURRED_AT_SKEW_MS =
  envelopeContract.priceOccurredAtSkewSeconds * 1_000;
export const PRICE_REFERENCE_VALIDITY_MS =
  envelopeContract.priceReferenceValidityDays * 24 * 60 * 60 * 1_000;
export const PRICE_REFERENCE_DELIVERY_GRACE_MS =
  envelopeContract.priceReferenceDeliveryGraceDays * 24 * 60 * 60 * 1_000;
export const PRICE_REFERENCE_KEY_RETENTION_MS =
  PRICE_REFERENCE_VALIDITY_MS + PRICE_REFERENCE_DELIVERY_GRACE_MS;

const uuidPattern = new RegExp(envelopeContract.uuidPattern);
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
    type: boundedText(
      input.aggregate.type,
      "aggregate.type",
      envelopeContract.aggregateTypeMin,
      envelopeContract.aggregateTypeMax,
    ),
    id: requiredUuid(input.aggregate.id, "aggregate.id"),
  });
  const resourcePreconditions = Object.freeze(
    (input.resourcePreconditions ?? []).map((resource) =>
      Object.freeze({
        type: boundedText(
          resource.type,
          "resourcePreconditions.type",
          envelopeContract.aggregateTypeMin,
          envelopeContract.aggregateTypeMax,
        ),
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
          envelopeContract.priceRevisionMin,
          envelopeContract.priceRevisionMax,
        ),
        token: boundedText(
          reference.token,
          "priceReferences.token",
          envelopeContract.priceTokenMin,
          envelopeContract.priceTokenMax,
        ),
      }),
    ),
  );
  if (priceReferences.length > MAX_SYNC_PRICE_REFERENCES) {
    throw new TypeError(
      `priceReferences must contain at most ${MAX_SYNC_PRICE_REFERENCES} entries`,
    );
  }
  if (Buffer.byteLength(JSON.stringify(input.payload), "utf8") > MAX_SYNC_PAYLOAD_BYTES) {
    throw new TypeError(`payload must not exceed ${MAX_SYNC_PAYLOAD_BYTES} bytes`);
  }
  const envelope = {
    commandId: requiredUuid(input.commandId, "commandId"),
    idempotencyKey: boundedText(
      input.idempotencyKey,
      "idempotencyKey",
      envelopeContract.idempotencyKeyMin,
      envelopeContract.idempotencyKeyMax,
    ),
    organizationId: requiredUuid(context.organizationId, "organizationId"),
    unitId: requiredUuid(context.unitId, "unitId"),
    actorId: requiredUuid(input.actorId, "actorId"),
    deviceId: requiredUuid(input.deviceId, "deviceId"),
    type: boundedText(
      input.type,
      "type",
      envelopeContract.eventTypeMin,
      envelopeContract.eventTypeMax,
    ),
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
