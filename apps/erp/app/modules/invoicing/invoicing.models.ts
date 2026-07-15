import { z } from "zod";
import { zfd } from "zod-form-data";
// Import the constants from the models file directly (not the `../shared` barrel),
// which also re-exports shared.service/shared.server — those transitively pull in
// `@carbon/auth`'s Lingui-macro glossary and break plain unit tests of this module.
import { incoterms, itemType, methodType } from "../shared/shared.models";

export const purchaseInvoiceLineType = [
  "Part",
  "Service",
  "Material",
  "Tool",
  "Consumable",
  // "Fixed Asset",
  "G/L Account",
  "Comment"
] as const;

export const purchaseInvoiceStatusType = [
  "Draft",
  // "Return",
  "Pending",
  "Partially Paid",
  "Open",
  "Debit Note Issued",
  "Paid",
  "Voided",
  "Overdue"
] as const;

/**
 * Purchase Invoice is locked (non-editable) when status is anything other than Draft.
 * Once posted/confirmed, no edits are allowed regardless of permission level.
 * The only way to make changes is to reopen it to Draft first.
 */
export function isPurchaseInvoiceLocked(
  status: (typeof purchaseInvoiceStatusType)[number] | string | null | undefined
): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const salesInvoiceLineType = [
  "Part",
  "Service",
  "Material",
  "Tool",
  "Consumable",
  "Fixed Asset",
  // "G/L Account",
  "Comment"
] as const;

export const salesInvoiceStatusType = [
  "Draft",
  // "Return",
  "Pending",
  "Partially Paid",
  "Submitted",
  "Credit Note Issued",
  "Paid",
  "Voided",
  "Overdue"
] as const;

/**
 * Sales Invoice is locked (non-editable) when status is anything other than Draft.
 * Once posted/confirmed, no edits are allowed regardless of permission level.
 */
export function isSalesInvoiceLocked(
  status: string | null | undefined
): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const purchaseInvoiceValidator = z.object({
  id: zfd.text(z.string().optional()),
  invoiceId: zfd.text(z.string().optional()),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  supplierReference: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  dateIssued: zfd.text(z.string().optional()),
  dateDue: zfd.text(z.string().optional()),
  supplierShippingCost: zfd.numeric(z.number().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional())
});

export const purchaseInvoiceDeliveryValidator = z.object({
  id: z.string(),
  locationId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  shippingTermId: zfd.text(z.string().optional()),
  supplierShippingCost: zfd.numeric(z.number().optional().default(0)),
  incoterm: zfd.text(z.enum(incoterms).optional()),
  incotermLocation: zfd.text(z.string().optional()),
  customFields: z.any().optional()
});

export const purchaseInvoiceLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    invoiceId: z.string().min(1, { message: "Invoice is required" }),
    invoiceLineType: z.enum(
      [...itemType, "Fixture", "G/L Account", "Fixed Asset", "Comment"],

      {
        errorMap: (issue, ctx) => ({
          message: "Type is required"
        })
      }
    ),
    purchaseOrderId: zfd.text(z.string().optional()),
    purchaseOrderLineId: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    accountId: zfd.text(z.string().optional()),
    costCenterId: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().optional()),
    supplierUnitPrice: zfd.numeric(z.number().optional()),
    supplierShippingCost: zfd.numeric(z.number().optional().default(0)),
    supplierTaxAmount: zfd.numeric(z.number().optional().default(0)),
    requiredDate: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    storageUnitId: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional())
  })
  .refine(
    (data) =>
      ["Part", "Service", "Material", "Tool", "Consumable"].includes(
        data.invoiceLineType
      )
        ? data.itemId
        : true,
    {
      message: "Item is required",
      path: ["itemId"] // path of error
    }
  )
  .refine(
    (data) =>
      ["Part", "Material", "Tool", "Consumable"].includes(data.invoiceLineType)
        ? data.locationId
        : true,
    {
      message: "Location is required",
      path: ["locationId"]
    }
  )
  .refine(
    (data) => (data.invoiceLineType === "G/L Account" ? data.accountId : true),
    {
      message: "Account is required",
      path: ["accountId"]
    }
  )
  .refine(
    (data) =>
      data.invoiceLineType === "G/L Account" ? data.description : true,
    {
      message: "Description is required",
      path: ["description"]
    }
  )
  .refine(
    (data) =>
      data.invoiceLineType === "Fixed Asset"
        ? (data.quantity ?? 1) === 1
        : true,
    {
      message: "Fixed Asset quantity must be 1",
      path: ["quantity"]
    }
  );

