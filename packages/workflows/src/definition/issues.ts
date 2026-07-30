/**
 * Everything wrong with a workflow that stops it being activated. Every issue is
 * fatal — there is deliberately no `severity`, because nothing in phase 1
 * produces advice a customer may ignore. Add one when a check genuinely should
 * warn rather than block, not by default.
 */
export type WorkflowIssueCode =
  | "MALFORMED_DEFINITION"
  | "NO_TRIGGER"
  | "MULTIPLE_TRIGGERS"
  | "EMPTY_TRIGGER"
  | "CONFLICTING_TRIGGER"
  | "INVALID_SCHEDULE"
  | "DANGLING_EDGE"
  | "UNKNOWN_HANDLE"
  | "CYCLE"
  | "UNREACHABLE_NODE"
  | "MISSING_INPUT"
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

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** Customer-facing. Phase 8 renders these through the translation macro. */
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}
