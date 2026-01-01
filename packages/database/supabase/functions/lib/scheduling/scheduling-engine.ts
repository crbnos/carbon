import type SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import type { Database } from "../types.ts";
import {
    AssemblyHandler,
    buildMakeMethodDependencies,
} from "./assembly-handler.ts";
import { calculateOperationDates } from "./date-calculator.ts";
import {
    buildOperationDependencies,
    dependenciesToRecords,
    DependencyGraphImpl,
} from "./dependency-manager.ts";
import { MaterialManager } from "./material-manager.ts";
import {
    applyPriorities,
    calculatePrioritiesByWorkCenter,
    toOperationWithJobInfo,
} from "./priority-calculator.ts";
import type {
    BaseOperation,
    Job,
    JobOperationDependency,
    OperationWithJobInfo,
    ScheduledOperation,
    SchedulingDirection,
    SchedulingMode,
    SchedulingOptions,
    SchedulingResult,
} from "./types.ts";
import {
    applyWorkCenterSelections,
    WorkCenterSelector,
} from "./work-center-selector.ts";

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
  private direction: SchedulingDirection;
  private mode: SchedulingMode;

  private job: Job | null = null;
  private operations: BaseOperation[] = [];
  private dependencies: JobOperationDependency[] = [];
  private scheduledOperations: Map<string, ScheduledOperation> = new Map();
  private affectedWorkCenters: Set<string> = new Set();
  private assemblyDepth: number = 0;
  private conflictsDetected: number = 0;

  private assemblyHandler: AssemblyHandler;
  private workCenterSelector: WorkCenterSelector | null = null;
  private materialManager: MaterialManager;

  constructor(
    options: SchedulingOptions & {
      client: SupabaseClient<Database>;
      db: Kysely<DB>;
    }
  ) {
    this.client = options.client;
    this.db = options.db;
    this.jobId = options.jobId;
    this.companyId = options.companyId;
    this.userId = options.userId;
    this.direction = options.direction;
    this.mode = options.mode;

    this.assemblyHandler = new AssemblyHandler(
      this.client,
      this.db,
      this.companyId
    );
    this.materialManager = new MaterialManager(this.db, this.companyId);
  }

  /**
   * Initialize the engine - load job, operations, and dependencies
   */
  async initialize(): Promise<void> {
    // Load job
    const job = await this.db
      .selectFrom("job")
      .select(["id", "dueDate", "deadlineType", "locationId", "priority"])
      .where("id", "=", this.jobId)
      .executeTakeFirst();

    if (!job) {
      throw new Error(`Job ${this.jobId} not found`);
    }

    this.job = job;

    // Initialize work center selector with location
    if (job.locationId) {
      this.workCenterSelector = new WorkCenterSelector(
        this.db,
        this.companyId,
        job.locationId
      );
      await this.workCenterSelector.initialize();
    }

    // Load operations
    this.operations = (await this.db
      .selectFrom("jobOperation")
      .selectAll()
      .where("jobId", "=", this.jobId)
      .where("status", "not in", ["Done", "Canceled"])
      .orderBy("order")
      .execute()) as BaseOperation[];

    // Load existing dependencies (for reschedule mode)
    if (this.mode === "reschedule") {
      const deps = await this.db
        .selectFrom("jobOperationDependency")
        .selectAll()
        .where("jobId", "=", this.jobId)
        .execute();

      this.dependencies = deps.map((d) => ({
        operationId: d.operationId,
        dependsOnId: d.dependsOnId,
        jobId: d.jobId,
      }));
    }

    // Initialize material manager
    await this.materialManager.initialize(this.jobId);

    // Build assembly tree and get depth
    const assemblyTree = await this.assemblyHandler.buildAssemblyTree(
      this.jobId
    );
    if (assemblyTree) {
      this.assemblyDepth = this.assemblyHandler.getAssemblyDepth(assemblyTree);
    }
  }

  /**
   * Create operation dependencies based on assembly structure
   * Only called in initial scheduling mode
   */
  async createDependencies(): Promise<void> {
    if (this.mode !== "initial") {
      return;
    }

    // Build assembly tree
    const assemblyTree = await this.assemblyHandler.buildAssemblyTree(
      this.jobId
    );
    if (!assemblyTree) {
      console.warn("No assembly tree found for job", this.jobId);
      return;
    }

    // Get all jobMakeMethodIds
    const makeMethodIds =
      this.assemblyHandler.getAllJobMakeMethodIds(assemblyTree);

    // Get job materials for linking
    const jobMaterials = await this.db
      .selectFrom("jobMaterialWithMakeMethodId")
      .selectAll()
      .where("jobMakeMethodId", "in", makeMethodIds)
      .execute();

    // Build map from make method to operation
    const jobMakeMethodToOperationId: Record<string, string | null> = {};
    for (const m of jobMaterials) {
      if (m.jobMaterialMakeMethodId) {
        jobMakeMethodToOperationId[m.jobMaterialMakeMethodId] =
          m.jobOperationId;
      }
    }

    // Group operations by jobMakeMethodId
    const operationsByMethod = new Map<string, BaseOperation[]>();
    for (const op of this.operations) {
      if (op.jobMakeMethodId) {
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

    // Initialize all operations
    for (const op of this.operations) {
      if (op.id) {
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
        const parentOperation = jobMakeMethodToOperationId[methodDep.id];
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

    // Delete existing dependencies
    await this.db
      .deleteFrom("jobOperationDependency")
      .where("jobId", "=", this.jobId)
      .execute();

    // Insert new dependencies
    const records = dependenciesToRecords(
      allDependencies,
      this.jobId,
      this.companyId
    );

    if (records.length > 0) {
      for (const record of records) {
        await this.db
          .insertInto("jobOperationDependency")
          .values(record)
          .execute();
      }
    }

    // Update operations with no dependencies to Ready status
    for (const [opId, deps] of allDependencies) {
      if (deps.size === 0) {
        await this.db
          .updateTable("jobOperation")
          .set({ status: "Ready" })
          .where("id", "=", opId)
          .execute();
      }
    }

    // Store dependencies for date calculation
    this.dependencies = records.map((r) => ({
      operationId: r.operationId,
      dependsOnId: r.dependsOnId,
      jobId: r.jobId,
    }));
  }

  /**
   * Calculate dates for all operations
   */
  async calculateDates(): Promise<void> {
    // Build dependency graph
    const graph = new DependencyGraphImpl(this.operations, this.dependencies);

    // Get anchor date based on direction
    const anchorDate =
      this.direction === "backward" ? this.job?.dueDate ?? null : null; // Forward scheduling would use start date

    // Calculate dates
    this.scheduledOperations = calculateOperationDates(
      this.operations,
      graph,
      anchorDate,
      this.direction
    );

    // Count conflicts
    this.conflictsDetected = 0;
    for (const op of this.scheduledOperations.values()) {
      if (op.hasConflict) {
        this.conflictsDetected++;
      }
    }
  }

  /**
   * Select work centers for all operations
   */
  async selectWorkCenters(): Promise<void> {
    if (!this.workCenterSelector) {
      console.warn("Work center selector not initialized");
      return;
    }

    const operations = Array.from(this.scheduledOperations.values());
    const selections =
      await this.workCenterSelector.selectWorkCentersForOperations(operations);

    // Apply selections
    this.scheduledOperations = applyWorkCenterSelections(
      this.scheduledOperations,
      selections
    );

    // Track affected work centers
    for (const selection of selections.values()) {
      if (selection.workCenterId) {
        this.affectedWorkCenters.add(selection.workCenterId);
      }
    }
  }

  /**
   * Calculate priorities for all operations grouped by work center
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
    const allWcOps = await this.db
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

    // Build a set of operation IDs from the database query
    const dbOpIds = new Set(allWcOps.map((op) => op.id).filter(Boolean));

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
          deadlineType: op.deadlineType ?? this.job?.deadlineType ?? "No Deadline",
          jobPriority: this.job?.priority ?? 99,
          workCenterId: op.workCenterId,
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
   * Assign materials to operations (initial scheduling only)
   */
  async assignMaterials(): Promise<void> {
    if (this.mode !== "initial") {
      return;
    }

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
      .where("methodType", "=", "Make")
      .where("jobOperationId", "is", null)
      .execute();

    // Group operations by jobMakeMethodId
    const operationsByMethod = new Map<string, BaseOperation[]>();
    for (const op of this.operations) {
      if (op.jobMakeMethodId) {
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

      if (firstOp?.id) {
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
    for (const op of this.scheduledOperations.values()) {
      await this.db
        .updateTable("jobOperation")
        .set({
          startDate: op.startDate,
          dueDate: op.dueDate,
          priority: op.priority ?? undefined,
          workCenterId: op.workCenterId,
          hasConflict: op.hasConflict,
          conflictReason: op.conflictReason,
          updatedAt: new Date().toISOString(),
          updatedBy: this.userId,
        })
        .where("id", "=", op.id)
        .execute();
    }

    // Update job status if initial scheduling
    if (this.mode === "initial") {
      await this.db
        .updateTable("job")
        .set({ status: "Ready" })
        .where("id", "=", this.jobId)
        .execute();
    }
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
    };
  }

  /**
   * Run the full scheduling process
   */
  async run(): Promise<SchedulingResult> {
    await this.initialize();

    if (this.mode === "initial") {
      // Assign materials BEFORE creating dependencies
      // Dependencies require jobMaterial.jobOperationId to be set
      // to link subassembly operations to parent operations
      await this.assignMaterials();
      await this.createDependencies();
    }

    await this.calculateDates();
    await this.selectWorkCenters();
    await this.calculatePriorities();

    await this.persistChanges();

    return this.getResult();
  }
}
