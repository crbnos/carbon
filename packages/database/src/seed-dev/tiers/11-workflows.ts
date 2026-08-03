import { insertId, insertRow } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Activated exactly as the publish route does it, so a later change in the app
// really fires them. Definitions must pass `validateDefinition` in @carbon/workflows.

const FORMAT_VERSION = 3;

// Mirrors each event's `match` block in the workflow catalog, spelled out here
// because @carbon/database cannot import @carbon/workflows (package cycle).
const EVENT_SOURCES: Record<string, { table: string; operation: string }> = {
  "salesOrder.created": { table: "salesOrder", operation: "INSERT" },
  "nonConformance.priority.changed": {
    table: "nonConformance",
    operation: "UPDATE"
  },
  "purchaseOrder.status.changed": {
    table: "purchaseOrder",
    operation: "UPDATE"
  }
};

type Node = {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number };
  expanded?: boolean;
  data: Record<string, unknown>;
};

type Edge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

type SeedWorkflow = {
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
};

const ref = (nodeId: string, output: string, path: string[] = []) => ({
  kind: "ref" as const,
  nodeId,
  output,
  path
});

const text = (value: string) => ({ kind: "text" as const, text: value });

const template = (parts: unknown[]) => ({ kind: "template" as const, parts });

const literal = (type: unknown, value: unknown) => ({
  kind: "literal" as const,
  type,
  value
});

const str = { kind: "primitive", of: "string" };
const num = { kind: "primitive", of: "number" };
const user = { kind: "entity", of: "user" };

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string
): Edge {
  return { id, source, target, sourceHandle, targetHandle: "in" };
}

function buildWorkflows(ownerId: string): SeedWorkflow[] {
  return [
    {
      name: "Assign new sales orders",
      description:
        "Puts every incoming sales order on someone's desk the moment it is created.",
      nodes: [
        {
          id: "trigger_order",
          name: "new_sales_order",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["salesOrder.created"], origin: "Both" }
        },
        {
          id: "action_assign",
          name: "assign_owner",
          type: "action",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            action: "salesOrder.update",
            inputs: {
              salesOrder: ref("trigger_order", "record"),
              assignee: literal(user, ownerId)
            },
            batch: false
          }
        }
      ],
      edges: [edge("edge_assign", "trigger_order", "action_assign", "out")]
    },

    {
      name: "Escalate high-priority issues",
      description:
        "Notifies the quality owner when an issue is raised to High or Critical.",
      nodes: [
        {
          id: "trigger_priority",
          name: "issue_priority_changed",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["nonConformance.priority.changed"], origin: "Both" }
        },
        {
          id: "condition_urgent",
          name: "is_urgent",
          type: "condition",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            paths: [
              {
                id: "path_urgent",
                kind: "if",
                combinator: "or",
                clauses: [
                  {
                    left: ref("trigger_priority", "after", ["priority"]),
                    operator: "eq",
                    right: literal(str, "High")
                  },
                  {
                    left: ref("trigger_priority", "after", ["priority"]),
                    operator: "eq",
                    right: literal(str, "Critical")
                  }
                ]
              },
              {
                id: "path_routine",
                kind: "else",
                combinator: "and",
                clauses: []
              }
            ]
          }
        },
        {
          id: "action_alert",
          name: "alert_quality",
          type: "action",
          position: { x: 960, y: -120 },
          expanded: true,
          data: {
            action: "notify",
            inputs: {
              user: literal(user, ownerId),
              subject: template([
                text("Issue "),
                ref("trigger_priority", "record", ["nonConformanceId"]),
                text(" is now "),
                ref("trigger_priority", "after", ["priority"])
              ]),
              message: template([
                text("Priority moved from "),
                ref("trigger_priority", "before", ["priority"]),
                text(" to "),
                ref("trigger_priority", "after", ["priority"]),
                text(". Please review the issue.")
              ]),
              aboutId: ref("trigger_priority", "record", ["id"]),
              aboutType: literal(str, "nonConformance")
            },
            batch: false
          }
        }
      ],
      edges: [
        edge("edge_check", "trigger_priority", "condition_urgent", "out"),
        edge("edge_alert", "condition_urgent", "action_alert", "path_urgent")
      ]
    },

    {
      name: "Flag large purchase orders",
      description:
        "Works out a purchase order's total when its status changes and flags anything over 10,000.",
      nodes: [
        {
          id: "trigger_po_status",
          name: "purchase_order_status_changed",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["purchaseOrder.status.changed"], origin: "Both" }
        },
        {
          id: "entity_total",
          name: "order_total",
          type: "entity",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            operation: "purchaseOrder.total",
            inputs: { purchaseOrder: ref("trigger_po_status", "record") }
          }
        },
        {
          id: "condition_large",
          name: "is_large_order",
          type: "condition",
          position: { x: 960, y: 0 },
          expanded: true,
          data: {
            paths: [
              {
                id: "path_large",
                kind: "if",
                combinator: "and",
                clauses: [
                  {
                    left: ref("entity_total", "result"),
                    operator: "gt",
                    right: literal(num, 10000)
                  }
                ]
              },
              { id: "path_small", kind: "else", combinator: "and", clauses: [] }
            ]
          }
        },
        {
          id: "action_flag",
          name: "flag_purchasing",
          type: "action",
          position: { x: 1440, y: -120 },
          expanded: true,
          data: {
            action: "notify",
            inputs: {
              user: literal(user, ownerId),
              subject: template([
                text("Purchase order "),
                ref("trigger_po_status", "record", ["purchaseOrderId"]),
                text(" is over 10,000")
              ]),
              message: template([
                text("Status is now "),
                ref("trigger_po_status", "after", ["status"]),
                text(". This order needs a second pair of eyes.")
              ]),
              aboutId: ref("trigger_po_status", "record", ["id"]),
              aboutType: literal(str, "purchaseOrder")
            },
            batch: false
          }
        }
      ],
      edges: [
        edge("edge_total", "trigger_po_status", "entity_total", "out"),
        edge("edge_size", "entity_total", "condition_large", "out"),
        edge("edge_flag", "condition_large", "action_flag", "path_large")
      ]
    }
  ];
}

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
    const source = EVENT_SOURCES[eventId];
    if (!source) throw new Error(`Seed: no event source for "${eventId}"`);
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
  const { userId } = ctx;
  const allEventIds: string[] = [];

  for (const workflow of buildWorkflows(userId)) {
    ctx.log(`workflow — ${workflow.name}`);

    const workflowId = await insertId(ctx, "workflow", {
      name: workflow.name,
      description: workflow.description,
      ownerId: userId,
      active: true
    });

    const versionId = await insertId(ctx, "workflowVersion", {
      workflowId,
      versionNumber: 1,
      formatVersion: FORMAT_VERSION,
      nodes: JSON.stringify(workflow.nodes),
      edges: JSON.stringify(workflow.edges)
    });

    await ctx.client.query(
      `UPDATE "workflow" SET "activeVersionId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
      [versionId, workflowId, ctx.companyId]
    );

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
