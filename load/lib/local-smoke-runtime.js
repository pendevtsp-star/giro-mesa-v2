const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM"];

export function assertOperationalEffects(rows, tenants) {
  if (!Array.isArray(rows)) throw new Error("Operational evidence must be an array");
  if (!Array.isArray(tenants) || tenants.length < 2) {
    throw new Error("Operational evidence requires at least two tenants");
  }

  const expected = new Map(
    tenants.map((tenant) => [
      `${tenant.organizationId}:${tenant.unitId}`,
      { label: tenant.label, tableId: tenant.tableId },
    ]),
  );
  const seen = new Set();

  for (const row of rows) {
    const scope = `${row.organizationId}:${row.unitId}`;
    const tenant = expected.get(scope);
    if (!tenant) throw new Error("Operational evidence contains an unexpected tenant scope");
    if (seen.has(scope)) throw new Error(`Operational evidence duplicated ${tenant.label}`);
    if (row.status !== "open" || row.tableId !== tenant.tableId) {
      throw new Error(`${tenant.label} did not open its expected open table`);
    }
    seen.add(scope);
  }

  for (const [scope, tenant] of expected) {
    if (!seen.has(scope)) throw new Error(`${tenant.label} did not open its expected open table`);
  }

  return { tenantsVerified: seen.size, tablesVerified: seen.size };
}

export function createInterruptionController(processEvents = process) {
  const children = new Set();
  const listeners = new Map();
  let interruptedSignal;

  const interrupt = (signal) => {
    interruptedSignal ??= signal;
    for (const child of children) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Cleanup verifies the named containers after the command unwinds.
      }
    }
  };

  for (const signal of INTERRUPT_SIGNALS) {
    const listener = () => interrupt(signal);
    listeners.set(signal, listener);
    processEvents.on(signal, listener);
  }

  return {
    track(child) {
      children.add(child);
      if (interruptedSignal) {
        try {
          child.kill("SIGTERM");
        } catch {
          // The cleanup phase remains authoritative.
        }
      }
      return () => children.delete(child);
    },
    throwIfInterrupted() {
      if (interruptedSignal) {
        throw new Error(`Local load smoke interrupted by ${interruptedSignal}`);
      }
    },
    dispose() {
      for (const [signal, listener] of listeners) processEvents.off(signal, listener);
      listeners.clear();
      children.clear();
    },
  };
}

export async function settleAfterCleanup(runError, cleanupSteps) {
  const errors = runError ? [runError] : [];
  for (const cleanup of cleanupSteps) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Load smoke and cleanup failed");
}
