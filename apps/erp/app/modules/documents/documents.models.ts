import { z } from "zod";
import { methodItemType } from "~/modules/shared";

export const documentSourceTypes = [
  "Job",
  "Purchase Order",
  "Purchase Invoice",
  "Quote",
  "Request for Quote",
  "Supplier Quote",
  "Sales Order",
  "Sales Invoice",
  "Shipment",
  ...methodItemType,
] as const;

export const documentValidator = z.object({
  id: z.string().min(1, { message: "Document ID is required" }),
  name: z.string().min(3).max(50),
  extension: z.string().optional(),
  description: z.string().optional(),
  labels: z.array(z.string().min(1).max(50)).optional(),
  readGroups: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Read permissions are required" }),
  writeGroups: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .min(1, { message: "Write permissions are required" }),
});

export const documentLabelsValidator = z.object({
  documentId: z.string().min(20),
  labels: z.array(z.string().min(1).max(50)).optional(),
});
