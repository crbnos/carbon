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
  private operationsToSchedule: BaseOperation[];
  private operationsByJobMakeMethodId: Record<string, BaseOperation[]>;
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

    this.jobId = jobId;
    this.operationsToSchedule = [];
    this.operationsByJobMakeMethodId = {};
    this.validMaterialIds = [];

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

  async addDependencies() {
    console.log({
      operationsToSchedule: this.operationsToSchedule,
      operationsByJobMakeMethodId: this.operationsByJobMakeMethodId,
    });
  }

  async assign() {
    await this.materialManager.assignOperationsToMaterials(
      this.validMaterialIds,
      this.operationsByJobMakeMethodId
    );
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

    while (queue.length > 0) {
      const currentNode = queue.shift();
      if (!currentNode) continue;

      const operations =
        operationsByJobMakeMethodId[currentNode.data.jobMaterialMakeMethodId] ||
        [];
      operationsToSchedule.unshift(...operations);

      if (!currentNode.data.isRoot && currentNode.data.methodMaterialId) {
        validMaterialIds.push(currentNode.data.methodMaterialId);
      }

      queue.push(...currentNode.children);
    }

    this.operationsToSchedule = operationsToSchedule;
    this.validMaterialIds = validMaterialIds;
  }
}

export { SchedulingEngine };
