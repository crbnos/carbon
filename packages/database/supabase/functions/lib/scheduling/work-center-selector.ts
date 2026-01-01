import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import { calculateDurationHours } from "./duration-calculator.ts";
import type { ScheduledOperation, WorkCenterLoad, WorkCenterSelection } from "./types.ts";

/**
 * Work Center Selector
 * Handles work center selection based on load balancing
 */
export class WorkCenterSelector {
  private db: Kysely<DB>;
  private companyId: string;
  private locationId: string;
  private workCentersByProcess: Map<string, string[]> = new Map();
  private activeWorkCenters: Set<string> = new Set();
  // Track in-memory load from operations assigned in current scheduling run
  private inMemoryLoadByWorkCenter: Map<string, number> = new Map();

  constructor(db: Kysely<DB>, companyId: string, locationId: string) {
    this.db = db;
    this.companyId = companyId;
    this.locationId = locationId;
  }

  /**
   * Add load for an operation assigned in memory (not yet persisted)
   */
  addInMemoryLoad(workCenterId: string, hours: number): void {
    const currentLoad = this.inMemoryLoadByWorkCenter.get(workCenterId) ?? 0;
    this.inMemoryLoadByWorkCenter.set(workCenterId, currentLoad + hours);
  }

  /**
   * Get total in-memory load for a work center
   */
  getInMemoryLoad(workCenterId: string): number {
    return this.inMemoryLoadByWorkCenter.get(workCenterId) ?? 0;
  }

  /**
   * Reset in-memory load tracking (call before a new scheduling run)
   */
  resetInMemoryLoad(): void {
    this.inMemoryLoadByWorkCenter.clear();
  }

  /**
   * Initialize work center data
   */
  async initialize(): Promise<void> {
    // Get processes and their work centers
    const processes = await this.db
      .selectFrom("processes")
      .select(["id", "workCenters"])
      .where("companyId", "=", this.companyId)
      .execute();

    // Get active work centers at this location
    const workCenters = await this.db
      .selectFrom("workCenter")
      .select(["id", "locationId"])
      .where("locationId", "=", this.locationId)
      .where("companyId", "=", this.companyId)
      .where("active", "=", true)
      .execute();

    // Build set of active work center IDs
    for (const wc of workCenters) {
      if (wc.id) {
        this.activeWorkCenters.add(wc.id);
      }
    }

    // Build process to work centers map (only include active work centers at this location)
    for (const process of processes) {
      if (process.workCenters && process.id) {
        const validWorkCenters = process.workCenters.filter((wcId) =>
          this.activeWorkCenters.has(wcId)
        );
        this.workCentersByProcess.set(process.id, validWorkCenters);
      }
    }
  }

  /**
   * Get work centers that support a given process
   */
  getWorkCentersForProcess(processId: string): string[] {
    return this.workCentersByProcess.get(processId) ?? [];
  }

  /**
   * Check if a work center is valid (exists and is active at this location)
   */
  isValidWorkCenter(workCenterId: string): boolean {
    return this.activeWorkCenters.has(workCenterId);
  }

  /**
   * Calculate total load (in hours) on a work center up to a given date
   */
  async calculateLoadBeforeDate(
    workCenterId: string,
    beforeDate: string
  ): Promise<number> {
    const operations = await this.db
      .selectFrom("jobOperation")
      .select([
        "setupTime",
        "setupUnit",
        "laborTime",
        "laborUnit",
        "machineTime",
        "machineUnit",
        "operationQuantity",
      ])
      .where("workCenterId", "=", workCenterId)
      .where("companyId", "=", this.companyId)
      .where("status", "not in", ["Done", "Canceled"])
      .where((eb) =>
        eb.or([
          eb("startDate", "<=", beforeDate),
          eb("startDate", "is", null),
        ])
      )
      .execute();

    let totalHours = 0;
    for (const op of operations) {
      totalHours += calculateDurationHours({
        jobId: "", // Not needed for duration calculation
        processId: null,
        setupTime: op.setupTime ?? undefined,
        setupUnit: op.setupUnit ?? undefined,
        laborTime: op.laborTime ?? undefined,
        laborUnit: op.laborUnit ?? undefined,
        machineTime: op.machineTime ?? undefined,
        machineUnit: op.machineUnit ?? undefined,
        operationQuantity: op.operationQuantity ?? undefined,
      });
    }

    return totalHours;
  }

