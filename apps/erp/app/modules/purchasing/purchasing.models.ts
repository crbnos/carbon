// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  addDays,
  addMonths,
  bicMatchesCountry,
  getBankFieldConfig,
  isValidSwiftBic,
  type TaxPair,
  taxableBase,
  taxPairFromAmount,
  taxPairFromPercent
} from "@carbon/utils";
import {
  type CalendarDate,
  getLocalTimeZone,
  parseDate,
  startOfWeek,
  today
} from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import {
  incoterms,
  itemType,
  taxExemptionReasons
} from "../shared/shared.models";

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
  "Service",
  "Material",
  "Tool",
  "Consumable",
  "G/L Account",
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

export const supplierStatusType = [
  "Active",
  "Inactive",
  "Pending",
  "Rejected"
] as const;

export const supplierQuoteStatusType = [
  "Draft",
  "Active",
  "Expired",
  "Declined",
  "Cancelled"
] as const;

export function isSupplierQuoteLocked(
  status: string | null | undefined
): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

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
  // The chart and the drawer's open-order rows use this to tell an existing
  // line from a suggested order. The Order action ignores it: an existing
  // line is edited only through updatePurchaseOrderLineSchedule.
  existingLineId: zfd.text(z.string().optional()),
  existingQuantity: zfd.numeric(z.number().optional()),
  existingReadableId: zfd.text(z.string().optional()),
  existingStatus: zfd.text(z.enum(purchaseOrderStatusType).optional()),
  supplierId: zfd.text(z.string().optional()),
  itemReadableId: zfd.text(z.string().optional()),
  unitPrice: zfd.numeric(z.number().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  // ── Reorder-policy attribution (copied from the Order action for
  // MRP-suggested orders; absent for user-added "Add Order" rows). ──
  policyName: zfd.text(z.string().optional()),
  reason: zfd.text(z.string().optional()),
  triggerValues: z
    .object({
      projectedStock: z.number().optional(),
      safetyStock: z.number().optional(),
      reorderPoint: z.number().optional(),
      reorderQuantity: z.number().optional(),
      lotSize: z.number().optional(),
      leadTime: z.number().optional()
    })
    .optional()
});

export type PlannedOrder = z.infer<typeof plannedOrderValidator>;

export const purchaseOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  purchaseOrderType: z.enum(purchaseOrderTypeType, {
    error: "Type is required"
  }),
  status: z.enum(purchaseOrderStatusType).optional(),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  locationId: zfd.text(z.string().optional()),
  supplierLocationId: zfd.text(z.string().optional()),
  supplierContactId: zfd.text(z.string().optional()),
  supplierReference: zfd.text(z.string().optional()),
  orderDate: zfd.text(z.string().optional()),
  notes: z.any().optional(),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional())
});

export const supplierQuoteFinalizeValidator = z
  .object({
    notification: z.enum(["Email", "Share"]).optional(),
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
    notes: zfd.text(z.string().optional()),
    incoterm: zfd.text(z.enum(incoterms).optional()),
    incotermLocation: zfd.text(z.string().optional())
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
    purchaseOrderLineType: z.enum(
      [...itemType, "Fixture", "G/L Account", "Fixed Asset"],
      {
        error: "Type is required"
      }
    ),
    itemId: zfd.text(z.string().optional()),
    accountId: zfd.text(z.string().optional()),
    costCenterId: zfd.text(z.string().optional()),
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
    requiredDate: zfd.text(z.string().optional()),
    storageUnitId: zfd.text(z.string().optional()),
    supplierPartId: zfd.text(z.string().optional()),
    supplierShippingCost: zfd.numeric(z.number().optional()),
    supplierTaxAmount: zfd.numeric(z.number().optional()),
    supplierUnitPrice: zfd.numeric(z.number().optional()),
    taxPercent: zfd.numeric(z.number().min(0).max(1).optional().default(0))
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
      path: ["itemId"]
    }
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "G/L Account" ? data.accountId : true,
    {
      message: "Account is required",
      path: ["accountId"]
    }
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "G/L Account" ? data.description : true,
    {
      message: "Description is required",
      path: ["description"]
    }
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "Fixed Asset"
        ? (data.purchaseQuantity ?? 1) === 1
        : true,
    {
      message: "Fixed Asset quantity must be 1",
      path: ["purchaseQuantity"]
    }
  );

