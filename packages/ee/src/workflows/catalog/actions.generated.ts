// GENERATED FILE — do not edit. Run `pnpm run generate:workflow-catalog`.

import type { BuiltAction, BuiltOperation } from "./build";

export const WORKFLOW_ACTION_CATALOG: Record<string, BuiltAction> = {
  "customer.update": {
    inputs: {
      customer: { type: { kind: "entity", of: "customer" }, required: true },
      accountManagerId: {
        type: { kind: "entity", of: "user" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      customerTypeId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "customerType"
      }
    },
    outputs: { record: { kind: "entity", of: "customer" } },
    batchable: true,
    permission: { module: "sales", action: "update" },
    update: { entity: "customer" }
  },
  "item.update": {
    inputs: {
      item: { type: { kind: "entity", of: "item" }, required: true },
      name: {
        type: { kind: "primitive", of: "string" },
        required: false,
        notNull: true
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "item" } },
    batchable: true,
    permission: { module: "parts", action: "update" },
    update: { entity: "item" }
  },
  "job.create": {
    inputs: {
      itemId: { type: { kind: "entity", of: "item" }, required: true },
      quantity: { type: { kind: "primitive", of: "number" }, required: true },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      salesOrderLineId: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "job" } },
    batchable: true,
    permission: { module: "production", action: "create" },
    call: "production_insertJob"
  },
  "job.update": {
    inputs: {
      job: { type: { kind: "entity", of: "job" }, required: true },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      startDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      priority: {
        type: { kind: "primitive", of: "number" },
        required: false,
        notNull: true
      },
      deadlineType: {
        type: { kind: "primitive", of: "string" },
        required: false,
        notNull: true,
        choices: ["No Deadline", "ASAP", "Soft Deadline", "Hard Deadline"]
      }
    },
    outputs: { record: { kind: "entity", of: "job" } },
    batchable: true,
    permission: { module: "production", action: "update" },
    update: { entity: "job" }
  },
  "nonConformance.create": {
    inputs: {
      name: { type: { kind: "primitive", of: "string" }, required: true },
      description: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      priority: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["Low", "Medium", "High", "Critical"]
      },
      source: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["Internal", "External"]
      },
      locationId: { type: { kind: "entity", of: "location" }, required: true },
      nonConformanceTypeId: {
        type: { kind: "entity", of: "nonConformanceType" },
        required: true
      },
      openDate: { type: { kind: "primitive", of: "date" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    batchable: true,
    permission: { module: "quality", action: "create" },
    call: "quality_insertIssue"
  },
  "nonConformance.update": {
    inputs: {
      nonConformance: {
        type: { kind: "entity", of: "nonConformance" },
        required: true
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      priority: {
        type: { kind: "primitive", of: "string" },
        required: false,
        choices: ["Low", "Medium", "High", "Critical"]
      },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      nonConformanceTypeId: {
        type: { kind: "entity", of: "nonConformanceType" },
        required: false,
        notNull: true
      }
    },
    outputs: { record: { kind: "entity", of: "nonConformance" } },
    batchable: true,
    permission: { module: "quality", action: "update" },
    update: { entity: "nonConformance" }
  },
  notify: {
    inputs: {
      user: { type: { kind: "entity", of: "user" }, required: false },
      role: { type: { kind: "entity", of: "group" }, required: false },
      channels: {
        type: { kind: "list", of: { kind: "primitive", of: "string" } },
        required: false,
        choices: ["inApp", "email", "slack"],
        defaultValue: ["inApp", "email"]
      },
      subject: {
        type: { kind: "primitive", of: "string" },
        required: true,
        template: true
      },
      message: {
        type: { kind: "primitive", of: "string" },
        required: false,
        template: true,
        linkify: true
      },
      aboutId: { type: { kind: "primitive", of: "string" }, required: false },
      aboutType: { type: { kind: "primitive", of: "string" }, required: false }
    },
    outputs: {},
    batchable: true,
    permission: { module: "users", action: "view" },
    requireOneOf: [["user", "role"]]
  },
  "purchaseOrder.create": {
    inputs: {
      supplierId: { type: { kind: "entity", of: "supplier" }, required: true },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      supplierReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    batchable: true,
    permission: { module: "purchasing", action: "create" },
    call: "purchasing_insertPurchaseOrder"
  },
  "purchaseOrder.update": {
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      },
      supplierReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "purchaseOrder" } },
    batchable: true,
    permission: { module: "purchasing", action: "update" },
    update: { entity: "purchaseOrder" }
  },
  "quote.update": {
    inputs: {
      quote: { type: { kind: "entity", of: "quote" }, required: true },
      expirationDate: {
        type: { kind: "primitive", of: "date" },
        required: false
      },
      dueDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      estimatorId: { type: { kind: "entity", of: "user" }, required: false },
      salesPersonId: { type: { kind: "entity", of: "user" }, required: false },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "quote" } },
    batchable: true,
    permission: { module: "sales", action: "update" },
    update: { entity: "quote" }
  },
  "receipt.update": {
    inputs: {
      receipt: { type: { kind: "entity", of: "receipt" }, required: true },
      assignee: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "receipt" } },
    batchable: true,
    permission: { module: "inventory", action: "update" },
    update: { entity: "receipt" }
  },
  "salesOrder.create": {
    inputs: {
      customerId: { type: { kind: "entity", of: "customer" }, required: true },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      }
    },
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    batchable: true,
    permission: { module: "sales", action: "create" },
    call: "sales_insertSalesOrder"
  },
  "salesOrder.update": {
    inputs: {
      salesOrder: {
        type: { kind: "entity", of: "salesOrder" },
        required: true
      },
      customerReference: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      orderDate: { type: { kind: "primitive", of: "date" }, required: false },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      salesPersonId: { type: { kind: "entity", of: "user" }, required: false }
    },
    outputs: { record: { kind: "entity", of: "salesOrder" } },
    batchable: true,
    permission: { module: "sales", action: "update" },
    update: { entity: "salesOrder" }
  },
  "shipment.update": {
    inputs: {
      shipment: { type: { kind: "entity", of: "shipment" }, required: true },
      trackingNumber: {
        type: { kind: "primitive", of: "string" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      shippingMethodId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "shippingMethod"
      }
    },
    outputs: { record: { kind: "entity", of: "shipment" } },
    batchable: true,
    permission: { module: "inventory", action: "update" },
    update: { entity: "shipment" }
  },
  "supplier.update": {
    inputs: {
      supplier: { type: { kind: "entity", of: "supplier" }, required: true },
      accountManagerId: {
        type: { kind: "entity", of: "user" },
        required: false
      },
      assignee: { type: { kind: "entity", of: "user" }, required: false },
      supplierTypeId: {
        type: { kind: "primitive", of: "string" },
        required: false,
        scopeTable: "supplierType"
      }
    },
    outputs: { record: { kind: "entity", of: "supplier" } },
    batchable: true,
    permission: { module: "purchasing", action: "update" },
    update: { entity: "supplier" }
  },
  webhook: {
    inputs: {
      url: { type: { kind: "primitive", of: "string" }, required: true },
      method: {
        type: { kind: "primitive", of: "string" },
        required: true,
        choices: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        defaultValue: "GET"
      },
      headers: {
        type: { kind: "primitive", of: "string" },
        required: false,
        pairs: true
      },
      body: {
        type: { kind: "primitive", of: "string" },
        required: false,
        template: true,
        showWhen: { input: "method", equals: ["POST", "PUT", "PATCH"] }
      }
    },
    outputs: { status: { kind: "primitive", of: "number" } },
    batchable: true,
    permission: { module: "workflows", action: "update" }
  }
};

