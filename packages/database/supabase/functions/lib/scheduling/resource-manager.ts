import { Kysely } from "https://esm.sh/kysely@0.26.3";

import { DB } from "../database.ts";
import type { BaseOperation, Job, Operation } from "./types.ts";

class ResourceManager {
  private db: Kysely<DB>;
  private companyId: string;
  private job: Job | null;
  private activeJobs: string[];
  private operationsByWorkCenter: Map<string | null, Operation[]>;
  private workCentersByProcess: Map<string, string[]>;
  private durationsByWorkCenter: Map<string | null, number>;
  constructor(db: Kysely<DB>, companyId: string) {
    this.db = db;
    this.companyId = companyId;
    this.job = null;
    this.activeJobs = [];
    this.operationsByWorkCenter = new Map<string | null, Operation[]>();
    this.workCentersByProcess = new Map<string, string[]>();
    this.durationsByWorkCenter = new Map<string | null, number>();
  }

  async initialize(jobId: string) {
    if (!this.db) {
      throw new Error("Database connection is not initialized");
    }

    const [job, jobs] = await Promise.all([
      this.db
        .selectFrom("job")
        .select(["id", "dueDate", "deadlineType", "locationId"])
        .where("id", "=", jobId)
        .executeTakeFirst(),
      this.db
        .selectFrom("job")
        .select(["id", "dueDate", "deadlineType", "locationId"])
        .where("companyId", "=", this.companyId)
        .where("status", "in", ["Ready", "In Progress", "Paused"])
        .where("id", "!=", jobId)
        .execute(),
    ]);

    if (job) {
      this.job = job;
    }

    // ignore jobs that aren't at the same location
    this.activeJobs = jobs?.reduce<string[]>((acc, j) => {
      if (j.id && j.locationId === this.job?.locationId) {
        acc.push(j.id);
      }
      return acc;
    }, []);

    const [processes, workCenters] = await Promise.all([
      this.db
        .selectFrom("processes")
        .select(["id", "workCenters"])
        .where("companyId", "=", this.companyId)
        .execute(),
      this.db
        .selectFrom("workCenter")
        .select(["id", "locationId"])
        .where("locationId", "=", this.job?.locationId)
        .where("companyId", "=", this.companyId)
        .where("active", "=", true)
        .execute(),
    ]);

    let operations: BaseOperation[] = [];
    if (this.activeJobs.length > 0) {
      operations = await this.db
        .selectFrom("jobOperation")
        .innerJoin("job", "jobOperation.jobId", "job.id")
        .select([
          "jobOperation.id",
          "jobOperation.jobId",
          "jobOperation.processId",
          "jobOperation.workCenterId",
          "jobOperation.status",
          "jobOperation.laborTime",
          "jobOperation.laborUnit",
          "jobOperation.machineTime",
          "jobOperation.machineUnit",
          "jobOperation.setupTime",
          "jobOperation.setupUnit",
          "jobOperation.operationQuantity",
          "jobOperation.priority",
          "job.dueDate",
          "job.deadlineType",
        ])
        .where("jobOperation.jobId", "in", this.activeJobs)
        .where("job.companyId", "=", this.companyId)
        .execute();
    }

    this.operationsByWorkCenter = new Map<string, Operation[]>();

    operations
      ?.map((op) => getDurations(op))
      ?.forEach((operation) => {
        if (!this.operationsByWorkCenter.has(operation.workCenterId ?? null)) {
          this.operationsByWorkCenter.set(operation.workCenterId ?? null, []);
        }
        this.operationsByWorkCenter
          .get(operation.workCenterId ?? null)
          ?.push(operation);
      });

    // Sort each array in operationsByWorkCenter by priority
    this.operationsByWorkCenter.forEach((operations, workCenterId) => {
      this.operationsByWorkCenter.set(
        workCenterId,
        operations.sort(
          (a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0)
        )
      );
    });

    // Initialize workCentersByProcess map
    this.workCentersByProcess = new Map<string, string[]>();

    // Populate workCentersByProcess map
    processes?.forEach((process) => {
      if (process.workCenters) {
        // only consider work centers at this location
        const workCenterIds = process.workCenters
          .map((wc) => wc.id)
          .filter((wc) => workCenters?.some((w) => w.id === wc));
        this.workCentersByProcess.set(process.id!, workCenterIds);
      }
    });
  }

  getJob(): Job | null {
    return this.job;
  }

