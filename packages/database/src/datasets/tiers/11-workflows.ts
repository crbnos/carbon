import { resolveDate } from "../dates.ts";
import { insertId, insertRow, need, one } from "../sql.ts";
import type { Ctx, Node, WorkflowRunSpec } from "../types.ts";
import { EVENT_SOURCES, FORMAT_VERSION } from "./workflow-definitions.ts";

// Wired exactly as the publish and activate routes do it, so a later change in the app
// really fires them. Definitions must pass `validateDefinition` in @carbon/workflows —
// `seed-workflows.test.ts` in that package is the gate.

/** One row per event id across the definition's trigger nodes; first origin wins. */
function triggerRowsFor(nodes: Node[]): { eventId: string; origin: string }[] {
  const rows = new Map<string, { eventId: string; origin: string }>();
  for (const node of nodes) {
    if (node.type !== "trigger") continue;
    const events = (node.data.events as string[] | undefined) ?? [];
    const origin = (node.data.origin as string | undefined) ?? "Both";
    for (const eventId of events) {
      if (!rows.has(eventId)) rows.set(eventId, { eventId, origin });
    }
  }
  return [...rows.values()];
}

/** Without a subscription for the table, dispatch_event_batch() never enqueues
 * the change and the trigger row is dead weight. */
async function reconcileSubscriptions(
  ctx: Ctx,
  eventIds: string[]
): Promise<string[]> {
  const byTable = new Map<string, Set<string>>();
  for (const eventId of eventIds) {
    if (!(eventId in EVENT_SOURCES)) {
      throw new Error(`Seed: no event source for "${eventId}"`);
    }
    // A business moment has no table to subscribe to — it reaches the matcher directly.
    const source = EVENT_SOURCES[eventId];
    if (!source) continue;
    const ops = byTable.get(source.table) ?? new Set<string>();
    ops.add(source.operation);
    byTable.set(source.table, ops);
  }

  await ctx.client.query(
    `DELETE FROM "eventSystemSubscription"
      WHERE "companyId" = $1 AND "handlerType" = 'WORKFLOW'`,
    [ctx.companyId]
  );

  const tables = [...byTable.keys()].sort();
  for (const table of tables) {
    await insertRow(ctx, "eventSystemSubscription", {
      name: `workflow-${table}`,
      table,
      operations: [...(byTable.get(table) ?? [])].sort(),
      handlerType: "WORKFLOW",
      config: JSON.stringify({}),
      filter: JSON.stringify({}),
      active: true
    });
  }
  return tables;
}

