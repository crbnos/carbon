// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ServiceContext } from "@carbon/api/service-fn.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import { fetchAllByIds } from "@carbon/database";
import { fkDisplayRegistry } from "@carbon/database/audit.config";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  needsReconnect,
  readConnections,
  usableConnections
} from "@carbon/ee/integrations/connections";
import { defaultUpgradeMessage, resolveRequirement } from "@carbon/ee/plan";
import { companyHasFeature } from "@carbon/ee/plan.server";
import type { CompanyLock, WorkflowIssue } from "@carbon/ee/workflows";
import {
  createWorkflowCatalog,
  INTEGRATION_CONNECTION_INPUT,
  readWorkflowVersion,
  syncWorkflowTriggers,
  validateDefinition
} from "@carbon/ee/workflows";
import { requireWorkflowsEntitlement } from "@carbon/ee/workflows.server";
import { trigger } from "@carbon/jobs";
import {
  CONNECTION_PROVIDER,
  getPieceAction,
  PROPERTY_PROVIDER,
  requiredScopesFor,
  resolvePieceAuth
} from "@carbon/jobs/integrations";
import { getLogger } from "@carbon/logger";
import { datetime, requireAffected } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import type { z } from "zod";
import { path } from "~/utils/path";
import type { Filter, GenericQueryFilters, Paging } from "~/utils/query";
import { listCount, setGenericQueryFilters } from "~/utils/query";
import type { OptionsErrorCode } from "./types";
import type { workflowValidator } from "./workflows.models";
import { MAX_RUN_STEPS } from "./workflows.utils";

export const WORKFLOWS_PAGING: Paging = {
  defaultSorts: [{ column: "createdAt", ascending: false }]
};

