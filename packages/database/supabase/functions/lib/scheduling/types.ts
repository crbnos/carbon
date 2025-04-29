import type { Database } from "../types.ts";

export type DeadlineType = Database["public"]["Enums"]["deadlineType"];

export type BaseOperation = {
  id?: string;
  jobId: string;
  deadlineType?: DeadlineType;
  description?: string | null;
  dueDate?: string | null;
  laborTime?: number;
  laborUnit?: Database["public"]["Enums"]["factor"];
  machineTime?: number;
  machineUnit?: Database["public"]["Enums"]["factor"];
  operationOrder?: Database["public"]["Enums"]["methodOperationOrder"];
  operationQuantity?: number | null;
  operationType?: Database["public"]["Enums"]["operationType"];
  priority?: number;
  processId: string | null;
  setupTime?: number;
  setupUnit?: Database["public"]["Enums"]["factor"];
  status?: Database["public"]["Enums"]["jobOperationStatus"];
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
  deadlineType?: Database["public"]["Enums"]["deadlineType"];
  locationId?: string;
};

export enum SchedulingStrategy {
  PriorityLeastTime,
  LeastTime,
  Random,
}
