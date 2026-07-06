import { z } from "zod";
import { zfd } from "zod-form-data";
import { batchPropertyDataTypes } from "../items/items.models";

export const demandPeriodTypes = ["Week", "Day", "Month"] as const;
export const demandSourceTypes = ["Sales Order", "Job Material"] as const;

export const itemTypes = [
  "Part",
  "Material",
  "Tool",
  "Consumable"
  // "Service",
] as const;

export const itemLedgerTypes = [
  "Purchase",
  "Sale",
  "Positive Adjmt.",
  "Negative Adjmt.",
  "Transfer",
  "Consumption",
  "Output",
  "Assembly Consumption",
  "Assembly Output"
] as const;

export const itemLedgerDocumentTypes = [
  "Sales Shipment",
  "Sales Invoice",
  "Sales Return Receipt",
  "Sales Credit Memo",
  "Purchase Receipt",
  "Purchase Invoice",
  "Purchase Return Shipment",
  "Purchase Credit Memo",
  "Transfer Shipment",
  "Transfer Receipt",
  "Service Shipment",
  "Service Invoice",
  "Service Credit Memo",
  "Posted Assembly",
  "Inventory Receipt",
  "Inventory Shipment",
  "Direct Transfer"
] as const;

export const trackedEntityStatus = [
  "Available",
  "Consumed",
  "On Hold",
  "Reserved",
  "Rejected"
] as const;

export const replenishmentSystemTypes = [
  "Buy",
  "Make",
  "Buy and Make"
] as const;

export const receiptSourceDocumentType = [
  // "Sales Order",
  // "Sales Invoice",
  // "Sales Return Order",
  "Purchase Order",
  "Purchase Invoice",
  // "Purchase Return Order",
  "Inbound Transfer"
  // "Outbound Transfer",
  // "Manufacturing Consumption",
  // "Manufacturing Output",
] as const;

export const receiptStatusType = [
  "Draft",
  "Pending",
  "Posted",
  "Voided"
] as const;

export const batchPropertyValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item ID is required" }),
    label: z.string().min(1, { message: "Label is required" }),
    dataType: z.enum(batchPropertyDataTypes),
    listOptions: z.string().min(1).array().optional(),
    configurationParameterGroupId: z.string().optional()
  })
  .refine(
    (data) => {
      if (data.dataType === "list") {
        return !!data.listOptions;
      }
      return true;
    },
    { message: "List options are required", path: ["listOptions"] }
  );

export const batchPropertyOrderValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  sortOrder: zfd.numeric(z.number().min(0))
});

// Manual override of a tracked entity's expirationDate. Reason is required
// because the override is recorded on the entity's attributes JSONB so the
// trace popover can surface it later.
export const trackedEntityExpiryValidator = z.object({
  trackedEntityId: z.string().min(1),
  // ISO date (YYYY-MM-DD). Empty clears the column entirely.
  expirationDate: zfd.text(z.string().optional()),
  reason: z
    .string()
    .min(3, { message: "Reason must be at least 3 characters" })
    .max(500)
});

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  originalStorageUnitId: zfd.text(z.string().optional()),
  adjustmentType: z.enum([...itemLedgerTypes, "Set Quantity"]),
  quantity: zfd.numeric(z.number()),
  trackedEntityId: zfd.text(z.string().optional()),
  readableId: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
  comment: zfd.text(z.string().optional())
});

export const itemLedgerValidator = z.object({
  postingDate: zfd.text(z.string().optional()),
  entryType: z.enum(itemLedgerTypes),
  documentType: z.union([z.enum(itemLedgerDocumentTypes), z.undefined()]),
  documentId: z.string().optional(),
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().optional(),
  storageUnitId: z.string().optional(),
  quantity: z.number()
});

