// The shape every dataset's starter workflows are written in. Split out from the tier that
// writes them so `@carbon/workflows` can import it and assert every definition still passes
// `validateDefinition` — the cycle blocks that check from running on this side.

import { buildMotorWorkflows } from "../data/motor/workflows.ts";
import { buildPrecisionWorkflows } from "../data/precision/workflows.ts";
import { buildRoboticsWorkflows } from "../data/robotics/workflows.ts";
import { buildSeedWorkflows } from "../data/satellite/workflows.ts";

// Re-exported here so `@carbon/database/seed-workflows` stays the one import for that check.
export { buildSeedWorkflows };

/** Every dataset's builder, so the validation test covers all four and not just satellite. */
export const SEED_WORKFLOW_BUILDERS = {
  satellite: buildSeedWorkflows,
  robotics: buildRoboticsWorkflows,
  precision: buildPrecisionWorkflows,
  motor: buildMotorWorkflows
};

export const FORMAT_VERSION = 4;

/** Mirrors each event's `match` block in the workflow catalog, spelled out here for the
 * same package-cycle reason. `null` is a business moment: it has no table to subscribe to. */
export const EVENT_SOURCES: Record<
  string,
  { table: string; operation: string } | null
> = {
  "salesOrder.created": { table: "salesOrder", operation: "INSERT" },
  "nonConformance.priority.changed": {
    table: "nonConformance",
    operation: "UPDATE"
  },
  "purchaseOrder.status.changed": {
    table: "purchaseOrder",
    operation: "UPDATE"
  },
  "shipment.status.changed": { table: "shipment", operation: "UPDATE" },
  "supplier.supplierStatus.changed": {
    table: "supplier",
    operation: "UPDATE"
  },
  "production.jobReleased": null
};

export type Node = {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  expanded?: boolean;
  data: Record<string, unknown>;
};

export type Edge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

export type SeedWorkflow = {
  name: string;
  description: string;
  /** Only the simplest one ships on; the rest are there to read and switch on deliberately. */
  active: boolean;
  nodes: Node[];
  edges: Edge[];
};
