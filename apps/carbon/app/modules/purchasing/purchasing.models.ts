import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { currencyCodes } from "../accounting";

export const purchaseOrderLineType = [
  "Part",
  "Service",
  "Material",
  "Tool",
  "Fixture",
  "Consumable",
  "G/L Account",
  "Fixed Asset",
  "Comment",
] as const;

export const purchaseOrderTypeType = ["Purchase", "Return"] as const;

export const purchaseOrderStatusType = [
  "Draft",
  "To Review",
  "Rejected",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice",
  "Completed",
  "Closed",
] as const;

export const purchaseOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  purchaseOrderId: zfd.text(z.string().optional()),
  orderDate: z.string().min(1, { message: "Order Date is required" }),
  type: z.enum(purchaseOrderTypeType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required",
    }),
  }),
  status: z.enum(purchaseOrderStatusType).optional(),
  notes: zfd.text(z.string().optional()),
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  supplierLocationId: zfd.text(z.string().optional()),
  supplierContactId: zfd.text(z.string().optional()),
  supplierReference: zfd.text(z.string().optional()),
});

export const purchaseOrderDeliveryValidator = z
  .object({
    id: z.string(),
    locationId: zfd.text(z.string().optional()),
    shippingMethodId: zfd.text(z.string().optional()),
    shippingTermId: zfd.text(z.string().optional()),
    trackingNumber: z.string(),
    deliveryDate: zfd.text(z.string().optional()),
    receiptRequestedDate: zfd.text(z.string().optional()),
    receiptPromisedDate: zfd.text(z.string().optional()),
    dropShipment: zfd.checkbox(),
    customerId: zfd.text(z.string().optional()),
    customerLocationId: zfd.text(z.string().optional()),
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
    purchaseOrderLineType: z.enum(purchaseOrderLineType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required",
      }),
    }),
    itemId: zfd.text(z.string().optional()),
    itemReadableId: zfd.text(z.string().optional()),
    accountNumber: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    purchaseQuantity: zfd.numeric(z.number().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    inventoryUnitOfMeasureCode: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().optional()),
    unitPrice: zfd.numeric(z.number().optional()),
    setupPrice: zfd.numeric(z.number().optional()),
    locationId: zfd.text(z.string().optional()),
    shelfId: zfd.text(z.string().optional()),
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
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "G/L Account" ? data.accountNumber : true,
    {
      message: "Account is required",
      path: ["accountNumber"], // path of error
    }
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "Fixed Asset" ? data.assetId : true,
    {
      message: "Asset is required",
      path: ["assetId"], // path of error
    }
  )
  .refine(
    (data) =>
      data.purchaseOrderLineType === "Comment" ? data.description : true,
    {
      message: "Comment is required",
      path: ["description"], // path of error
    }
  );

export const purchaseOrderPaymentValidator = z.object({
  id: z.string(),
  invoiceSupplierId: zfd.text(z.string().optional()),
  invoiceSupplierLocationId: zfd.text(z.string().optional()),
  invoiceSupplierContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  paymentComplete: zfd.checkbox(),
  currencyCode: z.enum(currencyCodes).optional(),
});

export const purchaseOrderReleaseValidator = z
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

export const supplierValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  supplierStatusId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
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
  currencyCode: zfd.text(z.string().optional()),
});

export const supplierShippingValidator = z.object({
  supplierId: z.string().min(36, { message: "Supplier is required" }),
  shippingSupplierId: zfd.text(z.string().optional()),
  shippingSupplierLocationId: zfd.text(z.string().optional()),
  shippingSupplierContactId: zfd.text(z.string().optional()),
  shippingTermId: zfd.text(z.string().optional()),
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
