import { z } from "zod";
import { zfd } from "zod-form-data";
import { batchPropertyDataTypes } from "../items/items.models";

export const demandPeriodTypes = ["Week", "Day", "Month"] as const;
export const demandSourceTypes = ["Sales Order", "Job Material"] as const;

export const itemTypes = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
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
  "Assembly Output",
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
  "Direct Transfer",
] as const;

export const trackedEntityStatus = [
  "Available",
  "Consumed",
  "On Hold",
  "Reserved",
] as const;

export const replenishmentSystemTypes = [
  "Buy",
  "Make",
  "Buy and Make",
] as const;

export const receiptSourceDocumentType = [
  // "Sales Order",
  // "Sales Invoice",
  // "Sales Return Order",
  "Purchase Order",
  "Purchase Invoice",
  // "Purchase Return Order",
  "Inbound Transfer",
  // "Outbound Transfer",
  // "Manufacturing Consumption",
  // "Manufacturing Output",
] as const;

export const receiptStatusType = ["Draft", "Pending", "Posted"] as const;

export const batchPropertyValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item ID is required" }),
    label: z.string().min(1, { message: "Label is required" }),
    dataType: z.enum(batchPropertyDataTypes),
    listOptions: z.string().min(1).array().optional(),
    configurationParameterGroupId: z.string().optional(),
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
  sortOrder: zfd.numeric(z.number().min(0)),
});

export const inventoryAdjustmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  shelfId: zfd.text(z.string().optional()),
  adjustmentType: z.enum([...itemLedgerTypes, "Set Quantity"]),
  quantity: zfd.numeric(z.number()),
  trackedEntityId: zfd.text(z.string().optional()),
});

export const itemLedgerValidator = z.object({
  postingDate: zfd.text(z.string().optional()),
  entryType: z.enum(itemLedgerTypes),
  documentType: z.union([z.enum(itemLedgerDocumentTypes), z.undefined()]),
  documentId: z.string().optional(),
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().optional(),
  shelfId: z.string().optional(),
  quantity: z.number(),
});

export const kanbanValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  replenishmentSystem: z.enum(replenishmentSystemTypes).default("Buy"),
  quantity: zfd.numeric(
    z.number().int().min(1, { message: "Quantity must be at least 1" })
  ),
  locationId: z.string().min(1, { message: "Location is required" }),
  shelfId: zfd.text(z.string().optional()),
});

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
  supplierId: zfd.text(z.string().optional()),
});

export const shelfValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  locationId: z.string().min(1, { message: "Location ID is required" }),
});

export const shipmentStatusType = [
  "Draft",
  "Pending",
  "Posted",
  "Voided",
] as const;

export const shipmentSourceDocumentType = [
  "Sales Order",
  // "Sales Invoice",
  // "Sales Return Order",
  "Purchase Order",
  // "Purchase Invoice",
  // "Purchase Return Order",
  // "Inbound Transfer",
  "Outbound Transfer",
] as const;

export const shippingCarrierType = [
  "UPS",
  "FedEx",
  "USPS",
  "DHL",
  "Other",
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
  customerId: zfd.text(z.string().optional()),
});

export const shippingMethodValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  carrier: z.enum(["UPS", "FedEx", "USPS", "DHL", "Other"], {
    errorMap: () => ({
      message: "Carrier is required",
    }),
  }),
  carrierAccountId: zfd.text(z.string().optional()),
  trackingUrl: zfd.text(z.string().optional()),
});

export const splitValidator = z.object({
  documentId: z.string().min(1, { message: "Document ID is required" }),
  documentLineId: z
    .string()
    .min(1, { message: "Document Line ID is required" }),
  locationId: z.string().min(1, { message: "Location ID is required" }),
  quantity: zfd.numeric(z.number()),
});

export const warehouseTransferStatusType = [
  "Draft",
  "To Ship and Receive",
  "To Ship",
  "To Receive",
  "Completed",
  "Cancelled",
] as const;

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
    reference: zfd.text(z.string().optional()),
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "From and To locations must be different",
    path: ["toLocationId"],
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
    fromShelfId: zfd.text(z.string().optional()),
    toLocationId: z.string().min(1, { message: "To Location is required" }),
    toShelfId: zfd.text(z.string().optional()),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
  })
  .refine((data) => data.fromLocationId !== data.toLocationId, {
    message: "From and To locations must be different",
    path: ["toLocationId"],
  });
