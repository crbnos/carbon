/** Everything that stops a workflow being activated. Every issue is fatal; there is no severity. */
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

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** Customer-facing. */
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}