export const WORKFLOW_OPERATION_CATALOG: Record<string, BuiltOperation> = {
  "item.quantityOnHand": {
    entity: "item",
    inputs: { item: { type: { kind: "entity", of: "item" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { module: "parts", action: "view" }
  },
  "job.earliestOperationStart": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "date" },
    permission: { module: "production", action: "view" }
  },
  "job.latestOperationEnd": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "date" },
    permission: { module: "production", action: "view" }
  },
  "job.openOperationCount": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { module: "production", action: "view" }
  },
  "job.operationCount": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { module: "production", action: "view" }
  },
  "job.scrapPercentage": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { module: "production", action: "view" }
  },
  "job.totalScrapQuantity": {
    entity: "job",
    inputs: { job: { type: { kind: "entity", of: "job" }, required: true } },
    output: { kind: "primitive", of: "number" },
    permission: { module: "production", action: "view" }
  },
  "nonConformance.openTaskCount": {
    entity: "nonConformance",
    inputs: {
      nonConformance: {
        type: { kind: "entity", of: "nonConformance" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "quality", action: "view" }
  },
  "purchaseOrder.lineCount": {
    entity: "purchaseOrder",
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "purchasing", action: "view" }
  },
  "purchaseOrder.total": {
    entity: "purchaseOrder",
    inputs: {
      purchaseOrder: {
        type: { kind: "entity", of: "purchaseOrder" },
        required: true
      }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "purchasing", action: "view" }
  },
  "quote.total": {
    entity: "quote",
    inputs: {
      quote: { type: { kind: "entity", of: "quote" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "sales", action: "view" }
  },
  "receipt.lineCount": {
    entity: "receipt",
    inputs: {
      receipt: { type: { kind: "entity", of: "receipt" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "inventory", action: "view" }
  },
  "salesOrder.lineCount": {
    entity: "salesOrder",
    inputs: {
      salesOrder: { type: { kind: "entity", of: "salesOrder" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "sales", action: "view" }
  },
  "salesOrder.total": {
    entity: "salesOrder",
    inputs: {
      salesOrder: { type: { kind: "entity", of: "salesOrder" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "sales", action: "view" }
  },
  "shipment.lineCount": {
    entity: "shipment",
    inputs: {
      shipment: { type: { kind: "entity", of: "shipment" }, required: true }
    },
    output: { kind: "primitive", of: "number" },
    permission: { module: "inventory", action: "view" }
  }
};
