import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { purchaseOrderStatusType } from "./purchasing.models";

/**
 * Purchase Order statuses that indicate the PO has been finalized/approved
 * and is now "locked" - meaning only privileged users can make limited edits
 */
export const PURCHASE_ORDER_LOCKED_STATUSES = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
] as const;

/**
 * Purchase Order statuses that allow normal editing
 */
export const PURCHASE_ORDER_EDITABLE_STATUSES = [
  "Draft",
  "Planned",
  "Needs Approval",
  "Rejected"
] as const;

export type PurchaseOrderLockedStatus =
  (typeof PURCHASE_ORDER_LOCKED_STATUSES)[number];
export type PurchaseOrderEditableStatus =
  (typeof PURCHASE_ORDER_EDITABLE_STATUSES)[number];

/**
 * Check if a PO status is "locked" (finalized/approved)
 */
export function isPurchaseOrderLocked(
  status: (typeof purchaseOrderStatusType)[number] | null | undefined
): boolean {
  return PURCHASE_ORDER_LOCKED_STATUSES.includes(
    status as PurchaseOrderLockedStatus
  );
}

/**
 * Check if a PO status allows normal editing
 */
export function isPurchaseOrderEditable(
  status: (typeof purchaseOrderStatusType)[number] | null | undefined
): boolean {
  return PURCHASE_ORDER_EDITABLE_STATUSES.includes(
    status as PurchaseOrderEditableStatus
  );
}

export type PurchaseOrderLineForValidation = {
  id: string;
  purchaseQuantity: number | null;
  supplierUnitPrice: number | null;
  supplierTaxAmount: number | null;
  supplierShippingCost: number | null;
};

export type ValidateLockedPOEditResult = {
  allowed: boolean;
  error?: string;
};

/**
 * Validates edits to a locked (finalized/approved) Purchase Order.
 *
 * Rules:
 * - If PO is not locked, all edits are allowed (returns allowed: true)
 * - If PO is locked and user doesn't have delete permission, no edits are allowed
 * - If PO is locked and user has delete permission, only changes that REDUCE
 *   the total amount are allowed (price reductions, quantity reductions, line removals)
 *
 * @param currentLines - The current lines on the PO
 * @param updatedLines - The lines after the proposed edit (for line updates)
 * @param deletedLineIds - IDs of lines being deleted (for line deletions)
 */
export function validateLockedPOLineEdit(
  currentLines: PurchaseOrderLineForValidation[],
  updatedLines: PurchaseOrderLineForValidation[],
  deletedLineIds: string[] = []
): ValidateLockedPOEditResult {
  const currentTotal = calculateLinesTotal(currentLines);
  const newTotal = calculateLinesTotal(
    updatedLines.filter((line) => !deletedLineIds.includes(line.id))
  );

  if (newTotal > currentTotal) {
    return {
      allowed: false,
      error:
        "Cannot increase the total amount on a finalized purchase order. Only price reductions are allowed. To increase the amount, please cancel this PO and create a new one."
    };
  }

  return { allowed: true };
}

/**
 * Validates a single line edit against the locked PO rules.
 * Compares the original line with the updated line to ensure the total doesn't increase.
 */
export function validateLockedPOSingleLineEdit(
  originalLine: PurchaseOrderLineForValidation,
  updatedLine: Partial<PurchaseOrderLineForValidation>
): ValidateLockedPOEditResult {
  const originalLineTotal = calculateLineTotal(originalLine);
  const newLineTotal = calculateLineTotal({
    ...originalLine,
    ...updatedLine
  });

  if (newLineTotal > originalLineTotal) {
    return {
      allowed: false,
      error:
        "Cannot increase the line total on a finalized purchase order. Only price reductions are allowed. To increase the amount, please cancel this PO and create a new one."
    };
  }

  return { allowed: true };
}

/**
 * Calculate the total for a single PO line
 */
function calculateLineTotal(line: PurchaseOrderLineForValidation): number {
  const quantity = line.purchaseQuantity ?? 0;
  const unitPrice = line.supplierUnitPrice ?? 0;
  const taxAmount = line.supplierTaxAmount ?? 0;
  const shippingCost = line.supplierShippingCost ?? 0;

  return quantity * unitPrice + taxAmount + shippingCost;
}

/**
 * Calculate the total for all PO lines
 */
function calculateLinesTotal(lines: PurchaseOrderLineForValidation[]): number {
  return lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
}

/**
 * Fetches the current PO and its lines to validate an edit.
 * Returns the PO status and whether the edit is allowed.
 */
export async function getPurchaseOrderForValidation(
  client: SupabaseClient<Database>,
  purchaseOrderId: string
): Promise<{
  status: (typeof purchaseOrderStatusType)[number] | null;
  lines: PurchaseOrderLineForValidation[];
  error?: string;
}> {
  const [poResult, linesResult] = await Promise.all([
    client
      .from("purchaseOrder")
      .select("status")
      .eq("id", purchaseOrderId)
      .single(),
    client
      .from("purchaseOrderLine")
      .select(
        "id, purchaseQuantity, supplierUnitPrice, supplierTaxAmount, supplierShippingCost"
      )
      .eq("purchaseOrderId", purchaseOrderId)
  ]);

  if (poResult.error) {
    return {
      status: null,
      lines: [],
      error: `Failed to fetch purchase order: ${poResult.error.message}`
    };
  }

  if (linesResult.error) {
    return {
      status: poResult.data?.status ?? null,
      lines: [],
      error: `Failed to fetch purchase order lines: ${linesResult.error.message}`
    };
  }

  return {
    status: poResult.data?.status ?? null,
    lines: linesResult.data ?? []
  };
}