export async function getWorkflows(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("workflow")
    .select(
      "id, name, description, ownerId, publishedVersionId, createdAt, updatedAt",
      { count: listCount(args) }
    )
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    // "status" is a derived filter — Published means a version is published
    // (publishedVersionId set), Draft means none. There is no status column, so
    // translate it into a publishedVersionId null test and keep it out of the
    // generic column-filter pipeline (which can only emit eq/in/etc.).
    const statusFilters: Filter[] = [];
    const columnFilters: Filter[] = [];
    for (const filter of args.filters ?? []) {
      (filter.column === "status" ? statusFilters : columnFilters).push(filter);
    }

    for (const filter of statusFilters) {
      if (filter.value === "Published") {
        query = query.not("publishedVersionId", "is", null);
      } else if (filter.value === "Draft") {
        query = query.is("publishedVersionId", null);
      }
    }

    query = setGenericQueryFilters(
      query,
      { ...args, filters: columnFilters },
      WORKFLOWS_PAGING
    );
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
      "id, name, description, ownerId, publishedVersionId, nextRunAt, canvasState, createdAt, updatedAt"
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
  return fetchAllByIds(versionIds, (batch) =>
    client
      .from("workflowVersion")
      .select("id, versionNumber")
      .in("id", batch)
      .eq("companyId", companyId)
      .order("id", { ascending: true })
  );
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
      createdBy: workflow.createdBy
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
  return requireAffected(
    client
      .from("workflow")
      .update({
        name: workflow.name,
        description: workflow.description ?? null,
        updatedBy: workflow.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("id", workflow.id)
      .eq("companyId", workflow.companyId)
      .select("id")
  );
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
  return requireAffected(
    client
      .from("workflowVersion")
      .update({
        nodes: definition.nodes,
        edges: definition.edges,
        formatVersion: definition.formatVersion,
        updatedBy: definition.updatedBy,
        updatedAt: datetime.timestamp()
      })
      .eq("id", definition.versionId)
      .eq("companyId", definition.companyId)
      .select("id")
  );
}

/**
 * The one writer allowed on a published version. It reads the version's nodes and re-writes
 * only `position`, only for node ids that already exist — `edges`, `data`, `expanded`,
 * `name` and `type` are never touched, and an unknown id is ignored. The endpoint is
 * therefore incapable of changing behaviour even when called by hand.
 *
 * No audit bump, for the same reason as the canvas state below: tidying a layout is not
 * an edit, and stamping `updatedAt` would reorder the list on every drag.
 */
export async function updateWorkflowNodePositions(
  client: SupabaseClient<Database>,
  {
    versionId,
    workflowId,
    companyId,
    positions
  }: {
    versionId: string;
    workflowId: string;
    companyId: string;
    positions: Record<string, { x: number; y: number }>;
  }
) {
  // Scoped to the workflow in the URL as well as the version in the body, so the two
  // cannot disagree — otherwise the path segment is decorative.
  const version = await client
    .from("workflowVersion")
    .select("nodes")
    .eq("id", versionId)
    .eq("workflowId", workflowId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (version.error) return { data: null, error: version.error };
  if (!version.data || !Array.isArray(version.data.nodes)) {
    return { data: null, error: { message: "Version not found" } };
  }

  const nodes = (version.data.nodes as unknown[]).map((node) => {
    const id = (node as { id?: unknown })?.id;
    const position = typeof id === "string" ? positions[id] : undefined;
    return position === undefined
      ? node
      : { ...(node as object), position: { x: position.x, y: position.y } };
  });

  return requireAffected(
    client
      .from("workflowVersion")
      .update({ nodes: nodes as unknown as Json })
      .eq("id", versionId)
      .eq("companyId", companyId)
      .select("id")
  );
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
  return requireAffected(
    client
      .from("workflow")
      .update({ canvasState })
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
  );
}

export async function deleteWorkflow(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return requireAffected(
    client
      .from("workflow")
      .delete()
      .eq("id", id)
      .eq("companyId", companyId)
      .select("id")
  );
}

export const WORKFLOW_RUNS_PAGING: Paging = {
  defaultSorts: [{ column: "createdAt", ascending: false }]
};

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
      { count: listCount(args) }
    )
    .eq("companyId", companyId);

  if (args) {
    query = setGenericQueryFilters(query, args, WORKFLOW_RUNS_PAGING);
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
  return fetchAllByIds(workflowIds, (batch) =>
    client
      .from("workflowLastRun")
      .select("workflowId, runId, status, createdAt, completedAt, durationMs")
      .in("workflowId", batch)
      .eq("companyId", companyId)
      .order("workflowId", { ascending: true })
  );
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
    .select(
      // Two FKs join these tables — this one and workflow."publishedVersionId" —
      // so the embed must name which, or PostgREST refuses it (PGRST201).
      "workflowId, workflow!workflowVersion_workflowId_companyId_fkey(publishedVersionId)"
    )
    .eq("id", versionId)
    .eq("companyId", companyId)
    .maybeSingle();
}
const logger = getLogger("erp", "workflows");

export const LOCKED_VERSION_MESSAGE =
  "This version is published. Create a new version to make changes.";

/**
 * The published version is read-only; every mutating route calls this. An id that
 * resolves to nothing returns `{ ok: true }` — it cannot be the published version —
 * matching `checkRevisionLock`'s unresolvable-is-unlocked rule.
 */
export async function checkWorkflowVersionLock(
  client: SupabaseClient<Database>,
  { versionId, companyId }: { versionId: string; companyId: string }
): Promise<{ ok: boolean; message?: string }> {
  const state = await getWorkflowVersionOwnership(client, versionId, companyId);
  if (state.error || !state.data) return { ok: true };

  const workflow = state.data.workflow as {
    publishedVersionId: string | null;
  } | null;
  if (!workflow) return { ok: true };

  return versionId === workflow.publishedVersionId
    ? { ok: false, message: LOCKED_VERSION_MESSAGE }
    : { ok: true };
}

export type WorkflowSyncResult =
  | { ok: false; issues: WorkflowIssue[]; message?: string }
  | { ok: true; issues: never[]; scheduled: boolean };

/**
 * Held for the whole sync transaction, so two publishes in one company queue up
 * instead of each reconciling the company's subscriptions from stale state.
 * `hashtext` is stable across sessions, and the `_xact_` variant releases on
 * commit or rollback — there is no unlock path to forget.
 */
const lockCompany: CompanyLock = (trx, companyId) =>
  sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`.execute(trx);

/**
 * Rewrites the workflow's trigger rows to match whatever is now published, and
 * wakes the scheduler chain so a scheduled workflow starts within minutes rather
 * than waiting for the hourly backstop.
 *
 * DANGER: `syncWorkflowTriggers` uses Kysely and bypasses RLS entirely, so the
 * calling route's `requirePermissions` is the only authorization gate on it.
 */
async function syncAndWake(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string
) {
  const sync = await syncWorkflowTriggers(
    db,
    companyId,
    workflowId,
    lockCompany
  );

  if (sync.scheduled) {
    await trigger("workflow-scheduler-wake", { bookedFor: null });
  }

  return {
    ok: true as const,
    issues: [] as never[],
    scheduled: sync.scheduled
  };
}

export async function publishWorkflowVersion(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    workflowId,
    versionId,
    companyId,
    userId
  }: {
    workflowId: string;
    versionId: string;
    companyId: string;
    userId: string;
  }
): Promise<WorkflowSyncResult> {
  // Commercial LOCK: publishing a workflow is what makes it live, so the
  // entitlement check sits here inside the server path (backstopping the route's
  // strippable `requireFeature` UX gate). Throws `EntitlementError` on a
  // non-entitled company.
  await requireWorkflowsEntitlement(client, companyId);

  const version = await getWorkflowVersion(client, versionId, companyId);
  if (
    version.error ||
    !version.data ||
    version.data.workflowId !== workflowId
  ) {
    return { ok: false, issues: [], message: "Version not found" };
  }

  const read = readWorkflowVersion(version.data);
  if (!read.ok) {
    return { ok: false, issues: [], message: read.message };
  }

  const issues = validateDefinition(read.definition, createWorkflowCatalog());
  if (issues.length) {
    return { ok: false, issues };
  }

  const promoted = await requireAffected(
    client
      .from("workflow")
      .update({
        publishedVersionId: versionId,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", workflowId)
      .eq("companyId", companyId)
      .select("id")
  );

  if (promoted.error) {
    return { ok: false, issues: [], message: promoted.error.message };
  }

  return syncAndWake(db, companyId, workflowId);
}

/**
 * The inverse of {@link publishWorkflowVersion}, and the only way to switch a workflow off.
 *
 * Takes no boolean: publishing needs a version id and has to pass validation first, so the
 * two directions cannot share one entry point.
 */
export async function unpublishWorkflow(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    workflowId,
    companyId,
    userId
  }: {
    workflowId: string;
    companyId: string;
    userId: string;
  }
): Promise<WorkflowSyncResult> {
  const updated = await requireAffected(
    client
      .from("workflow")
      .update({
        publishedVersionId: null,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", workflowId)
      .eq("companyId", companyId)
      .select("id")
  );

  if (updated.error) {
    return { ok: false, issues: [], message: updated.error.message };
  }

  // Unpublishing must still sync — that is what deletes the trigger rows and clears
  // nextRunAt, which is what actually stops the workflow firing.
  return syncAndWake(db, companyId, workflowId);
}

/**
 * Reconciles the company's subscriptions after a workflow row is gone.
 *
 * The FK cascade takes `workflowTriggerEvent` with the workflow, but nothing
 * touches `eventSystemSubscription` — it is keyed per company per table, not per
 * workflow. Deleting the last workflow watching a table would otherwise leave
 * that subscription active, and `dispatch_event_batch()` would keep enqueuing
 * events no workflow can consume.
 *
 * Never throws: the row is already deleted, so failing here must not present the
 * delete as failed. The orphan is wasted work, not incorrect behaviour, and the
 * next publish or unpublish in the company reconciles it away.
 */
export async function syncAfterWorkflowDelete(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  workflowId: string
): Promise<void> {
  try {
    await syncWorkflowTriggers(db, companyId, workflowId, lockCompany);
  } catch (err) {
    logger.error("Failed to reconcile subscriptions after workflow delete", {
      companyId,
      workflowId,
      error: err
    });
  }
}

/** A refusal unless the company's plan includes workflows. */
export async function refuseUnlessWorkflowsEnabled(ctx: ServiceContext) {
  const enabled = await companyHasFeature(
    ctx.asCaller.supabase,
    ctx.company.id,
    { feature: "WORKFLOWS" }
  );
  if (enabled) return null;
  return ctx.error(
    "entitlement",
    defaultUpgradeMessage(resolveRequirement({ feature: "WORKFLOWS" }))
  );
}

const optionsLogger = getLogger("erp", "workflows", "options");

export type OptionsProviderContext = {
  companyId: string;
  /** Fixed arguments from the catalog entry. */
  params: Record<string, string>;
  /** Current values of the input's `dependsOn` inputs. */
  values: Record<string, string>;
};

export type ProviderOption = { label: string; value: string };

export type OptionsProviderResult = {
  options: ProviderOption[];
  /** Where the author can go to create the first one, when there are none. */
  emptyHref?: string;
  /** Why this list could not be loaded, when we know a reason worth saying.
   * A CODE, not a sentence: the wording is the builder's, so it goes through
   * Lingui like every other string the author reads. */
  errorCode?: OptionsErrorCode;
  /** Where to go and do it. */
  errorHref?: string;
  /** Something worth saying beside a list that DID load — an account that was
   * left out because it needs reconnecting. Same code vocabulary as errors. */
  noticeCode?: OptionsErrorCode;
  noticeHref?: string;
};

export type OptionsProvider = {
  /** Checked before the provider runs, so a provider can never be a way around a
   * permission the equivalent action carries. Module per action, e.g.
   * `{ update: "workflows" }`. */
  permission: Partial<Record<"view" | "create" | "update" | "delete", string>>;
  resolve: (context: OptionsProviderContext) => Promise<OptionsProviderResult>;
};

/**
 * The company's connections for one piece. Non-secret fields only.
 *
 * Read through the SERVICE role, then scoped to `companyId` here. The row's RLS
 * SELECT policy demands `settings_view`, but this provider is gated on
 * `workflows_view` — a workflow author who cannot administer Settings would
 * otherwise get an empty list and be told the app "isn't connected yet", with
 * nothing anywhere reporting that the rows had been filtered away. The company
 * scope is not weakened: `requirePermissions` resolved `companyId` for this
 * request, and only non-secret columns leave here.
 *
 * Only USABLE accounts are offered. A revoked account in a dropdown is a trap —
 * picking it builds a workflow that cannot run.
 */
const connectionProvider: OptionsProvider = {
  permission: { view: "workflows" },
  resolve: async ({ companyId, params }) => {
    const piece = params.piece;
    if (!piece) return { options: [] };

    const usable = usableConnections(
      await readConnections(getCarbonServiceRole(), companyId, piece)
    );
    const required = await requiredScopesFor(piece);
    const ready = usable.filter((row) => !needsReconnect(row, required));
    const accountsHref = path.to.integrationAccounts(piece);

    // Connected, but every account predates a scope this piece now needs: the fix
    // is a re-consent, not a new account — say so instead of offering nothing.
    if (ready.length === 0 && usable.length > 0) {
      return { options: [], errorCode: "reconnect", errorHref: accountsHref };
    }

    return {
      options: ready.map((row) => ({
        value: row.id,
        label: row.accountLabel ? `${row.name} · ${row.accountLabel}` : row.name
      })),
      emptyHref: accountsHref,
      // Some accounts are ready and some are not: offer the ready ones, but say
      // that one is missing rather than letting it vanish from the list.
      ...(ready.length < usable.length
        ? { noticeCode: "reconnect" as const, noticeHref: accountsHref }
        : {})
    };
  }
};

/**
 * One piece property's own `options()`, run against a chosen connection — "pick a
 * calendar". Gated on `workflows_update`, the same permission the action carries,
 * so it cannot reach a vendor a user could not otherwise call.
 */
const propertyProvider: OptionsProvider = {
  permission: { update: "workflows" },
  resolve: async ({ companyId, params, values }) => {
    const { piece, action: actionName, prop } = params;
    const connectionId = values[INTEGRATION_CONNECTION_INPUT];
    if (!piece || !actionName || !prop || !connectionId) return { options: [] };

    // Read through the SERVICE role for the same reason `connectionProvider` does:
    // the row's RLS demands `settings_view`, this provider is gated on
    // `workflows_update`, and a workflow author without Settings access would
    // otherwise see every dependent list come back empty. `companyId` came from
    // `requirePermissions`, and scopes every read the resolver makes.
    const auth = await resolvePieceAuth(
      getCarbonServiceRole(),
      companyId,
      piece,
      connectionId
    );
    if (!auth.ok) {
      switch (auth.reason) {
        case "no-connection":
          return { options: [] };
        // A connection problem is not a generic lookup failure: the author cannot
        // fix "couldn't load the choices", but they can reconnect an account.
        // An under-scoped account reads the same way it does in the connection
        // dropdown, which leaves it out for that reason.
        case "missing-scopes":
        case "reconnect":
          return {
            options: [],
            errorCode: "reconnect",
            errorHref: path.to.integrationAccounts(piece)
          };
        case "refreshing":
          return { options: [], errorCode: "refreshing" };
        // Loading the piece to read its token URL failed for a reason that has
        // nothing to do with the account — a missing package, an unset OAuth env
        // var. Named in the log rather than swallowed: it looks identical to a
        // dead account from the outside, and telling them apart is the whole
        // difference between "reconnect" and "fix the server's OAuth config".
        case "misconfigured":
          optionsLogger.error(
            "Could not build the refresh config for {piece}: {cause}",
            {
              piece,
              cause:
                auth.cause instanceof Error
                  ? auth.cause.message
                  : String(auth.cause)
            }
          );
          return { options: [], errorCode: "failed" };
        case "failed":
          throw auth.cause;
      }
    }

    const action = await getPieceAction(piece, actionName);
    const property = action.props[prop];
    if (property === undefined || typeof property.options !== "function") {
      throw new Error(
        `${piece}.${actionName}.${prop} has no options to fetch.`
      );
    }

    // A dropdown's `refreshers` may name sibling props, so pass what the node has.
    const propsValue: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key in action.props) propsValue[key] = value;
    }

    const resolved = await (
      property.options as (context: unknown) => Promise<unknown>
    )({
      auth: { access_token: auth.accessToken },
      propsValue
    });

    return { options: optionRows(resolved) };
  }
};

/**
 * A piece's `options()` answer as dropdown rows. A stored choice is text, so only
 * a scalar value can be one: an object value would be stored as
 * "[object Object]", which the piece could never read back, so that row is left
 * out rather than offered.
 */
function optionRows(answer: unknown): ProviderOption[] {
  if (answer === null || typeof answer !== "object" || !("options" in answer))
    return [];
  const rows = answer.options;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (row === null || typeof row !== "object") return [];
    if (!("label" in row) || typeof row.label !== "string") return [];
    const value = "value" in row ? row.value : undefined;
    if (typeof value === "string") return [{ label: row.label, value }];
    if (
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    ) {
      return [{ label: row.label, value: String(value) }];
    }
    return [];
  });
}

/**
 * Every list the workflow builder fetches while a node is being edited.
 *
 * A catalog input names a provider by id and the builder forwards it verbatim, so
 * this registry is the only place that knows what a provider id MEANS. Nothing here
 * is integration-specific by construction: a provider backed by Carbon's own data
 * is one more entry, and needs no change to the catalog format, the endpoint or the
 * field that renders it.
 */
export const OPTIONS_PROVIDERS: Record<string, OptionsProvider> = {
  [CONNECTION_PROVIDER]: connectionProvider,
  [PROPERTY_PROVIDER]: propertyProvider
};
