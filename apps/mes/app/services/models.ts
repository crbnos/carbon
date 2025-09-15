import { z } from "zod";
import { zfd } from "zod-form-data";

export const documentTypes = [
  "Archive",
  "Document",
  "Presentation",
  "PDF",
  "Spreadsheet",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Other",
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
] as const;

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled",
] as const;

export const stepRecordValidator = z.object({
  index: zfd.numeric(z.number()),
  jobOperationStepId: z.string(),
  value: zfd.text(z.string().optional()),
  numericValue: zfd.numeric(z.number().optional()),
  booleanValue: zfd
    .text(z.enum(["true", "false"]).transform((val) => val === "true"))
    .optional(),
  userValue: zfd.text(z.string().optional()),
});

export const issueValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  jobOperationId: z.string().min(1, { message: "Job Operation is required" }),
  materialId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum([
    "Set Quantity",
    "Positive Adjmt.",
    "Negative Adjmt.",
  ]),
});

export const feedbackValidator = z.object({
  feedback: z.string().min(1, { message: "" }),
  attachmentPath: z.string().optional(),
  location: z.string(),
});

export const productionEventType = ["Setup", "Labor", "Machine"] as const;

export const productionEventAction = ["Start", "End"] as const;

export const productionEventValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobOperationId: z
    .string()
    .min(1, { message: "Job Operation ID is required" }),
  timezone: zfd.text(z.string()),
  action: z.enum(productionEventAction, {
    errorMap: (issue, ctx) => ({
      message: "Action is required",
    }),
  }),
  type: z.enum(productionEventType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required",
    }),
  }),
  workCenterId: zfd.text(z.string().optional()),
  hasActiveEvents: z.enum(["true", "false"]),
  trackedEntityId: zfd.text(z.string().optional()),
});

export const finishValidator = z.object({
  jobOperationId: z.string(),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional()),
});

export const issueTrackedEntityValidator = z.object({
  materialId: z.string(),
  parentTrackedEntityId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number(),
    })
  ),
});

export const baseQuantityValidator = finishValidator.extend({
  trackedEntityId: zfd.text(z.string().optional()),
  trackingType: z.enum(["Serial", "Batch", ""]).optional(),
  quantity: zfd.numeric(z.number().positive()),
  notes: zfd.text(z.string().optional()),
});

export const nonScrapQuantityValidator = baseQuantityValidator;

export const scrapQuantityValidator = baseQuantityValidator.extend({
  scrapReasonId: zfd.text(z.string()),
  notes: zfd.text(z.string().optional()),
});
