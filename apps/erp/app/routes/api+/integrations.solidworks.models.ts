import { onShapeDataValidator } from "@carbon/ee/onshape";
import { z } from "zod";

const methodType = [
  "Purchase to Order",
  "Make to Order",
  "Pull from Inventory"
] as const;
const replenishmentSystems = ["Buy", "Make", "Buy and Make"] as const;

// Same BOM row contract as Onshape (`onShapeDataValidator`). The SolidWorks
// connector maps its assembly tree into this shape so the `sync` edge function
// can reuse the existing make-method tree builder (`type: "solidworks"`).
export const solidWorksBomRowsValidator = onShapeDataValidator;

export const solidWorksDiagnosticValidator = z.object({
  component: z.string().min(1),
  reason: z.string().min(1)
});

export const solidWorksSendPayloadValidator = z.object({
  idempotencyKey: z.string().max(200).optional(),
  connectorVersion: z.string().max(50).optional(),
  root: z.object({
    partNumber: z.string().trim().min(1, "Part number is required"),
    name: z.string().trim().min(1, "Name is required"),
    description: z.string().optional(),
    revision: z.string().trim().min(1, "Revision is required"),
    configuration: z.string().optional(),
    sourcePath: z.string().optional(),
    replenishmentSystem: z.enum(replenishmentSystems).optional(),
    defaultMethodType: z.enum(methodType).optional()
  }),
  rows: solidWorksBomRowsValidator.default([]),
  diagnostics: z.array(solidWorksDiagnosticValidator).optional()
});

export type SolidWorksSendPayload = z.infer<
  typeof solidWorksSendPayloadValidator
>;

export const solidWorksLookupValidator = z.object({
  items: z
    .array(
      z.object({
        readableId: z.string().trim().min(1),
        revision: z.string().optional().nullable()
      })
    )
    .min(1)
    .max(500)
});

export type SolidWorksLookupPayload = z.infer<typeof solidWorksLookupValidator>;

export const SOLIDWORKS_ROOT_INTEGRATION = "solidworks";
export const SOLIDWORKS_DATA_INTEGRATION = "solidworksData";
