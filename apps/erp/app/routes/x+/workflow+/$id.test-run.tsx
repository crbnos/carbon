import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { fkDisplayRegistry } from "@carbon/database/audit.config";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import { executeManualWorkflowRun, noAccess } from "@carbon/jobs/inngest";
import { datetime } from "@carbon/utils";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  createWorkflowCatalog,
  REGISTRY_ENTRIES,
  type RunTrigger,
  validateDefinition,
  type WorkflowIssue,
  workflowDefinitionSchema
} from "@carbon/workflows";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getUserClaims } from "~/modules/users/users.server";
import {
  getWorkflow,
  getWorkflowRunSteps,
  getWorkflowVersionOwnership,
  MAX_RUN_STEPS,
  workflowTestRunValidator
} from "~/modules/workflows";
import { workflowTestRunInputSchema } from "~/modules/workflows/workflows.models";
import { path } from "~/utils/path";

// The picker filters this page locally, so it has to be big enough to be useful.
const RECORD_LIMIT = 50;

/** Every refusal, in one shape. The builder has a single field to read, so a reason can
 * never be dropped by landing under a key the client does not look at. */
function refuse(error: string, status = 400, issues: WorkflowIssue[] = []) {
  return data({ ok: false as const, error, issues }, { status });
}

/** The run acts as the owner, so anyone else firing it would be borrowing the owner's
 * permissions. This is the authorization boundary, not a UI nicety. */
async function requireOwnedWorkflow(request: Request, id: string | undefined) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { update: "workflows" });
  await requirePlan({
    request,
    client,
    companyId,
    feature: "WORKFLOWS",
    redirectTo: path.to.workflows
  });

  if (!id) {
    return { refused: refuse("Workflow not found", 404) };
  }

  const workflow = await getWorkflow(client, id, companyId);
  if (workflow.error || !workflow.data) {
    return { refused: refuse("Workflow not found", 404) };
  }
  if (workflow.data.ownerId !== userId) {
    return {
      refused: refuse("Only the owner of this workflow can test it", 403)
    };
  }

  return { client, companyId, companyGroupId, userId, workflow: workflow.data };
}

/** Options for the test-run record picker. Reads through the request's own client, so
 * RLS applies and only records the author can already see are offered. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const gate = await requireOwnedWorkflow(request, params.id);
  if ("refused" in gate) return gate.refused;

  const entity = new URL(request.url).searchParams.get("entity") ?? "";

  const entry = REGISTRY_ENTRIES[entity];
  if (entry === undefined) {
    return refuse("Unknown record type");
  }

  const columns = fkDisplayRegistry[
    entry.table as keyof typeof fkDisplayRegistry
  ] as readonly string[] | undefined;
  if (columns === undefined || columns.length === 0) {
    return data({ ok: true as const, options: [] });
  }

  // The table name comes only from REGISTRY_ENTRIES, never from the query string.
  const result = await gate.client
    .from(entry.table as never)
    .select(["id", ...columns].join(", "))
    .eq("companyId", gate.companyId)
    .order("createdAt", { ascending: false })
    .limit(RECORD_LIMIT);
  if (result.error) {
    return refuse(result.error.message, 500);
  }

  const options = (result.data as unknown as Record<string, unknown>[]).map(
    (row) => {
      const id = String(row.id);
      const label = columns
        .map((column) => row[column])
        .filter(Boolean)
        .join(" ");
      return { value: id, label: label || id };
    }
  );

  return data({ ok: true as const, options });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const gate = await requireOwnedWorkflow(request, params.id);
  if ("refused" in gate) return gate.refused;

  const validation = await validator(workflowTestRunValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    const first = Object.values(validation.error.fieldErrors)[0];
    return refuse(first ?? "That test run could not be started");
  }

  const {
    versionId,
    nodes,
    edges,
    eventId,
    triggerNodeId,
    triggerInput,
    previousValue
  } = validation.data;

  // The run row points at this version, so a forged id would file one workflow's
  // history under another's. The FK only enforces the company.
  const version = await getWorkflowVersionOwnership(
    gate.client,
    versionId,
    gate.companyId
  );
  if (version.error || version.data?.workflowId !== gate.workflow.id) {
    return refuse("That version does not belong to this workflow", 404);
  }

  let parsed: unknown;
  try {
    parsed = {
      formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
      nodes: JSON.parse(nodes),
      edges: JSON.parse(edges)
    };
  } catch {
    return refuse("Malformed definition");
  }

  const definition = workflowDefinitionSchema.safeParse(parsed);
  if (!definition.success) {
    const first = definition.error.issues[0];
    const where = first?.path.join(".");
    return refuse(
      first
        ? `Invalid definition${where ? ` at ${where}` : ""}: ${first.message}`
        : "Invalid definition"
    );
  }

  const catalog = createWorkflowCatalog();

  // A half-configured workflow runs nothing at all — a test run has real side effects.
  const issues = validateDefinition(definition.data, catalog);
  if (issues.length > 0) {
    return refuse(summarizeIssues(issues), 400, issues);
  }

  // A schedule trigger listens for no catalog event, so an absent id is the normal case.
  const event = eventId === undefined ? undefined : catalog.getEvent(eventId);
  if (eventId !== undefined && event === undefined) {
    return refuse("Unknown event");
  }

  // The gate comes before the read, not only inside the walk: `buildTrigger` fetches
  // the record with service role, and an ordering that only happens to be safe is one
  // an edit can quietly break. The walk re-checks against live claims.
  const module = event?.permission;
  if (module !== undefined) {
    const claims = await getUserClaims(gate.userId, gate.companyId);
    const granted = claims.permissions[module]?.view ?? [];
    if (!granted.includes(gate.companyId)) {
      return refuse(noAccess(module), 403);
    }
  }

  let input: unknown;
  try {
    input = workflowTestRunInputSchema.parse(JSON.parse(triggerInput));
  } catch {
    return refuse("Malformed trigger input");
  }

  const built = await buildTrigger({
    event,
    input,
    companyId: gate.companyId,
    previousValue
  });
  if ("error" in built) {
    return refuse(built.error);
  }

  const result = await executeManualWorkflowRun({
    definition: definition.data,
    companyId: gate.companyId,
    companyGroupId: gate.companyGroupId,
    ownerId: gate.userId,
    workflowId: gate.workflow.id,
    workflowVersionId: versionId,
    eventId: eventId ?? "",
    triggerNodeId,
    trigger: built.trigger,
    logger: console
  });

  // Read back through the same reader the run-history page uses, so the panel and
  // that page can never disagree about a run the customer can open in both.
  const steps = await getWorkflowRunSteps(
    gate.client,
    result.runId,
    gate.companyId
  );
  const rows = steps.data ?? [];

  return data({
    ok: true as const,
    runId: result.runId,
    status: result.status,
    error: result.error,
    steps: rows.slice(0, MAX_RUN_STEPS),
    truncated: rows.length > MAX_RUN_STEPS
  });
}

/** The count only. Every problem travels back in full alongside this, and the builder
 * lists each one against the step it belongs to — which one sentence cannot do. */