export const purchaseOrderPaymentValidator = z.object({
  id: z.string(),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional())
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
  // The base-currency twin of supplierTaxAmount, matching the unitPrice /
  // supplierUnitPrice and shippingCost / supplierShippingCost pairs above.
  // Optional so the supplier portal and the to-order drawer keep working
  // without it; only cross-supplier totals need a comparable tax figure.
  taxAmount: z.number().optional().default(0),
  // Same 0..1 fraction contract as purchaseOrderLineValidator — the two feed the
  // same columns, so an unbounded rate here would bypass the form's bound.
  taxPercent: z.number().min(0).max(1).optional().default(0),
  unitPrice: z.number()
});

export const selectedLinesValidator = z.record(z.string(), selectedLineSchema);

export const supplierValidator = z.object({
  id: zfd.text(z.string().optional()),
  readableId: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  supplierStatus: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.enum(supplierStatusType).optional().nullable()
  ),
  supplierTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  purchasingContactId: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional())
  // defaultCc: z.array(z.string().email()).default([])
});

export const supplierApprovalValidator = z.object({
  id: zfd.text(z.string().optional()),
  readableId: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  supplierStatus: z.enum(supplierStatusType, {
    error: "Supplier status is required"
  }),
  supplierTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  purchasingContactId: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional())
  // defaultCc: z.array(z.string().email()).default([])
});

export const supplierTaxValidator = z
  .object({
    supplierId: z.string().min(1),
    taxId: zfd.text(z.string().optional()),
    vatNumber: zfd.text(z.string().optional()),
    eori: zfd.text(z.string().optional()),
    taxExempt: z.coerce.boolean().default(false),
    taxExemptionReason: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.enum(taxExemptionReasons).optional().nullable()
    ),
    taxExemptionCertificateNumber: zfd.text(z.string().optional())
  })
  .refine(
    (data) => !data.taxExempt || (data.taxExempt && data.taxExemptionReason),
    {
      message: "Exemption reason is required when tax exempt",
      path: ["taxExemptionReason"]
    }
  );

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

export const supplierBankAccountValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    supplierId: z.string().min(1, { message: "Supplier is required" }),
    name: zfd.text(z.string().min(1, { message: "Name is required" })),
    accountHolderName: zfd.text(z.string().optional()),
    bankName: zfd.text(z.string().min(1, { message: "Bank name is required" })),
    // Correspondent banks route international wires on this.
    bankAddress: zfd.text(
      z.string().min(1, { message: "Bank address is required" })
    ),
    // Required because it SELECTS the validation rules below — left blank, the
    // permissive default applies and nothing is really checked.
    countryCode: zfd.text(
      z.string().min(1, { message: "Country is required" })
    ),
    currencyCode: zfd.text(z.string().optional()),
    // Generic by design: `accountNumber` holds an IBAN in SEPA and a plain
    // account number elsewhere; `bankCode` holds an ABA / sort code / BSB /
    // IFSC / transit. countryCode decides which validator applies, so a new
    // country is an entry in getBankFieldConfig, not a migration.
    accountNumber: zfd.text(z.string().optional()),
    bankCode: zfd.text(z.string().optional()),
    swiftBic: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .superRefine((data, ctx) => {
    const config = getBankFieldConfig(data.countryCode);

    if (!data.accountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An account number is required",
        path: ["accountNumber"]
      });
    } else if (
      config.validateAccount &&
      !config.validateAccount(data.accountNumber)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid account number for the selected country",
        path: ["accountNumber"]
      });
    }

    if (config.bankCodeLabel !== null) {
      // A country that defines a routing identifier always needs it — there is
      // no scheme where it is optional.
      if (!data.bankCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A bank code is required for the selected country",
          path: ["bankCode"]
        });
      } else if (
        config.validateBankCode &&
        !config.validateBankCode(data.bankCode)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid bank code for the selected country",
          path: ["bankCode"]
        });
      }
    }

    // Cross-border payments will not route without a BIC, so where the country
    // config demands one, absence is an error rather than a blank field.
    if (!data.swiftBic) {
      if (config.requiresSwift) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A SWIFT/BIC code is required for this country",
          path: ["swiftBic"]
        });
      }
    } else if (!isValidSwiftBic(data.swiftBic)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid SWIFT/BIC code",
        path: ["swiftBic"]
      });
    } else if (!bicMatchesCountry(data.swiftBic, data.countryCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This SWIFT/BIC belongs to a different country",
        path: ["swiftBic"]
      });
    }
  })
  // Countries with no routing identifier (SEPA: the IBAN carries it) unmount the
  // input, so nothing is submitted. Left undefined, an update would skip the
  // column entirely and strand the previous country's code on the row — so it is
  // explicitly nulled rather than merely absent.
  .transform((data) => ({
    ...data,
    bankCode:
      getBankFieldConfig(data.countryCode).bankCodeLabel === null
        ? null
        : (data.bankCode ?? null)
  }));

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
  shippingMethodId: zfd.text(z.string().optional()),
  incoterm: zfd.text(z.enum(incoterms).optional()),
  incotermLocation: zfd.text(z.string().optional())
});

