import { z } from "zod/v3";
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
  "Other"
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline"
] as const;

export const jobStatus = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled"
] as const;

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled"
] as const;

export const maintenanceDispatchPriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const maintenanceSeverity = [
  "Preventive",
  "Operator Performed",
  "Support Required",
  "OEM Required"
] as const;

export const maintenanceSource = [
  "Scheduled",
  "Reactive",
  "Non-Conformance"
] as const;

export const oeeImpact = ["Down", "Planned", "Impact", "No Impact"] as const;

export const convertEntityValidator = z.object({
  trackedEntityId: z.string(),
  newRevision: z.string(),
  quantity: z.coerce.number().positive().default(1)
});

export const stepRecordValidator = z.object({
  index: zfd.numeric(z.number()),
  jobOperationStepId: z.string(),
  value: zfd.text(z.string().optional()),
  numericValue: zfd.numeric(z.number().optional()),
  booleanValue: zfd
    .text(z.enum(["true", "false"]).transform((val) => val === "true"))
    .optional(),
  userValue: zfd.text(z.string().optional())
});

export const issueValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  jobOperationId: z.string().min(1, { message: "Job Operation is required" }),
  materialId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum(["Set Quantity", "Positive Adjmt.", "Negative Adjmt."])
});

export const feedbackValidator = z.object({
  feedback: z.string().min(1, { message: "" }),
  attachmentPath: z.string().optional(),
  location: z.string()
});

export const suggestionValidator = z.object({
  suggestion: z.string().min(1, { message: "Suggestion is required" }),
  emoji: z.string().default("💡"),
  attachmentPath: z.string().optional(),
  path: z.string(),
  userId: zfd.text(z.string().optional())
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
      message: "Action is required"
    })
  }),
  type: z.enum(productionEventType, {
    errorMap: (issue, ctx) => ({
      message: "Type is required"
    })
  }),
  workCenterId: zfd.text(z.string().optional()),
  trackedEntityId: zfd.text(z.string().optional())
});

export const finishValidator = z.object({
  jobOperationId: z.string(),
  setupProductionEventId: zfd.text(z.string().optional()),
  laborProductionEventId: zfd.text(z.string().optional()),
  machineProductionEventId: zfd.text(z.string().optional())
});

export const issueTrackedEntityValidator = z.object({
  materialId: z.string().optional(),
  jobOperationId: z.string().optional(),
  itemId: z.string().optional(),
  parentTrackedEntityId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number()
    })
  )
});

export const baseQuantityValidator = finishValidator.extend({
  trackedEntityId: zfd.text(z.string().optional()),
  trackingType: z.enum(["Serial", "Batch", ""]).optional(),
  quantity: zfd.numeric(z.number().positive()),
  notes: zfd.text(z.string().optional())
});

export const nonScrapQuantityValidator = baseQuantityValidator;

export const scrapQuantityValidator = baseQuantityValidator.extend({
  scrapReasonId: zfd.text(z.string()),
  notes: zfd.text(z.string().optional())
});

export const maintenanceDispatchValidator = z.object({
  workCenterId: z.string().min(1, { message: "Work Center is required" }),
  priority: z.enum(maintenanceDispatchPriority, {
    errorMap: () => ({ message: "Priority is required" })
  }),
  severity: z.enum(maintenanceSeverity, {
    errorMap: () => ({ message: "Severity is required" })
  }),
  oeeImpact: z.enum(oeeImpact, {
    errorMap: () => ({ message: "OEE Impact is required" })
  }),
  suspectedFailureModeId: zfd.text(z.string().optional()),
  actualFailureModeId: zfd.text(z.string().optional()),
  content: zfd.text(z.string().optional()),
  actualStartTime: zfd.text(z.string().optional()),
  actualEndTime: zfd.text(z.string().optional())
});

export const maintenanceDispatchIssueValidator = z.object({
  maintenanceDispatchItemId: z.string().min(1, {
    message: "Maintenance Dispatch Item is required"
  }),
  quantity: zfd.numeric(z.number()),
  adjustmentType: z.enum(["Positive Adjmt.", "Negative Adjmt."])
});

export const maintenanceDispatchIssueTrackedEntityValidator = z.object({
  maintenanceDispatchItemId: z.string(),
  children: z.array(
    z.object({
      trackedEntityId: z.string(),
      quantity: z.number()
    })
  )
});
