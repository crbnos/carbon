import type { ColumnOf, TableName } from "@carbon/database/audit.config";
import type {
  RegistryEntry,
  WatchedColumnLike,
  WritableColumnLike
} from "./build";

/** `watch`, `write`, and `describe` keys are bound to the entry's own table, so a renamed column fails to compile. */
interface EntityEntry<T extends TableName>
  extends Omit<RegistryEntry, "table" | "watch" | "write" | "describe"> {
  table: T;
  watch?: { [C in ColumnOf<T>]?: WatchedColumnLike };
  write?: { [C in ColumnOf<T>]?: WritableColumnLike };
  describe?: { [C in ColumnOf<T>]?: string };
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
    },
    describe: {
      status: "Current state of the purchase order (Draft, Submitted, etc.)",
      supplierId: "The supplier this purchase order is placed with",
      assignee: "Person responsible for managing this purchase order",
      orderDate: "The date the order was placed",
      purchaseOrderType:
        "Whether this is a standard purchase order or blanket order",
      supplierReference: "The supplier's own reference number for this order",
      supplierLocationId: "The supplier's location this order is sent to",
      tags: "Labels attached to this purchase order for filtering"
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
    },
    describe: {
      status: "Current state of the sales order",
      customerId: "The customer this sales order belongs to",
      assignee: "Person responsible for this sales order",
      salesPersonId: "The salesperson handling this order",
      orderDate: "The date the order was created",
      locationId: "The warehouse or location fulfilling this order",
      customerReference: "The customer's own reference or PO number",
      completedDate: "The date this order was completed"
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
    },
    describe: {
      status: "Current state of the job (Draft, In Progress, etc.)",
      assignee: "Person responsible for this production job",
      dueDate: "When this job must be completed",
      startDate: "When work on this job should begin",
      quantity: "The number of units to produce",
      priority: "Urgency level — higher number means higher priority",
      deadlineType: "Whether the due date is a hard or soft deadline",
      scrapQuantity: "Units scrapped during production"
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
    },
    describe: {
      active: "Whether this item is currently active and usable",
      revisionStatus: "The current revision lifecycle stage",
      replenishmentSystem: "How stock is replenished — Buy, Make, or Transfer",
      itemTrackingType:
        "Whether the item is tracked by lot, serial number, or not at all",
      defaultMethodType: "Default costing method for this item",
      assignee: "Person responsible for maintaining this item",
      name: "The display name of this item",
      unitOfMeasureCode: "The unit this item is measured and ordered in"
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
    write: { assignee: { label: "assignee", ref: "user", help: "assignee" } },
    describe: {
      status: "Current state of the receipt (Draft, Posted, etc.)",
      supplierId: "The supplier the goods were received from",
      locationId: "The warehouse location where goods were received",
      assignee: "Person responsible for this receipt",
      postingDate: "The date this receipt was posted to inventory",
      invoiced: "Whether this receipt has been matched to a supplier invoice",
      sourceDocument:
        "The purchase order or other document this receipt came from"
    }
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
    },
    describe: {
      status: "Current state of the shipment",
      customerId: "The customer this shipment is going to",
      locationId: "The warehouse location the goods are shipping from",
      assignee: "Person responsible for this shipment",
      postingDate: "The date this shipment was posted",
      trackingNumber: "Carrier tracking number for this shipment",
      shippingMethodId: "The shipping carrier or method used"
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
    },
    describe: {
      status: "Current state of the quote",
      customerId: "The customer this quote is for",
      assignee: "Person managing this quote",
      estimatorId: "The person who estimated the costs",
      salesPersonId: "The salesperson responsible for this quote",
      expirationDate: "Date after which this quote is no longer valid",
      dueDate: "When the customer needs a response",
      completedDate: "The date this quote was won or lost"
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
    },
    describe: {
      supplierStatus: "Current status of the supplier relationship",
      supplierTypeId: "The category or type of supplier",
      accountManagerId: "Internal person managing the supplier relationship",
      assignee: "Person primarily responsible for this supplier",
      name: "The supplier's display name",
      currencyCode: "The currency used when purchasing from this supplier",
      taxPercent: "Default tax rate applied to purchases from this supplier"
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
    },
    describe: {
      customerStatusId: "Current status of the customer relationship",
      customerTypeId: "The category or type of customer",
      accountManagerId: "Internal person managing the customer account",
      assignee: "Person primarily responsible for this customer",
      name: "The customer's display name",
      currencyCode: "The currency used when selling to this customer",
      salesContactId: "The main sales contact at this customer"
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
    },
    describe: {
      status: "Current state of the issue (Open, Under Review, Closed, etc.)",
      priority: "How urgently this issue needs to be resolved",
      assignee: "Person responsible for resolving this issue",
      source: "Where the issue was discovered (Production, Receiving, etc.)",
      nonConformanceTypeId: "The type or category of this issue",
      dueDate: "When this issue must be resolved",
      closeDate: "The date this issue was closed",
      locationId: "Location where the issue was found",
      quantity: "Quantity of units affected by this issue"
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
  nonConformanceType: entity({
    table: "nonConformanceType",
    label: "Issue type",
    permission: "quality"
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

/** The registry widened for iteration; `as const` above makes `Object.values` a union. */
export const REGISTRY_ENTRIES: Record<string, RegistryEntry> =
  WORKFLOW_ENTITY_REGISTRY;
