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

export const issueValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  jobOperationId: z.string().min(1, { message: "Job Operation is required" }),
  materialId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number()),
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
});

export const finishValidator = z.object({
  jobOperationId: z.string(),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional()),
});

export const nonScrapQuantityValidator = finishValidator.extend({
  quantity: zfd.numeric(z.number().positive()),
});

export const scrapQuantityValidator = nonScrapQuantityValidator.extend({
  scrapReasonId: zfd.text(z.string()),
  notes: zfd.text(z.string().optional()),
});
