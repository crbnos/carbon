import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import { getJobMethodTree, type JobMethodTreeItem } from "../methods.ts";
import type { Database } from "../types.ts";
import { toIsoDate } from "./date-utils.ts";
import {
  capacityHoldingJobStatuses,
  type BaseOperation,
  type Job,
  type JobOperationDependency,
} from "./types.ts";

export type JobMaterialWithMakeMethod = {
  jobMaterialMakeMethodId: string | null;
  jobOperationId: string | null;
};

export type UnassignedMaterial = {
  id: string | null;
  jobMakeMethodId: string | null;
};

export type UnlinkedMaterial = {
  id: string | null;
  jobMakeMethodId: string;
};

export type RootMakeMethod = {
  id: string | null;
  itemId: string | null;
};

export type ProcessWorkCenters = {
  id: string | null;
  workCenters: string[] | null;
};

export type ActiveWorkCenter = {
  id: string | null;
  locationId: string | null;
};

export type CrossJobOperation = {
  id: string | null;
  dueDate: string | null;
  startDate: string | null;
  priority: number | null;
  deadlineType: Database["public"]["Enums"]["deadlineType"] | null;
  jobPriority: number | null;
  workCenterId: string | null;
  // Dispatch-rule inputs: FIFO needs createdAt; SPT/WSPT/CR/MinSlack need
  // the time fields to derive durationHours
  createdAt: Date | string | null;
  setupTime: number | null;
  setupUnit: Database["public"]["Enums"]["factor"] | null;
  laborTime: number | null;
  laborUnit: Database["public"]["Enums"]["factor"] | null;
  machineTime: number | null;
  machineUnit: Database["public"]["Enums"]["factor"] | null;
  operationQuantity: number | null;
};

export type LiveReservation = {
  /** "OperatorPool" is legacy — read-tolerated, never written anymore. */
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceId: string;
  startAt: Date;
  endAt: Date;
  jobId: string;
  /** Human-readable job number (job."jobId", e.g. J000001) for conflict messages */
  readableJobId: string;
};

export type SchedulingPolicyRow = {
  workCenterId: string | null;
  dispatchRule: "FIFO" | "EDD" | "SPT" | "WSPT" | "CR" | "MinSlack";
};

/** A process that requires an ability, with its 1:1 linked ability. */
export type ProcessRequirementRow = {
  processId: string;
  abilityId: string;
  abilityName: string;
};

export type QualifiedEmployeeRow = {
  abilityId: string;
  employeeId: string;
  active: boolean;
  trainingCompleted: boolean | null;
  expiresAt: string | null;
};

/** One weekday window of an employee's assigned shift (employeeShift ⋈ shift). */
export type EmployeeShiftRow = {
  employeeId: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string;
  endTime: string;
  timezone: string;
};

// Row types live in crew-utils.ts (pure module) so the deno tests don't pull
// the DB dependency graph
import type { CrewAbsenceRow, CrewAssignmentRow } from "./crew-utils.ts";
export type { CrewAbsenceRow, CrewAssignmentRow };

/**
 * Master Data Provider
 * The single read seam for the scheduling engine. All master/transactional
 * reads go through this interface so the engine can later be pointed at
 * "live ⊕ scenario overrides" without touching the placement logic.
 * Writes stay on the concrete Kysely client.
 */
