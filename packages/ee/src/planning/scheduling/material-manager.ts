import type { DB } from "@carbon/database/client";
import type { Kysely } from "kysely";
import type { MasterDataProvider } from "./master-data-provider.ts";
import type { BaseOperation } from "./types.ts";

class MaterialManager {
  private db: Kysely<DB>;
  private provider: MasterDataProvider;
  private materialsWithoutOperations: {
    id: string;
    jobMakeMethodId: string;
  }[] = [];

  constructor(db: Kysely<DB>, provider: MasterDataProvider) {
    this.db = db;
    this.provider = provider;
    this.materialsWithoutOperations = [];
  }

  async initialize(jobId: string) {
    const materialsWithoutOperations =
      await this.provider.getUnlinkedMaterials(jobId);

    this.materialsWithoutOperations = materialsWithoutOperations.reduce<
      { id: string; jobMakeMethodId: string }[]
    >((acc, material) => {
      if (material.id) {
        acc.push({
          id: material.id,
          jobMakeMethodId: material.jobMakeMethodId
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
          operationId: firstOperation.id
        });
      }
    }

    if (updates.length > 0) {
      for await (const update of updates) {
        await this.db
          .updateTable("jobMaterial")
          .set({
            jobOperationId: update.operationId
          })
          .where("id", "=", update.materialId)
          .execute();
      }
    }
  }

  getMaterialIds(): string[] {
    return this.materialsWithoutOperations.map((m) => m.id);
  }
}

export { MaterialManager };
