// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ASSEMBLY_INSTRUCTIONS_PAGING,
  getAssemblyInstructionsPage,
  getJobOperationBatches,
  getJobs,
  getProcedures,
  getScrapReasons,
  JOB_OPERATION_BATCHES_PAGING,
  JOBS_PAGING,
  PROCEDURES_PAGING,
  SCRAP_REASONS_PAGING
} from "~/modules/production";
import { JOB_LIST_EXPORT_VALUES } from "~/modules/production/ui/Jobs/job-list-export";
import { withExportValues } from "./export-values";
import type { ListDefinition, ListRowsContext } from "./index.server";
import { searchList } from "./index.server";

/**
 * The live batches and the tracked entity of each job: the jobs view has
 * neither. The loader adds them to every page (`mapRows`); the background
 * export adds them through `exportRows`.
 */
export async function withJobListExtras<
  T extends { id: string | null; jobMakeMethodId: string | null }
>(jobs: T[], { client, companyId }: ListRowsContext) {
  const jobIds = jobs.map((job) => job.id!).filter(Boolean);
  const makeMethodIds = jobs
    .map((job) => job.jobMakeMethodId)
    .filter((id): id is string => !!id);
  const [batchedOps, trackedEntities] = await Promise.all([
    // The jobs view carries no batch column (batching is per operation),
    // so one lookup finds the live (Active/Completing) batches of each job.
    jobIds.length > 0
      ? client
          .from("jobOperation")
          .select("jobId, jobOperationBatch(id, readableId, status)")
          .in("jobId", jobIds)
          .eq("companyId", companyId)
          .not("jobOperationBatchId", "is", null)
      : { data: [] },
    makeMethodIds.length > 0
      ? client
          .from("trackedEntity")
          .select("readableId, attributes")
          .in("attributes->>Job Make Method", makeMethodIds)
          .eq("companyId", companyId)
      : { data: [] }
  ]);

  const batchesByJobId: Record<string, string[]> = {};
  for (const op of batchedOps.data ?? []) {
    const batch = op.jobOperationBatch;
    if (!batch || (batch.status !== "Active" && batch.status !== "Completing"))
      continue;
    if (!op.jobId || !batch.readableId) continue;
    const list = (batchesByJobId[op.jobId] ??= []);
    if (!list.includes(batch.readableId)) list.push(batch.readableId);
  }

  const trackedEntityByMakeMethodId: Record<string, string> = {};
  for (const entity of trackedEntities.data ?? []) {
    const makeMethodId = readJobMakeMethodId(entity.attributes);
    if (makeMethodId && entity.readableId) {
      trackedEntityByMakeMethodId[makeMethodId] = entity.readableId;
    }
  }

  return jobs.map((job) => ({
    ...job,
    batchReadableIds: (job.id && batchesByJobId[job.id]) || [],
    trackedEntityReadableId:
      (job.jobMakeMethodId &&
        trackedEntityByMakeMethodId[job.jobMakeMethodId]) ||
      null
  }));
}

function readJobMakeMethodId(attributes: unknown): string | null {
  if (!attributes || typeof attributes !== "object") return null;
  const value = (attributes as Record<string, unknown>)["Job Make Method"];
  return typeof value === "string" ? value : null;
}

export const jobsList = searchList({
  key: "jobs",
  permission: { view: "production", role: "employee" },
  paging: JOBS_PAGING,
  service: getJobs,
  exportRows: async (rows, context) =>
    withExportValues(
      await withJobListExtras(rows, context),
      JOB_LIST_EXPORT_VALUES
    )
});

export const assemblyInstructionsList = {
  key: "assembly-instructions",
  permission: { view: "production", role: "employee" },
  ...ASSEMBLY_INSTRUCTIONS_PAGING,
  query: (client, companyId, { params, limit, cursor, sorts, filters }) =>
    getAssemblyInstructionsPage(client, {
      companyId,
      search: params.get("search") ?? undefined,
      limit,
      cursor,
      sorts,
      filters
    })
} satisfies ListDefinition;

export const operationBatchesList = searchList({
  key: "operation-batches",
  permission: { view: "production", role: "employee" },
  paging: JOB_OPERATION_BATCHES_PAGING,
  service: getJobOperationBatches
});

export const proceduresList = searchList({
  key: "procedures",
  permission: { view: "production", role: "employee" },
  paging: PROCEDURES_PAGING,
  service: getProcedures
});

export const scrapReasonsList = searchList({
  key: "scrap-reasons",
  permission: { view: "production", role: "employee" },
  paging: SCRAP_REASONS_PAGING,
  service: getScrapReasons
});

export const productionLists: Record<string, ListDefinition> = {
  [jobsList.key]: jobsList,
  [assemblyInstructionsList.key]: assemblyInstructionsList,
  [operationBatchesList.key]: operationBatchesList,
  [proceduresList.key]: proceduresList,
  [scrapReasonsList.key]: scrapReasonsList
};
