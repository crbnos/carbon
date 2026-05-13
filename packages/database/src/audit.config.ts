/**
 * Entity-Centric Audit Log Configuration
 *
 * Audit logging is organized around business entities (Customer, Sales Order, etc.),
 * not individual database tables. Each entity is composed of one or more tables.
 * When a row in any of those tables changes, the audit system attributes the change
 * to the correct business entity and records the actual field-level diff.
 *
 * The generated Supabase `Database` type (`./types`) is the source of truth for
 * table names and column names used throughout this config.
 *
 * Table roles:
 * - "root": The primary table for this entity. Its PK is the entity ID.
 * - "extension": A 1:1 extension table whose PK equals the parent FK
 *           (e.g., customerPayment PK = customerId). Entity ID resolution
 *           is the same as root, but INSERT events are skipped.
 * - { entityIdColumn }: A child table with its own surrogate PK. The named
 *           column contains the parent entity ID.
 * - { resolve: { junction, fk, entityIdColumn } }: An indirect child linked
 *           through a junction table. Requires a DB query at audit time.
 */

import type { Database } from "./types";

// ---------------------------------------------------------------------------
// Schema-derived helpers
// ---------------------------------------------------------------------------

type PublicSchema = Database["public"];

/** All table names present in the public schema. */
export type TableName = Extract<keyof PublicSchema["Tables"], string>;

/** All column names of a given public table. */
export type ColumnOf<T extends TableName> = Extract<
  keyof PublicSchema["Tables"][T]["Row"],
  string
>;

// ---------------------------------------------------------------------------
// Config types (generic on the table they describe)
// ---------------------------------------------------------------------------

/**
 * `createFields` controls which columns appear in the diff for INSERT events.
 * By default, INSERT audit entries carry a null diff (rendered as "Created").
 * List columns here to surface their initial values. Only meaningful on
 * tables that log INSERTs (today: root tables).
 *
 * Each variant declares `createFields` directly (rather than sharing a base
 * via intersection) so TS can narrow `T` — and autocomplete column names —
 * inside object-literal config entries.
 */
type RootTable<T extends TableName> = {
  role: "root";
  createFields?: readonly ColumnOf<T>[];
};

type ExtensionTable<T extends TableName> = {
  role: "extension";
  createFields?: readonly ColumnOf<T>[];
};

type ChildTable<T extends TableName> = {
  entityIdColumn: ColumnOf<T>;
  createFields?: readonly ColumnOf<T>[];
};

/**
 * Distributed union so `fk` and `entityIdColumn` are checked against the
 * chosen `junction` table's columns.
 */
type IndirectResolve = {
  [J in TableName]: {
    /** Junction table name (e.g. "customerContact"). */
    junction: J;
    /** Column in the junction pointing to this table's PK (e.g. "contactId"). */
    fk: ColumnOf<J>;
    /** Column in the junction pointing to the parent entity (e.g. "customerId"). */
    entityIdColumn: ColumnOf<J>;
  };
}[TableName];

type IndirectTable<T extends TableName> = {
  resolve: IndirectResolve;
  createFields?: readonly ColumnOf<T>[];
};

export type TableConfig<T extends TableName = TableName> =
  | RootTable<T>
  | ExtensionTable<T>
  | ChildTable<T>
  | IndirectTable<T>;

type EntityTables = {
  [T in TableName]?: TableConfig<T>;
};

type EntityConfig = {
  label: string;
  tables: EntityTables;
};

// ---------------------------------------------------------------------------
// Entity definitions
// ---------------------------------------------------------------------------

