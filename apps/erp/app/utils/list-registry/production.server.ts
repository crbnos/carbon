// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllByIds } from "@carbon/database";
import {
  ASSEMBLY_INSTRUCTIONS_PAGING,
  getAssemblyInstructionsPage,
  getJobOperationBatches,
  getJobOperationBatchMemberStats,
  getJobOperationBatchMembers,
  getJobs,
  getProcedures,
  getScrapReasons,
  JOB_OPERATION_BATCHES_PAGING,
  JOBS_PAGING,
  PROCEDURES_PAGING,
  SCRAP_REASONS_PAGING
} from "~/modules/production/production.service";
import { BATCH_LIST_EXPORT_VALUES } from "~/modules/production/ui/Batches/batch-list-export";
import { JOB_LIST_EXPORT_VALUES } from "~/modules/production/ui/Jobs/job-list-export";
import type { ListDefinition, ListRowsContext } from "./index.server";
import { searchList } from "./index.server";

/** The live batches and the tracked entity of each job: the jobs view has
 *  neither. */
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
    fetchAllByIds(jobIds, (batch) =>
      client
        .from("jobOperation")
        .select("jobId, jobOperationBatch(id, readableId, status)")
        .in("jobId", batch)
        .eq("companyId", companyId)
        .not("jobOperationBatchId", "is", null)
        .order("id", { ascending: true })
    ),
    fetchAllByIds(makeMethodIds, (batch) =>
      client
        .from("trackedEntity")
        .select("readableId, attributes")
        .in("attributes->>Job Make Method", batch)
        .eq("companyId", companyId)
        .order("id", { ascending: true })
    )
  ]);
  // A failed lookup fails the page: a blank Batches or Tracking column would
  // read as "none".
  if (batchedOps.error) throw batchedOps.error;
  if (trackedEntities.error) throw trackedEntities.error;

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
  rows: withJobListExtras,
  exportValues: JOB_LIST_EXPORT_VALUES
});

export const assemblyInstructionsList = {
  key: "assembly-instructions",
  permission: { view: "production", role: "employee" },
  ...ASSEMBLY_INSTRUCTIONS_PAGING,
  query: (
    client,
    companyId,
    { params, limit, cursor, exactCount, sorts, filters }
  ) =>
    getAssemblyInstructionsPage(client, {
      companyId,
      search: params.get("search") ?? undefined,
      limit,
      cursor,
      exactCount,
      sorts,
      filters
    })
} satisfies ListDefinition;

/**
 * Each batch's member count, summed quantity, work center and member rows
 * (for the expandable sub-list): the batches view has none of them.
 */
async function withBatchListExtras<
  T extends { id: string; workCenter: { name: string | null } | null }
>(batches: T[], { client, companyId }: ListRowsContext) {
  const batchIds = batches.map((batch) => batch.id);
  const [stats, members] = await Promise.all([
    getJobOperationBatchMemberStats(client, companyId, batchIds),
    getJobOperationBatchMembers(client, companyId, batchIds)
  ]);
  if (stats.error) throw stats.error;
  if (members.error) throw members.error;
  return batches.map((batch) => ({
    ...batch,
    memberCount: stats.data[batch.id]?.memberCount ?? 0,
    totalQuantity: stats.data[batch.id]?.totalQuantity ?? 0,
    // The header work center when assigned, else the members' shared one
    // (the board's own fallback): a board-created batch has no header work
    // center until its card is dragged.
    workCenterName:
      batch.workCenter?.name ?? stats.data[batch.id]?.workCenterName ?? null,
    members: members.data[batch.id] ?? []
  }));
}

export const operationBatchesList = searchList({
  key: "operation-batches",
  permission: { view: "production", role: "employee" },
  paging: JOB_OPERATION_BATCHES_PAGING,
  service: getJobOperationBatches,
  rows: withBatchListExtras,
  exportValues: BATCH_LIST_EXPORT_VALUES
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