export const kanbanValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item is required" }),
    replenishmentSystem: z.enum(replenishmentSystemTypes).default("Buy"),
    autoRelease: zfd.checkbox(),
    autoStartJob: zfd.checkbox(),
    completedBarcodeOverride: zfd.text(z.string().optional()),
    quantity: zfd.numeric(
      z.number().int().min(1, { message: "Quantity must be at least 1" })
    ),
    locationId: z.string().min(1, { message: "Location is required" }),
    storageUnitId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    purchaseUnitOfMeasureCode: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().min(0).default(1))
  })
  .refine(
    (data) => (data.replenishmentSystem === "Buy" ? !!data.supplierId : true),
    {
      message: "Supplier is required",
      path: ["supplierId"]
    }
  );

export const receiptValidator = z.object({
  id: z.string().min(1),
  receiptId: z.string().min(1, { message: "Receipt ID is required" }),
  locationId: zfd.text(z.string().optional()),
  sourceDocument: z.enum(receiptSourceDocumentType).optional(),
  sourceDocumentId: zfd.text(
    z.string().min(1, { message: "Source Document ID is required" })
  ),
  externalDocumentId: zfd.text(z.string().optional()),
  sourceDocumentReadableId: zfd.text(z.string().optional()),
  supplierId: zfd.text(z.string().optional())
});

export const storageUnitValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  locationId: z.string().min(1, { message: "Location ID is required" }),
  warehouseId: zfd.text(z.string().optional()),
  parentId: zfd.text(z.string().optional()),
  workCenterId: zfd.text(z.string().optional()),
  storageTypeIds: zfd.repeatableOfType(z.string()).default([])
});

export const storageTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const shipmentStatusType = [
  "Draft",
  "Pending",
  "Posted",
  "Voided"
] as const;

export const shipmentSourceDocumentType = [
  "Sales Order",
  // "Sales Invoice",
  // "Sales Return Order",
  "Purchase Order",
  // "Purchase Invoice",
  // "Purchase Return Order",
  // "Inbound Transfer",
  "Outbound Transfer"
] as const;

export const shippingCarrierType = [
  "UPS",
  "FedEx",
  "USPS",
  "DHL",
  "Other"
] as const;

export const shipmentValidator = z.object({
  id: z.string().min(1),
  shipmentId: z.string().min(1, { message: "Receipt ID is required" }),
  locationId: zfd.text(z.string().optional()),
  sourceDocument: z.enum(shipmentSourceDocumentType).optional(),
  sourceDocumentId: zfd.text(
    z.string().min(1, { message: "Source Document ID is required" })
  ),
  trackingNumber: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  sourceDocumentReadableId: zfd.text(z.string().optional()),
  customerId: zfd.text(z.string().optional())
});

export const shippingMethodValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"], {
    errorMap: () => ({
      message: "Carrier is required"
    })
  }),
  carrierAccountId: zfd.text(z.string().optional()),
  trackingUrl: zfd.text(z.string().optional())
});

export const splitValidator = z.object({
  documentId: z.string().min(1, { message: "Document ID is required" }),
  documentLineId: z
    .string()
    .min(1, { message: "Document Line ID is required" }),
  locationId: z.string().min(1, { message: "Location ID is required" }),
  quantity: zfd.numeric(z.number())
});

export const warehouseTransferStatusType = [
  "Draft",
  "To Ship and Receive",
  "To Ship",
  "To Receive",
  "Completed",
  "Cancelled"
] as const;

export function isWarehouseTransferLocked(
  status: string | null | undefined
): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const warehouseTransferValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    transferId: zfd.text(z.string().optional()),
    fromLocationId: z.string().min(1, { message: "From Location is required" }),
    toLocationId: z.string().min(1, { message: "To Location is required" }),
    status: z.enum(warehouseTransferStatusType).optional(),
    transferDate: zfd.text(z.string().optional()),
    expectedReceiptDate: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
    reference: zfd.text(z.string().optional())
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "From and To locations must be different",
    path: ["toLocationId"]
  });

