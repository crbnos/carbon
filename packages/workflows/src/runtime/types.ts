import type { WorkflowCatalog } from "../definition/catalog";
import type { WorkflowNode } from "../definition/schema";
import type { PrimitiveKind, ScalarType } from "../definition/types";

/** A value as it exists during a run, rather than the type it was declared as. */
export type RuntimeValue =
  | {
      kind: "primitive";
      of: PrimitiveKind;
      value: string | number | boolean | null;
    }
  // `row` holds a snapshot the loader cannot produce: "before" shares its id with "after".
  | { kind: "entity"; of: string; id: string; row?: Record<string, unknown> }
  | { kind: "list"; of: ScalarType; items: RuntimeValue[] };

/** `reason` is customer-facing text. */
export type Resolution =
  | { ok: true; value: RuntimeValue }
  | { ok: false; reason: string };

/** Implemented job-side; this package stays free of I/O. */
export interface EntityLoader {
  load(entity: string, id: string): Promise<Record<string, unknown> | null>;
}

export interface RuntimeContext {
  catalog: WorkflowCatalog;
  loader: EntityLoader;
  /** nodeId → that node's outputs, filled in as the walk proceeds. */
  outputs: Record<string, Record<string, RuntimeValue>>;
  /** The item a looping node is on; absent outside a loop. */
  item?: RuntimeValue;
}

export type NodeResult =
  | {
      status: "Succeeded";
      outputs: Record<string, RuntimeValue>;
      /** The handle to follow, or null to stop this path cleanly. */
      handle: string | null;
      branchTaken?: string;
      /** A one-line note for the step row's statusReason. */
      summary?: string;
    }
  | { status: "Skipped"; reason: string }
  | { status: "Failed"; error: string; handle?: string | null };

export interface NodeExecutor<N extends WorkflowNode> {
  /** The permission module the owner must hold; undefined when the node reads nothing. */
  permission(node: N, catalog: WorkflowCatalog): string | undefined;
  execute(node: N, ctx: RuntimeContext): Promise<NodeResult>;
}
