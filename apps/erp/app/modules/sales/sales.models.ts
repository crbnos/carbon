import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { currencyCodes } from "../accounting";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  standardFactorType,
} from "../shared";

export const KPIs = [
  {
    key: "quoteCount",
    label: "Quotes",
  },
  {
    key: "rfqCount",
    label: "RFQs",
  },
  {
    key: "salesFunnel",
    label: "Sales Funnel",
  },
  {
    key: "salesOrderCount",
    label: "Sales Orders",
  },
  {
    key: "salesOrderRevenue",
    label: "Sales Revenue",
  },
  // {
  //   key: "turnaroundTime",
  //   label: "Turnaround Time",
  // },
] as const;

export const salesRFQStatusType = [
  "Draft",
  "Ready for Quote",
  "Quoted",
  "Closed",
] as const;

export const customerAccountingValidator = z.object({
  id: zfd.text(z.string()),
  customerTypeId: zfd.text(z.string().optional()),
  taxId: zfd.text(z.string().optional()),
});

export const customerContactValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...contact,
  customerLocationId: zfd.text(z.string().optional()),
});

export const customerLocationValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string()),
  ...address,
});

export const customerValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  customerStatusId: zfd.text(z.string().optional()),
  customerTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  taxPercent: zfd.numeric(
    z.number().min(0).max(1, { message: "Tax percent must be between 0 and 1" })
  ),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional()),
});

export const customerPaymentValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" }),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
});

export const customerShippingValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" }),
  shippingCustomerId: zfd.text(z.string().optional()),
  shippingCustomerLocationId: zfd.text(z.string().optional()),
  shippingCustomerContactId: zfd.text(z.string().optional()),
  // shippingTermId: zfd.text(z.string().optional()),
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

export const externalQuoteValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("accept"),
    digitalQuoteAcceptedBy: z.string().min(1, { message: "Name is required" }),
    digitalQuoteAcceptedByEmail: z
      .string()
      .email({ message: "Email is invalid" }),
  }),
  z.object({
    type: z.literal("reject"),
    digitalQuoteRejectedBy: z.string().min(1, { message: "Name is required" }),
    digitalQuoteRejectedByEmail: z
      .string()
      .email({ message: "Email is invalid" }),
  }),
]);

export const getMethodValidator = z.object({
  type: z.enum(["item", "quoteLine", "method", "quoteToQuote"]),
  sourceId: z.string(),
  targetId: z.string(),
});

export const noQuoteReasonValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const customerPortalValidator = z.object({
  id: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
});

export const quoteLineStatusType = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote",
] as const;

export const quoteStatusType = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired",
] as const;

export const quoteValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
  salesPersonId: zfd.text(z.string().optional()),
  estimatorId: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  status: z.enum(quoteStatusType).optional(),
  notes: z.any().optional(),
  dueDate: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
  digitalQuoteAcceptedBy: zfd.text(z.string().optional()),
  digitalQuoteAcceptedByEmail: zfd.text(z.string().optional()),
});

export const quoteLineAdditionalChargesValidator = z.record(
  z.object({
    description: z.string(),
    amounts: z.record(z.number()),
  })
);

export const quoteLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: z.string(),
  itemId: z.string().min(1, { message: "Part is required" }),
  status: z.enum(quoteLineStatusType, {
    errorMap: () => ({ message: "Status is required" }),
  }),
  estimatorId: zfd.text(z.string().optional()),
  description: z.string().min(1, { message: "Description is required" }),
  methodType: z.enum(methodType, {
    errorMap: () => ({ message: "Method is required" }),
  }),
  customerPartId: zfd.text(z.string().optional()),
  customerPartRevision: zfd.text(z.string().optional()),
  unitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  quantity: z.array(
    zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
  ),
  modelUploadId: zfd.text(z.string().optional()),
  noQuoteReason: zfd.text(z.string().optional()),
  taxPercent: zfd.numeric(
    z.number().min(0).max(1, { message: "Tax percent must be between 0 and 1" })
  ),
  configuration: z.any().optional(),
});