  getPriorityByWorkCenterId(workCenterId: string): {
    workCenter: string;
    priority: number;
  } {
    const deadlineType = this.job?.deadlineType ?? "No Deadline";
    const dueDate = this.job?.dueDate ?? "";

    const operations = this.operationsByWorkCenter.get(workCenterId) || [];

    let priorityBefore = 0;
    let priorityAfter: number | undefined;

    if (operations.length === 0) {
      // If there are no operations, set priorityBefore to 0 and priorityAfter to undefined
      return { workCenter: workCenterId, priority: 1 };
    }

    // Iterate backwards over the operations until we find the first operation that matches the deadline type
    for (let i = operations.length - 1; i >= 0; i--) {
      const currentOp = operations[i];

      if (deadlineType === "ASAP") {
        if (currentOp.deadlineType === "ASAP") {
          priorityBefore = Number(currentOp.priority ?? 0);
          priorityAfter = Number(
            operations[i + 1]?.priority ?? priorityBefore + 1
          );

          return {
            workCenter: workCenterId,
            priority: Number(priorityBefore + priorityAfter) / 2,
          };
        }
      } else if (deadlineType === "Hard Deadline") {
        if (
          currentOp.deadlineType === "ASAP" ||
          (currentOp.deadlineType === "Hard Deadline" &&
            currentOp.dueDate &&
            currentOp.dueDate <= dueDate) ||
          (currentOp.deadlineType === "Soft Deadline" &&
            currentOp.dueDate &&
            currentOp.dueDate < dueDate)
        ) {
          priorityBefore = Number(currentOp.priority ?? 0);
          priorityAfter = Number(
            operations[i + 1]?.priority ?? priorityBefore + 1
          );

          return {
            workCenter: workCenterId,
            priority: Number(priorityBefore + priorityAfter) / 2,
          };
        }
      } else if (deadlineType === "Soft Deadline") {
        if (
          currentOp.deadlineType === "ASAP" ||
          (currentOp.deadlineType === "Hard Deadline" &&
            currentOp.dueDate &&
            currentOp.dueDate <= dueDate) ||
          (currentOp.deadlineType === "Soft Deadline" &&
            currentOp.dueDate &&
            currentOp.dueDate <= dueDate)
        ) {
          priorityBefore = Number(currentOp.priority ?? 0);
          priorityAfter = Number(
            operations[i + 1]?.priority ?? priorityBefore + 1
          );

          return {
            workCenter: workCenterId,
            priority: Number(priorityBefore + priorityAfter) / 2,
          };
        }
      } else if (deadlineType === "No Deadline") {
        return {
          workCenter: workCenterId,
          priority:
            Number(operations[operations.length - 1]?.priority ?? 0) + 1,
        };
      }
    }

    if (
      priorityBefore === 0 &&
      priorityAfter === undefined &&
      deadlineType !== "ASAP"
    ) {
      console.error("No priority found for work center", workCenterId);
      return {
        workCenter: workCenterId,
        priority: Number(operations[operations.length - 1]?.priority ?? 0) + 1,
      };
    }

    return {
      workCenter: workCenterId,
      priority: 0,
    };
  }

  getDurationByWorkCenterIdAndPriority(
    workCenterId: string,
    priority: number
  ): number {
    const operations = this.operationsByWorkCenter.get(workCenterId) || [];
    let duration = 0;

    operations.forEach((operation) => {
      if (operation.priority && operation.priority < priority) {
        duration += operation.duration;
      } else {
        return duration;
      }
    });

    return duration;
  }

  getWorkCenterAndPriorityByProcessId(processId: string): {
    workCenter: string | null;
    priority: number;
  } {
    const workCenters = this.workCentersByProcess.get(processId) ?? [];
    if (workCenters.length === 0) {
      console.error("No work centers found for process", processId);
      return {
        workCenter: null,
        priority: 0,
      };
    }

    let selectedWorkCenter: string | null = null;
    let lowestDuration = Infinity;
    let selectedPriority = 0;

    // Find work center with lowest total duration including current durations
    for (const workCenter of workCenters) {
      const { priority } = this.getPriorityByWorkCenterId(workCenter);
      const currentDuration = this.durationsByWorkCenter.get(workCenter) ?? 0;
      const queuedDuration = this.getDurationByWorkCenterIdAndPriority(
        workCenter,
        priority
      );
      const totalDuration = currentDuration + queuedDuration;

      if (totalDuration < lowestDuration) {
        lowestDuration = totalDuration;
        selectedWorkCenter = workCenter;
        selectedPriority = priority;
      }
    }

    if (!selectedWorkCenter) {
      console.error("No work center selected after evaluation");
      return {
        workCenter: null,
        priority: 0,
      };
    }

    return {
      workCenter: selectedWorkCenter,
      priority: selectedPriority,
    };
  }

  hasWorkCenter(workCenterId: string): boolean {
    return this.operationsByWorkCenter.has(workCenterId);
  }

