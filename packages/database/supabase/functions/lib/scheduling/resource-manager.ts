import { Kysely } from "https://esm.sh/kysely@0.26.3";

import { DB } from "../database.ts";
import type { BaseOperation, Job, Operation } from "./types.ts";

class ResourceManager {
  private db: Kysely<DB>;
  private companyId: string;
  private job: Job | null;
  private activeJobs: string[];
  private operationsByWorkCenter: Map<string | null, Operation[]>;
  private durationsByWorkCenter: Map<string | null, number>;
  private workCentersByProcess: Map<string, string[]>;

  constructor(db: Kysely<DB>, companyId: string) {
    this.db = db;
    this.companyId = companyId;
    this.job = null;
    this.activeJobs = [];
    this.operationsByWorkCenter = new Map<string | null, Operation[]>();
    this.durationsByWorkCenter = new Map<string | null, number>();
    this.workCentersByProcess = new Map<string, string[]>();
  }

  async initialize(jobId: string) {
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
        .execute(),
    ]);

    if (job) {
      this.job = job;
    }

    this.activeJobs =
      jobs?.map((j) => j.id).filter((id) => id !== undefined) ?? [];

    const processes = await this.db
      .selectFrom("processes")
      .select(["id", "workCenters"])
      .where("companyId", "=", this.companyId)
      .execute();

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

    this.durationsByWorkCenter = new Map<string, number>();

    for (const [workCenterId, operations] of this.operationsByWorkCenter) {
      const totalDuration = operations.reduce(
        (sum, operation) => sum + operation.duration,
        0
      );
      this.durationsByWorkCenter.set(workCenterId, totalDuration);
    }

    // Handle operations without a specific work center (null key)
    const unassignedOperations = this.operationsByWorkCenter.get(null) || [];
    if (unassignedOperations.length > 0) {
      const totalUnassignedDuration = unassignedOperations.reduce(
        (sum, operation) => {
          if (
            !job?.dueDate ||
            (operation.dueDate && operation.dueDate < job.dueDate)
          ) {
            return sum + operation.duration;
          }
          return sum;
        },
        0
      );
      this.durationsByWorkCenter.set("unassigned", totalUnassignedDuration);
    }

    // Initialize workCentersByProcess map
    this.workCentersByProcess = new Map<string, string[]>();

    // Populate workCentersByProcess map
    processes?.forEach((process) => {
      if (process.workCenters) {
        const workCenterIds = (process.workCenters as { id: string }[]).map(
          (wc: { id: string }) => wc.id
        );
        this.workCentersByProcess.set(process.id!, workCenterIds);
      }
    });
  }

  getJob(): Job | null {
    return this.job;
  }

  getWorkCenterByProcessWithLeastTime(processId: string): string | null {
    const workCenters = this.workCentersByProcess.get(processId) ?? [];
    let leastTime = Infinity;
    let selectedWorkCenter = null;

    for (const workCenter of workCenters) {
      const duration = this.durationsByWorkCenter.get(workCenter) ?? 0;
      if (duration < leastTime) {
        leastTime = duration;
        selectedWorkCenter = workCenter;
      }
    }

    return selectedWorkCenter;
  }

  addOperationToWorkCenter(workCenterId: string, operation: BaseOperation) {
    if (!this.operationsByWorkCenter.has(workCenterId)) {
      this.operationsByWorkCenter.set(workCenterId, []);
    }

    this.operationsByWorkCenter
      .get(workCenterId)
      ?.push(getDurations(operation));

    const totalDuration = this.operationsByWorkCenter
      .get(workCenterId)
      ?.reduce((sum, operation) => sum + operation.duration, 0);
    this.durationsByWorkCenter.set(workCenterId, totalDuration ?? 0);
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
