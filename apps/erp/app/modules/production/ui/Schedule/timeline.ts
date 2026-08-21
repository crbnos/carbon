/**
 * Detail-panel model shared by the schedule / forecast Gantt views. The
 * `TimelineDetail` panel renders one of these for the selected row; the
 * resource (forecast) view produces the `reservation` and `resource` kinds.
 */
export type TimelineNodeDetail = {
  kind:
    | "job"
    | "assembly"
    | "operation"
    | "reservation"
    | "productionEvent"
    | "resource";
  title: string;
  start: string | null; // ISO
  end: string | null; // ISO
  durationMs: number;
  approximate: boolean;
  status?: string | null;
  workCenterName?: string | null;
  assigneeName?: string | null;
  employeeName?: string | null;
  resourceKind?: "WorkCenter" | "OperatorPool" | "Employee";
  conflictReason?: string | null;
  /**
   * A placeholder reservation for an operation the scheduler could NOT place
   * (no qualified operator, no feasible slot, horizon-exhausted). Its window is
   * a "where it would run" marker, not a real booking, and it holds no capacity.
   */
  unschedulable?: boolean;
  /** Why the row starts when it does (queue, predecessor, operator) */
  scheduleNote?: string | null;
  /** Time spent waiting for capacity before the start */
  waitMs?: number;
  /**
   * Actual work content in ms when it differs from durationMs — a gated op's
   * span includes off-shift pauses ("6h of work across 22h").
   */
  workMs?: number;
  /**
   * Owning job for rows in the cross-job resource view, where each
   * reservation belongs to a different job.
   */
  jobId?: string;
  jobReadableId?: string;
};
