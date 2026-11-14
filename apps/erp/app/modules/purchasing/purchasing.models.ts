// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  addDays,
  addMonths,
  bicMatchesCountry,
  colorNames,
  EPSILON,
  equals,
  getBankFieldConfig,
  getCompletionAfterQuantityChange,
  getRemainingQuantityToInvoice,
  groupBy,
  isValidSwiftBic,
  RoundingMode,
  round,
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
import {
  address,
  contact,
  contactEmailRequiredMessage,
  contactNameOrEmailMessage,
  hasContactEmail,
  hasContactNameOrEmail
} from "~/types/validators";
import {
  FORCE_DELETE_MIN_REASON_LENGTH,
  forceDeleteApprovalRefusal,
  forceDeleteWithdrawRefusal,
  incoterms,
  isForceDeleteConfirmed,
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
  // The Order action this suggestion came from, which Order settles
  planningActionId: zfd.text(z.string().optional()),
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
    cc: z.array(z.string()).optional(),
    partFiles: z.array(z.string()).optional()
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
    shippedDate: zfd.text(z.string().optional()),
    expectedReceiptDate: zfd.text(z.string().optional()),
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
    projectId: zfd.text(z.string().optional()),
    projectElementId: zfd.text(z.string().optional()),
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

export const supplierStageValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  /** Empty keeps the color derived from the name. */
  color: zfd.text(z.enum(colorNames).optional())
});

export const supplierValidator = z.object({
  id: zfd.text(z.string().optional()),
  readableId: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  supplierStatus: z.preprocess(
    (val) => (val === "" ? undefined : val),
    z.enum(supplierStatusType).optional().nullable()
  ),
  supplierStageId: zfd.text(z.string().optional()),
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
  supplierStageId: zfd.text(z.string().optional()),
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

export const supplierContactValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    ...contact,
    supplierLocationId: zfd.text(z.string().optional())
  })
  .refine(hasContactNameOrEmail, contactNameOrEmailMessage);

/** The supplier contact form when Purchasing settings require an email on supplier contacts. */
export const supplierContactEmailRequiredValidator =
  supplierContactValidator.refine(hasContactEmail, contactEmailRequiredMessage);

export const SUPPLIER_CONTACT_EMAIL_REQUIRED =
  "Every supplier contact needs an email (see Purchasing settings).";

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

/** The parts of one Request Quote: each line goes to its own suppliers. */
export const requestQuoteValidator = z.object({
  locationId: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        /** In the item's inventory unit. */
        quantity: z
          .number()
          .positive({ message: "Each part needs a quantity above 0" }),
        supplierIds: z
          .array(z.string().min(1))
          .min(1, { message: "Choose a supplier for each part" })
      })
    )
    .min(1, { message: "Choose at least one part" })
    // One insert writes every line; this keeps it under Postgres's bind limit.
    .max(1000, { message: "Request a quote for at most 1000 parts at a time" })
});

export type RequestQuoteLine = z.infer<
  typeof requestQuoteValidator
>["lines"][number];

/** Whole purchase units when the unit differs, as planning orders them; the
 * inner round strips float noise (1.1 / 0.1 = 11.000000000000002). */
export function toPurchaseQuantity(inventoryQuantity: number, factor: number) {
  return factor === 1
    ? round(inventoryQuantity)
    : round(round(inventoryQuantity / factor), 0, RoundingMode.Up);
}