export const salesInvoiceValidator = z.object({
  id: zfd.text(z.string().optional()),
  invoiceId: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerReference: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  dateIssued: zfd.text(z.string().optional()),
  dateDue: zfd.text(z.string().optional()),
  supplierShippingCost: zfd.numeric(z.number().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional())
});

export const salesInvoicePostValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional()),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Customer contact is required for email",
      path: ["customerContact"] // path of error
    }
  );

export const salesInvoiceShipmentValidator = z.object({
  id: z.string(),
  locationId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  shippingTermId: zfd.text(z.string().optional()),
  shippingCost: zfd.numeric(z.number().optional().default(0)),
  incoterm: zfd.text(z.enum(incoterms).optional()),
  incotermLocation: zfd.text(z.string().optional()),
  customFields: z.any().optional()
});

export const salesInvoiceLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    invoiceId: z.string().min(1, { message: "Invoice is required" }),
    invoiceLineType: z.enum([...itemType, "Fixture", "Fixed Asset"], {
      errorMap: (issue, ctx) => ({
        message: "Type is required"
      })
    }),
    methodType: z
      .enum(methodType, {
        errorMap: (issue, ctx) => ({
          message: "Method is required"
        })
      })
      .optional(),
    purchaseOrderId: zfd.text(z.string().optional()),
    purchaseOrderLineId: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    accountId: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    addOnCost: zfd.numeric(z.number().optional().default(0)),
    nonTaxableAddOnCost: zfd.numeric(z.number().optional().default(0)),
    description: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().optional()),
    unitOfMeasureCode: zfd.text(z.string().default("EA")),
    unitPrice: zfd.numeric(z.number().optional()),
    shippingCost: zfd.numeric(z.number().optional().default(0)),
    taxPercent: zfd.numeric(z.number().optional().default(0)),
    locationId: zfd.text(z.string().optional()),
    storageUnitId: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional())
  })
  .refine(
    (data) =>
      ["Part", "Service", "Material", "Tool", "Consumable"].includes(
        data.invoiceLineType
      )
        ? data.itemId
        : true,
    {
      message: "Item is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) =>
      ["Part", "Material", "Tool", "Consumable"].includes(data.invoiceLineType)
        ? data.locationId
        : true,
    {
      message: "Location is required",
      path: ["locationId"]
    }
  )
  .refine(
    (data) => {
      if (data.invoiceLineType === "Fixed Asset") return true;
      return !!data.methodType;
    },
    {
      message: "Method is required",
      path: ["methodType"]
    }
  )
  .refine(
    (data) =>
      data.invoiceLineType === "Fixed Asset"
        ? (data.quantity ?? 1) === 1
        : true,
    {
      message: "Fixed Asset quantity must be 1",
      path: ["quantity"]
    }
  );

// ----------------------------------------------------------------------
// Credit / Debit Memos — payment-shaped documents (the `memo` table). A memo is
// a party + amount + reason GL account, applied to invoices via
// invoiceSettlement exactly like a payment, but the offset is a GL account
// (returns/allowance/adjustment) instead of cash. NOT an invoice row.
//
// The four combos = party (customer/supplier) × direction (Credit/Debit):
//   Customer Credit -> AR down,  Customer Debit -> AR up
//   Supplier Debit  -> AP down,  Supplier Credit -> AP up
// ----------------------------------------------------------------------

export const memoDirection = ["Credit", "Debit"] as const;
export const memoStatus = ["Draft", "Posted", "Voided"] as const;

export type MemoDirection = (typeof memoDirection)[number];
export type MemoStatusType = (typeof memoStatus)[number];

export function isMemoLocked(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const memoValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    memoId: zfd.text(z.string().optional()),
    direction: z.enum(memoDirection, {
      errorMap: () => ({ message: "Direction is required" })
    }),
    customerId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    memoDate: z.string().min(1, { message: "Date is required" }),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    exchangeRate: zfd.numeric(z.number().positive().default(1)),
    amount: zfd.numeric(z.number().positive({ message: "Amount must be > 0" })),
    reference: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine((d) => Boolean(d.customerId) !== Boolean(d.supplierId), {
    message: "A memo is for exactly one party (customer or supplier)",
    path: ["customerId"]
  });

// ----------------------------------------------------------------------
// Payments (AR receipts + AP disbursements + applications)
// ----------------------------------------------------------------------

export const paymentType = ["Receipt", "Disbursement"] as const;
export const paymentStatus = ["Draft", "Posted", "Voided"] as const;

export type PaymentType = (typeof paymentType)[number];
export type PaymentStatusType = (typeof paymentStatus)[number];

export function isPaymentLocked(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const paymentValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    paymentId: zfd.text(z.string().optional()),
    paymentType: z.enum(paymentType, {
      errorMap: () => ({ message: "Payment type is required" })
    }),
    customerId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    paymentDate: z.string().min(1, { message: "Payment date is required" }),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    exchangeRate: zfd.numeric(z.number().positive().default(1)),
    // Cash may be 0: a receipt/payment can be a pure credit-application (apply
    // the party's posted credits to invoices with no cash changing hands).
    totalAmount: zfd.numeric(
      z.number().nonnegative({ message: "Total amount cannot be negative" })
    ),
    bankAccount: z.string().min(1, { message: "Bank account is required" }),
    reference: zfd.text(z.string().optional()),
    memo: zfd.text(z.string().optional())
  })
  .refine(
    (d) =>
      d.paymentType === "Receipt"
        ? Boolean(d.customerId)
        : Boolean(d.supplierId),
    {
      message: "Receipt requires a customer; Disbursement requires a supplier",
      path: ["customerId"]
    }
  );

// The raw object schema (no refinements). Routes that need to `.omit()` a source
// key before injecting it from the URL use THIS — peeling `.refine()` layers off
// the refined validator below with `.innerType()` is brittle (it breaks whenever
// a refinement is added/removed).
export const invoiceSettlementBase = z.object({
  id: zfd.text(z.string().optional()),
  // Source: exactly one of a payment or a memo settles the target.
  paymentId: zfd.text(z.string().optional()),
  memoId: zfd.text(z.string().optional()),
  // Target: exactly one of a sales invoice, purchase invoice, or memo.
  targetSalesInvoiceId: zfd.text(z.string().optional()),
  targetPurchaseInvoiceId: zfd.text(z.string().optional()),
  targetMemoId: zfd.text(z.string().optional()),
  appliedAmount: zfd.numeric(z.number().nonnegative().default(0)),
  discountAmount: zfd.numeric(z.number().nonnegative().default(0)),
  writeOffAmount: zfd.numeric(z.number().nonnegative().default(0)),
  targetExchangeRate: zfd.numeric(
    z.number().positive({ message: "Target exchange rate must be > 0" })
  ),
  sourceExchangeRate: zfd.numeric(
    z.number().positive({ message: "Source exchange rate must be > 0" })
  ),
  appliedDate: z.string().min(1, { message: "Applied date is required" })
});

export const invoiceSettlementValidator = invoiceSettlementBase
  .refine((d) => Boolean(d.paymentId) !== Boolean(d.memoId), {
    message: "A settlement must have exactly one source (payment or memo)",
    path: ["paymentId"]
  })
  .refine(
    (d) =>
      [
        d.targetSalesInvoiceId,
        d.targetPurchaseInvoiceId,
        d.targetMemoId
      ].filter(Boolean).length === 1,
    {
      message:
        "Application must target exactly one document (sales invoice, purchase invoice, or memo)",
      path: ["targetSalesInvoiceId"]
    }
  )
  .refine(
    (d) =>
      Number(d.appliedAmount) +
        Number(d.discountAmount) +
        Number(d.writeOffAmount) >
      0,
    {
      message: "At least one of applied / discount / write-off must be > 0",
      path: ["appliedAmount"]
    }
  );

// Sub-cent balances are forgiven as dust: an outstanding amount below one cent
// (the smallest representable currency unit) can't be collected and is treated
// as paid. Kept in sync with the SQL view forgiveness in
// 20260630151500_invoice-dust-forgiveness.sql.
export const INVOICE_DUST_THRESHOLD = 0.01;

// An invoice is payable when it's posted with an outstanding balance of at least
// one cent — i.e. not draft/pending, voided, already fully paid, or down to dust.
// Shared by the sales (AR) and purchase (AP) invoice headers; the caller AND-s in
// the permission check.
export function isInvoicePayable(
  status: string | null | undefined,
  balance: number | null | undefined
): boolean {
  return (
    !["Voided", "Draft", "Pending", "Paid"].includes(status ?? "") &&
    Number(balance ?? 0) >= INVOICE_DUST_THRESHOLD
  );
}
