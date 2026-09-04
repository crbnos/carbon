import type { Database } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import {
  getJobMethodTree,
  type JobMethodTreeItem
} from "@carbon/database/methods";
import { parseDate } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { type CalendarWindow, subtractIntervals } from "./calendar-utils.ts";
import {
  businessDayFromMs,
  msToInstantIso,
  toInstantIso,
  toInstantMs,
  toIsoDate
} from "./date-utils.ts";
import {
  type LadderShiftRow,
  resolveLocationWindows,
  resolveWorkCenterWindows,
  type WorkCenterAvailabilityInput
} from "./machine-availability.ts";
import {
  type BaseOperation,
  capacityHoldingJobStatuses,
  type Job,
  type JobOperationDependency
} from "./types.ts";

// peopleAssignment.date is a plant-calendar day — resolve the range instants to
// days in the plant's own timezone, padded one day each side so an overnight
// shift row whose windows spill past its calendar day is never cut at the
// range boundary.
const peopleDateLowerBound = (instant: number, timeZone: string) =>
  parseDate(businessDayFromMs(instant, timeZone))
    .subtract({ days: 1 })
    .toString();

const peopleDateUpperBound = (instant: number, timeZone: string) =>
  parseDate(businessDayFromMs(instant, timeZone)).add({ days: 1 }).toString();

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
  createdAt: Date | string | null;
  setupTime: number | null;
  setupUnit: Database["public"]["Enums"]["factor"] | null;
  laborTime: number | null;
  laborUnit: Database["public"]["Enums"]["factor"] | null;
  machineTime: number | null;
  machineUnit: Database["public"]["Enums"]["factor"] | null;
  operationQuantity: number | null;
  operationLeadTime: number | null;
};

