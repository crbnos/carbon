// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MasterDataProvider } from "./master-data-provider.ts";
import type { BaseOperation } from "./types.ts";

class MaterialManager {
  private provider: MasterDataProvider;
  private materialsWithoutOperations: {
    id: string;
    jobMakeMethodId: string;
  }[] = [];

  constructor(provider: MasterDataProvider) {
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

  /** Each unlinked material, paired with the first operation of its method. */
  assignOperationsToMaterials(
    validMaterialIds: string[],
    operationsByJobMakeMethodId: Record<string, BaseOperation[]>
  ): { materialId: string; operationId: string }[] {
    const valid = new Set(validMaterialIds);
    const updates: { materialId: string; operationId: string }[] = [];

    for (const material of this.materialsWithoutOperations) {
      if (!valid.has(material.id)) continue;

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

    return updates;
  }

  getMaterialIds(): string[] {
    return this.materialsWithoutOperations.map((m) => m.id);
  }
}

export { MaterialManager };