export const supplierAccountingValidator = z.object({
  id: zfd.text(z.string()),
  supplierTypeId: zfd.text(z.string().optional())
});

export const supplierTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const supplierQuoteValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    supplierQuoteId: zfd.text(z.string().optional()),
    supplierQuoteType: z.enum(purchaseOrderTypeType, {
      error: "Type is required"
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

export const supplierQuoteLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    supplierQuoteId: z.string(),
    supplierQuoteLineType: z.enum([...itemType, "G/L Account"], {
      error: "Type is required"
    }),
    itemId: zfd.text(z.string().optional()),
    accountId: zfd.text(z.string().optional()),
    costCenterId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    supplierPartId: zfd.text(z.string().optional()),
    inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().optional()),
    requiredDate: zfd.text(z.string().optional()),
    quantity: z.array(
      zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
    )
  })
  .refine(
    (data) =>
      ["Part", "Service", "Material", "Tool", "Fixture", "Consumable"].includes(
        data.supplierQuoteLineType
      )
        ? data.itemId
        : true,
    {
      message: "Part is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) =>
      data.supplierQuoteLineType === "G/L Account" ? data.accountId : true,
    {
      message: "Account is required",
      path: ["accountId"]
    }
  )
  .refine(
    (data) =>
      [
        "Part",
        "Service",
        "Material",
        "Tool",
        "Fixture",
        "Consumable",
        "G/L Account"
      ].includes(data.supplierQuoteLineType)
        ? data.description
        : true,
    {
      message: "Description is required",
      path: ["description"]
    }
  );

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

/**
 * Purchase Order statuses that indicate the PO has been finalized/approved
 * and is now "locked" - meaning only privileged users can make limited edits
 */
export const PURCHASE_ORDER_LOCKED_STATUSES = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed"
] as const;

export type PurchaseOrderLockedStatus =
  (typeof PURCHASE_ORDER_LOCKED_STATUSES)[number];

/**
 * Check if a PO status is "locked" (finalized/approved)
 */
export function isPurchaseOrderLocked(
  status: (typeof purchaseOrderStatusType)[number] | string | null | undefined
): boolean {
  return PURCHASE_ORDER_LOCKED_STATUSES.includes(
    status as PurchaseOrderLockedStatus
  );
}

/**
 * The PO statuses planning may change: Apply on a planning action, the order
 * drawer's inline edits, and Cancel's line delete. An allowlist on purpose —
 * a PO in approval (Needs Approval, To Review, Rejected) or sent to the supplier
 * is reviewed on the PO. Matches MRP's own `isCommittedPurchaseOrderStatus`
 * (`@carbon/planning`), which offers "Review on PO" for every other status.
 */
export const PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "Planned"
] as const;

export function isPurchaseOrderEditableFromPlanning(
  status: Database["public"]["Enums"]["purchaseOrderStatus"] | null | undefined
): boolean {
  return PLANNING_EDITABLE_PURCHASE_ORDER_STATUSES.some(
    (editable) => editable === status
  );
}

/**
 * The tax pair for a PO line whose quantity changes. The extended price is a
 * generated column, the tax amount is not, so a quantity write must restate
 * the amount at the line's rate or the pair stops agreeing.
 *
 * A line with a rate keeps it. A line that holds only an amount (written before
 * the pair was enforced) has its rate derived once from the old base, so its
 * tax scales with the quantity instead of being zeroed.
 */
export function taxPairForQuantity(
  line: {
    supplierUnitPrice: number | null;
    supplierShippingCost: number | null;
    purchaseQuantity: number | null;
    taxPercent: number | null;
    supplierTaxAmount: number | null;
  },
  purchaseQuantity: number,
  currencyDecimals: number
): TaxPair {
  const unitPrice = Number(line.supplierUnitPrice ?? 0);
  const shippingCost = Number(line.supplierShippingCost ?? 0);
  const rate =
    line.taxPercent ??
    taxPairFromAmount(
      taxableBase(unitPrice, Number(line.purchaseQuantity ?? 0), shippingCost),
      Number(line.supplierTaxAmount ?? 0),
      0
    ).percent;

  return taxPairFromPercent(
    taxableBase(unitPrice, purchaseQuantity, shippingCost),
    rate,
    currencyDecimals
  );
}

