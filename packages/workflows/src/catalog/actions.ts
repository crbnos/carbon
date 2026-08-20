import type { TermId } from "@carbon/glossary";
import type { RequiredPermission } from "../definition/catalog";
import { t, type ValueType } from "../definition/types";

export interface ActionInputLike {
  type: ValueType;
  required: boolean;
  label: string;
  template?: boolean;
  /** Prose a person reads: a record dropped in renders as a link. Not for webhook bodies,
   * where a markdown link would ship to someone else's API as literal text. */
  linkify?: boolean;
  /** Allowed literal values. The generated side infers these from the database schema;
   * a hand-written action is not a schema entity, so it must say so here. */
  choices?: readonly string[];
  /** What the builder seeds a new node with. Nothing reads it at run time. */
  defaultValue?: string | readonly string[];
  /** The value is a set of name/value rows. */
  pairs?: boolean;
  /** Only shown, and only required, while `input` holds one of `equals`. */
  showWhen?: { input: string; equals: readonly string[] };
  /** Glossary term whose definition explains this field. Rendered as the ⓘ hover. */
  help?: TermId;
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
      itemId: {
        type: t.entity("item"),
        required: true,
        label: "item",
        help: "item"
      },
      quantity: { type: t.number, required: true, label: "quantity" },
      dueDate: {
        type: t.date,
        required: false,
        label: "due date",
        help: "job-due-date"
      },
      salesOrderLineId: {
        type: t.string,
        required: false,
        label: "sales order line",
        help: "job-sales-order-line"
      }
    },
    outputs: { record: t.entity("job") },
    batchable: true,
    call: "production_insertJob"
  }),
  "nonConformance.create": action({
    label: "Create an issue",
    permission: { module: "quality", action: "create" },
    // `locationId`, `nonConformanceTypeId` and `source` are NOT NULL on the table with no
    // default, so they are required here however optional they look on the issue form.
    inputs: {
      name: { type: t.string, required: true, label: "title" },
      description: { type: t.string, required: false, label: "description" },
      priority: { type: t.string, required: true, label: "priority" },
      source: { type: t.string, required: true, label: "source" },
      locationId: {
        type: t.entity("location"),
        required: true,
        label: "location"
      },
      nonConformanceTypeId: {
        type: t.entity("nonConformanceType"),
        required: true,
        label: "type",
        help: "issue-issue-type"
      },
      // Optional so a customer can backdate; `insertIssue` stamps today otherwise.
      openDate: { type: t.date, required: false, label: "open date" }
    },
    outputs: { record: t.entity("nonConformance") },
    batchable: true,
    call: "quality_insertIssue"
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
        label: "supplier reference",
        help: "purchase-order-supplier-order-number"
      }
    },
    outputs: { record: t.entity("purchaseOrder") },
    batchable: true,
    call: "purchasing_insertPurchaseOrder"
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
        label: "customer reference",
        help: "customer-document-reference"
      }
    },
    outputs: { record: t.entity("salesOrder") },
    batchable: true,
    call: "sales_insertSalesOrder"
  }),
  notify: action({
    label: "Notify someone",
    permission: { module: "users", action: "view" },
    inputs: {
      user: { type: t.entity("user"), required: false, label: "person" },
      // The stored key stays `role`; renaming it would need a v4 format migration for a
      // label change, and the value is already a group id.
      role: { type: t.entity("group"), required: false, label: "group" },
      // In-app is always delivered whatever is stored here — the notify job adds it to
      // every notification — so this is optional rather than required: a required field
      // whose one guaranteed member cannot be ticked is a trap on older nodes.
      channels: {
        type: t.list({ kind: "primitive", of: "string" }),
        required: false,
        label: "notification type",
        choices: ["inApp", "email", "slack"],
        // What the action has always sent. An absent value means the same thing.
        defaultValue: ["inApp", "email"],
        help: "workflow-notify-channels"
      },
      subject: {
        type: t.string,
        required: true,
        label: "subject",
        template: true
      },
      // The body is prose someone reads, so a record dropped in becomes a link.
      // Deliberately not the subject: an email subject renders markdown literally.
      message: {
        type: t.string,
        required: false,
        label: "message",
        template: true,
        linkify: true
      },
      // The value model has no "any record" type, so the record is named in two parts.
      aboutId: {
        type: t.string,
        required: false,
        label: "about",
        help: "workflow-notify-about-record"
      },
      aboutType: {
        type: t.string,
        required: false,
        label: "kind of record",
        help: "workflow-notify-about-record"
      }
    },
    outputs: {},
    batchable: true,
    requireOneOf: [["user", "role"]]
  }),
  webhook: action({
    label: "Call an outside URL",
    permission: { module: "workflows", action: "update" },
    inputs: {
      url: {
        type: t.string,
        required: true,
        label: "URL",
        help: "workflow-webhook-url"
      },
      method: {
        type: t.string,
        required: true,
        choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        defaultValue: "GET",
        label: "method",
        help: "workflow-webhook-method"
      },
      headers: {
        type: t.string,
        required: false,
        pairs: true,
        label: "headers",
        help: "workflow-webhook-headers"
      },
      body: {
        type: t.string,
        required: false,
        template: true,
        showWhen: { input: "method", equals: ["POST", "PUT", "PATCH"] },
        label: "body",
        help: "workflow-webhook-body"
      }
    },
    outputs: { status: t.number },
    batchable: true
  })
} satisfies Record<string, ActionDeclarationLike>;
