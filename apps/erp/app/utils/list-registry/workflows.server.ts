// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { WORKFLOW_RUN_LIST_EXPORT_VALUES } from "~/modules/workflows/ui/Runs/workflow-run-list-export";
import { WORKFLOW_LIST_EXPORT_VALUES } from "~/modules/workflows/ui/workflow-list-export";
import type { WorkflowLastRun } from "~/modules/workflows/workflows.service";
import {
  getWorkflowLastRuns,
  getWorkflowRunRecordNames,
  getWorkflowRuns,
  getWorkflows,
  getWorkflowVersionNumbers,
  WORKFLOW_RUNS_PAGING,
  WORKFLOWS_PAGING
} from "~/modules/workflows/workflows.service";
import type { ListDefinition, ListRowsContext } from "./index.server";
import { searchList } from "./index.server";

/** The published version number and the last run of each workflow. */
export async function withWorkflowListExtras<
  T extends { id: string; publishedVersionId: string | null }
>(rows: T[], { client, companyId }: ListRowsContext) {
  const publishedVersionIds = rows
    .map((row) => row.publishedVersionId)
    .filter((id): id is string => id !== null);
  const workflowIds = rows.map((row) => row.id);
  const [versions, runs] = await Promise.all([
    publishedVersionIds.length
      ? getWorkflowVersionNumbers(client, publishedVersionIds, companyId)
      : null,
    workflowIds.length
      ? getWorkflowLastRuns(client, workflowIds, companyId)
      : null
  ]);
  // A failed lookup fails the page: a blank Version or Last Run column would
  // read as "none".
  if (versions?.error) throw versions.error;
  if (runs?.error) throw runs.error;

  const versionNumbers = new Map(
    (versions?.data ?? []).map((version) => [version.id, version.versionNumber])
  );
  const lastRuns = new Map<string, WorkflowLastRun>();
  for (const run of runs?.data ?? []) {
    if (run.workflowId) lastRuns.set(run.workflowId, run);
  }

  return rows.map((row) => ({
    ...row,
    publishedVersionNumber: row.publishedVersionId
      ? (versionNumbers.get(row.publishedVersionId) ?? null)
      : null,
    lastRun: lastRuns.get(row.id) ?? null
  }));
}

export const workflowsList = searchList({
  key: "workflows",
  permission: { view: "workflows", role: "employee" },
  paging: WORKFLOWS_PAGING,
  service: getWorkflows,
  rows: withWorkflowListExtras,
  exportValues: WORKFLOW_LIST_EXPORT_VALUES
});

/** The name of the record each run was triggered by. */
async function withWorkflowRunRecordNames<
  T extends { triggerTable: string | null; triggerRecordId: string | null }
>(runs: T[], { client, companyId }: ListRowsContext) {
  const names = await getWorkflowRunRecordNames(
    client,
    companyId,
    runs.flatMap((run) =>
      run.triggerTable && run.triggerRecordId
        ? [{ table: run.triggerTable, id: run.triggerRecordId }]
        : []
    )
  );
  return runs.map((run) => ({
    ...run,
    recordName: names[`${run.triggerTable}:${run.triggerRecordId}`]
  }));
}

export const workflowRunsList = searchList({
  key: "workflow-runs",
  permission: { view: "workflows", role: "employee" },
  paging: WORKFLOW_RUNS_PAGING,
  service: getWorkflowRuns,
  rows: withWorkflowRunRecordNames,
  exportValues: WORKFLOW_RUN_LIST_EXPORT_VALUES
});

// The workflows lists. Each entry follows `sales.server.ts`.
export const workflowsLists: Record<string, ListDefinition> = {
  [workflowsList.key]: workflowsList,
  [workflowRunsList.key]: workflowRunsList
};