export const warehouseTransferLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    transferId: z.string().min(1, { message: "Transfer ID is required" }),
    itemId: z.string().min(1, { message: "Item is required" }),
    quantity: zfd.numeric(
      z.number().min(0.0001, { message: "Quantity must be greater than 0" })
    ),
    fromLocationId: z.string().min(1, { message: "From Location is required" }),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toLocationId: z.string().min(1, { message: "To Location is required" }),
    toStorageUnitId: zfd.text(z.string().optional()),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "From and To locations must be different",
    path: ["toLocationId"]
  });

export const stockTransferStatusType = [
  "Draft",
  "Released",
  "In Progress",
  "Completed"
] as const;

export function isStockTransferLocked(
  status: string | null | undefined
): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

export const stockTransferValidator = z.object({
  id: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  lines: z.string().transform((val, ctx) => {
    try {
      const parsed = JSON.parse(val);
      return z
        .array(
          z.object({
            itemId: z.string().min(1, { message: "Item is required" }),
            fromStorageUnitId: z.string().nullish(),
            toStorageUnitId: z.string().nullish(),
            quantity: z.number().min(0).optional(),
            requiresSerialTracking: z.boolean().optional(),
            requiresBatchTracking: z.boolean().optional()
          })
        )
        .min(1, { message: "At least one line is required" })
        .parse(parsed);
      // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid JSON format for lines"
      });
      return z.NEVER;
    }
  })
});

export const stockTransferLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  stockTransferId: z.string().min(1, { message: "Pick list is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  fromStorageUnitId: zfd.text(z.string().optional()),
  toStorageUnitId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z
      .number()
      .min(0, { message: "Quantity must be greater than or equal to 0" })
  ),
  pickedQuantity: zfd.numeric(z.number().min(0).optional()),
  requiresBatchTracking: zfd.text(
    z.string().transform((val) => val === "true")
  ),
  requiresSerialTracking: zfd.text(
    z.string().transform((val) => val === "true")
  )
});

export const stockTransferLineScanValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  stockTransferId: z.string().min(1, { message: "Stock transfer is required" }),
  trackedEntityId: z
    .string()
    .min(1, { message: "Tracked entity ID is required" })
});

export const pickingListStatusType = [
  "Draft",
  "In Progress",
  "Completed",
  "Cancelled"
] as const;

export const pickingListLineStatusType = [
  "Pending",
  "Picked",
  "Short",
  "Cancelled"
] as const;

// A picking list locks once it is Completed or Cancelled: no further picks or
// unpicks are allowed until it is reopened (which requires the inventory
// `delete` permission, ERP-only).
export function isPickingListLocked(
  status: string | null | undefined
): boolean {
  return status === "Completed" || status === "Cancelled";
}

export const pickingListValidator = z.object({
  id: zfd.text(z.string().optional()),
  pickingListId: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  assignee: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional()),
  notes: zfd.text(z.string().optional())
});

export const pickingListLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  pickingListId: z.string().min(1),
  jobId: z.string().min(1),
  jobMaterialId: z.string().min(1),
  jobOperationId: zfd.text(z.string().optional()),
  itemId: z.string().min(1),
  quantityToPick: zfd.numeric(z.number().min(0.0001)),
  storageUnitId: zfd.text(z.string().optional())
});

export const pickingListLineTrackedEntityValidator = z.object({
  pickingListLineId: z.string().min(1),
  trackedEntityId: z.string().min(1),
  quantity: zfd.numeric(z.number().min(0.0001))
});

export const generatePickingListValidator = z.object({
  locationId: z.string().min(1, { message: "Location is required" }),
  jobOperationIds: z.array(z.string().min(1)).min(1, {
    message: "Select at least one operation"
  }),
  assignee: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional())
});

export const pickQuantityValidator = z.object({
  pickingListLineId: z.string().min(1),
  quantity: zfd.numeric(z.number().min(0)),
  markShort: zfd.text(z.string().optional())
});
