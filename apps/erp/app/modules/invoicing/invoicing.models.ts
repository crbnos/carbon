import { z } from "zod";
import { zfd } from "zod-form-data";
import { methodItemType } from "../shared";

export const purchaseInvoiceLineType = [
  "Part",
  // "Service",
  "Material",
  "Tool",
  "Consumable",
  // "Fixed Asset",
  // "G/L Account",
  "Comment",
] as const;

export const purchaseInvoiceStatusType = [
  "Draft",
  "Return",
  "Pending",
  "Partially Paid",
  "Submitted",
  "Debit Note Issued",
  "Paid",
  "Voided",
  "Overdue",
] as const;

export const purchaseInvoiceValidator = z.object({
  id: zfd.text(z.string().optional()),
  invoiceId: zfd.text(z.string().optional()),
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  supplierReference: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  dateIssued: zfd.text(z.string().optional()),
  dateDue: zfd.text(z.string().optional()),
  supplierShippingCost: zfd.numeric(z.number().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
});

export const purchaseInvoiceLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    invoiceId: z.string().min(20, { message: "Invoice is required" }),
    invoiceLineType: z.enum(methodItemType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required",
      }),
    }),
    purchaseOrderId: zfd.text(z.string().optional()),
    purchaseOrderLineId: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    itemReadableId: zfd.text(z.string().optional()),
    accountNumber: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().optional()),
    supplierUnitPrice: zfd.numeric(z.number().optional()),
    supplierShippingCost: zfd.numeric(z.number().optional().default(0)),
    supplierTaxAmount: zfd.numeric(z.number().optional().default(0)),
    locationId: zfd.text(z.string().optional()),
    shelfId: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
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
      path: ["itemId"], // path of error
    }
  )
  .refine(
    (data) =>
      ["Part", "Material", "Tool", "Consumable"].includes(data.invoiceLineType)
        ? data.locationId
        : true,
    {
      message: "Location is required",
      path: ["locationId"], // path of error
    }
  );
// .refine(
//   (data) =>
//     data.invoiceLineType === "G/L Account" ? data.accountNumber : true,
//   {
//     message: "Account is required",
//     path: ["accountNumber"], // path of error
//   }
// )
// .refine(
//   (data) => (data.invoiceLineType === "Fixed Asset" ? data.assetId : true),
//   {
//     message: "Asset is required",
//     path: ["assetId"], // path of error
//   }
// )
// .refine(
//   (data) => (data.invoiceLineType === "Comment" ? data.description : true),
//   {
//     message: "Comment is required",
//     path: ["description"], // path of error
//   }
// );