export interface MasterDataProvider {
  getJob(jobId: string): Promise<Job | undefined>;
  getOperations(
    jobId: string,
    opts?: { includeDone?: boolean }
  ): Promise<BaseOperation[]>;
  getDependencies(jobId: string): Promise<JobOperationDependency[]>;
  getReworkDependencies(
    jobId: string,
    reworkOpIds: string[]
  ): Promise<JobOperationDependency[]>;
  getMaterialsWithMakeMethod(
    makeMethodIds: string[]
  ): Promise<JobMaterialWithMakeMethod[]>;
  getUnassignedMakeToOrderMaterials(
    makeMethodIds: string[]
  ): Promise<UnassignedMaterial[]>;
  getUnlinkedMaterials(jobId: string): Promise<UnlinkedMaterial[]>;
  getRootMakeMethod(jobId: string): Promise<RootMakeMethod | undefined>;
  getJobMethodTree(
    methodId: string
  ): Promise<{ data: JobMethodTreeItem[] | null; error: unknown }>;
  getProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]>;
  getActiveWorkCenters(locationId: string): Promise<ActiveWorkCenter[]>;
  getCrossJobOperationsAtWorkCenters(
    workCenterIds: string[]
  ): Promise<CrossJobOperation[]>;

  // ---- finite-capacity reads ----
  getLiveReservations(
    fromDate: Date,
    excludeJobId: string
  ): Promise<LiveReservation[]>;
  getSchedulingPolicies(): Promise<SchedulingPolicyRow[]>;
  getProcessRequirements(
    processIds: string[]
  ): Promise<ProcessRequirementRow[]>;
  getQualifiedEmployees(abilityIds: string[]): Promise<QualifiedEmployeeRow[]>;
  getEmployeeShiftWindows(
    employeeIds: string[]
  ): Promise<EmployeeShiftRow[]>;
  getCrewAssignments(
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<CrewAssignmentRow[]>;
  getCrewAbsences(rangeStart: Date, rangeEnd: Date): Promise<CrewAbsenceRow[]>;
}

/**
 * Live implementation backed by Kysely (and the Supabase client for the
 * job-method-tree RPC). Queries are moved verbatim from the engine,
 * work-center selector, assembly handler, and material manager.
 */
export class KyselyMasterDataProvider implements MasterDataProvider {
  private db: Kysely<DB>;
  private client: SupabaseClient<Database>;
  private companyId: string;

  /**
   * Batch mode: when several jobs are scheduled in one invocation, the
   * company's STATIC master data (processes, work centers, qualifications,
   * shift windows, dispatch policies) is identical for every job — cache it
   * on first read instead of re-querying per job. Job-scoped reads
   * (operations, dependencies) and live reservations are NEVER cached:
   * reservations must stay DB-fresh so each job in the batch sees the
   * previous jobs' just-persisted placements.
   */
  private companyCache: Map<string, Promise<unknown>> | null = null;