/**
 * The week a planned PO line is ordered in, as the date that week starts.
 * Planning raises one PO per supplier per week, so each PO can be finalized
 * and sent alone while the later weeks stay Planned and MRP can still change
 * them. Weeks start on Sunday, as the planning grid's periods do
 * (`getOrCreatePeriods`). A line due before `asOf` (the location's today), or
 * with no due date, is in the current week: it is late, so it goes on the next PO sent.
 */
export function planningPurchaseOrderWeek(
  requiredDate: string | null | undefined,
  asOf: CalendarDate
): string {
  const due = requiredDate ? parseDate(requiredDate) : asOf;
  return startOfWeek(due.compare(asOf) < 0 ? asOf : due, "en-US").toString();
}

/**
 * The open PO a planned order for `week` joins: the oldest candidate for the
 * supplier, in the supplier's currency, whose lines are ALL in that week.
 * Candidates are the supplier's Draft / Planned purchase orders at the
 * location, oldest first. A PO with lines in several weeks (raised before the
 * weekly rule, or a line moved by hand) takes no more orders, so it cannot
 * keep collecting weeks, and a PO with no lines is never reused.
 */
export function findPlanningPurchaseOrder<
  P extends {
    supplierId: string;
    currencyCode: string | null;
    purchaseOrderLine: { requiredDate: string | null }[];
  }
>(
  candidates: P[],
  target: { supplierId: string; currencyCode: string; week: string },
  asOf: CalendarDate
): P | undefined {
  return candidates.find(
    (po) =>
      po.supplierId === target.supplierId &&
      po.currencyCode === target.currencyCode &&
      po.purchaseOrderLine.length > 0 &&
      po.purchaseOrderLine.every(
        (line) =>
          planningPurchaseOrderWeek(line.requiredDate, asOf) === target.week
      )
  );
}

/**
 * The statuses a reopen moves a purchase order back to: Draft from the PO
 * page, Planned from the planning pages. Planned because Draft is not MRP
 * supply (`openPurchaseOrderLines` leaves it out): a PO reopened to Draft from
 * planning dropped out of the plan, and the next run suggested its whole
 * quantity again as a new order.
 */
export const PURCHASE_ORDER_REOPEN_STATUSES = ["Draft", "Planned"] as const;

export function isPurchaseOrderReopenStatus(
  status: string | null | undefined
): status is (typeof PURCHASE_ORDER_REOPEN_STATUSES)[number] {
  return PURCHASE_ORDER_REOPEN_STATUSES.some((reopen) => reopen === status);
}

/**
 * Whether a status change is ELIGIBLE to create a revision — the bump itself
 * also requires the explicit `createRevision` flag. Only a released order
 * reopened to Draft or Planned qualifies: `orderDate` is set at finalize, so
 * an order reopened from "Needs Approval" or closed straight from Draft never
 * reached the supplier.
 */
export function canCreatePurchaseOrderRevision(transition: {
  newStatus: (typeof purchaseOrderStatusType)[number];
  currentStatus: string | null | undefined;
  orderDate: string | null | undefined;
}): boolean {
  return (
    isPurchaseOrderReopenStatus(transition.newStatus) &&
    isPurchaseOrderLocked(transition.currentStatus) &&
    Boolean(transition.orderDate)
  );
}

/**
 * Why `userId` may not delete a purchase order, or null. Only a Draft,
 * Planned or Needs Approval order can be deleted, and one that needs approval
 * only by the person who requested it (`requestedBy`, its latest pending
 * request): an approver rejects it instead.
 */
export function purchaseOrderDeleteRefusal({
  status,
  requestedBy,
  userId
}: {
  status: string | null | undefined;
  requestedBy: string | null | undefined;
  userId: string;
}): "status" | "notRequester" | null {
  if (!["Draft", "Planned", "Needs Approval"].includes(status ?? "")) {
    return "status";
  }
  if (status === "Needs Approval" && requestedBy && requestedBy !== userId) {
    return "notRequester";
  }
  return null;
}

// ─── Purchase Return Orders (Supplier Returns) ───

export const purchaseReturnOrderStatusType = [
  "Draft",
  "To Ship",
  "Completed",
  "Cancelled"
] as const;

export const PURCHASE_RETURN_ORDER_LOCKED_STATUSES = [
  "Completed",
  "Cancelled"
] as const;

export function isPurchaseReturnOrderLocked(
  status: string | null | undefined
): boolean {
  return PURCHASE_RETURN_ORDER_LOCKED_STATUSES.includes(
    status as (typeof PURCHASE_RETURN_ORDER_LOCKED_STATUSES)[number]
  );
}

