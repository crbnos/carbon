import { getLocalTimeZone, today } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { methodItemType } from "../shared";

export const KPIs = [
  {
    key: "supplierQuoteCount",
    label: "Supplier Quotes"
  },
  {
    key: "purchaseOrderCount",
    label: "Purchase Orders"
  },
  {
    key: "purchaseInvoiceCount",
    label: "Purchase Invoices"
  },
  {
    key: "purchaseOrderAmount",
    label: "Purchase Order Amount"
  },
  {
    key: "purchaseInvoiceAmount",
    label: "Purchase Invoice Amount"
  }
  // {
  //   key: "turnaroundTime",
  //   label: "Turnaround Time",
  // },
] as const;

export const purchaseOrderLineType = [
  "Part",
  // "Service",
  "Material",
  "Tool",
  "Consumable",
  // "G/L Account",
  // "Fixed Asset",
  "Comment"
] as const;

export const purchaseOrderTypeType = [
  "Purchase",
  "Outside Processing"
] as const;

export const purchaseOrderStatusType = [
  "Draft",
  "Planned",
  "Needs Approval",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Rejected",
  "Closed"
] as const;

export const externalSupplierQuoteValidator = z.object({
  digitalSupplierQuoteSubmittedBy: zfd.text(
    z.string().min(1, { message: "Name is required" })
  ),
  digitalSupplierQuoteSubmittedByEmail: zfd.text(
    z.string().email({ message: "Email is invalid" })
  ),
  note: zfd.text(z.string().optional())
});

export const plannedOrderValidator = z.object({
  startDate: zfd.text(z.string().nullable()),
  dueDate: zfd.text(z.string().nullable()),
  description: zfd.text(z.string().optional()),
  periodId: z.string().min(1, { message: "Period is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  existingId: zfd.text(z.string().optional()),
  existingLineId: zfd.text(z.string().optional()),
  existingQuantity: zfd.numeric(z.number().optional()),
  existingReadableId: zfd.text(z.string().optional()),
  existingStatus: zfd.text(z.string().optional()),
  supplierId: zfd.text(z.string().optional()),
  itemReadableId: zfd.text(z.string().optional()),
  unitPrice: zfd.numeric(z.number().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional())
});

export type PlannedOrder = z.infer<typeof plannedOrderValidator>;

export const purchaseOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  purchaseOrderType: z.enum(purchaseOrderTypeType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required"
    })
  }),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  supplierLocationId: zfd.text(z.string().optional()),
  supplierContactId: zfd.text(z.string().optional()),
  supplierReference: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional())
});

export const supplierQuoteFinalizeValidator = z
  .object({
    notification: z.enum(["Email", "Share"]).optional(),
    supplierContact: zfd.text(z.string().optional()),
    sendAttachments: zfd.checkbox(),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.supplierContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["supplierContact"] // path of error
    }
  );

export const purchaseOrderDeliveryValidator = z
  .object({
    id: z.string(),
    locationId: zfd.text(z.string().optional()),
    shippingMethodId: zfd.text(z.string().optional()),
    // shippingTermId: zfd.text(z.string().optional()),
    trackingNumber: z.string(),
    deliveryDate: zfd.text(z.string().optional()),
    receiptRequestedDate: zfd.text(z.string().optional()),
    receiptPromisedDate: zfd.text(z.string().optional()),
    dropShipment: zfd.checkbox(),
    customerId: zfd.text(z.string().optional()),
    customerLocationId: zfd.text(z.string().optional()),
    supplierShippingCost: zfd.numeric(z.number().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.dropShipment) {
        return data.customerId && data.customerLocationId;
      }
      return true;
    },
    {
      message: "Drop shipment requires customer and location",
      path: ["dropShipment"] // path of error
    }
  )
  .refine(
    (data) => {
      if (data.locationId) {
        return !data.dropShipment;
      }
      return true;
    },
    {
      message: "Location is not required for drop shipment",
      path: ["locationId"] // path of error
    }
  );

export const purchaseOrderLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    purchaseOrderId: z.string().min(1, { message: "Order is required" }),
    purchaseOrderLineType: z.enum(methodItemType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required"
      })
    }),
    itemId: zfd.text(z.string().optional()),
    accountNumber: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().optional()),
    description: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
    inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
    jobId: zfd.text(z.string().optional()),
    jobOperationId: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    promisedDate: zfd.text(z.string().optional()),
    purchaseQuantity: zfd.numeric(z.number().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    shelfId: zfd.text(z.string().optional()),
    supplierShippingCost: zfd.numeric(z.number().optional()),
    supplierTaxAmount: zfd.numeric(z.number().optional()),
    supplierUnitPrice: zfd.numeric(z.number().optional())
  })
  .refine(
    (data) =>
      ["Part", "Service", "Material", "Tool", "Fixture", "Consumable"].includes(
        data.purchaseOrderLineType
      )
        ? data.itemId
        : true,
    {
      message: "Part is required",
      path: ["itemId"] // path of error
    }
  );
// .refine(
//   (data) =>
//     data.purchaseOrderLineType === "G/L Account" ? data.accountNumber : true,
//   {
//     message: "Account is required",
//     path: ["accountNumber"], // path of error
//   }
// )
// .refine(
//   (data) =>
//     data.purchaseOrderLineType === "Fixed Asset" ? data.assetId : true,
//   {
//     message: "Asset is required",
//     path: ["assetId"], // path of error
//   }
// )
// .refine(
//   (data) =>
//     data.purchaseOrderLineType === "Comment" ? data.description : true,
//   {
//     message: "Comment is required",
//     path: ["description"], // path of error
//   }
// );

export const purchaseOrderPaymentValidator = z.object({
  id: z.string(),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  paymentComplete: zfd.checkbox()
});

export const purchaseOrderFinalizeValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    supplierContact: zfd.text(z.string().optional()),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.supplierContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["supplierContact"] // path of error
    }
  );

export const purchaseOrderApprovalValidator = z
  .object({
    approvalRequestId: z
      .string()
      .min(1, { message: "Approval request is required" }),
    decision: z.enum(["Approved", "Rejected"]),
    notification: z.enum(["Email", "None"]).optional(),
    supplierContact: zfd.text(z.string().optional()),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.supplierContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["supplierContact"] // path of error
    }
  );

export const selectedLineSchema = z.object({
  leadTime: z.number(),
  quantity: z.number(),
  shippingCost: z.number(),
  supplierShippingCost: z.number(),
  supplierUnitPrice: z.number(),
  supplierTaxAmount: z.number(),
  unitPrice: z.number()
});

export const selectedLinesValidator = z.record(z.string(), selectedLineSchema);

export const supplierValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  supplierStatusId: zfd.text(z.string().optional()),
  supplierTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  purchasingContactId: zfd.text(z.string().optional()),
  invoicingContactId: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional()),
  defaultCc: z.array(z.string().email()).default([])
});

export const supplierContactValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...contact,
  supplierLocationId: zfd.text(z.string().optional())
});

export const supplierLocationValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string()),
  ...address
});

export const supplierPaymentValidator = z.object({
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional())
});

export const supplierProcessValidator = z.object({
  id: zfd.text(z.string().optional()),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  processId: z.string().min(1, { message: "Process is required" }),
  minimumCost: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0))
});

export const supplierShippingValidator = z.object({
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  shippingSupplierId: zfd.text(z.string().optional()),
  shippingSupplierLocationId: zfd.text(z.string().optional()),
  shippingSupplierContactId: zfd.text(z.string().optional()),
  // shippingTermId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional())
});

export const supplierAccountingValidator = z.object({
  id: zfd.text(z.string()),
  supplierTypeId: zfd.text(z.string().optional()),
  taxId: zfd.text(z.string().optional())
});

export const supplierTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const supplierStatusValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const supplierQuoteStatusType = [
  "Draft",
  "Active",
  "Expired",
  "Declined",
  "Cancelled"
] as const;

export const supplierQuoteValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    supplierQuoteId: zfd.text(z.string().optional()),
    supplierQuoteType: z.enum(purchaseOrderTypeType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required"
      })
    }),
    supplierId: z.string().min(1, { message: "Supplier is required" }),
    supplierLocationId: zfd.text(z.string().optional()),
    supplierContactId: zfd.text(z.string().optional()),
    supplierReference: zfd.text(z.string().optional()),
    status: z.enum(supplierQuoteStatusType).optional(),
    notes: z.any().optional(),
    quotedDate: zfd.text(z.string().optional()),
    expirationDate: zfd.text(z.string().optional()),
    currencyCode: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
    exchangeRateUpdatedAt: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.expirationDate) {
        return data.expirationDate >= today(getLocalTimeZone()).toString();
      }
      return true;
    },
    {
      message: "Expiration date must be today or after",
      path: ["expirationDate"] // path of error
    }
  );

export const supplierQuoteLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  supplierQuoteId: z.string(),
  itemId: z.string().min(1, { message: "Part is required" }),
  description: z.string().min(1, { message: "Description is required" }),
  supplierPartId: zfd.text(z.string().optional()),
  inventoryUnitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  purchaseUnitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  conversionFactor: zfd.numeric(z.number().optional()),
  quantity: z.array(
    zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
  )
});

export const purchasingRfqStatusType = [
  "Draft",
  "Requested",
  "Closed"
] as const;

export const purchasingRfqValidator = z.object({
  id: zfd.text(z.string().optional()),
  rfqId: zfd.text(z.string().optional()),
  rfqDate: z.string().min(1, { message: "RFQ Date is required" }),
  expirationDate: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  employeeId: zfd.text(z.string().optional()),
  status: z.enum(purchasingRfqStatusType).optional(),
  supplierIds: z
    .array(z.string())
    .min(1, { message: "At least one supplier is required" })
});

export const purchasingRfqLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchasingRfqId: z.string().min(1, { message: "RFQ is required" }),
  itemId: z.string().min(1, { message: "Part is required" }),
  description: zfd.text(z.string().optional()),
  quantity: z.array(
    zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
  ),
  purchaseUnitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  inventoryUnitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  conversionFactor: zfd.numeric(z.number().optional()),
  order: zfd.numeric(z.number().min(0))
});

export const purchasingRfqSuppliersValidator = z.object({
  purchasingRfqId: z.string().min(1, { message: "RFQ is required" }),
  supplierIds: z
    .array(z.string())
    .min(1, { message: "At least one supplier is required" })
});

export const purchasingRfqFinalizeValidator = z.object({
  suppliers: z.array(
    z.object({
      supplierId: z.string().min(1),
      rfqSupplierId: z.string().min(1),
      contactId: zfd.text(z.string().optional())
    })
  )
});

// RFQ Status Helpers
export const PURCHASING_RFQ_EDITABLE_STATUSES = ["Draft"] as const;
export const PURCHASING_RFQ_LOCKED_STATUSES = ["Requested", "Closed"] as const;

export function isRfqEditable(status: string | null | undefined): boolean {
  return PURCHASING_RFQ_EDITABLE_STATUSES.includes(
    status as (typeof PURCHASING_RFQ_EDITABLE_STATUSES)[number]
  );
}

export function isRfqLocked(status: string | null | undefined): boolean {
  return PURCHASING_RFQ_LOCKED_STATUSES.includes(
    status as (typeof PURCHASING_RFQ_LOCKED_STATUSES)[number]
  );
}

// Purchase Order Locked Status Validation

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

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
