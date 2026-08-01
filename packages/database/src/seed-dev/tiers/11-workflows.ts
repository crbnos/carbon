import { insertId, insertRow } from "../sql.ts";
import type { Ctx } from "../types.ts";

// Two workflows that reflect the satellite manufacturer theme.
// Both are inactive (active=FALSE) so no workflowTriggerEvent rows are needed.
// Each has one published version so the builder opens with a real definition.

const FORMAT_VERSION = 2;

// Convenience — builds the standard edge shape.
function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle = "out"
) {
  return { id, source, target, sourceHandle, targetHandle: "in" };
}

export async function runTier11(ctx: Ctx): Promise<void> {
  const { userId } = ctx;

  // ── Workflow 1: flag new sales orders ──────────────────────────────────────
  // Trigger: salesOrder.created → Update the order's assignee from a literal.
  ctx.log("workflow — sales order assignee");

  const wf1Id = await insertId(ctx, "workflow", {
    name: "Assign new sales orders",
    description: "Sets the assignee on every incoming sales order.",
    ownerId: userId,
    active: false
  });

  const wf1Nodes = [
    {
      id: "t1",
      type: "trigger",
      position: { x: 0, y: 0 },
      expanded: true,
      data: { events: ["salesOrder.created"], origin: "Both" }
    },
    {
      id: "a1",
      type: "action",
      title: "Assign order",
      position: { x: 480, y: 0 },
      expanded: true,
      data: {
        action: "salesOrder.update",
        inputs: {
          salesOrder: {
            kind: "ref",
            nodeId: "t1",
            output: "record",
            path: []
          }
        },
        batch: false
      }
    }
  ];

  const wf1Edges = [edge("e1", "t1", "a1")];

  const wf1VersionId = await insertId(ctx, "workflowVersion", {
    workflowId: wf1Id,
    versionNumber: 1,
    formatVersion: FORMAT_VERSION,
    nodes: JSON.stringify(wf1Nodes),
    edges: JSON.stringify(wf1Edges)
  });

  await insertRow(ctx, "workflowVersion", {
    workflowId: wf1Id,
    versionNumber: 2,
    formatVersion: FORMAT_VERSION,
    nodes: JSON.stringify(wf1Nodes),
    edges: JSON.stringify(wf1Edges)
  });

  await ctx.client.query(
    `UPDATE "workflow" SET "activeVersionId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
    [wf1VersionId, wf1Id, ctx.companyId]
  );

  // ── Workflow 2: quality gate on new POs ────────────────────────────────────
  // Trigger: purchaseOrder.created → Condition on total → branch to NCR.
  ctx.log("workflow — purchase order quality gate");

  const wf2Id = await insertId(ctx, "workflow", {
    name: "Flag high-value purchase orders",
    description: "Routes large purchase orders to quality review via an NCR.",
    ownerId: userId,
    active: false
  });

  const wf2Nodes = [
    {
      id: "t2",
      type: "trigger",
      position: { x: 0, y: 0 },
      expanded: true,
      data: { events: ["purchaseOrder.created"], origin: "Both" }
    },
    {
      id: "lk1",
      type: "lookup",
      title: "PO total",
      position: { x: 480, y: 0 },
      expanded: true,
      data: {
        entity: "purchaseOrder",
        returns: "one",
        match: []
      }
    },
    {
      id: "c1",
      type: "condition",
      title: "High value?",
      position: { x: 960, y: 0 },
      expanded: true,
      data: {
        paths: [
          {
            id: "p-if",
            kind: "if",
            combinator: "and",
            clauses: []
          },
          {
            id: "p-else",
            kind: "else",
            combinator: "and",
            clauses: []
          }
        ]
      }
    },
    {
      id: "a2",
      type: "action",
      title: "Open NCR",
      position: { x: 1440, y: -120 },
      expanded: true,
      data: {
        action: "nonConformance.create",
        inputs: {},
        batch: false
      }
    }
  ];

  const wf2Edges = [
    edge("e2", "t2", "lk1"),
    edge("e3", "lk1", "c1"),
    edge("e4", "c1", "a2", "p-if")
  ];

  const wf2VersionId = await insertId(ctx, "workflowVersion", {
    workflowId: wf2Id,
    versionNumber: 1,
    formatVersion: FORMAT_VERSION,
    nodes: JSON.stringify(wf2Nodes),
    edges: JSON.stringify(wf2Edges)
  });

  await ctx.client.query(
    `UPDATE "workflow" SET "activeVersionId" = $1 WHERE "id" = $2 AND "companyId" = $3`,
    [wf2VersionId, wf2Id, ctx.companyId]
  );
}