export const purchaseReturnOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseReturnOrderId: zfd.text(z.string().optional()),
  status: z.enum(purchaseReturnOrderStatusType).optional(),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  supplierLocationId: zfd.text(z.string().optional()),
  supplierContactId: zfd.text(z.string().optional()),
  supplierReference: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  orderDate: z.string().min(1, { message: "Order date is required" }),
  expirationDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional())
});

export const purchaseReturnOrderLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseReturnOrderId: z
    .string()
    .min(1, { message: "Return order is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be positive" })
  ),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  unitPrice: zfd.numeric(z.number().min(0)),
  restockFeePercent: zfd.numeric(z.number().min(0).max(1).optional()),
  returnReasonId: zfd.text(z.string().optional()),
  purchaseOrderLineId: zfd.text(z.string().optional()),
  receiptLineId: zfd.text(z.string().optional()),
  purchaseInvoiceLineId: zfd.text(z.string().optional()),
  trackedEntityIds: zfd.repeatableOfType(z.string()).optional()
});

/**
 * The first field a change to a confirmed return line would move that is
 * locked after confirmation, by its label; null when none. A field counts as
 * changed only when it was sent AND differs — the update writes only the
 * fields it is given.
 */
export function lockedReturnLineField(
  next: {
    quantity: number;
    itemId: string;
    unitPrice: number;
    restockFeePercent?: number;
    unitOfMeasureCode?: string;
    purchaseOrderLineId?: string;
    receiptLineId?: string;
    purchaseInvoiceLineId?: string;
  },
  current: {
    quantity: number | null;
    itemId: string | null;
    unitPrice: number | null;
    restockFeePercent: number | null;
    unitOfMeasureCode: string | null;
    purchaseOrderLineId: string | null;
    receiptLineId: string | null;
    purchaseInvoiceLineId: string | null;
  }
): string | null {
  const fields: [string, unknown, unknown][] = [
    ["Quantity", Number(next.quantity), Number(current.quantity)],
    ["Item", next.itemId, current.itemId],
    ["Unit price", Number(next.unitPrice), Number(current.unitPrice)],
    [
      "Restocking fee",
      next.restockFeePercent === undefined
        ? undefined
        : Number(next.restockFeePercent),
      Number(current.restockFeePercent)
    ],
    [
      "Unit of measure",
      next.unitOfMeasureCode,
      current.unitOfMeasureCode ?? undefined
    ],
    [
      "Purchase order line link",
      next.purchaseOrderLineId,
      current.purchaseOrderLineId ?? undefined
    ],
    [
      "Receipt line link",
      next.receiptLineId,
      current.receiptLineId ?? undefined
    ],
    [
      "Invoice line link",
      next.purchaseInvoiceLineId,
      current.purchaseInvoiceLineId ?? undefined
    ]
  ];
  const changed = fields.find(
    ([, value, saved]) => value !== undefined && value !== saved
  );
  return changed ? changed[0] : null;
}

