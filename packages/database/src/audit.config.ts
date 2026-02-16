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
  entities: [
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
   * Human-readable labels for entity types (used in UI)
   */
  entityLabels: {
    purchaseInvoice: "Purchasing Invoice",
    salesInvoice: "Sales Invoice",
    purchaseOrder: "Purchasing Order",
    salesOrder: "Sales Order",
    customer: "Sales Customer",
    supplier: "Purchasing Supplier",
    item: "Inventory Item",
    itemCost: "Inventory Item",
    job: "Production Job",
    quote: "Sales Quote",
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

export type AuditableEntity = (typeof auditConfig.entities)[number];

/**
 * Check if a table name is an auditable entity
 */
export function isAuditableEntity(table: string): table is AuditableEntity {
  return auditConfig.entities.includes(table as AuditableEntity);
}

/**
 * Get the human-readable label for an entity type
 */
export function getEntityLabel(entityType: AuditableEntity): string {
  return auditConfig.entityLabels[entityType] ?? entityType;
}
