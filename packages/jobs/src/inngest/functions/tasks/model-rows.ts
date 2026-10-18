// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { datetime } from "@carbon/utils";
import type { Updateable } from "kysely";
import { getJobDatabaseClient } from "../../../db";

// The model pipeline's row writes. Each is scoped by `companyId` and stamps
// `updatedAt`, which the reaper reads to tell a stuck job from a running one.

type ModelUploadPatch = Omit<
  Updateable<KyselyDatabase["modelUpload"]>,
  "id" | "companyId" | "updatedAt"
>;

type PlanJobStatus = Database["public"]["Enums"]["modelProcessingStatus"];

type PlanJobPatch = Omit<
  Updateable<KyselyDatabase["assemblyPlanJob"]>,
  "id" | "companyId" | "updatedAt"
>;

export type ModelUploadRow = {
  id: string;
  companyId: string;
  modelPath: string;
  originalPath: string | null;
  size: number | null;
  originalSize: number | null;
  optimizeStatus: Database["public"]["Enums"]["modelProcessingStatus"] | null;
  optimizedModelPath: string | null;
  glbPath: string | null;
  graphPath: string | null;
  thumbnailPath: string | null;
};

export async function getModelUpload(
  companyId: string,
  modelUploadId: string
): Promise<ModelUploadRow | null> {
  const row = await getJobDatabaseClient()
    .selectFrom("modelUpload")
    .select([
      "id",
      "companyId",
      "modelPath",
      "originalPath",
      "size",
      "originalSize",
      "optimizeStatus",
      "optimizedModelPath",
      "glbPath",
      "graphPath",
      "thumbnailPath"
    ])
    .where("id", "=", modelUploadId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return (row as ModelUploadRow | undefined) ?? null;
}

export async function updateModelUpload(
  companyId: string,
  modelUploadId: string,
  patch: ModelUploadPatch
): Promise<void> {
  await getJobDatabaseClient()
    .updateTable("modelUpload")
    .set({ ...patch, updatedAt: datetime.timestamp() })
    .where("id", "=", modelUploadId)
    .where("companyId", "=", companyId)
    .execute();
}

/** Update plan jobs of one model, narrowed by id, kind and current status. */
export async function updatePlanJobs(
  companyId: string,
  where: {
    id?: string;
    modelUploadId?: string;
    kind?: "convert" | "plan";
    statuses?: PlanJobStatus[];
  },
  patch: PlanJobPatch
): Promise<number> {
  let query = getJobDatabaseClient()
    .updateTable("assemblyPlanJob")
    .set({ ...patch, updatedAt: datetime.timestamp() })
    .where("companyId", "=", companyId);
  if (where.id) query = query.where("id", "=", where.id);
  if (where.modelUploadId) {
    query = query.where("modelUploadId", "=", where.modelUploadId);
  }
  if (where.kind) query = query.where("kind", "=", where.kind);
  if (where.statuses?.length) {
    query = query.where("status", "in", where.statuses);
  }
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export async function insertPlanJob(row: {
  companyId: string;
  modelUploadId: string;
  kind: "convert" | "plan";
  createdBy: string;
}): Promise<string> {
  const inserted = await getJobDatabaseClient()
    .insertInto("assemblyPlanJob")
    .values({ ...row, status: "Processing" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}
