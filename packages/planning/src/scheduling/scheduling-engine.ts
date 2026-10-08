// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import type { DB } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import {
  AssemblyHandler,
  buildMakeMethodDependencies
} from "./assembly-handler.ts";
import type { BatchPlacement } from "./batch-scheduler.ts";
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
  type AvailabilityWindows,
  buildFiniteContext,
  loadAvailabilityWindows
} from "./finite-context.ts";
import {
  KyselyMasterDataProvider,
  type MasterDataProvider
} from "./master-data-provider.ts";
import { MaterialManager } from "./material-manager.ts";
import { calendarAdapters, computeNeedByDates } from "./need-by-calculator.ts";
import {
  applyPriorities,
  calculatePrioritiesByWorkCenter,
  toOperationWithJobInfo
} from "./priority-calculator.ts";
import {
  dependencyEdgesEqual,
  type JobWrites,
  type PlacementWrite
} from "./run-overlay.ts";
import type {
  AssemblyNode,
  BaseOperation,
  Job,
  JobOperationDependency,
  OperationWithJobInfo,
  ScheduledOperation,
  SchedulingOptions,
  SchedulingResult
} from "./types.ts";
import { capacityHoldingJobStatuses } from "./types.ts";
import {
  applyWorkCenterSelections,
  type FiniteSchedulingContext,
  WorkCenterSelector
} from "./work-center-selector.ts";

export { SCHEDULING_HORIZON_DAYS } from "./finite-context.ts";

