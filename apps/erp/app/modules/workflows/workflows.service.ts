import type { Database, Json } from "@carbon/database";
import { fkDisplayRegistry } from "@carbon/database/audit.config";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import type { workflowValidator } from "./workflows.models";

export async function getWorkflows(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("workflow")
    .select(
      "id, name, description, ownerId, active, activeVersionId, createdAt, updatedAt",
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getWorkflow(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("workflow")
    .select(
      "id, name, description, ownerId, active, activeVersionId, nextRunAt, canvasState, createdAt, updatedAt"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getWorkflowVersions(
  client: SupabaseClient<Database>,
  workflowId: string,
  companyId: string
) {
  return client
    .from("workflowVersion")
    .select(
      "id, workflowId, versionNumber, formatVersion, createdAt, updatedAt"
    )
    .eq("workflowId", workflowId)
    .eq("companyId", companyId)
    .order("versionNumber", { ascending: false });
}

// Flat lookup instead of a nested embed on `getWorkflows` — joined selects across
// workflow + workflowVersion are the shape that trips TS2589 in this app.
export async function getWorkflowVersionNumbers(
  client: SupabaseClient<Database>,
  versionIds: string[],
  companyId: string
) {
  return client
    .from("workflowVersion")
    .select("id, versionNumber")
    .in("id", versionIds)
    .eq("companyId", companyId);
}

export async function getWorkflowVersion(
  client: SupabaseClient<Database>,
  versionId: string,
  companyId: string
) {
  return client
    .from("workflowVersion")
    .select(
      "id, workflowId, versionNumber, formatVersion, nodes, edges, createdAt, updatedAt"
    )
    .eq("id", versionId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function insertWorkflow(
  client: SupabaseClient<Database>,
  workflow: Omit<z.infer<typeof workflowValidator>, "id"> & {
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("workflow")
    .insert({
      name: workflow.name,
      description: workflow.description ?? null,
      companyId: workflow.companyId,
      ownerId: workflow.createdBy,
      createdBy: workflow.createdBy,
      active: false
    })
    .select("id")
    .single();
}

export async function updateWorkflow(
  client: SupabaseClient<Database>,
  workflow: Omit<z.infer<typeof workflowValidator>, "id"> & {
    id: string;
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("workflow")
    .update({
      name: workflow.name,
      description: workflow.description ?? null,
      updatedBy: workflow.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", workflow.id)
    .eq("companyId", workflow.companyId);
}

export async function insertWorkflowVersion(
  client: SupabaseClient<Database>,
  version: {
    workflowId: string;
    companyId: string;
    versionNumber: number;
    nodes: Json;
    edges: Json;
    formatVersion: number;
    createdBy: string;
  }
) {
  return client
    .from("workflowVersion")
    .insert({
      workflowId: version.workflowId,
      companyId: version.companyId,
      versionNumber: version.versionNumber,
      nodes: version.nodes,
      edges: version.edges,
      formatVersion: version.formatVersion,
      createdBy: version.createdBy
    })
    .select("id, versionNumber")
    .single();
}

export async function updateWorkflowDefinition(
  client: SupabaseClient<Database>,
  definition: {
    versionId: string;
    companyId: string;
    nodes: Json;
    edges: Json;
    formatVersion: number;
    updatedBy: string;
  }
) {
  return client
    .from("workflowVersion")
    .update({
      nodes: definition.nodes,
      edges: definition.edges,
      formatVersion: definition.formatVersion,
      updatedBy: definition.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", definition.versionId)
    .eq("companyId", definition.companyId);
}

// No audit bump: panning the canvas is not an edit to the workflow, and stamping
// `updatedAt` here would reorder the list on every scroll.
export async function updateWorkflowCanvasState(
  client: SupabaseClient<Database>,
  {
    id,
    companyId,
    canvasState
  }: { id: string; companyId: string; canvasState: Json }
) {
  return client
    .from("workflow")
    .update({ canvasState })
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function deleteWorkflow(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("workflow")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

export async function getWorkflowRuns(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters
) {
  let query = client
    .from("workflowRun")
    .select(
      "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, isTest, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, createdAt, workflow(name)",
      // Estimated, not exact: this table grows with event volume, and `exact` is a
      // COUNT(*) over the company's whole retained history on every page load.
      { count: LIST_COUNT }
    )
    .eq("companyId", companyId);

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getWorkflowRun(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("workflowRun")
    .select(
      "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, isTest, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, compactedAt, createdAt, workflow(name), workflowVersion(versionNumber, formatVersion, nodes, edges)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

/**
 * A batched node writes one row per item, so a 100-item batch alone is 100+ rows
 * each carrying input, output and detail JSONB. Cap what reaches the browser; the
 * caller reads one row past the cap to know it truncated.
 */
export const MAX_RUN_STEPS = 200;

export async function getWorkflowRunSteps(
  client: SupabaseClient<Database>,
  runId: string,
  companyId: string
) {
  return client
    .from("workflowStepRun")
    .select(
      "id, runId, sequence, nodeId, nodeType, itemKey, status, statusReason, input, output, detail, branchTaken, startedAt, completedAt, durationMs, error, compactedAt"
    )
    .eq("runId", runId)
    .eq("companyId", companyId)
    .order("sequence", { ascending: true })
    .order("itemKey", { ascending: true })
    .limit(MAX_RUN_STEPS + 1);
}

export async function getWorkflowRunChain(
  client: SupabaseClient<Database>,
  rootRunId: string,
  companyId: string
) {
  return client
    .from("workflowRun")
    .select(
      "id, workflowId, status, statusReason, depth, causedByRunId, createdAt, workflow(name)"
    )
    .eq("rootRunId", rootRunId)
    .eq("companyId", companyId)
    .order("depth", { ascending: true })
    .order("createdAt", { ascending: true })
    .limit(50);
}

export async function getWorkflowLastRuns(
  client: SupabaseClient<Database>,
  workflowIds: string[],
  companyId: string
) {
  if (workflowIds.length === 0) return { data: [], error: null };
  return client
    .from("workflowLastRun")
    .select("workflowId, runId, status, createdAt, completedAt, durationMs")
    .in("workflowId", workflowIds)
    .eq("companyId", companyId);
}

/** Tables in `fkDisplayRegistry` that have no `companyId` column; the resolver
 * skips the tenant filter for these. */
const CROSS_COMPANY_TABLES = new Set<string>(["user"]);

/** Resolves record ids to the name a person recognises. Keyed `${table}:${id}`.
 * Tables absent from `fkDisplayRegistry` resolve to nothing and keep their raw id —
 * a missing name is better than a wrong one. */
export async function getWorkflowRunRecordNames(
  client: SupabaseClient<Database>,
  companyId: string,
  refs: Array<{ table: string; id: string }>
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  if (refs.length === 0) return names;

  const registry = fkDisplayRegistry as Record<
    string,
    readonly string[] | undefined
  >;

  const byTable = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.table || !ref.id) continue;
    if (registry[ref.table] === undefined) continue;
    const ids = byTable.get(ref.table) ?? new Set<string>();
    ids.add(ref.id);
    byTable.set(ref.table, ids);
  }
  if (byTable.size === 0) return names;

  await Promise.all(
    [...byTable.entries()].map(async ([table, ids]) => {
      const columns = registry[table];
      if (columns === undefined || columns.length === 0) return;
      // Table names come only from `fkDisplayRegistry`, never from user input.
      const baseQuery = client
        .from(table as never)
        .select(["id", ...columns].join(", "))
        .in("id", [...ids]);
      const rows = CROSS_COMPANY_TABLES.has(table)
        ? await baseQuery
        : await baseQuery.eq("companyId", companyId);

      for (const row of (rows.data ?? []) as unknown as Array<
        Record<string, unknown>
      >) {
        const id = row.id;
        if (typeof id !== "string") continue;
        const display = columns
          .map((column) => row[column])
          .filter(
            (value) => value !== null && value !== undefined && value !== ""
          )
          .join(" ");
        if (display !== "") names[`${table}:${id}`] = display;
      }
    })
  );

  return names;
}

export type Workflow = NonNullable<
  Awaited<ReturnType<typeof getWorkflows>>["data"]
>[number];

export type WorkflowDetail = NonNullable<
  Awaited<ReturnType<typeof getWorkflow>>["data"]
>;

export type WorkflowVersionSummary = NonNullable<
  Awaited<ReturnType<typeof getWorkflowVersions>>["data"]
>[number];

export type WorkflowRun = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRuns>>["data"]
>[number];

export type WorkflowRunDetail = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRun>>["data"]
>;

export type WorkflowRunStep = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRunSteps>>["data"]
>[number];

export type WorkflowRunChainEntry = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRunChain>>["data"]
>[number];

export type WorkflowLastRun = NonNullable<
  Awaited<ReturnType<typeof getWorkflowLastRuns>>["data"]
>[number];

/**
 * Which workflow a version belongs to, and whether that workflow has promoted it.
 * Answers both "may I write to this version" (the autosave lock) and "is this
 * version really this workflow's" (the test run) in one round trip.
 *
 * It runs on every autosave — roughly once a second while editing — so it must
 * not pull the version's whole `nodes`/`edges` JSONB just to read a workflow id.
 */
export async function getWorkflowVersionOwnership(
  client: SupabaseClient<Database>,
  versionId: string,
  companyId: string
) {
  return client
    .from("workflowVersion")
    .select("workflowId, workflow(activeVersionId)")
    .eq("id", versionId)
    .eq("companyId", companyId)
    .maybeSingle();
}
