/**
 * Audit Log Configuration
 *
 * This file defines which entities are auditable and other audit-related settings.
 * Changes to this file affect which database changes are tracked in the audit log.
 */

export const auditConfig = {
  /**
   * List of database tables that are auditable.
   * These correspond to the tables that have event triggers attached.
   */
  tables: [
    "purchaseInvoice",
    "salesInvoice",
    "purchaseOrder",
    "salesOrder",
    "customer",
    "supplier",
    "item",
    "itemCost",
    "job",
    "quote",
    "employee"
  ] as const,

  /**
   * Semantic entity types used in the UI.
   * Multiple tables can map to the same entity type.
   */
  entityTypes: [
    "purchaseInvoice",
    "salesInvoice",
    "purchaseOrder",
    "salesOrder",
    "salesCustomer",
    "purchaseSupplier",
    "item",
    "productionJob",
    "salesQuote",
    "employee"
  ] as const,

  /**
   * Maps a database table name to its semantic entity type.
   * Tables that share a domain concept map to the same entity type.
   */
  tableToEntityType: {
    purchaseInvoice: "purchaseInvoice",
    salesInvoice: "salesInvoice",
    purchaseOrder: "purchaseOrder",
    salesOrder: "salesOrder",
    customer: "salesCustomer",
    supplier: "purchaseSupplier",
    item: "item",
    itemCost: "item",
    job: "productionJob",
    quote: "salesQuote",
    employee: "employee"
  } as const,

  /**
   * Human-readable labels for entity types (used in UI)
   */
  entityLabels: {
    purchaseInvoice: "Purchasing Invoice",
    salesInvoice: "Sales Invoice",
    purchaseOrder: "Purchasing Order",
    salesOrder: "Sales Order",
    salesCustomer: "Sales Customer",
    purchaseSupplier: "Purchasing Supplier",
    item: "Item",
    productionJob: "Production Job",
    salesQuote: "Sales Quote",
    employee: "Employee"
  } as const,

  /**
   * Fields to skip in diff computation.
   * These fields change on every update but aren't meaningful for audit purposes.
   */
  skipFields: ["updatedAt", "updatedBy"],

  /**
   * Default retention period before archival (in days)
   */
  retentionDays: 30,

  /**
   * Archive storage path template
   * Available placeholders: {companyId}, {year}, {month}
   */
  archivePath: "audit-logs/{companyId}/{year}/{month}.jsonl.gz",

  /**
   * Storage bucket name for archives
   */
  archiveBucket: "private"
} as const;

export type AuditableTable = (typeof auditConfig.tables)[number];
export type AuditEntityType = (typeof auditConfig.entityTypes)[number];

/** @deprecated Use AuditableTable or AuditEntityType instead */
export type AuditableEntity = AuditableTable;

/**
 * Check if a table name is an auditable table
 */
export function isAuditableTable(table: string): table is AuditableTable {
  return auditConfig.tables.includes(table as AuditableTable);
}

/** @deprecated Use isAuditableTable instead */
export function isAuditableEntity(table: string): table is AuditableTable {
  return isAuditableTable(table);
}

/**
 * Get the semantic entity type for a table name
 */
export function getEntityTypeForTable(table: AuditableTable): AuditEntityType {
  return auditConfig.tableToEntityType[table];
}

/**
 * Get the human-readable label for an entity type
 */
export function getEntityLabel(entityType: AuditEntityType): string {
  return auditConfig.entityLabels[entityType] ?? entityType;
}
