export type TableOccupancyState = "reserved" | "open" | "paying" | "closed";

export type TableOccupancySnapshot = Readonly<{
  state: TableOccupancyState;
  occupancyEpoch: string;
  resourceVersion: number;
  tableId: string;
  groupId: string | null;
}>;

type OccupancyCas = Readonly<{ occupancyEpoch: string; expectedVersion: number }>;
export type TableOccupancyCommand =
  | (OccupancyCas & { type: "seat" | "begin_payment" | "resume_service" | "close" | "cancel" })
  | (OccupancyCas & { type: "transfer"; tableId: string })
  | (OccupancyCas & { type: "group"; groupId: string })
  | (OccupancyCas & { type: "split"; tableId: string; groupId: string | null })
  | (OccupancyCas & { type: "reopen"; nextEpoch: string });

export class TableOccupancyTransitionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TableOccupancyTransitionError";
  }
}

function targetState(state: TableOccupancyState, type: TableOccupancyCommand["type"]) {
  const transitions: Readonly<Record<TableOccupancyState, Partial<Record<TableOccupancyCommand["type"], TableOccupancyState>>>> = {
    reserved: { seat: "open", cancel: "closed" },
    open: {
      begin_payment: "paying",
      close: "closed",
      transfer: "open",
      group: "open",
      split: "open",
    },
    paying: { resume_service: "open", close: "closed" },
    closed: { reopen: "open" },
  };
  return transitions[state][type];
}

export function transitionTableOccupancy(
  current: TableOccupancySnapshot,
  command: TableOccupancyCommand,
): TableOccupancySnapshot {
  if (command.occupancyEpoch !== current.occupancyEpoch)
    throw new TableOccupancyTransitionError(
      "OCCUPANCY_EPOCH_MISMATCH",
      "A ocupação informada não é mais a ocupação atual da mesa.",
    );
  if (command.expectedVersion !== current.resourceVersion)
    throw new TableOccupancyTransitionError(
      "OCCUPANCY_VERSION_CONFLICT",
      "A ocupação mudou em outro terminal.",
    );
  const state = targetState(current.state, command.type);
  if (!state)
    throw new TableOccupancyTransitionError(
      "OCCUPANCY_TRANSITION_INVALID",
      `A transição ${command.type} não é válida a partir de ${current.state}.`,
    );
  if (command.type === "reopen" && command.nextEpoch === current.occupancyEpoch)
    throw new TableOccupancyTransitionError(
      "OCCUPANCY_EPOCH_REUSE",
      "Uma reabertura precisa de uma nova época de ocupação.",
    );
  return Object.freeze({
    state,
    occupancyEpoch: command.type === "reopen" ? command.nextEpoch : current.occupancyEpoch,
    resourceVersion: current.resourceVersion + 1,
    tableId:
      command.type === "transfer" || command.type === "split" ? command.tableId : current.tableId,
    groupId:
      command.type === "group" || command.type === "split" ? command.groupId : current.groupId,
  });
}
