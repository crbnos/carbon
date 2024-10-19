import { Kysely } from "https://esm.sh/kysely@0.26.3";

import { DB } from "../database.ts";
import { ResourceManager } from "./resource-manager.ts";
import { Operation, SchedulingStrategy } from "./types.ts";

class SchedulingEngine {
  private companyId: string;
  private db: Kysely<DB>;
  private jobId: string;
  private operationsToSchedule: Operation[];
  private resourceManager: ResourceManager;

  constructor(db: Kysely<DB>, jobId: string, companyId: string) {
    this.companyId = companyId;
    this.db = db;
    this.jobId = jobId;
    this.operationsToSchedule = [];
    this.resourceManager = new ResourceManager(db, companyId);
  }

  async initialize(): Promise<void> {
    await this.resourceManager.initialize(this.jobId);
  }

  async schedule(
    strategy: SchedulingStrategy = SchedulingStrategy.LeastTime
  ): Promise<void> {
    console.log("Scheduling operations");
    // await this.db.transaction().execute(async (trx) => {
    const operations = await this.db
      .selectFrom("jobOperation")
      .selectAll()
      .where("jobId", "=", this.jobId)
      .execute();

    switch (strategy) {
      case SchedulingStrategy.LeastTime: {
        for await (const operation of operations) {
          const workCenter =
            this.resourceManager.getWorkCenterByProcessWithLeastTime(
              operation.processId
            );

          console.log(`${operation.description} -> ${workCenter}`);

          if (workCenter) {
            this.resourceManager.addOperationToWorkCenter(
              workCenter,
              operation
            );
          }
        }
        break;
      }
      default: {
        throw new Error(`Unsupported scheduling strategy: ${strategy}`);
      }
    }
    // });
  }
}

export { SchedulingEngine };

function sortOperations(operations: Operation[]) {
  return operations.sort((a, b) => {
    // First should come anything that's in progress
    if (a.status === "In Progress" && b.status !== "In Progress") {
      return -1;
    } else if (a.status !== "In Progress" && b.status === "In Progress") {
      return 1;
    }
    // Then anything that's paused
    else if (a.status === "Paused" && b.status !== "Paused") {
      return -1;
    } else if (a.status !== "Paused" && b.status === "Paused") {
      return 1;
    }
    // Then anything that's ASAP
    else if (a.deadlineType === "ASAP" && b.deadlineType !== "ASAP") {
      return -1;
    } else if (a.deadlineType !== "ASAP" && b.deadlineType === "ASAP") {
      return 1;
    }
    // Then we sort deadlines
    else if (
      a.deadlineType === "Hard Deadline" ||
      a.deadlineType === "Soft Deadline"
    ) {
      if (
        b.deadlineType === "Hard Deadline" ||
        b.deadlineType === "Soft Deadline"
      ) {
        return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
      } else {
        return -1;
      }
    }
    // Finally we add anything that has no deadline
    else if (
      a.deadlineType === "No Deadline" &&
      b.deadlineType !== "No Deadline"
    ) {
      return 1;
    } else if (
      a.deadlineType === "No Deadline" &&
      b.deadlineType === "No Deadline"
    ) {
      return a.dueDate?.localeCompare(b.dueDate ?? "") ?? 0;
    } else {
      return 0;
    }
  });
}