/** One RFQ per set of suppliers, because every supplier on an RFQ gets every line. */
export function groupRequestQuoteLines(lines: RequestQuoteLine[]) {
  const groups = new Map<
    string,
    { supplierIds: string[]; lines: RequestQuoteLine[] }
  >();
  for (const line of lines) {
    const supplierIds = [...new Set(line.supplierIds)].sort();
    const key = supplierIds.join("|");
    const group = groups.get(key) ?? { supplierIds, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type MethodTreeRow = {
  methodMaterialId: string;
  parentMaterialId: string | null;
  itemId: string;
  itemReadableId: string;
  description: string;
  unitOfMeasureCode: string | null;
  quantity: number;
  methodType: string;
  replenishmentSystem: string | null;
  isPickDescendant: boolean | null;
};

export type RfqLineFromMethod = {
  itemId: string;
  itemReadableId: string;
  description: string;
  unitOfMeasureCode: string | null;
  /** For one of the root item, in the item's inventory unit. */
  quantity: number;
  usedIn: string[];
};

/**
 * The parts to buy for one of the root item, from its `get_method_tree` rows.
 * It walks into each Make to Order line and does not list it. It lists each
 * other line unless the item is only ever made, and a Make to Order line that
 * has no method to walk and can be bought. The contents of a part pulled from
 * stock are not needed, so it skips them, and so is a line with no quantity.
 * Repeats of an item add up.
 */
export function getRfqLinesFromMethod(
  tree: MethodTreeRow[],
  rootId: string,
  rootReadableId: string
): RfqLineFromMethod[] {
  const childrenOf = new Map<string, MethodTreeRow[]>();
  for (const row of tree) {
    if (!row.parentMaterialId) continue;
    const siblings = childrenOf.get(row.parentMaterialId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentMaterialId, siblings);
  }

  const lines = new Map<string, RfqLineFromMethod>();
  const walk = (
    parentId: string,
    parentReadableId: string,
    multiplier: number,
    path: Set<string>
  ) => {
    for (const row of childrenOf.get(parentId) ?? []) {
      if (row.isPickDescendant || path.has(row.methodMaterialId)) continue;
      const quantity = round(multiplier * row.quantity);
      // Nothing to buy, and a quantity of 0 fails the RFQ line's positive check.
      if (!(quantity > 0)) continue;
      if (
        row.methodType === "Make to Order" &&
        (childrenOf.has(row.methodMaterialId) ||
          row.replenishmentSystem === "Make")
      ) {
        walk(
          row.methodMaterialId,
          row.itemReadableId,
          quantity,
          new Set(path).add(row.methodMaterialId)
        );
        continue;
      }
      if (row.replenishmentSystem === "Make") continue;

      const line = lines.get(row.itemId);
      if (!line) {
        lines.set(row.itemId, {
          itemId: row.itemId,
          itemReadableId: row.itemReadableId,
          description: row.description,
          unitOfMeasureCode: row.unitOfMeasureCode,
          quantity,
          usedIn: [parentReadableId]
        });
        continue;
      }
      line.quantity = round(line.quantity + quantity);
      if (!line.usedIn.includes(parentReadableId)) {
        line.usedIn.push(parentReadableId);
      }
    }
  };
  walk(rootId, rootReadableId, 1, new Set());
  return [...lines.values()];
}

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
  ),
  partFiles: z.array(z.string()).optional()
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

// Purchase orders a supplier prepayment can be taken against: anything not
// terminal (Completed, Rejected, Closed). The purchasing mirror of
// OPEN_SALES_ORDER_STATUSES.
export const OPEN_PURCHASE_ORDER_STATUSES = [
  "Draft",
  "Planned",
  "Needs Approval",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice"
] as const;

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
 * Released statuses: the approval (or finalize, when no rule applied) is done,
 * so goods may be received and invoiced against the order.
 */
export const PURCHASE_ORDER_RELEASED_STATUSES = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
] as const satisfies readonly (typeof purchaseOrderStatusType)[number][];

/**
 * Released statuses an order may still be edited in. An edit keeps the order
 * released while its total stays within the approved amount; above it the
 * order goes back to Needs Approval (`settlePurchaseOrderAmendment`).
 */
export const PURCHASE_ORDER_AMENDABLE_STATUSES = [
  "To Receive",
  "To Receive and Invoice",
  "To Invoice"
] as const satisfies readonly (typeof purchaseOrderStatusType)[number][];

/**
 * Statuses an order may be invoiced in: the released ones and Closed. A
 * closed order takes nothing more from the supplier, but what it already
 * received under its approval is still billed.
 */
export const PURCHASE_ORDER_INVOICEABLE_STATUSES = [
  ...PURCHASE_ORDER_RELEASED_STATUSES,
  "Closed"
] as const satisfies readonly (typeof purchaseOrderStatusType)[number][];

/** Statuses no edit may change: waiting for an approver, or finished. */
export const PURCHASE_ORDER_EDIT_LOCKED_STATUSES = [
  "Needs Approval",
  "Completed",
  "Closed"
] as const satisfies readonly (typeof purchaseOrderStatusType)[number][];

export function isPurchaseOrderReleased(
  status: string | null | undefined
): boolean {
  return PURCHASE_ORDER_RELEASED_STATUSES.some((s) => s === status);
}

export function isPurchaseOrderAmendable(
  status: string | null | undefined
): boolean {
  return PURCHASE_ORDER_AMENDABLE_STATUSES.some((s) => s === status);
}

/**
 * Whether the order's lines, header, delivery and payment are read-only.
 * Not the same list as `isPurchaseOrderLocked`, which decides reopen and
 * revisions: a released order that is not complete is still editable.
 */
export function isPurchaseOrderEditLocked(
  status: string | null | undefined
): boolean {
  return PURCHASE_ORDER_EDIT_LOCKED_STATUSES.some((s) => s === status);
}

/**
 * Why an edit of a purchase order is refused, or null when it is allowed.
 * `changesSupplierOrCurrency`: the edit names another supplier or currency,
 * which a released order never takes (that is a new order).
 */
export function purchaseOrderEditRefusal(
  status: string | null | undefined,
  {
    changesSupplierOrCurrency = false
  }: { changesSupplierOrCurrency?: boolean } = {}
): string | null {
  if (status === "Needs Approval") {
    return "This purchase order is waiting for approval. Reopen it to make changes.";
  }
  if (status === "Completed" || status === "Closed") {
    return "Cannot modify a completed or closed purchase order. Reopen it to make changes.";
  }
  if (changesSupplierOrCurrency && isPurchaseOrderAmendable(status)) {
    return "Cannot change the supplier or currency of a released purchase order. Reopen it to make changes.";
  }
  return null;
}

/** The line fields a receipt or invoice was posted against. */
export type PurchaseOrderLineIdentity = {
  purchaseOrderLineType: string | null;
  itemId: string | null;
  assetId: string | null;
  purchaseUnitOfMeasureCode: string | null;
  conversionFactor: number | null;
};

/**
 * Why a line edit is refused, or null. A line never goes below what was
 * already received or invoiced, and a line with either cannot be deleted, in
 * any status: a reopened or rejected order keeps its receipts and invoices.
 * Such a line also keeps its type, item, asset, purchase unit and conversion
 * factor: the posted receipt and invoice lines name them, and the received
 * quantity is read through the factor. The type is compared too, since a
 * new type drops the item or asset on write. `purchaseQuantity` undefined means the edit leaves
 * it alone; null means the line is being deleted. `edit` holds the identity
 * fields the edit sends, compared with the line's own.
 */
export function purchaseOrderLineAmendRefusal(
  line: {
    quantityReceived: number | null;
    quantityInvoiced: number | null;
  } & Partial<PurchaseOrderLineIdentity>,
  purchaseQuantity: number | null | undefined,
  edit: Partial<PurchaseOrderLineIdentity> = {}
): string | null {
  const floor = Math.max(
    Number(line.quantityReceived ?? 0),
    Number(line.quantityInvoiced ?? 0)
  );
  if (purchaseQuantity === null) {
    return floor > 0
      ? "Cannot delete a line that has been received or invoiced."
      : null;
  }
  if (purchaseQuantity !== undefined && purchaseQuantity < floor) {
    return `The quantity cannot be lower than the ${floor} already received or invoiced.`;
  }
  if (floor > 0) {
    if (
      edit.purchaseOrderLineType !== undefined &&
      edit.purchaseOrderLineType !== line.purchaseOrderLineType
    ) {
      return "Cannot change the type of a line that has been received or invoiced.";
    }
    if (edit.itemId !== undefined && edit.itemId !== line.itemId) {
      return "Cannot change the item of a line that has been received or invoiced.";
    }
    if (edit.assetId !== undefined && edit.assetId !== line.assetId) {
      return "Cannot change the fixed asset of a line that has been received or invoiced.";
    }
    if (
      edit.purchaseUnitOfMeasureCode !== undefined &&
      edit.purchaseUnitOfMeasureCode !== line.purchaseUnitOfMeasureCode
    ) {
      return "Cannot change the unit of measure of a line that has been received or invoiced.";
    }
    if (
      edit.conversionFactor !== undefined &&
      Number(edit.conversionFactor) !== Number(line.conversionFactor ?? 1)
    ) {
      return "Cannot change the conversion factor of a line that has been received or invoiced.";
    }
  }
  return null;
}

/**
 * Why a line may not be deleted from an order in this status, or null. A
 * released order keeps every line it was sent with: lower the quantity
 * instead, or reopen the order.
 */
export function purchaseOrderLineDeleteRefusal(
  status: string | null | undefined
): string | null {
  return isPurchaseOrderAmendable(status)
    ? "Cannot delete a line from a released purchase order. Lower its quantity, or reopen the order to make changes."
    : null;
}

/**
 * Whether a released order's total is above what was approved. With no
 * approved request the order was released without one (no rule matched at
 * finalize, or the planning bypass), so there is nothing to exceed.
 */
export function exceedsApprovedAmount(
  total: number | null | undefined,
  approvedAmount: number | null | undefined
): boolean {
  if (approvedAmount === null || approvedAmount === undefined) return false;
  return Number(total ?? 0) > Number(approvedAmount) + EPSILON;
}

/**
 * What a purchase order line still bills, given its order's status. A line
 * short-closed by hand bills what was received; a Closed order takes nothing
 * more from the supplier, so every line of one bills the same way.
 */
export function purchaseOrderLineRemainingToInvoice(
  status: string | null | undefined,
  line: Parameters<typeof getRemainingQuantityToInvoice>[0]
): number {
  return getRemainingQuantityToInvoice(
    status === "Closed" ? { ...line, receivedComplete: true } : line
  );
}

/** What a caller of the funds gate moves against the order. */
export type PurchaseOrderFundsIntent = "receive" | "invoice";

/**
 * Why goods may not be received or invoiced against an order, or null. The
 * order must be released, and its total within its approved amount. An
 * invoice also takes a Closed order, but only one something was received
 * against: a Draft or unapproved order that was cancelled was never released,
 * and has nothing to bill.
 */
export function purchaseOrderFundsRefusal(
  order: {
    readableId?: string | null;
    status: string | null | undefined;
    total: number | null | undefined;
    approvedAmount: number | null | undefined;
    receivedQuantity?: number | null;
  },
  intent: PurchaseOrderFundsIntent
): string | null {
  const name = order.readableId
    ? `Purchase order ${order.readableId}`
    : "The purchase order";
  const allowed: readonly string[] =
    intent === "invoice"
      ? PURCHASE_ORDER_INVOICEABLE_STATUSES
      : PURCHASE_ORDER_RELEASED_STATUSES;
  if (!allowed.includes(order.status ?? "")) {
    return order.status === "Closed"
      ? `${name} is closed. Nothing more can be received against it.`
      : `${name} must be approved and released before it can be received or invoiced.`;
  }
  if (order.status === "Closed" && !(Number(order.receivedQuantity ?? 0) > 0)) {
    return `${name} is closed with nothing received, so there is nothing to invoice.`;
  }
  if (exceedsApprovedAmount(order.total, order.approvedAmount)) {
    return `${name} totals more than its approved amount. It must be approved again before it can be received or invoiced.`;
  }
  return null;
}

/**
 * The line columns an edit of a released order can change, put back when the
 * approval of that edit is rejected. Not the promised date (it stays editable
 * while the order waits for approval), and nothing posting writes.
 */
export const PURCHASE_ORDER_LINE_VERSION_COLUMNS = [
  "purchaseOrderLineType",
  "itemId",
  "description",
  "purchaseQuantity",
  "purchaseUnitOfMeasureCode",
  "inventoryUnitOfMeasureCode",
  "conversionFactor",
  "supplierUnitPrice",
  "supplierShippingCost",
  "supplierTaxAmount",
  "taxPercent",
  "setupPrice",
  "exchangeRate",
  "locationId",
  "storageUnitId",
  "accountId",
  "assetId",
  "costCenterId",
  "jobId",
  "jobOperationId",
  "supplierPartId",
  "requiredDate",
  "customFields",
  "tags",
  "sortOrder",
  "externalNotes",
  "internalNotes",
  "modelUploadId",
  "ownerId"
] as const;

/**
 * The delivery columns put back with the lines. Not the promised or delivery
 * date, which stay editable while the order waits for approval.
 */
export const PURCHASE_ORDER_DELIVERY_VERSION_COLUMNS = [
  "locationId",
  "shippingMethodId",
  "shippingTermId",
  "receiptRequestedDate",
  "notes",
  "trackingNumber",
  "dropShipment",
  "customerId",
  "customerLocationId",
  "customFields",
  "supplierShippingCost",
  "incoterm",
  "incotermLocation"
] as const;

/**
 * A released order as it was just before an edit that sent it back to
 * approval: the rows of `purchaseOrderVersion` and `purchaseOrderLineVersion`
 * kept with the approval request, read back into one value. Rejecting the
 * request restores it. Each line is keyed by the live line's id (`id`).
 */
export type PurchaseOrderVersion = {
  exchangeRate: number | null;
  delivery: Record<string, unknown> | null;
  lines: ({ id: string } & Record<string, unknown>)[];
};

export type PurchaseOrderRestoreLine = {
  id: string;
  purchaseQuantity: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  receivedComplete: boolean;
};

/**
 * How to put an order's lines back to `version`: each line it had gets its
 * columns back (never below what was received or invoiced since), with its
 * completion restated for that quantity, and each line added since is deleted.
 * Not restorable when a line it had is gone (the order was restored into
 * another company, which gives lines new ids) or a line added since has
 * anything received or invoiced: then the rejection leaves the lines alone.
 */
export function planPurchaseOrderRestore(
  version: PurchaseOrderVersion,
  current: PurchaseOrderRestoreLine[]
):
  | { restorable: false }
  | {
      restorable: true;
      updates: { id: string; data: Record<string, unknown> }[];
      deleteIds: string[];
    } {
  const currentById = new Map(current.map((line) => [line.id, line]));
  const versionIds = new Set(version.lines.map((line) => line.id));
  if (version.lines.some((line) => !currentById.has(line.id))) {
    return { restorable: false };
  }

  const added = current.filter((line) => !versionIds.has(line.id));
  const floorOf = (line: PurchaseOrderRestoreLine) =>
    Math.max(
      Number(line.quantityReceived ?? 0),
      Number(line.quantityInvoiced ?? 0)
    );
  if (added.some((line) => floorOf(line) > 0)) return { restorable: false };

  const updates = version.lines.map((versionLine) => {
    const line = currentById.get(versionLine.id)!;
    const data: Record<string, unknown> = {};
    for (const column of PURCHASE_ORDER_LINE_VERSION_COLUMNS) {
      if (column in versionLine) data[column] = versionLine[column];
    }
    if (typeof versionLine.purchaseQuantity === "number") {
      const purchaseQuantity = Math.max(
        versionLine.purchaseQuantity,
        floorOf(line)
      );
      data.purchaseQuantity = purchaseQuantity;
      Object.assign(
        data,
        getCompletionAfterQuantityChange(line, purchaseQuantity)
      );
    }
    return { id: line.id, data };
  });

  return {
    restorable: true,
    updates,
    deleteIds: added.map((line) => line.id)
  };
}

/** The statuses the purchase orders table's bulk Delete acts on. */
export function isPurchaseOrderBulkDeletable(
  status: string | null | undefined
): boolean {
  return status === "Draft" || status === "Planned";
}

/** Statuses reached once every line is received; the promised date locks here. */
export const PURCHASE_ORDER_RECEIVED_STATUSES = [
  "To Invoice",
  "Completed",
  "Closed"
] as const satisfies readonly (typeof purchaseOrderStatusType)[number][];

export function isPurchaseOrderPromisedDateEditable(
  status: (typeof purchaseOrderStatusType)[number] | string | null | undefined
): boolean {
  return !PURCHASE_ORDER_RECEIVED_STATUSES.some(
    (received) => received === status
  );
}

/** Why an order's status refuses a promised date, or null when it allows one.
 *  A Closed order may still have lines nothing was received on. */
export function purchaseOrderPromisedDateRefusal(
  status: (typeof purchaseOrderStatusType)[number] | string | null | undefined
): string | null {
  if (status === "Closed") {
    return "Cannot change the promised date of a closed purchase order.";
  }
  return isPurchaseOrderPromisedDateEditable(status)
    ? null
    : "Cannot change the promised date of a fully received purchase order.";
}

/**
 * The date the supplier promised for a PO line: the line's own, else its
 * order's delivery date — the same COALESCE the `openPurchaseOrderLines` view
 * gives MRP. MRP dates the line by this ahead of the required date, so a
 * planning date change (which writes the required date) cannot move it.
 */
export function promisedDateOf(line: {
  promisedDate: string | null;
  receiptPromisedDate: string | null | undefined;
}): string | null {
  return line.promisedDate ?? line.receiptPromisedDate ?? null;
}

/** A line that receives goods has no promised date. Comment lines receive nothing. */
export function isPurchaseOrderMissingPromisedDate(
  lines: {
    purchaseOrderLineType: string | null;
    promisedDate: string | null;
  }[],
  receiptPromisedDate: string | null | undefined
): boolean {
  return lines.some(
    (line) =>
      line.purchaseOrderLineType !== "Comment" &&
      !promisedDateOf({
        promisedDate: line.promisedDate,
        receiptPromisedDate
      })
  );
}

/** A line's own dates. `receivedDate` is its delivery date. */
export const purchaseOrderLineDateFields = [
  "requiredDate",
  "promisedDate",
  "receivedDate"
] as const;

export type PurchaseOrderLineDateField =
  (typeof purchaseOrderLineDateFields)[number];

/** The order date each line date starts from. */
export const purchaseOrderLineDateOfOrderDate = {
  receiptRequestedDate: "requiredDate",
  receiptPromisedDate: "promisedDate",
  deliveryDate: "receivedDate"
} as const satisfies Record<string, PurchaseOrderLineDateField>;

export type PurchaseOrderDateField =
  keyof typeof purchaseOrderLineDateOfOrderDate;

export function isPurchaseOrderDateField(
  field: string
): field is PurchaseOrderDateField {
  return field in purchaseOrderLineDateOfOrderDate;
}

/** Why a line date cannot change, or null when it can. */
export function purchaseOrderLineDateRefusal(
  field: PurchaseOrderLineDateField,
  line: {
    status: (typeof purchaseOrderStatusType)[number] | string | null;
    receivedComplete: boolean;
  }
): string | null {
  switch (field) {
    case "requiredDate":
      return isPurchaseOrderEditLocked(line.status)
        ? "Cannot change the required date of a purchase order in approval or completed."
        : null;
    case "promisedDate":
      return (
        purchaseOrderPromisedDateRefusal(line.status) ??
        (line.receivedComplete
          ? "Cannot change the promised date of a received line."
          : null)
      );
    case "receivedDate":
      return null;
  }
}

export const purchaseOrderLineReceivingIntents = ["close", "reopen"] as const;
export type PurchaseOrderLineReceivingIntent =
  (typeof purchaseOrderLineReceivingIntents)[number];

export const purchaseOrderLineReceivingValidator = z.object({
  intent: z.enum(purchaseOrderLineReceivingIntents)
});

/** The statuses a line's receiving can be stopped or resumed in: the order
 *  is released, so stopping never stands in for approval. Closed is out —
 *  its lines are not being received. */
const PURCHASE_ORDER_RECEIVABLE_STATUSES: ReadonlySet<string> = new Set([
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed"
]);

/**
 * Why a line's receiving cannot be stopped or resumed, or null when it can.
 * Checked inside `shortClosePurchaseOrderLine`'s transaction, so every
 * caller (page, API, MCP, workflow) is held to it: the write recomputes the
 * header status from the line flags, and on an unreleased order that would
 * release it with no approval.
 */
export function shortClosePurchaseOrderLineRefusal(
  intent: PurchaseOrderLineReceivingIntent,
  line: {
    status: string | null | undefined;
    purchaseOrderLineType: string | null | undefined;
    quantityToReceive: number | null | undefined;
    receivedComplete: boolean | null | undefined;
  }
): string | null {
  if (!PURCHASE_ORDER_RECEIVABLE_STATUSES.has(line.status ?? "")) {
    return "Receiving can only be closed or reopened on a released purchase order";
  }
  if (
    line.purchaseOrderLineType === "Comment" ||
    line.purchaseOrderLineType === "G/L Account"
  ) {
    return "This line cannot be received";
  }
  if ((line.quantityToReceive ?? 0) <= 0) {
    return "This line has no outstanding quantity to receive";
  }
  if (intent === "close" && line.receivedComplete) {
    return "Receiving is already closed for this line";
  }
  if (intent === "reopen" && !line.receivedComplete) {
    return "Receiving is not closed for this line";
  }
  return null;
}

export const purchaseOrderLineDateValidator = z.object({
  field: z.enum(purchaseOrderLineDateFields),
  value: zfd.text(z.string().optional())
});

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

/** A purchase order line as a planning Increase / Decrease reads it. */
export type PlanningQuantityLine = {
  supplierUnitPrice: number | null;
  supplierShippingCost: number | null;
  purchaseQuantity: number | null;
  quantityReceived: number | null;
  quantityInvoiced: number | null;
  receivedComplete: boolean | null;
  taxPercent: number | null;
  supplierTaxAmount: number | null;
  conversionFactor: number | null;
  currencyCode: string | null;
  baseCurrencyCode: string | null;
};

/** A PO with no currency is in the company's base currency, as the PO line
 *  form reads it. */
export function planningLineCurrencyCode(line: {
  currencyCode: string | null;
  baseCurrencyCode: string | null;
}): string | null {
  return line.currencyCode ?? line.baseCurrencyCode;
}

/**
 * The write a planning Increase / Decrease makes on its PO line, or why it
 * cannot. `suggestedQuantity` is in INVENTORY units and is what the line
 * should still BRING (MRP reads a line's `quantityToReceive`): it is
 * converted by the line's own `conversionFactor`, rounded up to a whole
 * purchase unit, and what was already received is added back.
 */
export function planningQuantityChange(
  line: PlanningQuantityLine | undefined,
  decimalsByCode: Map<string, number>,
  suggestedQuantity: number
):
  | {
      ok: true;
      quantity: number;
      percent: number;
      amount: number;
      receivedComplete: boolean;
      invoicedComplete: boolean;
    }
  | { ok: false; message: string } {
  const currencyCode = line ? planningLineCurrencyCode(line) : null;
  const decimals = currencyCode ? decimalsByCode.get(currencyCode) : undefined;
  if (!line || decimals === undefined) {
    return {
      ok: false,
      message: line
        ? `Currency ${currencyCode ?? "(none)"} has no precision`
        : "Purchase order line not found"
    };
  }
  const conversionFactor = Number(line.conversionFactor) || 1;
  // MRP suggests a whole number of purchase units already
  // (`quantityAfterApply`, @carbon/planning); the inner round strips float
  // noise (1.1 / 0.1 = 11.000000000000002) that would otherwise ceil it a
  // whole purchase unit up.
  const toReceive =
    conversionFactor > 0
      ? round(
          round(Number(suggestedQuantity) / conversionFactor),
          0,
          RoundingMode.Up
        )
      : Number(suggestedQuantity);
  const quantity = round((Number(line.quantityReceived) || 0) + toReceive);
  const pair = taxPairForQuantity(line, quantity, decimals);
  return {
    ok: true,
    quantity,
    percent: pair.percent,
    amount: pair.amount,
    ...getCompletionAfterQuantityChange(line, quantity)
  };
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
 * The line of a planning PO that a new order adds its quantity to: same item,
 * required date, owner (project or planning group) and conversion factor. A
 * line with another factor is never merged: the order's quantity is in the
 * supplier part's purchase units, so added there it would be the wrong amount.
 */
export function findMergeablePlanningLine<
  L extends {
    itemId: string | null;
    requiredDate: string | null;
    projectId: string | null;
    planningGroupId: string | null;
    conversionFactor: number | null;
  }
>(
  lines: L[],
  target: {
    itemId: string;
    requiredDate: string | null;
    planningSegmentId: string;
    conversionFactor: number;
  }
): L | undefined {
  return lines.find(
    (line) =>
      line.itemId === target.itemId &&
      line.requiredDate === target.requiredDate &&
      (line.planningGroupId ?? line.projectId ?? "") ===
        target.planningSegmentId &&
      equals(line.conversionFactor ?? 1, target.conversionFactor)
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

// ─── Purchase Order Force Delete (Admin override) ───

export const PURCHASE_ORDER_FORCE_DELETE_MIN_REASON_LENGTH =
  FORCE_DELETE_MIN_REASON_LENGTH;

export const purchaseOrderForceDeleteRequestValidator = z.object({
  intent: z.literal("request"),
  reason: z
    .string()
    .trim()
    .min(PURCHASE_ORDER_FORCE_DELETE_MIN_REASON_LENGTH, {
      message: `Explain why, in at least ${PURCHASE_ORDER_FORCE_DELETE_MIN_REASON_LENGTH} characters`
    }),
  confirmation: z.string().trim().min(1, { message: "Type the order number" })
});

export const purchaseOrderForceDeleteDecisionValidator = z.object({
  intent: z.enum(["approve", "reject", "cancel"]),
  requestId: z.string().min(1, { message: "Request is required" }),
  notes: zfd.text(z.string().optional())
});

/**
 * What still names an order and keeps it from being force deleted. Its
 * receipts are not here: approving the force delete reverses them.
 */
export type PurchaseOrderForceDeleteBlockers = {
  /** Shipments (outside processing) not Voided. */
  shipments: { readableId: string; status: string }[];
  /** Purchase invoices with a line on the order, in any status. */
  invoices: { readableId: string; status: string }[];
  /** Prepayments to the supplier against the order, not Voided. */
  payments: { readableId: string; status: string }[];
};

/**
 * Why the order cannot be force deleted yet, or null. The override skips the
 * status and approval rules of a normal delete and reverses the order's
 * receipts, but a shipment, invoice or payment is the supplier's side of the
 * books: it is voided first (or, before the accounting cutover, corrected
 * with a debit memo). An invoice line holds the order line by a foreign key,
 * so even a voided invoice keeps the order.
 */
export function purchaseOrderForceDeleteBlockerMessage(
  blockers: PurchaseOrderForceDeleteBlockers
): string | null {
  const list = (docs: { readableId: string; status: string }[]) =>
    docs.map((d) => `${d.readableId} (${d.status})`).join(", ");
  const parts: string[] = [];
  if (blockers.shipments.length > 0) {
    parts.push(`void or delete its shipments: ${list(blockers.shipments)}`);
  }
  if (blockers.payments.length > 0) {
    parts.push(`void or delete its prepayments: ${list(blockers.payments)}`);
  }
  if (blockers.invoices.length > 0) {
    parts.push(
      `remove its lines from these purchase invoices (a posted or voided invoice keeps the order): ${list(blockers.invoices)}`
    );
  }
  if (parts.length === 0) return null;
  return `This purchase order cannot be force deleted until you ${parts.join("; ")}.`;
}

/** A stock position: an item at a location, storage unit, unit and stripe. */
export type ForceDeleteStockPosition = {
  itemId: string;
  locationId: string | null;
  storageUnitId: string | null;
  trackedEntityId: string | null;
  /** The stock stripe: a project id, or null for common stock. */
  projectId: string | null;
};

/** What a receipt put on hand (its Purchase Receipt item ledger rows). */
export type ReceiptReceivedStock = ForceDeleteStockPosition & {
  receiptId: string;
  receiptReadableId: string;
  quantity: number;
};

/** One removal a force delete books (a Negative Adjmt. of `quantity`). */
export type ReceiptStockRemoval = ForceDeleteStockPosition & {
  receiptId: string;
  /** Positive: how much leaves this position. */
  quantity: number;
};

/**
 * Where to take back what the order's receipts put on hand, from the stock
 * there is now. A receipt the void refuses (stock put away into another bin,
 * or received before the accounting cutover) is reversed by adjusting this
 * stock out instead.
 *
 * Stock is looked for at the receipt's location and stripe only. A serial or
 * batch is taken wherever it now is; untracked stock from the storage unit it
 * was received into first, then from the units with the most. Receipts share
 * the stock, in order, so two receipts of one item cannot both count the same
 * units. A receipt whose stock is no longer all there is `short`: it was used,
 * and what was used cannot be un-received.
 */
export function planReceiptReversal(
  received: ReceiptReceivedStock[],
  onHand: (ForceDeleteStockPosition & { quantity: number })[]
): { removals: ReceiptStockRemoval[]; short: string[] } {
  const available = onHand
    .filter((row) => row.quantity > EPSILON)
    .map((row) => ({ ...row }));
  const removals: ReceiptStockRemoval[] = [];
  const short: string[] = [];
  const shortReceiptIds = new Set<string>();

  for (const row of received) {
    let needed = row.quantity;
    if (needed <= EPSILON) continue;
    const candidates = available
      .filter(
        (stock) =>
          stock.itemId === row.itemId &&
          stock.locationId === row.locationId &&
          stock.projectId === row.projectId &&
          stock.trackedEntityId === row.trackedEntityId &&
          stock.quantity > EPSILON
      )
      .sort((a, b) => {
        const aHome = a.storageUnitId === row.storageUnitId ? 0 : 1;
        const bHome = b.storageUnitId === row.storageUnitId ? 0 : 1;
        if (aHome !== bHome) return aHome - bHome;
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return (a.storageUnitId ?? "").localeCompare(b.storageUnitId ?? "");
      });
    for (const stock of candidates) {
      if (needed <= EPSILON) break;
      const taken = Math.min(needed, stock.quantity);
      stock.quantity -= taken;
      needed -= taken;
      removals.push({
        receiptId: row.receiptId,
        itemId: row.itemId,
        locationId: stock.locationId,
        storageUnitId: stock.storageUnitId,
        trackedEntityId: stock.trackedEntityId,
        projectId: stock.projectId,
        quantity: taken
      });
    }
    if (needed > EPSILON && !shortReceiptIds.has(row.receiptId)) {
      shortReceiptIds.add(row.receiptId);
      short.push(row.receiptReadableId);
    }
  }

  return {
    removals: removals.filter(
      (removal) => !shortReceiptIds.has(removal.receiptId)
    ),
    short
  };
}

/** The refusal for receipts still being posted: they are reversed once posted. */
export function purchaseOrderForceDeletePendingReceiptMessage(
  receiptReadableIds: string[]
): string {
  return `This purchase order cannot be force deleted while ${receiptReadableIds.join(", ")} is being posted. Try again when it has finished.`;
}

/**
 * The refusal for receipts the void refused and an adjustment cannot stand
 * in for: one that issued straight to a project, or received a fixed asset.
 */
export function purchaseOrderForceDeleteUnsupportedReceiptMessage(
  receiptReadableIds: string[]
): string {
  return `This purchase order cannot be force deleted: ${receiptReadableIds.join(", ")} issued to a project or received a fixed asset, and its void was refused. Void it first.`;
}

/** The refusal for receipts whose stock was used since it was received. */
export function purchaseOrderForceDeleteUsedStockMessage(
  receiptReadableIds: string[]
): string {
  return `This purchase order cannot be force deleted: stock received on ${receiptReadableIds.join(", ")} was already used or moved to another location. Correct it with an inventory adjustment first.`;
}

/**
 * Why `userId` cannot approve this force delete, or null. Only a Pending
 * request, only an Admin, and never the Admin who asked: one other Admin's
 * approval deletes the order.
 */
/** Why `userId` cannot approve this request, or null (`forceDeleteApprovalRefusal`). */
export const purchaseOrderForceDeleteApprovalRefusal =
  forceDeleteApprovalRefusal;

/**
 * The `documentId` of a force delete notification: the order and the
 * request, so the link opens the order and the content reads the request
 * after the order is gone (`notificationTarget`).
 */
export function purchaseOrderForceDeleteNotificationId(
  purchaseOrderId: string,
  requestId: string
): string {
  return `${purchaseOrderId}:${requestId}`;
}

/**
 * Why `userId` cannot reject or cancel this request, or null
 * (`forceDeleteWithdrawRefusal`).
 */
export const purchaseOrderForceDeleteWithdrawRefusal =
  forceDeleteWithdrawRefusal;

/** Whether the order's own number was typed to confirm (`isForceDeleteConfirmed`). */
export const isPurchaseOrderForceDeleteConfirmed = isForceDeleteConfirmed;

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
export function isIsoDate(value: string): boolean {
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

/**
 * The files a supplier gets, in item order (first appearance in `itemIds`),
 * each item's files in the order given. With `onlyPaths`, just the files whose
 * `path` is in it (the files the sender ticked); a path that is not one of
 * these items' files is ignored.
 */
export function orderItemSupplierFiles<
  T extends { itemId: string; path: string }
>(itemIds: string[], files: T[], onlyPaths?: string[]): T[] {
  const only = onlyPaths ? new Set(onlyPaths) : null;
  const byItem = groupBy(
    only ? files.filter((file) => only.has(file.path)) : files,
    (file) => file.itemId
  );
  return [...new Set(itemIds)].flatMap((itemId) => byItem[itemId] ?? []);
}

/**
 * Which item files go in a supplier email and which go as download links: in
 * line order, each file that still fits in `budgetBytes` is attached, the rest
 * are linked, so one large file does not push out the small ones after it.
 */
export function splitRfqFileAttachments<T extends { size: number }>(
  files: T[],
  budgetBytes: number
): { attach: T[]; link: T[] } {
  const attach: T[] = [];
  const link: T[] = [];
  let left = budgetBytes;
  for (const file of files) {
    if (file.size <= left) {
      attach.push(file);
      left -= file.size;
    } else {
      link.push(file);
    }
  }
  return { attach, link };
}

// ─── Receipt reversal: what the order gets back ───
//
// Shared by the receipt void (`postReceipt`) and the force delete's
// adjust-out reversal (`restorePurchaseOrderReceived`), so both give an
// order back the same received quantities and status.

/**
 * Each order line's received quantity after the receipt's lines are
 * reversed: what they received, in the purchase unit (the first line's
 * conversion factor, as the void reads it), comes off, never below zero.
 * Only lines the receipt received on, with a purchase quantity, are
 * returned.
 */
export function receivedAfterReceiptReversal(
  orderLines: {
    id: string;
    purchaseQuantity: number | null;
    quantityReceived: number | null;
  }[],
  receiptLines: {
    lineId: string | null;
    receivedQuantity: number | null;
    conversionFactor: number | null;
  }[]
): Record<string, { quantityReceived: number; receivedComplete: boolean }> {
  const byLine = new Map<string, typeof receiptLines>();
  for (const line of receiptLines) {
    if (!line.lineId) continue;
    byLine.set(line.lineId, [...(byLine.get(line.lineId) ?? []), line]);
  }
  const result: Record<
    string,
    { quantityReceived: number; receivedComplete: boolean }
  > = {};
  for (const line of orderLines) {
    const received = byLine.get(line.id);
    const purchaseQuantity = Number(line.purchaseQuantity ?? 0);
    if (!received?.length || purchaseQuantity <= 0) continue;
    const receivedInPurchaseUnit =
      received.reduce((sum, r) => {
        const quantity = Number(r.receivedQuantity);
        return sum + (Number.isNaN(quantity) ? 0 : quantity);
      }, 0) / Number(received[0]!.conversionFactor ?? 1);
    const quantityReceived = Math.max(
      0,
      Number(line.quantityReceived ?? 0) - receivedInPurchaseUnit
    );
    result[line.id] = {
      quantityReceived,
      receivedComplete: quantityReceived >= purchaseQuantity
    };
  }
  return result;
}

/**
 * The order's status once its lines hold these quantities: Completed when
 * every line is received and invoiced, else what is still to do. Comment
 * lines count as done; G/L Account and Service lines are never received.
 */
export function purchaseOrderStatusAfterReversal(
  lines: {
    purchaseOrderLineType: string | null;
    purchaseQuantity: number | null;
    quantityReceived: number | null;
    quantityInvoiced: number | null;
  }[]
): Database["public"]["Enums"]["purchaseOrderStatus"] {
  const done = (target: number | null, have: number | null) => {
    const goal = Number(target ?? 0);
    return goal <= 0 || Number(have ?? 0) >= goal;
  };
  const allInvoiced = lines.every(
    (line) =>
      line.purchaseOrderLineType === "Comment" ||
      done(line.purchaseQuantity, line.quantityInvoiced)
  );
  const allReceived = lines.every(
    (line) =>
      line.purchaseOrderLineType === "Comment" ||
      line.purchaseOrderLineType === "G/L Account" ||
      line.purchaseOrderLineType === "Service" ||
      done(line.purchaseQuantity, line.quantityReceived)
  );
  if (allInvoiced && allReceived) return "Completed";
  if (allInvoiced) return "To Receive";
  if (allReceived) return "To Invoice";
  return "To Receive and Invoice";
}
