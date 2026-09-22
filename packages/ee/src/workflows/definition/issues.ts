/** Everything that stops a workflow being activated. Every issue is fatal; there is no severity. */
export type WorkflowIssueCode =
  | "MALFORMED_DEFINITION"
  | "NO_TRIGGER"
  | "EMPTY_TRIGGER"
  | "CONFLICTING_TRIGGER"
  | "MULTIPLE_TRIGGER_EVENTS"
  | "DUPLICATE_TRIGGER_EVENT"
  | "INVALID_SCHEDULE"
  | "DUPLICATE_NODE_NAME"
  | "DANGLING_EDGE"
  | "UNKNOWN_HANDLE"
  | "CYCLE"
  | "MISSING_INPUT"
  | "UNKNOWN_INPUT"
  | "TYPE_MISMATCH"
  | "LIST_INTO_SINGLE"
  | "UNKNOWN_VARIABLE"
  | "REF_NOT_UPSTREAM"
  | "ITEM_OUTSIDE_LOOP"
  | "UNKNOWN_EVENT"
  | "UNKNOWN_ACTION"
  | "UNKNOWN_OPERATION"
  | "UNKNOWN_ENTITY"
  | "INCOMPLETE_CONFIG";

/**
 * What `referenceIssues` can produce. The builder recomputes these as the user edits,
 * so it drops the copy a publish attempt left behind rather than showing both.
 */
export const REFERENCE_ISSUE_CODES: readonly WorkflowIssueCode[] = [
  "UNKNOWN_VARIABLE",
  "REF_NOT_UPSTREAM",
  "ITEM_OUTSIDE_LOOP"
];

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** Customer-facing. */
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}
