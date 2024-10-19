import type { Database } from "../types.ts";

export type BaseOperation = {
  id?: string;
  jobId: string;
  processId: string | null;
  workCenterId?: string | null;
  status?: Database["public"]["Enums"]["jobOperationStatus"];
  laborTime?: number;
  laborUnit?: Database["public"]["Enums"]["factor"];
  machineTime?: number;
  machineUnit?: Database["public"]["Enums"]["factor"];
  setupTime?: number;
  setupUnit?: Database["public"]["Enums"]["factor"];
  operationQuantity?: number | null;
  dueDate?: string | null;
  deadlineType?: Database["public"]["Enums"]["deadlineType"];
};

export type Operation = Omit<
  BaseOperation,
  "setupTime" | "laborTime" | "machineTime"
> & {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
  setupTime: number;
  laborTime: number;
  machineTime: number;
};

export type Job = {
  id?: string;
  dueDate?: string | null;
  deadlineType?: Database["public"]["Enums"]["deadlineType"];
  locationId?: string;
};

export enum SchedulingStrategy {
  LeastTime,
}