export const quoteMaterialValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    quoteMakeMethodId: z
      .string()
      .min(1, { message: "Make method is required" }),
    order: zfd.numeric(z.number().min(0)),
    itemType: z.enum(methodItemType, {
      errorMap: (issue, ctx) => ({
        message: "Item type is required",
      }),
    }),
    methodType: z.enum(methodType, {
      errorMap: (issue, ctx) => ({
        message: "Method type is required",
      }),
    }),
    itemId: z.string().min(1, { message: "Item is required" }),
    kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
    description: z.string().min(1, { message: "Description is required" }),
    quoteOperationId: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0)),
    unitCost: zfd.numeric(z.number().min(0)),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
  })
  .refine(
    (data) => {
      if (data.itemType === "Part") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Part ID is required",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Material") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Material ID is required",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Tool") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Tool ID is required",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Consumable") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Consumable ID is required",
      path: ["itemId"],
    }
  );

export const quoteOperationValidator = z
  .object({
    id: z.string().min(1, { message: "Operation ID is required" }),
    quoteMakeMethodId: z
      .string()
      .min(1, { message: "Quote Make Method is required" }),
    order: zfd.numeric(z.number().min(0)),
    operationOrder: z.enum(methodOperationOrders, {
      errorMap: (issue, ctx) => ({
        message: "Operation order is required",
      }),
    }),
    operationType: z.enum(operationTypes, {
      errorMap: (issue, ctx) => ({
        message: "Operation type is required",
      }),
    }),
    processId: z.string().min(1, { message: "Process is required" }),
    procedureId: zfd.text(z.string().optional()),
    workCenterId: zfd.text(z.string().optional()),
    description: zfd.text(
      z.string().min(0, { message: "Description is required" })
    ),
    setupUnit: z
      .enum(standardFactorType, {
        errorMap: () => ({ message: "Setup unit is required" }),
      })
      .optional(),
    setupTime: zfd.numeric(z.number().min(0).optional()),
    laborUnit: z
      .enum(standardFactorType, {
        errorMap: () => ({ message: "Labor unit is required" }),
      })
      .optional(),
    laborTime: zfd.numeric(z.number().min(0).optional()),
    machineUnit: z
      .enum(standardFactorType, {
        errorMap: () => ({ message: "Machine unit is required" }),
      })
      .optional(),
    machineTime: zfd.numeric(z.number().min(0).optional()),
    machineRate: zfd.numeric(z.number().min(0).optional()),
    overheadRate: zfd.numeric(z.number().min(0).optional()),
    laborRate: zfd.numeric(z.number().min(0).optional()),
    operationSupplierProcessId: zfd.text(z.string().optional()),
    operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
    operationUnitCost: zfd.numeric(z.number().min(0).optional()),
    operationLeadTime: zfd.numeric(z.number().min(0).optional()),
  })
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationMinimumCost);
      }
      return true;
    },
    {
      message: "Minimum is required",
      path: ["operationMinimumCost"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationUnitCost);
      }
      return true;
    },
    {
      message: "Unit cost is required",
      path: ["operationUnitCost"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationLeadTime);
      }
      return true;
    },
    {
      message: "Lead time is required",
      path: ["operationLeadTime"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.setupUnit;
      }
      return true;
    },
    {
      message: "Setup unit is required",
      path: ["setupUnit"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Labor unit is required",
      path: ["laborUnit"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Machine unit is required",
      path: ["machineUnit"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.setupTime);
      }
      return true;
    },
    {
      message: "Setup time is required",
      path: ["setupTime"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborTime);
      }
      return true;
    },
    {
      message: "Labor time is required",
      path: ["laborTime"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineTime);
      }
      return true;
    },
    {
      message: "Machine time is required",
      path: ["machineTime"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineRate);
      }
      return true;
    },
    {
      message: "Machine rate is required",
      path: ["machineRate"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.overheadRate);
      }
      return true;
    },
    {
      message: "Overhead rate is required",
      path: ["overheadRate"],
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborRate);
      }
      return true;
    },
    {
      message: "Labor rate is required",
      path: ["laborRate"],
    }
  );

export const quoteFinalizeValidator = z
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

export const quotePaymentValidator = z.object({
  id: z.string(),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
});

