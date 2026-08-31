import { z } from "zod";

/**
 * What the data node can do to a value.
 *
 * The single list. The zod enum below derives from it, the node kind reads
 * `resultType` for its outputs and checks, the executor reads `run`, and the
 * builder maps over it for the operation dropdown — so adding an operation is one
 * entry here rather than four edits that can silently disagree.
 *
 * Declared apart from `nodes.ts` because the schema needs the enum and `nodes.ts`
 * imports the schema; putting the list there would be a cycle.
 */
export interface DataOperationSpec {
  /** Shown in the builder's operation picker. */
  label: string;
  /** Whether clause rows apply — only filtering compares each item. */
  usesClauses: boolean;
  /** Whether the operation exposes a loop item. Only `filter` does, which is what
   * keeps `ItemRef` ("the current item") meaning exactly one thing. */
  loops: boolean;
  /** Whether the operation projects a named field off each item. */
  usesField: boolean;
}

export const DATA_OPERATIONS = {
  filter: {
    label: "Keep matching items",
    usesClauses: true,
    loops: true,
    usesField: false
  },
  count: {
    label: "Count items",
    usesClauses: false,
    loops: false,
    usesField: false
  },
  first: {
    label: "Take the first item",
    usesClauses: false,
    loops: false,
    usesField: false
  },
  last: {
    label: "Take the last item",
    usesClauses: false,
    loops: false,
    usesField: false
  },
  pluck: {
    label: "Take one field from every item",
    usesClauses: false,
    loops: false,
    usesField: true
  },
  join: {
    label: "Join into text",
    usesClauses: false,
    loops: false,
    usesField: false
  }
} as const satisfies Record<string, DataOperationSpec>;

export type DataOperation = keyof typeof DATA_OPERATIONS;

export const DATA_OPERATION_NAMES = Object.keys(DATA_OPERATIONS) as [
  DataOperation,
  ...DataOperation[]
];

export const dataOperationSchema = z.enum(DATA_OPERATION_NAMES);

/**
 * The operation a node runs, defaulting the way the schema does.
 *
 * The zod default only applies to a definition that was PARSED. The builder holds
 * raw node objects in memory — a node just dropped on the canvas, or one loaded
 * before this field existed — so the key can genuinely be absent, and reading it
 * unguarded made `DATA_OPERATIONS[undefined]` and produced no outputs at all.
 *
 * A name that is no longer an operation falls back too: a definition saved against
 * an older list must not index the table with a key it no longer holds.
 */
export function operationOf(stored: string | undefined): DataOperation {
  return stored !== undefined && stored in DATA_OPERATIONS
    ? (stored as DataOperation)
    : "filter";
}
