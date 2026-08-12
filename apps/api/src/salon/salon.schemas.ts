import { z } from "zod";

export const layoutNodesSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  nodes: z
    .array(
      z.object({
        tableId: z.uuid(),
        areaId: z.uuid().nullable(),
        x: z.number().int().min(0).max(9_999),
        y: z.number().int().min(0).max(9_999),
        width: z.number().int().min(1).max(10_000),
        height: z.number().int().min(1).max(10_000),
        rotation: z.number().int().min(-180).max(180),
        zIndex: z.number().int().min(0).max(10_000),
      }),
    )
    .max(500),
});
export const expectedVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() });
export const areaAssignmentSchema = z.object({
  primaryIdentityId: z.uuid(),
  supportIdentityId: z.uuid().nullable(),
  fallbackRole: z.enum(["manager", "cashier"]),
});
export const presenceRenewSchema = z.object({
  current: z
    .object({ leaseEpoch: z.uuid(), resourceVersion: z.number().int().nonnegative() })
    .nullable(),
});
export const presenceAckSchema = z.object({
  leaseEpoch: z.uuid(),
  resourceVersion: z.number().int().nonnegative(),
});

export type LayoutNodesInput = z.infer<typeof layoutNodesSchema>;
export type AreaAssignmentInput = z.infer<typeof areaAssignmentSchema>;
export type PresenceLeaseInput = z.infer<typeof presenceRenewSchema>["current"];
