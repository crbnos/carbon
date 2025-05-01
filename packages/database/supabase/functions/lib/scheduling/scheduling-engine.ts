import { Kysely } from "https://esm.sh/kysely@0.26.3";
import SupabaseClient from "https://esm.sh/v135/@supabase/supabase-js@2.33.1/dist/module/SupabaseClient.d.ts";
import { DB } from "../database.ts";
import { getJobMethodTree, JobMethodTreeItem } from "../methods.ts";
import { Database } from "../types.ts";
import { MaterialManager } from "./material-manager.ts";
import { ResourceManager } from "./resource-manager.ts";
import { BaseOperation, SchedulingStrategy } from "./types.ts";

class SchedulingEngine {
  private client: SupabaseClient<Database>;
  private db: Kysely<DB>;
  private jobId: string;
  private companyId: string;
  private operationsToSchedule: BaseOperation[];
  private operationsByJobMakeMethodId: Record<string, BaseOperation[]>;
  private makeMethodDependencies: {
    id: string;
    parentId: string | null;
  }[];
  private validMaterialIds: string[];

  private resourceManager: ResourceManager;
  private materialManager: MaterialManager;

  constructor({
    client,
    db,
    jobId,
    companyId,
  }: {
    client: SupabaseClient<Database>;
    db: Kysely<DB>;
    jobId: string;
    companyId: string;
  }) {
    this.db = db;
    this.client = client;
    this.companyId = companyId;
    this.jobId = jobId;
    this.operationsToSchedule = [];
    this.operationsByJobMakeMethodId = {};
    this.validMaterialIds = [];
    this.makeMethodDependencies = [];

    this.materialManager = new MaterialManager(db, companyId);
    this.resourceManager = new ResourceManager(db, companyId);
  }

  async initialize(): Promise<void> {
    if (!this.db) {
      throw new Error("Database connection is not initialized");
    }
    await Promise.all([
      this.resourceManager.initialize(this.jobId),
      this.materialManager.initialize(this.jobId),
      this.getOperationsAndMaterialsToSchedule(),
    ]);
  }

  async addDependencies(): Promise<void> {
    const operationDependencies: Record<string, Set<string>> = {};
    const makeMethodIds = [
      ...new Set(this.makeMethodDependencies.map((m) => m.id)),
    ];
    const jobMaterials = await this.db
      .selectFrom("jobMaterialWithMakeMethodId")
      .selectAll()
      .where("jobMakeMethodId", "in", makeMethodIds)
      .execute();

    const jobMakeMethodToOperationId: Record<string, string | null> = {};

    jobMaterials.forEach((m) => {
      if (m.jobMaterialMakeMethodId) {
        jobMakeMethodToOperationId[m.jobMaterialMakeMethodId] =
          m.jobOperationId;
      }
    });

    // Initialize dependencies for all operations
    for (const operation of this.operationsToSchedule) {
      if (!operation.id) continue;
      operationDependencies[operation.id] = new Set<string>();
    }

    for await (const makeMethod of this.makeMethodDependencies) {
      const operations = this.operationsByJobMakeMethodId[makeMethod.id] ?? [];
      const lastOperation = operations[operations.length - 1];

      if (!lastOperation) continue;

      if (makeMethod.id) {
        const parentOperation = jobMakeMethodToOperationId[makeMethod.id];

        if (parentOperation) {
          operationDependencies[parentOperation].add(lastOperation.id!);
        }
      }

      operations.forEach((op, index) => {
        op.order = this.getParallelizedOrder(index, op, operations);
      });
      operations.sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

      // Create a map of operations by order
      const operationsByOrder: Record<number, string[]> = {};
      operations.forEach((op) => {
        if (!op.id) return;
        const order = op.order ?? 0;
        if (!operationsByOrder[order]) {
          operationsByOrder[order] = [];
        }
        operationsByOrder[order].push(op.id);
      });

      // Create dependencies between sequential operations
      const orderKeys = Object.keys(operationsByOrder)
        .map(Number)
        .sort((a, b) => a - b);
      for (let i = 1; i < orderKeys.length; i++) {
        const currentOrderOps = operationsByOrder[orderKeys[i]];
        const previousOrderOps = operationsByOrder[orderKeys[i - 1]];

        // Add all previous order operations as dependencies for current order operations
        currentOrderOps.forEach((opId) => {
          if (!operationDependencies[opId]) {
            operationDependencies[opId] = new Set<string>();
          }
          previousOrderOps.forEach((prevOpId) => {
            operationDependencies[opId].add(prevOpId);
          });
        });
      }
    }

    console.log({ operationDependencies });

    await this.db
      .deleteFrom("jobOperationDependency")
      .where("jobId", "=", this.jobId)
      .execute();

    if (Object.keys(operationDependencies).length > 0) {
      for await (const [operationId, dependencies] of Object.entries(
        operationDependencies
      )) {
        if (dependencies.size > 0) {
          await this.db
            .insertInto("jobOperationDependency")
            .values(
              Array.from(dependencies).map((dependency) => ({
                jobId: this.jobId,
                operationId,
                dependsOnId: dependency,
                companyId: this.companyId,
              }))
            )
            .execute();
        }
      }
    }
  }

  async assign() {
    await this.materialManager.assignOperationsToMaterials(
      this.validMaterialIds,
      this.operationsByJobMakeMethodId
    );
  }

  getParallelizedOrder(index: number, op: BaseOperation, ops: BaseOperation[]) {
    if (op?.operationOrder !== "With Previous") return index + 1;
    // traverse backwards through the list of ops to find the first op that is not "With Previous" and return its index + 1
    for (let i = index - 1; i >= 0; i--) {
      if (ops[i].operationOrder !== "With Previous") {
        return i + 1;
      }
    }

    return 1;
  }