// Credit dialog: repeatable per-line quantity rows (same encoding as
// selectedLines — a JSON-encoded field)
export const purchaseReturnOrderCreditValidator = z.object({
  lines: z
    .string()
    .transform((val, ctx) => {
      try {
        return JSON.parse(val) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid lines" });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(
          z.object({
            purchaseReturnOrderLineId: z.string().min(1),
            quantity: z.number().min(0)
          })
        )
        .min(1, { message: "At least one line is required" })
    )
});

// -- Leases (lessee, ASC 842) -------------------------------------------------
// Spec: `.ai/specs/2026-10-11-lessee-leases.md`. Every enum value comes from
// these arrays — the DB enums of the same name.

export const leaseStatuses = [
  "Draft",
  "Active",
  "Expired",
  "Terminated",
  "Purchased",
  "Cancelled"
] as const;

export const lesseeClassifications = [
  "Operating",
  "Finance",
  "Short-Term"
] as const;

export const leasePaymentFrequencies = [
  "Monthly",
  "Quarterly",
  "Annual"
] as const;

export const leasePaymentTimings = ["Advance", "Arrears"] as const;

export const leasePaymentStatuses = ["Pending", "Invoiced", "Skipped"] as const;

export const leasePaymentTypes = [
  "Rent",
  "Purchase Option",
  "Termination Penalty"
] as const;

/** Whether `later` is on or after `earlier`; both `YYYY-MM-DD`. A malformed
 *  date fails the check instead of throwing out of the refine. */
function isOnOrAfter(later: string, earlier: string): boolean {
  try {
    return parseDate(later).compare(parseDate(earlier)) >= 0;
  } catch {
    return false;
  }
}

/** A real calendar date written `YYYY-MM-DD` — what a DATE column takes and
 *  what the lease's month arithmetic parses. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return parseDate(value).toString() === value;
  } catch {
    return false;
  }
}

const INVALID_DATE = "Enter a date as YYYY-MM-DD";

/** A required lease date. */
const leaseDate = (required: string) =>
  z
    .string()
    .min(1, { message: required })
    .refine(isIsoDate, { message: INVALID_DATE });

/** An optional lease date: a cleared DatePicker posts "". */
const optionalLeaseDate = () =>
  zfd.text(z.string().refine(isIsoDate, { message: INVALID_DATE }).optional());

/** How long a lease runs, as the Details step asks it (the AR contract's
 *  Duration): N months from commencement, open-ended, or a custom end date.
 *  Not stored — `leaseDurationOf` reads it back from the dates. */
export const leaseDurations = [
  "12",
  "24",
  "36",
  "48",
  "60",
  "open",
  "custom"
] as const;

export type LeaseDuration = (typeof leaseDurations)[number];

/** The end date a duration gives: N months ends the day before the same
 *  date N months on (`addMonths` clamps to the month end, as the payment
 *  rows do), so 36 months from 1 Jan 2027 ends 31 Dec 2029. Null is
 *  open-ended. */
export function leaseEndDate(
  commencementDate: string,
  duration: LeaseDuration,
  endDate?: string | null
): string | null {
  if (duration === "open") return null;
  if (duration === "custom") return endDate || null;
  return addDays(addMonths(commencementDate, Number(duration)), -1);
}

/** `leaseEndDate`, or null when the commencement is not a date — for a
 *  refine, which must report the bad date rather than throw on it. */
function safeLeaseEndDate(
  commencementDate: string,
  duration: LeaseDuration,
  endDate?: string | null
): string | null {
  try {
    return leaseEndDate(commencementDate, duration, endDate);
  } catch {
    return null;
  }
}

/** The dates the payment rows are cut from, as they are saved. The end date
 *  comes from the duration when the Details step sends one (a single saved
 *  term keeps the one given; null is open-ended). Invoicing starts at
 *  commencement unless it was moved: an invoice-from date that still equals
 *  the current commencement, and was not changed, follows a new
 *  commencement. `current` is null for a new lease. */
export function resolveLeaseDates(
  current: { commencementDate: string; invoiceFromDate: string } | null,
  next: {
    commencementDate: string;
    duration?: LeaseDuration;
    endDate?: string | null;
    invoiceFromDate?: string | null;
  }
): {
  commencementDate: string;
  endDate: string | null;
  invoiceFromDate: string;
} {
  const followsCommencement =
    current !== null &&
    current.invoiceFromDate === current.commencementDate &&
    (!next.invoiceFromDate || next.invoiceFromDate === current.invoiceFromDate);
  return {
    commencementDate: next.commencementDate,
    endDate: next.duration
      ? leaseEndDate(next.commencementDate, next.duration, next.endDate)
      : next.endDate || null,
    invoiceFromDate: followsCommencement
      ? next.commencementDate
      : next.invoiceFromDate || next.commencementDate
  };
}

/** The duration a lease's dates show: a preset when the end falls exactly
 *  N months on, open-ended without an end, else custom. */
export function leaseDurationOf(lease: {
  commencementDate: string | null;
  endDate: string | null;
}): LeaseDuration {
  if (!lease.endDate) return "open";
  if (!lease.commencementDate) return "custom";
  return (
    leaseDurations.find(
      (duration) =>
        duration !== "open" &&
        duration !== "custom" &&
        leaseEndDate(lease.commencementDate!, duration) === lease.endDate
    ) ?? "custom"
  );
}

export const leaseValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    leaseId: zfd.text(z.string().optional()),
    name: zfd.text(z.string().trim().optional()),
    description: zfd.text(z.string().optional()),
    supplierId: z.string().min(1, { message: "Supplier is required" }),
    supplierLocationId: zfd.text(z.string().optional()),
    supplierContactId: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    assignee: zfd.text(z.string().optional()),
    commencementDate: leaseDate("Commencement date is required"),
    /** Absent when a single term is saved: the end date is then as given. */
    duration: z.enum(leaseDurations).optional(),
    /** Empty is open-ended. */
    endDate: optionalLeaseDate(),
    noticeDate: optionalLeaseDate(),
    invoiceFromDate: optionalLeaseDate(),
    paymentFrequency: z.enum(leasePaymentFrequencies, {
      error: "Payment frequency is required"
    }),
    paymentTiming: z.enum(leasePaymentTimings, {
      error: "Payment timing is required"
    }),
    annualEscalationPercent: zfd.numeric(
      z.number().min(0, { message: "Escalation cannot be negative" }).default(0)
    ),
    discountRate: zfd.numeric(
      z.number().min(0, { message: "Discount rate cannot be negative" })
    ),
    currencyCode: z.string().min(1, { message: "Currency is required" })
  })
  .refine((data) => data.duration !== "custom" || !!data.endDate, {
    message: "End date is required",
    path: ["endDate"]
  })
  .refine(
    (data) =>
      !data.endDate ||
      data.duration === "open" ||
      isOnOrAfter(data.endDate, data.commencementDate),
    {
      message: "End date must be on or after the commencement date",
      path: ["endDate"]
    }
  )
  .refine(
    (data) => {
      const end = data.duration
        ? safeLeaseEndDate(data.commencementDate, data.duration, data.endDate)
        : data.endDate || null;
      return !data.noticeDate || !end || isOnOrAfter(end, data.noticeDate);
    },
    {
      message: "The notice date must be on or before the end date",
      path: ["noticeDate"]
    }
  )
  .refine(
    (data) =>
      !data.invoiceFromDate ||
      isOnOrAfter(data.invoiceFromDate, data.commencementDate),
    {
      message: "Invoicing cannot start before the commencement date",
      path: ["invoiceFromDate"]
    }
  );

