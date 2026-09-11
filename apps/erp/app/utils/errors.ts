/**
 * Database error translation to user-friendly messages.
 * Maps constraint violations and other data-layer errors to actionable feedback.
 */

interface ConstraintErrorContext {
  entityName?: string;
}

/**
 * Translate a Postgres foreign key constraint error (code 23503) to a user-friendly message.
 * Checks the constraint name and provides context-aware guidance.
 *
 * Examples:
 * - "trackedEntity_itemId_fkey" → "Item has tracked entities and cannot be deleted. Deactivate it instead."
 * - "itemLedger_itemId_fkey" → "Item has inventory history and cannot be deleted. Deactivate it instead."
 * - Unknown constraint → "Item is still referenced by other records and cannot be deleted."
 */
export function friendlyConstraintError(
  err: { code?: string; message?: string },
  context?: ConstraintErrorContext
): string {
  // Only handle foreign key violations
  if (err.code !== "23503") {
    return err.message ?? "Operation failed";
  }

  const msg = err.message ?? "";
  const entityName = context?.entityName ?? "Record";

  // Map constraint names to friendly messages
  const patterns: Record<string, string> = {
    // Item-related
    trackedEntity_itemId_fkey: `${entityName} has tracked entities linked to it and cannot be deleted. Deactivate the item instead.`,
    itemLedger_itemId_fkey: `${entityName} has inventory history and cannot be deleted. Deactivate the item instead.`,
    costLedger_itemId_fkey: `${entityName} has costing history and cannot be deleted. Deactivate the item instead.`,

    // Purchase Order
    purchaseOrderLine: `${entityName} is referenced by purchase orders and cannot be deleted.`,
    purchaseInvoiceLine: `${entityName} is referenced by purchase invoices and cannot be deleted.`,

    // Sales Order
    salesOrderLine: `${entityName} is referenced by sales orders and cannot be deleted.`,
    salesInvoiceLine: `${entityName} is referenced by sales invoices and cannot be deleted.`,

    // Production
    jobMaterial: `${entityName} is used in work orders and cannot be deleted.`,
    jobOperation: `${entityName} is used in work orders and cannot be deleted.`,

    // Other common references
    supplierItem: `${entityName} has supplier references and cannot be deleted.`,
    bom: `${entityName} is used in a bill of materials and cannot be deleted.`,
    methodMaterial: `${entityName} is used in a manufacturing method and cannot be deleted.`
  };

  // Check for exact constraint name matches first
  for (const [constraint, friendly] of Object.entries(patterns)) {
    if (msg.includes(`"${constraint}"`)) {
      return friendly;
    }
  }

  // Fallback: use partial matching on key parts of constraint names
  for (const [constraint, friendly] of Object.entries(patterns)) {
    if (msg.includes(constraint)) {
      return friendly;
    }
  }

  // Generic fallback for any other FK violation
  return `${entityName} is still referenced by other records and cannot be deleted. Remove those references first.`;
}

/**
 * Translate other common database errors.
 */
export function friendlyDatabaseError(
  err: { code?: string; message?: string },
  fallback = "Operation failed"
): string {
  if (!err.code || !err.message) return fallback;

  // Foreign key violation
  if (err.code === "23503") {
    return friendlyConstraintError(err);
  }

  // Unique constraint violation
  if (err.code === "23505") {
    return "This record already exists. Please check for duplicates.";
  }

  // Not null violation
  if (err.code === "23502") {
    return "Required field is missing. Please complete the form.";
  }

  // Check violation
  if (err.code === "23514") {
    return "Invalid value provided. Please check your input.";
  }

  return fallback;
}