  addOperationToWorkCenter(workCenterId: string, operation: BaseOperation) {
    if (!this.operationsByWorkCenter.has(workCenterId)) {
      this.operationsByWorkCenter.set(workCenterId, []);
    }

    const operationWithDurations = getDurations({
      ...operation,
      deadlineType: this.job?.deadlineType ?? "No Deadline",
      dueDate: this.job?.dueDate ?? "",
    });

    const operations = this.operationsByWorkCenter.get(workCenterId);
    if (operations) {
      operations.push(operationWithDurations);
      operations.sort(
        (a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0)
      );
      this.operationsByWorkCenter.set(workCenterId, operations);
    }

    // Update the duration for the work center
    const currentDuration = this.durationsByWorkCenter.get(workCenterId) ?? 0;
    const newDuration = currentDuration + operationWithDurations.duration;
    this.durationsByWorkCenter.set(workCenterId, newDuration);
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
      setupTime: operation.setupTime ?? 0,
      laborTime: operation.laborTime ?? 0 ?? 0,
      machineTime: operation.machineTime ?? 0,
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
      setupDuration = (operation.setupTime ?? 0) * 3600000; // Convert hours to milliseconds
      break;
    case "Total Minutes":
      setupDuration = (operation.setupTime ?? 0) * 60000; // Convert minutes to milliseconds
      break;
    case "Hours/Piece":
      setupDuration =
        (operation.setupTime ?? 0) * operation.operationQuantity * 3600000;
      break;
    case "Hours/100 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 100) *
        operation.operationQuantity *
        3600000;
      break;
    case "Hours/1000 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 1000) *
        operation.operationQuantity *
        3600000;
      break;
    case "Minutes/Piece":
      setupDuration =
        (operation.setupTime ?? 0) * operation.operationQuantity * 60000;
      break;
    case "Minutes/100 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 100) *
        operation.operationQuantity *
        60000;
      break;
    case "Minutes/1000 Pieces":
      setupDuration =
        ((operation.setupTime ?? 0) / 1000) *
        operation.operationQuantity *
        60000;
      break;
    case "Pieces/Hour":
      setupDuration =
        (operation.operationQuantity / (operation.setupTime ?? 0)) * 3600000;
      break;
    case "Pieces/Minute":
      setupDuration =
        (operation.operationQuantity / (operation.setupTime ?? 0)) * 60000;
      break;
    case "Seconds/Piece":
      setupDuration =
        (operation.setupTime ?? 0) * operation.operationQuantity * 1000;
      break;
  }

  // Calculate labor duration
  switch (operation.laborUnit) {
    case "Hours/Piece":
      laborDuration =
        (operation.laborTime ?? 0) * operation.operationQuantity * 3600000 ?? 0;
      break;
    case "Hours/100 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 100) *
          operation.operationQuantity *
          3600000 ?? 0;
      break;
    case "Hours/1000 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 1000) *
          operation.operationQuantity *
          3600000 ?? 0;
      break;
    case "Minutes/Piece":
      laborDuration =
        (operation.laborTime ?? 0) * operation.operationQuantity * 60000 ?? 0;
      break;
    case "Minutes/100 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 100) *
          operation.operationQuantity *
          60000 ?? 0;
      break;
    case "Minutes/1000 Pieces":
      laborDuration =
        ((operation.laborTime ?? 0) / 1000) *
          operation.operationQuantity *
          60000 ?? 0;
      break;
    case "Pieces/Hour":
      laborDuration =
        (operation.operationQuantity / (operation.laborTime ?? 0)) * 3600000 ??
        0;
      break;
    case "Pieces/Minute":
      laborDuration =
        (operation.operationQuantity / (operation.laborTime ?? 0)) * 60000 ?? 0;
      break;
    case "Seconds/Piece":
      laborDuration =
        (operation.laborTime ?? 0) * operation.operationQuantity * 1000 ?? 0;
      break;
  }

  // Calculate machine duration
  switch (operation.machineUnit) {
    case "Hours/Piece":
      machineDuration =
        (operation.machineTime ?? 0) * operation.operationQuantity * 3600000;
      break;
    case "Hours/100 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 100) *
        operation.operationQuantity *
        3600000;
      break;
    case "Hours/1000 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 1000) *
        operation.operationQuantity *
        3600000;
      break;
    case "Minutes/Piece":
      machineDuration =
        (operation.machineTime ?? 0) * operation.operationQuantity * 60000;
      break;
    case "Minutes/100 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 100) *
        operation.operationQuantity *
        60000;
      break;
    case "Minutes/1000 Pieces":
      machineDuration =
        ((operation.machineTime ?? 0) / 1000) *
        operation.operationQuantity *
        60000;
      break;
    case "Pieces/Hour":
      machineDuration =
        (operation.operationQuantity / (operation.machineTime ?? 0)) * 3600000;
      break;
    case "Pieces/Minute":
      machineDuration =
        (operation.operationQuantity / (operation.machineTime ?? 0)) * 60000;
      break;
    case "Seconds/Piece":
      machineDuration =
        (operation.machineTime ?? 0) * operation.operationQuantity * 1000;
      break;
  }

  const totalDuration = setupDuration + laborDuration + machineDuration;

  return {
    ...operation,
    setupTime: operation.setupTime ?? 0,
    laborTime: operation.laborTime ?? 0,
    machineTime: operation.machineTime ?? 0,
    duration: totalDuration,
    setupDuration,
    laborDuration,
    machineDuration,
  };
}