  /**
   * Get load information for all work centers supporting a process
   */
  async getLoadForProcessWorkCenters(
    processId: string,
    beforeDate: string
  ): Promise<WorkCenterLoad[]> {
    const workCenters = this.getWorkCentersForProcess(processId);
    const loads: WorkCenterLoad[] = [];

    for (const wcId of workCenters) {
      const totalHours = await this.calculateLoadBeforeDate(wcId, beforeDate);
      const count = await this.db
        .selectFrom("jobOperation")
        .select((eb) => eb.fn.count<number>("id").as("count"))
        .where("workCenterId", "=", wcId)
        .where("companyId", "=", this.companyId)
        .where("status", "not in", ["Done", "Canceled"])
        .where((eb) =>
          eb.or([
            eb("startDate", "<=", beforeDate),
            eb("startDate", "is", null),
          ])
        )
        .executeTakeFirst();

      loads.push({
        workCenterId: wcId,
        totalHours,
        operationCount: count?.count ?? 0,
      });
    }

    return loads;
  }

  /**
   * Select the optimal work center for an operation based on load balancing
   * Selects the work center with the least load before the operation's start date
   * Includes both database load and in-memory load from current scheduling run
   */
  async selectWorkCenter(
    processId: string | null,
    scheduledStartDate: string | null
  ): Promise<WorkCenterSelection> {
    if (!processId) {
      return {
        workCenterId: null,
        priority: 0,
        error: "No process ID provided",
      };
    }

    const workCenters = this.getWorkCentersForProcess(processId);

    if (workCenters.length === 0) {
      return {
        workCenterId: null,
        priority: 0,
        error: `No work centers found for process ${processId}`,
      };
    }

    // Use today if no start date
    const beforeDate = scheduledStartDate || new Date().toISOString().split("T")[0];

    let selectedWorkCenter: string | null = null;
    let lowestLoad = Infinity;

    for (const wcId of workCenters) {
      // Get load from database (other jobs)
      const dbLoad = await this.calculateLoadBeforeDate(wcId, beforeDate);
      // Add in-memory load from current scheduling run
      const inMemoryLoad = this.getInMemoryLoad(wcId);
      const totalLoad = dbLoad + inMemoryLoad;

      if (totalLoad < lowestLoad) {
        lowestLoad = totalLoad;
        selectedWorkCenter = wcId;
      }
    }

    if (!selectedWorkCenter) {
      return {
        workCenterId: null,
        priority: 0,
        error: "No work center selected after evaluation",
      };
    }

    return {
      workCenterId: selectedWorkCenter,
      priority: 0, // Priority will be calculated separately
      load: lowestLoad,
    };
  }

  /**
   * Select work centers for multiple operations
   * Re-evaluates all work center assignments based on scheduled dates
   * Tracks in-memory load to ensure proper load balancing within same scheduling run
   */
  async selectWorkCentersForOperations(
    operations: ScheduledOperation[]
  ): Promise<Map<string, WorkCenterSelection>> {
    const selections = new Map<string, WorkCenterSelection>();

    // Reset in-memory load tracking for this scheduling run
    this.resetInMemoryLoad();

    // Sort by start date to process in order
    const sorted = [...operations].sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

    for (const op of sorted) {
      // Skip outside operations (they don't need work center assignment)
      if (op.operationType === "Outside") {
        continue;
      }

      const selection = await this.selectWorkCenter(
        op.processId,
        op.startDate
      );
      selections.set(op.id, selection);

      // Track this operation's load in memory for subsequent selections
      if (selection.workCenterId) {
        const opDuration = op.durationHours ?? calculateDurationHours(op);
        this.addInMemoryLoad(selection.workCenterId, opDuration);
      }
    }

    return selections;
  }
}

/**
 * Apply work center selections to scheduled operations
 */
export function applyWorkCenterSelections(
  operations: Map<string, ScheduledOperation>,
  selections: Map<string, WorkCenterSelection>
): Map<string, ScheduledOperation> {
  const result = new Map<string, ScheduledOperation>();

  for (const [opId, op] of operations) {
    const selection = selections.get(opId);
    if (selection?.workCenterId) {
      result.set(opId, {
        ...op,
        workCenterId: selection.workCenterId,
      });
    } else {
      result.set(opId, op);
    }
  }

  return result;
}
