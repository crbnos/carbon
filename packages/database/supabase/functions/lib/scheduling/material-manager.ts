import { Kysely } from "https://esm.sh/kysely@0.26.3";

import { DB } from "../database.ts";
import { BaseOperation } from "./types.ts";

class MaterialManager {
  private db: Kysely<DB>;
  private companyId: string;
  private materialsWithoutOperations: {
    id: string;
    jobMakeMethodId: string;
  }[] = [];

  constructor(db: Kysely<DB>, companyId: string) {
    this.db = db;
    this.companyId = companyId;
    this.materialsWithoutOperations = [];
  }

  async initialize(jobId: string) {
    const materialsWithoutOperations = await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobId", "=", jobId)
      .where("jobOperationId", "is", null)
      .execute();

    this.materialsWithoutOperations = materialsWithoutOperations.reduce<
      { id: string; jobMakeMethodId: string }[]
    >((acc, material) => {
      if (material.id) {
        acc.push({
          id: material.id,
          jobMakeMethodId: material.jobMakeMethodId,
        });
      }
      return acc;
    }, []);
  }

  async assignOperationsToMaterials(
    validMaterialIds: string[],
    operationsByJobMakeMethodId: Record<string, BaseOperation[]>
  ) {
    const updates: { materialId: string; operationId: string }[] = [];

    for await (const material of this.materialsWithoutOperations) {
      if (!validMaterialIds.includes(material.id)) {
        continue;
      }

      const operations =
        operationsByJobMakeMethodId[material.jobMakeMethodId] || [];
      const firstOperation = operations[0];

      if (firstOperation?.id) {
        updates.push({
          materialId: material.id,
          operationId: firstOperation.id,
        });
      }
    }

    if (updates.length > 0) {
      for await (const update of updates) {
        await this.db
          .updateTable("jobMaterial")
          .set({
            jobOperationId: update.operationId,
          })
          .where("id", "=", update.materialId)
          .execute();
      }
    }
  }
}

export { MaterialManager };