export const auditConfig = {
  entities: {
    customer: {
      label: "Customer",
      tables: {
        customer: { role: "root" },
        customerPayment: { role: "extension" }, // PK = customerId
        customerShipping: { role: "extension" }, // PK = customerId
        customerTax: { role: "extension" }, // PK = customerId
        contact: {
          resolve: {
            junction: "customerContact",
            fk: "contactId",
            entityIdColumn: "customerId"
          }
        },
        address: {
          resolve: {
            junction: "customerLocation",
            fk: "addressId",
            entityIdColumn: "customerId"
          }
        }
      }
    },

    supplier: {
      label: "Supplier",
      tables: {
        supplier: { role: "root" },
        supplierPayment: { role: "extension" }, // PK = supplierId
        supplierShipping: { role: "extension" }, // PK = supplierId
        supplierTax: { role: "extension" }, // PK = supplierId
        contact: {
          resolve: {
            junction: "supplierContact",
            fk: "contactId",
            entityIdColumn: "supplierId"
          }
        },
        address: {
          resolve: {
            junction: "supplierLocation",
            fk: "addressId",
            entityIdColumn: "supplierId"
          }
        }
      }
    },

    item: {
      label: "Item",
      tables: {
        item: { role: "root" },
        itemShelfLife: { role: "root" },
        itemCost: { role: "extension" }, // PK = itemId
        itemPlanning: { role: "extension" }, // PK = itemId
        itemReplenishment: { role: "extension" }, // PK = itemId
        itemUnitSalePrice: { role: "extension" }, // PK = itemId
        supplierPart: { entityIdColumn: "itemId" },
        customerPartToItem: { entityIdColumn: "itemId" }
      }
    },

    itemShelfLife: {
      label: "Item Shelf Life",
      tables: {
        itemShelfLife: {
          role: "root",
          createFields: [
            "mode",
            "days",
            "triggerProcessId",
            "triggerTiming",
            "calculateFromBom"
          ]
        }
      }
    },

    salesOrder: {
      label: "Sales Order",
      tables: {
        salesOrder: { role: "root" },
        salesOrderLine: { entityIdColumn: "salesOrderId" },
        salesOrderPayment: { role: "extension" }, // PK = salesOrderId
        salesOrderShipment: { role: "extension" } // PK = salesOrderId
      }
    },

    purchaseOrder: {
      label: "Purchase Order",
      tables: {
        purchaseOrder: { role: "root" },
        purchaseOrderLine: { entityIdColumn: "purchaseOrderId" },
        purchaseOrderPayment: { role: "extension" }, // PK = purchaseOrderId
        purchaseOrderDelivery: { role: "extension" } // PK = purchaseOrderId
      }
    },

    salesInvoice: {
      label: "Sales Invoice",
      tables: {
        salesInvoice: { role: "root" },
        salesInvoiceLine: { entityIdColumn: "invoiceId" },
        salesInvoiceShipment: { role: "extension" } // PK = salesInvoiceId
      }
    },

    purchaseInvoice: {
      label: "Purchase Invoice",
      tables: {
        purchaseInvoice: { role: "root" },
        purchaseInvoiceLine: { entityIdColumn: "invoiceId" }
      }
    },

    salesQuote: {
      label: "Quote",
      tables: {
        quote: { role: "root" },
        quoteLine: { entityIdColumn: "quoteId" }
      }
    },

    supplierQuote: {
      label: "Supplier Quote",
      tables: {
        supplierQuote: { role: "root" },
        supplierQuoteLine: { entityIdColumn: "supplierQuoteId" }
      }
    },

    productionJob: {
      label: "Job",
      tables: {
        job: { role: "root" },
        jobOperation: { entityIdColumn: "jobId" },
        jobMaterial: { entityIdColumn: "jobId" },
        jobMakeMethod: { entityIdColumn: "jobId" }
      }
    },

    employee: {
      label: "Employee",
      tables: {
        employee: { role: "root" },
        employeeJob: { role: "extension" } // PK = employee id
      }
    },

    nonConformance: {
      label: "Non-Conformance",
      tables: {
        nonConformance: { role: "root" },
        nonConformanceItem: { entityIdColumn: "nonConformanceId" },
        nonConformanceActionTask: { entityIdColumn: "nonConformanceId" },
        nonConformanceApprovalTask: { entityIdColumn: "nonConformanceId" }
      }
    },

    gauge: {
      label: "Gauge",
      tables: {
        gauge: { role: "root" },
        gaugeCalibrationRecord: { entityIdColumn: "gaugeId" }
      }
    },

    shipment: {
      label: "Shipment",
      tables: {
        shipment: { role: "root" },
        shipmentLine: { entityIdColumn: "shipmentId" }
      }
    },

    receipt: {
      label: "Receipt",
      tables: {
        receipt: { role: "root" },
        receiptLine: { entityIdColumn: "receiptId" }
      }
    },

    warehouseTransfer: {
      label: "Warehouse Transfer",
      tables: {
        warehouseTransfer: { role: "root" },
        warehouseTransferLine: { entityIdColumn: "transferId" }
      }
    },

    stockTransfer: {
      label: "Stock Transfer",
      tables: {
        stockTransfer: { role: "root" },
        stockTransferLine: { entityIdColumn: "stockTransferId" }
      }
    },

    workCenter: {
      label: "Work Center",
      tables: {
        workCenter: { role: "root" },
        workCenterProcess: { entityIdColumn: "workCenterId" }
      }
    },

    maintenanceSchedule: {
      label: "Maintenance Schedule",
      tables: {
        maintenanceSchedule: { role: "root" },
        maintenanceScheduleItem: {
          entityIdColumn: "maintenanceScheduleId"
        }
      }
    },

    maintenanceDispatch: {
      label: "Maintenance Dispatch",
      tables: {
        maintenanceDispatch: { role: "root" },
        maintenanceDispatchEvent: { entityIdColumn: "maintenanceDispatchId" },
        maintenanceDispatchComment: {
          entityIdColumn: "maintenanceDispatchId"
        }
      }
    },

    pricingRule: {
      label: "Pricing Rule",
      tables: {
        pricingRule: { role: "root" }
      }
    },

    priceOverride: {
      label: "Price Override",
      tables: {
        customerItemPriceOverride: { role: "root" },
        customerItemPriceOverrideBreak: {
          entityIdColumn: "customerItemPriceOverrideId"
        }
      }
    },

    priceOverrideBreak: {
      label: "Price Override Break",
      tables: {
        customerItemPriceOverrideBreak: {
          role: "root",
          createFields: ["quantity", "overridePrice", "active"]
        }
      }
    }
  } satisfies Record<string, EntityConfig>,

  /**
   * Human-readable labels for table names, used in the UI to show
   * provenance (e.g. "Contact" instead of "customerContact").
   * Tables not listed here fall back to a camelCase → Title Case conversion.
   */
  tableLabels: {
    customer: "Customer",
    customerPayment: "Payment",
    customerShipping: "Shipping",
    customerTax: "Tax",
    contact: "Contact",
    address: "Address",
    supplier: "Supplier",
    supplierPayment: "Payment",
    supplierShipping: "Shipping",
    supplierTax: "Tax",
    supplierPart: "Supplier Part",
    item: "Item",
    itemShelfLife: "Shelf Life",
    itemCost: "Cost",
    itemPlanning: "Planning",
    itemReplenishment: "Replenishment",
    itemUnitSalePrice: "Unit Sale Price",
    customerPartToItem: "Customer Part Mapping",
    salesOrder: "Sales Order",
    salesOrderLine: "Line Item",
    salesOrderPayment: "Payment",
    salesOrderShipment: "Shipment",
    purchaseOrder: "Purchase Order",
    purchaseOrderLine: "Line Item",
    purchaseOrderPayment: "Payment",
    purchaseOrderDelivery: "Delivery",
    salesInvoice: "Sales Invoice",
    salesInvoiceLine: "Line Item",
    salesInvoiceShipment: "Shipment",
    purchaseInvoice: "Purchase Invoice",
    purchaseInvoiceLine: "Line Item",
    quote: "Quote",
    quoteLine: "Line Item",
    supplierQuote: "Supplier Quote",
    supplierQuoteLine: "Line Item",
    job: "Job",
    jobOperation: "Operation",
    jobMaterial: "Material",
    jobMakeMethod: "Make Method",
    employee: "Employee",
    employeeJob: "Job Info",
    nonConformance: "Non-Conformance",
    nonConformanceItem: "Item",
    nonConformanceActionTask: "Action Task",
    nonConformanceApprovalTask: "Approval Task",
    gauge: "Gauge",
    gaugeCalibrationRecord: "Calibration Record",
    shipment: "Shipment",
    shipmentLine: "Line Item",
    receipt: "Receipt",
    receiptLine: "Line Item",
    warehouseTransfer: "Warehouse Transfer",
    warehouseTransferLine: "Line Item",
    stockTransfer: "Stock Transfer",
    stockTransferLine: "Line Item",
    workCenter: "Work Center",
    workCenterProcess: "Process",
    maintenanceSchedule: "Maintenance Schedule",
    maintenanceScheduleItem: "Schedule Item",
    maintenanceDispatch: "Dispatch",
    maintenanceDispatchEvent: "Dispatch Event",
    maintenanceDispatchComment: "Dispatch Comment",
    pricingRule: "Pricing Rule",
    customerItemPriceOverride: "Price Override",
    customerItemPriceOverrideBreak: "Quantity Break"
  } satisfies Partial<Record<TableName, string>>,

  /** Fields to skip in diff computation */
  skipFields: ["updatedAt", "updatedBy", "embedding"],

  /** Retention period before archival (days) */
  retentionDays: 30,

  /** Archive storage path template */
  archivePath: "audit-logs/{companyId}/{year}/{month}.jsonl.gz",

  /** Storage bucket name for archives */
  archiveBucket: "private"
} as const;

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export type AuditEntityType = keyof typeof auditConfig.entities;

