import type { Database } from "@carbon/database";
// DB comes from postgres/index.ts (a type-only alias), NOT ../database.ts —
// database.ts pulls in the Deno-only postgres driver, which fails the Node
// typecheck reached via src/scheduling.ts re-exporting this engine in-process.
import type { DB } from "@carbon/database/client";
import {
  datetime,
  getCompanyTimeZone,
  getLocationTimeZone
} from "@carbon/database/datetime";
import { getFunctionLogger } from "@carbon/database/logging";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";
import {
  AssemblyHandler,
  buildMakeMethodDependencies
} from "./assembly-handler.ts";
import {
  type CalendarShiftRow,
  type CalendarWindow,
  expandCalendar,
  unionWindows
} from "./calendar-utils.ts";
import {
  type BehindTargetOperation,
  composeBehindTarget
} from "./conflict-messages.ts";
import { buildScheduledOperations } from "./date-calculator.ts";
import {
  businessDay,
  msToInstantIso,
  toInstantIso,
  toInstantMs,
  toIsoDate
} from "./date-utils.ts";
import {
  buildOperationDependencies,
  DependencyGraphImpl,
  dependenciesToRecords
} from "./dependency-manager.ts";
import { calculateDurationHours } from "./duration-calculator.ts";
import {
  KyselyMasterDataProvider,
  type MasterDataProvider
} from "./master-data-provider.ts";
import { MaterialManager } from "./material-manager.ts";
import { calendarAdapters, computeNeedByDates } from "./need-by-calculator.ts";
import {
  buildAbsencesByEmployee,
  buildAssignmentsByEmployee,
  buildOvertimeByEmployee,
  buildPeopleBudgets,
  buildPeopleByWorkCenter,
  extendWindowsByOvertime,
  subtractAbsences
} from "./people-utils.ts";
import {
  applyPriorities,
  calculatePrioritiesByWorkCenter,
  toOperationWithJobInfo
} from "./priority-calculator.ts";
import type { ResourceCapacityData } from "./slot-allocator.ts";
import type {
  BaseOperation,
  Job,
  JobOperationDependency,
  OperationWithJobInfo,
  ScheduledOperation,
  SchedulingOptions,
  SchedulingResult
} from "./types.ts";
import {
  applyWorkCenterSelections,
  type FiniteSchedulingContext,
  type PoolEmployee,
  WorkCenterSelector
} from "./work-center-selector.ts";

const SCHEDULING_HORIZON_DAYS = 365;

const log = getFunctionLogger("schedule");

/**
 * Unified Scheduling Engine
 * Orchestrates all scheduling operations for both initial scheduling and rescheduling
 */
export class SchedulingEngine {
  private client: SupabaseClient<Database>;
  private db: Kysely<DB>;
  private jobId: string;
  private companyId: string;
  private userId: string;

  private job: Job | null = null;
  private operations: BaseOperation[] = [];
  private dependencies: JobOperationDependency[] = [];
  private scheduledOperations: Map<string, ScheduledOperation> = new Map();
  private affectedWorkCenters: Set<string> = new Set();
  private assemblyDepth: number = 0;
  private conflictsDetected: number = 0;
  private timezone: string = "UTC";

  private assemblyHandler: AssemblyHandler;
  private workCenterSelector: WorkCenterSelector | null = null;
  private materialManager: MaterialManager;
  private reservationsWritten = 0;

  /**
   * The single `now` for this run — captured ONCE by the caller and shared
   * across every job in a batch so the whole location schedules against one
   * clock (determinism: identical snapshot + identical now ⇒ identical
   * schedule). Never `Date.now()` inside the engine's placement path.
   * epoch-ms.
   */
  private now: number;
  /** When false, run() simulates without writing anything (expedite what-if). */
  private persist: boolean;
  /**
   * Job ids whose live reservations to EXCLUDE from the snapshot — the whole
   * batch, so each run sees only non-batch reservations plus the in-run
   * placements of already-run batch jobs. Defaults to just this job.
   */
  private excludeJobIds: string[];
  /** Forecast finish (max placed end) — set after placement, persisted. */
  private projectedCompletionAt: string | null = null;
  /** True when this regen flipped the job from on-time (or unforecast) to late. */
  private newlyLate = false;
  /**
   * Backward need-by targets per operation id ("YYYY-MM-DD" | null), computed
   * by computeNeedBys() BEFORE placement and read by NOTHING in the placement
   * path — persistChanges diff-writes them to jobOperation.dueDate
   * (spec 2026-08-15 dual dates).
   */
  private needByByOperation: Map<string, string | null> = new Map();
  /**
   * Forward topological order of this job's operation ids — the need-by
   * pass's dependency graph read front-to-back (set by computeNeedBys, the
   * same DAG placement orders itself by). Reused by the behind-target
   * attribution so "first behind target" means first in the routing, not
   * first in map-insertion order.
   */
  private topologicalOrder: string[] = [];
  /**
   * The run's one availability-windows fetch, shared by the need-by pass and
   * the finite placement context so targets and forecasts run on the SAME
   * calendar physics (and the provider is read once, not twice).
   */
  private availabilityWindows: {
    workCenterIds: Set<string>;
    workCenterAvailability: Map<string, CalendarWindow[]>;
    locationDefaultWindows: CalendarWindow[];
    rangeStart: number;
    rangeEnd: number;
  } | null = null;

  private provider: MasterDataProvider;

