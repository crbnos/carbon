// GENERATED FILE — do not edit. Run `pnpm run generate:workflow-catalog`.

import type { ValueType } from "../definition/types";
import type { BuiltEvent } from "./build";

export type { BuiltEvent as GeneratedEvent };

export const WORKFLOW_EVENTS: Record<string, BuiltEvent> = {
  "customer.accountManagerId.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "accountManagerId" }
  },
  "customer.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "assignee" }
  },
  "customer.created": {
    outputs: { record: { kind: "entity", of: "customer" } },
    permission: "sales",
    match: { table: "customer", operation: "INSERT" }
  },
  "customer.currencyCode.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "currencyCode" }
  },
  "customer.customerStatusId.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "customerStatusId" }
  },
  "customer.customerTypeId.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "customerTypeId" }
  },
  "customer.deleted": {
    outputs: { record: { kind: "entity", of: "customer" } },
    permission: "sales",
    match: { table: "customer", operation: "DELETE" }
  },
  "customer.name.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "name" }
  },
  "customer.salesContactId.changed": {
    outputs: {
      record: { kind: "entity", of: "customer" },
      before: { kind: "entity", of: "customer" },
      after: { kind: "entity", of: "customer" }
    },
    permission: "sales",
    match: { table: "customer", operation: "UPDATE", field: "salesContactId" }
  },
  "inventory.receiptPosted": {
    outputs: {
      receipt: { kind: "entity", of: "receipt" },
      postedBy: { kind: "entity", of: "user" }
    },
    permission: "inventory",
    match: { moment: "inventory.receiptPosted" }
  },
  "inventory.shipmentPosted": {
    outputs: {
      shipment: { kind: "entity", of: "shipment" },
      postedBy: { kind: "entity", of: "user" }
    },
    permission: "inventory",
    match: { moment: "inventory.shipmentPosted" }
  },
  "invoicing.purchaseInvoicePosted": {
    outputs: {
      purchaseInvoice: { kind: "entity", of: "purchaseInvoice" },
      postedBy: { kind: "entity", of: "user" }
    },
    permission: "invoicing",
    match: { moment: "invoicing.purchaseInvoicePosted" }
  },
  "invoicing.salesInvoicePosted": {
    outputs: {
      salesInvoice: { kind: "entity", of: "salesInvoice" },
      postedBy: { kind: "entity", of: "user" }
    },
    permission: "invoicing",
    match: { moment: "invoicing.salesInvoicePosted" }
  },
  "item.active.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "active" }
  },
  "item.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "assignee" }
  },
  "item.created": {
    outputs: { record: { kind: "entity", of: "item" } },
    permission: "parts",
    match: { table: "item", operation: "INSERT" }
  },
  "item.defaultMethodType.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "defaultMethodType" }
  },
  "item.deleted": {
    outputs: { record: { kind: "entity", of: "item" } },
    permission: "parts",
    match: { table: "item", operation: "DELETE" }
  },
  "item.itemTrackingType.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "itemTrackingType" }
  },
  "item.name.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "name" }
  },
  "item.replenishmentSystem.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "replenishmentSystem" }
  },
  "item.revisionStatus.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "revisionStatus" }
  },
  "item.unitOfMeasureCode.changed": {
    outputs: {
      record: { kind: "entity", of: "item" },
      before: { kind: "entity", of: "item" },
      after: { kind: "entity", of: "item" }
    },
    permission: "parts",
    match: { table: "item", operation: "UPDATE", field: "unitOfMeasureCode" }
  },
  "job.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "assignee" }
  },
  "job.created": {
    outputs: { record: { kind: "entity", of: "job" } },
    permission: "production",
    match: { table: "job", operation: "INSERT" }
  },
  "job.deadlineType.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "deadlineType" }
  },
  "job.deleted": {
    outputs: { record: { kind: "entity", of: "job" } },
    permission: "production",
    match: { table: "job", operation: "DELETE" }
  },
  "job.dueDate.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "dueDate" }
  },
  "job.priority.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "priority" }
  },
  "job.quantity.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "quantity" }
  },
  "job.scrapQuantity.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "scrapQuantity" }
  },
  "job.startDate.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "startDate" }
  },
  "job.status.changed": {
    outputs: {
      record: { kind: "entity", of: "job" },
      before: { kind: "entity", of: "job" },
      after: { kind: "entity", of: "job" }
    },
    permission: "production",
    match: { table: "job", operation: "UPDATE", field: "status" }
  },
  "nonConformance.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "assignee" }
  },
  "nonConformance.closeDate.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "closeDate" }
  },
  "nonConformance.created": {
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    permission: "quality",
    match: { table: "nonConformance", operation: "INSERT" }
  },
  "nonConformance.deleted": {
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    permission: "quality",
    match: { table: "nonConformance", operation: "DELETE" }
  },
  "nonConformance.dueDate.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "dueDate" }
  },
  "nonConformance.locationId.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "locationId" }
  },
  "nonConformance.nonConformanceTypeId.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: {
      table: "nonConformance",
      operation: "UPDATE",
      field: "nonConformanceTypeId"
    }
  },
  "nonConformance.priority.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "priority" }
  },
  "nonConformance.quantity.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "quantity" }
  },
  "nonConformance.source.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "source" }
  },
  "nonConformance.status.changed": {
    outputs: {
      record: { kind: "entity", of: "nonConformance" },
      before: { kind: "entity", of: "nonConformance" },
      after: { kind: "entity", of: "nonConformance" }
    },
    permission: "quality",
    match: { table: "nonConformance", operation: "UPDATE", field: "status" }
  },
  "production.jobHeld": {
    outputs: {
      job: { kind: "entity", of: "job" },
      heldBy: { kind: "entity", of: "user" }
    },
    permission: "production",
    match: { moment: "production.jobHeld" }
  },
  "production.jobOperationCompleted": {
    outputs: {
      job: { kind: "entity", of: "job" },
      jobOperation: { kind: "entity", of: "jobOperation" },
      completedBy: { kind: "entity", of: "user" }
    },
    permission: "production",
    match: { moment: "production.jobOperationCompleted" }
  },
  "production.jobReleased": {
    outputs: {
      job: { kind: "entity", of: "job" },
      releasedBy: { kind: "entity", of: "user" }
    },
    permission: "production",
    match: { moment: "production.jobReleased" }
  },
  "purchaseOrder.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "UPDATE", field: "assignee" }
  },
  "purchaseOrder.created": {
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "INSERT" }
  },
  "purchaseOrder.deleted": {
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "DELETE" }
  },
  "purchaseOrder.orderDate.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "UPDATE", field: "orderDate" }
  },
  "purchaseOrder.purchaseOrderType.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: {
      table: "purchaseOrder",
      operation: "UPDATE",
      field: "purchaseOrderType"
    }
  },
  "purchaseOrder.status.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "UPDATE", field: "status" }
  },
  "purchaseOrder.supplierId.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "UPDATE", field: "supplierId" }
  },
  "purchaseOrder.supplierLocationId.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: {
      table: "purchaseOrder",
      operation: "UPDATE",
      field: "supplierLocationId"
    }
  },
  "purchaseOrder.supplierReference.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: {
      table: "purchaseOrder",
      operation: "UPDATE",
      field: "supplierReference"
    }
  },
  "purchaseOrder.tags.changed": {
    outputs: {
      record: { kind: "entity", of: "purchaseOrder" },
      before: { kind: "entity", of: "purchaseOrder" },
      after: { kind: "entity", of: "purchaseOrder" }
    },
    permission: "purchasing",
    match: { table: "purchaseOrder", operation: "UPDATE", field: "tags" }
  },
  "quote.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "assignee" }
  },
  "quote.completedDate.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "completedDate" }
  },
  "quote.created": {
    outputs: { record: { kind: "entity", of: "quote" } },
    permission: "sales",
    match: { table: "quote", operation: "INSERT" }
  },
  "quote.customerId.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "customerId" }
  },
  "quote.deleted": {
    outputs: { record: { kind: "entity", of: "quote" } },
    permission: "sales",
    match: { table: "quote", operation: "DELETE" }
  },
  "quote.dueDate.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "dueDate" }
  },
  "quote.estimatorId.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "estimatorId" }
  },
  "quote.expirationDate.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "expirationDate" }
  },
  "quote.salesPersonId.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "salesPersonId" }
  },
  "quote.status.changed": {
    outputs: {
      record: { kind: "entity", of: "quote" },
      before: { kind: "entity", of: "quote" },
      after: { kind: "entity", of: "quote" }
    },
    permission: "sales",
    match: { table: "quote", operation: "UPDATE", field: "status" }
  },
  "receipt.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "assignee" }
  },
  "receipt.created": {
    outputs: { record: { kind: "entity", of: "receipt" } },
    permission: "inventory",
    match: { table: "receipt", operation: "INSERT" }
  },
  "receipt.deleted": {
    outputs: { record: { kind: "entity", of: "receipt" } },
    permission: "inventory",
    match: { table: "receipt", operation: "DELETE" }
  },
  "receipt.invoiced.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "invoiced" }
  },
  "receipt.locationId.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "locationId" }
  },
  "receipt.postingDate.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "postingDate" }
  },
  "receipt.sourceDocument.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "sourceDocument" }
  },
  "receipt.status.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "status" }
  },
  "receipt.supplierId.changed": {
    outputs: {
      record: { kind: "entity", of: "receipt" },
      before: { kind: "entity", of: "receipt" },
      after: { kind: "entity", of: "receipt" }
    },
    permission: "inventory",
    match: { table: "receipt", operation: "UPDATE", field: "supplierId" }
  },
  "sales.quoteAccepted": {
    outputs: {
      quote: { kind: "entity", of: "quote" },
      salesOrder: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { moment: "sales.quoteAccepted" }
  },
  "sales.quoteSent": {
    outputs: {
      quote: { kind: "entity", of: "quote" },
      sentBy: { kind: "entity", of: "user" }
    },
    permission: "sales",
    match: { moment: "sales.quoteSent" }
  },
  "salesOrder.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "assignee" }
  },
  "salesOrder.completedDate.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "completedDate" }
  },
  "salesOrder.created": {
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    permission: "sales",
    match: { table: "salesOrder", operation: "INSERT" }
  },
  "salesOrder.customerId.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "customerId" }
  },
  "salesOrder.customerReference.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: {
      table: "salesOrder",
      operation: "UPDATE",
      field: "customerReference"
    }
  },
  "salesOrder.deleted": {
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    permission: "sales",
    match: { table: "salesOrder", operation: "DELETE" }
  },
  "salesOrder.locationId.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "locationId" }
  },
  "salesOrder.orderDate.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "orderDate" }
  },
  "salesOrder.salesPersonId.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "salesPersonId" }
  },
  "salesOrder.status.changed": {
    outputs: {
      record: { kind: "entity", of: "salesOrder" },
      before: { kind: "entity", of: "salesOrder" },
      after: { kind: "entity", of: "salesOrder" }
    },
    permission: "sales",
    match: { table: "salesOrder", operation: "UPDATE", field: "status" }
  },
  "shipment.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "assignee" }
  },
  "shipment.created": {
    outputs: { record: { kind: "entity", of: "shipment" } },
    permission: "inventory",
    match: { table: "shipment", operation: "INSERT" }
  },
  "shipment.customerId.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "customerId" }
  },
  "shipment.deleted": {
    outputs: { record: { kind: "entity", of: "shipment" } },
    permission: "inventory",
    match: { table: "shipment", operation: "DELETE" }
  },
  "shipment.locationId.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "locationId" }
  },
  "shipment.postingDate.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "postingDate" }
  },
  "shipment.shippingMethodId.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "shippingMethodId" }
  },
  "shipment.status.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "status" }
  },
  "shipment.trackingNumber.changed": {
    outputs: {
      record: { kind: "entity", of: "shipment" },
      before: { kind: "entity", of: "shipment" },
      after: { kind: "entity", of: "shipment" }
    },
    permission: "inventory",
    match: { table: "shipment", operation: "UPDATE", field: "trackingNumber" }
  },
  "supplier.accountManagerId.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "accountManagerId" }
  },
  "supplier.assignee.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "assignee" }
  },
  "supplier.created": {
    outputs: { record: { kind: "entity", of: "supplier" } },
    permission: "purchasing",
    match: { table: "supplier", operation: "INSERT" }
  },
  "supplier.currencyCode.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "currencyCode" }
  },
  "supplier.deleted": {
    outputs: { record: { kind: "entity", of: "supplier" } },
    permission: "purchasing",
    match: { table: "supplier", operation: "DELETE" }
  },
  "supplier.name.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "name" }
  },
  "supplier.supplierStatus.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "supplierStatus" }
  },
  "supplier.supplierTypeId.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "supplierTypeId" }
  },
  "supplier.taxPercent.changed": {
    outputs: {
      record: { kind: "entity", of: "supplier" },
      before: { kind: "entity", of: "supplier" },
      after: { kind: "entity", of: "supplier" }
    },
    permission: "purchasing",
    match: { table: "supplier", operation: "UPDATE", field: "taxPercent" }
  }
};