  async prioritize(
    strategy: SchedulingStrategy = SchedulingStrategy.LeastTime
  ): Promise<void> {
    switch (strategy) {
      case SchedulingStrategy.LeastTime: {
        const workCenterUpdates: Record<
          string,
          { workCenterId: string; priority: number }
        > = {};

        if (this.operationsToSchedule.length > 0) {
          for (const operation of this.operationsToSchedule) {
            if (!operation.processId || operation.operationType === "Outside") {
              continue;
            }

            const result =
              operation.workCenterId &&
              this.resourceManager.hasWorkCenter(operation.workCenterId)
                ? this.resourceManager.getPriorityByWorkCenterId(
                    operation.workCenterId
                  )
                : this.resourceManager.getWorkCenterAndPriorityByProcessId(
                    operation.processId
                  );

            console.log(
              `Updating operation ${operation.id} with priority ${result.priority} and work center ${result.workCenter}`
            );

            if (!result.workCenter) {
              console.error("No work center found for operation", operation);
              continue;
            }
            workCenterUpdates[operation.id!] = {
              workCenterId: result.workCenter,
              priority: result.priority,
            };

            this.resourceManager.addOperationToWorkCenter(result.workCenter, {
              ...operation,
              priority: result.priority,
            });
          }
        }

        await this.db.transaction().execute(async (trx) => {
          for await (const [id, { workCenterId, priority }] of Object.entries(
            workCenterUpdates
          )) {
            await trx
              .updateTable("jobOperation")
              .set({
                workCenterId,
                priority,
              })
              .where("id", "=", id)
              .execute();
          }

          trx
            .updateTable("job")
            .set({
              status: "Ready",
            })
            .where("id", "=", this.jobId)
            .execute();
        });
        break;
      }
      default: {
        throw new Error(`Unsupported scheduling strategy: ${strategy}`);
      }
    }
  }

  async getOperationsAndMaterialsToSchedule() {
    if (!this.db) {
      throw new Error("Database connection is not initialized");
    }
    const [jobMakeMethod, operations] = await Promise.all([
      this.db
        .selectFrom("jobMakeMethod")
        .select(["id"])
        .where("jobId", "=", this.jobId)
        .where("parentMaterialId", "is", null)
        .executeTakeFirst(),
      this.db
        .selectFrom("jobOperation")
        .selectAll()
        .where("jobId", "=", this.jobId)
        .where("status", "not in", ["Done", "Canceled"])
        .where("operationType", "not in", ["Outside"])
        .orderBy("order")
        .execute(),
    ]);

    const operationsByJobMakeMethodId = operations.reduce<
      Record<string, BaseOperation[]>
    >((acc, operation) => {
      if (!operation.jobMakeMethodId) return acc;
      if (!acc[operation.jobMakeMethodId]) {
        acc[operation.jobMakeMethodId] = [];
      }
      acc[operation.jobMakeMethodId].push(operation);
      return acc;
    }, {});

    this.operationsByJobMakeMethodId = operationsByJobMakeMethodId;

    if (!jobMakeMethod?.id) {
      throw new Error("Job make method not found");
    }
    const jobMethodTrees = await getJobMethodTree(
      this.client,
      jobMakeMethod.id
    );
    if (jobMethodTrees.error) {
      throw new Error("Job method tree not found");
    }

    const jobMethodTree = jobMethodTrees.data?.[0] as JobMethodTreeItem;
    if (!jobMethodTree) throw new Error("Method tree not found");

    const operationsToSchedule: BaseOperation[] = [];
    const queue: JobMethodTreeItem[] = [jobMethodTree];
    const validMaterialIds: string[] = [];
    const makeMethodDependencies: {
      id: string;
      parentId: string | null;
    }[] = [];

    while (queue.length > 0) {
      const currentNode = queue.shift();
      if (!currentNode) continue;

      const operations =
        operationsByJobMakeMethodId[currentNode.data.jobMaterialMakeMethodId] ||
        [];
      operationsToSchedule.unshift(...operations);

      // Populate makeMethodDependencies
      if (
        currentNode.data.jobMakeMethodId !==
        currentNode.data.jobMaterialMakeMethodId
      ) {
        // Check if this dependency already exists
        const dependencyExists = makeMethodDependencies.some(
          (dep) =>
            dep.id === currentNode.data.jobMaterialMakeMethodId &&
            dep.parentId === currentNode.data.jobMakeMethodId
        );

        if (!dependencyExists && currentNode.data.jobMaterialMakeMethodId) {
          makeMethodDependencies.unshift({
            id: currentNode.data.jobMaterialMakeMethodId,
            parentId: currentNode.data.jobMakeMethodId,
          });
        }
      } else {
        const rootDependencyExists = makeMethodDependencies.some(
          (dep) =>
            dep.id === currentNode.data.jobMaterialMakeMethodId &&
            dep.parentId === null
        );

        if (!rootDependencyExists && currentNode.data.jobMaterialMakeMethodId) {
          makeMethodDependencies.unshift({
            id: currentNode.data.jobMaterialMakeMethodId,
            parentId: null,
          });
        }
      }

      if (!currentNode.data.isRoot && currentNode.data.methodMaterialId) {
        validMaterialIds.push(currentNode.data.methodMaterialId);
      }

      queue.push(...currentNode.children);
    }

    this.operationsToSchedule = operationsToSchedule;
    this.validMaterialIds = validMaterialIds;
    this.makeMethodDependencies = makeMethodDependencies;
  }
}

export { SchedulingEngine };
