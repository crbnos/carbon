import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import { getJobMethodTree, type JobMethodTreeItem } from "../methods.ts";
import type { Database } from "../types.ts";
import { toIsoDate } from "./date-utils.ts";
import type { BaseOperation, Job, JobOperationDependency } from "./types.ts";

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
};

export type LiveReservation = {
  resourceKind: "WorkCenter" | "OperatorPool";
  resourceId: string;
  startAt: Date;
  endAt: Date;
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

  constructor(
    db: Kysely<DB>,
    client: SupabaseClient<Database>,
    companyId: string
  ) {
    this.db = db;
    this.client = client;
    this.companyId = companyId;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    return await this.db
      .selectFrom("job")
      .select(["id", "dueDate", "deadlineType", "locationId", "priority"])
      .where("id", "=", jobId)
      .executeTakeFirst();
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
    return await this.db
      .selectFrom("processes")
      .select(["id", "workCenters"])
      .where("companyId", "=", this.companyId)
      .execute();
  }

  async getActiveWorkCenters(
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
      ])
      .where("jo.workCenterId", "in", workCenterIds)
      .where("jo.status", "not in", ["Done", "Canceled"])
      .execute();
  }

  async getLiveReservations(
    fromDate: Date,
    excludeJobId: string
  ): Promise<LiveReservation[]> {
    const rows = await this.db
      .selectFrom("capacityReservation")
      .select(["resourceKind", "resourceId", "startAt", "endAt"])
      .where("companyId", "=", this.companyId)
      .where("scenarioId", "is", null)
      .where("jobId", "!=", excludeJobId)
      .where("endAt", ">", fromDate.toISOString())
      .execute();

    return rows.map((r) => ({
      resourceKind: r.resourceKind as "WorkCenter" | "OperatorPool",
      resourceId: r.resourceId,
      startAt: new Date(r.startAt as unknown as string),
      endAt: new Date(r.endAt as unknown as string),
    }));
  }

  async getSchedulingPolicies(): Promise<SchedulingPolicyRow[]> {
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
}
