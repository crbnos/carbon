import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { currencyCodes } from "../accounting";
import { standardFactorType } from "../shared/types";

export const customerValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  customerTypeId: zfd.text(z.string().optional()),
  customerStatusId: zfd.text(z.string().optional()),
  taxId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
});

export const customerContactValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...contact,
  customerLocationId: zfd.text(z.string().optional()),
});

export const customerLocationValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...address,
});

export const customerPaymentValidator = z.object({
  customerId: z.string().min(36, { message: "Customer is required" }),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
});

export const customerShippingValidator = z.object({
  customerId: z.string().min(36, { message: "Customer is required" }),
  shippingCustomerId: zfd.text(z.string().optional()),
  shippingCustomerLocationId: zfd.text(z.string().optional()),
  shippingCustomerContactId: zfd.text(z.string().optional()),
  shippingTermId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
});

export const customerStatusValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const customerTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const quoteLineStatusType = [
  "Draft",
  "In Progress",
  "Complete",
] as const;

export const quoteStatusType = [
  "Draft",
  "Open",
  "Replied",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired",
] as const;

export const quotationValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
  name: z.string(),
  customerId: z.string().min(36, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  status: z.enum(quoteStatusType).optional(),
  notes: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
});

export const quotationAssemblyValidator = z.object({
  id: zfd.text(z.string().optional()),
  parentAssemblyId: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Part is required" }),
  itemReadableId: zfd.text(z.string().optional()),
  description: z.string().min(1, { message: "Description is required" }),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  quantityPerParent: zfd.numeric(
    z.number().min(1, { message: "Quantity is required" })
  ),
});

export const quotationMaterialValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Part is required" }),
  itemReadableId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().min(0.00001, { message: "Quantity is required" })
  ),
  description: z.string().min(1, { message: "Description is required" }),
  unitCost: zfd.numeric(z.number().min(0)),
  unitOfMeasureCode: zfd.text(z.string().optional()),
});

export const quotationOperationValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteAssemblyId: zfd.text(z.string().optional()),
  workCellTypeId: z.string().min(20, { message: "Work cell is required" }),
  equipmentTypeId: zfd.text(z.string().optional()),
  description: zfd.text(
    z.string().min(0, { message: "Description is required" })
  ),
  setupHours: zfd.numeric(z.number().min(0)),
  standardFactor: z.enum(standardFactorType, {
    errorMap: () => ({ message: "Standard factor is required" }),
  }),
  productionStandard: zfd.numeric(z.number().min(0)),
  quotingRate: zfd.numeric(z.number().min(0)),
  laborRate: zfd.numeric(z.number().min(0)),
  overheadRate: zfd.numeric(z.number().min(0)),
});

export const quotationPricingValidator = z.object({
  quantity: zfd.numeric(z.number()),
  unitCost: zfd.numeric(z.number()),
  leadTime: zfd.numeric(z.number().int().nonnegative()),
  discountPercent: zfd.numeric(z.number().nonnegative()),
  markupPercent: zfd.numeric(z.number().nonnegative()),
  extendedPrice: zfd.numeric(z.number()),
});

export const quotationLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: z.string(),
  itemId: z.string().min(1, { message: "Part is required" }),
  itemReadableId: zfd.text(z.string().optional()),
  status: z.enum(quoteLineStatusType, {
    errorMap: () => ({ message: "Status is required" }),
  }),
  description: z.string().min(1, { message: "Description is required" }),
  replenishmentSystem: z.enum(["Buy", "Make"]),
  customerPartId: zfd.text(z.string().optional()),
  customerPartRevision: zfd.text(z.string().optional()),
  unitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
});

export const quotationReleaseValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional()),
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["customerContact"], // path of error
    }
  );

export const salesOrderLineType = [
  "Part",
  "Service",
  "Material",
  "Tool",
  "Fixture",
  "Hardware",
  "Consumable",
  "Comment",
  "GL Account",
  "Fixed Asset",
] as const;

export const salesOrderStatusType = [
  "Draft",
  "Needs Approval",
  "Confirmed",
  "In Progress",
  "Completed",
  "Invoiced",
  "Cancelled",
] as const;

export const salesOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesOrderId: zfd.text(z.string().optional()),
  orderDate: z.string().min(1, { message: "Order Date is required" }),
  status: z.enum(salesOrderStatusType).optional(),
  notes: zfd.text(z.string().optional()),
  customerId: z.string().min(36, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
});

export const salesOrderShipmentValidator = z
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
    supplierId: zfd.text(z.string().optional()),
    supplierLocationId: zfd.text(z.string().optional()),
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
      message: "Drop shipment requires supplier and location",
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

export const salesOrderLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    salesOrderId: z.string().min(20, { message: "Order is required" }),
    salesOrderLineType: z.enum(salesOrderLineType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required",
      }),
    }),
    itemId: zfd.text(z.string().optional()),
    itemReadableId: zfd.text(z.string().optional()),
    serviceId: zfd.text(z.string().optional()),
    accountNumber: zfd.text(z.string().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    saleQuantity: zfd.numeric(z.number().optional()),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    unitPrice: zfd.numeric(z.number().optional()),
    setupPrice: zfd.numeric(z.number().optional()),
    locationId: zfd.text(z.string().optional()),
    shelfId: zfd.text(z.string().optional()),
  })
  .refine((data) => (data.salesOrderLineType === "Part" ? data.itemId : true), {
    message: "Part is required",
    path: ["itemId"], // path of error
  })
  .refine(
    (data) => (data.salesOrderLineType === "Comment" ? data.description : true),
    {
      message: "Comment is required",
      path: ["description"], // path of error
    }
  );

export const salesOrderPaymentValidator = z.object({
  id: z.string(),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  paymentComplete: zfd.checkbox(),
  currencyCode: z.enum(currencyCodes).optional(),
});

export const salesOrderReleaseValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional()),
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Customer contact is required for email",
      path: ["customerContact"], // path of error
    }
  );