  constructor(
    options: SchedulingOptions & {
      client: SupabaseClient<Database>;
      db: Kysely<DB>;
      provider?: MasterDataProvider;
      /** Shared run clock (epoch-ms); defaults to a fresh clock if omitted. */
      now?: number;
      /** Simulate-only when false (no writes). Defaults to true. */
      persist?: boolean;
      /** Batch job ids to exclude from the reservation snapshot. */
      excludeJobIds?: string[];
    }
  ) {
    this.client = options.client;
    this.db = options.db;
    this.jobId = options.jobId;
    this.companyId = options.companyId;
    this.userId = options.userId;
    this.now = options.now ?? Date.now();
    this.persist = options.persist ?? true;
    this.excludeJobIds =
      options.excludeJobIds && options.excludeJobIds.length > 0
        ? options.excludeJobIds
        : [this.jobId];

    this.provider =
      options.provider ??
      new KyselyMasterDataProvider(this.db, this.client, this.companyId);

    this.assemblyHandler = new AssemblyHandler(this.provider);
    this.materialManager = new MaterialManager(this.db, this.provider);
  }

  /**
   * Initialize the engine - load job, operations, and dependencies
   */
  async initialize(): Promise<void> {
    // Load job
    const job = await this.provider.getJob(this.jobId);

    if (!job) {
      throw new Error(`Job ${this.jobId} not found`);
    }

    this.job = job;

    // "Today" (conflict detection, fallback anchor) follows the job site's
    // wall clock — scheduling is operational, not ledger-scoped.
    this.timezone = job.locationId
      ? await getLocationTimeZone(this.db, job.locationId, this.companyId)
      : await getCompanyTimeZone(this.db, this.companyId);

    // Initialize work center selector with location
    if (job.locationId) {
      this.workCenterSelector = new WorkCenterSelector(
        this.provider,
        job.locationId
      );
      await this.workCenterSelector.initialize();
    }

    // Load operations
    this.operations = await this.provider.getOperations(this.jobId);

    // Enrich each operation with its make method item's manufacturing lead time
    // so the date calculator can pull subassemblies earlier at assembly edges.
    await this.assignAssemblyLeadTimes();

    // Load existing dependencies as a starting point; createDependencies()
    // rebuilds the non-rework edges before placement.
    this.dependencies = await this.provider.getDependencies(this.jobId);

    // Initialize material manager
    await this.materialManager.initialize(this.jobId);

    // Assign operations to materials that don't have one. Dry-run (expedite
    // what-if) writes nothing, so skip this DB mutation.
    if (this.operations.length > 0 && this.persist) {
      const operationsByJobMakeMethodId = this.operations.reduce<
        Record<string, BaseOperation[]>
      >((acc, op) => {
        if (!acc[op.jobMakeMethodId!]) {
          acc[op.jobMakeMethodId!] = [];
        }
        acc[op.jobMakeMethodId!]!.push(op);
        return acc;
      }, {});

      const materialIds = this.materialManager.getMaterialIds();
      await this.materialManager.assignOperationsToMaterials(
        materialIds,
        operationsByJobMakeMethodId
      );
    }

    // Build assembly tree and get depth
    const assemblyTree = await this.assemblyHandler.buildAssemblyTree(
      this.jobId
    );
    if (assemblyTree) {
      this.assemblyDepth = this.assemblyHandler.getAssemblyDepth(assemblyTree);
    }
  }