function summarizeIssues(issues: WorkflowIssue[]): string {
  return issues.length === 1
    ? "1 problem is stopping this workflow from running. It is listed below."
    : `${issues.length} problems are stopping this workflow from running. They are listed below.`;
}

type BuildTriggerArgs = {
  /** Absent for a schedule trigger. */
  event: ReturnType<ReturnType<typeof createWorkflowCatalog>["getEvent"]>;
  input: unknown;
  companyId: string;
  previousValue: string | undefined;
};

/** The payload a real announcement would have carried, assembled from what the author
 * picked. Shapes must match `runTriggerSchema` exactly. */
async function buildTrigger(
  args: BuildTriggerArgs
): Promise<{ trigger: RunTrigger } | { error: string }> {
  const { event, input, companyId, previousValue } = args;

  if (event === undefined || event.match === undefined) {
    return { trigger: { kind: "schedule", dueAt: datetime.timestamp() } };
  }
  const match = event.match;

  if ("moment" in match) {
    const outputs =
      typeof input === "object" && input !== null && "outputs" in input
        ? (input as { outputs: Record<string, string> }).outputs
        : {};
    return {
      trigger: {
        kind: "moment",
        moment: event.id,
        outputs: Object.fromEntries(
          Object.entries(outputs).map(([name, id]) => [name, { id }])
        )
      }
    };
  }

  if (typeof input !== "object" || input === null || !("recordId" in input)) {
    return { error: "A record is required" };
  }
  const recordId = (input as { recordId: string }).recordId;

  // Service role bypasses RLS so the lookup works regardless of whether the caller
  // authenticated via session or API key. requirePermissions already verified the
  // company scope; the companyId filter here ensures cross-tenant safety.
  const row = await getCarbonServiceRole()
    .from(match.table as never)
    .select("*")
    .eq("id", recordId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (row.error || !row.data) {
    return { error: "That record could not be found" };
  }
  const record = row.data as unknown as Record<string, unknown>;

  if (match.operation !== "UPDATE") {
    return {
      trigger: {
        kind: "record",
        table: match.table,
        recordId,
        operation: match.operation,
        record,
        before: null,
        after: null
      }
    };
  }

  // `previousValue` stays a raw string; the engine's own `fromColumn` coercion types it,
  // exactly as it would for a real announcement.
  const before =
    match.field === undefined
      ? { ...record }
      : { ...record, [match.field]: previousValue ?? null };

  return {
    trigger: {
      kind: "record",
      table: match.table,
      recordId,
      operation: "UPDATE",
      record,
      before,
      after: record
    }
  };
}