export type AuditableTable = string;

/** @deprecated Use AuditableTable or AuditEntityType instead */
export type AuditableEntity = AuditableTable;

// ---------------------------------------------------------------------------
// Lookup indexes (computed once at import time)
// ---------------------------------------------------------------------------

type EntityTableEntry = {
  entityType: AuditEntityType;
  label: string;
  tableConfig: TableConfig;
};

/** Map from table name → array of entity configs that include it */
const _tableIndex = new Map<string, EntityTableEntry[]>();

/** Deduplicated set of all auditable table names */
const _allTables = new Set<string>();

for (const [entityType, entityConfig] of Object.entries(auditConfig.entities)) {
  for (const [tableName, tableConfig] of Object.entries(entityConfig.tables)) {
    _allTables.add(tableName);

    const existing = _tableIndex.get(tableName) ?? [];
    existing.push({
      entityType: entityType as AuditEntityType,
      label: entityConfig.label,
      tableConfig
    });
    _tableIndex.set(tableName, existing);
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Check if a table is tracked by any audit entity */
export function isAuditableTable(table: string): boolean {
  return _tableIndex.has(table);
}

/**
 * Columns to include in the diff for INSERT events on this table.
 * Returns an empty array when no createFields are configured.
 */
export function getCreateFields(config: TableConfig): readonly string[] {
  return config.createFields ?? [];
}

/** @deprecated Use isAuditableTable instead */
export function isAuditableEntity(table: string): boolean {
  return isAuditableTable(table);
}

/**
 * Get all entity configs that track a given table.
 * Returns an array because a table can belong to multiple entities
 * (e.g. `contact` belongs to both `customer` and `supplier`).
 */
export function getEntityConfigsForTable(
  table: string
): readonly EntityTableEntry[] {
  return _tableIndex.get(table) ?? [];
}

/** Get deduplicated list of all auditable table names */
export function getAuditableTableNames(): string[] {
  return Array.from(_allTables);
}

/** Get list of all entity type keys */
export function getEntityTypes(): AuditEntityType[] {
  return Object.keys(auditConfig.entities) as AuditEntityType[];
}

/** Get human-readable label for an entity type */
export function getEntityLabel(entityType: AuditEntityType): string {
  return auditConfig.entities[entityType]?.label ?? entityType;
}

/** Get human-readable label for a table name */
export function getTableLabel(tableName: string): string {
  const labels = auditConfig.tableLabels as Record<string, string | undefined>;
  return labels[tableName] ?? tableName.replace(/([A-Z])/g, " $1").trim();
}

/**
 * Check if a table config is a root table (PK = entity ID)
 */
export function isRootTable(
  config: TableConfig
): config is RootTable<TableName> {
  return "role" in config && config.role === "root";
}

/**
 * Check if a table config is a 1:1 extension table (PK = parent FK).
 * Entity ID resolution is the same as root (use recordId), but
 * INSERT events are skipped since they are just empty default rows.
 */
export function isExtensionTable(
  config: TableConfig
): config is ExtensionTable<TableName> {
  return "role" in config && config.role === "extension";
}

/**
 * Check if a table config is a direct child (has entityIdColumn)
 */
export function isChildTable(
  config: TableConfig
): config is ChildTable<TableName> {
  return "entityIdColumn" in config && !("resolve" in config);
}

/**
 * Check if a table config requires junction table resolution
 */
export function isIndirectTable(
  config: TableConfig
): config is IndirectTable<TableName> {
  return "resolve" in config;
}