export const WORKFLOW_ENTITIES: Record<string, Record<string, ValueType>> = {
  customer: {
    id: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    customerTypeId: { kind: "primitive", of: "string" },
    customerStatusId: { kind: "primitive", of: "string" },
    accountManagerId: { kind: "entity", of: "user" },
    logo: { kind: "primitive", of: "string" },
    assignee: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    currencyCode: { kind: "primitive", of: "string" },
    phone: { kind: "primitive", of: "string" },
    fax: { kind: "primitive", of: "string" },
    website: { kind: "primitive", of: "string" },
    taxPercent: { kind: "primitive", of: "number" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    salesContactId: { kind: "primitive", of: "string" },
    defaultCc: { kind: "list", of: { kind: "primitive", of: "string" } },
    intercompanyCompanyId: { kind: "primitive", of: "string" },
    readableId: { kind: "primitive", of: "string" }
  },
  group: {
    id: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    isIdentityGroup: { kind: "primitive", of: "boolean" },
    isEmployeeTypeGroup: { kind: "primitive", of: "boolean" },
    isCustomerOrgGroup: { kind: "primitive", of: "boolean" },
    isCustomerTypeGroup: { kind: "primitive", of: "boolean" },
    isSupplierTypeGroup: { kind: "primitive", of: "boolean" },
    isSupplierOrgGroup: { kind: "primitive", of: "boolean" },
    createdAt: { kind: "primitive", of: "date" }
  },
  item: {
    id: { kind: "primitive", of: "string" },
    readableId: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    description: { kind: "primitive", of: "string" },
    type: { kind: "primitive", of: "string" },
    replenishmentSystem: { kind: "primitive", of: "string" },
    defaultMethodType: { kind: "primitive", of: "string" },
    itemTrackingType: { kind: "primitive", of: "string" },
    unitOfMeasureCode: { kind: "primitive", of: "string" },
    active: { kind: "primitive", of: "boolean" },
    createdBy: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    assignee: { kind: "entity", of: "user" },
    modelUploadId: { kind: "primitive", of: "string" },
    thumbnailPath: { kind: "primitive", of: "string" },
    notes: { kind: "primitive", of: "string" },
    trackingMethod: { kind: "primitive", of: "string" },
    revision: { kind: "primitive", of: "string" },
    readableIdWithRevision: { kind: "primitive", of: "string" },
    sourcingType: { kind: "primitive", of: "string" },
    mpn: { kind: "primitive", of: "string" },
    revisionStatus: { kind: "primitive", of: "string" },
    changeOrderId: { kind: "primitive", of: "string" }
  },
  job: {
    id: { kind: "primitive", of: "string" },
    jobId: { kind: "primitive", of: "string" },
    itemId: { kind: "entity", of: "item" },
    unitOfMeasureCode: { kind: "primitive", of: "string" },
    customerId: { kind: "primitive", of: "string" },
    locationId: { kind: "entity", of: "location" },
    status: { kind: "primitive", of: "string" },
    dueDate: { kind: "primitive", of: "date" },
    deadlineType: { kind: "primitive", of: "string" },
    quantity: { kind: "primitive", of: "number" },
    scrapQuantity: { kind: "primitive", of: "number" },
    productionQuantity: { kind: "primitive", of: "number" },
    quantityComplete: { kind: "primitive", of: "number" },
    quantityShipped: { kind: "primitive", of: "number" },
    quantityReceivedToInventory: { kind: "primitive", of: "number" },
    salesOrderId: { kind: "entity", of: "salesOrder" },
    salesOrderLineId: { kind: "primitive", of: "string" },
    quoteId: { kind: "entity", of: "quote" },
    quoteLineId: { kind: "primitive", of: "string" },
    modelUploadId: { kind: "primitive", of: "string" },
    notes: { kind: "primitive", of: "string" },
    assignee: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    configuration: { kind: "primitive", of: "string" },
    releasedDate: { kind: "primitive", of: "date" },
    completedDate: { kind: "primitive", of: "date" },
    estimatedTime: { kind: "primitive", of: "number" },
    actualTime: { kind: "primitive", of: "number" },
    secondsToComplete: { kind: "primitive", of: "number" },
    startDate: { kind: "primitive", of: "date" },
    storageUnitId: { kind: "primitive", of: "string" },
    priority: { kind: "primitive", of: "number" }
  },
  jobOperation: {
    id: { kind: "primitive", of: "string" },
    jobId: { kind: "entity", of: "job" },
    jobMakeMethodId: { kind: "primitive", of: "string" },
    order: { kind: "primitive", of: "number" },
    processId: { kind: "primitive", of: "string" },
    workCenterId: { kind: "primitive", of: "string" },
    description: { kind: "primitive", of: "string" },
    setupTime: { kind: "primitive", of: "number" },
    setupUnit: { kind: "primitive", of: "string" },
    laborTime: { kind: "primitive", of: "number" },
    laborUnit: { kind: "primitive", of: "string" },
    machineTime: { kind: "primitive", of: "number" },
    machineUnit: { kind: "primitive", of: "string" },
    operationOrder: { kind: "primitive", of: "string" },
    laborRate: { kind: "primitive", of: "number" },
    overheadRate: { kind: "primitive", of: "number" },
    machineRate: { kind: "primitive", of: "number" },
    operationType: { kind: "primitive", of: "string" },
    operationMinimumCost: { kind: "primitive", of: "number" },
    operationLeadTime: { kind: "primitive", of: "number" },
    operationUnitCost: { kind: "primitive", of: "number" },
    operationSupplierProcessId: { kind: "primitive", of: "string" },
    workInstruction: { kind: "primitive", of: "string" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    operationQuantity: { kind: "primitive", of: "number" },
    quantityComplete: { kind: "primitive", of: "number" },
    quantityScrapped: { kind: "primitive", of: "number" },
    quantityReworked: { kind: "primitive", of: "number" },
    status: { kind: "primitive", of: "string" },
    priority: { kind: "primitive", of: "number" },
    assignee: { kind: "entity", of: "user" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    procedureId: { kind: "primitive", of: "string" },
    startDate: { kind: "primitive", of: "date" },
    dueDate: { kind: "primitive", of: "date" },
    hasConflict: { kind: "primitive", of: "boolean" },
    conflictReason: { kind: "primitive", of: "string" },
    targetQuantity: { kind: "primitive", of: "number" },
    manuallyScheduled: { kind: "primitive", of: "boolean" },
    reworkId: { kind: "primitive", of: "string" },
    assemblyInstructionId: { kind: "primitive", of: "string" },
    inspectionDocumentId: { kind: "primitive", of: "string" }
  },
  location: {
    id: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    addressLine1: { kind: "primitive", of: "string" },
    addressLine2: { kind: "primitive", of: "string" },
    city: { kind: "primitive", of: "string" },
    stateProvince: { kind: "primitive", of: "string" },
    postalCode: { kind: "primitive", of: "string" },
    countryCode: { kind: "primitive", of: "string" },
    timezone: { kind: "primitive", of: "string" },
    latitude: { kind: "primitive", of: "number" },
    longitude: { kind: "primitive", of: "number" },
    createdBy: { kind: "primitive", of: "string" },
    createdAt: { kind: "primitive", of: "date" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    code: { kind: "primitive", of: "string" }
  },
  nonConformance: {
    id: { kind: "primitive", of: "string" },
    nonConformanceId: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    description: { kind: "primitive", of: "string" },
    source: { kind: "primitive", of: "string" },
    status: { kind: "primitive", of: "string" },
    priority: { kind: "primitive", of: "string" },
    approvalRequirements: {
      kind: "list",
      of: { kind: "primitive", of: "string" }
    },
    nonConformanceWorkflowId: { kind: "primitive", of: "string" },
    content: { kind: "primitive", of: "string" },
    locationId: { kind: "entity", of: "location" },
    nonConformanceTypeId: { kind: "entity", of: "nonConformanceType" },
    openDate: { kind: "primitive", of: "date" },
    dueDate: { kind: "primitive", of: "date" },
    closeDate: { kind: "primitive", of: "date" },
    quantity: { kind: "primitive", of: "number" },
    assignee: { kind: "entity", of: "user" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    requiredActionIds: { kind: "list", of: { kind: "primitive", of: "string" } }
  },
  nonConformanceType: {
    id: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" }
  },
  purchaseInvoice: {
    id: { kind: "primitive", of: "string" },
    invoiceId: { kind: "primitive", of: "string" },
    supplierId: { kind: "primitive", of: "string" },
    supplierReference: { kind: "primitive", of: "string" },
    invoiceSupplierId: { kind: "primitive", of: "string" },
    invoiceSupplierLocationId: { kind: "primitive", of: "string" },
    invoiceSupplierContactId: { kind: "primitive", of: "string" },
    paymentTermId: { kind: "primitive", of: "string" },
    currencyCode: { kind: "primitive", of: "string" },
    exchangeRate: { kind: "primitive", of: "number" },
    postingDate: { kind: "primitive", of: "date" },
    dateIssued: { kind: "primitive", of: "date" },
    dateDue: { kind: "primitive", of: "date" },
    datePaid: { kind: "primitive", of: "date" },
    subtotal: { kind: "primitive", of: "number" },
    totalDiscount: { kind: "primitive", of: "number" },
    totalAmount: { kind: "primitive", of: "number" },
    totalTax: { kind: "primitive", of: "number" },
    assignee: { kind: "entity", of: "user" },
    createdBy: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    supplierInteractionId: { kind: "primitive", of: "string" },
    internalNotes: { kind: "primitive", of: "string" },
    exchangeRateUpdatedAt: { kind: "primitive", of: "date" },
    locationId: { kind: "entity", of: "location" },
    status: { kind: "primitive", of: "string" }
  },
  purchaseOrder: {
    id: { kind: "primitive", of: "string" },
    purchaseOrderId: { kind: "primitive", of: "string" },
    revisionId: { kind: "primitive", of: "number" },
    status: { kind: "primitive", of: "string" },
    orderDate: { kind: "primitive", of: "date" },
    supplierId: { kind: "entity", of: "supplier" },
    supplierLocationId: { kind: "primitive", of: "string" },
    supplierContactId: { kind: "primitive", of: "string" },
    supplierReference: { kind: "primitive", of: "string" },
    assignee: { kind: "entity", of: "user" },
    closedAt: { kind: "primitive", of: "date" },
    closedBy: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    currencyCode: { kind: "primitive", of: "string" },
    exchangeRate: { kind: "primitive", of: "number" },
    exchangeRateUpdatedAt: { kind: "primitive", of: "date" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    internalNotes: { kind: "primitive", of: "string" },
    externalNotes: { kind: "primitive", of: "string" },
    supplierInteractionId: { kind: "primitive", of: "string" },
    purchaseOrderType: { kind: "primitive", of: "string" },
    jobId: { kind: "entity", of: "job" },
    jobReadableId: { kind: "primitive", of: "string" }
  },
  quote: {
    id: { kind: "primitive", of: "string" },
    quoteId: { kind: "primitive", of: "string" },
    revisionId: { kind: "primitive", of: "number" },
    dueDate: { kind: "primitive", of: "date" },
    expirationDate: { kind: "primitive", of: "date" },
    status: { kind: "primitive", of: "string" },
    salesPersonId: { kind: "entity", of: "user" },
    estimatorId: { kind: "entity", of: "user" },
    customerId: { kind: "entity", of: "customer" },
    customerLocationId: { kind: "primitive", of: "string" },
    customerContactId: { kind: "primitive", of: "string" },
    customerReference: { kind: "primitive", of: "string" },
    locationId: { kind: "entity", of: "location" },
    assignee: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    externalNotes: { kind: "primitive", of: "string" },
    internalNotes: { kind: "primitive", of: "string" },
    currencyCode: { kind: "primitive", of: "string" },
    exchangeRate: { kind: "primitive", of: "number" },
    exchangeRateUpdatedAt: { kind: "primitive", of: "date" },
    externalLinkId: { kind: "primitive", of: "string" },
    digitalQuoteAcceptedBy: { kind: "primitive", of: "string" },
    digitalQuoteAcceptedByEmail: { kind: "primitive", of: "string" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    digitalQuoteRejectedBy: { kind: "primitive", of: "string" },
    digitalQuoteRejectedByEmail: { kind: "primitive", of: "string" },
    opportunityId: { kind: "primitive", of: "string" },
    completedDate: { kind: "primitive", of: "date" },
    customerEngineeringContactId: { kind: "primitive", of: "string" }
  },
  receipt: {
    id: { kind: "primitive", of: "string" },
    receiptId: { kind: "primitive", of: "string" },
    locationId: { kind: "entity", of: "location" },
    sourceDocument: { kind: "primitive", of: "string" },
    sourceDocumentId: { kind: "primitive", of: "string" },
    sourceDocumentReadableId: { kind: "primitive", of: "string" },
    externalDocumentId: { kind: "primitive", of: "string" },
    supplierId: { kind: "entity", of: "supplier" },
    status: { kind: "primitive", of: "string" },
    postingDate: { kind: "primitive", of: "date" },
    invoiced: { kind: "primitive", of: "boolean" },
    assignee: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    internalNotes: { kind: "primitive", of: "string" },
    supplierInteractionId: { kind: "primitive", of: "string" },
    postedBy: { kind: "entity", of: "user" }
  },
  salesInvoice: {
    id: { kind: "primitive", of: "string" },
    invoiceId: { kind: "primitive", of: "string" },
    status: { kind: "primitive", of: "string" },
    customerId: { kind: "primitive", of: "string" },
    customerReference: { kind: "primitive", of: "string" },
    invoiceCustomerId: { kind: "primitive", of: "string" },
    invoiceCustomerLocationId: { kind: "primitive", of: "string" },
    invoiceCustomerContactId: { kind: "primitive", of: "string" },
    paymentTermId: { kind: "primitive", of: "string" },
    postingDate: { kind: "primitive", of: "date" },
    dateIssued: { kind: "primitive", of: "date" },
    dateDue: { kind: "primitive", of: "date" },
    datePaid: { kind: "primitive", of: "date" },
    locationId: { kind: "entity", of: "location" },
    currencyCode: { kind: "primitive", of: "string" },
    subtotal: { kind: "primitive", of: "number" },
    totalDiscount: { kind: "primitive", of: "number" },
    totalAmount: { kind: "primitive", of: "number" },
    totalTax: { kind: "primitive", of: "number" },
    exchangeRate: { kind: "primitive", of: "number" },
    exchangeRateUpdatedAt: { kind: "primitive", of: "date" },
    opportunityId: { kind: "primitive", of: "string" },
    shipmentId: { kind: "entity", of: "shipment" },
    assignee: { kind: "primitive", of: "string" },
    internalNotes: { kind: "primitive", of: "string" },
    externalNotes: { kind: "primitive", of: "string" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" }
  },
  salesOrder: {
    id: { kind: "primitive", of: "string" },
    salesOrderId: { kind: "primitive", of: "string" },
    revisionId: { kind: "primitive", of: "number" },
    status: { kind: "primitive", of: "string" },
    orderDate: { kind: "primitive", of: "date" },
    currencyCode: { kind: "primitive", of: "string" },
    customerId: { kind: "entity", of: "customer" },
    customerLocationId: { kind: "primitive", of: "string" },
    customerContactId: { kind: "primitive", of: "string" },
    customerReference: { kind: "primitive", of: "string" },
    assignee: { kind: "entity", of: "user" },
    closedAt: { kind: "primitive", of: "date" },
    closedBy: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    locationId: { kind: "entity", of: "location" },
    exchangeRate: { kind: "primitive", of: "number" },
    exchangeRateUpdatedAt: { kind: "primitive", of: "date" },
    externalNotes: { kind: "primitive", of: "string" },
    internalNotes: { kind: "primitive", of: "string" },
    salesPersonId: { kind: "entity", of: "user" },
    sentCompleteDate: { kind: "primitive", of: "date" },
    opportunityId: { kind: "primitive", of: "string" },
    completedDate: { kind: "primitive", of: "date" },
    customerEngineeringContactId: { kind: "primitive", of: "string" }
  },
  shipment: {
    id: { kind: "primitive", of: "string" },
    shipmentId: { kind: "primitive", of: "string" },
    locationId: { kind: "entity", of: "location" },
    sourceDocument: { kind: "primitive", of: "string" },
    sourceDocumentId: { kind: "primitive", of: "string" },
    sourceDocumentReadableId: { kind: "primitive", of: "string" },
    shippingMethodId: { kind: "primitive", of: "string" },
    trackingNumber: { kind: "primitive", of: "string" },
    customerId: { kind: "entity", of: "customer" },
    status: { kind: "primitive", of: "string" },
    postingDate: { kind: "primitive", of: "date" },
    postedBy: { kind: "entity", of: "user" },
    invoiced: { kind: "primitive", of: "boolean" },
    assignee: { kind: "entity", of: "user" },
    internalNotes: { kind: "primitive", of: "string" },
    externalNotes: { kind: "primitive", of: "string" },
    opportunityId: { kind: "primitive", of: "string" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    supplierId: { kind: "primitive", of: "string" },
    supplierInteractionId: { kind: "primitive", of: "string" },
    externalDocumentId: { kind: "primitive", of: "string" }
  },
  supplier: {
    id: { kind: "primitive", of: "string" },
    name: { kind: "primitive", of: "string" },
    supplierTypeId: { kind: "primitive", of: "string" },
    accountManagerId: { kind: "entity", of: "user" },
    logo: { kind: "primitive", of: "string" },
    assignee: { kind: "entity", of: "user" },
    createdAt: { kind: "primitive", of: "date" },
    createdBy: { kind: "entity", of: "user" },
    currencyCode: { kind: "primitive", of: "string" },
    phone: { kind: "primitive", of: "string" },
    fax: { kind: "primitive", of: "string" },
    website: { kind: "primitive", of: "string" },
    tags: { kind: "list", of: { kind: "primitive", of: "string" } },
    taxPercent: { kind: "primitive", of: "number" },
    purchasingContactId: { kind: "primitive", of: "string" },
    defaultCc: { kind: "list", of: { kind: "primitive", of: "string" } },
    supplierStatus: { kind: "primitive", of: "string" },
    intercompanyCompanyId: { kind: "primitive", of: "string" },
    readableId: { kind: "primitive", of: "string" }
  },
  user: {
    id: { kind: "primitive", of: "string" },
    email: { kind: "primitive", of: "string" },
    firstName: { kind: "primitive", of: "string" },
    lastName: { kind: "primitive", of: "string" },
    fullName: { kind: "primitive", of: "string" },
    about: { kind: "primitive", of: "string" },
    avatarUrl: { kind: "primitive", of: "string" },
    active: { kind: "primitive", of: "boolean" },
    createdAt: { kind: "primitive", of: "date" },
    developer: { kind: "primitive", of: "boolean" },
    admin: { kind: "primitive", of: "boolean" },
    acknowledgedITAR: { kind: "primitive", of: "boolean" },
    flags: { kind: "primitive", of: "string" },
    isConsoleOperator: { kind: "primitive", of: "boolean" },
    phone: { kind: "primitive", of: "string" }
  }
};

export const WORKFLOW_ENTITY_ENUMS: Record<
  string,
  Record<string, readonly string[]>
> = {
  item: {
    type: ["Part", "Material", "Tool", "Service", "Consumable", "Fixture"],
    replenishmentSystem: ["Buy", "Make", "Buy and Make"],
    defaultMethodType: [
      "Purchase to Order",
      "Pull from Inventory",
      "Make to Order"
    ],
    itemTrackingType: ["Inventory", "Non-Inventory", "Serial", "Batch"],
    sourcingType: ["Specified", "Drop Ship", "Ship from Inventory"],
    revisionStatus: ["Design", "Prototype", "Production", "Obsolete"]
  },
  job: {
    status: [
      "Draft",
      "Ready",
      "In Progress",
      "Paused",
      "Completed",
      "Cancelled",
      "Overdue",
      "Due Today",
      "Planned",
      "Closed"
    ],
    deadlineType: ["No Deadline", "ASAP", "Soft Deadline", "Hard Deadline"]
  },
  jobOperation: {
    setupUnit: [
      "Hours/Piece",
      "Hours/100 Pieces",
      "Hours/1000 Pieces",
      "Minutes/Piece",
      "Minutes/100 Pieces",
      "Minutes/1000 Pieces",
      "Pieces/Hour",
      "Pieces/Minute",
      "Seconds/Piece",
      "Total Hours",
      "Total Minutes"
    ],
    laborUnit: [
      "Hours/Piece",
      "Hours/100 Pieces",
      "Hours/1000 Pieces",
      "Minutes/Piece",
      "Minutes/100 Pieces",
      "Minutes/1000 Pieces",
      "Pieces/Hour",
      "Pieces/Minute",
      "Seconds/Piece",
      "Total Hours",
      "Total Minutes"
    ],
    machineUnit: [
      "Hours/Piece",
      "Hours/100 Pieces",
      "Hours/1000 Pieces",
      "Minutes/Piece",
      "Minutes/100 Pieces",
      "Minutes/1000 Pieces",
      "Pieces/Hour",
      "Pieces/Minute",
      "Seconds/Piece",
      "Total Hours",
      "Total Minutes"
    ],
    operationOrder: ["After Previous", "With Previous"],
    operationType: ["Process", "Assembly", "Inspection", "Outside Processing"],
    status: [
      "Canceled",
      "Done",
      "In Progress",
      "Paused",
      "Ready",
      "Todo",
      "Waiting"
    ]
  },
  nonConformance: {
    source: ["Internal", "External"],
    status: ["Registered", "In Progress", "Closed"],
    priority: ["Low", "Medium", "High", "Critical"]
  },
  purchaseInvoice: {
    status: [
      "Draft",
      "Pending",
      "Open",
      "Return",
      "Debit Note Issued",
      "Paid",
      "Partially Paid",
      "Overdue",
      "Voided"
    ]
  },
  purchaseOrder: {
    status: [
      "Draft",
      "To Review",
      "Rejected",
      "To Receive",
      "To Receive and Invoice",
      "To Invoice",
      "Completed",
      "Closed",
      "Planned",
      "Needs Approval"
    ],
    purchaseOrderType: ["Purchase", "Return", "Outside Processing"]
  },
  quote: {
    status: [
      "Draft",
      "Sent",
      "Ordered",
      "Partial",
      "Lost",
      "Cancelled",
      "Expired"
    ]
  },
  receipt: {
    sourceDocument: [
      "Sales Order",
      "Sales Invoice",
      "Sales Return Order",
      "Purchase Order",
      "Purchase Invoice",
      "Purchase Return Order",
      "Inbound Transfer",
      "Outbound Transfer",
      "Manufacturing Consumption",
      "Manufacturing Output"
    ],
    status: ["Draft", "Pending", "Posted", "Voided"]
  },
  salesInvoice: {
    status: [
      "Draft",
      "Pending",
      "Submitted",
      "Return",
      "Credit Note Issued",
      "Paid",
      "Partially Paid",
      "Overdue",
      "Voided"
    ]
  },
  salesOrder: {
    status: [
      "Draft",
      "Needs Approval",
      "Confirmed",
      "In Progress",
      "Completed",
      "Invoiced",
      "Cancelled",
      "Closed",
      "To Ship and Invoice",
      "To Ship",
      "To Invoice"
    ]
  },
  shipment: {
    sourceDocument: [
      "Sales Order",
      "Sales Invoice",
      "Sales Return Order",
      "Purchase Order",
      "Purchase Invoice",
      "Purchase Return Order",
      "Inbound Transfer",
      "Outbound Transfer"
    ],
    status: ["Draft", "Pending", "Posted", "Voided"]
  },
  supplier: { supplierStatus: ["Active", "Inactive", "Pending", "Rejected"] }
};