/** The lease terms a write may set — never `status`, the classification or
 *  anything activation owns. Picked rather than spread: the inputs of a
 *  service reach it unfiltered. `current` is the saved lease (null when it
 *  is new), so an invoice-from date that followed the commencement keeps
 *  following it (`resolveLeaseDates`). */
export function leaseTermColumns(
  terms: Omit<z.infer<typeof leaseValidator>, "id" | "leaseId">,
  current: { commencementDate: string; invoiceFromDate: string } | null = null
) {
  return {
    name: terms.name || null,
    description: terms.description ?? null,
    supplierId: terms.supplierId,
    supplierLocationId: terms.supplierLocationId || null,
    supplierContactId: terms.supplierContactId || null,
    locationId: terms.locationId || null,
    assignee: terms.assignee || null,
    ...resolveLeaseDates(current, terms),
    // A cleared DatePicker posts "", which a DATE column rejects.
    noticeDate: terms.noticeDate || null,
    paymentFrequency: terms.paymentFrequency,
    paymentTiming: terms.paymentTiming,
    annualEscalationPercent: terms.annualEscalationPercent,
    discountRate: terms.discountRate,
    currencyCode: terms.currencyCode
  };
}

/** The lease terms every asset's payment rows are cut from: a change cuts
 *  them again (`regenerateLeasePayments`). */
export const leasePaymentTermFields = [
  "commencementDate",
  "endDate",
  "invoiceFromDate",
  "paymentFrequency",
  "paymentTiming",
  "annualEscalationPercent"
] as const satisfies readonly (keyof ReturnType<typeof leaseTermColumns>)[];

/** What stays editable once a lease has started: who owns it, when to give
 *  notice, what it is called and its notes. Every term the books were
 *  measured from changes only with Modify. The database refuses the rest
 *  (`lease_api_write_guard`). */
export const leaseDetailFields = [
  "name",
  "description",
  "assignee",
  "noticeDate"
] as const;

export type LeaseDetailField = (typeof leaseDetailFields)[number];

/** A started lease's details (`leaseDetailFields`). Pass `endDate` to check
 *  a notice date against it. */
export const leaseDetailsValidator = z
  .object({
    name: zfd.text(z.string().trim().optional()),
    description: zfd.text(z.string().optional()),
    assignee: zfd.text(z.string().optional()),
    noticeDate: optionalLeaseDate(),
    endDate: optionalLeaseDate()
  })
  .refine(
    (data) =>
      !data.noticeDate ||
      !data.endDate ||
      isOnOrAfter(data.endDate, data.noticeDate),
    {
      message: "The notice date must be on or before the end date",
      path: ["noticeDate"]
    }
  );

/** One leased asset (a separate lease component): its payment and the
 *  inputs its classification tests read. */