  /**
   * Populate `assemblyLeadTime` on each loaded operation from the manufacturing
   * lead time (itemReplenishment.leadTime) of the item its make method builds.
   * Used at assembly boundaries in date calculation so a subassembly finishes
   * its lead time (in business days) before the parent operation that consumes it.
   */
  private async assignAssemblyLeadTimes(): Promise<void> {
    const makeMethodIds = [
      ...new Set(
        this.operations
          .map((op) => op.jobMakeMethodId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (makeMethodIds.length === 0) return;

    const makeMethods = await this.db
      .selectFrom("jobMakeMethod")
      .select(["id", "itemId"])
      .where("id", "in", makeMethodIds)
      .execute();

    const itemIds = [
      ...new Set(
        makeMethods
          .map((m) => m.itemId)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (itemIds.length === 0) return;

    const replenishments = await this.db
      .selectFrom("itemReplenishment")
      .select(["itemId", "leadTime"])
      .where("itemId", "in", itemIds)
      .execute();

    // NUMERIC columns can come back from pg as strings — coerce to a number.
    const toLeadTimeDays = (value: unknown): number => {
      const n = Number(value ?? 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const leadTimeByItemId = new Map(
      replenishments.map((r) => [r.itemId, toLeadTimeDays(r.leadTime)])
    );
    const leadTimeByMakeMethodId = new Map(
      makeMethods.map((m) => [m.id, leadTimeByItemId.get(m.itemId ?? "") ?? 0])
    );

    for (const op of this.operations) {
      if (op.jobMakeMethodId) {
        op.assemblyLeadTime =
          leadTimeByMakeMethodId.get(op.jobMakeMethodId) ?? 0;
      }
    }
  }

  /**
   * Create operation dependencies based on assembly structure.
   * Loads ALL operations (including Done) to build the complete DAG.
   */
  async createDependencies(): Promise<void> {
    // Load all operations for dependency building (not just active ones)
    const allOperations = await this.provider.getOperations(this.jobId, {
      includeDone: true
    });

    // Build assembly tree
    const assemblyTree = await this.assemblyHandler.buildAssemblyTree(
      this.jobId
    );
    if (!assemblyTree) {
      log.warning("No assembly tree found for job", { jobId: this.jobId });
      return;
    }

    // Get all jobMakeMethodIds
    const makeMethodIds =
      this.assemblyHandler.getAllJobMakeMethodIds(assemblyTree);

    // Get job materials for linking
    const jobMaterials =
      await this.provider.getMaterialsWithMakeMethod(makeMethodIds);

    // Build map from make method to operation
    const jobMakeMethodToOperationId: Record<string, string | null> = {};
    for (const m of jobMaterials) {
      if (m.jobMaterialMakeMethodId) {
        jobMakeMethodToOperationId[m.jobMaterialMakeMethodId] =
          m.jobOperationId;
      }
    }

    // Group non-rework operations by jobMakeMethodId
    const operationsByMethod = new Map<string, BaseOperation[]>();
    for (const op of allOperations) {
      if (op.jobMakeMethodId && !op.reworkId) {
        if (!operationsByMethod.has(op.jobMakeMethodId)) {
          operationsByMethod.set(op.jobMakeMethodId, []);
        }
        operationsByMethod.get(op.jobMakeMethodId)!.push(op);
      }
    }

    // Build make method dependencies
    const makeMethodDeps = buildMakeMethodDependencies(assemblyTree);

    // Build operation dependencies
    const allDependencies = new Map<string, Set<string>>();

    // Initialize all non-rework operations
    for (const op of allOperations) {
      if (op.id && !op.reworkId) {
        allDependencies.set(op.id, new Set());
      }
    }

    // Process each make method's operations
    for (const methodDep of makeMethodDeps) {
      const methodOps = operationsByMethod.get(methodDep.id) ?? [];

      // Get last operation of this method
      const sortedOps = [...methodOps].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      const lastOperation = sortedOps[sortedOps.length - 1];

      // If this method has a parent, link last op to parent's consuming operation
      if (methodDep.id && methodDep.parentId !== null) {
        let parentOperation = jobMakeMethodToOperationId[methodDep.id];

        // If no specific operation was set, default to the first operation of the parent
        if (!parentOperation && methodDep.parentId) {
          const parentOps = operationsByMethod.get(methodDep.parentId) ?? [];
          const sortedParentOps = [...parentOps].sort(
            (a, b) => (a.order ?? 0) - (b.order ?? 0)
          );
          parentOperation = sortedParentOps[0]?.id ?? null;
        }

        if (parentOperation && lastOperation?.id) {
          const deps = allDependencies.get(parentOperation);
          if (deps) {
            deps.add(lastOperation.id);
          }
        }
      }

      // Build dependencies within this method (handling "With Previous")
      const methodDeps = buildOperationDependencies(methodOps);
      for (const [opId, deps] of methodDeps) {
        const existing = allDependencies.get(opId);
        if (existing) {
          for (const depId of deps) {
            existing.add(depId);
          }
        }
      }
    }

    // Delete existing dependencies, preserving rework operation dependencies
    const reworkOpIds = allOperations
      .filter((op) => op.reworkId)
      .map((op) => op.id!);

    const records = dependenciesToRecords(
      allDependencies,
      this.jobId,
      this.companyId
    );

    // Dry-run (expedite what-if) computes the dependency graph in memory but
    // writes nothing. One transaction otherwise: a partial rebuild (edges
    // deleted but not re-inserted) would corrupt the graph for the next run.
    //
    // Rebuild atomically with a per-job advisory lock: two schedule runs for
    // the same job can overlap (an Inngest retry racing a still-running
    // invocation, or a direct functions.invoke alongside the queued one);
    // interleaved delete/insert then violates jobOperationDependency_pk. The
    // lock serializes the rebuild per job, and onConflict absorbs any edge that
    // survives a race with trigger-rework's inserts.
    if (this.persist) {
      await this.db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:dependencies:${this.jobId}`}, 0))`.execute(
          trx
        );

        let deleteQuery = trx
          .deleteFrom("jobOperationDependency")
          .where("jobId", "=", this.jobId);

        if (reworkOpIds.length > 0) {
          deleteQuery = deleteQuery
            .where("operationId", "not in", reworkOpIds)
            .where("dependsOnId", "not in", reworkOpIds);
        }

        await deleteQuery.execute();

        if (records.length > 0) {
          await trx
            .insertInto("jobOperationDependency")
            .values(records)
            .onConflict((oc) =>
              oc.columns(["operationId", "dependsOnId"]).doNothing()
            )
            .execute();
        }
      });

      // Update operations with no dependencies to Ready status (outside the
      // rebuild txn so the advisory lock is held only for the delete/insert).
      for (const [opId, deps] of allDependencies) {
        if (deps.size === 0) {
          await this.db
            .updateTable("jobOperation")
            .set({ status: "Ready" })
            .where("id", "=", opId)
            .execute();
        }
      }
    }

    // Store dependencies for date calculation (non-rework edges rebuilt above)
    this.dependencies = records.map((r) => ({
      operationId: r.operationId,
      dependsOnId: r.dependsOnId,
      jobId: r.jobId
    }));

    // Append rework dependency edges so rework ops are correctly scheduled
    if (reworkOpIds.length > 0) {
      const reworkDeps = await this.provider.getReworkDependencies(
        this.jobId,
        reworkOpIds
      );

      for (const d of reworkDeps) {
        this.dependencies.push(d);
      }
    }
  }

  /**
   * Build the working operation map (durations, pins). Placement dates start
   * null and are filled by forward-ASAP placement in selectWorkCenters();
   * a pinned op keeps only its stored dueDate — the need-by target it owns
   * (spec 2026-08-15 dual dates). The backward need-by pass (computeNeedBys)
   * runs separately and never feeds placement. Conflicts are counted after
   * placement, not here.
   */
  async calculateDates(): Promise<void> {
    this.scheduledOperations = buildScheduledOperations(this.operations);
  }

  /**
   * The ONE availability-windows fetch for this run — work-center windows
   * (selection candidates + current assignments) plus the location's default
   * calendar — memoized so the backward need-by pass and buildFiniteContext
   * share the same load instead of reading the provider twice.
   */
  private async loadAvailabilityWindows(): Promise<{
    workCenterIds: Set<string>;
    workCenterAvailability: Map<string, CalendarWindow[]>;
    locationDefaultWindows: CalendarWindow[];
    rangeStart: number;
    rangeEnd: number;
  }> {
    if (this.availabilityWindows) {
      return this.availabilityWindows;
    }

    const operations = Array.from(this.scheduledOperations.values());
    const processIds = Array.from(
      new Set(operations.map((op) => op.processId).filter(Boolean))
    ) as string[];

    // Candidates for selection + current assignments (assigned work centers
    // stay in play via the sticky/fallback rules).
    const workCenterIds = new Set(
      this.workCenterSelector?.getAllCandidateWorkCenterIds(processIds) ?? []
    );
    for (const op of operations) {
      if (op.workCenterId) {
        workCenterIds.add(op.workCenterId);
      }
    }

    const rangeStart = this.now;
    const rangeEnd = this.now + (SCHEDULING_HORIZON_DAYS + 7) * 24 * 3_600_000;

    const [workCenterAvailability, locationDefaultWindows] = await Promise.all([
      this.provider.getWorkCenterAvailability(
        [...workCenterIds],
        rangeStart,
        rangeEnd
      ),
      // People with no employeeShift rows default to the job location's calendar
      // (plant hours), not 24×7 — matching the default machine window so
      // unconfigured labor is non-constraining within plant hours.
      this.job?.locationId
        ? this.provider.getLocationCalendarWindows(
            this.job.locationId,
            rangeStart,
            rangeEnd
          )
        : Promise.resolve<CalendarWindow[]>([
            { start: rangeStart, end: rangeEnd }
          ]) // rangeStart/rangeEnd are epoch-ms
    ]);

    this.availabilityWindows = {
      workCenterIds,
      workCenterAvailability,
      locationDefaultWindows,
      rangeStart,
      rangeEnd
    };
    return this.availabilityWindows;
  }

  /**
   * Backward need-by pass (spec 2026-08-15 dual dates): demand-anchored
   * targets walked back from the job's due date on the same calendar physics
   * as placement (shared windows fetch). The result is persisted to
   * jobOperation.dueDate by persistChanges and read by NOTHING in the
   * placement path — targets are outputs, never constraints.
   */
  private async computeNeedBys(): Promise<void> {
    this.needByByOperation = new Map();
    this.topologicalOrder = [];
    const operations = Array.from(this.scheduledOperations.values());
    if (operations.length === 0) {
      return;
    }

    const { workCenterAvailability, locationDefaultWindows } =
      await this.loadAvailabilityWindows();
    const { calendarHoursPerDay, workingDayTest } = calendarAdapters(
      workCenterAvailability,
      locationDefaultWindows,
      this.job?.timezone ?? "UTC"
    );

    // The graph only reads operation ids — strip the ScheduledOperation-only
    // fields (BaseOperation's optional priority vs the scheduled null).
    const graph = new DependencyGraphImpl(
      operations.map((op) => ({
        id: op.id,
        jobId: op.jobId,
        processId: op.processId
      })),
      this.dependencies
    );

    // Keep the graph's forward order for the behind-target attribution — the
    // one topological order the engine already owns; never invent a new sort.
    this.topologicalOrder = graph.topologicalSort("forward");

    this.needByByOperation = computeNeedByDates({
      operations,
      graph,
      jobDueDate: this.job?.dueDate ?? null,
      calendarHoursPerDay,
      workingDayTest
    });
  }

  /**
   * Build the finite-capacity context: live reservations, per-process ability
   * requirements, and qualified-operator availability. Work centers are
   * finite (capacity 1 — one operation at a time, gated by actual
   * reservations); ability-gated operations additionally wait for a
   * qualified person to be on shift and unreserved. Runs just before
   * selection so the rebuilt dependency DAG is final.
   */
  private async buildFiniteContext(): Promise<FiniteSchedulingContext | null> {
    if (!this.workCenterSelector) {
      return null;
    }

    // The run's single clock (shared across the batch) — never Date.now() here.
    const now = this.now;
    const operations = Array.from(this.scheduledOperations.values());
    const processIds = Array.from(
      new Set(operations.map((op) => op.processId).filter(Boolean))
    ) as string[];

    // One shared windows fetch per run (also used by the need-by pass).
    const {
      workCenterIds,
      workCenterAvailability,
      locationDefaultWindows,
      rangeStart,
      rangeEnd
    } = await this.loadAvailabilityWindows();

    const operationIds = operations
      .map((op) => op.id)
      .filter((id): id is string => Boolean(id));

    const [
      liveReservations,
      processRequirements,
      peopleRows,
      absenceRows,
      operationsWithEvents
    ] = await Promise.all([
      this.provider.getLiveReservations(now, this.excludeJobIds),
      this.provider.getProcessRequirements(processIds),
      this.provider.getPeopleAssignments(rangeStart, rangeEnd, this.timezone),
      this.provider.getPeopleAbsences(rangeStart, rangeEnd, this.timezone),
      this.provider.getOperationsWithEvents(operationIds)
    ]);

    const abilityIds = Array.from(
      new Set(processRequirements.map((r) => r.abilityId))
    );
    const employees = await this.provider.getQualifiedEmployees(abilityIds);
    // People members at ungated stations need real availability windows too, so
    // shift rows are loaded for the union of qualified + assigned people
    const employeeIds = Array.from(
      new Set([
        ...employees.map((e) => e.employeeId),
        ...peopleRows.map((r) => r.employeeId)
      ])
    );
    const shiftRows = await this.provider.getEmployeeShiftWindows(employeeIds);

    // Work centers: capacity 1, open per the availability ladder (explicit
    // workCenterShift rows → location shifts → stock Mon–Fri 8h, or one open
    // window for an alwaysOn machine). Reservations GATE placement (one op at a
    // time) and feed attribution. A WC with no resolved windows (e.g. deleted)
    // schedules nothing and surfaces a conflict.
    // Require-staffing policy (per-location) + which stations are lights-out —
    // both feed the selector's fallback gates. One cached read each per batch.
    const [requiresStaffing, alwaysOnWorkCenterIds] = await Promise.all([
      this.job?.locationId
        ? this.provider.getLocationRequiresStaffing(this.job.locationId)
        : Promise.resolve(false),
      this.provider.getAlwaysOnWorkCenterIds(Array.from(workCenterIds))
    ]);

    const capacityByWorkCenter = new Map<string, ResourceCapacityData>();
    for (const wcId of workCenterIds) {
      capacityByWorkCenter.set(wcId, {
        workCenter: { id: wcId, alwaysOn: alwaysOnWorkCenterIds.has(wcId) },
        windows: workCenterAvailability.get(wcId) ?? [],
        reservations: liveReservations
          .filter(
            (r) => r.resourceKind === "WorkCenter" && r.resourceId === wcId
          )
          .map((r) => ({
            startAt: r.startAt,
            endAt: r.endAt,
            readableJobId: r.readableJobId
          }))
      });
    }

    const requirementByProcess = new Map(
      processRequirements.map((r) => [
        r.processId,
        { abilityId: r.abilityId, abilityName: r.abilityName }
      ])
    );

    // Each qualified person's availability = their assigned shifts expanded
    // over the horizon (grouped by timezone, unioned). No shift assignment
    // => always available.
    const shiftPatternsByEmployee = new Map<
      string,
      Map<string, CalendarShiftRow[]>
    >();
    for (const row of shiftRows) {
      let byTz = shiftPatternsByEmployee.get(row.employeeId);
      if (!byTz) {
        byTz = new Map();
        shiftPatternsByEmployee.set(row.employeeId, byTz);
      }
      const list = byTz.get(row.timezone) ?? [];
      list.push({
        dayOfWeek: row.dayOfWeek,
        startTime: row.startTime,
        endTime: row.endTime
      });
      byTz.set(row.timezone, list);
    }
    const windowsByEmployee = new Map<string, CalendarWindow[]>();
    for (const [employeeId, byTz] of shiftPatternsByEmployee) {
      const lists = Array.from(byTz.entries()).map(([tz, shifts]) =>
        expandCalendar(shifts, rangeStart, rangeEnd, tz)
      );
      windowsByEmployee.set(employeeId, unionWindows(lists));
    }

    // People with no shift assignment default to the job location's calendar
    // (plant hours, matching the default machine window) — not 24×7 — so
    // unconfigured labor degrades to non-constraining within plant hours.
    // Materialized here so absences/overtime can adjust it too.
    for (const employeeId of employeeIds) {
      if (!windowsByEmployee.has(employeeId)) {
        windowsByEmployee.set(employeeId, locationDefaultWindows);
      }
    }

    const timeZone = this.job?.timezone ?? "UTC";

    // Absences subtract the person's availability on those dates everywhere —
    // people-preferred and qualified-fallback paths alike
    const absentByEmployee = buildAbsencesByEmployee(absenceRows);
    for (const [employeeId, absentDates] of absentByEmployee) {
      const windows = windowsByEmployee.get(employeeId);
      if (windows) {
        windowsByEmployee.set(
          employeeId,
          subtractAbsences(windows, absentDates, timeZone)
        );
      }
    }

    // An absent person is never that day's people
    const presentPeopleRows = peopleRows.filter(
      (row) => !absentByEmployee.get(row.employeeId)?.has(row.date)
    );
    const peopleByWorkCenter = buildPeopleByWorkCenter(presentPeopleRows);
    // Inverted board (employee -> date -> stations) so the any-qualified
    // fallback can tell a manned person is committed elsewhere that day.
    const assignmentsByEmployee =
      buildAssignmentsByEmployee(peopleByWorkCenter);

    // Authorized overtime = a longer day: extend the person's last window on
    // each overtime date so the allocator can pack work into the extra hours
    const overtimeByEmployee = buildOvertimeByEmployee(presentPeopleRows);
    for (const [employeeId, overtimeByDate] of overtimeByEmployee) {
      const windows = windowsByEmployee.get(employeeId);
      if (windows) {
        windowsByEmployee.set(
          employeeId,
          extendWindowsByOvertime(windows, overtimeByDate, timeZone)
        );
      }
    }

    // Split days: each station only gets its budgeted share of the person
    const peopleBudgets = buildPeopleBudgets(presentPeopleRows);

    const employeesByAbility = new Map<string, PoolEmployee[]>();
    for (const e of employees) {
      const list = employeesByAbility.get(e.abilityId) ?? [];
      list.push({
        employeeId: e.employeeId,
        expiresAt: e.expiresAt,
        windows: windowsByEmployee.get(e.employeeId) ?? locationDefaultWindows
      });
      employeesByAbility.set(e.abilityId, list);
    }

    // Named-person bookings across ALL abilities, keyed by employee id.
    // Legacy OperatorPool rows are ignored deliberately: they can't be
    // attributed to a person, and they stop existing after each job's next
    // replan (the reactive stale-wave refreshes everything).
    const reservationsByEmployee = new Map<
      string,
      { startAt: number; endAt: number; readableJobId?: string }[]
    >();
    for (const r of liveReservations) {
      if (r.resourceKind !== "Employee") continue;
      const list = reservationsByEmployee.get(r.resourceId) ?? [];
      list.push({
        startAt: r.startAt,
        endAt: r.endAt,
        readableJobId: r.readableJobId
      });
      reservationsByEmployee.set(r.resourceId, list);
    }

    return {
      capacityByWorkCenter,
      requirementByProcess,
      employeesByAbility,
      reservationsByEmployee,
      peopleByWorkCenter,
      assignmentsByEmployee,
      requiresStaffing,
      peopleBudgets,
      windowsByEmployee,
      dependencies: this.dependencies,
      now,
      horizonDays: SCHEDULING_HORIZON_DAYS,
      windowsEnd: rangeEnd,
      timeZone,
      operationsWithEvents
    };
  }

  /**
   * Select work centers for all operations
   */
  async selectWorkCenters(): Promise<void> {
    if (!this.workCenterSelector) {
      log.warning("Work center selector not initialized", {
        jobId: this.jobId
      });
      return;
    }

    const finiteContext = await this.buildFiniteContext();
    if (finiteContext) {
      this.workCenterSelector.setFiniteContext(finiteContext);
    }

    const operations = Array.from(this.scheduledOperations.values());
    const selections =
      await this.workCenterSelector.selectWorkCentersForOperations(operations, {
        jobDueDate: this.job?.dueDate ?? null
      });

    // Apply selections (placed timestamps → factory-day date columns)
    this.scheduledOperations = applyWorkCenterSelections(
      this.scheduledOperations,
      selections,
      this.job?.timezone ?? "UTC"
    );

    // Track affected work centers
    for (const selection of selections.values()) {
      if (selection.workCenterId) {
        this.affectedWorkCenters.add(selection.workCenterId);
      }
    }

    // Projected completion = the latest finish across ALL of this run's
    // placements: selection.placedEnd covers regular, pinned, and
    // outside-processing ops (pins place normally now); the planned
    // reservations are a belt-and-braces union over the same placements.
    let maxEndMs: number | null = null;
    const bump = (ms: number) => {
      if (maxEndMs === null || ms > maxEndMs) maxEndMs = ms;
    };
    for (const selection of selections.values()) {
      if (selection.placedEnd) bump(toInstantMs(selection.placedEnd));
    }
    for (const p of this.workCenterSelector.getPlannedReservations()) {
      if (p.endAt > p.startAt) bump(p.endAt);
    }
    this.projectedCompletionAt =
      maxEndMs === null ? null : msToInstantIso(maxEndMs);

    // Recount conflicts — finite allocation may add or resolve them
    this.conflictsDetected = 0;
    for (const op of this.scheduledOperations.values()) {
      if (op.hasConflict) {
        this.conflictsDetected++;
      }
    }
  }

  /**
   * Calculate priorities for all operations grouped by work center
   */
  /**
   * Per-work-center dispatch sequence = the forward-ASAP placement order
   * (reservation start ascending). One source of truth for what runs next.
   */
  async calculatePriorities(): Promise<void> {
    // Get all operations at affected work centers (not just from this job)
    const workCenterIds = Array.from(this.affectedWorkCenters);

    if (workCenterIds.length === 0) {
      // No work centers affected, just use job-level priorities
      const opsWithInfo: OperationWithJobInfo[] = [];
      for (const op of this.scheduledOperations.values()) {
        opsWithInfo.push(
          toOperationWithJobInfo(
            op,
            this.job?.priority ?? null,
            this.job?.deadlineType ?? null
          )
        );
      }

      const priorities = calculatePrioritiesByWorkCenter(opsWithInfo);
      this.scheduledOperations = applyPriorities(
        this.scheduledOperations,
        priorities
      );
      return;
    }

    // Get all active operations at affected work centers from OTHER jobs
    // (current job's operations aren't in DB yet with their new work centers)
    const allWcOps =
      await this.provider.getCrossJobOperationsAtWorkCenters(workCenterIds);

    // Build a set of operation IDs from the database query
    const dbOpIds = new Set(allWcOps.map((op) => op.id).filter(Boolean));

    // Dispatch-rule inputs: FIFO keys on createdAt, SPT/WSPT/CR/MinSlack on
    // durationHours — without them every rule silently degrades to the
    // legacy tie-break chain
    const toIsoOrNull = (value: Date | string | null | undefined) =>
      value ? toInstantIso(value) : null;

    // Start with operations from DB (other jobs at same work centers)
    const mergedOps: OperationWithJobInfo[] = allWcOps
      .filter((wcOp) => wcOp.id)
      .map((wcOp) => {
        const scheduled = this.scheduledOperations.get(wcOp.id!);
        if (scheduled) {
          // This is an operation from current job that was already in DB
          // (reschedule case) - use the newly calculated dates
          return {
            id: scheduled.id,
            dueDate: scheduled.dueDate ?? null,
            startDate: scheduled.startDate ?? null,
            priority: scheduled.priority,
            deadlineType: wcOp.deadlineType ?? "No Deadline",
            jobPriority: wcOp.jobPriority ?? 99,
            workCenterId: scheduled.workCenterId ?? null,
            durationHours: scheduled.durationHours ?? null,
            createdAt: toIsoOrNull(wcOp.createdAt)
          };
        }
        // Operation from another job - use DB data
        return {
          id: wcOp.id!,
          dueDate: wcOp.dueDate ?? null,
          startDate: wcOp.startDate ?? null,
          priority: wcOp.priority ?? 1,
          deadlineType: wcOp.deadlineType ?? "No Deadline",
          jobPriority: wcOp.jobPriority ?? 99,
          workCenterId: wcOp.workCenterId ?? null,
          durationHours: calculateDurationHours({
            jobId: "",
            processId: null,
            setupTime: wcOp.setupTime ?? undefined,
            setupUnit: wcOp.setupUnit ?? undefined,
            laborTime: wcOp.laborTime ?? undefined,
            laborUnit: wcOp.laborUnit ?? undefined,
            machineTime: wcOp.machineTime ?? undefined,
            machineUnit: wcOp.machineUnit ?? undefined,
            operationQuantity: wcOp.operationQuantity
          }),
          createdAt: toIsoOrNull(wcOp.createdAt)
        };
      });

    // Add current job's scheduled operations that aren't in DB yet
    // (their workCenterId was just assigned in memory)
    for (const op of this.scheduledOperations.values()) {
      if (!dbOpIds.has(op.id) && op.workCenterId) {
        mergedOps.push({
          id: op.id,
          dueDate: op.dueDate ?? null,
          startDate: op.startDate ?? null,
          priority: op.priority,
          deadlineType:
            op.deadlineType ?? this.job?.deadlineType ?? "No Deadline",
          jobPriority: this.job?.priority ?? 99,
          workCenterId: op.workCenterId,
          durationHours: op.durationHours ?? null,
          createdAt: toIsoOrNull(op.createdAt)
        });
      }
    }

    // Calculate priorities
    const priorities = calculatePrioritiesByWorkCenter(mergedOps);

    // Apply to our scheduled operations
    this.scheduledOperations = applyPriorities(
      this.scheduledOperations,
      priorities
    );
  }

  /**
   * Assign unlinked materials to the first operation of their make method
   */
  async assignMaterials(): Promise<void> {
    // Load all operations (including Done) to find first ops correctly
    const allOperations = await this.provider.getOperations(this.jobId, {
      includeDone: true
    });

    // Build assembly tree
    const assemblyTree = await this.assemblyHandler.buildAssemblyTree(
      this.jobId
    );
    if (!assemblyTree) {
      return;
    }

    // Get all jobMakeMethodIds
    const makeMethodIds =
      this.assemblyHandler.getAllJobMakeMethodIds(assemblyTree);

    // Get materials that need assignment
    const materials = await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobMakeMethodId", "in", makeMethodIds)
      .where("methodType", "=", "Make to Order")
      .where("jobOperationId", "is", null)
      .execute();

    // Group non-rework operations by jobMakeMethodId
    const operationsByMethod = new Map<string, BaseOperation[]>();
    for (const op of allOperations) {
      if (op.jobMakeMethodId && !op.reworkId) {
        if (!operationsByMethod.has(op.jobMakeMethodId)) {
          operationsByMethod.set(op.jobMakeMethodId, []);
        }
        operationsByMethod.get(op.jobMakeMethodId)!.push(op);
      }
    }

    // Assign first operation of each method to its materials
    for (const material of materials) {
      if (!material.jobMakeMethodId) continue;

      const methodOps = operationsByMethod.get(material.jobMakeMethodId) ?? [];
      const sortedOps = [...methodOps].sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0)
      );
      const firstOp = sortedOps[0];

      // Dry-run writes nothing (expedite what-if).
      if (firstOp?.id && this.persist) {
        await this.db
          .updateTable("jobMaterial")
          .set({ jobOperationId: firstOp.id })
          .where("id", "=", material.id)
          .execute();
      }
    }
  }

  /**
   * Persist all changes to the database
   */
  async persistChanges(): Promise<void> {
    // Zero-duration operations (all times = 0) place a start === end slot,
    // which occupies no capacity and violates the endAt > startAt check.
    const planned = (
      this.workCenterSelector?.getPlannedReservations() ?? []
    ).filter((p) => p.endAt > p.startAt);

    // Newly-late = the job WAS on time (or unforecast) and its new projected
    // business day now exceeds the due date. Edge-triggered by construction, so
    // a second identical regen produces no entry. Jobs with no due date are
    // never late. Computed on the FACTORY calendar (location tz).
    const dueDate = this.job?.dueDate ?? null;
    const tz = this.job?.timezone ?? "UTC";
    if (dueDate && this.projectedCompletionAt) {
      const priorProjected = this.job?.projectedCompletionAt ?? null;
      const newBusinessDay = businessDay(this.projectedCompletionAt, tz);
      const priorBusinessDay = priorProjected
        ? businessDay(priorProjected, tz)
        : null;
      const wasOnTime =
        priorBusinessDay === null || priorBusinessDay <= dueDate;
      this.newlyLate = wasOnTime && newBusinessDay > dueDate;
    } else {
      this.newlyLate = false;
    }

    // One transaction: a partial write (reservations deleted but not
    // re-inserted) would free this job's capacity to other jobs' replans
    // while its operations already carry the new plan.
    await this.db.transaction().execute(async (trx) => {
      for (const op of this.scheduledOperations.values()) {
        const originalOp = this.operations.find((o) => o.id === op.id);
        const isManuallyScheduled = originalOp?.manuallyScheduled ?? false;
        // Never clobber a work center the user (or method) already set.
        // Auto-selection may only fill null/empty work centers.
        const originalWorkCenterId = originalOp?.workCenterId;
        const workCenterId =
          originalWorkCenterId != null && originalWorkCenterId !== ""
            ? originalWorkCenterId
            : op.workCenterId;

        // dueDate is the backward need-by target and is DIFF-written: only
        // when the computed value differs from the stored one (a quiet regen
        // touches zero dueDate values), and never for a pinned op —
        // manuallyScheduled means a human owns that target. The forward
        // results (startDate day + projectedCompletionAt instant) are written
        // for every op.
        const needBy = this.needByByOperation.get(op.id) ?? null;
        const storedDueDate = toIsoDate(originalOp?.dueDate ?? null);
        const writeDueDate = !isManuallyScheduled && needBy !== storedDueDate;

        await trx
          .updateTable("jobOperation")
          .set({
            startDate: op.startDate,
            projectedCompletionAt: op.projectedCompletionAt ?? null,
            ...(writeDueDate ? { dueDate: needBy } : {}),
            priority: op.priority ?? undefined,
            workCenterId,
            hasConflict: op.hasConflict,
            conflictReason: op.conflictReason,
            updatedAt: datetime.timestamp(),
            updatedBy: this.userId
          })
          .where("id", "=", op.id)
          .execute();
      }

      // Rebuild this job's live capacity reservations from this run's
      // placements (reservations are authoritative across jobs and runs)
      await trx
        .deleteFrom("capacityReservation")
        .where("jobId", "=", this.jobId)
        .where("companyId", "=", this.companyId)
        .where("scenarioId", "is", null)
        .execute();

      if (planned.length > 0) {
        await trx
          .insertInto("capacityReservation")
          .values(
            planned.map((p) => ({
              resourceKind: p.resourceKind,
              resourceId: p.resourceId,
              operationId: p.operationId,
              jobId: this.jobId,
              companyId: this.companyId,
              startAt: msToInstantIso(p.startAt),
              endAt: msToInstantIso(p.endAt),
              earliestStartAt:
                p.earliestStartAt !== undefined
                  ? msToInstantIso(p.earliestStartAt)
                  : null,
              scheduleNote: p.scheduleNote ?? null,
              workHours: p.workHours ?? null,
              isPlaceholder: p.isPlaceholder ?? false,
              createdBy: this.userId
            }))
          )
          .execute();
      }

      // Write the forecast and clear the stale-schedule stamps for this job in
      // the SAME transaction. The scheduler is status-neutral: it forecasts and
      // reserves capacity for jobs already released (Ready/In Progress/Paused).
      // Releasing a job to Ready is the app's job-status flow (which raises
      // jobReleased), never a side effect of scheduling.
      await trx
        .updateTable("job")
        .set({
          projectedCompletionAt: this.projectedCompletionAt,
          scheduleOutdatedReason: null,
          scheduleOutdatedAt: null,
          updatedAt: datetime.timestamp(),
          updatedBy: this.userId
        })
        .where("id", "=", this.jobId)
        .where("companyId", "=", this.companyId)
        .execute();
    });

    this.reservationsWritten = planned.length;
  }

  /**
   * Get the scheduling result
   */
  getResult(): SchedulingResult {
    return {
      success: true,
      operationsScheduled: this.scheduledOperations.size,
      conflictsDetected: this.conflictsDetected,
      workCentersAffected: Array.from(this.affectedWorkCenters),
      assemblyDepth: this.assemblyDepth,
      reservationsWritten: this.reservationsWritten
    };
  }

  /** Forecast finish (max placed end) after a run; null when no operations. */
  getProjectedCompletionAt(): string | null {
    return this.projectedCompletionAt;
  }

  /** True when this run flipped the job on-time (or unforecast) → late. */
  isNewlyLate(): boolean {
    return this.newlyLate;
  }

  getReadableJobId(): string | null {
    return this.job?.readableJobId ?? null;
  }

  getAssignee(): string | null {
    return this.job?.assignee ?? null;
  }

  /**
   * Job-level behind-target attribution (spec 2026-08-15 dual dates). Only
   * when the JOB's verdict is late — the same judgment persistChanges uses
   * for newly-late: projected finish past the due date on the FACTORY
   * calendar — walk the operations in topological order and name the first
   * one whose projected finish misses its backward need-by target. Purely
   * informational: it rides the job-level cause sentence and never sets
   * per-op conflicts (targets are outputs, not constraints).
   */
  private composeBehindTargetSentence(): string | null {
    const dueDate = this.job?.dueDate ?? null;
    if (!dueDate || !this.projectedCompletionAt) return null;
    const tz = this.job?.timezone ?? "UTC";
    if (businessDay(this.projectedCompletionAt, tz) <= dueDate) return null;

    const operations: BehindTargetOperation[] = [];
    for (const opId of this.topologicalOrder) {
      const op = this.scheduledOperations.get(opId);
      if (!op) continue;
      operations.push({
        description: op.description ?? null,
        needBy: this.needByByOperation.get(opId) ?? null,
        projectedCompletionAt: op.projectedCompletionAt ?? null
      });
    }
    return composeBehindTarget(operations, tz);
  }

  /**
   * The binding-resource explanation for this job's timing — the first
   * conflict reason if any, else the first placement's schedule note. Feeds the
   * expedite "best case" bottleneck sentence. When the job's verdict is late,
   * the behind-target attribution ("First behind target: …") is appended so
   * the sentence also names WHERE the plan first falls behind its targets.
   */
  getCause(): string | null {
    let cause: string | null = null;
    for (const op of this.scheduledOperations.values()) {
      if (op.hasConflict && op.conflictReason) {
        cause = op.conflictReason;
        break;
      }
    }
    if (!cause) {
      for (const p of this.workCenterSelector?.getPlannedReservations() ?? []) {
        if (p.scheduleNote) {
          cause = p.scheduleNote;
          break;
        }
      }
    }
    const behindTarget = this.composeBehindTargetSentence();
    if (!behindTarget) return cause;
    return cause ? `${cause}. ${behindTarget}` : behindTarget;
  }

  /**
   * Run the full scheduling process. When `persist` is false (expedite
   * what-if), everything runs EXCEPT the write — the forecast is computed and
   * returned but nothing touches the database.
   */
  async run(): Promise<SchedulingResult> {
    await this.initialize();

    // Assign materials BEFORE creating dependencies
    // Dependencies require jobMaterial.jobOperationId to be set
    // to link subassembly operations to parent operations
    await this.assignMaterials();
    await this.createDependencies();

    await this.calculateDates();
    // Backward need-by targets BEFORE placement — shares the placement pass's
    // availability windows and influences it in no way (targets are outputs).
    await this.computeNeedBys();
    await this.selectWorkCenters();
    await this.calculatePriorities();

    if (this.persist) {
      await this.persistChanges();
    }

    return this.getResult();
  }
}
