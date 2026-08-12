export const pilotCommandTypes = [
  "pos.tab.open_requested",
  "pos.order.create_requested",
  "pos.order.send_requested",
  "pos.tab.transfer_requested",
  "pos.tabs.merge_requested",
  "pos.tab.split_requested",
  "pos.tab.service_charge_requested",
  "pos.tab.tip_requested",
  "pos.item.discount_requested",
  "pos.item.cancel_requested",
  "pos.kds.transition_requested",
] as const;

export type PilotCommandType = (typeof pilotCommandTypes)[number];
export type PilotDeliveryState =
  | "new"
  | "duplicate-identical"
  | "duplicate-divergent"
  | "gap"
  | "reordered";
export type PilotResourceState = "missing" | "active" | "terminal";

export type PilotConflictInput = Readonly<{
  commandType: string;
  delivery: PilotDeliveryState;
  protocol: "ordered" | "legacy";
  commandEpoch: string | null;
  currentEpoch: string | null;
  commandVersion: number | null;
  currentVersion: number | null;
  resourceState: PilotResourceState;
}>;

export type PilotConflictDecision = Readonly<{
  outcome: "apply" | "replay" | "reject" | "reconcile";
  code: string;
}>;

type CommandPolicy = Readonly<{
  createsResource: boolean;
  commutativeWhenStale: boolean;
}>;

const decision = (
  outcome: PilotConflictDecision["outcome"],
  code: string,
): PilotConflictDecision => ({ outcome, code });

export function assertNever(value: never): never {
  throw new TypeError(`Unhandled conflict matrix value: ${String(value)}`);
}

export function isPilotCommandType(value: string): value is PilotCommandType {
  return (pilotCommandTypes as readonly string[]).includes(value);
}

function policyFor(commandType: PilotCommandType): CommandPolicy {
  switch (commandType) {
    case "pos.tab.open_requested":
      return { createsResource: true, commutativeWhenStale: false };
    case "pos.order.create_requested":
      return { createsResource: false, commutativeWhenStale: true };
    case "pos.order.send_requested":
    case "pos.tab.transfer_requested":
    case "pos.tabs.merge_requested":
    case "pos.tab.split_requested":
    case "pos.tab.service_charge_requested":
    case "pos.tab.tip_requested":
    case "pos.item.discount_requested":
    case "pos.item.cancel_requested":
    case "pos.kds.transition_requested":
      return { createsResource: false, commutativeWhenStale: false };
    default:
      return assertNever(commandType);
  }
}

function deliveryDecision(delivery: PilotDeliveryState): PilotConflictDecision | null {
  switch (delivery) {
    case "new":
      return null;
    case "duplicate-identical":
      return decision("replay", "IDENTICAL_COMMAND_REPLAY");
    case "duplicate-divergent":
      return decision("reject", "IDEMPOTENCY_KEY_REUSED");
    case "gap":
      return decision("reconcile", "AGGREGATE_SEQUENCE_GAP");
    case "reordered":
      return decision("reconcile", "AGGREGATE_SEQUENCE_OUT_OF_ORDER");
    default:
      return assertNever(delivery);
  }
}

export function decidePilotConflict(input: PilotConflictInput): PilotConflictDecision {
  const transport = deliveryDecision(input.delivery);
  if (transport) return transport;

  if (!isPilotCommandType(input.commandType)) {
    return decision("reject", "UNSUPPORTED_PILOT_COMMAND");
  }
  const policy = policyFor(input.commandType);

  if (input.protocol === "legacy") {
    if (policy.createsResource && input.resourceState === "missing") {
      return decision("apply", "LEGACY_SAFE_CREATE");
    }
    if (policy.commutativeWhenStale && input.resourceState === "active") {
      return decision("apply", "LEGACY_COMMUTATIVE_ADD");
    }
    return decision("reject", "LEGACY_PRECONDITION_REQUIRED");
  }

  if (input.resourceState === "missing") {
    if (policy.createsResource && input.commandVersion === 0) {
      return decision("apply", "INITIAL_RESOURCE");
    }
    return decision("reject", "RESOURCE_NOT_FOUND");
  }
  if (input.resourceState === "terminal") {
    return decision("reject", "RESOURCE_TERMINAL");
  }
  if (input.commandEpoch !== input.currentEpoch) {
    return decision("reconcile", "OCCUPANCY_EPOCH_MISMATCH");
  }
  if (input.commandVersion === null || input.currentVersion === null) {
    return decision("reject", "RESOURCE_PRECONDITION_REQUIRED");
  }
  if (input.commandVersion > input.currentVersion) {
    return decision("reconcile", "RESOURCE_VERSION_AHEAD");
  }
  if (input.commandVersion < input.currentVersion) {
    return policy.commutativeWhenStale
      ? decision("apply", "COMMUTATIVE_STALE_VERSION")
      : decision("reject", "RESOURCE_VERSION_CONFLICT");
  }
  return decision("apply", "CURRENT_RESOURCE");
}
