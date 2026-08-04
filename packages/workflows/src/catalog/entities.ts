import type { ColumnOf, TableName } from "@carbon/database/audit.config";
import type {
  RegistryEntry,
  WatchedColumnLike,
  WritableColumnLike
} from "./build";

/** `watch` and `write` keys are bound to the entry's own table, so a renamed column fails to compile. */
interface EntityEntry<T extends TableName>
  extends Omit<RegistryEntry, "table" | "watch" | "write"> {
  table: T;
  watch?: { [C in ColumnOf<T>]?: WatchedColumnLike };
  write?: { [C in ColumnOf<T>]?: WritableColumnLike };
}

/** Identity helper that infers `T` so `watch` keys get checked. */
const entity = <T extends TableName>(entry: EntityEntry<T>) => entry;

export const WORKFLOW_ENTITY_REGISTRY = {
  purchaseOrder: entity({
    table: "purchaseOrder",
    label: "Purchase order",
    help: "purchase-order",
    permission: "purchasing",
    watch: {
      status: { label: "status" },
      supplierId: { label: "supplier", ref: "supplier" },
      assignee: { label: "assignee", ref: "user" },
      orderDate: { label: "order date" },
      purchaseOrderType: { label: "type" },
      supplierReference: { label: "supplier reference" },
      supplierLocationId: { label: "supplier location" },
      tags: { label: "tags" }
    },
    write: {
      supplierReference: {
        label: "supplier reference",
        help: "purchase-order-supplier-order-number"
      },
      orderDate: { label: "order date" },
      assignee: { label: "assignee", ref: "user", help: "assignee" }
    }
  }),
  salesOrder: entity({
    table: "salesOrder",
    label: "Sales order",
    help: "sales-order",
    permission: "sales",
    watch: {
      status: { label: "status" },
      customerId: { label: "customer", ref: "customer" },
      assignee: { label: "assignee", ref: "user" },
      salesPersonId: { label: "salesperson", ref: "user" },
      orderDate: { label: "order date" },
      locationId: { label: "location", ref: "location" },
      customerReference: { label: "customer reference" },
      completedDate: { label: "completed date" }
    },
    write: {
      customerReference: {
        label: "customer reference",
        help: "customer-document-reference"
      },
      orderDate: { label: "order date" },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      salesPersonId: { label: "salesperson", ref: "user" }
    }
  }),
  job: entity({
    table: "job",
    label: "Job",
    help: "job",
    permission: "production",
    watch: {
      status: { label: "status" },
      assignee: { label: "assignee", ref: "user" },
      dueDate: { label: "due date" },
      startDate: { label: "start date" },
      quantity: { label: "quantity" },
      priority: { label: "priority" },
      deadlineType: { label: "deadline type" },
      scrapQuantity: { label: "scrap quantity" }
    },
    write: {
      dueDate: { label: "due date", help: "job-due-date" },
      startDate: { label: "start date" },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      priority: { label: "priority", help: "job-priority" },
      deadlineType: { label: "deadline type", help: "job-deadline-type" }
    }
  }),
  item: entity({
    table: "item",
    label: "Item",
    help: "item",
    permission: "parts",
    watch: {
      active: { label: "active" },
      revisionStatus: { label: "revision status" },
      replenishmentSystem: { label: "replenishment system" },
      itemTrackingType: { label: "tracking type" },
      defaultMethodType: { label: "default method type" },
      assignee: { label: "assignee", ref: "user" },
      name: { label: "name" },
      unitOfMeasureCode: { label: "unit of measure" }
    },
    write: {
      name: { label: "name" },
      assignee: { label: "assignee", ref: "user", help: "assignee" }
    }
  }),
  receipt: entity({
    table: "receipt",
    label: "Receipt",
    help: "receipt",
    permission: "inventory",
    watch: {
      status: { label: "status" },
      supplierId: { label: "supplier", ref: "supplier" },
      locationId: { label: "location", ref: "location" },
      assignee: { label: "assignee", ref: "user" },
      postingDate: { label: "posting date" },
      invoiced: { label: "invoiced" },
      sourceDocument: { label: "source document" }
    },
    write: { assignee: { label: "assignee", ref: "user", help: "assignee" } }
  }),
  shipment: entity({
    table: "shipment",
    label: "Shipment",
    help: "shipment",
    permission: "inventory",
    watch: {
      status: { label: "status" },
      customerId: { label: "customer", ref: "customer" },
      locationId: { label: "location", ref: "location" },
      assignee: { label: "assignee", ref: "user" },
      postingDate: { label: "posting date" },
      trackingNumber: { label: "tracking number" },
      shippingMethodId: { label: "shipping method" }
    },
    write: {
      trackingNumber: { label: "tracking number" },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      shippingMethodId: { label: "shipping method", help: "shipping-method" }
    }
  }),
  quote: entity({
    table: "quote",
    label: "Quote",
    help: "quote",
    permission: "sales",
    watch: {
      status: { label: "status" },
      customerId: { label: "customer", ref: "customer" },
      assignee: { label: "assignee", ref: "user" },
      estimatorId: { label: "estimator", ref: "user" },
      salesPersonId: { label: "salesperson", ref: "user" },
      expirationDate: { label: "expiration date" },
      dueDate: { label: "due date" },
      completedDate: { label: "completed date" }
    },
    write: {
      expirationDate: {
        label: "expiration date",
        help: "quote-expiration-date"
      },
      dueDate: { label: "due date" },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      estimatorId: { label: "estimator", ref: "user" },
      salesPersonId: { label: "salesperson", ref: "user" },
      customerReference: {
        label: "customer reference",
        help: "customer-document-reference"
      }
    }
  }),
  supplier: entity({
    table: "supplier",
    label: "Supplier",
    permission: "purchasing",
    watch: {
      supplierStatus: { label: "status" },
      supplierTypeId: { label: "type" },
      accountManagerId: { label: "account manager", ref: "user" },
      assignee: { label: "assignee", ref: "user" },
      name: { label: "name" },
      currencyCode: { label: "currency" },
      taxPercent: { label: "tax percent" }
    },
    write: {
      accountManagerId: {
        label: "account manager",
        ref: "user",
        help: "supplier-account-manager"
      },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      supplierTypeId: { label: "type", help: "supplier-type-field" }
    }
  }),
  customer: entity({
    table: "customer",
    label: "Customer",
    permission: "sales",
    watch: {
      customerStatusId: { label: "status" },
      customerTypeId: { label: "type" },
      accountManagerId: { label: "account manager", ref: "user" },
      assignee: { label: "assignee", ref: "user" },
      name: { label: "name" },
      currencyCode: { label: "currency" },
      salesContactId: { label: "sales contact" }
    },
    write: {
      accountManagerId: {
        label: "account manager",
        ref: "user",
        help: "customer-account-manager"
      },
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      customerTypeId: { label: "type", help: "customer-type-field" }
    }
  }),
  nonConformance: entity({
    table: "nonConformance",
    label: "Issue",
    help: "nonconformance",
    permission: "quality",
    watch: {
      status: { label: "status" },
      priority: { label: "priority" },
      assignee: { label: "assignee", ref: "user" },
      source: { label: "source" },
      nonConformanceTypeId: { label: "type" },
      dueDate: { label: "due date" },
      closeDate: { label: "close date" },
      locationId: { label: "location", ref: "location" },
      quantity: { label: "quantity" }
    },
    write: {
      assignee: { label: "assignee", ref: "user", help: "assignee" },
      priority: { label: "priority" },
      dueDate: { label: "due date" },
      nonConformanceTypeId: { label: "type", help: "issue-issue-type" }
    }
  }),

  // Reference-only entries below: no `watch`, so no events, but they are
  // dot-reachable as moment outputs and foreign-key targets.
  user: entity({
    table: "user",
    label: "User",
    article: "A",
    permission: "users"
  }),
  group: entity({
    table: "group",
    label: "Group",
    permission: "users"
  }),
  jobOperation: entity({
    table: "jobOperation",
    label: "Job operation",
    permission: "production"
  }),
  salesInvoice: entity({
    table: "salesInvoice",
    label: "Sales invoice",
    permission: "invoicing"
  }),
  purchaseInvoice: entity({
    table: "purchaseInvoice",
    label: "Purchase invoice",
    permission: "invoicing"
  }),
  location: entity({
    table: "location",
    label: "Location",
    permission: "resources"
  })
} as const;

export type RegistryEntityName = keyof typeof WORKFLOW_ENTITY_REGISTRY;

/** The registry widened for iteration; `as const` above makes `Object.values` a union. */
export const REGISTRY_ENTRIES: Record<string, RegistryEntry> =
  WORKFLOW_ENTITY_REGISTRY;
