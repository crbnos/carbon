import type { RequiredPermission } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";

export interface ActionInputLike {
  type: ValueType;
  required: boolean;
  label: string;
}

export interface ActionDeclarationLike {
  label: string;
  permission: RequiredPermission;
  inputs: Record<string, ActionInputLike>;
  outputs: Record<string, ValueType>;
  batchable: boolean;
  requireOneOf?: string[][];
  /** A tool name in tool-metadata.json, dispatched at run time. */
  call?: string;
  /** Set by the generator for the expanded update family; never hand-written. */
  update?: { entity: string };
}

/** Identity helper, so each entry's shape is checked where it is written. */
const action = (entry: ActionDeclarationLike) => entry;

// Hand-written actions. The `<entity>.update` family is generated from the
// registry's `write` allowlist instead — see build.ts.
export const WORKFLOW_ACTIONS = {
  "job.create": action({
    label: "Create a job",
    permission: { module: "production", action: "create" },
    inputs: {
      itemId: { type: t.entity("item"), required: true, label: "item" },
      quantity: { type: t.number, required: true, label: "quantity" },
      dueDate: { type: t.date, required: false, label: "due date" },
      salesOrderLineId: {
        type: t.string,
        required: false,
        label: "sales order line"
      }
    },
    outputs: { record: t.entity("job") },
    batchable: true,
    call: "production_upsertJob"
  }),
  "nonConformance.create": action({
    label: "Create an issue",
    permission: { module: "quality", action: "create" },
    inputs: {
      name: { type: t.string, required: true, label: "title" },
      description: { type: t.string, required: false, label: "description" },
      priority: { type: t.string, required: false, label: "priority" },
      locationId: {
        type: t.entity("location"),
        required: false,
        label: "location"
      }
    },
    outputs: { record: t.entity("nonConformance") },
    batchable: true,
    call: "quality_upsertIssue"
  }),
  "purchaseOrder.create": action({
    label: "Create a purchase order",
    permission: { module: "purchasing", action: "create" },
    inputs: {
      supplierId: {
        type: t.entity("supplier"),
        required: true,
        label: "supplier"
      },
      orderDate: { type: t.date, required: false, label: "order date" },
      supplierReference: {
        type: t.string,
        required: false,
        label: "supplier reference"
      }
    },
    outputs: { record: t.entity("purchaseOrder") },
    batchable: true,
    call: "purchasing_upsertPurchaseOrder"
  }),
  "salesOrder.create": action({
    label: "Create a sales order",
    permission: { module: "sales", action: "create" },
    inputs: {
      customerId: {
        type: t.entity("customer"),
        required: true,
        label: "customer"
      },
      orderDate: { type: t.date, required: false, label: "order date" },
      customerReference: {
        type: t.string,
        required: false,
        label: "customer reference"
      }
    },
    outputs: { record: t.entity("salesOrder") },
    batchable: true,
    call: "sales_upsertSalesOrder"
  }),
  notify: action({
    label: "Notify someone",
    permission: { module: "users", action: "view" },
    inputs: {
      user: { type: t.entity("user"), required: false, label: "person" },
      role: { type: t.entity("group"), required: false, label: "role" },
      subject: { type: t.string, required: true, label: "subject" },
      message: { type: t.string, required: false, label: "message" },
      // The value model has no "any record" type, so the record is named in two parts.
      aboutId: { type: t.string, required: false, label: "about" },
      aboutType: { type: t.string, required: false, label: "kind of record" }
    },
    outputs: {},
    batchable: true,
    requireOneOf: [["user", "role"]]
  }),
  webhook: action({
    label: "Call an outside URL",
    permission: { module: "workflows", action: "update" },
    inputs: {
      url: { type: t.string, required: true, label: "URL" },
      body: { type: t.string, required: false, label: "body" }
    },
    outputs: { status: t.number },
    batchable: true
  })
} satisfies Record<string, ActionDeclarationLike>;

export type WorkflowActionId = keyof typeof WORKFLOW_ACTIONS;