export const quoteShipmentValidator = z.object({
  id: z.string(),
  locationId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  receiptRequestedDate: zfd.text(z.string().optional()),
  shippingCost: zfd.numeric(z.number().optional()),
});

export const salesOrderLineType = [
  "Part",
  // "Service",
  "Material",
  "Tool",
  "Consumable",
  "Comment",
  "Fixed Asset",
] as const;

export const salesOrderStatusType = [
  "Draft",
  // "In Progress",
  "Needs Approval",
  // "Confirmed",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed",
  // "Invoiced",
  "Cancelled",
  "Closed",
] as const;

export const salesConfirmValidator = z
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

export const salesOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesOrderId: zfd.text(z.string().optional()),
  requestedDate: zfd.text(z.string().optional()),
  promisedDate: zfd.text(z.string().optional()),
  status: z.enum(salesOrderStatusType).optional(),
  notes: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
  salesPersonId: zfd.text(z.string().optional()),
});

export const salesOrderShipmentValidator = z
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
    supplierId: zfd.text(z.string().optional()),
    supplierLocationId: zfd.text(z.string().optional()),
    shippingCost: zfd.numeric(z.number().optional()),
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
  );

export const salesOrderLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    salesOrderId: z.string().min(1, { message: "Order is required" }),
    salesOrderLineType: z.enum(salesOrderLineType, {
      errorMap: (issue, ctx) => ({
        message: "Type is required",
      }),
    }),
    accountNumber: zfd.text(z.string().optional()),
    shippingCost: zfd.numeric(z.number().optional()),
    addOnCost: zfd.numeric(z.number().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    locationId: z.string().min(0, { message: "Location is required" }),
    methodType: z
      .enum(methodType, {
        errorMap: () => ({ message: "Method is required" }),
      })
      .optional(),
    modelUploadId: zfd.text(z.string().optional()),
    promisedDate: zfd.text(z.string().optional()),
    saleQuantity: zfd.numeric(z.number().optional()),
    serviceId: zfd.text(z.string().optional()),
    setupPrice: zfd.numeric(z.number().optional()),
    shelfId: zfd.text(z.string().optional()),
    taxPercent: zfd.numeric(
      z
        .number()
        .min(0)
        .max(1, { message: "Tax percent must be between 0 and 1" })
    ),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    unitPrice: zfd.numeric(z.number().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
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
  )
  .refine(
    (data) => {
      if (
        data.salesOrderLineType !== "Comment" &&
        data.salesOrderLineType !== "Fixed Asset"
      ) {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Item is required for this line type",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      // If sales order line type is not "Comment", we require a method type
      if (data.salesOrderLineType !== "Comment" && !data.methodType) {
        return false;
      }
      return true;
    },
    {
      message: "Method type is required",
      path: ["methodType"],
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

export const salesRfqValidator = z.object({
  id: zfd.text(z.string().optional()),
  rfqId: zfd.text(z.string().optional()),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerReference: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
  externalNotes: zfd.text(z.string().optional()),
  internalNotes: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  rfqDate: z.string().min(1, { message: "Order Date is required" }),
  status: z.enum(salesRFQStatusType).optional(),
  salesPersonId: zfd.text(z.string().optional()),
});

export const salesRfqDragValidator = z.object({
  id: z.string(),
  customerPartId: z.string(),
  is3DModel: z.boolean().optional(),
  size: z.number().optional(),
  lineId: z.string().optional(),
  path: z.string(),
  salesRfqId: z.string(),
});

export const salesRfqLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesRfqId: z.string().min(1, { message: "RFQ is required" }),
  customerPartId: z.string().min(1, { message: "Part Number is required" }),
  customerPartRevision: zfd.text(z.string().optional()),
  itemId: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  quantity: z.array(
    zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
  ),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  order: zfd.numeric(z.number().min(0)),
  modelUploadId: zfd.text(z.string().optional()),
});

export const selectedLineSchema = z.object({
  addOn: z.number().optional(),
  convertedAddOn: z.number().optional(),
  convertedNetUnitPrice: z.number(),
  convertedShippingCost: z.number(),
  leadTime: z.number(),
  netUnitPrice: z.number(),
  quantity: z.number(),
  shippingCost: z.number(),
});

export const selectedLinesValidator = z.record(z.string(), selectedLineSchema);
