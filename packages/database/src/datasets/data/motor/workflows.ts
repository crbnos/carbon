import type { Edge, SeedWorkflow } from "../../tiers/workflow-definitions.ts";
import type { WorkflowData } from "../../types.ts";

// A factory, not a constant: every definition names ids that only exist once the seed has run.

const ref = (nodeId: string, output: string, path: string[] = []) => ({
  kind: "ref" as const,
  nodeId,
  output,
  path
});

const item = (path: string[] = []) => ({ kind: "item" as const, path });

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
const issueType = { kind: "entity", of: "nonConformanceType" };

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string
): Edge {
  return { id, source, target, sourceHandle, targetHandle: "in" };
}

export function buildMotorWorkflows(refs: {
  ownerId: string;
  issueTypeId: string;
}): SeedWorkflow[] {
  const { ownerId, issueTypeId } = refs;
  return [
    {
      name: "Assign new sales orders",
      description:
        "Puts every incoming motor order on someone's desk the moment it is created.",
      active: true,
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
            }
          }
        }
      ],
      edges: [edge("edge_assign", "trigger_order", "action_assign", "out")]
    },

    {
      name: "Escalate high-priority issues",
      description:
        "Notifies the quality owner when an issue is raised to High or Critical.",
      active: false,
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
            }
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
      active: false,
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
          id: "compute_total",
          name: "order_total",
          type: "compute",
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
                    left: ref("compute_total", "result"),
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
            }
          }
        }
      ],
      edges: [
        edge("edge_total", "trigger_po_status", "compute_total", "out"),
        edge("edge_size", "compute_total", "condition_large", "out"),
        edge("edge_flag", "condition_large", "action_flag", "path_large")
      ]
    },

    {
      name: "Chase jobs that have not started producing",
      description:
        "Every weekday morning, finds in-progress jobs with nothing completed yet and puts each one back on the owner's desk.",
      active: false,
      nodes: [
        {
          id: "trigger_morning",
          name: "each_weekday_morning",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: {
            events: [],
            origin: "Both",
            schedule: {
              freq: "Weekly",
              hour: 6,
              minute: 30,
              weekdays: [1, 2, 3, 4, 5],
              tz: "America/Indiana/Indianapolis"
            }
          }
        },
        {
          id: "lookup_jobs",
          name: "jobs_in_progress",
          type: "lookup",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            entity: "job",
            returns: "list",
            match: [
              {
                field: "status",
                operator: "eq",
                value: literal(str, "In Progress")
              }
            ]
          }
        },
        {
          id: "filter_stalled",
          name: "nothing_completed_yet",
          type: "filter",
          position: { x: 960, y: 0 },
          expanded: true,
          data: {
            source: ref("lookup_jobs", "result"),
            combinator: "and",
            clauses: [
              {
                left: item(["quantityComplete"]),
                operator: "eq",
                right: literal(num, 0)
              }
            ]
          }
        },
        {
          id: "action_nudge",
          name: "reassign_each_job",
          type: "action",
          position: { x: 1440, y: 0 },
          expanded: true,
          data: {
            action: "job.update",
            inputs: {
              job: ref("filter_stalled", "result"),
              assignee: literal(user, ownerId)
            }
          }
        }
      ],
      edges: [
        edge("edge_find", "trigger_morning", "lookup_jobs", "out"),
        edge("edge_narrow", "lookup_jobs", "filter_stalled", "success"),
        edge("edge_nudge", "filter_stalled", "action_nudge", "out")
      ]
    },

    {
      name: "Announce a released job",
      description:
        "Tells whoever released a job that it is now on the floor. Fires on the business moment, not on a column change.",
      active: false,
      nodes: [
        {
          id: "trigger_released",
          name: "job_released",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["production.jobReleased"], origin: "Both" }
        },
        {
          id: "action_announce",
          name: "tell_the_releaser",
          type: "action",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            action: "notify",
            inputs: {
              user: ref("trigger_released", "releasedBy"),
              subject: template([
                text("Job "),
                ref("trigger_released", "job", ["jobId"]),
                text(" is on the floor")
              ]),
              message: template([
                text("You released "),
                ref("trigger_released", "job", ["jobId"]),
                text(" for a quantity of "),
                ref("trigger_released", "job", ["quantity"]),
                text(".")
              ]),
              aboutId: ref("trigger_released", "job", ["id"]),
              aboutType: literal(str, "job")
            }
          }
        }
      ],
      edges: [
        edge("edge_announce", "trigger_released", "action_announce", "out")
      ]
    },

    {
      name: "Open an issue when a shipment is voided",
      description:
        "A voided shipment usually means something went wrong in the warehouse — this raises the paperwork for it automatically.",
      active: false,
      nodes: [
        {
          id: "trigger_shipment",
          name: "shipment_status_changed",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["shipment.status.changed"], origin: "Both" }
        },
        {
          id: "condition_voided",
          name: "was_voided",
          type: "condition",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            paths: [
              {
                id: "path_voided",
                kind: "if",
                combinator: "and",
                clauses: [
                  {
                    left: ref("trigger_shipment", "after", ["status"]),
                    operator: "eq",
                    right: literal(str, "Voided")
                  }
                ]
              },
              { id: "path_other", kind: "else", combinator: "and", clauses: [] }
            ]
          }
        },
        {
          id: "action_raise",
          name: "raise_an_issue",
          type: "action",
          position: { x: 960, y: -120 },
          expanded: true,
          data: {
            action: "nonConformance.create",
            inputs: {
              name: template([
                text("Voided shipment "),
                ref("trigger_shipment", "record", ["shipmentId"])
              ]),
              description: template([
                text("Shipment "),
                ref("trigger_shipment", "record", ["shipmentId"]),
                text(" went from "),
                ref("trigger_shipment", "before", ["status"]),
                text(" to Voided. Record what happened and who was told.")
              ]),
              priority: literal(str, "Medium"),
              source: literal(str, "Internal"),
              locationId: ref("trigger_shipment", "record", ["locationId"]),
              nonConformanceTypeId: literal(issueType, issueTypeId)
            }
          }
        }
      ],
      edges: [
        edge("edge_voided", "trigger_shipment", "condition_voided", "out"),
        edge("edge_raise", "condition_voided", "action_raise", "path_voided")
      ]
    },

    {
      name: "Tell an outside system a supplier was approved",
      description:
        "Posts to a URL of your choosing when a supplier turns Active. Point the webhook at your own endpoint before switching this on.",
      active: false,
      nodes: [
        {
          id: "trigger_supplier",
          name: "supplier_status_changed",
          type: "trigger",
          position: { x: 0, y: 0 },
          expanded: true,
          data: { events: ["supplier.supplierStatus.changed"], origin: "Both" }
        },
        {
          id: "condition_active",
          name: "is_now_active",
          type: "condition",
          position: { x: 480, y: 0 },
          expanded: true,
          data: {
            paths: [
              {
                id: "path_active",
                kind: "if",
                combinator: "and",
                clauses: [
                  {
                    left: ref("trigger_supplier", "after", ["supplierStatus"]),
                    operator: "eq",
                    right: literal(str, "Active")
                  }
                ]
              },
              { id: "path_else", kind: "else", combinator: "and", clauses: [] }
            ]
          }
        },
        {
          id: "action_post",
          name: "post_to_endpoint",
          type: "action",
          position: { x: 960, y: -120 },
          expanded: true,
          data: {
            action: "webhook",
            inputs: {
              url: literal(str, "https://example.com/carbon/supplier-approved"),
              method: literal(str, "POST"),
              body: template([
                text('{"supplier":"'),
                ref("trigger_supplier", "record", ["name"]),
                text('","status":"'),
                ref("trigger_supplier", "after", ["supplierStatus"]),
                text('"}')
              ])
            }
          }
        }
      ],
      edges: [
        edge("edge_active", "trigger_supplier", "condition_active", "out"),
        edge("edge_post", "condition_active", "action_post", "path_active")
      ]
    }
  ];
}

export const motorWorkflows: WorkflowData = {
  build: buildMotorWorkflows
};
