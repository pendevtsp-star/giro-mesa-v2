export const MAX_RESOURCE_VERSION = 2_147_483_647;
export const MAX_AGGREGATE_SEQUENCE = 2_147_483_647;

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
  const priceReferences = Object.freeze(
    (input.priceReferences ?? []).map((reference) =>
      Object.freeze({
        kind: reference.kind,
        entityId: requiredUuid(reference.entityId, "priceReferences.entityId"),
        token: boundedText(reference.token, "priceReferences.token", 32, 2_048),
      }),
    ),
  );
  return Object.freeze({
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
  });
}
