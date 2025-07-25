import { getLocalTimeZone, today } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { methodItemType } from "../shared";

export const KPIs = [
  {
    key: "supplierQuoteCount",
    label: "Supplier Quotes",
  },
  {
    key: "purchaseOrderCount",
    label: "Purchase Orders",
  },
  {
    key: "purchaseInvoiceCount",
    label: "Purchase Invoices",
  },
  {
    key: "purchaseOrderAmount",
    label: "Purchase Order Amount",
  },
  {
    key: "purchaseInvoiceAmount",
    label: "Purchase Invoice Amount",
  },
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
  "Comment",
] as const;

export const purchaseOrderTypeType = [
  "Purchase",
  "Outside Processing",
] as const;

export const purchaseOrderStatusType = [
  "Draft",
  "Planned",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Rejected",
  "Closed",
] as const;

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
  unitOfMeasureCode: zfd.text(z.string().optional()),
});

export type PlannedOrder = z.infer<typeof plannedOrderValidator>;

export const purchaseOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  purchaseOrderType: z.enum(purchaseOrderTypeType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required",
    }),
  }),
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  supplierLocationId: zfd.text(z.string().optional()),
  supplierContactId: zfd.text(z.string().optional()),
  supplierReference: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
});

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
      path: ["dropShipment"], // path of error
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
      path: ["locationId"], // path of error
    }
  );

export const purchaseOrderLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    purchaseOrderId: z.string().min(20, { message: "Order is required" }),
    purchaseOrderLineType: z.enum(methodItemType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required",
      }),
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
    supplierUnitPrice: zfd.numeric(z.number().optional()),
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
      path: ["itemId"], // path of error
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
  paymentComplete: zfd.checkbox(),
});

export const purchaseOrderFinalizeValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    supplierContact: zfd.text(z.string().optional()),
  })
  .refine(
    (data) => (data.notification === "Email" ? data.supplierContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["supplierContact"], // path of error
    }
  );

export const selectedLineSchema = z.object({
  leadTime: z.number(),
  quantity: z.number(),
  shippingCost: z.number(),
  supplierShippingCost: z.number(),
  supplierUnitPrice: z.number(),
  supplierTaxAmount: z.number(),
  unitPrice: z.number(),
});

export const selectedLinesValidator = z.record(z.string(), selectedLineSchema);

export const supplierValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  supplierStatusId: zfd.text(z.string().optional()),
  supplierTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional()),
});

export const supplierContactValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...contact,
  supplierLocationId: zfd.text(z.string().optional()),
});

export const supplierLocationValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string()),
  ...address,
});

export const supplierPaymentValidator = z.object({
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
});

export const supplierProcessValidator = z.object({
  id: zfd.text(z.string().optional()),
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  processId: z.string().min(1, { message: "Process is required" }),
  minimumCost: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0)),
});

export const supplierShippingValidator = z.object({
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  shippingSupplierId: zfd.text(z.string().optional()),
  shippingSupplierLocationId: zfd.text(z.string().optional()),
  shippingSupplierContactId: zfd.text(z.string().optional()),
  // shippingTermId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
});

export const supplierAccountingValidator = z.object({
  id: zfd.text(z.string()),
  supplierTypeId: zfd.text(z.string().optional()),
  taxId: zfd.text(z.string().optional()),
});

export const supplierTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const supplierStatusValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const supplierQuoteStatusType = ["Active", "Expired"] as const;

export const supplierQuoteValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    supplierQuoteId: zfd.text(z.string().optional()),
    supplierId: z.string().min(36, { message: "Supplier is required" }),
    supplierLocationId: zfd.text(z.string().optional()),
    supplierContactId: zfd.text(z.string().optional()),
    supplierReference: zfd.text(z.string().optional()),
    status: z.enum(supplierQuoteStatusType).optional(),
    notes: z.any().optional(),
    quotedDate: zfd.text(z.string().optional()),
    expirationDate: zfd.text(z.string().optional()),
    currencyCode: zfd.text(z.string().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
    exchangeRateUpdatedAt: zfd.text(z.string().optional()),
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
      path: ["expirationDate"], // path of error
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
  ),
});
