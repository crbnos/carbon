import type { Operator } from "@carbon/utils";
import type {
  RequiredPermission,
  WorkflowCatalog
} from "../definition/catalog";
import type { WorkflowNode } from "../definition/schema";
import type {
  Combinator,
  PrimitiveKind,
  ScalarType
} from "../definition/types";

/** A value as it exists during a run, rather than the type it was declared as. */
export type RuntimeValue =
  | {
      kind: "primitive";
      of: PrimitiveKind;
      value: string | number | boolean | null;
    }
  // `row` holds a snapshot the loader cannot produce: "before" shares its id with "after".
  | { kind: "entity"; of: string; id: string; row?: Record<string, unknown> }
  | { kind: "list"; of: ScalarType; items: RuntimeValue[] }
  /** Named rows, resolved. Runtime only — nothing declares it as a `ValueType`, so it is
   * never compared, looped over, or produced as a step output. It exists so a resolved
   * header set stays recognisable to the log redactor. */
  | { kind: "pairs"; entries: { name: string; value: RuntimeValue }[] };

/** `reason` is customer-facing text. */
export type Resolution =
  | { ok: true; value: RuntimeValue }
  | { ok: false; reason: string };

/** Implemented job-side; this package stays free of I/O. */
export interface EntityLoader {
  load(entity: string, id: string): Promise<Record<string, unknown> | null>;
}

export type ActionOutcome =
  | { ok: true; outputs: Record<string, RuntimeValue>; summary?: string }
  | { ok: false; error: string };

export type OperationOutcome =
  | { ok: true; value: RuntimeValue }
  | { ok: false; error: string };

export type SearchOutcome =
  | { ok: true; value: RuntimeValue; matched: number; dropped: number }
  | { ok: false; error: string };

/** One resolved match rule, ready for the query builder. */
export interface SearchCriterion {
  field: string;
  operator: Operator;
  value: RuntimeValue;
}

/** Everything that touches the world. Implemented job-side; this package stays pure. */
export interface WorkflowServices {
  runAction(
    actionId: string,
    inputs: Record<string, RuntimeValue>
  ): Promise<ActionOutcome>;
  runOperation(
    operationId: string,
    inputs: Record<string, RuntimeValue>
  ): Promise<OperationOutcome>;
  search(params: {
    entity: string;
    returns: "one" | "list";
    criteria: SearchCriterion[];
  }): Promise<SearchOutcome>;
}

export interface RuntimeContext {
  catalog: WorkflowCatalog;
  loader: EntityLoader;
  /** Required, so a missing implementation is a compile error, not a run-time surprise. */
  services: WorkflowServices;
  /** nodeId → that node's outputs, filled in as the walk proceeds. */
  outputs: Record<string, Record<string, RuntimeValue>>;
  /** The item a looping node is on; absent outside a loop. */
  item?: RuntimeValue;
  /** Called as each input resolves, so a step can report the values it used even
   * when the work it hands them to throws. The engine supplies it; tests may omit it. */
  record?: (key: string, value: RuntimeValue) => void;
  /** Turns a record into an absolute URL, for the inputs the catalog marks `linkify`.
   * Supplied by the engine, which may read ERP_URL — this package never builds a URL,
   * because it is bundled for the browser and has four runtime dependencies. */
  linkFor?: (of: string, id: string) => string | null;
}

/** What a single clause resolved to. `null` values mean it could not be read. */
export type ClauseEvaluation = {
  left: RuntimeValue | null;
  operator: Operator;
  right: RuntimeValue | null;
  passed: boolean | null;
  reason?: string;
};

/** Why a node did what it did. Diagnostics, never node data. */
export type NodeDetail = {
  kind: "condition";
  paths: Array<{
    pathId: string;
    combinator: Combinator;
    evaluations: ClauseEvaluation[];
    taken: boolean;
  }>;
};

export type NodeResult =
  | {
      status: "Succeeded";
      outputs: Record<string, RuntimeValue>;
      /** The handle to follow, or null to stop this path cleanly. */
      handle: string | null;
      branchTaken?: string;
      /** A one-line note for the step row's statusReason. */
      summary?: string;
      detail?: NodeDetail;
    }
  | { status: "Skipped"; reason: string; detail?: NodeDetail }
  | { status: "Failed"; error: string; handle?: string | null };

export interface NodeExecutor<N extends WorkflowNode> {
  /** What the owner must hold; undefined when the node touches nothing. */
  permission(node: N, catalog: WorkflowCatalog): RequiredPermission | undefined;
  execute(node: N, ctx: RuntimeContext): Promise<NodeResult>;
}