export async function runTier11(ctx: Ctx): Promise<void> {
  const data = ctx.dataset.workflows;
  const { userId } = ctx;
  const allEventIds: string[] = [];
  const publishedByName = new Map<string, PublishedWorkflow>();

  // The issue-creating workflow names a type, which is NOT NULL on the table.
  const issueType = await one<{ id: string }>(
    ctx.client,
    `SELECT id FROM "nonConformanceType" WHERE "companyId" = $1 LIMIT 1`,
    [ctx.companyId]
  );

  for (const workflow of data.build({
    ownerId: userId,
    issueTypeId: issueType.id
  })) {
    ctx.log(
      `workflow — ${workflow.name}${workflow.published ? "" : " (draft)"}`
    );

    const workflowId = await insertId(ctx, "workflow", {
      name: workflow.name,
      description: workflow.description,
      ownerId: userId
    });

    const versionId = await insertId(ctx, "workflowVersion", {
      workflowId,
      versionNumber: 1,
      formatVersion: FORMAT_VERSION,
      nodes: JSON.stringify(workflow.nodes),
      edges: JSON.stringify(workflow.edges)
    });

    // The pointer IS the on/off switch, so an unpublished seeded workflow is a draft: no
    // pointer, and no trigger rows either — exactly what `syncWorkflowTriggers` leaves
    // behind when a user unpublishes one.
    if (!workflow.published) continue;

    await ctx.client.query(
      `UPDATE "workflow" SET "publishedVersionId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
      [versionId, workflowId, ctx.companyId]
    );
    publishedByName.set(workflow.name, {
      workflowId,
      versionId,
      nodes: workflow.nodes
    });

    for (const row of triggerRowsFor(workflow.nodes)) {
      await insertRow(ctx, "workflowTriggerEvent", {
        workflowId,
        workflowVersionId: versionId,
        eventId: row.eventId,
        origin: row.origin
      });
      allEventIds.push(row.eventId);
    }
  }

  const tables = await reconcileSubscriptions(ctx, allEventIds);
  ctx.log(`workflow subscriptions — ${tables.join(", ")}`);

  ctx.log(`workflow runs — ${data.runs.length}`);
  for (const [index, spec] of data.runs.entries()) {
    const workflow = publishedByName.get(spec.workflow);
    if (!workflow) {
      throw new Error(
        `Seed: workflow run "${spec.workflow}": not a published seed workflow`
      );
    }
    await seedRun(ctx, workflow, spec, `seed:${index + 1}`);
  }
}

type PublishedWorkflow = {
  workflowId: string;
  versionId: string;
  nodes: Node[];
};

type EntityValue = {
  kind: "entity";
  of: string;
  id: string;
  row?: Record<string, unknown>;
};

/**
 * Millisecond offsets are fixed so durationMs agrees with the timestamps. A
 * Skipped run settles at `load`: never claimed, no step rows.
 */
async function seedRun(
  ctx: Ctx,
  workflow: PublishedWorkflow,
  spec: WorkflowRunSpec,
  sourceEventId: string
): Promise<void> {
  const trigger = workflow.nodes.find((node) => node.type === "trigger");
  const eventId = ((trigger?.data.events as string[] | undefined) ?? [])[0];
  if (!trigger || !eventId) {
    throw new Error(`Seed: workflow "${spec.workflow}" has no trigger event`);
  }
  const source = EVENT_SOURCES[eventId];
  if (!source) {
    throw new Error(
      `Seed: workflow run "${spec.workflow}": event "${eventId}" has no source table to name the triggering record`
    );
  }
  const recordId = need(ctx.refs.documents, spec.triggerRef, "document");
  const second = `${resolveDate(ctx.anchor, spec.at.offset)}T${spec.at.time}`;
  const ms = (n: number) => `${second}.${String(n).padStart(3, "0")}Z`;

  const record: EntityValue = {
    kind: "entity",
    of: source.table,
    id: recordId,
    row: await triggerRow(ctx, source.table, recordId)
  };

  const claimedAt = 250;
  const lastStepEnd = 270 + spec.steps.length * 360;
  const settledAt = spec.status === "Skipped" ? 180 : lastStepEnd + 60;
  const runId = await insertId(ctx, "workflowRun", {
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    eventId,
    sourceEventId,
    triggerTable: source.table,
    triggerRecordId: recordId,
    ownerId: ctx.userId,
    status: spec.status,
    statusReason: spec.statusReason,
    isTest: false,
    startedAt: spec.status === "Skipped" ? undefined : ms(claimedAt),
    completedAt: ms(settledAt),
    durationMs: settledAt - (spec.status === "Skipped" ? 0 : claimedAt),
    createdAt: ms(0)
  });
  if (spec.status === "Skipped") return;

  await insertRow(ctx, "workflowStepRun", {
    runId,
    sequence: 0,
    nodeId: trigger.id,
    nodeType: "trigger",
    status: "Succeeded",
    output: JSON.stringify({ record }),
    startedAt: ms(260),
    completedAt: ms(270),
    durationMs: 10
  });

  for (const [index, step] of spec.steps.entries()) {
    const node = workflow.nodes.find((n) => n.id === step.nodeId);
    if (!node || node.type === "trigger") {
      throw new Error(
        `Seed: workflow run "${spec.workflow}": "${step.nodeId}" is not an action node of the definition`
      );
    }
    const start = 270 + index * 360;
    const inputs = (node.data.inputs ?? {}) as Record<string, unknown>;
    const settled = actionOutcome(node, record);
    await insertRow(ctx, "workflowStepRun", {
      runId,
      sequence: index + 1,
      nodeId: node.id,
      nodeType: node.type,
      status: step.status,
      statusReason: step.status === "Succeeded" ? settled.summary : undefined,
      input: JSON.stringify({
        inputs,
        resolved: resolveInputs(inputs, trigger.id, record)
      }),
      output:
        step.status === "Succeeded"
          ? JSON.stringify(settled.output)
          : undefined,
      error: step.error,
      startedAt: ms(start + 10),
      completedAt: ms(start + 360),
      durationMs: 350
    });
  }
}

/** The triggering record's headline columns — what the loader's entity row carries. */
async function triggerRow(
  ctx: Ctx,
  table: string,
  id: string
): Promise<Record<string, unknown>> {
  if (table !== "salesOrder") {
    throw new Error(`Seed: no trigger row shape for "${table}" runs`);
  }
  return one<Record<string, unknown>>(
    ctx.client,
    `SELECT id, "salesOrderId", "customerId", status,
            "orderDate"::text AS "orderDate", "currencyCode"
     FROM "salesOrder" WHERE id = $1 AND "companyId" = $2`,
    [id, ctx.companyId]
  );
}

/** `{ inputs, resolved }` — refs to the trigger resolve to its record, entity literals to their id. */
function resolveInputs(
  inputs: Record<string, unknown>,
  triggerId: string,
  record: EntityValue
): Record<string, EntityValue> {
  const resolved: Record<string, EntityValue> = {};
  for (const [name, raw] of Object.entries(inputs)) {
    const value = raw as {
      kind?: string;
      nodeId?: string;
      output?: string;
      type?: { kind?: string; of?: string };
      value?: unknown;
    };
    if (value.kind === "ref" && value.nodeId === triggerId) {
      resolved[name] = record;
    } else if (
      value.kind === "literal" &&
      value.type?.kind === "entity" &&
      typeof value.type.of === "string" &&
      typeof value.value === "string"
    ) {
      resolved[name] = { kind: "entity", of: value.type.of, id: value.value };
    } else {
      throw new Error(`Seed: cannot resolve workflow input "${name}"`);
    }
  }
  return resolved;
}

/** What actions/update.ts settles with: the updated record, "Updated N field(s)." */
function actionOutcome(
  node: Node,
  record: EntityValue
): { output: unknown; summary: string } {
  const action = node.data.action as string | undefined;
  if (!action?.endsWith(".update")) {
    throw new Error(`Seed: no seeded outcome for action "${action}"`);
  }
  const target = action.slice(0, -".update".length);
  const fields = Object.keys(
    (node.data.inputs ?? {}) as Record<string, unknown>
  ).filter((name) => name !== target).length;
  return {
    output: { record: { kind: "entity", of: target, id: record.id } },
    summary: `Updated ${fields} field(s).`
  };
}