export const leaseLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    leaseId: z.string().min(1, { message: "Lease is required" }),
    description: z
      .string()
      .trim()
      .min(1, { message: "Description is required" }),
    serialNumber: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    paymentAmount: zfd.numeric(
      z.number().min(0, { message: "Payment cannot be negative" }).default(0)
    ),
    fairValue: zfd.numeric(
      z.number().min(0, { message: "Fair value cannot be negative" }).optional()
    ),
    economicLifeMonths: zfd.numeric(
      z
        .number()
        .int()
        .min(1, { message: "Economic life must be at least one month" })
        .optional()
    ),
    ownershipTransfers: zfd.checkbox(),
    specializedAsset: zfd.checkbox(),
    purchaseOptionAmount: zfd.numeric(
      z
        .number()
        .min(0, { message: "Purchase option cannot be negative" })
        .optional()
    ),
    purchaseOptionReasonablyCertain: zfd.checkbox()
  })
  .refine(
    (data) =>
      !data.purchaseOptionReasonablyCertain ||
      (data.purchaseOptionAmount ?? 0) > 0,
    {
      message: "A purchase option that is reasonably certain needs an amount",
      path: ["purchaseOptionAmount"]
    }
  );

/** The fields of a leased asset a write may set — never its status, its
 *  classification or anything activation owns. Picked rather than spread. */
export function leaseLineColumns(
  line: Omit<z.infer<typeof leaseLineValidator>, "id" | "leaseId">
) {
  return {
    description: line.description,
    serialNumber: line.serialNumber || null,
    locationId: line.locationId || null,
    paymentAmount: line.paymentAmount,
    fairValue: line.fairValue ?? null,
    economicLifeMonths: line.economicLifeMonths ?? null,
    ownershipTransfers: line.ownershipTransfers,
    specializedAsset: line.specializedAsset,
    purchaseOptionAmount: line.purchaseOptionAmount ?? null,
    purchaseOptionReasonablyCertain: line.purchaseOptionReasonablyCertain
  };
}

/** The asset fields its payment rows are cut from: a change cuts them
 *  again. */
export const leaseLinePaymentFields = [
  "paymentAmount",
  "purchaseOptionAmount",
  "purchaseOptionReasonablyCertain"
] as const satisfies readonly (keyof ReturnType<typeof leaseLineColumns>)[];

export const leasePaymentValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    leaseId: z.string().min(1, { message: "Lease is required" }),
    leaseLineId: z.string().min(1, { message: "Asset is required" }),
    paymentType: z.enum(leasePaymentTypes).default("Rent"),
    periodStart: leaseDate("Period start is required"),
    periodEnd: leaseDate("Period end is required"),
    dueDate: leaseDate("Due date is required"),
    amount: zfd.numeric(
      z.number().min(0, { message: "Amount cannot be negative" })
    )
  })
  .refine((data) => isOnOrAfter(data.periodEnd, data.periodStart), {
    message: "The period must end on or after it starts",
    path: ["periodEnd"]
  });

/** A manual lessee classification, audit-logged with its reason. */
export const leaseClassificationValidator = z.object({
  classification: z.enum(["Operating", "Finance"], {
    error: "Classification is required"
  }),
  reason: z.string().trim().min(1, { message: "A reason is required" })
});

/** Modify (remeasure) a lease from an effective date: the remaining
 *  payments of every active asset are cut again from these terms, each at
 *  its own payment amount. */
export const leaseModifyValidator = z
  .object({
    effectiveDate: leaseDate("Effective date is required"),
    endDate: leaseDate("End date is required"),
    discountRate: zfd.numeric(
      z.number().min(0, { message: "Discount rate cannot be negative" })
    ),
    lines: zfd.repeatableOfType(
      z.object({
        leaseLineId: z.string().min(1),
        paymentAmount: zfd.numeric(
          z.number().min(0, { message: "Payment cannot be negative" })
        )
      })
    ),
    paymentFrequency: z.enum(leasePaymentFrequencies, {
      error: "Payment frequency is required"
    }),
    annualEscalationPercent: zfd.numeric(
      z.number().min(0, { message: "Escalation cannot be negative" }).default(0)
    ),
    notes: zfd.text(z.string().optional())
  })
  .refine((data) => isOnOrAfter(data.endDate, data.effectiveDate), {
    message: "The end date must be on or after the effective date",
    path: ["endDate"]
  });

export const leaseTerminateValidator = z.object({
  terminationDate: leaseDate("Termination date is required"),
  penaltyAmount: zfd.numeric(
    z.number().min(0, { message: "Penalty cannot be negative" }).default(0)
  ),
  notes: zfd.text(z.string().optional())
});

export const leasePurchaseValidator = z.object({
  exerciseDate: leaseDate("Exercise date is required"),
  purchasePrice: zfd.numeric(
    z.number().min(0, { message: "Price cannot be negative" })
  ),
  fixedAssetClassId: z
    .string()
    .min(1, { message: "Fixed asset class is required" }),
  name: z.string().trim().min(1, { message: "Asset name is required" }),
  notes: zfd.text(z.string().optional())
});
