import type { Database } from "../types.ts";

export type DeadlineType = Database["public"]["Enums"]["deadlineType"];
export type FactorUnit = Database["public"]["Enums"]["factor"];
export type MethodOperationOrder =
  Database["public"]["Enums"]["methodOperationOrder"];
export type OperationType = Database["public"]["Enums"]["operationType"];
export type JobOperationStatus =
  Database["public"]["Enums"]["jobOperationStatus"];

// ============================================================================
// Scheduling Direction and Mode
// ============================================================================

export type SchedulingDirection = "backward" | "forward";
export type SchedulingMode = "initial" | "reschedule";

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
  operationType?: OperationType;
  operationLeadTime?: number;
  priority?: number;
  processId: string | null;
  setupTime?: number;
  setupUnit?: FactorUnit;
  reworkId?: string | null;
  status?: JobOperationStatus;
  order?: number;
  workCenterId?: string | null;
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

export type WorkCenterLoad = {
  workCenterId: string;
  totalHours: number;
  operationCount: number;
};

export type WorkCenterSelection = {
  workCenterId: string | null;
  priority: number;
  load?: number;
  error?: string;
};

// ============================================================================
// Scheduling Engine Options and Results
// ============================================================================

export type SchedulingOptions = {
  jobId: string;
  companyId: string;
  userId: string;
  direction: SchedulingDirection;
  mode: SchedulingMode;
};

export type SchedulingResult = {
  success: boolean;
  operationsScheduled: number;
  conflictsDetected: number;
  workCentersAffected: string[];
  assemblyDepth: number;
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
};