export type LiveReservation = {
  /** "OperatorPool" is legacy — read-tolerated, never written anymore. */
  resourceKind: "WorkCenter" | "OperatorPool" | "Employee";
  resourceId: string;
  /** epoch-ms */
  startAt: number;
  /** epoch-ms */
  endAt: number;
  jobId: string;
  /** Human-readable job number (job."jobId", e.g. J000001) for conflict messages */
  readableJobId: string;
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

// Row types live in people-utils.ts (pure module) so the deno tests don't pull
// the DB dependency graph
import type { PeopleAbsenceRow, PeopleAssignmentRow } from "./people-utils.ts";
export type { PeopleAbsenceRow, PeopleAssignmentRow };

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
    fromDate: number,
    excludeJobIds: string[]
  ): Promise<LiveReservation[]>;
  /** The subset of the given operation ids that have ≥1 production event
   * (used by remaining-work netting to decide setup is already done). */
  getOperationsWithEvents(operationIds: string[]): Promise<Set<string>>;
  getProcessRequirements(
    processIds: string[]
  ): Promise<ProcessRequirementRow[]>;
  getQualifiedEmployees(abilityIds: string[]): Promise<QualifiedEmployeeRow[]>;
  getEmployeeShiftWindows(employeeIds: string[]): Promise<EmployeeShiftRow[]>;
  /**
   * Machine-availability ladder per work center: explicit workCenterShift rows
   * → the location's shifts → a stock Mon–Fri 08:00–16:00 week; or one open
   * window for an `alwaysOn` machine. Returns id → open windows.
   */
  getWorkCenterAvailability(
    workCenterIds: string[],
    rangeStart: number,
    rangeEnd: number
  ): Promise<Map<string, CalendarWindow[]>>;
  /**
   * A location's default calendar (rung 2/3) — the fallback availability for
   * people with no `employeeShift` rows (plant hours, not 24×7).
   */
  getLocationCalendarWindows(
    locationId: string,
    rangeStart: number,
    rangeEnd: number
  ): Promise<CalendarWindow[]>;
  /** The location's `requiresStaffing` scheduling policy (default false). */
  getLocationRequiresStaffing(locationId: string): Promise<boolean>;
  /** The subset of the given work centers flagged `alwaysOn` (lights-out). */
  getAlwaysOnWorkCenterIds(workCenterIds: string[]): Promise<Set<string>>;
  getPeopleAssignments(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAssignmentRow[]>;
  getPeopleAbsences(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAbsenceRow[]>;
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
        "job.status",
        "job.dueDate",
        "job.deadlineType",
        "job.locationId",
        "job.priority",
        "job.jobId as readableJobId",
        "job.assignee",
        "job.projectedCompletionAt",
        "location.timezone"
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
      projectedCompletionAt:
        job.projectedCompletionAt == null
          ? null
          : toInstantIso(job.projectedCompletionAt as unknown as Date | string)
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
      jobId: d.jobId
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
          eb("dependsOnId", "in", reworkOpIds)
        ])
      )
      .execute();

    return deps.map((d) => ({
      operationId: d.operationId,
      dependsOnId: d.dependsOnId,
      jobId: d.jobId
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

  async getActiveWorkCenters(locationId: string): Promise<ActiveWorkCenter[]> {
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
        "jo.operationLeadTime"
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
    fromDate: number,
    excludeJobIds: string[]
  ): Promise<LiveReservation[]> {
    let query = this.db
      .selectFrom("capacityReservation as cr")
      .innerJoin("job as j", "j.id", "cr.jobId")
      .select([
        "cr.resourceKind",
        "cr.resourceId",
        "cr.startAt",
        "cr.endAt",
        "cr.jobId",
        "j.jobId as readableJobId"
      ])
      .where("cr.companyId", "=", this.companyId)
      .where("cr.scenarioId", "is", null)
      // Placeholder reservations are display-only markers for unplaceable ops —
      // they must never hold capacity against other jobs or the next regen.
      .where("cr.isPlaceholder", "is not", true)
      .where("cr.endAt", ">", msToInstantIso(fromDate));
    // Exclude the whole batch: each engine run sees only non-batch reservations
    // plus the in-run placements of already-run batch jobs (no pre-clear step).
    if (excludeJobIds.length > 0) {
      query = query.where("cr.jobId", "not in", excludeJobIds);
    }
    const rows = await query
      // Reservations are only deleted when their job is rescheduled, so
      // rows from jobs outside these statuses linger (terminal jobs) or
      // pre-date release (Draft/Planned) — neither may hold capacity
      // against live jobs
      .where("j.status", "in", [...capacityHoldingJobStatuses])
      .execute();

    return rows.map((r) => ({
      resourceKind: r.resourceKind as LiveReservation["resourceKind"],
      resourceId: r.resourceId,
      startAt: toInstantMs(r.startAt as unknown as Date | string),
      endAt: toInstantMs(r.endAt as unknown as Date | string),
      jobId: r.jobId,
      readableJobId: r.readableJobId
    }));
  }

  async getOperationsWithEvents(operationIds: string[]): Promise<Set<string>> {
    const result = new Set<string>();
    if (operationIds.length === 0) {
      return result;
    }
    // Chunk the IN list — one query per chunk, never per-row (N+1 rule).
    const CHUNK = 200;
    for (let i = 0; i < operationIds.length; i += CHUNK) {
      const chunk = operationIds.slice(i, i + CHUNK);
      const rows = await this.db
        .selectFrom("productionEvent")
        .select("jobOperationId")
        .distinct()
        .where("jobOperationId", "in", chunk)
        .where("companyId", "=", this.companyId)
        .execute();
      for (const r of rows) {
        if (r.jobOperationId) result.add(r.jobOperationId);
      }
    }
    return result;
  }

  getLocationRequiresStaffing(locationId: string): Promise<boolean> {
    return this.cached(`locationRequiresStaffing:${locationId}`, async () => {
      const row = await this.db
        .selectFrom("location")
        .select("requiresStaffing")
        .where("id", "=", locationId)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      return !!row?.requiresStaffing;
    });
  }

  getAlwaysOnWorkCenterIds(workCenterIds: string[]): Promise<Set<string>> {
    return this.cached(
      `alwaysOnWorkCenters:${[...workCenterIds].sort().join(",")}`,
      async () => {
        const result = new Set<string>();
        if (workCenterIds.length === 0) return result;
        const rows = await this.db
          .selectFrom("workCenter")
          .select("id")
          .where("id", "in", workCenterIds)
          .where("companyId", "=", this.companyId)
          .where("alwaysOn", "=", true)
          .execute();
        for (const r of rows) result.add(r.id);
        return result;
      }
    );
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
      .select([
        "p.id as processId",
        "a.id as abilityId",
        "a.name as abilityName"
      ])
      .where("p.id", "in", processIds)
      .where("p.companyId", "=", this.companyId)
      .where("p.requiresAbility", "=", true)
      .execute();

    return rows.map((r) => ({
      processId: r.processId,
      abilityId: r.abilityId,
      abilityName: r.abilityName
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
      .select(["ea.abilityId", "ea.employeeId", "ea.expiresAt"])
      .where("ea.abilityId", "in", abilityIds)
      .where("ea.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      abilityId: r.abilityId,
      employeeId: r.employeeId,
      expiresAt: toIsoDate(r.expiresAt)
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
        "l.timezone"
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
        r.saturday
      ];
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        if (!days[dayOfWeek]) continue;
        result.push({
          employeeId: r.employeeId,
          dayOfWeek,
          startTime: String(r.startTime),
          endTime: String(r.endTime),
          timezone: r.timezone ?? "UTC"
        });
      }
    }
    return result;
  }

  /** Flatten a shift row's weekday booleans into one LadderShiftRow per day. */
  private expandShiftDays(row: {
    startTime: unknown;
    endTime: unknown;
    timezone: string | null;
    sunday: boolean | null;
    monday: boolean | null;
    tuesday: boolean | null;
    wednesday: boolean | null;
    thursday: boolean | null;
    friday: boolean | null;
    saturday: boolean | null;
  }): LadderShiftRow[] {
    const days = [
      row.sunday,
      row.monday,
      row.tuesday,
      row.wednesday,
      row.thursday,
      row.friday,
      row.saturday
    ];
    const out: LadderShiftRow[] = [];
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      if (!days[dayOfWeek]) continue;
      out.push({
        dayOfWeek,
        startTime: String(row.startTime),
        endTime: String(row.endTime),
        timezone: row.timezone ?? "UTC"
      });
    }
    return out;
  }

  async getWorkCenterAvailability(
    workCenterIds: string[],
    rangeStart: number,
    rangeEnd: number
  ): Promise<Map<string, CalendarWindow[]>> {
    if (workCenterIds.length === 0) {
      return new Map();
    }
    return this.cached(
      `workCenterAvailability:${[...workCenterIds].sort().join(",")}:${rangeStart}:${rangeEnd}`,
      () => this.loadWorkCenterAvailability(workCenterIds, rangeStart, rangeEnd)
    );
  }

  private async loadWorkCenterAvailability(
    workCenterIds: string[],
    rangeStart: number,
    rangeEnd: number
  ): Promise<Map<string, CalendarWindow[]>> {
    // a. work centers with their lights-out flag + location timezone
    const wcRows = await this.db
      .selectFrom("workCenter as wc")
      .leftJoin("location as l", "l.id", "wc.locationId")
      .select(["wc.id", "wc.alwaysOn", "wc.locationId", "l.timezone"])
      .where("wc.id", "in", workCenterIds)
      .where("wc.companyId", "=", this.companyId)
      .execute();
    const workCenters: WorkCenterAvailabilityInput[] = wcRows.map((r) => ({
      id: r.id,
      alwaysOn: !!r.alwaysOn,
      locationId: r.locationId ?? null,
      timezone: r.timezone ?? "UTC"
    }));

    // b. explicit work-center shifts (rung 1)
    const wcShiftRaw = await this.db
      .selectFrom("workCenterShift as wcs")
      .innerJoin("shift as s", "s.id", "wcs.shiftId")
      .leftJoin("location as l", "l.id", "s.locationId")
      .select([
        "wcs.workCenterId",
        "s.startTime",
        "s.endTime",
        "s.sunday",
        "s.monday",
        "s.tuesday",
        "s.wednesday",
        "s.thursday",
        "s.friday",
        "s.saturday",
        "l.timezone"
      ])
      .where("wcs.workCenterId", "in", workCenterIds)
      .where("wcs.companyId", "=", this.companyId)
      .where("s.active", "=", true)
      .execute();
    const workCenterShiftRows = wcShiftRaw.flatMap((r) =>
      this.expandShiftDays(r).map((d) => ({
        ...d,
        workCenterId: r.workCenterId
      }))
    );

    // c. the location's shifts (rung 2)
    const locationIds = Array.from(
      new Set(
        workCenters
          .map((w) => w.locationId)
          .filter((x): x is string => x != null)
      )
    );
    const locShiftRaw =
      locationIds.length === 0
        ? []
        : await this.db
            .selectFrom("shift as s")
            .leftJoin("location as l", "l.id", "s.locationId")
            .select([
              "s.locationId",
              "s.startTime",
              "s.endTime",
              "s.sunday",
              "s.monday",
              "s.tuesday",
              "s.wednesday",
              "s.thursday",
              "s.friday",
              "s.saturday",
              "l.timezone"
            ])
            .where("s.locationId", "in", locationIds)
            .where("s.companyId", "=", this.companyId)
            .where("s.active", "=", true)
            .execute();
    const locationShiftRows = locShiftRaw.flatMap((r) =>
      this.expandShiftDays(r).map((d) => ({ ...d, locationId: r.locationId }))
    );

    const windowsMap = resolveWorkCenterWindows({
      workCenters,
      workCenterShiftRows,
      locationShiftRows,
      rangeStart,
      rangeEnd
    });

    // Machine downtime: subtract open maintenance dispatches flagged
    // takesWorkCenterOffline from the resolved windows (derived, not stored —
    // completing the dispatch restores the hours at the next regen). Even an
    // alwaysOn machine is subtracted: a broken lights-out machine is still down.
    const outagesByWc = await this.loadDowntimeOutages(workCenterIds, rangeEnd);
    for (const [wcId, outages] of outagesByWc) {
      const windows = windowsMap.get(wcId);
      if (windows) {
        windowsMap.set(wcId, subtractIntervals(windows, outages));
      }
    }

    return windowsMap;
  }

  /**
   * Outage windows per work center from OPEN maintenance dispatches flagged
   * takesWorkCenterOffline. One dispatch is down from
   * (actualStartTime ?? plannedStartTime ?? createdAt) to
   * (actualEndTime ?? plannedEndTime ?? rangeEnd — open-ended = down to the
   * horizon), and applies to its own workCenterId AND every joined work center.
   * Two selects (no per-WC queries).
   */
  private async loadDowntimeOutages(
    workCenterIds: string[],
    rangeEnd: number
  ): Promise<Map<string, CalendarWindow[]>> {
    const outagesByWc = new Map<string, CalendarWindow[]>();
    if (workCenterIds.length === 0) return outagesByWc;

    const dispatches = await this.db
      .selectFrom("maintenanceDispatch")
      .select([
        "id",
        "workCenterId",
        "plannedStartTime",
        "plannedEndTime",
        "actualStartTime",
        "actualEndTime",
        "createdAt"
      ])
      .where("companyId", "=", this.companyId)
      .where("takesWorkCenterOffline", "=", true)
      .where("status", "not in", ["Completed", "Cancelled"])
      .execute();
    if (dispatches.length === 0) return outagesByWc;

    // The work centers each dispatch takes offline via the join table.
    const joinRows = await this.db
      .selectFrom("maintenanceDispatchWorkCenter")
      .select(["maintenanceDispatchId", "workCenterId"])
      .where(
        "maintenanceDispatchId",
        "in",
        dispatches.map((d) => d.id)
      )
      .execute();
    const joinByDispatch = new Map<string, string[]>();
    for (const j of joinRows) {
      const list = joinByDispatch.get(j.maintenanceDispatchId) ?? [];
      list.push(j.workCenterId);
      joinByDispatch.set(j.maintenanceDispatchId, list);
    }

    const wcIdSet = new Set(workCenterIds);
    const toMs = (v: unknown) => toInstantMs(v as unknown as Date | string);
    for (const d of dispatches) {
      const start = toMs(
        d.actualStartTime ?? d.plannedStartTime ?? d.createdAt
      );
      const end = d.actualEndTime
        ? toMs(d.actualEndTime)
        : d.plannedEndTime
          ? toMs(d.plannedEndTime)
          : rangeEnd; // no end estimate = down until further notice
      const affected = new Set<string>();
      if (d.workCenterId && wcIdSet.has(d.workCenterId)) {
        affected.add(d.workCenterId);
      }
      for (const wcId of joinByDispatch.get(d.id) ?? []) {
        if (wcIdSet.has(wcId)) affected.add(wcId);
      }
      for (const wcId of affected) {
        const list = outagesByWc.get(wcId) ?? [];
        list.push({ start, end });
        outagesByWc.set(wcId, list);
      }
    }
    return outagesByWc;
  }

  async getLocationCalendarWindows(
    locationId: string,
    rangeStart: number,
    rangeEnd: number
  ): Promise<CalendarWindow[]> {
    return this.cached(
      `locationCalendar:${locationId}:${rangeStart}:${rangeEnd}`,
      () => this.loadLocationCalendarWindows(locationId, rangeStart, rangeEnd)
    );
  }

  private async loadLocationCalendarWindows(
    locationId: string,
    rangeStart: number,
    rangeEnd: number
  ): Promise<CalendarWindow[]> {
    const rows = await this.db
      .selectFrom("shift as s")
      .leftJoin("location as l", "l.id", "s.locationId")
      .select([
        "s.startTime",
        "s.endTime",
        "s.sunday",
        "s.monday",
        "s.tuesday",
        "s.wednesday",
        "s.thursday",
        "s.friday",
        "s.saturday",
        "l.timezone"
      ])
      .where("s.locationId", "=", locationId)
      .where("s.companyId", "=", this.companyId)
      .where("s.active", "=", true)
      .execute();
    const locationShiftRows = rows.flatMap((r) => this.expandShiftDays(r));

    // The stock-week fallback needs the location tz even with no shifts.
    let timezone = rows[0]?.timezone ?? null;
    if (!timezone) {
      const loc = await this.db
        .selectFrom("location")
        .select("timezone")
        .where("id", "=", locationId)
        .where("companyId", "=", this.companyId)
        .executeTakeFirst();
      timezone = loc?.timezone ?? "UTC";
    }

    return resolveLocationWindows({
      timezone: timezone ?? "UTC",
      locationShiftRows,
      rangeStart,
      rangeEnd
    });
  }

  async getPeopleAssignments(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAssignmentRow[]> {
    return this.cached(
      `peopleAssignments:${rangeStart}:${rangeEnd}:${timeZone}`,
      () => this.loadPeopleAssignments(rangeStart, rangeEnd, timeZone)
    );
  }

  private async loadPeopleAssignments(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAssignmentRow[]> {
    const rows = await this.db
      .selectFrom("peopleAssignment as ca")
      .select([
        "ca.workCenterId",
        "ca.employeeId",
        "ca.date",
        "ca.shiftId",
        "ca.overtimeHours",
        "ca.hours"
      ])
      .where("ca.companyId", "=", this.companyId)
      .where("ca.date", ">=", peopleDateLowerBound(rangeStart, timeZone))
      .where("ca.date", "<=", peopleDateUpperBound(rangeEnd, timeZone))
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
              hours: r.hours == null ? null : Number(r.hours)
            }
          ]
        : [];
    });
  }

  async getPeopleAbsences(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAbsenceRow[]> {
    return this.cached(
      `peopleAbsences:${rangeStart}:${rangeEnd}:${timeZone}`,
      () => this.loadPeopleAbsences(rangeStart, rangeEnd, timeZone)
    );
  }

  private async loadPeopleAbsences(
    rangeStart: number,
    rangeEnd: number,
    timeZone: string
  ): Promise<PeopleAbsenceRow[]> {
    const rows = await this.db
      .selectFrom("peopleAbsence as ca")
      .select(["ca.employeeId", "ca.date", "ca.shiftId"])
      .where("ca.companyId", "=", this.companyId)
      .where("ca.date", ">=", peopleDateLowerBound(rangeStart, timeZone))
      .where("ca.date", "<=", peopleDateUpperBound(rangeEnd, timeZone))
      .execute();

    return rows.flatMap((r) => {
      const date = toIsoDate(r.date);
      return date
        ? [
            {
              employeeId: r.employeeId,
              date,
              shiftId: r.shiftId
            }
          ]
        : [];
    });
  }
}
