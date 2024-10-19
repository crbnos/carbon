import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.33.1";
import type { Database } from "../types.ts";
import type { Operation } from "./types.ts";

class ResourceManager {
  private client: SupabaseClient<Database>;
  private companyId: string;
  private activeJobs: string[];
  private jobOperationsByProcess: Map<string | null, Operation[]>;

  constructor(client: SupabaseClient<Database>, companyId: string) {
    this.client = client;
    this.companyId = companyId;
    this.activeJobs = [];
    this.jobOperationsByProcess = new Map<string | null, Operation[]>();
  }

  async setJobOperationsByProcess() {
    const jobs = await this.client
      .from("job")
      .select("id, dueDate, deadlineType, locationId")
      .eq("companyId", this.companyId)
      .in("status", ["Ready", "In Progress", "Paused"]);
    if (jobs.error) {
      console.error(jobs.error);
    }

    this.activeJobs = jobs.data?.map((j) => j.id) ?? [];

    const operations = await this.client
      .from("jobOperation")
      .select(
        "id, jobId, processId, workCenterId, status, laborTime, laborUnit, machineTime, machineUnit, setupTime, setupUnit, operationQuantity"
      )
      .in("jobId", this.activeJobs);
    if (operations.error) {
      console.error(operations.error);
    }

    this.jobOperationsByProcess = new Map<string, Operation[]>();

    operations?.data
      ?.map((op) => getDurations(op))
      ?.forEach((operation) => {
        if (!this.jobOperationsByProcess.has(operation.processId)) {
          this.jobOperationsByProcess.set(operation.processId, []);
        }
        this.jobOperationsByProcess.get(operation.processId)?.push(operation);
      });
  }
}

export { ResourceManager };

function getDurations(operation: BaseOperation): Operation {
  let setupDuration = 0;
  let laborDuration = 0;
  let machineDuration = 0;

  if (!operation.operationQuantity) {
    return {
      ...operation,
      operationQuantity: 0,
      duration: 0,
      setupDuration: 0,
      laborDuration: 0,
      machineDuration: 0,
    };
  }

  // Calculate setup duration
  switch (operation.setupUnit) {
    case "Total Hours":
      setupDuration = operation.setupTime * 3600000; // Convert hours to milliseconds
      break;
    case "Total Minutes":
      setupDuration = operation.setupTime * 60000; // Convert minutes to milliseconds
      break;
    case "Hours/Piece":
      setupDuration =
        operation.setupTime * operation.operationQuantity * 3600000;
      break;
    case "Hours/100 Pieces":
      setupDuration =
        (operation.setupTime / 100) * operation.operationQuantity * 3600000;
      break;
    case "Hours/1000 Pieces":
      setupDuration =
        (operation.setupTime / 1000) * operation.operationQuantity * 3600000;
      break;
    case "Minutes/Piece":
      setupDuration = operation.setupTime * operation.operationQuantity * 60000;
      break;
    case "Minutes/100 Pieces":
      setupDuration =
        (operation.setupTime / 100) * operation.operationQuantity * 60000;
      break;
    case "Minutes/1000 Pieces":
      setupDuration =
        (operation.setupTime / 1000) * operation.operationQuantity * 60000;
      break;
    case "Pieces/Hour":
      setupDuration =
        (operation.operationQuantity / operation.setupTime) * 3600000;
      break;
    case "Pieces/Minute":
      setupDuration =
        (operation.operationQuantity / operation.setupTime) * 60000;
      break;
    case "Seconds/Piece":
      setupDuration = operation.setupTime * operation.operationQuantity * 1000;
      break;
  }

  // Calculate labor duration
  switch (operation.laborUnit) {
    case "Hours/Piece":
      laborDuration =
        operation.laborTime * operation.operationQuantity * 3600000;
      break;
    case "Hours/100 Pieces":
      laborDuration =
        (operation.laborTime / 100) * operation.operationQuantity * 3600000;
      break;
    case "Hours/1000 Pieces":
      laborDuration =
        (operation.laborTime / 1000) * operation.operationQuantity * 3600000;
      break;
    case "Minutes/Piece":
      laborDuration = operation.laborTime * operation.operationQuantity * 60000;
      break;
    case "Minutes/100 Pieces":
      laborDuration =
        (operation.laborTime / 100) * operation.operationQuantity * 60000;
      break;
    case "Minutes/1000 Pieces":
      laborDuration =
        (operation.laborTime / 1000) * operation.operationQuantity * 60000;
      break;
    case "Pieces/Hour":
      laborDuration =
        (operation.operationQuantity / operation.laborTime) * 3600000;
      break;
    case "Pieces/Minute":
      laborDuration =
        (operation.operationQuantity / operation.laborTime) * 60000;
      break;
    case "Seconds/Piece":
      laborDuration = operation.laborTime * operation.operationQuantity * 1000;
      break;
  }

  // Calculate machine duration
  switch (operation.machineUnit) {
    case "Hours/Piece":
      machineDuration =
        operation.machineTime * operation.operationQuantity * 3600000;
      break;
    case "Hours/100 Pieces":
      machineDuration =
        (operation.machineTime / 100) * operation.operationQuantity * 3600000;
      break;
    case "Hours/1000 Pieces":
      machineDuration =
        (operation.machineTime / 1000) * operation.operationQuantity * 3600000;
      break;
    case "Minutes/Piece":
      machineDuration =
        operation.machineTime * operation.operationQuantity * 60000;
      break;
    case "Minutes/100 Pieces":
      machineDuration =
        (operation.machineTime / 100) * operation.operationQuantity * 60000;
      break;
    case "Minutes/1000 Pieces":
      machineDuration =
        (operation.machineTime / 1000) * operation.operationQuantity * 60000;
      break;
    case "Pieces/Hour":
      machineDuration =
        (operation.operationQuantity / operation.machineTime) * 3600000;
      break;
    case "Pieces/Minute":
      machineDuration =
        (operation.operationQuantity / operation.machineTime) * 60000;
      break;
    case "Seconds/Piece":
      machineDuration =
        operation.machineTime * operation.operationQuantity * 1000;
      break;
  }

  const totalDuration = setupDuration + laborDuration + machineDuration;

  return {
    ...operation,
    duration: totalDuration,
    setupDuration,
    laborDuration,
    machineDuration,
  };
}