const log = getLogger("planning", "schedule");

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
  private assemblyTree: Promise<AssemblyNode | null> | null = null;
  private allOperations: Promise<BaseOperation[]> | null = null;
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
  /**
   * The engine writes nothing: run() leaves what it wants stored here, and the
   * caller persists it (or, for the expedite what-if, drops it).
   */
  private writes: JobWrites | null = null;
  /** Materials this run puts on an operation: material id → operation id. */
  private materialLinks = new Map<string, string>();
  private dependencyWrite: JobWrites["dependencies"] = null;
  private readyOperationIds: string[] = [];
  /**
   * Job ids whose live reservations to EXCLUDE from the snapshot — the whole
   * batch, so each run sees only non-batch reservations plus the in-run
   * placements of already-run batch jobs. Defaults to just this job.
   */
  private excludeJobIds: string[];
  private batchPlacements: Map<string, BatchPlacement> | null = null;
  /** Forecast finish (max placed end) — set after placement, persisted. */
  private projectedCompletionAt: string | null = null;
  /** True when this regen flipped the job from on-time (or unforecast) to late. */
  private newlyLate = false;
  /**
   * Backward need-by targets per operation id ("YYYY-MM-DD" | null), computed
   * by computeNeedBys() BEFORE placement and read by NOTHING in the placement
   * path — the location write diff-writes them to jobOperation.dueDate
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
  private availabilityWindows: AvailabilityWindows | null = null;

  private provider: MasterDataProvider;

  constructor(
    options: SchedulingOptions & {
      client: SupabaseClient<Database>;
      db: Kysely<DB>;
      provider?: MasterDataProvider;
      /** Shared run clock (epoch-ms); defaults to a fresh clock if omitted. */
      now?: number;
      /** Batch job ids to exclude from the reservation snapshot. */
      excludeJobIds?: string[];
      /**
       * Pre-placed windows for RELEASED-batch member operations (from the
       * batch pre-pass in run-schedule). Members take the window verbatim;
       * their reservations are the pre-pass's coalesced batch rows.
       */
      batchPlacements?: Map<string, BatchPlacement> | null;
    }
  ) {
    this.client = options.client;
    this.db = options.db;
    this.jobId = options.jobId;
    this.companyId = options.companyId;
    this.userId = options.userId;
    this.now = options.now ?? Date.now();
    this.batchPlacements = options.batchPlacements ?? null;
    this.excludeJobIds =
      options.excludeJobIds && options.excludeJobIds.length > 0
        ? options.excludeJobIds
        : [this.jobId];

    this.provider =
      options.provider ??
      new KyselyMasterDataProvider(this.db, this.client, this.companyId);

    this.assemblyHandler = new AssemblyHandler(this.provider);
    this.materialManager = new MaterialManager(this.provider);
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
      ? await this.provider.getLocationTimeZone(job.locationId)
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

    // Load existing dependencies as a starting point; createDependencies()
    // rebuilds the non-rework edges before placement.
    this.dependencies = await this.provider.getDependencies(this.jobId);

    // Initialize material manager
    await this.materialManager.initialize(this.jobId);

    // Assign operations to materials that don't have one.
    if (this.operations.length > 0) {
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
      for (const link of this.materialManager.assignOperationsToMaterials(
        materialIds,
        operationsByJobMakeMethodId
      )) {
        this.materialLinks.set(link.materialId, link.operationId);
      }
    }

    // Build assembly tree and get depth
    const assemblyTree = await this.loadAssemblyTree();
    if (assemblyTree) {
      this.assemblyDepth = this.assemblyHandler.getAssemblyDepth(assemblyTree);
    }
  }

  /**
   * The job's assembly tree and its full operation list are read once per
   * run: nothing in a run changes the method structure or which operations
   * exist, and each read was a round trip per phase per job.
   */
  private loadAssemblyTree(): Promise<AssemblyNode | null> {
    this.assemblyTree ??= this.assemblyHandler.buildAssemblyTree(this.jobId);
    return this.assemblyTree;
  }

  private loadAllOperations(): Promise<BaseOperation[]> {
    this.allOperations ??= this.provider.getOperations(this.jobId, {
      includeDone: true
    });
    return this.allOperations;
  }

  /**
   * Create operation dependencies based on assembly structure.
   * Loads ALL operations (including Done) to build the complete DAG.
   */
  async createDependencies(): Promise<void> {
    // Load all operations for dependency building (not just active ones)
    const allOperations = await this.loadAllOperations();

    // Build assembly tree
    const assemblyTree = await this.loadAssemblyTree();
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
        // A material this run put on an operation is not stored yet.
        jobMakeMethodToOperationId[m.jobMaterialMakeMethodId] =
          m.jobOperationId ??
          (m.id ? this.materialLinks.get(m.id) : undefined) ??
          null;
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

    const reworkOpIds = allOperations
      .filter((op) => op.reworkId)
      .map((op) => op.id!);

    const records = dependenciesToRecords(
      allDependencies,
      this.jobId,
      this.companyId
    );

    // The non-rework edges are rebuilt only when they differ from the stored
    // ones: a routing changes far less often than its schedule does.
    const reworkOps = new Set(reworkOpIds);
    const storedEdges = this.dependencies.filter(
      (d) => !reworkOps.has(d.operationId) && !reworkOps.has(d.dependsOnId)
    );
    this.dependencyWrite = dependencyEdgesEqual(storedEdges, records)
      ? null
      : {
          reworkOpIds,
          edges: records.map((r) => ({
            operationId: r.operationId,
            dependsOnId: r.dependsOnId
          }))
        };

    // Unblock dependency-free operations to Ready. Two guards keep this from
    // RE-OPENING work that is already finished or in flight:
    //
    //  1. Only OPEN jobs. A terminal job (Completed/Closed/Cancelled) or a
    //     pre-release Draft/Planned job is never re-opened by a regen. Open
    //     work is `capacityHoldingJobStatuses`; the batch loader already
    //     filters to these, so this is defense-in-depth for any direct caller.
    //  2. Only resettable operation statuses. Never overwrite an operation
    //     that is Done/Canceled (finished) or In Progress/Paused (running) —
    //     only Ready/Waiting/Todo become Ready. Without this, a first op that
    //     an operator already completed was flipped back to Ready, and because
    //     `is_last_job_operation` requires EVERY op Done, the finished job
    //     could then never auto-complete (it sat stuck as open work).
    const jobIsOpen =
      this.job?.status != null &&
      (capacityHoldingJobStatuses as readonly string[]).includes(
        this.job.status
      );
    if (jobIsOpen) {
      const resettable = new Set(
        allOperations
          .filter(
            (op) =>
              !["Ready", "Done", "Canceled", "In Progress", "Paused"].includes(
                op.status ?? ""
              )
          )
          .map((op) => op.id)
      );
      this.readyOperationIds = [...allDependencies]
        .filter(([opId, deps]) => deps.size === 0 && resettable.has(opId))
        .map(([opId]) => opId);
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
  private async loadAvailabilityWindows(): Promise<AvailabilityWindows> {
    if (this.availabilityWindows) {
      return this.availabilityWindows;
    }
    this.availabilityWindows = await loadAvailabilityWindows({
      provider: this.provider,
      workCenterSelector: this.workCenterSelector,
      operations: Array.from(this.scheduledOperations.values()),
      locationId: this.job?.locationId ?? null,
      now: this.now
    });
    return this.availabilityWindows;
  }

  /**
   * Backward need-by pass (spec 2026-08-15 dual dates): demand-anchored
   * targets walked back from the job's due date on the same calendar physics
   * as placement (shared windows fetch). The result is persisted to
   * jobOperation.dueDate by the location write and read by NOTHING in the
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
    const availability = await this.loadAvailabilityWindows();
    return buildFiniteContext({
      provider: this.provider,
      operations: Array.from(this.scheduledOperations.values()),
      dependencies: this.dependencies,
      availability,
      locationId: this.job?.locationId ?? null,
      timeZone: this.job?.timezone ?? "UTC",
      now: this.now,
      excludeJobIds: this.excludeJobIds
    });
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
        jobDueDate: this.job?.dueDate ?? null,
        batchPlacements: this.batchPlacements
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
            createdAt: toIsoOrNull(wcOp.createdAt),
            projectedCompletionAt: scheduled.projectedCompletionAt ?? null
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
          createdAt: toIsoOrNull(wcOp.createdAt),
          projectedCompletionAt: toIsoOrNull(wcOp.projectedCompletionAt)
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
          createdAt: toIsoOrNull(op.createdAt),
          projectedCompletionAt: op.projectedCompletionAt ?? null
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
    const allOperations = await this.loadAllOperations();

    // Build assembly tree
    const assemblyTree = await this.loadAssemblyTree();
    if (!assemblyTree) {
      return;
    }

    // Get all jobMakeMethodIds
    const makeMethodIds =
      this.assemblyHandler.getAllJobMakeMethodIds(assemblyTree);

    // Materials that still need assignment: the stored ones, less those
    // initialize() already put on an operation in this run.
    const materials = (
      await this.provider.getUnassignedMakeToOrderMaterials(makeMethodIds)
    ).filter((m) => !m.id || !this.materialLinks.has(m.id));

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
      const firstOpId = sortedOps[0]?.id;
      if (!firstOpId || !material.id) continue;
      this.materialLinks.set(material.id, firstOpId);
    }
  }

  /**
   * Collect everything this run wants stored.
   */
  private buildWrites(): void {
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

    const placements: JobWrites["placements"] = [];
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
      // manuallyScheduled means a human owns that target.
      const needBy = this.needByByOperation.get(op.id) ?? null;
      const storedDueDate = toIsoDate(originalOp?.dueDate ?? null);
      const writeDueDate = !isManuallyScheduled && needBy !== storedDueDate;

      const placement: PlacementWrite = {
        startDate: op.startDate,
        projectedCompletionAt: op.projectedCompletionAt ?? null,
        ...(writeDueDate ? { dueDate: needBy } : {}),
        ...(op.priority != null ? { priority: op.priority } : {}),
        workCenterId,
        hasConflict: op.hasConflict,
        conflictReason: op.conflictReason
      };
      placements.push({ id: op.id, placement });
    }

    this.writes = {
      jobId: this.jobId,
      jobStatus: this.job?.status ?? null,
      materialLinks: [...this.materialLinks].map(
        ([materialId, jobOperationId]) => ({ materialId, jobOperationId })
      ),
      dependencies: this.dependencyWrite,
      readyOperationIds: this.readyOperationIds,
      placements,
      reservations: planned,
      projectedCompletionAt: this.projectedCompletionAt
    };
    this.reservationsWritten = planned.length;
  }

  /** What this run wants stored; available after run(). */
  getWrites(): JobWrites {
    if (!this.writes) throw new Error("getWrites() called before run()");
    return this.writes;
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
   * when the JOB's verdict is late — the same judgment buildWrites uses
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
   * Run the full scheduling process. Nothing is written: the forecast is
   * computed in memory and the caller stores getWrites() — or does not (the
   * expedite what-if).
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

    this.buildWrites();

    return this.getResult();
  }
}
