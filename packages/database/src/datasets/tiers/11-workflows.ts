import { insertId, insertRow, one } from "../sql.ts";
import type { Ctx } from "../types.ts";
import {
  EVENT_SOURCES,
  FORMAT_VERSION,
  type Node
} from "./workflow-definitions.ts";

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
    ctx.log(`workflow — ${workflow.name}${workflow.active ? "" : " (off)"}`);

    const workflowId = await insertId(ctx, "workflow", {
      name: workflow.name,
      description: workflow.description,
      ownerId: userId,
      active: workflow.active
    });

    const versionId = await insertId(ctx, "workflowVersion", {
      workflowId,
      versionNumber: 1,
      formatVersion: FORMAT_VERSION,
      nodes: JSON.stringify(workflow.nodes),
      edges: JSON.stringify(workflow.edges)
    });

    // Set even when the workflow is off: deactivating in the app keeps the promoted
    // version and only drops the trigger rows, so switching one on has to just work.
    await ctx.client.query(
      `UPDATE "workflow" SET "activeVersionId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
      [versionId, workflowId, ctx.companyId]
    );

    // Trigger rows are what make a workflow fire, so an inactive one gets none —
    // the same thing `syncWorkflowTriggers` does when a user turns one off.
    if (!workflow.active) continue;

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
}
