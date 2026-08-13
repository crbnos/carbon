import type { Database } from "../types.ts";

/**
 * Job statuses whose reservations hold finite capacity. Mirrors
 * `activeJobStatuses` in packages/database/src/utils.ts (not importable
 * here — Deno can't resolve that module's npm type imports); `satisfies`
 * binds both to the same enum so drift is a compile error. Draft/Planned
 * jobs can carry reservations (method edits trigger a scheduling run) but
 * are invisible on the boards and skipped by replan waves — capacity
 * commitment starts at release.
 */
export const capacityHoldingJobStatuses = [
  "Ready",
  "In Progress",
  "Paused",
] as const satisfies readonly Database["public"]["Enums"]["jobStatus"][];

export type DeadlineType = Database["public"]["Enums"]["deadlineType"];
export type FactorUnit = Database["public"]["Enums"]["factor"];
export type MethodOperationOrder =
  Database["public"]["Enums"]["methodOperationOrder"];
export type OperationType = Database["public"]["Enums"]["operationType"];
export type JobOperationStatus =
  Database["public"]["Enums"]["jobOperationStatus"];

// ============================================================================
// Base Types (existing)
// ============================================================================

export type BaseOperation = {
  id?: string;
  jobId: string;
  jobMakeMethodId?: string | null;
  deadlineType?: DeadlineType;
  description?: string | null;
  dueDate?: string | null;
  manuallyScheduled?: boolean;
  startDate?: string | null;
  laborTime?: number;
  laborUnit?: FactorUnit;
  machineTime?: number;
  machineUnit?: FactorUnit;
  operationOrder?: MethodOperationOrder;
  operationQuantity?: number | null;
  /** Quantity already produced — remaining-work netting scales by what's left. */
  quantityComplete?: number | null;
  operationType?: OperationType;
  operationLeadTime?: number;
  /**
   * Manufacturing lead time (in business days) of the make method's item that
   * this operation belongs to. Applied only at assembly boundaries so a
   * subassembly is scheduled to finish this many days before its parent
   * consumes it. Populated by the engine from itemReplenishment.leadTime.
   */
  assemblyLeadTime?: number;
  priority?: number;
  processId: string | null;
  setupTime?: number;
  setupUnit?: FactorUnit;
  reworkId?: string | null;
  status?: JobOperationStatus;
  order?: number;
  workCenterId?: string | null;
  /** Row creation time — FIFO dispatch key. Present on DB-sourced ops
   * (getOperations selects all columns); absent on synthetic ops. */
  createdAt?: string | Date | null;
};

export type Operation = Omit<
  BaseOperation,
  "setupTime" | "laborTime" | "machineTime"
> & {
  duration: number;
  laborDuration: number;
  laborTime: number;
  machineDuration: number;
  machineTime: number;
  setupDuration: number;
  setupTime: number;
};

export type Job = {
  id?: string;
  dueDate?: string | null;
  deadlineType?: DeadlineType;
  locationId?: string;
  priority?: number;
  /** IANA time zone of the job's location; "UTC" when unset */
  timezone?: string;
};

export enum SchedulingStrategy {
  PriorityLeastTime,
  LeastTime,
  Random,
}

// ============================================================================
// Scheduled Operation (with calculated dates and conflict info)
// ============================================================================

export type ScheduledOperation = Omit<BaseOperation, "priority"> & {
  id: string;
  startDate: string | null;
  dueDate: string | null;
  priority: number | null;
  durationHours: number;
  durationDays: number;
  hasConflict: boolean;
  conflictReason: string | null;
};

// ============================================================================
// Dependency Graph Types
// ============================================================================

export type DependencyNode = {
  operationId: string;
  dependsOn: string[];
  requiredBy: string[];
};

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  getDependencies(operationId: string): string[];
  getDependents(operationId: string): string[];
  addDependency(operationId: string, dependsOnId: string): void;
  topologicalSort(direction: "forward" | "reverse"): string[];
}

export type JobOperationDependency = {
  operationId: string;
  dependsOnId: string;
  jobId: string;
};

// ============================================================================
// Assembly Types
// ============================================================================

export type AssemblyNode = {
  id: string;
  jobMakeMethodId: string;
  parentMaterialId: string | null;
  itemId: string | null;
  operations: BaseOperation[];
  children: AssemblyNode[];
  completionDate?: string | null;
};

// ============================================================================
// Work Center Types
// ============================================================================

export type WorkCenterSelection = {
  workCenterId: string | null;
  priority: number;
  error?: string;
  // Finite placement (present when the selected work center is Finite and a
  // slot was allocated). ISO timestamps.
  placedStart?: string;
  placedEnd?: string;
  conflict?: string | null;
};

export type PlannedReservation = {
  /** "OperatorPool" is legacy — read-tolerated, never written anymore. */
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceId: string; // workCenter.id, ability.id (legacy), or employee id
  operationId: string;
  startAt: Date;
  endAt: Date;
  /**
   * Earliest the operation could have started (dependencies + release date
   * honored); startAt - earliestStartAt is time spent waiting for capacity.
   * Set on WorkCenter reservations from finite placement.
   */
  earliestStartAt?: Date;
  /**
   * Why the operation starts when it does, in plain words (e.g. queued behind
   * another job, waiting on a predecessor). Null when it started as early as
   * it could — no explanation needed.
   */
  scheduleNote?: string | null;
  /**
   * Actual work content (hours) inside the interval — endAt - startAt minus
   * off-shift pauses. A 6h gated op can span 22h of wall clock.
   */
  workHours?: number | null;
};

// ============================================================================
// Scheduling Engine Options and Results
// ============================================================================

export type SchedulingOptions = {
  jobId: string;
  companyId: string;
  userId: string;
};

export type SchedulingResult = {
  success: boolean;
  operationsScheduled: number;
  conflictsDetected: number;
  workCentersAffected: string[];
  assemblyDepth: number;
  reservationsWritten?: number;
};

// ============================================================================
// Operation with Job Info (for priority calculation)
// ============================================================================

export type OperationWithJobInfo = {
  id: string;
  dueDate: string | null;
  startDate: string | null;
  priority: number | null;
  deadlineType: DeadlineType | null;
  jobPriority: number | null;
  workCenterId: string | null;
  durationHours?: number | null;
  createdAt?: string | null;
};
