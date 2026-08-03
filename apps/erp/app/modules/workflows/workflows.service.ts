import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
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
      { column: "name", ascending: true }
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
      updatedAt: new Date().toISOString()
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
      updatedAt: new Date().toISOString()
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

export async function updateWorkflowOwner(
  client: SupabaseClient<Database>,
  { id, companyId, userId }: { id: string; companyId: string; userId: string }
) {
  return client
    .from("workflow")
    .update({
      ownerId: userId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
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

export async function deleteWorkflowVersion(
  client: SupabaseClient<Database>,
  versionId: string,
  companyId: string
) {
  return client
    .from("workflowVersion")
    .delete()
    .eq("id", versionId)
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
      "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, createdAt, workflow(name)",
      { count: "exact" }
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
      "id, workflowId, workflowVersionId, eventId, sourceEventId, triggerTable, triggerRecordId, ownerId, status, statusReason, rootRunId, causedByRunId, depth, path, startedAt, completedAt, durationMs, error, compactedAt, createdAt, workflow(name), workflowVersion(versionNumber, formatVersion, nodes, edges)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

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
    .order("itemKey", { ascending: true });
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

export type Workflow = NonNullable<
  Awaited<ReturnType<typeof getWorkflows>>["data"]
>[number];

export type WorkflowDetail = NonNullable<
  Awaited<ReturnType<typeof getWorkflow>>["data"]
>;

export type WorkflowVersionSummary = NonNullable<
  Awaited<ReturnType<typeof getWorkflowVersions>>["data"]
>[number];

export type WorkflowVersionRow = NonNullable<
  Awaited<ReturnType<typeof getWorkflowVersion>>["data"]
>;

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
