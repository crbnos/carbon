import type { Database } from "../types.ts";

export type BaseOperation = {
  id: string;
  jobId: string;
  processId: string | null;
  workCenterId: string | null;
  status: Database["public"]["Enums"]["jobOperationStatus"];
  laborTime: number;
  laborUnit: Database["public"]["Enums"]["factor"];
  machineTime: number;
  machineUnit: Database["public"]["Enums"]["factor"];
  setupTime: number;
  setupUnit: Database["public"]["Enums"]["factor"];
  operationQuantity: number | null;
};

export type Operation = BaseOperation & {
  duration: number;
  setupDuration: number;
  laborDuration: number;
  machineDuration: number;
};