  constructor(
    db: Kysely<DB>,
    client: SupabaseClient<Database>,
    companyId: string,
    options?: { cacheCompanyData?: boolean }
  ) {
    this.db = db;
    this.client = client;
    this.companyId = companyId;
    if (options?.cacheCompanyData) {
      this.companyCache = new Map();
    }
  }

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.companyCache) return load();
    let hit = this.companyCache.get(key);
    if (!hit) {
      hit = load();
      this.companyCache.set(key, hit);
    }
    return hit as Promise<T>;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    const job = await this.db
      .selectFrom("job")
      .leftJoin("location", "location.id", "job.locationId")
      .select([
        "job.id",
        "job.dueDate",
        "job.deadlineType",
        "job.locationId",
        "job.priority",
        "location.timezone",
      ])
      .where("job.id", "=", jobId)
      .where("job.companyId", "=", this.companyId)
      .executeTakeFirst();
    if (!job) return undefined;
    // pg returns DATE columns as JS Date objects; every consumer compares
    // dueDate lexicographically as "YYYY-MM-DD" (a Date silently fails those
    // comparisons — string > Date is always false)
    return {
      ...job,
      dueDate: toIsoDate(job.dueDate),
      timezone: job.timezone ?? "UTC",
    };
  }

  async getOperations(
    jobId: string,
    opts?: { includeDone?: boolean }
  ): Promise<BaseOperation[]> {
    let query = this.db
      .selectFrom("jobOperation")
      .selectAll()
      .where("jobId", "=", jobId);

    if (!opts?.includeDone) {
      query = query.where("status", "not in", ["Done", "Canceled"]);
    }

    return (await query.orderBy("order").execute()) as BaseOperation[];
  }

  async getDependencies(jobId: string): Promise<JobOperationDependency[]> {
    const deps = await this.db
      .selectFrom("jobOperationDependency")
      .selectAll()
      .where("jobId", "=", jobId)
      .execute();

    return deps.map((d) => ({
      operationId: d.operationId,
      dependsOnId: d.dependsOnId,
      jobId: d.jobId,
    }));
  }

  async getReworkDependencies(
    jobId: string,
    reworkOpIds: string[]
  ): Promise<JobOperationDependency[]> {
    if (reworkOpIds.length === 0) {
      return [];
    }

    const deps = await this.db
      .selectFrom("jobOperationDependency")
      .selectAll()
      .where("jobId", "=", jobId)
      .where((eb) =>
        eb.or([
          eb("operationId", "in", reworkOpIds),
          eb("dependsOnId", "in", reworkOpIds),
        ])
      )
      .execute();

    return deps.map((d) => ({
      operationId: d.operationId,
      dependsOnId: d.dependsOnId,
      jobId: d.jobId,
    }));
  }

  async getMaterialsWithMakeMethod(
    makeMethodIds: string[]
  ): Promise<JobMaterialWithMakeMethod[]> {
    if (makeMethodIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobMaterialWithMakeMethodId")
      .selectAll()
      .where("jobMakeMethodId", "in", makeMethodIds)
      .execute();
  }

  async getUnassignedMakeToOrderMaterials(
    makeMethodIds: string[]
  ): Promise<UnassignedMaterial[]> {
    if (makeMethodIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobMakeMethodId", "in", makeMethodIds)
      .where("methodType", "=", "Make to Order")
      .where("jobOperationId", "is", null)
      .execute();
  }

  async getUnlinkedMaterials(jobId: string): Promise<UnlinkedMaterial[]> {
    return await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobId", "=", jobId)
      .where("jobOperationId", "is", null)
      .execute();
  }

  async getRootMakeMethod(jobId: string): Promise<RootMakeMethod | undefined> {
    return await this.db
      .selectFrom("jobMakeMethod")
      .select(["id", "itemId"])
      .where("jobId", "=", jobId)
      .where("parentMaterialId", "is", null)
      .executeTakeFirst();
  }

  async getJobMethodTree(
    methodId: string
  ): Promise<{ data: JobMethodTreeItem[] | null; error: unknown }> {
    return await getJobMethodTree(this.client, methodId);
  }

  async getProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]> {
    return this.cached("processesWithWorkCenters", () =>
      this.loadProcessesWithWorkCenters()
    );
  }

  private async loadProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]> {
    return await this.db
      .selectFrom("processes")
      .select(["id", "workCenters"])
      .where("companyId", "=", this.companyId)
      .execute();
  }

  async getActiveWorkCenters(
    locationId: string
  ): Promise<ActiveWorkCenter[]> {
    return this.cached(`activeWorkCenters:${locationId}`, () =>
      this.loadActiveWorkCenters(locationId)
    );
  }

  private async loadActiveWorkCenters(
    locationId: string
  ): Promise<ActiveWorkCenter[]> {
    return await this.db
      .selectFrom("workCenter")
      .select(["id", "locationId"])
      .where("locationId", "=", locationId)
      .where("companyId", "=", this.companyId)
      .where("active", "=", true)
      .execute();
  }

  async getCrossJobOperationsAtWorkCenters(
    workCenterIds: string[]
  ): Promise<CrossJobOperation[]> {
    if (workCenterIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobOperation as jo")
      .innerJoin("job as j", "j.id", "jo.jobId")
      .select([
        "jo.id",
        "jo.dueDate",
        "jo.startDate",
        "jo.priority",
        "j.deadlineType",
        "j.priority as jobPriority",
        "jo.workCenterId",
        "jo.createdAt",
        "jo.setupTime",
        "jo.setupUnit",
        "jo.laborTime",
        "jo.laborUnit",
        "jo.machineTime",
        "jo.machineUnit",
        "jo.operationQuantity",
      ])
      .where("jo.companyId", "=", this.companyId)
      .where("jo.workCenterId", "in", workCenterIds)
      .where("jo.status", "not in", ["Done", "Canceled"])
      // Ops can outlive their job's lifecycle (cancelling a job does not
      // cancel its ops) — terminal jobs must not compete in dispatch order
      .where("j.status", "not in", ["Cancelled", "Completed", "Closed"])
      .execute();
  }

  async getLiveReservations(
    fromDate: Date,
    excludeJobId: string
  ): Promise<LiveReservation[]> {
    const rows = await this.db
      .selectFrom("capacityReservation as cr")
      .innerJoin("job as j", "j.id", "cr.jobId")
      .select([
        "cr.resourceKind",
        "cr.resourceId",
        "cr.startAt",
        "cr.endAt",
        "cr.jobId",
        "j.jobId as readableJobId",
      ])
      .where("cr.companyId", "=", this.companyId)
      .where("cr.scenarioId", "is", null)
      .where("cr.jobId", "!=", excludeJobId)
      .where("cr.endAt", ">", fromDate.toISOString())
      // Reservations are only deleted when their job is rescheduled, so
      // rows from jobs outside these statuses linger (terminal jobs) or
      // pre-date release (Draft/Planned) — neither may hold capacity
      // against live jobs
      .where("j.status", "in", [...capacityHoldingJobStatuses])
      .execute();

    return rows.map((r) => ({
      resourceKind: r.resourceKind as LiveReservation["resourceKind"],
      resourceId: r.resourceId,
      startAt: new Date(r.startAt as unknown as string),
      endAt: new Date(r.endAt as unknown as string),
      jobId: r.jobId,
      readableJobId: r.readableJobId,
    }));
  }

  async getSchedulingPolicies(): Promise<SchedulingPolicyRow[]> {
    return this.cached("schedulingPolicies", () =>
      this.loadSchedulingPolicies()
    );
  }

  private async loadSchedulingPolicies(): Promise<SchedulingPolicyRow[]> {
    const rows = await this.db
      .selectFrom("schedulingPolicy")
      .select(["workCenterId", "dispatchRule"])
      .where("companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      workCenterId: r.workCenterId,
      dispatchRule: r.dispatchRule as SchedulingPolicyRow["dispatchRule"],
    }));
  }

  async getProcessRequirements(
    processIds: string[]
  ): Promise<ProcessRequirementRow[]> {
    return this.cached(
      `processRequirements:${[...processIds].sort().join(",")}`,
      () => this.loadProcessRequirements(processIds)
    );
  }

  private async loadProcessRequirements(
    processIds: string[]
  ): Promise<ProcessRequirementRow[]> {
    if (processIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("process as p")
      .innerJoin("ability as a", (join) =>
        join
          .onRef("a.processId", "=", "p.id")
          .on("a.companyId", "=", this.companyId)
          .on("a.active", "=", true)
      )
      .select(["p.id as processId", "a.id as abilityId", "a.name as abilityName"])
      .where("p.id", "in", processIds)
      .where("p.companyId", "=", this.companyId)
      .where("p.requiresAbility", "=", true)
      .execute();

    return rows.map((r) => ({
      processId: r.processId,
      abilityId: r.abilityId,
      abilityName: r.abilityName,
    }));
  }

  async getQualifiedEmployees(
    abilityIds: string[]
  ): Promise<QualifiedEmployeeRow[]> {
    return this.cached(
      `qualifiedEmployees:${[...abilityIds].sort().join(",")}`,
      () => this.loadQualifiedEmployees(abilityIds)
    );
  }

  private async loadQualifiedEmployees(
    abilityIds: string[]
  ): Promise<QualifiedEmployeeRow[]> {
    if (abilityIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("employeeAbility as ea")
      .select([
        "ea.abilityId",
        "ea.employeeId",
        "ea.active",
        "ea.trainingCompleted",
        "ea.expiresAt",
      ])
      .where("ea.abilityId", "in", abilityIds)
      .where("ea.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      abilityId: r.abilityId,
      employeeId: r.employeeId,
      active: Boolean(r.active),
      trainingCompleted: r.trainingCompleted,
      expiresAt: toIsoDate(r.expiresAt),
    }));
  }

  async getEmployeeShiftWindows(
    employeeIds: string[]
  ): Promise<EmployeeShiftRow[]> {
    return this.cached(
      `employeeShiftWindows:${[...employeeIds].sort().join(",")}`,
      () => this.loadEmployeeShiftWindows(employeeIds)
    );
  }

  private async loadEmployeeShiftWindows(
    employeeIds: string[]
  ): Promise<EmployeeShiftRow[]> {
    if (employeeIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("employeeShift as es")
      .innerJoin("shift as s", "s.id", "es.shiftId")
      .leftJoin("location as l", "l.id", "s.locationId")
      .select([
        "es.employeeId",
        "s.startTime",
        "s.endTime",
        "s.sunday",
        "s.monday",
        "s.tuesday",
        "s.wednesday",
        "s.thursday",
        "s.friday",
        "s.saturday",
        "l.timezone",
      ])
      .where("es.employeeId", "in", employeeIds)
      .where("es.companyId", "=", this.companyId)
      .where("s.active", "=", true)
      .execute();

    const result: EmployeeShiftRow[] = [];
    for (const r of rows) {
      const days = [
        r.sunday,
        r.monday,
        r.tuesday,
        r.wednesday,
        r.thursday,
        r.friday,
        r.saturday,
      ];
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        if (!days[dayOfWeek]) continue;
        result.push({
          employeeId: r.employeeId,
          dayOfWeek,
          startTime: String(r.startTime),
          endTime: String(r.endTime),
          timezone: r.timezone ?? "UTC",
        });
      }
    }
    return result;
  }

  async getCrewAssignments(
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<CrewAssignmentRow[]> {
    return this.cached(
      `crewAssignments:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`,
      () => this.loadCrewAssignments(rangeStart, rangeEnd)
    );
  }

  private async loadCrewAssignments(
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<CrewAssignmentRow[]> {
    const rows = await this.db
      .selectFrom("crewAssignment as ca")
      .select([
        "ca.workCenterId",
        "ca.employeeId",
        "ca.date",
        "ca.shiftId",
        "ca.overtimeHours",
        "ca.hours",
      ])
      .where("ca.companyId", "=", this.companyId)
      .where("ca.date", ">=", rangeStart.toISOString().slice(0, 10))
      .where("ca.date", "<=", rangeEnd.toISOString().slice(0, 10))
      // stable order so split days deal their hours out deterministically
      .orderBy("ca.date")
      .orderBy("ca.id")
      .execute();

    return rows.flatMap((r) => {
      const date = toIsoDate(r.date);
      return date
        ? [
            {
              workCenterId: r.workCenterId,
              employeeId: r.employeeId,
              date,
              shiftId: r.shiftId,
              overtimeHours: Number(r.overtimeHours ?? 0),
              hours: r.hours == null ? null : Number(r.hours),
            },
          ]
        : [];
    });
  }

  async getCrewAbsences(
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<CrewAbsenceRow[]> {
    return this.cached(
      `crewAbsences:${rangeStart.toISOString()}:${rangeEnd.toISOString()}`,
      () => this.loadCrewAbsences(rangeStart, rangeEnd)
    );
  }

  private async loadCrewAbsences(
    rangeStart: Date,
    rangeEnd: Date
  ): Promise<CrewAbsenceRow[]> {
    const rows = await this.db
      .selectFrom("crewAbsence as ca")
      .select(["ca.employeeId", "ca.date", "ca.shiftId"])
      .where("ca.companyId", "=", this.companyId)
      .where("ca.date", ">=", rangeStart.toISOString().slice(0, 10))
      .where("ca.date", "<=", rangeEnd.toISOString().slice(0, 10))
      .execute();

    return rows.flatMap((r) => {
      const date = toIsoDate(r.date);
      return date
        ? [
            {
              employeeId: r.employeeId,
              date,
              shiftId: r.shiftId,
            },
          ]
        : [];
    });
  }
}
